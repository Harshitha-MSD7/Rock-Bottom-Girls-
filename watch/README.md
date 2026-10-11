# UNO Q Linux reference client

`client.py` uses Python's standard library. Set API_URL, DEVICE_ID and
DEVICE_SECRET in the watch environment, then run `python3 client.py`.

The positioning producer must atomically replace `position.json` with a NEW
measurement at least every 10 seconds. Its shape is {"lat":28.6024,"lng":-81.2001}
with optional battery_percent (0–100). Do not put timestamps in the API body.
The client checks local file age (20 seconds maximum) and never sends the same
file revision twice. The backend records receipt time, not measurement time.

A missing/frozen/invalid file stops position uploads. Config polling continues
so controls can reach the watch, but does not fake a fresh position. The backend
will show disconnected after 60 seconds without an accepted position. A new
stationary measurement with identical coordinates is valid.

By default this is a CONSOLE DEMO and does not play audio. Optionally set
WATCH_ALERT_URL=http://127.0.0.1:5000/alert to use the existing careQ hardware
service. That service must be running on the board. The adapter repeats its
three-beep command while alerting; off stops scheduling new commands but cannot
interrupt a beep already playing. It does not implement recorded speech.
No files in careQ need to be changed by this reference client.

A successful actuator command is applied before the version is acknowledged on
the next position update. In console mode acknowledgements demonstrate software
flow only. When the backend is unreachable the last output is retained; a new
boundary crossing cannot be detected by this backend-driven client while offline.
Config polling does not acknowledge a setting until a fresh position is sent.

Run tests: python3 -B -m unittest discover -s . -p "test_*.py"
Do not commit credentials, real patient data or generated position files.
