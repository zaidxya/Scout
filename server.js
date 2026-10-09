require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
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
app.set('trust proxy', 1);
// one log line per page/API request (shows up in Render's Logs tab); skips static assets and photos
app.use(morgan('combined', { skip: (req) => /\.(js|css|png|jpe?g|ico|svg|json|woff2?)$/i.test(req.path) || /\/photo$/.test(req.path) }));
app.use(express.json({ limit: '600kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => { if (/\.(html|js|css|json)$/i.test(file)) res.setHeader('Cache-Control', 'no-cache'); },
}));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, code = 'invalid_input', status = 400) => res.status(status).json({ error: code });
const invalid = () => Object.assign(new Error('invalid_input'), { status: 400 });
const intId = (v) => { const n = parseInt(v, 10); if (!Number.isInteger(n)) throw invalid(); return n; };
const text = (v, max) => { const s = String(v ?? '').trim(); if (s.length > max) throw invalid(); return s || null; };
const date = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw invalid();
  return s;
};

// ---- auth ----
const requireLeader = wrap(async (req, res, next) => {
  let p;
  try { p = jwt.verify(req.cookies.token, SECRET); } catch { return bad(res, 'unauthorized', 401); }
  const { rows } = await pool.query('SELECT id, username, role FROM leaders WHERE id = $1', [p.id]);
  if (!rows[0]) return bad(res, 'unauthorized', 401); // e.g. leader was deleted
  req.leader = rows[0];
  next();
});
// only the super admin and admins may manage leader accounts
const isAdmin = (l) => l.role === 'super_admin' || l.role === 'admin';
const requireAdmin = (req, res, next) => (isAdmin(req.leader) ? next() : bad(res, 'forbidden', 403));
// may `actor` delete / reset the password of `target`? (never the super admin; admins only manage plain leaders)
const canManage = (actor, target) => target.id !== actor.id && target.role !== 'super_admin'
  && (actor.role === 'super_admin' || (actor.role === 'admin' && target.role === 'leader'));

// ---- audit log: who did what (never stores passwords or private scout details) ----
function audit(leader, action, meta) {
  pool.query('INSERT INTO audit_log (leader_id, leader_name, action, meta) VALUES ($1,$2,$3,$4)',
    [leader.id, leader.username, action, meta ? JSON.stringify(meta) : null])
    .catch((e) => console.error('audit failed:', e.message));
}
const scoutName = async (id) => (await pool.query('SELECT name FROM scouts WHERE id = $1', [id])).rows[0]?.name || null;

async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

const attempts = new Map();
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
  const { rows } = await pool.query('SELECT * FROM leaders WHERE username = $1', [username.trim().toLowerCase()]);
  const leader = rows[0];
  if (!leader || !(await bcrypt.compare(password, leader.password_hash))) {
    console.log(`Failed login for "${username.slice(0, 40)}" from ${req.ip}`);
    return bad(res, 'invalid_login', 401);
  }
  audit(leader, 'login');
  const token = jwt.sign({ id: leader.id }, SECRET, { expiresIn: '12h' });
  res.cookie('token', token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 60 * 60 * 1000,
  });
  res.json({ username: leader.username, role: leader.role });
}));

app.post('/api/logout', wrap(async (req, res) => {
  try {
    const p = jwt.verify(req.cookies.token, SECRET);
    const { rows } = await pool.query('SELECT id, username FROM leaders WHERE id = $1', [p.id]);
    if (rows[0]) audit(rows[0], 'logout');
  } catch { /* not logged in; nothing to record */ }
  res.clearCookie('token');
  res.json({ ok: true });
}));
app.get('/api/me', requireLeader, (req, res) => res.json({ username: req.leader.username, role: req.leader.role }));

app.put('/api/me/password', requireLeader, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (typeof next !== 'string' || next.length < 8 || next.length > 200) return bad(res, 'weak_password');
  const { rows } = await pool.query('SELECT password_hash FROM leaders WHERE id = $1', [req.leader.id]);
  if (typeof current !== 'string' || !(await bcrypt.compare(current, rows[0].password_hash))) return bad(res, 'wrong_password', 403);
  await pool.query('UPDATE leaders SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(next, 12), req.leader.id]);
  audit(req.leader, 'password_change');
  res.json({ ok: true });
}));

