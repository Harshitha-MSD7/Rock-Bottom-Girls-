// Exercises the HTTP routes against an in-memory stand-in for the database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

const PATIENT = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const SECRET = 'a'.repeat(32);

// Positions are described as meters north of home.
const HOME = { lat: 28.6024, lng: -81.2001 };
const at = (meters) => ({ lat: HOME.lat + meters / 111194.9266, lng: HOME.lng });

const patient = {
  id: PATIENT,
  home_lat: HOME.lat,
  home_lng: HOME.lng,
  radius_meters: 10,
  settings_version: 1,
  desired_pause_until: null,
  desired_audio_silenced: false,
};
const device = {
  id: DEVICE,
  patient_id: PATIENT,
  last_seen_at: null,
  last_position_at: null,
  boundary_state: 'unknown',
  connection_state: 'unknown',
  alarm_active: false,
  audio_silenced: false,
  paused_until: null,
  applied_settings_version: 0,
};
const state = { patient, device };
const sent = [];

const store = {
  assigned: async (userId, id) => userId === 'carer' && id === PATIENT,
  patientIds: async (userId) => (userId === 'carer' ? [PATIENT] : []),
  allPatientIds: async () => [PATIENT],
  devicePatient: async (id) => (id === DEVICE ? PATIENT : undefined),
  patientRow: async (id) => (id === PATIENT ? state.patient : undefined),
  createPatient: async (userId, display_name) => ({ id: 'new-patient', display_name, userId }),
  pairProduct: async (user, id, product) => {
    if (user !== 'carer' || id !== PATIENT)
      throw Object.assign(new Error('Patient access denied'), { status: 403 });
    state.linked = product;
    return { id: DEVICE, product_id: product };
  },
  unpairProduct: async (user, id) => {
    if (user !== 'carer' || id !== PATIENT)
      throw Object.assign(new Error('Patient access denied'), { status: 403 });
    state.linked = null;
  },
  async transact(id, fn, userId) {
    if (id !== PATIENT) throw Object.assign(new Error('Patient not found'), { status: 404 });
    if (userId && userId !== 'carer') {
      throw Object.assign(new Error('Patient access denied'), { status: 403 });
    }
    const now = Date.now();
    const result = fn(state.patient, state.device, now);
    state.patient = result.patient;
    state.device = result.device;
    return { ...result, now };
  },
};

const { app } = createApp({
  store,
  verifyUser: async (token) => ({ good: 'carer', other: 'stranger' })[token] || null,
  deviceSecrets: { [DEVICE]: SECRET, 'watch-001': SECRET },
  pairingCodes: { 'watch-001': 'pairing-code-123' },
  notify: async (_patientId, events) => sent.push(...events),
  geocode: async (address) =>
    address === 'nowhere'
      ? null
      : { lat: at(5000).lat, lng: HOME.lng, address: 'Found: ' + address },
});

let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const watch = (body, secret = SECRET) =>
  fetch(`${base}/api/watch/updates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': DEVICE,
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
const carer = (path, options = {}, token = 'good') =>
  fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });

test('watch needs its secret, and bad updates are rejected', async () => {
  assert.equal((await watch(at(1), 'b'.repeat(32))).status, 401);
  assert.equal((await watch({ lat: 'one', lng: 1 })).status, 400);
});

test('inside then outside update notifies once', async () => {
  await watch(at(5));
  let body = await (await watch(at(5))).json();
  assert.equal(body.device.boundary_state, 'inside');
  assert.equal(body.config.radius_meters, 10);

  await watch(at(20));
  body = await (await watch(at(20))).json();
  assert.equal(body.device.boundary_state, 'outside');
  assert.equal(body.should_play_audio, true);
  await watch(at(21));
  assert.deepEqual(sent, ['out_of_bounds']);
});

test('caregiver sees only their own patients', async () => {
  assert.equal((await fetch(`${base}/api/patients`)).status, 401);
  assert.equal((await carer('/api/patients', {}, 'expired')).status, 401);
  assert.deepEqual(await (await carer('/api/patients', {}, 'other')).json(), []);

  const list = await (await carer('/api/patients')).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].device.connection_state, 'connected');
  assert.equal(list[0].device.boundary_state, 'outside');
});

test('controls: radius change, pause pending until the watch confirms', async () => {
  const control = (body, token) =>
    carer(
      `/api/patients/${PATIENT}/control`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    );

  assert.equal((await control({ action: 'radius', radius_meters: 50 }, 'other')).status, 403);
  assert.equal((await control({ action: 'radius', radius_meters: -1 })).status, 400);

  let body = await (await control({ action: 'pause', minutes: 30 })).json();
  assert.equal(body.settings_pending, true);
  assert.equal(body.pause_active, false);

  body = await (await watch({ ...at(20), applied_settings_version: body.config.version })).json();
  assert.equal(body.settings_pending, false);
  assert.equal(body.pause_active, true);
  assert.equal(body.should_play_audio, false);
});

test('home can be set by address; the lookup result is saved', async () => {
  const control = (body, token) =>
    carer(
      `/api/patients/${PATIENT}/control`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    );

  assert.equal((await control({ action: 'home', address: 'nowhere' })).status, 404);
  assert.equal((await control({ action: 'home', address: '1 Main St' }, 'other')).status, 403);

  const body = await (await control({ action: 'home', address: '1 Main St' })).json();
  assert.equal(body.patient.home_address, 'Found: 1 Main St');
  assert.equal(body.config.home_lat, at(5000).lat);
});

test('a caregiver can add a patient', async () => {
  const add = (body, token) =>
    carer('/api/patients', { method: 'POST', body: JSON.stringify(body) }, token);

  assert.equal((await add({ display_name: '  ' })).status, 400);
  assert.equal((await add({ display_name: 'x'.repeat(121) })).status, 400);
  assert.equal((await add({ display_name: 'Mary' }, 'expired')).status, 401);

  const response = await add({ display_name: ' Mary ' });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.patient.display_name, 'Mary');
  assert.equal(body.patient.userId, 'carer');
  assert.equal(body.device, null);
});

test('pairing requires provisioned product ID, pairing code and patient ownership', async () => {
  const pair = (body, token) =>
    carer(`/api/patients/${PATIENT}/watch`, { method: 'POST', body: JSON.stringify(body) }, token);
  const body = { product_id: 'watch-001', pairing_code: 'pairing-code-123' };
  assert.equal((await pair({ watch_url: 'not an address !!' })).status, 400);
  // Pairing by address needs the board link, which this app was created without.
  assert.equal((await pair({ watch_url: 'http://10.0.0.5' })).status, 503);
  assert.equal((await pair({ ...body, pairing_code: 'wrong' })).status, 400);
  assert.equal((await pair(body, 'other')).status, 403);
  assert.equal(state.linked, undefined);
  assert.deepEqual(await (await pair(body)).json(), { device_id: DEVICE, product_id: 'watch-001' });
  assert.equal(state.linked, 'watch-001');
  assert.equal(
    (await carer(`/api/patients/${PATIENT}/watch`, { method: 'DELETE' }, 'other')).status,
    403,
  );
  assert.equal((await carer(`/api/patients/${PATIENT}/watch`, { method: 'DELETE' })).status, 204);
  assert.equal(state.linked, null);
});

test('retired placeholder routes never serve fabricated live status', async () => {
  assert.equal((await fetch(`${base}/api/device/ping`)).status, 410);
  assert.equal((await fetch(`${base}/api/watch/status`)).status, 410);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});
