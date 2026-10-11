import os
import threading
from pathlib import Path

from arduino.app_utils import Bridge
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv(Path(__file__).resolve().parent / ".env")
PRODUCT_ID = os.environ["PRODUCT_ID"]

app = Flask(__name__)

##########################
# STATES

watch_state = {
    "setup": False,
    "location": {
        "latitude": None,
        "longitude": None,
    },
    "alert": False,
    "productid": None,
    "voice_message_path": None,
    "wifi_connectivity": False,
    "battery": None,
    "heartbeat": False,
}

def get_watch_state():
    return watch_state

def update_watch_state(values):
    location = values.get("location")
    if isinstance(location, dict):
        watch_state["location"].update(location)

    for field_name in (
        "alert",
        "productid",
        "voice_message_path",
        "wifi_connectivity",
        "battery",
        "heartbeat",
    ):
        if field_name in values:
            watch_state[field_name] = values[field_name]

    return watch_state

##########################
# HARDWARE FUNCTIONS

# beep once
def beep():
    Bridge.call("beep")
    return {"status": "beep sent"}, 200

# activate alert
def activate_alert(active):
    # alert is already running
    if watch_state["alert"]:
        return {"error": "alert is already active"}, 400

    # if we have a voice message saved
    watch_state["alert"] = active
    if watch_state["voice_message_path"]:
        # VOICE TO DO
        return

    # if alert is not running or there's no voice message, run the beeper
    Bridge.call("set_alert", active)

    return {"status": "alert enabled"}, 200

##########################
# ROUTES

@app.get("/state")
def state():
    return jsonify(get_watch_state())

@app.patch("/state")
def update_state():
    values = request.get_json(silent=True)
    if not isinstance(values, dict):
        return {"error": "request body must be a JSON object"}, 400
    return jsonify(update_watch_state(values))

# beep once route
@app.get("/beep")
def beep_route():
    return beep()

# start or stop alert route
@app.get("/alert")
def alert():
    active = request.args.get("active")
    if active not in ("true", "false"):
        return {"error": "active must be true or false"}, 400

    return activate_alert(active == "true")

@app.get("/")
def index():
    # Basic endpoint used to confirm that the web server is reachable.
    return {"message": "careQ server is running"}


@app.get("/health")
def health():
    # Lightweight health check that does not touch the hardware.
    return {"status": "ok"}

@app.get("/setup")
def setup():
    watch_state["setup"] = True

    return {
        "product_id": PRODUCT_ID,
        "states": get_watch_state(),
        "message": "careQ server is running"
    }

##########################
# START THE SERVER
def start_server():
    threading.Thread(
        target=lambda: app.run(
            host="0.0.0.0", port=5000, debug=False, use_reloader=False
        ),
        daemon=True,
    ).start()

if __name__ == "__main__":
    start_server()