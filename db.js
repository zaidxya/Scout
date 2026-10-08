const { Pool } = require('pg');
const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
module.exports = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: local ? false : { rejectUnauthorized: false },
  max: 5,
});
