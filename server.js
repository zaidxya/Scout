require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || !process.env.DATABASE_URL) {
  console.error('DATABASE_URL and JWT_SECRET are required (see .env.example)');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const bad = (res, code = 'invalid_input', status = 400) => res.status(status).json({ error: code });

// ---- auth ----
function requireLeader(req, res, next) {
  try {
    req.leader = jwt.verify(req.cookies.token, SECRET);
    next();
  } catch {
    bad(res, 'unauthorized', 401);
  }
}

const attempts = new Map(); // ip -> { n, reset }
function loginLimiter(req, res, next) {
  const now = Date.now();
  let a = attempts.get(req.ip);
  if (!a || a.reset < now) a = { n: 0, reset: now + 15 * 60 * 1000 };
  a.n += 1;
  attempts.set(req.ip, a);
  if (a.n > 10) return bad(res, 'too_many', 429);
  next();
}

app.post('/api/login', loginLimiter, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') return bad(res, 'invalid_login', 401);
  const { rows } = await pool.query('SELECT * FROM leaders WHERE username = $1', [username.trim()]);
  const leader = rows[0];
  if (!leader || !(await bcrypt.compare(password, leader.password_hash))) return bad(res, 'invalid_login', 401);
  const token = jwt.sign({ id: leader.id, username: leader.username }, SECRET, { expiresIn: '12h' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.json({ username: leader.username });
}));

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', requireLeader, (req, res) => res.json({ username: req.leader.username }));

// ---- public: dashboard data ----
app.get('/api/scouts', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, COALESCE(SUM(x.xp), 0)::int AS total_xp
     FROM scouts s LEFT JOIN xp_log x ON x.scout_id = s.id
     GROUP BY s.id ORDER BY total_xp DESC, s.name`
  );
  res.json(rows);
}));

app.get('/api/scouts/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return bad(res);
  const s = await pool.query('SELECT id, name FROM scouts WHERE id = $1', [id]);
  if (!s.rows[0]) return bad(res, 'not_found', 404);
  const log = await pool.query(
    'SELECT id, activity, xp, note, created_at FROM xp_log WHERE scout_id = $1 ORDER BY created_at DESC, id DESC',
    [id]
  );
  const total = log.rows.reduce((sum, r) => sum + r.xp, 0);
  res.json({ ...s.rows[0], total_xp: total, log: log.rows });
}));

// ---- leader only ----
app.post('/api/scouts', requireLeader, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 60) return bad(res);
  const { rows } = await pool.query('INSERT INTO scouts (name) VALUES ($1) RETURNING id, name', [name]);
  res.status(201).json(rows[0]);
}));

app.delete('/api/scouts/:id', requireLeader, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return bad(res);
  await pool.query('DELETE FROM scouts WHERE id = $1', [id]);
  res.json({ ok: true });
}));

app.post('/api/scouts/:id/xp', requireLeader, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const activity = String(req.body?.activity || '').trim();
  const note = String(req.body?.note || '').trim();
  const xp = Number(req.body?.xp);
  if (!Number.isInteger(id) || !activity || activity.length > 100 || note.length > 200) return bad(res);
  if (!Number.isInteger(xp) || xp === 0 || Math.abs(xp) > 10000) return bad(res);
  const exists = await pool.query('SELECT 1 FROM scouts WHERE id = $1', [id]);
  if (!exists.rows[0]) return bad(res, 'not_found', 404);
  await pool.query(
    'INSERT INTO xp_log (scout_id, activity, xp, note, leader_id) VALUES ($1, $2, $3, $4, $5)',
    [id, activity, xp, note || null, req.leader.id]
  );
  res.status(201).json({ ok: true });
}));

app.delete('/api/xp/:id', requireLeader, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return bad(res);
  await pool.query('DELETE FROM xp_log WHERE id = $1', [id]);
  res.json({ ok: true });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server' });
});

// ---- startup: schema + first leader ----
(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM leaders');
  const { LEADER_USERNAME, LEADER_PASSWORD } = process.env;
  if (rows[0].n === 0 && LEADER_USERNAME && LEADER_PASSWORD) {
    const hash = await bcrypt.hash(LEADER_PASSWORD, 12);
    await pool.query('INSERT INTO leaders (username, password_hash) VALUES ($1, $2)', [LEADER_USERNAME, hash]);
    console.log(`Created first leader "${LEADER_USERNAME}"`);
  }
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Listening on ${port}`));
})().catch((e) => {
  console.error('Startup failed:', e.message);
  process.exit(1);
});
