import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { buildDossier, type DossierItem } from "@/lib/dossier";
import { handle } from "@/lib/http";
import { apify } from "@/lib/apify";
import { advanceJob, getJob, isQueued, loadPersona, type RunRow } from "@/lib/research";

/** The watcher's file for a research job: exposure, routine, presence, circle and their own words. */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/research/[id]/dossier">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await getJob(id, user.id);
  const { job, runs } = await advanceJob(id);

  const items = await sql<DossierItem>(
    `select platform, kind, author, text, posted_at, url, metrics from scraped_items
     where job_id = $1 order by posted_at desc nulls last limit 3000`,
    [id],
  );
  const persona = await loadPersona(id);

  const dossier = buildDossier({
    jobId: job.id,
    subjectName: job.subject_name,
    items,
    persona: persona?.status === "ready" ? persona.profile : null,
    now: new Date(),
  });
  // One line per source, so the page can show what is still being collected. While an actor runs, its dataset
  // already fills up, so `found` counts records as Apify finds them, before they are ingested.
  const found = await Promise.all(runs.map(liveCount));
  const sources = [...new Set(runs.map((r) => r.platform))].map((platform) => {
    const mine = runs.map((r, i) => ({ ...r, found: found[i] })).filter((r) => r.platform === platform);
    return {
      platform,
      status: mine.some((r) => (r.status === "running" && r.apify_run_id) || r.status === "ingesting")
        ? "collecting"
        : mine.some(isQueued)
          ? "waiting"
          : mine.some((r) => r.status === "succeeded")
            ? "done"
            : "failed",
      items: mine.reduce((sum, r) => sum + r.item_count, 0),
      found: mine.reduce((sum, r) => sum + r.found, 0),
    };
  });
  return Response.json({ dossier, jobStatus: job.status, sources });
});

/** Records a run has so far: its dataset while it runs on Apify, what was ingested once it is done. */
async function liveCount(run: RunRow): Promise<number> {
  if (run.status !== "running" || !run.dataset_id) return run.item_count;
  const dataset = await apify().dataset(run.dataset_id).get().catch(() => undefined);
  return Math.min(dataset?.itemCount ?? 0, run.max_items ?? Infinity);
}
