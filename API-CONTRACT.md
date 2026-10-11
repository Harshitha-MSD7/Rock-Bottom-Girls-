# Shared monitoring contract

All positions: latitude/longitude degrees. Radius/distance: meters. The caregiver
sets home; changing it replaces the center. Backend timestamps accepted updates.

## Watch

Headers: `X-Device-Id: devices.id`, `Authorization: Bearer DEVICE_SECRET`.
Provision a separate random secret per device on the server and watch.

`POST /api/watch/updates` every 10 seconds, only for a fresh measurement:

```json
{"lat":28.6024,"lng":-81.2001,"battery_percent":85,"applied_settings_version":2}
```

Only lat/lng are required. Battery and settings acknowledgement are optional.
No timestamp, x/y or user ID. Never resubmit a frozen sample as fresh.

Response includes `config` (version, home_lat, home_lng, radius_meters,
pause_until, audio_silenced, send_interval_seconds) and `should_play_audio`.
Apply the command first, then acknowledge that version in the NEXT update.
An old acknowledgement never applies newer settings. `GET /api/watch/config`
returns the same snapshot but does not refresh last-seen or acknowledge settings.

## Caregiver

Header: `Authorization: Bearer SUPABASE_ACCESS_TOKEN`.

| Method and path | Body / result |
| --- | --- |
| GET `/api/patients` | Assigned patient/device snapshots only |
| POST `/api/geocode` | `{ "address": "street, city, state" }` → `{lat,lng,address}`; does not save |
| POST `/api/patients/:id/control` | One control below; returns updated snapshot |
| POST `/api/push-tokens` | `{ "token": "ExponentPushToken[...]" }`; 204 |
| DELETE `/api/push-tokens` | Same body; 204 |

Controls:

```json
{"action":"home","lat":28.6024,"lng":-81.2001,"address":"Confirmed home"}
{"action":"radius","radius_meters":100}
{"action":"pause","minutes":30}
{"action":"resume"}
{"action":"silence"}
{"action":"unsilence"}
```

Address-only home control remains supported for older clients but saves the first
match immediately. New UI uses lookup → confirmation → exact-coordinate control.

Snapshots contain patient, device (null if unpaired), location_stale,
pause_active, settings_pending, server_time, config and should_play_audio.
`connection_state`: unknown/connected/lost. `boundary_state`: unknown/inside/outside.
Disconnected preserves the last boundary result; it does not imply inside.
Desired settings on patient may differ from acknowledged settings on device.
`should_play_audio` is a command, not proof that sound is physically playing.

No updates for 60 seconds → connection_lost; checker runs every 5 seconds.
Boundary evaluated on each valid update and on settings changes if location is
fresh. Transition notifications: out_of_bounds, returned_inside,
connection_lost, connection_restored. Repeated outside updates do not create
another alert. Pause expiry can start a new alert when outside and position fresh.
Silence suppresses audio for the outside episode and resets on return.

Errors: JSON `{ "error": "message" }`; 400 invalid body, 401 invalid credentials,
403 unassigned patient, 404 missing record/address, 409 unpaired/conflict,
429 lookup busy, 500/503 service unavailable. Old fake `/api/device/*` and
`/api/watch/status` APIs no longer provide sample status.
