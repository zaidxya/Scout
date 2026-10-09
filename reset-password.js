// Reset any account's password from the command line (use this if the super admin forgets theirs).
//   node reset-password.js <username> <new-password>
// Needs DATABASE_URL (from .env locally, or run it in Render's Shell tab where it is already set).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');

(async () => {
  const [username, password] = process.argv.slice(2);
  if (!username || !password || password.length < 8) {
    console.error('Usage: node reset-password.js <username> <new-password (8+ characters)>');
    process.exit(1);
  }
  const r = await pool.query('UPDATE leaders SET password_hash = $1 WHERE username = $2 RETURNING username, role',
    [await bcrypt.hash(password, 12), username.trim().toLowerCase()]);
  if (!r.rowCount) { console.error(`No account named "${username}".`); process.exit(1); }
  console.log(`Password reset for "${r.rows[0].username}" (${r.rows[0].role}). Existing logins stay valid for up to 12 hours.`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
