-- Projstalker core schema.
-- The backend writes with the secret (service role) key; the frontend may read
-- its own rows directly (and subscribe via Realtime) thanks to the RLS policies below.

create extension if not exists pgcrypto;

-- A research job = one subject (person) researched across one or more platforms.
create table public.research_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  subject_name  text not null,
  notes         text,
  -- scraping -> analyzing -> ready | failed
  status        text not null default 'scraping'
                check (status in ('scraping', 'analyzing', 'ready', 'failed')),
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index research_jobs_user_idx on public.research_jobs (user_id, created_at desc);

-- One Apify actor run per (job, platform, target).
create table public.connector_runs (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.research_jobs (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  platform      text not null,
  target        text not null,
  actor_id      text not null,
  input         jsonb not null default '{}'::jsonb,
  apify_run_id  text unique,
  dataset_id    text,
  -- running -> ingesting -> succeeded | failed
  status        text not null default 'running'
                check (status in ('running', 'ingesting', 'succeeded', 'failed')),
  item_count    integer not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index connector_runs_job_idx on public.connector_runs (job_id);

-- Normalized items scraped by connectors (profiles and posts). `data` keeps the raw Apify item.
create table public.scraped_items (
  id            bigint generated always as identity primary key,
  job_id        uuid not null references public.research_jobs (id) on delete cascade,
  run_id        uuid not null references public.connector_runs (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
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
create index scraped_items_job_idx on public.scraped_items (job_id, platform, kind, posted_at desc);

-- The AI-generated persona of the researched subject.
create table public.personas (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null unique references public.research_jobs (id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,
  -- generating -> ready | failed
  status                text not null default 'generating'
                        check (status in ('generating', 'ready', 'failed')),
  model                 text not null,
  openai_response_id    text,
  profile               jsonb,
  voice_id              text,
  elevenlabs_agent_id   text,
  error                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- A simulated voice interview with a persona (an ElevenLabs agent conversation).
create table public.interviews (
  id                          uuid primary key default gen_random_uuid(),
  persona_id                  uuid not null references public.personas (id) on delete cascade,
  user_id                     uuid not null references auth.users (id) on delete cascade,
  elevenlabs_conversation_id  text unique,
  -- pending -> active -> done | failed
  status                      text not null default 'pending'
                              check (status in ('pending', 'active', 'done', 'failed')),
  transcript                  jsonb,
  analysis                    jsonb,
  duration_secs               integer,
  created_at                  timestamptz not null default now(),
  ended_at                    timestamptz
);
create index interviews_persona_idx on public.interviews (persona_id, created_at desc);

-- updated_at bookkeeping
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger research_jobs_touch before update on public.research_jobs
  for each row execute function public.touch_updated_at();
create trigger personas_touch before update on public.personas
  for each row execute function public.touch_updated_at();

-- Row level security: users can read their own rows. All writes go through the backend.
alter table public.research_jobs  enable row level security;
alter table public.connector_runs enable row level security;
alter table public.scraped_items  enable row level security;
alter table public.personas       enable row level security;
alter table public.interviews     enable row level security;

create policy "own rows" on public.research_jobs  for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows" on public.connector_runs for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows" on public.scraped_items  for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows" on public.personas       for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows" on public.interviews     for select to authenticated using (user_id = (select auth.uid()));

-- Let the frontend subscribe to live progress.
alter publication supabase_realtime add table public.research_jobs, public.connector_runs, public.personas, public.interviews;