// roles are public (tags stay leader-only); used by the public list and detail queries (alias s = scouts)
const ROLES_JSON = `COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name_en', l.name_en, 'name_ar', l.name_ar, 'color', l.color)
    ORDER BY l.priority DESC, l.name_en)
  FROM scout_labels sl JOIN labels l ON l.id = sl.label_id AND l.kind = 'role' WHERE sl.scout_id = s.id), '[]'::json) AS roles`;

// ---- public: dashboard data (display name, photo, roles, XP, activity) ----
app.get('/api/scouts', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.photo_v, (s.photo IS NOT NULL) AS has_photo, COALESCE(SUM(x.xp), 0)::int AS total_xp, ${ROLES_JSON}
     FROM scouts s LEFT JOIN xp_log x ON x.scout_id = s.id
     GROUP BY s.id ORDER BY (SELECT COALESCE(MAX(l.priority), 0) FROM scout_labels sl JOIN labels l ON l.id = sl.label_id AND l.kind = 'role' WHERE sl.scout_id = s.id) DESC, total_xp DESC, s.name`
  );
  res.json(rows);
}));

app.get('/api/scouts/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  const s = await pool.query(`SELECT s.id, s.name, s.photo_v, (s.photo IS NOT NULL) AS has_photo, ${ROLES_JSON} FROM scouts s WHERE s.id = $1`, [id]);
  if (!s.rows[0]) return bad(res, 'not_found', 404);
  const log = await pool.query(
    'SELECT id, activity, activity_ar, xp, note, created_at FROM xp_log WHERE scout_id = $1 ORDER BY created_at DESC, id DESC', [id]);
  res.json({ ...s.rows[0], total_xp: log.rows.reduce((sum, r) => sum + r.xp, 0), log: log.rows });
}));

app.get('/api/scouts/:id/photo', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT photo FROM scouts WHERE id = $1', [intId(req.params.id)]);
  if (!rows[0] || !rows[0].photo) return res.sendStatus(404);
  res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'public, max-age=31536000, immutable').send(rows[0].photo);
}));

// ---- leader: scouts ----
// searchable list for leaders: includes private search fields, leader flag and role/tag ids
app.get('/api/leader/scouts', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.photo_v, (s.photo IS NOT NULL) AS has_photo, s.full_name, s.phone, s.group_name,
       COALESCE(x.total, 0)::int AS total_xp,
       EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id) AS is_leader,
       COALESCE((SELECT json_agg(sl.label_id) FROM scout_labels sl WHERE sl.scout_id = s.id), '[]'::json) AS label_ids
     FROM scouts s LEFT JOIN (SELECT scout_id, SUM(xp) AS total FROM xp_log GROUP BY scout_id) x ON x.scout_id = s.id
     ORDER BY (SELECT COALESCE(MAX(l.priority), 0) FROM scout_labels sl JOIN labels l ON l.id = sl.label_id AND l.kind = 'role' WHERE sl.scout_id = s.id) DESC, total_xp DESC, s.name`);
  res.json(rows);
}));

// ---- leader: roles and tags ----
app.get('/api/labels', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, kind, name_en, name_ar, color, priority FROM labels ORDER BY kind, priority DESC, name_en, id');
  res.json(rows);
}));

app.post('/api/labels', requireLeader, requireAdmin, wrap(async (req, res) => {
  const kind = req.body?.kind;
  const en = text(req.body?.name_en, 40), ar = text(req.body?.name_ar, 40);
  if (!['role', 'tag'].includes(kind) || (!en && !ar)) throw invalid();
  const { rows } = await pool.query(
    'INSERT INTO labels (kind, name_en, name_ar, color, priority) VALUES ($1,$2,$3,$4,$5) RETURNING id, kind, name_en, name_ar, color, priority',
    [kind, en || ar, ar || en, hexColor(req.body?.color), kind === 'role' ? priority(req.body?.priority) : 0]);
  audit(req.leader, 'label_add', { name: `${en || ar} (${kind})` });
  res.status(201).json(rows[0]);
}));

