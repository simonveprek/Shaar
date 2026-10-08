import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { HttpError } from "./http";

/*
 * The database. Real Postgres (PGlite, compiled to WebAssembly) running inside
 * the app and saved to .data/shaar, so Shaar runs on localhost with nothing to
 * install or sign up for. The schema below is applied on first open and is
 * safe to apply again.
 *
 * user_id is the visitor id from the signed cookie (see auth.ts).
 */

const SCHEMA = /* sql */ `
create table if not exists research_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  subject_name  text not null,
  notes         text,
  status        text not null default 'scraping' check (status in ('scraping', 'analyzing', 'ready', 'failed')),
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists research_jobs_user_idx on research_jobs (user_id, created_at desc);

create table if not exists connector_runs (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references research_jobs (id) on delete cascade,
  user_id       text not null,
  platform      text not null,
  target        text not null,
  actor_id      text not null,
  input         jsonb not null default '{}'::jsonb,
  apify_run_id  text unique,
  dataset_id    text,
  status        text not null default 'running' check (status in ('running', 'ingesting', 'succeeded', 'failed')),
  item_count    integer not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists connector_runs_job_idx on connector_runs (job_id);

create table if not exists scraped_items (
  id            bigint generated always as identity primary key,
  job_id        uuid not null references research_jobs (id) on delete cascade,
  run_id        uuid not null references connector_runs (id) on delete cascade,
  user_id       text not null,
  platform      text not null,
  kind          text not null check (kind in ('profile', 'post', 'comment')),
  external_id   text not null,
  url           text,
  author        text,
  text          text,
  posted_at     timestamptz,
  metrics       jsonb not null default '{}'::jsonb,
  media         jsonb not null default '[]'::jsonb,
  data          jsonb not null,
  created_at    timestamptz not null default now(),
  unique (run_id, external_id)
);
create index if not exists scraped_items_job_idx on scraped_items (job_id, platform, kind, posted_at desc);

create table if not exists personas (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null unique references research_jobs (id) on delete cascade,
  user_id               text not null,
  status                text not null default 'generating' check (status in ('generating', 'ready', 'failed')),
  model                 text not null,
  openai_response_id    text,
  profile               jsonb,
  voice_id              text,
  elevenlabs_agent_id   text,
  error                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists interviews (
  id                          uuid primary key default gen_random_uuid(),
  persona_id                  uuid not null references personas (id) on delete cascade,
  user_id                     text not null,
  elevenlabs_conversation_id  text unique,
  status                      text not null default 'pending' check (status in ('pending', 'active', 'done', 'failed')),
  transcript                  jsonb,
  analysis                    jsonb,
  duration_secs               integer,
  created_at                  timestamptz not null default now(),
  ended_at                    timestamptz
);
create index if not exists interviews_persona_idx on interviews (persona_id, created_at desc);

-- Interview simulator: a candidate layer on personas, and difficulty, feelings and feedback on interviews.
alter table personas add column if not exists candidate jsonb;
alter table interviews add column if not exists difficulty text not null default 'realistic'
  check (difficulty in ('friendly', 'realistic', 'tough'));
alter table interviews add column if not exists feelings jsonb not null default '[]'::jsonb;
alter table interviews add column if not exists feedback_status text not null default 'none'
  check (feedback_status in ('none', 'generating', 'ready', 'failed'));
alter table interviews add column if not exists feedback_response_id text;
alter table interviews add column if not exists feedback jsonb;
alter table interviews add column if not exists feedback_error text;

-- Runs over the Apify plan's concurrency limit wait (running, no apify_run_id) and start on a later poll.
alter table connector_runs add column if not exists max_items integer;
alter table connector_runs add column if not exists start_lease timestamptz;

create table if not exists discoveries (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  name          text not null,
  purpose       text,
  status        text not null default 'searching' check (status in ('searching', 'ready', 'failed')),
  apify_run_id  text,
  candidates    jsonb not null default '[]'::jsonb,
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists discoveries_user_idx on discoveries (user_id, created_at desc);
-- Google results read per platform, so the search can say how much it went through.
alter table discoveries add column if not exists scanned jsonb;
`;

// Postgres type ids: timestamptz, timestamp, int8. Timestamps come back as ISO strings and
// big integers as numbers, the same shapes the rest of the code and the JSON API use.
const PARSERS = {
  1184: (v: string) => new Date(v).toISOString(),
  1114: (v: string) => new Date(`${v}Z`).toISOString(),
  20: (v: string) => Number(v),
};

type Store = { db: PGlite; ready: Promise<unknown>; schema: string };
// One database per server process, kept across hot reloads in development.
const global = globalThis as unknown as { __shaar?: Store };

function store(): Store {
  // In development the database outlives hot reloads, so apply the schema again when it has changed.
  // Every statement is "if not exists", so this only ever adds what is missing.
  if (global.__shaar && global.__shaar.schema !== SCHEMA) {
    const { db, ready } = global.__shaar;
    global.__shaar = { db, schema: SCHEMA, ready: ready.then(() => db.exec(SCHEMA)) };
  }
  if (!global.__shaar) {
    // Runtime data, not code: the ignore comment keeps the bundler from tracing the whole project from this path.
    const dir = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || ".data/shaar");
    mkdirSync(path.dirname(dir), { recursive: true });
    const db = new PGlite(dir, { parsers: PARSERS });
    global.__shaar = { db, schema: SCHEMA, ready: db.exec(SCHEMA) };
  }
  return global.__shaar;
}

/** Runs a query and returns its rows. Pass objects for jsonb columns through json(). */
export async function sql<T>(query: string, params: unknown[] = []): Promise<T[]> {
  const { db, ready } = store();
  await ready;
  const result = await db.query<T>(query, params);
  return result.rows;
}

/** The first row, which must exist. */
export async function one<T>(query: string, params: unknown[] = []): Promise<T> {
  const [row] = await sql<T>(query, params);
  if (!row) throw new HttpError(500, "Database returned no row");
  return row;
}

/** The first row, or null. */
export async function maybeOne<T>(query: string, params: unknown[] = []): Promise<T | null> {
  const [row] = await sql<T>(query, params);
  return row ?? null;
}

/** A value for a jsonb parameter. Use with a ::jsonb cast in the query. */
export const json = (value: unknown) => JSON.stringify(value ?? null);

/**
 * `col = $n` pairs for an UPDATE from a patch object. Objects go in as jsonb. Column names come
 * from code, never from a request, so building them into the query is safe.
 */
export function setClause(patch: Record<string, unknown>, start = 1): { set: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts = Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([column, value]) => {
      const isJson = value !== null && typeof value === "object";
      params.push(isJson ? JSON.stringify(value) : value);
      return `${column} = $${start + params.length - 1}${isJson ? "::jsonb" : ""}`;
    });
  return { set: parts.join(", "), params };
}
