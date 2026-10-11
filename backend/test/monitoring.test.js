const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transition, control, snapshot, validateUpdate } = require('../src/monitoring');
const home = { lat: 28.6024, lng: -81.2001 };
const at = (m) => ({ lat: home.lat + m / 111194.9266, lng: home.lng });
function setup() {
  let now = Date.parse('2026-10-10T12:00:00Z'),
    seq = 0;
  let s = {
    patient: {
      id: 'p',
      home_lat: home.lat,
      home_lng: home.lng,
      radius_meters: 10,
      settings_version: 1,
      desired_pause_until: null,
      desired_audio_silenced: false,
    },
    device: {
      id: 'd',
      last_seen_at: null,
      last_position_at: null,
      boundary_state: 'unknown',
      connection_state: 'unknown',
      alarm_active: false,
      audio_silenced: false,
      paused_until: null,
      applied_settings_version: 0,
    },
  };
  return {
    get s() {
      return s;
    },
    get now() {
      return now;
    },
    update(body, advance = 10000) {
      now += advance;
      s = transition(s.patient, s.device, body, now);
      return s;
    },
    point(m, extra = {}) {
      return this.update({ ...at(m), boot_id: 'boot_0001', measurement_seq: ++seq, ...extra });
    },
    command(body) {
      s.patient = control(s.patient, s.device, body, now);
    },
    view() {
      return snapshot(s.patient, s.device, now);
    },
  };
}
test('two fresh outside samples alert once; two inside samples clear', () => {
  const h = setup();
  assert.equal(h.point(0).device.boundary_state, 'unknown');
  assert.equal(h.point(0).device.boundary_state, 'inside');
  assert.deepEqual(h.point(20).events, []);
  assert.deepEqual(h.point(20).events, ['out_of_bounds']);
  assert.deepEqual(h.point(30).events, []);
  assert.deepEqual(h.point(0).events, []);
  assert.deepEqual(h.point(0).events, ['returned_inside']);
  assert.equal(h.view().should_play_audio, false);
});
test('checks and duplicate counters cannot confirm a boundary or refresh position', () => {
  const h = setup();
  h.point(20);
  const timestamp = h.s.device.last_position_at;
  h.update(null, 5000);
  h.update({ ...at(20), boot_id: 'boot_0001', measurement_seq: 1 });
  assert.equal(h.s.device.boundary_state, 'unknown');
  assert.equal(h.s.device.last_position_at, timestamp);
  h.update({}, 50000);
  assert.equal(h.s.device.connection_state, 'connected');
  assert.equal(h.view().location_stale, true);
  assert.equal(h.view().should_play_audio, false);
});
test('older sequence ignored; new boot accepts a reset sequence', () => {
  const h = setup();
  h.point(0);
  h.point(0);
  h.update({ ...at(200), boot_id: 'boot_0001', measurement_seq: 1 });
  assert.equal(h.s.device.last_lat, home.lat);
  h.update({ ...at(200), boot_id: 'boot_0002', measurement_seq: 0 });
  assert.equal(h.s.device.last_lat, at(200).lat);
});
test('a gap greater than 25 seconds restarts confirmation', () => {
  const h = setup();
  h.point(20);
  h.update({ ...at(20), boot_id: 'boot_0001', measurement_seq: 2 }, 30000);
  assert.equal(h.s.device.boundary_state, 'unknown');
  h.update({ ...at(20), boot_id: 'boot_0001', measurement_seq: 3 });
  assert.equal(h.s.device.boundary_state, 'outside');
});
test('disconnect after 60 seconds, not each five-second check; retain last boundary', () => {
  const h = setup();
  h.point(20);
  h.point(20);
  assert.equal(h.update(null, 5000).device.connection_state, 'connected');
  assert.equal(h.update(null, 54999).device.connection_state, 'connected');
  assert.deepEqual(h.update(null, 1).events, ['connection_lost']);
  assert.equal(h.s.device.boundary_state, 'outside');
  assert.deepEqual(h.update(null, 5000).events, []);
  assert.deepEqual(h.point(20).events, ['connection_restored']);
});
test('pause suppresses boundary events immediately, retains disconnect events, tracks ack separately', () => {
  const h = setup();
  h.command({ action: 'pause', minutes: 30 });
  h.point(20);
  h.point(20);
  assert.deepEqual(h.s.events, []);
  assert.equal(h.view().should_play_audio, false);
  assert.equal(h.view().settings_pending, true);
  assert.equal(h.view().pause_active, false);
  h.point(20, { applied_settings_version: 2 });
  assert.equal(h.view().pause_active, true);
  assert.equal(h.view().settings_pending, false);
  assert.deepEqual(h.update(null, 60000).events, ['connection_lost']);
});
test('pause expiry cannot start an alarm from stale location', () => {
  const h = setup();
  h.command({ action: 'pause', minutes: 1 });
  h.point(20);
  h.point(20);
  assert.deepEqual(h.update(null, 65000).events, ['connection_lost']);
  assert.equal(h.s.device.alarm_active, false);
  h.point(20);
  assert.ok(h.s.events.includes('out_of_bounds'));
});
test('silence lasts for this episode and resets on confirmed return', () => {
  const h = setup();
  h.point(20);
  h.point(20);
  h.command({ action: 'silence' });
  assert.equal(h.view().should_play_audio, false);
  assert.equal(h.s.device.audio_silenced, false);
  h.point(20, { applied_settings_version: 2 });
  assert.equal(h.s.device.audio_silenced, true);
  h.point(0);
  h.point(0);
  assert.equal(h.s.patient.desired_audio_silenced, false);
  h.point(20);
  h.point(20);
  assert.equal(h.view().should_play_audio, true);
});
test('home is caregiver-selected; unset home never alarms', () => {
  const h = setup();
  h.s.patient.home_lat = null;
  h.s.patient.home_lng = null;
  h.point(500);
  h.point(500);
  assert.equal(h.s.device.boundary_state, 'unknown');
  h.command({ action: 'home', ...at(500), address: 'Chosen center' });
  h.point(500);
  h.point(500);
  assert.equal(h.s.device.boundary_state, 'inside');
  assert.equal(h.view().config.home_lat, at(500).lat);
});
test('optional battery and server timestamps; malformed payload rejection', () => {
  const h = setup();
  h.point(0, { battery_percent: 85 });
  assert.equal(h.s.device.last_seen_at, new Date(h.now).toISOString());
  assert.equal(h.s.device.last_seen_at, h.s.device.last_position_at);
  h.update({});
  assert.equal(h.s.device.battery_percent, 85);
  for (const body of [
    { lat: 1 },
    { lat: NaN, lng: 0 },
    { lat: 0, lng: 181 },
    { x: 1, y: 2 },
    { battery_percent: 101 },
    { timestamp: 'old' },
    { ...at(0), measurement_seq: 1 },
    { ...at(0), boot_id: 'boot_001', measurement_seq: -1 },
  ])
    assert.throws(() => validateUpdate(body));
});
test('legacy positions labelled unverified; cannot downgrade a verified stream', () => {
  const h = setup();
  h.update(at(0));
  assert.equal(h.s.device.freshness_verified, false);
  h.point(0);
  const stamp = h.s.device.last_position_at;
  h.update(at(100));
  assert.equal(h.s.device.last_position_at, stamp);
  assert.equal(h.s.device.freshness_verified, true);
});
test('recording acknowledgement requires current version and checksum', () => {
  const h = setup(),
    version = '11111111-1111-4111-8111-111111111111';
  h.s.patient.audio_version = version;
  h.s.patient.audio_sha256 = 'a'.repeat(64);
  h.update({ installed_audio_version: version, installed_audio_sha256: 'b'.repeat(64) });
  assert.equal(h.s.device.installed_audio_version, undefined);
  h.update({ installed_audio_version: version, installed_audio_sha256: 'a'.repeat(64) });
  assert.equal(h.s.device.installed_audio_version, version);
  h.update({ installed_audio_version: null });
  assert.equal(h.s.device.installed_audio_version, null);
});
