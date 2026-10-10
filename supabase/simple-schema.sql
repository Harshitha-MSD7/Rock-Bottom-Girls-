-- SIMPLIFIED WEARABLE SCHEMA: five application tables + Supabase Auth.
-- Run this entire file ONCE in Supabase > SQL Editor on a NEW project.
-- This is the accepted five-table schema; do not combine it with an older design.
-- If the earlier schema is already installed, this stops without changing it.
-- Coordinates: one fixed local reference area, x/y in METERS for all devices.
-- Auth handles passwords; never add passwords to these tables.
begin;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name in
      ('patients', 'caregiver_patients', 'devices', 'incidents', 'push_tokens')
  ) then
    raise exception 'Wearable tables already exist. Do not overwrite them. Use a reviewed migration from your existing schema instead.';
  end if;
  if exists (select 1 from storage.buckets where id = 'patient-audio') then
    raise exception 'patient-audio bucket already exists. Review the existing setup before applying this fresh-project script.';
  end if;
end $$;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  boundary_center_x numeric not null check (boundary_center_x between -1000000000 and 1000000000),
  boundary_center_y numeric not null check (boundary_center_y between -1000000000 and 1000000000),
  radius_meters numeric not null check (radius_meters > 0 and radius_meters <= 1000000),
  -- Private Storage object path, not a public URL; NULL until a file is uploaded.
  -- Store files under <patient-uuid>/<unique-filename>.
  audio_storage_path text unique,
  desired_pause_until timestamptz,
  check (audio_storage_path is null or
    (audio_storage_path like id::text || '/%' and length(audio_storage_path) > 37))
);

create table public.caregiver_patients (
  caregiver_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  primary key (caregiver_id, patient_id)
);
create index caregiver_patients_patient_idx on public.caregiver_patients(patient_id);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patients(id) on delete cascade,
  -- Backend receipt time of the last authenticated check-in.
  last_seen_at timestamptz,
  -- Measurement time of the last accepted valid position, not check-in time.
  last_position_at timestamptz,
  last_x numeric check (last_x between -1000000000 and 1000000000),
  last_y numeric check (last_y between -1000000000 and 1000000000),
  -- Actual acknowledged pause; patient.desired_pause_until is only a request.
  paused_until timestamptz,
  audio_silenced boolean not null default false,
  check (
    (last_x is null and last_y is null and last_position_at is null) or
    (last_x is not null and last_y is not null and last_position_at is not null)
  )
);
create index devices_last_seen_idx on public.devices(last_seen_at);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  kind text not null check (kind in ('boundary_exit', 'connection_lost')),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (resolved_at is null or resolved_at >= opened_at)
);
-- Allow both kinds at once, but only one open incident per device AND kind.
create unique index incidents_one_open_per_kind
  on public.incidents(device_id, kind) where resolved_at is null;
create index incidents_device_time_idx on public.incidents(device_id, opened_at desc);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  caregiver_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique check (length(trim(token)) > 0)
);
create index push_tokens_caregiver_idx on public.push_tokens(caregiver_id);

-- Caregiver clients can SELECT their assigned data only.
-- All mutations go through the backend initially (including push registration).
-- Backend must validate user membership/device credentials before service-role writes.
-- Supabase dashboard co-owners are administrators; RLS restricts app users, not them.
do $$
declare t text;
begin
  foreach t in array array['patients', 'caregiver_patients', 'devices', 'incidents', 'push_tokens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

create policy own_assignments on public.caregiver_patients
  for select to authenticated
  using (caregiver_id = (select auth.uid()));

create policy assigned_patients on public.patients
  for select to authenticated
  using (id in (
    select patient_id from public.caregiver_patients
    where caregiver_id = (select auth.uid())
  ));

create policy assigned_devices on public.devices
  for select to authenticated
  using (patient_id in (
    select patient_id from public.caregiver_patients
    where caregiver_id = (select auth.uid())
  ));

create policy assigned_incidents on public.incidents
  for select to authenticated
  using (device_id in (select id from public.devices));

create policy own_push_tokens on public.push_tokens
  for select to authenticated
  using (caregiver_id = (select auth.uid()));

-- Audio is stored outside the database in a PRIVATE bucket (10 MiB per file).
-- Backend uploads initially. Signed-in assigned caregivers may read the files.
insert into storage.buckets(id, name, public, file_size_limit)
  values ('patient-audio', 'patient-audio', false, 10485760);

create policy assigned_audio_read on storage.objects
  for select to authenticated
  using (bucket_id = 'patient-audio' and exists (
    select 1 from public.caregiver_patients cp
    where cp.caregiver_id = (select auth.uid())
      and cp.patient_id::text = (storage.foldername(name))[1]
  ));

commit;

-- NEXT: create test caregiver accounts under Authentication > Users, then
-- insert fictional patient/assignment rows through a trusted backend or SQL Editor.
-- This schema alone does NOT calculate distance, start audio, or send notifications.
-- Device IDs are not credentials: provision device secrets in server-side config.
-- Never give a phone or watch the Supabase service-role/secret key.