app.put('/api/labels/:id', requireLeader, requireAdmin, wrap(async (req, res) => {
  const b = req.body || {}, sets = [], vals = [];
  if ('color' in b) { vals.push(hexColor(b.color)); sets.push(`color = $${vals.length}`); }
  if ('priority' in b) { vals.push(priority(b.priority)); sets.push(`priority = $${vals.length}`); }
  if (!sets.length) throw invalid();
  vals.push(intId(req.params.id));
  const { rows } = await pool.query(`UPDATE labels SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING name_en, kind`, vals);
  if (!rows[0]) return bad(res, 'not_found', 404);
  audit(req.leader, 'label_update', { name: `${rows[0].name_en} (${rows[0].kind})` });
  res.json({ ok: true });
}));

app.delete('/api/labels/:id', requireLeader, requireAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM labels WHERE id = $1 RETURNING name_en, kind', [intId(req.params.id)]);
  if (rows[0]) audit(req.leader, 'label_delete', { name: `${rows[0].name_en} (${rows[0].kind})` });
  res.json({ ok: true });
}));

// replace the full set of roles/tags of one scout
app.put('/api/scouts/:id/labels', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const ids = req.body?.label_ids;
  if (!Array.isArray(ids) || ids.length > 100) throw invalid();
  const labelIds = [...new Set(ids.map(intId))];
  const name = await scoutName(id);
  if (!name) return bad(res, 'not_found', 404);
  await tx(async (c) => {
    await c.query('DELETE FROM scout_labels WHERE scout_id = $1', [id]);
    if (labelIds.length) await c.query(
      'INSERT INTO scout_labels (scout_id, label_id) SELECT $1::int, id FROM labels WHERE id = ANY($2::int[])', [id, labelIds]);
  });
  audit(req.leader, 'labels_set', { name });
  res.json({ ok: true });
}));

// role priority: whole number 0-1000, higher is listed first (empty = 0)
const priority = (v) => {
  const n = v === '' || v == null ? 0 : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw invalid();
  return n;
};
const hexColor = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw invalid();
  return s.toLowerCase();
};

const DETAIL_COLS = 'id, name, full_name, phone, join_date, address, birth_date, guardian_name, guardian_phone, medical_notes, group_name, notes';

app.get('/api/leader/scouts/:id', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT ${DETAIL_COLS} FROM scouts WHERE id = $1`, [intId(req.params.id)]);
  if (!rows[0]) return bad(res, 'not_found', 404);
  res.json(rows[0]);
}));

app.post('/api/scouts', requireLeader, wrap(async (req, res) => {
  const name = text(req.body?.name, 60);
  if (!name) throw invalid();
  const { rows } = await pool.query('INSERT INTO scouts (name) VALUES ($1) RETURNING id, name', [name]);
  audit(req.leader, 'scout_add', { name });
  res.status(201).json(rows[0]);
}));

app.put('/api/scouts/:id', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const b = req.body || {};
  const name = text(b.name, 60);
  if (!name) throw invalid();
  const r = await pool.query(
    `UPDATE scouts SET name=$1, full_name=$2, phone=$3, join_date=$4, address=$5, birth_date=$6,
       guardian_name=$7, guardian_phone=$8, medical_notes=$9, group_name=$10, notes=$11 WHERE id=$12`,
    [name, text(b.full_name, 120), text(b.phone, 40), date(b.join_date), text(b.address, 300), date(b.birth_date),
     text(b.guardian_name, 120), text(b.guardian_phone, 40), text(b.medical_notes, 1000), text(b.group_name, 60),
     text(b.notes, 1000), id]);
  if (!r.rowCount) return bad(res, 'not_found', 404);
  audit(req.leader, 'scout_update', { name });
  res.json({ ok: true });
}));

app.delete('/api/scouts/:id', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  if ((await pool.query('SELECT 1 FROM leaders WHERE scout_id = $1', [id])).rows[0]) return bad(res, 'scout_is_leader', 409);
  const name = await scoutName(id);
  await pool.query('DELETE FROM scouts WHERE id = $1', [id]);
  if (name) audit(req.leader, 'scout_delete', { name });
  res.json({ ok: true });
}));

app.put('/api/scouts/:id/photo', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
  if (!m) throw invalid();
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 300 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) throw invalid();
  const r = await pool.query('UPDATE scouts SET photo = $1, photo_v = photo_v + 1 WHERE id = $2', [buf, id]);
  if (!r.rowCount) return bad(res, 'not_found', 404);
  audit(req.leader, 'photo_set', { name: await scoutName(id) });
  res.json({ ok: true });
}));

app.delete('/api/scouts/:id/photo', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  await pool.query('UPDATE scouts SET photo = NULL, photo_v = photo_v + 1 WHERE id = $1', [id]);
  audit(req.leader, 'photo_delete', { name: await scoutName(id) });
  res.json({ ok: true });
}));

app.post('/api/scouts/:id/xp', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const note = text(req.body?.note, 200);
  const a = await pool.query('SELECT * FROM activities WHERE id = $1', [intId(req.body?.activity_id)]);
  if (!a.rows[0]) return bad(res, 'not_found', 404);
  const exists = await pool.query('SELECT 1 FROM scouts WHERE id = $1', [id]);
  if (!exists.rows[0]) return bad(res, 'not_found', 404);
  const act = a.rows[0];
  await pool.query(
    `INSERT INTO xp_log (scout_id, activity, activity_ar, activity_id, xp, note, leader_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, act.name_en, act.name_ar, act.id, act.xp, note, req.leader.id]);
  audit(req.leader, 'xp_award', { name: await scoutName(id), activity_en: act.name_en, activity_ar: act.name_ar, xp: act.xp });
  res.status(201).json({ ok: true });
}));

