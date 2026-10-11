-- Run ONCE after the two earlier migrations. Adds no incident history.
-- Jobs are deleted after push receipt confirmation, expiry, or token revocation.
begin;
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  caregiver_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  event text not null check (event in ('out_of_bounds','returned_inside','connection_lost','connection_restored')),
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  ticket_id text,
  last_error text
);
create index notification_outbox_due_idx on public.notification_outbox(next_attempt_at);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from public, anon, authenticated;
grant all on public.notification_outbox to service_role;
commit;
