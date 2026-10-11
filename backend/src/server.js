const { databaseOptions } = require('./database');
const { createGeocoder } = require('./geocode');
const { createPushWorker } = require('./notifications');
const { Pool } = require('pg');

const { Store } = require('./store');
const { createApp } = require('./app');
const { createAudioService, supabaseAudioStorage } = require('./audio');
const { createWatchLink } = require('./watch-link');
const { CHECK_INTERVAL_MS } = require('./monitoring');

const REQUIRED = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'DEVICE_SECRETS_JSON',
];
for (const name of REQUIRED) {
  if (!process.env[name]) throw new Error(`Missing ${name}; see backend/.env.example`);
}

// Watch product ID -> secret. A watch must send both to be accepted.
const deviceSecrets = JSON.parse(process.env.DEVICE_SECRETS_JSON);
const secretsValid =
  deviceSecrets &&
  typeof deviceSecrets === 'object' &&
  !Array.isArray(deviceSecrets) &&
  Object.values(deviceSecrets).every((value) => typeof value === 'string' && value.length >= 32);
if (!secretsValid) {
  throw new Error('Device secrets must be random strings of at least 32 characters');
}

const pool = new Pool(databaseOptions());
// A dropped idle connection (Wi-Fi blip, laptop sleep) must not stop the server;
// the pool opens a new one on the next query.
pool.on('error', (error) => console.error('Database connection dropped:', error.message));
const store = new Store(pool);

// Ask Supabase who owns this access token. Returns the caregiver's user id.
async function verifyUser(token) {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Auth service unavailable');
  return (await response.json()).id;
}

const geocode = createGeocoder({
  endpoint: process.env.GEOCODING_URL,
  userAgent: process.env.GEOCODING_USER_AGENT,
});
const deliver = createPushWorker(pool, { accessToken: process.env.EXPO_ACCESS_TOKEN });
const audioService = process.env.SUPABASE_SECRET_KEY
  ? createAudioService({
      store,
      storage: supabaseAudioStorage(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY),
    })
  : undefined;
const { app, tick } = createApp({
  store,
  verifyUser,
  deviceSecrets,
  geocode,
  audioService,
  pairingCodes: JSON.parse(process.env.DEVICE_PAIRING_CODES_JSON || '{}'),
  watchLink: createWatchLink(),
  requireWatchSecret: process.env.WATCH_SECRET_REQUIRED !== 'false',
});

async function start() {
  await pool.query(
    'select product_id,paired,measurement_seq,installed_audio_version from devices limit 0',
  );
  await pool.query('select audio_version,phone_number from patients limit 0');
  await pool.query('select ticket_id from notification_outbox limit 0');
  const PORT = Number(process.env.PORT || 4000);
  const server = app.listen(PORT, () => {
    console.log(`careQ API running on http://localhost:${PORT}`);
  });

  // Every few seconds, look for watches that have gone quiet.
  let busy = false;
  const interval = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
    } catch (error) {
      console.error('Cannot reach the database:', error.message, '(check DATABASE_URL in .env)');
    } finally {
      busy = false;
    }
  }, CHECK_INTERVAL_MS);

  let delivering = false;
  const pushInterval = setInterval(async () => {
    if (delivering) return;
    delivering = true;
    try {
      await deliver();
    } catch {
      console.error('Push worker unavailable; pending jobs will retry');
    } finally {
      delivering = false;
    }
  }, 5000);

  async function close() {
    clearInterval(pushInterval);
    clearInterval(interval);
    server.close();
    await pool.end();
  }
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
}
start().catch(async (error) => {
  // 42P01 = missing table, 42703 = missing column: a migration has not been run.
  const reason = ['42P01', '42703'].includes(error.code)
    ? `the database is missing a migration (${error.message}). Apply only missing migrations; see MONITORING-SETUP.md.`
    : `${error.code || error.name}: ${error.message}. Check DATABASE_URL and DATABASE_CA_FILE in .env.`;
  console.error('Startup failed:', reason);
  await pool.end();
  process.exitCode = 1;
});
