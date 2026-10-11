"""UNO Q Linux reference client. No dependencies; see README.md before use."""
import json
import math
import os
from pathlib import Path
import threading
import time
from urllib.request import Request, urlopen

SEND_INTERVAL_SECONDS = 10


class PositionSource:
    def __init__(self, path="position.json"):
        self.path = Path(path)
        self.previous = None

    def read(self):
        """Read each fresh producer update once. Stationary NEW samples are valid."""
        try:
            with self.path.open() as stream:
                stat = os.fstat(stream.fileno())
                stamp = (stat.st_mtime_ns, stat.st_size)
                if stamp == self.previous or not 0 <= time.time() - stat.st_mtime <= 20:
                    return None
                data = json.load(stream)
            result = {}
            for key, limit in (("lat", 90), ("lng", 180)):
                value = data[key]
                if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > limit:
                    return None
                result[key] = value
            if "battery_percent" in data:
                value = data["battery_percent"]
                if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 100:
                    return None
                result["battery_percent"] = value
            self.previous = stamp
            return result
        except (OSError, ValueError, KeyError, TypeError):
            return None


class Alarm:
    """Demo output, or repeated calls to the existing discrete buzzer endpoint.

    Stopping prevents new beeps; the hardware endpoint cannot cancel a beep that
    is already playing. This is NOT prerecorded message playback.
    """
    def __init__(self, url=None):
        self.url = url
        self.on = False
        self.healthy = True
        self.lock = threading.Lock()
        self.closed = threading.Event()
        self.thread = threading.Thread(target=self._repeat, daemon=True)
        self.thread.start()

    def _beep(self):
        if self.url:
            with urlopen(self.url, timeout=2) as response:
                if response.status != 200:
                    raise OSError("Buzzer rejected command")

    def apply(self, on):
        if type(on) is not bool:
            raise ValueError("Invalid alarm command")
        with self.lock:
            if on and (not self.on or not self.healthy):
                self._beep()  # Do not acknowledge an actuator command that failed.
            if on != self.on:
                print(("BUZZER" if self.url else "DEMO") + (" ON" if on else " OFF"))
            self.on = on
            self.healthy = True

    def _repeat(self):
        while not self.closed.wait(3):
            with self.lock:
                if self.on and self.url:
                    try:
                        self._beep()
                        self.healthy = True
                    except OSError:
                        self.healthy = False
                        print("Buzzer unavailable")

    def close(self):
        self.closed.set()
        self.thread.join(timeout=3)


def exchange(base, headers, position, applied_version):
    body = None
    path = "/api/watch/config"
    if position is not None:
        body = dict(position)
        if applied_version is not None:
            body["applied_settings_version"] = applied_version
        body = json.dumps(body).encode()
        path = "/api/watch/updates"
    with urlopen(Request(base + path, data=body, headers=headers), timeout=5) as response:
        return json.load(response)


def apply_reply(reply, alarm):
    version = reply["config"]["version"]
    if type(version) is not int or version < 0:
        raise ValueError("Invalid settings version")
    alarm.apply(reply["should_play_audio"])
    return version


def main():
    base = os.environ["API_URL"].rstrip("/")
    headers = {"Content-Type": "application/json", "X-Device-Id": os.environ["DEVICE_ID"],
               "Authorization": "Bearer " + os.environ["DEVICE_SECRET"]}
    source = PositionSource(os.environ.get("POSITION_FILE", "position.json"))
    alarm = Alarm(os.environ.get("WATCH_ALERT_URL"))
    applied = None
    print("Mode:", "discrete buzzer" if alarm.url else "console demonstration (no audio hardware)")
    try:
        while True:
            started = time.monotonic()
            position = source.read()
            if position is None:
                print("No fresh position; fetching settings without refreshing last seen")
            try:
                reply = exchange(base, headers, position, applied if alarm.healthy else None)
                applied = apply_reply(reply, alarm)
            except (OSError, ValueError, KeyError, TypeError):
                # Keep the previous output; don't claim fresh position or settings.
                print("Backend or actuator unavailable; previous output retained")
            time.sleep(max(0, SEND_INTERVAL_SECONDS - (time.monotonic() - started)))
    except KeyboardInterrupt:
        pass
    finally:
        alarm.close()


if __name__ == "__main__":
    main()
