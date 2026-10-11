# careQ Architecture

careQ is an Arduino UNO Q application with two cooperating sides:

- The Linux MPU runs Python, Flask, and the Arduino App runtime.
- The MCU runs the Arduino sketch and controls the buzzer on digital pin 9.
- Router Bridge carries commands from Python to the MCU.

## File Responsibilities

### `app.yaml`

Describes the Arduino App to the App CLI, including its name, icon, and purpose.

### `sketch/sketch.ino`

Runs on the MCU. It configures pin 9 as an output, registers the `beep` and
`set_alert` Bridge handlers, and drives the active buzzer.

### `sketch/sketch.yaml`

Defines the MCU build profile and the Arduino Zephyr platform used to compile
and upload the sketch.

### `python/main.py`

Is the Arduino App Python entry point. When the Arduino App CLI starts this app,
it runs `main.py`. The module imports `start_server` from `app.py`, starts the
Flask server in a daemon thread, and then calls `App.run()` to keep the Arduino
App runtime active.

### `app.py`

Defines the shared Flask application, in-memory watch state, state routes, and
hardware routes. It is also responsible for forwarding buzzer commands through
Router Bridge. It does not start the Arduino App runtime; `main.py` calls
`start_server()` during app startup.

### `testing.py`

A simple Linux-side smoke test. It sends an HTTP request to `/alert` and prints
the response. The `CARE_Q_URL` environment variable can override the default
app address.

### `requirements.txt`

Lists Python packages needed for the standalone Flask environment. The Arduino
App runtime installs the packages declared under `python/requirements.txt`.

## Startup and Server Lifecycle

Starting the app with the Arduino App CLI launches `python/main.py`:

1. `main.py` adds the careQ directory to Python's import path and imports
    `start_server` from `app.py`.
2. `start_server()` starts Flask in a daemon thread with
    `host="0.0.0.0"`, `port=5000`, `debug=False`, and
    `use_reloader=False`.
3. `main.py` calls `App.run()`, which keeps the Arduino App process active
    while Flask listens for HTTP requests.
4. Flask handles requests using the routes registered in `app.py`.

The server is reachable on port 5000 from clients that can reach the Linux MPU.
The Flask thread is a daemon thread, so it ends when the Arduino App process
ends.

## HTTP Routes

All routes are registered in `app.py` and are served by the Flask server on
port 5000.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Returns `{"message": "careQ server is running"}`. |
| `GET` | `/health` | Returns `{"status": "ok"}` without accessing hardware. |
| `GET` | `/state` | Returns the current in-memory watch state. |
| `PATCH` | `/state` | Merges a JSON object into the watch state. `location` is merged as a nested object; the known top-level fields are `alert`, `productid`, `voice_message_path`, `wifi_connectivity`, `battery`, and `heartbeat`. Returns HTTP 400 when the body is not a JSON object. |
| `GET` | `/beep` | Calls MCU Bridge method `beep`, which drives pin 9 HIGH for 300 ms, then LOW. |
| `GET` | `/alert?active=true\|false` | Calls MCU Bridge method `set_alert` and updates the in-memory `alert` state. Returns HTTP 400 when `active` is missing or is not exactly `true` or `false`. |

The `/state` data is in memory only and is reset when the Python app restarts.

## Request Flow

### Beep

1. A client requests `GET /beep`.
2. Flask calls `beep()` in `app.py`.
3. `beep()` calls `Bridge.call("beep")`.
4. The MCU's `beep()` handler drives pin 9 HIGH for 300 ms, then LOW.

### Alert

1. A client requests `GET /alert?active=true` or
    `GET /alert?active=false`.
2. Flask validates the `active` query parameter and calls
    `activate_alert(active == "true")`.
3. `activate_alert()` calls `Bridge.call("set_alert", active)` and updates
    `watch_state["alert"]`.
4. The MCU stores the alert state. While enabled, its loop alternates pin 9
    HIGH for 300 ms and LOW for 150 ms until disabled.

### State

1. A client requests `GET /state` to read the current watch state.
2. A client sends `PATCH /state` with a JSON object to update the in-memory
    state. This route does not call the MCU or Router Bridge.

## Running the App

Start the Arduino App with:

```bash
arduino-app-cli app start /home/arduino/ArduinoApps/Rock-Bottom-Girls-/careQ
```

Then run the smoke test from another terminal:

```bash
python3 testing.py
```

Use `arduino-app-cli monitor` to view MCU startup and callback messages.

## Hardware

The active buzzer uses digital pin 9 and a shared ground with the UNO Q.
Disconnect board power before changing wiring. The buzzer should be connected
with its positive input to pin 9 and its negative input to GND.

Backend/device request flow:

    -> Flask /alert?active=true|false
    -> Bridge.call("set_alert", active)
    -> MCU stores alert state
    -> MCU loop plays the alert pattern until disabled