const SEND_INTERVAL_SECONDS = 10;
const DISCONNECT_AFTER_SECONDS = 60;
const CHECK_INTERVAL_MS = 5000;

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function number(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail(`${name} must be a number between ${min} and ${max}`);
  return value;
}
// Great-circle distance in meters between two latitude/longitude points.
function distanceMeters(lat1, lng1, lat2, lng2) {
  const EARTH_RADIUS_METERS = 6371000;
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
// Home is optional: until the caregiver sets it, there is no boundary to check.
const hasHome = (patient) => patient.home_lat != null && patient.home_lng != null;
function validateUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Expected a JSON object');
  for (const key of Object.keys(body))
    if (!['lat', 'lng', 'battery_percent', 'applied_settings_version'].includes(key))
      fail(`Unexpected field: ${key}`);
  number(body.lat, 'lat', -90, 90);
  number(body.lng, 'lng', -180, 180);
  if (body.battery_percent !== undefined) number(body.battery_percent, 'battery_percent', 0, 100);
  if (
    body.applied_settings_version !== undefined &&
    (!Number.isSafeInteger(body.applied_settings_version) || body.applied_settings_version < 0)
  )
    fail('Invalid applied_settings_version');
  return body;
}
const time = (value) => (value ? new Date(value).getTime() : 0);
function config(patient) {
  return {
    version: patient.settings_version,
    home_lat: hasHome(patient) ? Number(patient.home_lat) : null,
    home_lng: hasHome(patient) ? Number(patient.home_lng) : null,
    radius_meters: Number(patient.radius_meters),
    pause_until: patient.desired_pause_until,
    audio_silenced: patient.desired_audio_silenced,
    send_interval_seconds: SEND_INTERVAL_SECONDS,
  };
}

// Pure state transition: caller serializes updates and supplies server receipt time.
function transition(patientInput, deviceInput, update, now) {
  const patient = { ...patientInput },
    device = { ...deviceInput },
    events = [];
  const before = { ...device };
  if (update) {
    validateUpdate(update);
    device.last_seen_at = new Date(now).toISOString();
    device.last_position_at = device.last_seen_at;
    device.last_lat = update.lat;
    device.last_lng = update.lng;
    if (update.battery_percent !== undefined) device.battery_percent = update.battery_percent;
    // Only acknowledge the exact currently requested settings. Old replies cannot
    // make a newer request appear applied.
    if (update.applied_settings_version === patient.settings_version) {
      device.applied_settings_version = patient.settings_version;
      device.paused_until = patient.desired_pause_until;
      device.audio_silenced = patient.desired_audio_silenced;
    }
  }
  const fresh =
    !!device.last_position_at &&
    now - time(device.last_position_at) < DISCONNECT_AFTER_SECONDS * 1000;
  device.connection_state = !device.last_seen_at
    ? 'unknown'
    : now - time(device.last_seen_at) >= DISCONNECT_AFTER_SECONDS * 1000
      ? 'lost'
      : 'connected';
  // Never recalculate from a stale position, including after a radius change.
  if (fresh && !hasHome(patient)) {
    device.distance_meters = null;
    device.boundary_state = 'unknown';
  } else if (fresh) {
    device.distance_meters = distanceMeters(
      Number(patient.home_lat),
      Number(patient.home_lng),
      Number(device.last_lat),
      Number(device.last_lng),
    );
    device.boundary_state =
      device.distance_meters > Number(patient.radius_meters) ? 'outside' : 'inside';
    if (
      device.boundary_state === 'inside' &&
      (patient.desired_audio_silenced || device.audio_silenced)
    ) {
      patient.desired_audio_silenced = false;
      patient.settings_version += 1;
      device.audio_silenced = false;
    }
  }
  const paused = time(device.paused_until) > now;
  // When a pause expires without fresh location, wait for a fresh reading before
  // starting a new boundary alert. Preserve an existing active outside alert.
  device.alarm_active = fresh
    ? device.boundary_state === 'outside' && !paused
    : before.alarm_active && !paused;
  if (!before.alarm_active && device.alarm_active) events.push('out_of_bounds');
  if (before.boundary_state === 'outside' && device.boundary_state === 'inside')
    events.push('returned_inside');
  if (before.connection_state !== 'lost' && device.connection_state === 'lost')
    events.push('connection_lost');
  if (before.connection_state === 'lost' && device.connection_state === 'connected')
    events.push('connection_restored');
  return { patient, device, events };
}

function control(patientInput, device, body, now) {
  const patient = { ...patientInput };
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Expected a JSON object');
  const allowed =
    body.action === 'radius'
      ? ['action', 'radius_meters']
      : body.action === 'pause'
        ? ['action', 'minutes']
        : body.action === 'home'
          ? ['action', 'lat', 'lng', 'address']
          : ['action'];
  for (const key of Object.keys(body)) if (!allowed.includes(key)) fail(`Unexpected field: ${key}`);
  switch (body.action) {
    // Move the center the radius is measured from. The address is only a label.
    case 'home':
      patient.home_lat = number(body.lat, 'lat', -90, 90);
      patient.home_lng = number(body.lng, 'lng', -180, 180);
      if (
        body.address !== undefined &&
        (typeof body.address !== 'string' || body.address.length > 300)
      )
        fail('Invalid address');
      patient.home_address = body.address ?? null;
      break;
    case 'radius':
      patient.radius_meters = number(body.radius_meters, 'radius_meters', 1, 1000000);
      break;
    case 'pause':
      patient.desired_pause_until = new Date(
        now + number(body.minutes, 'minutes', 1, 240) * 60000,
      ).toISOString();
      break;
    case 'resume':
      patient.desired_pause_until = null;
      break;
    case 'silence':
      if (device.boundary_state !== 'outside')
        fail('Audio can be silenced only for an outside episode', 409);
      patient.desired_audio_silenced = true;
      break;
    case 'unsilence':
      patient.desired_audio_silenced = false;
      break;
    default:
      fail('Unknown action');
  }
  patient.settings_version += 1;
  return patient;
}

function snapshot(patient, device, now) {
  const requestedPauseActive = time(patient.desired_pause_until) > now;
  return {
    patient,
    device,
    location_stale: !device.last_position_at || now - time(device.last_position_at) >= 60000,
    pause_active: time(device.paused_until) > now,
    settings_pending: patient.settings_version !== device.applied_settings_version,
    // Command applies the REQUESTED settings. The persisted applied fields above
    // remain unchanged until the watch acknowledges actually applying this command.
    should_play_audio:
      hasHome(patient) &&
      device.boundary_state === 'outside' &&
      !requestedPauseActive &&
      !patient.desired_audio_silenced &&
      (device.alarm_active ||
        (!!device.last_position_at && now - time(device.last_position_at) < 60000)),
    server_time: new Date(now).toISOString(),
    config: config(patient),
  };
}
module.exports = {
  transition,
  control,
  snapshot,
  validateUpdate,
  distanceMeters,
  fail,
  SEND_INTERVAL_SECONDS,
  DISCONNECT_AFTER_SECONDS,
  CHECK_INTERVAL_MS,
};
