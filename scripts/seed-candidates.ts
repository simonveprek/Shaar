/*
 * Seeds fictional candidates from fixtures/candidates/*.json, so the interview simulator works without scraping.
 * Each fixture becomes a `ready` research job + persona (with `personas.candidate`) owned by the given user.
 * Re-running updates the existing fixture personas instead of duplicating them.
 *
 *   npm run seed:candidates -- --check              validate fixtures only, no database
 *   npm run seed:candidates -- --user you@example.com
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY (read from .env.local) and the interview simulator migration.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PersonaProfile } from "../src/lib/persona";
import { CandidateBrief } from "../src/lib/candidate";

const Fixture = z.object({
  subjectName: z.string().min(1),
  notes: z.string().nullable(),
  profile: PersonaProfile,
  candidate: CandidateBrief,
});

const FIXTURES_DIR = path.join(process.cwd(), "fixtures", "candidates");

async function loadFixtures() {
  const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(
    files.map(async (file) => {
      const parsed = Fixture.safeParse(JSON.parse(await readFile(path.join(FIXTURES_DIR, file), "utf8")));
      if (!parsed.success) throw new Error(`${file} is invalid:\n${z.prettifyError(parsed.error)}`);
      return { slug: file.replace(/\.json$/, ""), ...parsed.data };
    }),
  );
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const fixtures = await loadFixtures();
  console.log(`Fixtures OK: ${fixtures.map((f) => f.slug).join(", ")}`);
  if (process.argv.includes("--check")) return;

  const email = arg("user");
  if (!email) throw new Error("Pass --user <email> of the account that should own the candidates (or --check)");
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");

  const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = await findUserId(db, email);

  for (const f of fixtures) {
    // The marker in `notes` makes re-runs find the same job instead of creating a new one.
    const marker = `[fixture:${f.slug}]`;
    const existing = await db
      .from("research_jobs")
      .select("id")
      .eq("user_id", userId)
      .like("notes", `${marker}%`)
      .maybeSingle<{ id: string }>();
    if (existing.error) throw existing.error;

    let jobId = existing.data?.id;
    if (!jobId) {
      const job = await db
        .from("research_jobs")
        .insert({ user_id: userId, subject_name: f.subjectName, notes: `${marker} ${f.notes ?? ""}`.trim(), status: "ready" })
        .select("id")
        .single<{ id: string }>();
      if (job.error) throw job.error;
      jobId = job.data.id;
    }

    const persona = await db
      .from("personas")
      .upsert(
        { job_id: jobId, user_id: userId, status: "ready", model: "fixture", profile: f.profile, candidate: f.candidate, error: null },
        { onConflict: "job_id" },
      )
      .select("id")
      .single<{ id: string }>();
    if (persona.error) throw persona.error;

    console.log(`${existing.data ? "updated" : "created"} ${f.subjectName}: job ${jobId}, persona ${persona.data.id}`);
  }
}

async function findUserId(db: SupabaseClient, email: string): Promise<string> {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (user) return user.id;
    if (data.users.length < 1000) throw new Error(`No Supabase user with email ${email}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
