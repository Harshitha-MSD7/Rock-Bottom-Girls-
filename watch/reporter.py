"""Import this helper from the hardware app; it never modifies careQ/.

Call report() every ten seconds. Increment measurement_seq only after acquiring
a NEW geolocation measurement, even if its coordinates have not moved.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import uuid
from urllib.request import Request, urlopen


class WatchReporter:
    def __init__(self, api_url, product_id, secret, apply_alarm, data_dir="watch-data"):
        self.base = api_url.rstrip("/")
        self.headers = {"X-Device-Id": product_id, "Authorization": "Bearer " + secret,
                        "Content-Type": "application/json"}
        self.apply_alarm = apply_alarm
        self.directory = Path(data_dir).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.boot_id = uuid.uuid4().hex
        self.applied = None
        self.installed = None
        try:
            metadata = json.loads((self.directory / "installed.json").read_text())
            uuid.UUID(metadata["version"])
            file = self.directory / (metadata["version"] + ".wav")
            if hashlib.sha256(file.read_bytes()).hexdigest() == metadata["sha256"]:
                self.installed = metadata
        except (OSError, ValueError, KeyError):
            pass

    def _install(self, audio):
        if not audio or (self.installed and self.installed["version"] == audio["version"]):
            return
        version, digest = audio["version"], audio["sha256"]
        if not re.fullmatch(r"[a-fA-F0-9-]{36}", version) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid recording metadata")
        request = Request(self.base + "/api/watch/audio/" + version, headers=self.headers)
        with urlopen(request, timeout=15) as response:
            data = response.read(2_100_001)
        if len(data) > 2_100_000 or data[:4] != b"RIFF" or data[8:12] != b"WAVE" or hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("Recording checksum or format failed")
        temporary = self.directory / "message.tmp"
        with temporary.open("wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.directory / (version + ".wav"))
        metadata = {"version": version, "sha256": digest}
        temporary = self.directory / "installed.tmp"
        with temporary.open("w") as stream:
            json.dump(metadata, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.directory / "installed.json")
        previous = self.installed
        self.installed = metadata
        if previous and previous["version"] != version:
            try:
                (self.directory / (previous["version"] + ".wav")).unlink(missing_ok=True)
            except OSError:
                pass

    def audio_path(self):
        return str(self.directory / (self.installed["version"] + ".wav")) if self.installed else None

    def report(self, lat=None, lng=None, measurement_seq=None, battery=None):
        body = {}
        if lat is not None and lng is not None:
            if measurement_seq is None:
                raise ValueError("A fresh measurement counter is required")
            body.update(lat=lat, lng=lng, boot_id=self.boot_id, measurement_seq=measurement_seq)
        if battery is not None:
            body["battery_percent"] = battery
        if self.applied is not None:
            body["applied_settings_version"] = self.applied
        if self.installed:
            body.update(installed_audio_version=self.installed["version"], installed_audio_sha256=self.installed["sha256"])
        else:
            body["installed_audio_version"] = None
        request = Request(self.base + "/api/watch/updates", data=json.dumps(body).encode(), headers=self.headers)
        with urlopen(request, timeout=5) as response:
            reply = json.load(response)
        # Alarm controls must still apply if downloading a replacement fails.
        self.apply_alarm(reply["should_play_audio"], self.audio_path())
        self.applied = reply["config"]["version"]
        previous = self.installed
        try:
            self._install(reply["config"].get("audio"))
        except (OSError, ValueError, KeyError):
            print("Recording not replaced; previous copy retained")
        if self.installed != previous:
            self.apply_alarm(reply["should_play_audio"], self.audio_path())
        return reply
