-- Interview simulator: HR practises an interview with a persona playing a job candidate,
-- then gets feedback from the candidate's point of view.

-- Candidate layer of a persona (target role, motivations, concerns, hidden facts …).
-- Kept separate from `profile` so persona generation stays untouched. Shape: CandidateBrief in src/lib/candidate.ts.
alter table public.personas
  add column candidate jsonb;

alter table public.interviews
  add column difficulty text not null default 'realistic'
    check (difficulty in ('friendly', 'realistic', 'tough')),
  -- [{ t, feeling, intensity, reason }] reported by the agent's reportFeeling client tool during the call
  add column feelings jsonb not null default '[]'::jsonb,
  -- none -> generating -> ready | failed
  add column feedback_status text not null default 'none'
    check (feedback_status in ('none', 'generating', 'ready', 'failed')),
  add column feedback_response_id text,
  add column feedback jsonb,
  add column feedback_error text;
