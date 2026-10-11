// The flow in the hardware document: pair by the board's address, the board
// sends its position with only its product ID, and the backend switches the
// board's alarm by calling it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

const PATIENT = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const PRODUCT = '00000001';
const BOARD = 'http://10.0.0.5:5000';
const HOME = { lat: 28.6024, lng: -81.2001 };
const north = (meters) => HOME.lat + meters / 111194.9266;

const state = {
  patient: {
    id: PATIENT,
    home_lat: HOME.lat,
    home_lng: HOME.lng,
    radius_meters: 100,
    settings_version: 1,
    desired_pause_until: null,
    desired_audio_silenced: false,
  },
  device: null,
};
const store = {
  assigned: async (userId, id) => userId === 'carer' && id === PATIENT,
  patientIds: async () => [PATIENT],
  allPatientIds: async () => [PATIENT],
  devicePatient: async (id) => (state.device && id === PRODUCT ? PATIENT : undefined),
  patientRow: async () => state.patient,
  pairProduct: async (_user, _id, product_id, watch_url) => {
    state.device = {
      id: DEVICE,
      product_id,
      watch_url,
      last_seen_at: null,
      last_position_at: null,
      boundary_state: 'unknown',
      connection_state: 'unknown',
      alarm_active: false,
      audio_silenced: false,
      paused_until: null,
      applied_settings_version: 0,
    };
    return state.device;
  },
  async transact(_id, fn) {
    if (!state.device)
      throw Object.assign(new Error('No watch assigned to this patient'), { status: 409 });
    const now = Date.now();
    const result = fn(state.patient, state.device, now);
    state.patient = result.patient;
    state.device = result.device;
    return { ...result, now };
  },
};

// Stand-in for the calls to the board.
const board = { alarm: null, calls: [], online: true };
const watchLink = {
  setup: async (url) => {
    if (!board.online) throw new Error('unreachable');
    board.calls.push('setup ' + url);
    return { product_id: PRODUCT };
  },
  setAlarm: async (url, on) => {
    if (!board.online) throw new Error('unreachable');
    board.calls.push(`alarm ${on} ${url}`);
    board.alarm = on;
  },
};
const options = {
  store,
  verifyUser: async (token) => (token === 'good' ? 'carer' : null),
  deviceSecrets: {},
  watchLink,
};
const { app } = createApp({ ...options, requireWatchSecret: false });
const strict = createApp(options).app;

let server, strictServer, base, strictBase;
before(async () => {
  server = app.listen(0);
  strictServer = strict.listen(0);
  await Promise.all([server, strictServer].map((s) => new Promise((r) => s.once('listening', r))));
  base = `http://localhost:${server.address().port}`;
  strictBase = `http://localhost:${strictServer.address().port}`;
});
after(() => {
  server.close();
  strictServer.close();
});

const json = { 'Content-Type': 'application/json' };
const carer = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { ...json, Authorization: 'Bearer good' },
    body: JSON.stringify(body),
  });
// What the board's program sends: its product ID and position, no secret.
const boardUpdate = async (meters, target = base) => {
  const response = await fetch(`${target}/api/watch/updates`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({
      product_id: PRODUCT,
      latitude: north(meters),
      longitude: HOME.lng,
      accuracy: 100,
    }),
  });
  // Let the not-awaited alarm call finish before the test looks at the board.
  await new Promise((resolve) => setImmediate(resolve));
  return { status: response.status, body: await response.json() };
};

test('pairing by address asks the board for its product ID', async () => {
  board.online = false;
  assert.equal(
    (await carer(`/api/patients/${PATIENT}/watch`, { watch_url: '10.0.0.5' })).status,
    502,
  );
  assert.equal(state.device, null);

  board.online = true;
  const response = await carer(`/api/patients/${PATIENT}/watch`, { watch_url: '10.0.0.5' });
  assert.deepEqual(await response.json(), {
    device_id: DEVICE,
    product_id: PRODUCT,
    watch_url: BOARD,
  });
  assert.deepEqual(board.calls, ['setup ' + BOARD]);
});

test('a watch without a secret is refused unless that is switched on', async () => {
  assert.equal((await boardUpdate(10, strictBase)).status, 401);
  assert.equal((await boardUpdate(10)).status, 200);
});

test('the board alarm is switched on after two outside readings, and off when paused', async () => {
  await boardUpdate(10);
  assert.equal(state.device.boundary_state, 'inside');
  assert.equal(board.alarm, false);

  await boardUpdate(300);
  assert.equal(board.alarm, false);
  await boardUpdate(310);
  await boardUpdate(320);
  assert.equal(board.alarm, true);
  assert.equal(board.calls.filter((call) => call.startsWith('alarm true')).length, 1);

  const paused = await carer(`/api/patients/${PATIENT}/control`, { action: 'pause', minutes: 30 });
  assert.equal((await paused.json()).settings_pending, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(board.alarm, false);

  // The command reached the board, so the next update confirms the pause.
  const next = await boardUpdate(320);
  assert.equal(next.body.settings_pending, false);
  assert.equal(next.body.pause_active, true);
});

test('an unreachable board does not fail the update; the command is retried', async () => {
  board.online = false;
  await carer(`/api/patients/${PATIENT}/control`, { action: 'resume' });
  assert.equal((await boardUpdate(320)).status, 200);
  assert.equal(board.alarm, false);

  board.online = true;
  await boardUpdate(330);
  assert.equal(board.alarm, true);
});
