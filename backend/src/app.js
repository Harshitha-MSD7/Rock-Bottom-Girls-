const express = require('express');
const cors = require('cors');
const { createHash, timingSafeEqual } = require('node:crypto');
const { transition, control, snapshot, fail, validateUpdate } = require('./monitoring');
const { normalizeWatchUrl } = require('./watch-link');
const productId = /^[A-Za-z0-9_-]{1,80}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (value) => createHash('sha256').update(value).digest();

function createApp({
  store,
  verifyUser,
  deviceSecrets,
  pairingCodes = {},
  audioService,
  notify = async () => {},
  geocode = async () => null,
  // { setup, setAlarm } for calling the board; see watch-link.js.
  watchLink,
  // false lets a watch send updates with only its product ID, as the board's
  // own program does. Anyone on the same network could then send positions.
  requireWatchSecret = true,
}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '16kb' }));
  const bearer = (req) => req.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  const caregiver = async (req, _res, next) => {
    const token = bearer(req);
    if (!token) return next(Object.assign(new Error('Sign in required'), { status: 401 }));
    try {
      req.userId = await verifyUser(token);
      if (!req.userId) fail('Invalid or expired token', 401);
      next();
    } catch (error) {
      next(error);
    }
  };
  // A watch names itself in the X-Device-Id header, or as product_id in the body
  // (what the board's program sends).
  const device = (req, _res, next) => {
    const id = req.get('x-device-id') ?? req.body?.product_id,
      token = bearer(req);
    const refuse = () =>
      next(Object.assign(new Error('Invalid watch credentials'), { status: 401 }));
    if (typeof id !== 'string' || !productId.test(id)) return refuse();
    if (token) {
      const expected = deviceSecrets[id];
      if (!expected || !timingSafeEqual(hash(token), hash(expected))) return refuse();
    } else if (requireWatchSecret) return refuse();
    req.deviceId = id;
    next();
  };
  // Accept the board's field names as well as ours.
  function watchUpdate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    const { latitude, longitude, battery, accuracy: _accuracy, product_id: _id, ...rest } = body;
    if (latitude !== undefined) rest.lat = latitude;
    if (longitude !== undefined) rest.lng = longitude;
    if (battery !== undefined && battery !== null) rest.battery_percent = battery;
    return rest;
  }

  // Boards paired by address get their alarm switched by a call from here.
  // Device id -> the alarm state last delivered, and the settings version it was for.
  const alarmSent = new Map();
  const delivered = new Map();
  const sending = new Set();
  const unreachable = new Set();
  function syncAlarm(deviceRow, view) {
    if (!watchLink || !deviceRow?.watch_url) return;
    const { id, watch_url: url } = deviceRow;
    const on = view.should_play_audio;
    const version = view.config.version;
    if (alarmSent.get(id) === on) return void delivered.set(id, version);
    if (sending.has(id)) return;
    sending.add(id);
    // Not awaited: a slow or absent board must not hold up the reply.
    watchLink
      .setAlarm(url, on)
      .then(() => {
        alarmSent.set(id, on);
        delivered.set(id, version);
        if (unreachable.delete(id)) console.log('Watch reachable again:', url);
      })
      .catch((error) => {
        if (!unreachable.has(id)) console.error('Cannot reach watch at', url, '-', error.message);
        unreachable.add(id);
      })
      .finally(() => sending.delete(id));
  }

  async function finish(result) {
    // Status is committed before sending. Notification failures never fail a watch
    // check-in or roll back status. Delivery is best effort (documented).
    if (result.events.length) {
      try {
        // Production Store queues delivery transactionally. Test/alternative stores
        // can provide an immediate notifier without delaying the response.
        if (!store.queuesNotifications) await notify(result.patient.id, result.events);
      } catch {
        console.error('Push delivery failed; current status remains saved');
      }
    }
    const view = snapshot(result.patient, result.device, result.now);
    syncAlarm(result.device, view);
    return view;
  }
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/watch/updates', device, async (req, res) => {
    const body = watchUpdate(req.body);
    validateUpdate(body);
    const id = await store.devicePatient(req.deviceId);
    if (!id) fail('Watch is not paired', 404);
    res.json(
      await finish(
        await store.transact(id, (p, d, now) => {
          if (d.id !== req.deviceId && d.product_id !== req.deviceId)
            fail('Watch assignment changed', 409);
          // A board driven from here has no settings logic of its own: a setting
          // counts as applied once the matching alarm command reached it.
          const update =
            d.watch_url && body.applied_settings_version === undefined && delivered.has(d.id)
              ? { ...body, applied_settings_version: delivered.get(d.id) }
              : body;
          return transition(p, d, update, now);
        }),
      ),
    );
  });
  app.get('/api/watch/config', device, async (req, res) => {
    const id = await store.devicePatient(req.deviceId);
    if (!id) fail('Watch is not paired', 404);
    res.json(
      await finish(
        await store.transact(id, (p, d, now) => {
          if (d.id !== req.deviceId && d.product_id !== req.deviceId)
            fail('Watch assignment changed', 409);
          return transition(p, d, null, now);
        }),
      ),
    );
  });
  app.get('/api/patients', caregiver, async (req, res) => {
    const ids = await store.patientIds(req.userId),
      results = [];
    for (const id of ids) {
      try {
        results.push(
          await finish(
            await store.transact(id, (p, d, now) => transition(p, d, null, now), req.userId),
          ),
        );
      } catch (error) {
        // No watch paired yet: still show the patient so one can be paired.
        if (error.status === 409)
          results.push({
            patient: (await store.patientRow(id)) ?? { id },
            device: null,
            message: error.message,
          });
        else throw error;
      }
    }
    res.json(results);
  });
  app.post('/api/patients', caregiver, async (req, res) => {
    const name = req.body?.display_name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120)
      fail('Enter a name of up to 120 characters');
    const patient = await store.createPatient(req.userId, name.trim());
    res.status(201).json({ patient, device: null, message: 'No watch assigned to this patient' });
  });
  app.post('/api/patients/:id/watch', caregiver, async (req, res) => {
    if (!uuid.test(req.params.id)) fail('Invalid patient ID');
    // Pair by address: ask the board at that address who it is.
    if (req.body?.watch_url !== undefined) {
      const url = normalizeWatchUrl(req.body.watch_url);
      if (!url) fail('Enter the watch address, for example 192.168.1.50');
      if (!watchLink) fail('Pairing by address is not available', 503);
      if (!(await store.assigned(req.userId, req.params.id))) fail('Patient access denied', 403);
      let found;
      try {
        found = await watchLink.setup(url);
      } catch {
        fail(
          'No careQ watch answered at that address. Check it is on and on the same network.',
          502,
        );
      }
      if (!productId.test(found.product_id)) fail('The watch reported an unusable product ID', 502);
      const paired = await store.pairProduct(req.userId, req.params.id, found.product_id, url);
      return res.json({
        device_id: paired.id,
        product_id: paired.product_id,
        watch_url: paired.watch_url,
      });
    }
    // Pair by product ID and pairing code.
    const id = req.body?.product_id,
      code = req.body?.pairing_code;
    if (
      typeof id !== 'string' ||
      !productId.test(id) ||
      typeof code !== 'string' ||
      !pairingCodes[id] ||
      !deviceSecrets[id] ||
      !timingSafeEqual(hash(code), hash(pairingCodes[id]))
    )
      fail('Invalid watch ID or pairing code', 400);
    const result = await store.pairProduct(req.userId, req.params.id, id);
    res.json({ device_id: result.id, product_id: result.product_id });
  });
  app.delete('/api/patients/:id/watch', caregiver, async (req, res) => {
    if (!uuid.test(req.params.id)) fail('Invalid patient ID');
    await store.unpairProduct(req.userId, req.params.id);
    res.status(204).end();
  });
  app.patch('/api/patients/:id', caregiver, async (req, res) => {
    if (!uuid.test(req.params.id)) fail('Invalid patient ID');
    const fields = {};
    for (const [name, max] of [
      ['display_name', 120],
      ['phone_number', 40],
      ['emergency_contact', 200],
    ]) {
      const value = req.body?.[name] ?? '';
      if (
        typeof value !== 'string' ||
        value.length > max ||
        (name === 'display_name' && !value.trim())
      )
        fail('Invalid ' + name);
      fields[name] = value.trim() || null;
    }
    res.json(await store.editPatient(req.userId, req.params.id, fields));
  });
  app.post(
    '/api/patients/:id/audio',
    caregiver,
    async (req, res, next) => {
      if (!uuid.test(req.params.id)) fail('Invalid patient ID');
      if (!(await store.assigned(req.userId, req.params.id))) fail('Patient access denied', 403);
      if (!audioService) fail('Recording storage is not configured', 503);
      next();
    },
    express.raw({ type: ['audio/*', 'application/octet-stream', 'video/webm'], limit: '10mb' }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) fail('Upload an audio file');
      res.json(await audioService.upload(req.userId, req.params.id, req.body));
    },
  );
  app.get('/api/patients/:id/audio', caregiver, async (req, res) => {
    if (!uuid.test(req.params.id)) fail('Invalid patient ID');
    if (!(await store.assigned(req.userId, req.params.id))) fail('Patient access denied', 403);
    if (!audioService) fail('Recording storage is not configured', 503);
    const patient = await store.patientRow(req.params.id);
    const bytes = await audioService.download(patient);
    res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'audio/wav' }).send(bytes);
  });
  app.get('/api/watch/audio/:version', device, async (req, res) => {
    const id = await store.devicePatient(req.deviceId);
    if (!id) fail('Watch is not paired', 404);
    const patient = await store.patientRow(id);
    if (patient.audio_version !== req.params.version)
      fail('Recording has changed; fetch current config', 409);
    if (!audioService) fail('Recording storage is not configured', 503);
    res
      .set({ 'Cache-Control': 'no-store', 'Content-Type': 'audio/wav' })
      .send(await audioService.download(patient));
  });
  app.post('/api/patients/:id/control', caregiver, async (req, res) => {
    if (!uuid.test(req.params.id)) fail('Invalid patient ID');
    let body = req.body;
    // Home given as an address only: look up its latitude/longitude first.
    if (body?.action === 'home' && body.lat === undefined && body.lng === undefined) {
      if (typeof body.address !== 'string' || !body.address.trim() || body.address.length > 300)
        fail('Enter an address');
      if (Object.keys(body).some((key) => !['action', 'address'].includes(key)))
        fail('Unexpected home field');
      if (!(await store.assigned(req.userId, req.params.id))) fail('Patient access denied', 403);
      const found = await geocode(body.address.trim());
      if (!found) fail('Address not found. Try adding the city and state.', 404);
      body = { action: 'home', lat: found.lat, lng: found.lng, address: found.address };
    }
    res.json(
      await finish(
        await store.transact(
          req.params.id,
          (p, d, now) => {
            if (['home', 'radius'].includes(body?.action))
              d = {
                ...d,
                boundary_state: 'unknown',
                candidate_boundary: null,
                candidate_count: 0,
                alarm_active: false,
              };
            return transition(control(p, d, body, now), d, null, now);
          },
          req.userId,
        ),
      ),
    );
  });
  app.post('/api/geocode', caregiver, async (req, res) => {
    const address = req.body?.address;
    if (typeof address !== 'string' || !address.trim() || address.length > 300)
      fail('Enter an address');
    const found = await geocode(address.trim());
    if (!found) fail('Address not found. Try adding the city and state.', 404);
    res.json(found);
  });
  app.post('/api/push-tokens', caregiver, async (req, res) => {
    const token = req.body?.token;
    if (
      typeof token !== 'string' ||
      !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token) ||
      token.length > 250
    )
      fail('Invalid Expo push token');
    await store.registerToken(req.userId, token);
    res.status(204).end();
  });
  app.delete('/api/push-tokens', caregiver, async (req, res) => {
    if (typeof req.body?.token !== 'string') fail('Token required');
    await store.removeToken(req.userId, req.body.token);
    res.status(204).end();
  });
  // Do not serve hardcoded status as if it were live monitoring data.
  app.all(['/api/device/location', '/api/device/ping', '/api/watch/status'], (_req, res) =>
    res.status(410).json({
      error: 'Retired placeholder endpoint. Use /api/watch/updates or /api/watch/config.',
    }),
  );
  app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status >= 500) console.error('API operation failed:', error.message);
    // Errors raised on purpose carry a status and a message written for the user,
    // such as "Recording storage is not configured". Anything else is unexpected,
    // so its details stay in the log.
    res
      .status(status)
      .json({ error: error.status ? error.message : 'Service unavailable. Please try again.' });
  });
  return {
    app,
    tick: async () => {
      for (const id of await store.allPatientIds()) {
        try {
          await finish(await store.transact(id, (p, d, now) => transition(p, d, null, now)));
        } catch (error) {
          console.error('Unable to check device status', id, '-', error.message);
        }
      }
    },
  };
}
module.exports = { createApp };
