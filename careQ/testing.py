import os
from urllib.request import urlopen


server_url = os.environ.get("CARE_Q_URL", "http://172.18.0.2:5000")

with urlopen(f"{server_url}/beep", timeout=5) as response:
	print(response.status, response.read().decode())