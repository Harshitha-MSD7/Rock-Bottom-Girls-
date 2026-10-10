from flask import Flask

# Flask owns the HTTP routes; the Arduino App entry point adds Bridge-backed routes.
app = Flask(__name__)


@app.get("/")
def index():
    # Basic endpoint used to confirm that the web server is reachable.
    return {"message": "careQ server is running"}


@app.get("/health")
def health():
    # Lightweight health check that does not touch the hardware.
    return {"status": "ok"}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
    
