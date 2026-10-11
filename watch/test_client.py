import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from client import PositionSource, apply_reply


class ClientTests(unittest.TestCase):
    def test_source_never_replays_frozen_positions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "position.json"
            path.write_text(json.dumps({"lat": 28, "lng": -81, "battery_percent": 90}))
            source = PositionSource(path)
            self.assertEqual(source.read()["battery_percent"], 90)
            self.assertIsNone(source.read())
            # A NEW measurement may legitimately be at the same coordinates.
            stamp = time.time() - 1
            os.utime(path, (stamp, stamp))
            self.assertIsNotNone(source.read())
            stamp = time.time() - 30
            os.utime(path, (stamp, stamp))
            self.assertIsNone(PositionSource(path).read())

    def test_invalid_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "position.json"
            for data in ({"lat": True, "lng": 0}, {"lat": 91, "lng": 0}, {"lat": 0, "lng": 0, "battery_percent": 101}):
                path.write_text(json.dumps(data))
                self.assertIsNone(PositionSource(path).read())

    def test_failed_actuator_cannot_be_acknowledged(self):
        class Broken:
            def apply(self, on):
                raise OSError("hardware unavailable")
        with self.assertRaises(OSError):
            apply_reply({"config": {"version": 4}, "should_play_audio": True}, Broken())


if __name__ == "__main__":
    unittest.main()
