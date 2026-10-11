-- Switch positions from local x/y meters to latitude/longitude.
-- Run ONCE in Supabase > SQL Editor, after 20261010_current_status.sql.
-- Old x/y values mean nothing as latitude/longitude, so home and the last watch
-- position are cleared. Each caregiver sets home again in the app.
begin;

alter table public.patients rename column boundary_center_x to home_lat;
alter table public.patients rename column boundary_center_y to home_lng;
alter table public.patients
  alter column home_lat drop not null,
  alter column home_lng drop not null,
  -- What the caregiver typed or the lookup returned; a label only.
  add column home_address text check (home_address is null or length(home_address) <= 300);
update public.patients set home_lat = null, home_lng = null;
alter table public.patients add constraint patients_home_check check (
  (home_lat is null and home_lng is null) or
  (home_lat is not null and home_lng is not null
    and home_lat between -90 and 90 and home_lng between -180 and 180)
);

alter table public.devices rename column last_x to last_lat;
alter table public.devices rename column last_y to last_lng;
update public.devices set
  last_lat = null, last_lng = null, last_position_at = null,
  distance_meters = null, boundary_state = 'unknown', alarm_active = false;
alter table public.devices add constraint devices_position_range_check check (
  last_lat is null or (last_lat between -90 and 90 and last_lng between -180 and 180)
);

commit;
