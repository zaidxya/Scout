const { Pool, types } = require('pg');
types.setTypeParser(1082, (v) => v); // keep DATE columns as 'YYYY-MM-DD' strings
const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: local ? false : { rejectUnauthorized: false },
  max: 5,
  keepAlive: true,                // keep connections healthy between requests
  idleTimeoutMillis: 60000,       // reuse connections for a minute instead of reconnecting (TLS handshakes are slow)
  connectionTimeoutMillis: 15000, // fail with an error instead of hanging if the database is waking up
});
// a dropped idle connection (e.g. the database going to sleep) must not crash the app
pool.on('error', (e) => console.error('database connection error:', e.message));
module.exports = pool;
