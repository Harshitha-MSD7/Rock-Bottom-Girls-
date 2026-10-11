-- Existing-project migration. Run ONCE after backing up the database.
-- No cloud changes are made merely by saving this file.
begin;
do $$
begin
  if exists (select 1 from public.incidents limit 1) then
    raise exception 'Incidents contains history. Export it and explicitly decide how to archive/remove it before this migration.';
  end if;
end $$;
drop table public.incidents;
alter table public.patients
  add column desired_audio_silenced boolean not null default false,
  add column settings_version integer not null default 1 check (settings_version > 0);
alter table public.devices
  add column battery_percent numeric check (battery_percent between 0 and 100),
  add column distance_meters double precision,
  add column boundary_state text not null default 'unknown' check (boundary_state in ('unknown','inside','outside')),
  add column connection_state text not null default 'unknown' check (connection_state in ('unknown','connected','lost')),
  add column applied_settings_version integer not null default 0 check (applied_settings_version >= 0),
  add column alarm_active boolean not null default false;
comment on column public.devices.last_position_at is 'Server receipt time of the latest fresh valid watch coordinates; watch sends no timestamp.';
-- Existing RLS policies and table grants stay in force for the added columns.
commit;
