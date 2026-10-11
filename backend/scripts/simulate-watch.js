// Pretend to be a watch. Run from the backend folder.
//
// Demo walk: start at home, walk out to twice the radius, then come back.
//   node --env-file=.env scripts/simulate-watch.js <device-id> walk
//
// Stay at one distance from home (in meters, heading north):
//   node --env-file=.env scripts/simulate-watch.js <device-id> 20
//
// Stay at an exact position:
//   node --env-file=.env scripts/simulate-watch.js <device-id> 28.6024 -81.2001
//
// "walk" and a distance need home to be set in the app first.
// Press Ctrl+C to stop sending; after 60 seconds the app shows "Disconnected".
const { SEND_INTERVAL_SECONDS } = require('../src/monitoring');

const METERS_PER_DEGREE_LATITUDE = 111195;
// Fractions of the radius visited by "walk", one step per update.
const WALK = [0, 0.4, 0.8, 1.2, 1.6, 2, 2, 1.6, 1.2, 0.8, 0.4, 0];
const WALK_INTERVAL_SECONDS = SEND_INTERVAL_SECONDS;

const [deviceId, first, second] = process.argv.slice(2);
if (!deviceId || first === undefined) {
  console.error('Usage: simulate-watch.js <device-id> walk | <meters> | <lat> <lng>');
  process.exit(1);
}
const secret = JSON.parse(process.env.DEVICE_SECRETS_JSON || '{}')[deviceId];
if (!secret) {
  console.error(`No secret for ${deviceId} in DEVICE_SECRETS_JSON`);
  process.exit(1);
}

const base = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}`;
const headers = {
  'Content-Type': 'application/json',
  'X-Device-Id': deviceId,
  Authorization: `Bearer ${secret}`,
};

async function call(path, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error}`);
  return result;
}

// A real watch echoes back the settings version it has applied; so do we.
let config;

async function send(position, label) {
  try {
    const body = { ...position };
    if (config) body.applied_settings_version = config.version;
    const result = await call('/api/watch/updates', body);
    config = result.config;
    const distance = result.device.distance_meters;
    console.log(
      `${label} -> ${result.device.boundary_state}` +
        (distance === null ? '' : `, ${Number(distance).toFixed(0)} m from home`) +
        `, buzzer ${result.should_play_audio ? 'ON' : 'off'}`,
    );
  } catch (error) {
    console.error('Update failed:', error.message);
  }
}

function northOfHome(meters) {
  return { lat: config.home_lat + meters / METERS_PER_DEGREE_LATITUDE, lng: config.home_lng };
}

async function repeat(tick, seconds) {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    await tick();
  }
}

async function main() {
  if (second !== undefined) {
    const position = { lat: Number(first), lng: Number(second) };
    const tick = () => send(position, `at ${position.lat}, ${position.lng}`);
    await tick();
    void repeat(tick, SEND_INTERVAL_SECONDS);
    return;
  }

  config = (await call('/api/watch/config')).config;
  if (config.home_lat === null) {
    console.error('Home is not set for this patient yet. Set it in the app first.');
    process.exit(1);
  }

  if (first === 'walk') {
    let step = 0;
    const tick = () => {
      const meters = WALK[step % WALK.length] * config.radius_meters;
      step += 1;
      return send(northOfHome(meters), `walking, ${meters.toFixed(0)} m out`);
    };
    await tick();
    void repeat(tick, WALK_INTERVAL_SECONDS);
    return;
  }

  const meters = Number(first);
  const tick = () => send(northOfHome(meters), `holding at ${meters} m`);
  await tick();
  void repeat(tick, SEND_INTERVAL_SECONDS);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
