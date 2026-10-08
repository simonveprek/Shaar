-- Covering indexes for user_id foreign keys (speeds up cascading deletes of auth users).
create index connector_runs_user_idx on public.connector_runs (user_id);
create index scraped_items_user_idx on public.scraped_items (user_id);
create index personas_user_idx on public.personas (user_id);
create index interviews_user_idx on public.interviews (user_id);
