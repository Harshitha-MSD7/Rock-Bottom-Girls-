-- Additive migration for patient profiles, watch identity, fresh samples and audio.
begin;
alter table public.patients
  add column if not exists phone_number text check(length(phone_number)<=40),
  add column if not exists emergency_contact text check(length(emergency_contact)<=200),
  add column if not exists audio_version uuid,
  add column if not exists audio_sha256 text,
  add column if not exists audio_updated_at timestamptz;
alter table public.devices
  add column if not exists watch_url text,
  add column if not exists product_id text,
  add column if not exists paired boolean not null default true,
  add column if not exists measurement_boot text,
  add column if not exists measurement_seq bigint,
  add column if not exists freshness_verified boolean not null default false,
  add column if not exists candidate_boundary text,
  add column if not exists candidate_count integer not null default 0,
  add column if not exists installed_audio_version uuid;
create unique index if not exists devices_product_id_unique on public.devices(product_id) where product_id is not null;
comment on column public.devices.product_id is 'External ID supplied by the watch; devices.id remains the internal UUID.';
comment on column public.devices.installed_audio_version is 'Watch acknowledgement after downloading, checking SHA256 and persisting the WAV file.';
commit;
