-- Name → profile discovery. A web search per platform for the typed name; the
-- visitor confirms which found profiles are really the person before any scraping.
create table public.discoveries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  purpose       text,
  -- searching -> ready | failed
  status        text not null default 'searching'
                check (status in ('searching', 'ready', 'failed')),
  apify_run_id  text,
  candidates    jsonb not null default '[]'::jsonb,
  error         text,
  created_at    timestamptz not null default now()
);
create index discoveries_user_idx on public.discoveries (user_id, created_at desc);

alter table public.discoveries enable row level security;
create policy "own rows" on public.discoveries for select to authenticated using (user_id = (select auth.uid()));
