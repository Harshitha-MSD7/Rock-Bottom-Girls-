# Shared monitoring contract

All positions: latitude/longitude degrees. Radius/distance: meters. The caregiver
sets home; changing it replaces the center. Backend timestamps accepted updates.

## Watch

Headers: `X-Device-Id: <product ID>`, `Authorization: Bearer DEVICE_SECRET`.
The product ID is the watch's own ID (`PRODUCT_ID` in `careQ/.env`). Each watch
has its own random secret, set in the backend's `DEVICE_SECRETS_JSON` and on the
watch. A watch is refused (404) until a caregiver pairs it.

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

## Watch update fields

```json
{
  "lat": 28.6024, "lng": -81.2001,
  "boot_id": "a1b2c3d4e5f6", "measurement_seq": 42,
  "battery_percent": 85,
  "applied_settings_version": 7,
  "installed_audio_version": null
}
```

| Field | Meaning |
| --- | --- |
| `lat`, `lng` | Position. Leave both out when there is no new measurement. |
| `boot_id` | Any ID of 8+ letters/digits that changes each time the watch program starts. |
| `measurement_seq` | Counter that goes up by one for every NEW measurement, even if the position is the same. Lets the backend ignore a repeated old reading. |
| `battery_percent` | Optional, 0 to 100. |
| `applied_settings_version` | `config.version` from the previous reply, once that reply's alarm command was applied. |
| `installed_audio_version`, `installed_audio_sha256` | The recording stored on the watch, or `null` if none. |

`latitude`, `longitude` and `battery` are accepted in place of `lat`, `lng` and
`battery_percent`, and the product ID may be sent as `product_id` in the body
instead of the header.

A watch that sends `lat`/`lng` without `boot_id` and `measurement_seq` still
works; the app then shows "location freshness unverified".

The boundary changes only after two readings in a row agree, so an alert starts
about 20 seconds after leaving and clears about 20 seconds after returning.

`watch/reporter.py` does all of this: call `report(lat, lng, measurement_seq,
battery)` every 10 seconds and it sends the update, calls your
`apply_alarm(on, audio_path)` function, and downloads a new recording.

## Patients, profiles and pairing

| Method and path | Body / result |
| --- | --- |
| POST `/api/patients` | `{ "display_name": "Mary" }` → 201 with the new patient, owned by the caller. Home unset, radius 100 m. |
| PATCH `/api/patients/:id` | `{ "display_name", "phone_number", "emergency_contact" }` → updated patient. |
| POST `/api/patients/:id/watch` | `{ "watch_url": "192.168.1.50" }` → `{device_id, product_id, watch_url}`. The backend calls the board's `/setup`. 502 if no board answers there. |
| POST `/api/patients/:id/watch` | Or `{ "product_id": "00000001", "pairing_code": "123456" }` → `{device_id, product_id}`. 400 for a wrong ID or code. |
| DELETE `/api/patients/:id/watch` | Unpairs; 204. |

Pairing codes live in the backend's `DEVICE_PAIRING_CODES_JSON` (product ID →
code). `GET /api/patients` returns a patient with no watch as `device: null`.

## Recorded message

| Method and path | Body / result |
| --- | --- |
| POST `/api/patients/:id/audio` | Raw audio bytes (the phone's recording), `Content-Type: application/octet-stream`, up to 10 MB. Converted to WAV and stored privately. → `{version, sha256, duration_seconds}` |
| GET `/api/patients/:id/audio` | The stored WAV, for playback in the app. |
| GET `/api/watch/audio/:version` | The stored WAV, for the watch (watch headers). 409 if a newer one exists. |

Stored format: WAV, PCM 16-bit, mono, 16000 Hz, 1 to 60 seconds. When a patient
has a recording, every watch reply carries
`config.audio = {version, sha256, download_path, ...}`. The watch downloads it,
checks the SHA-256, keeps it on disk, and reports `installed_audio_version`. The
app shows "Saved on watch" only after that report.

Needs `SUPABASE_SECRET_KEY` in the backend's `.env`; without it these routes
answer 503 "Recording storage is not configured".

## The careQ board (hardware document flow)

This is the flow in the hardware document, and it needs nothing beyond what
`careQ/app.py` already serves plus one outgoing request.

1. **Pair.** The caregiver enters the board's address. The backend calls
   `GET http://<address>:5000/setup` and pairs the `product_id` it returns.
2. **Position.** Every 10 seconds the board sends:

   ```json
   POST /api/watch/updates
   { "product_id": "00000001", "latitude": 28.6024, "longitude": -81.2001, "accuracy": 100 }
   ```

   `battery` is optional. No headers or secret are needed when the backend runs
   with `WATCH_SECRET_REQUIRED=false`.
3. **Alarm.** When the alarm should start or stop, the backend calls
   `GET http://<address>:5000/alert?active=true|false`. The board does not need
   to read the reply to its position update.

Notes for the board:

- `/alert` currently answers 400 to every call while the alarm is on, including
  `active=false`. The backend works around it by sending
  `PATCH /state {"alert": false}` first.
- The backend must be able to reach the board, so both stay on the same network.
  If the board's address changes, unpair and pair again.
- Pause and silence from the app reach the board as an `/alert?active=false` call.
