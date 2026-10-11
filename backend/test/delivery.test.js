const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPushWorker } = require('../src/notifications');
const { createGeocoder } = require('../src/geocode');
const { databaseOptions } = require('../src/database');

function fixture(ticket_id = null) {
  let claimed = false;
  const calls = [];
  const pool = {
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.includes('returning *')) {
        if (claimed) return { rows: [] };
        claimed = true;
        return {
          rows: [
            {
              id: 'job',
              patient_id: 'patient',
              caregiver_id: 'carer',
              token: 'ExponentPushToken[test]',
              event: 'out_of_bounds',
              created_at: new Date(),
              attempts: 0,
              ticket_id,
            },
          ],
        };
      }
      if (sql.startsWith('select 1')) return { rows: [{}] };
      return { rows: [] };
    },
  };
  return { pool, calls };
}
test('push acceptance persists ticket for later receipt check', async () => {
  const { pool, calls } = fixture();
  await createPushWorker(pool, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: [{ status: 'ok', id: 'receipt-id' }] }),
    }),
  })();
  assert.ok(calls.some((c) => c.sql.includes('ticket_id=$2') && c.args[1] === 'receipt-id'));
});
test('receipt network failure retains ticket and schedules retry, avoiding a resend', async () => {
  const { pool, calls } = fixture('receipt-id');
  await createPushWorker(pool, {
    fetchImpl: async () => {
      throw new Error('offline');
    },
  })();
  const retry = calls.find((c) => c.sql.includes('attempts=attempts+1'));
  assert.equal(retry.args[2], 'receipt-id');
});
test('invalid push registration is removed', async () => {
  const { pool, calls } = fixture();
  await createPushWorker(pool, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }],
      }),
    }),
  })();
  assert.ok(calls.some((c) => c.sql.startsWith('delete from push_tokens')));
});
test('address lookups serialize and reuse cached matches', async () => {
  let time = 0;
  const starts = [];
  const lookup = createGeocoder({
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    fetchImpl: async () => {
      starts.push(time);
      return { ok: true, json: async () => [{ lat: '28', lon: '-81', display_name: 'Example' }] };
    },
  });
  const values = await Promise.all([lookup('First'), lookup('Second'), lookup('first')]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 1100);
  assert.deepEqual(values[0], values[2]);
});
test('connection-string SSL flags cannot disable certificate verification', () => {
  const options = databaseOptions({
    DATABASE_URL: 'postgresql://user:pass@example.com/db?sslmode=no-verify',
  });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
});