app.delete('/api/xp/:id', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM xp_log x USING scouts s WHERE x.id = $1 AND s.id = x.scout_id RETURNING s.name, x.activity, x.activity_ar, x.xp', [intId(req.params.id)]);
  if (rows[0]) audit(req.leader, 'xp_undo', { name: rows[0].name, activity_en: rows[0].activity, activity_ar: rows[0].activity_ar || rows[0].activity, xp: rows[0].xp });
  res.json({ ok: true });
}));

// ---- leader: activity list ----
app.get('/api/activities', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name_en, name_ar, xp FROM activities ORDER BY xp, id');
  res.json(rows);
}));

app.post('/api/activities', requireLeader, wrap(async (req, res) => {
  const en = text(req.body?.name_en, 60), ar = text(req.body?.name_ar, 60);
  const xp = Number(req.body?.xp);
  if ((!en && !ar) || !Number.isInteger(xp) || xp === 0 || xp < -10000 || xp > 10000) throw invalid();
  const { rows } = await pool.query(
    'INSERT INTO activities (name_en, name_ar, xp) VALUES ($1, $2, $3) RETURNING id', [en || ar, ar || en, xp]);
  audit(req.leader, 'activity_add', { name_en: en || ar, name_ar: ar || en, xp });
  res.status(201).json(rows[0]);
}));

app.delete('/api/activities/:id', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM activities WHERE id = $1 RETURNING name_en, name_ar', [intId(req.params.id)]);
  if (rows[0]) audit(req.leader, 'activity_delete', rows[0]);
  res.json({ ok: true });
}));

