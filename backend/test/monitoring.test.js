const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transition, control, snapshot, validateUpdate } = require('../src/monitoring');
const now = Date.parse('2026-10-10T12:00:00Z');
// Positions are described as meters north of home.
const HOME = { lat: 28.6024, lng: -81.2001 };
const METERS_PER_DEGREE = 111194.9266;
const at = (meters) => ({ lat: HOME.lat + meters / METERS_PER_DEGREE, lng: HOME.lng });
const patient = () => ({
  id: 'p',
  home_lat: HOME.lat,
  home_lng: HOME.lng,
  radius_meters: 10,
  settings_version: 1,
  desired_pause_until: null,
  desired_audio_silenced: false,
});
const device = () => ({
  id: 'd',
  last_seen_at: null,
  last_position_at: null,
  boundary_state: 'unknown',
  connection_state: 'unknown',
  alarm_active: false,
  audio_silenced: false,
  paused_until: null,
  applied_settings_version: 0,
});
test('moving home re-evaluates the latest fresh position against the new center', () => {
  let s = transition(patient(), device(), at(5), now);
  assert.equal(s.device.boundary_state, 'inside');
  const moved = control(
    s.patient,
    s.device,
    { action: 'home', ...at(100), address: '1 Example St' },
    now + 1000,
  );
  assert.equal(moved.settings_version, 2);
  assert.equal(moved.home_address, '1 Example St');
  s = transition(moved, s.device, null, now + 1000);
  assert.equal(s.device.boundary_state, 'outside');
  assert.ok(Math.abs(s.device.distance_meters - 95) < 0.01);
  assert.deepEqual(s.events, ['out_of_bounds']);
  assert.equal(snapshot(s.patient, s.device, now + 1000).config.home_lat, at(100).lat);
  assert.throws(() => control(patient(), device(), { action: 'home', lat: 1 }, now));
  assert.throws(() => control(patient(), device(), { action: 'home', lat: 91, lng: 0 }, now));
});
test('no home set: position is recorded but there is no boundary and no alarm', () => {
  const p = { ...patient(), home_lat: null, home_lng: null };
  const s = transition(p, device(), at(5000), now);
  assert.equal(s.device.connection_state, 'connected');
  assert.equal(s.device.boundary_state, 'unknown');
  assert.equal(s.device.alarm_active, false);
  assert.deepEqual(s.events, []);
  assert.equal(snapshot(s.patient, s.device, now).config.home_lat, null);
});
test('exact radius is inside; outside alert fires once and return clears it', () => {
  let s = transition(patient(), device(), at(9.9), now);
  assert.equal(s.device.boundary_state, 'inside');
  s = transition(s.patient, s.device, at(11), now + 10000);
  assert.deepEqual(s.events, ['out_of_bounds']);
  s = transition(s.patient, s.device, at(12), now + 20000);
  assert.deepEqual(s.events, []);
  s = transition(s.patient, s.device, at(0), now + 30000);
  assert.deepEqual(s.events, ['returned_inside']);
  assert.equal(s.device.alarm_active, false);
});
test('timeout is 60 seconds, not the 5 second check; preserves last outside state', () => {
  const s = transition(patient(), device(), at(20), now);
  assert.equal(
    transition(s.patient, s.device, null, now + 5000).device.connection_state,
    'connected',
  );
  assert.equal(
    transition(s.patient, s.device, null, now + 59999).device.connection_state,
    'connected',
  );
  const lost = transition(s.patient, s.device, null, now + 60000);
  assert.deepEqual(lost.events, ['connection_lost']);
  assert.equal(lost.device.boundary_state, 'outside');
  assert.equal(lost.device.alarm_active, true);
  assert.deepEqual(transition(lost.patient, lost.device, null, now + 65000).events, []);
  assert.deepEqual(transition(lost.patient, lost.device, at(20), now + 70000).events, [
    'connection_restored',
  ]);
});
test('pause is pending until acknowledged; expired pause alerts with fresh outside position', () => {
  let s = transition(patient(), device(), at(20), now);
  const p = control(s.patient, s.device, { action: 'pause', minutes: 1 }, now);
  assert.equal(snapshot(p, s.device, now).settings_pending, true);
  s = transition(
    p,
    s.device,
    { ...at(20), applied_settings_version: p.settings_version },
    now + 10000,
  );
  assert.equal(s.device.alarm_active, false);
  s = transition(s.patient, s.device, at(20), now + 65000);
  assert.deepEqual(s.events, ['out_of_bounds']);
});
test('stale position cannot trigger a new boundary alert on pause expiry', () => {
  let p = patient();
  p.desired_pause_until = new Date(now + 60000).toISOString();
  let s = transition(p, device(), { ...at(20), applied_settings_version: 1 }, now);
  s = transition(s.patient, s.device, null, now + 65000);
  assert.equal(s.device.alarm_active, false);
  assert.deepEqual(s.events, ['connection_lost']);
});
test('silencing needs acknowledgement and resets on return for the next episode', () => {
  let s = transition(patient(), device(), at(20), now);
  s.patient = control(s.patient, s.device, { action: 'silence' }, now);
  assert.equal(snapshot(s.patient, s.device, now).should_play_audio, false);
  assert.equal(s.device.audio_silenced, false); // Command differs from acknowledgement.
  s = transition(s.patient, s.device, { ...at(20), applied_settings_version: 2 }, now + 10000);
  assert.equal(s.device.alarm_active, true);
  assert.equal(snapshot(s.patient, s.device, now + 10000).should_play_audio, false);
  s = transition(s.patient, s.device, at(0), now + 20000);
  assert.equal(s.patient.desired_audio_silenced, false);
  s = transition(s.patient, s.device, at(20), now + 30000);
  assert.equal(snapshot(s.patient, s.device, now + 30000).should_play_audio, true);
});
test('old settings acknowledgements cannot override a new pause', () => {
  const p = control(patient(), device(), { action: 'pause', minutes: 30 }, now);
  const s = transition(p, device(), { ...at(0), applied_settings_version: 1 }, now);
  assert.equal(s.device.paused_until, null);
  assert.equal(snapshot(s.patient, s.device, now).settings_pending, true);
});
test('server receipt timestamps, optional battery, validation, fixed home', () => {
  const p = patient();
  p.home_lat = at(100).lat;
  const s = transition(p, device(), { ...at(100), battery_percent: 85 }, now);
  assert.equal(s.device.last_seen_at, new Date(now).toISOString());
  assert.equal(s.device.last_seen_at, s.device.last_position_at);
  assert.equal(s.device.boundary_state, 'inside');
  assert.equal(transition(s.patient, s.device, at(100), now + 10000).device.battery_percent, 85);
  for (const body of [
    { lat: '1', lng: 0 },
    { lat: NaN, lng: 0 },
    { lat: 1 },
    { lat: 0, lng: 181 },
    { x: 1, y: 2 },
    { ...at(0), battery_percent: 101 },
    { ...at(0), timestamp: 'old' },
  ])
    assert.throws(() => validateUpdate(body));
});
test('never-seen watches are unknown; fresh next position reevaluates radius', () => {
  assert.equal(transition(patient(), device(), null, now).device.connection_state, 'unknown');
  let s = transition(patient(), device(), at(8), now);
  const p = control(s.patient, s.device, { action: 'radius', radius_meters: 5 }, now + 65000);
  s = transition(p, s.device, null, now + 65000);
  assert.equal(s.device.boundary_state, 'inside');
  assert.equal(transition(p, s.device, at(8), now + 70000).device.boundary_state, 'outside');
});
