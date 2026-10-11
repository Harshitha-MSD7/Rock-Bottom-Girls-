const express = require('express');
const cors = require('cors');
const { createHash, timingSafeEqual } = require('node:crypto');
const { transition, control, snapshot, fail, validateUpdate } = require('./monitoring');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (value) => createHash('sha256').update(value).digest();

function createApp({
  store,
  verifyUser,
  deviceSecrets,
  notify = async () => { },
  geocode = async () => null,
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
  const device = (req, _res, next) => {
    const id = req.get('x-device-id'),
      token = bearer(req),
      expected = deviceSecrets[id];
    if (
      !id ||
      !uuid.test(id) ||
      !token ||
      !expected ||
      !timingSafeEqual(hash(token), hash(expected))
    )
      return next(Object.assign(new Error('Invalid watch credentials'), { status: 401 }));
    req.deviceId = id;
    next();
  };
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
    return snapshot(result.patient, result.device, result.now);
  }
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/watch/updates', device, async (req, res) => {
    validateUpdate(req.body);
    const id = await store.devicePatient(req.deviceId);
    if (!id) fail('Watch is not paired', 404);
    res.json(
      await finish(
        await store.transact(id, (p, d, now) => {
          if (d.id !== req.deviceId) fail('Watch assignment changed', 409);
          return transition(p, d, req.body, now);
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
          if (d.id !== req.deviceId) fail('Watch assignment changed', 409);
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
        if (error.status === 409)
          results.push({ patient: { id }, device: null, message: error.message });
        else throw error;
      }
    }
    res.json(results);
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
          (p, d, now) => transition(control(p, d, body, now), d, null, now),
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
    res
      .status(410)
      .json({
        error: 'Retired placeholder endpoint. Use /api/watch/updates or /api/watch/config.',
      }),
  );
  app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status >= 500) console.error('API operation failed', error.code || error.name);
    res
      .status(status)
      .json({ error: status >= 500 ? 'Service unavailable. Please try again.' : error.message });
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
