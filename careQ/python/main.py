import sys
import threading
from pathlib import Path

from arduino.app_utils import App, Bridge

sys.path.insert(0, str(Path(__file__).parents[1]))
from app import app


@app.get("/beep")
def beep():
    Bridge.call("beep")
    return {"status": "beep sent"}


def run_server():
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)


threading.Thread(target=run_server, daemon=True).start()
App.run()
