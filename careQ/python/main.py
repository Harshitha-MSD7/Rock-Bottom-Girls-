import sys
from pathlib import Path

from arduino.app_utils import App

sys.path.insert(0, str(Path(__file__).parents[1]))
from app import start_server


start_server()
App.run()
