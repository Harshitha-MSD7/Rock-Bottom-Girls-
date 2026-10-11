const fs = require('node:fs');

function databaseOptions(env = process.env) {
  const url = new URL(env.DATABASE_URL);
  // pg connection-string SSL options can override the explicit TLS configuration.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl'])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: true,
      ...(env.DATABASE_CA_FILE ? { ca: fs.readFileSync(env.DATABASE_CA_FILE, 'utf8') } : {}),
    },
    // Supabase's session pooler allows 15 connections in total, shared by every
    // teammate's backend, so each backend keeps to a few.
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    // Runs once on every new connection, before it is used.
    onConnect: (client) => client.query(SESSION_LIMITS),
  };
}

// Supabase's pooler ignores timeouts sent while connecting, so they are set with
// a query on each new connection instead.
// - statement_timeout: a query stuck behind a lock gives up after 10 seconds.
// - idle_in_transaction_session_timeout: if a laptop sleeps or drops off Wi-Fi
//   mid-update, the database ends that unfinished transaction after 15 seconds
//   instead of leaving the patient's rows locked for everyone.
const SESSION_LIMITS =
  "set statement_timeout = '10s'; set idle_in_transaction_session_timeout = '15s'";

module.exports = { databaseOptions };