// ---- leader: manage leaders (super admin / admin only) ----
app.get('/api/leaders', requireLeader, requireAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.id, l.username, l.role, l.created_at, l.scout_id, s.name AS scout_name
     FROM leaders l LEFT JOIN scouts s ON s.id = l.scout_id ORDER BY (l.role = 'super_admin') DESC, (l.role = 'admin') DESC, l.id`);
  res.json(rows.map((r) => ({ ...r, can_manage: canManage(req.leader, r) })));
}));

app.post('/api/leaders', requireLeader, requireAdmin, wrap(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = req.body?.password;
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) throw invalid();
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) return bad(res, 'weak_password');
  const role = req.body?.role === 'admin' ? 'admin' : 'leader';
  if (role === 'admin' && req.leader.role !== 'super_admin') return bad(res, 'forbidden', 403); // only the super admin creates admins
  const display = text(req.body?.display_name, 60) || username;
  try {
    // one statement: creates the leader's scout profile and the leader together (or neither)
    const { rows } = await pool.query(
      `WITH s AS (INSERT INTO scouts (name) VALUES ($3) RETURNING id)
       INSERT INTO leaders (username, password_hash, scout_id, role) SELECT $1::text, $2::text, id, $4::text FROM s RETURNING id, username, role`,
      [username, await bcrypt.hash(password, 12), display, role]);
    audit(req.leader, 'leader_add', { name: rows[0].username });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return bad(res, 'username_taken', 409);
    throw e;
  }
}));

app.delete('/api/leaders/:id', requireLeader, requireAdmin, wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (id === req.leader.id) return bad(res, 'cannot_delete_self', 400);
  const t = (await pool.query('SELECT id, username, role FROM leaders WHERE id = $1', [id])).rows[0];
  if (!t) return res.json({ ok: true });
  if (!canManage(req.leader, t)) return bad(res, 'forbidden', 403);
  await pool.query('DELETE FROM leaders WHERE id = $1', [id]);
  audit(req.leader, 'leader_delete', { name: t.username });
  res.json({ ok: true });
}));

// reset someone else's password (the super admin's own password can only be changed by the super admin or with reset-password.js)
app.put('/api/leaders/:id/password', requireLeader, requireAdmin, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) return bad(res, 'weak_password');
  const t = (await pool.query('SELECT id, username, role FROM leaders WHERE id = $1', [id])).rows[0];
  if (!t) return bad(res, 'not_found', 404);
  if (!canManage(req.leader, t)) return bad(res, 'forbidden', 403);
  await pool.query('UPDATE leaders SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(password, 12), id]);
  audit(req.leader, 'leader_password_reset', { name: t.username });
  res.json({ ok: true });
}));

app.get('/api/audit', requireLeader, requireAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, leader_name, action, meta, created_at FROM audit_log ORDER BY id DESC LIMIT 300');
  res.json(rows);
}));

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'server' });
});

// ---- startup ----
(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const acts = await pool.query('SELECT COUNT(*)::int AS n FROM activities');
  if (acts.rows[0].n === 0) {
    await pool.query(
      `INSERT INTO activities (name_en, name_ar, xp) VALUES ('Presence','حضور',5), ('Idea','فكرة',3), ('Event','فعالية',10)`);
  }
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM leaders');
  const { LEADER_USERNAME, LEADER_PASSWORD } = process.env;
  if (rows[0].n === 0 && LEADER_USERNAME && LEADER_PASSWORD) {
    await pool.query("INSERT INTO leaders (username, password_hash, role) VALUES ($1, $2, 'super_admin')",
      [LEADER_USERNAME.trim().toLowerCase(), await bcrypt.hash(LEADER_PASSWORD, 12)]);
    console.log(`Created first leader (super admin) "${LEADER_USERNAME}"`);
  }
  // make sure exactly one super admin exists (covers accounts created before roles existed):
  // the account named in LEADER_USERNAME, otherwise the oldest account
  const sa = await pool.query("SELECT 1 FROM leaders WHERE role = 'super_admin'");
  if (!sa.rows[0]) {
    const r = await pool.query(
      `UPDATE leaders SET role = 'super_admin' WHERE id = (
         SELECT id FROM leaders ORDER BY (username = $1) DESC, id LIMIT 1) RETURNING username`,
      [(LEADER_USERNAME || '').trim().toLowerCase()]);
    if (r.rows[0]) console.log(`Promoted "${r.rows[0].username}" to super admin`);
  }
  // make sure every leader has a scout profile (covers leaders created before this feature)
  const missing = await pool.query('SELECT id, username FROM leaders WHERE scout_id IS NULL');
  for (const l of missing.rows) {
    await pool.query(
      'WITH s AS (INSERT INTO scouts (name) VALUES ($2) RETURNING id) UPDATE leaders SET scout_id = (SELECT id FROM s) WHERE id = $1',
      [l.id, l.username]);
    console.log(`Created scout profile for leader "${l.username}"`);
  }
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Listening on ${port}`));
})().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
