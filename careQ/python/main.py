import sys
import threading
from pathlib import Path

from arduino.app_utils import App, Bridge

sys.path.insert(0, str(Path(__file__).parents[1]))
from app import app


# Forward HTTP requests to functions registered by the MCU sketch.
@app.get("/beep")
def beep():
    Bridge.call("beep")
    return {"status": "beep sent"}


@app.get("/alert")
def alert():
    Bridge.call("alert")
    return {"status": "alert sent"}


def run_server():
    # The Flask server runs in a thread while App.run keeps the Bridge alive.
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)


threading.Thread(target=run_server, daemon=True).start()
App.run()
