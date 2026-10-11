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
    max: 5,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  };
}
module.exports = { databaseOptions };
