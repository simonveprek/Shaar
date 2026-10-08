import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CandidateBrief } from "./candidate";
import { json, maybeOne, one } from "./db";
import { PersonaProfile } from "./persona";

/*
 * Fictional candidates from fixtures/candidates/*.json, so the interview simulator works without scraping.
 * Each fixture becomes a `ready` research job + persona (with `personas.candidate`) owned by one visitor.
 * Re-running updates the existing fixture personas instead of duplicating them.
 */

const Fixture = z.object({
  subjectName: z.string().min(1),
  notes: z.string().nullable(),
  profile: PersonaProfile,
  candidate: CandidateBrief,
});

const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "candidates");

export async function loadFixtures() {
  const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(
    files.map(async (file) => {
      const parsed = Fixture.safeParse(JSON.parse(await readFile(path.join(FIXTURES_DIR, file), "utf8")));
      if (!parsed.success) throw new Error(`${file} is invalid:\n${z.prettifyError(parsed.error)}`);
      return { slug: file.replace(/\.json$/, ""), ...parsed.data };
    }),
  );
}

export async function seedCandidates(userId: string) {
  const seeded: { slug: string; name: string; jobId: string; personaId: string; created: boolean }[] = [];
  for (const f of await loadFixtures()) {
    // The marker in `notes` makes re-runs find the same job instead of creating a new one.
    const marker = `[fixture:${f.slug}]`;
    const existing = await maybeOne<{ id: string }>(
      "select id from research_jobs where user_id = $1 and notes like $2 limit 1",
      [userId, `${marker}%`],
    );
    const jobId =
      existing?.id ??
      (
        await one<{ id: string }>(
          "insert into research_jobs (user_id, subject_name, notes, status) values ($1, $2, $3, 'ready') returning id",
          [userId, f.subjectName, `${marker} ${f.notes ?? ""}`.trim()],
        )
      ).id;

    const persona = await one<{ id: string }>(
      `insert into personas (job_id, user_id, status, model, profile, candidate)
       values ($1, $2, 'ready', 'fixture', $3::jsonb, $4::jsonb)
       on conflict (job_id) do update set status = 'ready', model = 'fixture', profile = excluded.profile,
         candidate = excluded.candidate, error = null, updated_at = now()
       returning id`,
      [jobId, userId, json(f.profile), json(f.candidate)],
    );
    seeded.push({ slug: f.slug, name: f.subjectName, jobId, personaId: persona.id, created: !existing });
  }
  return seeded;
}

const DemoPersona = z.object({ subjectName: z.string().min(1), notes: z.string().nullable(), profile: PersonaProfile });

/**
 * The demo's fictional subject, Mara Vell, as a ready persona without a candidate layer, so the demo can end in
 * a conversation with her. Owned by the visitor who asks, created once and reused after that.
 */
export async function seedDemoPersona(userId: string): Promise<{ personaId: string; jobId: string }> {
  const file = path.join(process.cwd(), "fixtures", "personas", "mara-vell.json");
  const demo = DemoPersona.parse(JSON.parse(await readFile(file, "utf8")));
  const marker = "[fixture:demo-mara-vell]";
  const existing = await maybeOne<{ id: string }>("select id from research_jobs where user_id = $1 and notes like $2 limit 1", [
    userId,
    `${marker}%`,
  ]);
  const jobId =
    existing?.id ??
    (
      await one<{ id: string }>(
        "insert into research_jobs (user_id, subject_name, notes, status) values ($1, $2, $3, 'ready') returning id",
        [userId, demo.subjectName, `${marker} ${demo.notes ?? ""}`.trim()],
      )
    ).id;
  const persona = await one<{ id: string }>(
    `insert into personas (job_id, user_id, status, model, profile)
     values ($1, $2, 'ready', 'fixture', $3::jsonb)
     on conflict (job_id) do update set status = 'ready', model = 'fixture', profile = excluded.profile, error = null, updated_at = now()
     returning id`,
    [jobId, userId, json(demo.profile)],
  );
  return { personaId: persona.id, jobId };
}
