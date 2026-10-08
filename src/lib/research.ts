import { getActor, getConnector } from "@/connectors";
import type { ActorSpec, ConnectorOptions } from "@/connectors/types";
import { apify, TERMINAL_RUN_STATUSES } from "./apify";
import { db } from "./supabase";
import { env } from "./env";
import { check, HttpError, maybe, must, notFound } from "./http";
import { buildDigest, pollPersonaGeneration, startPersonaGeneration, type DigestItem } from "./persona";

/*
 * Research lifecycle. Every step is idempotent and driven from the outside, so it fits serverless limits:
 *
 *   createJob -> startConnectorRun (Apify works for minutes)
 *     -> Apify webhook or client polling calls advanceJob
 *     -> syncConnectorRun ingests each finished dataset
 *     -> when all runs are done: persona generation starts in OpenAI background mode
 *     -> advanceJob polls OpenAI until the persona is ready.
 */

export type JobRow = {
  id: string;
  user_id: string;
  subject_name: string;
  notes: string | null;
  status: "scraping" | "analyzing" | "ready" | "failed";
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type RunRow = {
  id: string;
  job_id: string;
  user_id: string;
  platform: string;
  target: string;
  actor_id: string;
  input: Record<string, unknown>;
  apify_run_id: string | null;
  dataset_id: string | null;
  status: "running" | "ingesting" | "succeeded" | "failed";
  item_count: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export type PersonaRow = {
  id: string;
  job_id: string;
  user_id: string;
  status: "generating" | "ready" | "failed";
  model: string;
  openai_response_id: string | null;
  profile: import("./persona").PersonaProfile | null;
  candidate: import("./candidate").CandidateBrief | null;
  voice_id: string | null;
  elevenlabs_agent_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type Target = { platform: string; target: string; maxPosts?: number };

const DEFAULT_MAX_POSTS = 30;
const INGEST_PAGE_SIZE = 500;
const MAX_INGEST_ITEMS = 2000;

export async function createJob(
  userId: string,
  input: { subjectName: string; notes?: string; targets: Target[] },
): Promise<{ job: JobRow; runs: RunRow[] }> {
  for (const t of input.targets) getConnector(t.platform); // validate platforms before writing anything

  const job = must(
    await db()
      .from("research_jobs")
      .insert({ user_id: userId, subject_name: input.subjectName, notes: input.notes ?? null })
      .select()
      .single<JobRow>(),
  );

  const runs = (await Promise.all(input.targets.map((t) => startConnector(job, t)))).flat();
  return { job, runs };
}

/** Starts every Apify actor of a platform's connector (e.g. profile + posts) for one target. */
export async function startConnector(job: JobRow, t: Target): Promise<RunRow[]> {
  const connector = getConnector(t.platform);
  const opts = { maxPosts: t.maxPosts ?? DEFAULT_MAX_POSTS };
  return Promise.all(connector.actors.map((actor) => startActorRun(job, connector.platform, actor, t.target, opts)));
}

/** Starts one Apify actor run and records it. Failures to start are recorded on the row, not thrown. */
async function startActorRun(
  job: JobRow,
  platform: string,
  actor: ActorSpec,
  target: string,
  opts: ConnectorOptions,
): Promise<RunRow> {
  const input = actor.buildInput(target, opts);
  const row = must(
    await db()
      .from("connector_runs")
      .insert({ job_id: job.id, user_id: job.user_id, platform, target, actor_id: actor.actorId, input })
      .select()
      .single<RunRow>(),
  );

  try {
    const { PUBLIC_API_URL, APIFY_WEBHOOK_SECRET, APIFY_MAX_CHARGE_USD_PER_RUN } = env();
    const webhooks = PUBLIC_API_URL
      ? [
          {
            eventTypes: [...WEBHOOK_EVENTS],
            requestUrl: `${PUBLIC_API_URL.replace(/\/$/, "")}/api/webhooks/apify?secret=${encodeURIComponent(APIFY_WEBHOOK_SECRET)}`,
          },
        ]
      : undefined;

    const run = await apify()
      .actor(actor.actorId)
      .start(input, {
        webhooks,
        maxItems: actor.maxItems(opts),
        maxTotalChargeUsd: APIFY_MAX_CHARGE_USD_PER_RUN,
      });

    return must(
      await db()
        .from("connector_runs")
        .update({ apify_run_id: run.id, dataset_id: run.defaultDatasetId })
        .eq("id", row.id)
        .select()
        .single<RunRow>(),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return finishRun(row.id, { status: "failed", error: `Could not start Apify actor: ${message}` });
  }
}

const WEBHOOK_EVENTS = [
  "ACTOR.RUN.SUCCEEDED",
  "ACTOR.RUN.FAILED",
  "ACTOR.RUN.ABORTED",
  "ACTOR.RUN.TIMED_OUT",
] as const;

/** Checks a running Apify run; when it has finished, ingests its dataset exactly once. */
export async function syncConnectorRun(run: RunRow): Promise<RunRow> {
  if (run.status !== "running" || !run.apify_run_id) return run;

  const apifyRun = await apify().run(run.apify_run_id).get();
  if (!apifyRun || !(TERMINAL_RUN_STATUSES as readonly string[]).includes(apifyRun.status)) return run;

  // Claim the run so a webhook and a polling request can't both ingest it.
  const claimed = maybe(
    await db()
      .from("connector_runs")
      .update({ status: "ingesting" })
      .eq("id", run.id)
      .eq("status", "running")
      .select()
      .maybeSingle<RunRow>(),
  );
  if (!claimed) return reloadRun(run.id);

  // A run stopped by the cost cap or timeout may still have useful items, so ingest anything that exists.
  try {
    const count = await ingestDataset(claimed, apifyRun.defaultDatasetId);
    if (apifyRun.status === "SUCCEEDED" || count > 0) {
      return finishRun(run.id, {
        status: "succeeded",
        item_count: count,
        error: apifyRun.status === "SUCCEEDED" ? null : `Apify run ${apifyRun.status} (partial data kept)`,
      });
    }
    return finishRun(run.id, { status: "failed", error: `Apify run ${apifyRun.status}` });
  } catch (err) {
    return finishRun(run.id, { status: "failed", error: `Ingest failed: ${err instanceof Error ? err.message : err}` });
  }
}

async function ingestDataset(run: RunRow, datasetId: string): Promise<number> {
  const actor = getActor(run.platform, run.actor_id);
  const seen = new Set<string>();
  let offset = 0;

  while (offset < MAX_INGEST_ITEMS) {
    const page = await apify().dataset(datasetId).listItems({ offset, limit: INGEST_PAGE_SIZE, clean: true });
    const rows = page.items.flatMap((raw) =>
      actor
        .normalize(raw as Record<string, unknown>)
        // Profile items repeat on every post for some actors; keep the first.
        .filter((item) => !seen.has(item.externalId) && seen.add(item.externalId))
        .map((item) => ({
          job_id: run.job_id,
          run_id: run.id,
          user_id: run.user_id,
          platform: run.platform,
          kind: item.kind,
          external_id: item.externalId,
          url: item.url,
          author: item.author,
          text: item.text,
          posted_at: item.postedAt,
          metrics: item.metrics,
          media: item.media,
          data: leanRaw(raw as Record<string, unknown>),
        })),
    );
    if (rows.length) {
      check(await db().from("scraped_items").upsert(rows, { onConflict: "run_id,external_id", ignoreDuplicates: true }));
    }
    offset += page.items.length;
    if (page.items.length < INGEST_PAGE_SIZE) break;
  }
  return seen.size;
}

/** Keeps raw items around for the frontend, but caps very large payloads. */
function leanRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(raw);
  return json.length < 20_000 ? raw : { truncated: true, preview: json.slice(0, 20_000) };
}

async function finishRun(id: string, patch: Partial<RunRow>): Promise<RunRow> {
  return must(
    await db()
      .from("connector_runs")
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single<RunRow>(),
  );
}

async function reloadRun(id: string): Promise<RunRow> {
  return must(await db().from("connector_runs").select().eq("id", id).single<RunRow>());
}

export async function getJob(jobId: string, userId: string): Promise<JobRow> {
  const job = maybe(
    await db().from("research_jobs").select().eq("id", jobId).eq("user_id", userId).maybeSingle<JobRow>(),
  );
  if (!job) throw notFound("Research job");
  return job;
}

/**
 * Moves a job forward as far as it can right now. Safe to call repeatedly and concurrently
 * (from status polling, Apify webhooks, or OpenAI completion).
 */
export async function advanceJob(jobId: string): Promise<{ job: JobRow; runs: RunRow[]; persona: PersonaRow | null }> {
  let job = must(await db().from("research_jobs").select().eq("id", jobId).single<JobRow>());
  let runs = must(await db().from("connector_runs").select().eq("job_id", jobId).order("created_at").returns<RunRow[]>());

  if (job.status === "scraping") {
    runs = await Promise.all(runs.map(syncConnectorRun));
    const allDone = runs.every((r) => r.status === "succeeded" || r.status === "failed");
    if (allDone) {
      const anyData = runs.some((r) => r.status === "succeeded" && r.item_count > 0);
      job = anyData
        ? await startAnalysis(job)
        : await setJobStatus(job.id, "scraping", { status: "failed", error: "No connector returned any data" });
    }
  }

  let persona = maybe(await db().from("personas").select().eq("job_id", jobId).maybeSingle<PersonaRow>());

  if (job.status === "analyzing" && persona?.status === "generating" && persona.openai_response_id) {
    const poll = await pollPersonaGeneration(persona.openai_response_id);
    if (poll.state === "ready") {
      persona = must(
        await db()
          .from("personas")
          .update({ status: "ready", profile: poll.profile })
          .eq("id", persona.id)
          .select()
          .single<PersonaRow>(),
      );
      job = await setJobStatus(job.id, "analyzing", { status: "ready" });
    } else if (poll.state === "failed") {
      persona = must(
        await db()
          .from("personas")
          .update({ status: "failed", error: poll.error })
          .eq("id", persona.id)
          .select()
          .single<PersonaRow>(),
      );
      job = await setJobStatus(job.id, "analyzing", { status: "failed", error: `Persona generation failed: ${poll.error}` });
    }
  }

  return { job, runs, persona };
}

/** Builds the digest and starts persona generation. Claims the job first so it only happens once. */
async function startAnalysis(job: JobRow): Promise<JobRow> {
  const claimed = maybe(
    await db()
      .from("research_jobs")
      .update({ status: "analyzing" })
      .eq("id", job.id)
      .eq("status", "scraping")
      .select()
      .maybeSingle<JobRow>(),
  );
  if (!claimed) return must(await db().from("research_jobs").select().eq("id", job.id).single<JobRow>());

  try {
    await generatePersona(claimed);
    return claimed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return setJobStatus(job.id, "analyzing", { status: "failed", error: `Could not start analysis: ${message}` });
  }
}

/** (Re)starts persona generation for a job from its scraped items. */
export async function generatePersona(job: JobRow): Promise<PersonaRow> {
  const items = must(
    await db()
      .from("scraped_items")
      .select("platform, kind, author, text, posted_at, url, metrics")
      .eq("job_id", job.id)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(1500)
      .returns<DigestItem[]>(),
  );
  if (!items.length) throw new HttpError(409, "This job has no scraped data yet");

  const { responseId, model } = await startPersonaGeneration(buildDigest(job.subject_name, job.notes, items));

  return must(
    await db()
      .from("personas")
      .upsert(
        {
          job_id: job.id,
          user_id: job.user_id,
          status: "generating",
          model,
          openai_response_id: responseId,
          profile: null,
          error: null,
        },
        { onConflict: "job_id" },
      )
      .select()
      .single<PersonaRow>(),
  );
}

async function setJobStatus(
  jobId: string,
  expected: JobRow["status"],
  patch: Partial<Pick<JobRow, "status" | "error">>,
): Promise<JobRow> {
  const updated = maybe(
    await db()
      .from("research_jobs")
      .update(patch)
      .eq("id", jobId)
      .eq("status", expected)
      .select()
      .maybeSingle<JobRow>(),
  );
  return updated ?? must(await db().from("research_jobs").select().eq("id", jobId).single<JobRow>());
}
