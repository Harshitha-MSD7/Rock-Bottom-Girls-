# careQ Architecture

careQ is an Arduino UNO Q application with two cooperating sides:

- The Linux MPU runs Python, Flask, and the Arduino App runtime.
- The MCU runs the Arduino sketch and controls the buzzer on digital pin 9.
- Router Bridge carries commands from Python to the MCU.

## File Responsibilities

### `app.yaml`

Describes the Arduino App to the App CLI, including its name, icon, and purpose.

### `sketch/sketch.ino`

Runs on the MCU. It configures pin 9 as an output, registers the `beep` and `alert` Bridge handlers, and drives the active buzzer.

### `sketch/sketch.yaml`

Defines the MCU build profile and the Arduino Zephyr platform used to compile and upload the sketch.

### `python/main.py`

Is the Arduino App Python entry point. It starts Flask, exposes the hardware routes, forwards requests through Router Bridge, and keeps the App runtime active.

### `app.py`

Defines the shared Flask application and basic service routes:

- `GET /` confirms the server is running.
- `GET /health` provides a hardware-independent health check.
- `/beep` and `/alert` are added by `python/main.py` because they need Bridge access.

### `testing.py`

A simple Linux-side smoke test. It sends an HTTP request to `/alert` and prints the response. The `CARE_Q_URL` environment variable can override the default app address.

### `requirements.txt`

Lists Python packages needed by the standalone Flask environment. The Arduino App runtime installs the packages declared under `python/requirements.txt`.

## Request Flow

### Beep

1. A client requests `GET /beep`.
2. Flask calls `Bridge.call("beep")`.
3. The MCU runs `beep()`.
4. Pin 9 goes HIGH for the configured duration, then LOW.

### Alert

1. `testing.py` requests `GET /alert`.
2. Flask calls `Bridge.call("alert")`.
3. The MCU runs `alert()`.
4. The buzzer plays three beeps with short pauses between them.

## Running the App

Start or rebuild the Arduino App with:

```bash
arduino-app-cli app restart /home/arduino/ArduinoApps/Rock-Bottom-Girls-/careQ
```

Then run the smoke test from another terminal:

```bash
python3 testing.py
```

Use `arduino-app-cli monitor` to view MCU startup and callback messages.

## Hardware

The active buzzer uses digital pin 9 and a shared ground with the UNO Q. Disconnect board power before changing wiring. The buzzer should be connected with its positive input to pin 9 and its negative input to GND.
