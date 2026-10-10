# Supabase: five-table prototype

The database has patients, caregiver_patients, devices, incidents, and push_tokens.
Supabase Auth manages caregiver passwords separately. Audio files use a private
patient-audio bucket; the database stores their paths.

## New database only

Copy all of simple-schema.sql into Supabase SQL Editor and run once. Confirm five
tables and the private bucket. It stops if tables/bucket already exist. If the team
already ran this SQL, DO NOT rerun it. These local files do not change the live database.
Do not enable automatic database deployment yet: this is a manual bootstrap script,
not a configured CLI migration history.

All coordinates use one fixed LOCAL reference area, in meters. Do not mix in
latitude/longitude without adapting the coordinate contract and distance calculation.

## Access

App users can read only assigned patients, their devices/incidents, and their own
push tokens. All application writes initially go through the Flask backend, which
must authenticate callers and authorize patient membership before server-key writes.
Never disable RLS to get writes working. Supabase organization owners are dashboard
administrators, not automatically caregiver users in Authentication > Users.

Device credentials are not stored in caregiver-readable tables. For the demo, keep
a per-device credential/hash mapping in backend secret configuration. A device UUID
alone is not authentication. Never give the watch or frontend a Supabase server key.

## Behavior still to implement

- Coordinates determine boundary crossings; heartbeat loss is a separate incident.
- A device can have both incident kinds open. Reconnection does not imply return inside.
- Backend sets last_seen_at; last_position_at describes the actual measurement.
- Reject stale/out-of-order coordinates. Stale position means unknown, not safe.
- Settings require device acknowledgment. Read actual settings again on reconnect.
- desired_pause_until is requested; devices.paused_until is confirmed.
- Download/verify audio before replacing the active recording.
- Implement notifications, retries, audio playback, and offline monitoring in code.

The SQL was checked locally with 26 PostgreSQL checks using Auth/Storage stubs,
covering RLS isolation, constraints, and rerun protection. This is not a hosted
integration or device test. Use fictional test data while building the prototype.
