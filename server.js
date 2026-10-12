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
app.disable('x-powered-by');
// basic browser protections: no framing of the site (clickjacking), no MIME sniffing, no full URLs leaked to other sites
app.use((req, res, next) => {
  res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  next();
});
app.get('/healthz', (req, res) => res.type('text').send('ok')); // for uptime pingers; no database, no logging

// one log line per page/API request (shows up in Render's Logs tab); skips static assets and photos
app.use(morgan('combined', { skip: (req) => /\.(js|css|png|jpe?g|ico|svg|json|woff2?)$/i.test(req.path) || /\/photo$/.test(req.path) }));
// gzip text responses (HTML, JS, CSS, JSON) - 3-5x smaller downloads
app.use(require('compression')());
app.use(express.json({ limit: '600kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => {
    // pages, scripts, styles and language files are always re-checked (a cheap 304 when unchanged), so an update shows up at once;
    // the logo and icons almost never change, so they're kept for a week
    if (/\.(html|js|css|json)$/i.test(file)) res.setHeader('Cache-Control', 'no-cache');
    else if (/\.(png|jpe?g|ico|svg|woff2?)$/i.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800');
  },
}));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, code = 'invalid_input', status = 400) => res.status(status).json({ error: code });
const invalid = () => Object.assign(new Error('invalid_input'), { status: 400 });
// ids: whole positive numbers that fit a Postgres INT ("12abc" or 99999999999 is refused here instead of failing in the database)
const intId = (v) => { const s = String(v ?? '').trim(), n = Number(s); if (!/^\d{1,10}$/.test(s) || n < 1 || n > 2147483647) throw invalid(); return n; };
const text = (v, max) => { const s = String(v ?? '').trim(); if (s.length > max) throw invalid(); return s || null; };
// phone numbers: digits only (Arabic-Indic digits are converted; anything else is dropped)
const phone = (v) => {
  const d = String(v ?? '').replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x6f0).replace(/\D/g, '');
  if (d.length > 40) throw invalid();
  return d || null;
};
const date = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  // a real calendar day: 2025-02-31 is refused (Date.parse rolls it over to March, and Postgres would then fail with a 500)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z');
  if (!d || isNaN(d) || d.toISOString().slice(0, 10) !== s) throw invalid();
  return s;
};

// ---- troop themes: the visual identity a troop's leaders see after signing in (the main site stays purple) ----
const THEME_KEYS = ['default', 'rovers', 'forest', 'forest_girls', 'ocean', 'yellow', 'yellow_hannabies', 'red', 'red_advanced', 'white'];
// what a troop's leaders see after signing in: the theme plus the optional text next to the logo
// the troop list is tiny and changes rarely, so it is kept in memory for a minute (and dropped whenever a troop is added, edited or deleted)
let troopCache = null, troopCacheAt = 0;
const troopList = async () => {
  if (!troopCache || Date.now() - troopCacheAt > 60000) {
    troopCache = (await pool.query("SELECT id, name_en, name_ar, COALESCE(theme, 'default') AS theme, brand_en, brand_ar FROM troops ORDER BY id")).rows;
    troopCacheAt = Date.now();
  }
  return troopCache;
};
const dropTroopCache = () => { troopCache = null; };
const firstTroopId = async () => (await troopList())[0]?.id ?? null; // no troop given: the first one
const troopLook = async (troopId) => {
  const r = (await troopList()).find((x) => x.id === troopId) || {};
  return { theme: r.theme || 'default', brand_en: r.brand_en || null, brand_ar: r.brand_ar || null };
};
const brandOf = (b) => [text(b?.brand_en, 40), text(b?.brand_ar, 40)];
const themeOf = (b) => { const k = b?.theme ?? 'default'; if (!THEME_KEYS.includes(k)) throw invalid(); return k; };

// ---- auth ----
const requireLeader = wrap(async (req, res, next) => {
  let p;
  try { p = jwt.verify(req.cookies.token, SECRET); } catch { return bad(res, 'unauthorized', 401); }
  const who = await pool.query('SELECT id, username, role, troop_id, scout_id, session_v FROM leaders WHERE id = $1', [p.id]);
  // the leader was deleted, or their password was changed or reset after this session started (that ends every older session)
  if (!who.rows[0] || who.rows[0].session_v !== (p.v ?? 0)) return bad(res, 'unauthorized', 401);
  req.leader = who.rows[0];
  // the troop this request works on: an admin's or mod's own troop. The super admin (no troop of their own) and leaders (a home troop) can switch:
  // they pick it with the X-Troop header (an unknown or missing value falls back to the leader's home troop, or to the first troop for the super admin)
  req.troop = req.leader.troop_id;
  if (roams(req.leader)) {
    const all = await troopList();
    req.troop = (all.find((x) => x.id === parseInt(req.get('x-troop'), 10)) || all.find((x) => x.id === req.leader.troop_id) || all[0]).id;
  }
  next();
});
// account levels: super_admin (everything), admin (their own troop, incl. roles/tags), leader (like an admin but can switch troops, and has no roles/tags),
// mod (members and their activity only). Only the super admin manages troops and accounts and sees the activity log.
// the super admin and leaders work in any troop they switch to; admins and mods only in their own
const roams = (l) => l.role === 'super_admin' || l.role === 'leader';
// may edit the depot items and cancel their troop's reservations
const isAdmin = (l) => l.role === 'super_admin' || l.role === 'admin' || l.role === 'leader';
// a mod (مسؤول) works with the members, their activity and the patrols: the rest of the troop's setup (activities, roles/tags and who holds them) is closed to it
const requireNotMod = (req, res, next) => (req.leader.role === 'mod' ? bad(res, 'forbidden', 403) : next());
const requireAdmin = (req, res, next) => (isAdmin(req.leader) ? next() : bad(res, 'forbidden', 403));
// roles and tags: admins and the super admin (not mods, not leaders)
const requireLabelEditor = (req, res, next) => (req.leader.role === 'super_admin' || req.leader.role === 'admin' ? next() : bad(res, 'forbidden', 403));
// the super admin alone: the troops, the accounts and the activity log
const isSuper = (l) => l.role === 'super_admin';
const requireSuper = (req, res, next) => (isSuper(req.leader) ? next() : bad(res, 'forbidden', 403));
// which troops' scouts a leader may touch: their own troop, or every troop (null) for the super admin
const troopScope = (l) => (roams(l) ? null : l.troop_id);
// may the requester (the super admin) delete / reset the password of `target`? Never the super admin, never themselves.
const canManage = (req, target) => target.id !== req.leader.id && target.role !== 'super_admin';

// ---- audit log: who did what (never stores passwords or private scout details) ----
function audit(leader, action, meta, troopId) {
  pool.query('INSERT INTO audit_log (leader_id, leader_name, action, meta, troop_id) VALUES ($1,$2,$3,$4,$5)',
    [leader.id, leader.username, action, meta ? JSON.stringify(meta) : null, troopId ?? leader.troop_id ?? null])
    .catch((e) => console.error('audit failed:', e.message));
}
// the scout, but only if this leader may work with that troop; otherwise null (answered as "not found" so other troops stay invisible)
async function scoutFor(req, id) {
  const { rows } = await pool.query('SELECT id, name, troop_id FROM scouts WHERE id = $1', [id]);
  const s = rows[0];
  return s && (roams(req.leader) || s.troop_id === req.leader.troop_id) ? s : null;
}

async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

// failed sign-ins per IP: 10 per 15 minutes. Successful ones don't count, so leaders sharing one connection aren't locked out by normal use
const attempts = new Map();
setInterval(() => { const now = Date.now(); for (const [ip, a] of attempts) if (a.reset < now) attempts.delete(ip); }, 10 * 60 * 1000).unref(); // forget finished windows
function loginLimiter(req, res, next) {
  const a = attempts.get(req.ip);
  if (a && a.reset >= Date.now() && a.n >= 10) return bad(res, 'too_many', 429);
  next();
}
function loginFailed(ip) {
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || a.reset < now) a = { n: 0, reset: now + 15 * 60 * 1000 };
  a.n += 1;
  attempts.set(ip, a);
}

// sessions last until the user signs out: a very long token plus a persistent cookie (browsers cap cookies at ~400 days),
// renewed every time the session is checked so an account that keeps visiting never expires.
// v is the account's session_v: changing or resetting the password raises it, which ends every session signed with the old value
const SESSION_MS = 400 * 24 * 60 * 60 * 1000;
function setSession(res, leader) {
  const token = jwt.sign({ id: leader.id, v: leader.session_v ?? 0 }, SECRET, { expiresIn: '3650d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_MS });
}

app.post('/api/login', loginLimiter, wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') return bad(res, 'invalid_login', 401);
  const { rows } = await pool.query('SELECT * FROM leaders WHERE username = $1', [username.trim().toLowerCase()]);
  const leader = rows[0];
  if (!leader || !(await bcrypt.compare(password, leader.password_hash))) {
    loginFailed(req.ip);
    console.log(`Failed login for "${username.slice(0, 40)}" from ${req.ip}`);
    return bad(res, 'invalid_login', 401);
  }
  audit(leader, 'login');
  setSession(res, leader);
  res.json({ username: leader.username, display_name: await displayNameOf(leader), role: leader.role, troop_id: leader.troop_id, ...(await troopLook(leader.troop_id)) });
}));

app.post('/api/logout', wrap(async (req, res) => {
  try {
    const p = jwt.verify(req.cookies.token, SECRET);
    const { rows } = await pool.query('SELECT id, username, troop_id FROM leaders WHERE id = $1', [p.id]);
    if (rows[0]) audit(rows[0], 'logout');
  } catch { /* not logged in; nothing to record */ }
  res.clearCookie('token');
  res.json({ ok: true });
}));
const displayNameOf = async (l) => (l.scout_id ? (await pool.query('SELECT name FROM scouts WHERE id = $1', [l.scout_id])).rows[0]?.name : null) || l.username; // the name on the account's scout profile
app.get('/api/me', requireLeader, wrap(async (req, res) => {
  setSession(res, req.leader);
  res.json({ username: req.leader.username, display_name: await displayNameOf(req.leader), role: req.leader.role, troop_id: req.leader.troop_id, ...(await troopLook(req.leader.troop_id)) });
}));

// own account: change the username and/or the password (the current password is always required; a new password must be typed twice)
app.put('/api/me/account', requireLeader, wrap(async (req, res) => {
  const { current, next, confirm } = req.body || {};
  const want = req.body?.username == null ? req.leader.username : String(req.body.username).trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,40}$/.test(want)) throw invalid();
  const hasNext = typeof next === 'string' && next !== '';
  if (hasNext && (next.length < 8 || next.length > 200)) return bad(res, 'weak_password');
  if (hasNext && next !== confirm) return bad(res, 'password_mismatch');
  const { rows } = await pool.query('SELECT password_hash FROM leaders WHERE id = $1', [req.leader.id]);
  if (typeof current !== 'string' || !(await bcrypt.compare(current, rows[0].password_hash))) return bad(res, 'wrong_password', 403);
  const renamed = want !== req.leader.username;
  try {
    // a new password signs the account out everywhere else; this session gets a fresh cookie
    const r = await pool.query('UPDATE leaders SET username = $1, password_hash = COALESCE($2, password_hash), session_v = session_v + $4 WHERE id = $3 RETURNING id, session_v',
      [want, hasNext ? await bcrypt.hash(next, 12) : null, req.leader.id, hasNext ? 1 : 0]);
    if (hasNext) setSession(res, r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return bad(res, 'username_taken', 409);
    throw e;
  }
  if (renamed) audit(req.leader, 'username_change', { name: want });
  if (hasNext) audit({ ...req.leader, username: want }, 'password_change');
  res.json({ ok: true, username: want });
}));


// roles are public (tags stay leader-only); used by the public list and detail queries (alias s = scouts)
const ROLES_JSON = `COALESCE((SELECT json_agg(json_build_object('id', l.id, 'name_en', l.name_en, 'name_ar', l.name_ar, 'color', l.color)
    ORDER BY l.priority DESC, l.name_en)
  FROM scout_labels sl JOIN labels l ON l.id = sl.label_id AND l.kind = 'role' WHERE sl.scout_id = s.id), '[]'::json) AS roles`;

// ---- troops (names are public so the dashboard can offer a troop picker) ----
app.get('/api/troops', wrap(async (req, res) => {
  res.json(await troopList());
}));

const troopNames = (b) => {
  const en = text(b?.name_en, 60), ar = text(b?.name_ar, 60);
  if (!en && !ar) throw invalid();
  return [en || ar, ar || en];
};
app.post('/api/troops', requireLeader, requireSuper, wrap(async (req, res) => {
  const [en, ar] = troopNames(req.body);
  const [bEn, bAr] = brandOf(req.body);
  const copyFrom = req.body?.copy_from ? intId(req.body.copy_from) : null; // optionally start with a copy of another troop's activities and roles/tags
  const row = await tx(async (c) => {
    const { rows } = await c.query('INSERT INTO troops (name_en, name_ar, theme, brand_en, brand_ar) VALUES ($1,$2,$3,$4,$5) RETURNING id, name_en, name_ar, theme, brand_en, brand_ar', [en, ar, themeOf(req.body), bEn, bAr]);
    if (copyFrom) {
      await c.query('INSERT INTO activities (name_en, name_ar, xp, troop_id) SELECT name_en, name_ar, xp, $1 FROM activities WHERE troop_id = $2 ORDER BY id', [rows[0].id, copyFrom]);
      await c.query('INSERT INTO labels (kind, name_en, name_ar, color, priority, troop_id) SELECT kind, name_en, name_ar, color, priority, $1 FROM labels WHERE troop_id = $2 ORDER BY id', [rows[0].id, copyFrom]);
    }
    await c.query('INSERT INTO patrols (troop_id, name_en, name_ar, is_leadership) VALUES ($1,$2,$3,true)', [rows[0].id, ...LEADERSHIP]); // every troop starts with its leaders' patrol
    return rows[0];
  });
  dropTroopCache();
  audit(req.leader, 'troop_add', { name: en }, row.id);
  res.status(201).json(row);
}));
app.put('/api/troops/:id', requireLeader, requireSuper, wrap(async (req, res) => {
  const [en, ar] = troopNames(req.body);
  const [bEn, bAr] = brandOf(req.body);
  const r = await pool.query('UPDATE troops SET name_en = $1, name_ar = $2, theme = $3, brand_en = $4, brand_ar = $5 WHERE id = $6', [en, ar, themeOf(req.body), bEn, bAr, intId(req.params.id)]);
  if (!r.rowCount) return bad(res, 'not_found', 404);
  dropTroopCache();
  audit(req.leader, 'troop_update', { name: en }, intId(req.params.id));
  res.json({ ok: true });
}));
// a troop can only be deleted once it has no scouts and no leader accounts
app.delete('/api/troops/:id', requireLeader, requireSuper, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const used = await pool.query('SELECT (SELECT COUNT(*) FROM scouts WHERE troop_id = $1) + (SELECT COUNT(*) FROM leaders WHERE troop_id = $1) AS n', [id]);
  if (Number(used.rows[0].n) > 0) return bad(res, 'troop_not_empty', 409);
  const { rows } = await pool.query('DELETE FROM troops WHERE id = $1 RETURNING name_en', [id]);
  dropTroopCache();
  if (rows[0]) audit(req.leader, 'troop_delete', { name: rows[0].name_en }, null);
  res.json({ ok: true });
}));

// is the request from a signed-in leader account? (public routes use it to show deactivated scouts to leaders only)
async function isStaff(req) {
  try { const p = jwt.verify(req.cookies.token, SECRET); return (await pool.query('SELECT 1 FROM leaders WHERE id = $1 AND session_v = $2', [p.id, p.v ?? 0])).rowCount > 0; } catch { return false; }
}
// ---- public: dashboard data for one troop (display name, photo, roles, XP, activity) ----
app.get('/api/scouts', wrap(async (req, res) => {
  let troop = parseInt(req.query.troop, 10);
  if (!Number.isInteger(troop)) troop = await firstTroopId();
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.patrol_id, s.photo_v, (s.photo IS NOT NULL) AS has_photo, COALESCE((SELECT SUM(xp) FROM xp_log x WHERE x.scout_id = s.id), 0)::int AS total_xp, EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id AND l.role <> 'super_admin') AS in_council, ${ROLES_JSON}
     FROM scouts s
     WHERE s.troop_id = $1 AND s.active
     ORDER BY (SELECT COALESCE(MAX(l.priority), 0) FROM scout_labels sl JOIN labels l ON l.id = sl.label_id AND l.kind = 'role' WHERE sl.scout_id = s.id) DESC, total_xp DESC, s.name`,
    [troop]);
  res.json(rows);
}));

app.get('/api/scouts/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  const [s, log] = await Promise.all([
    pool.query(`SELECT s.id, s.name, s.troop_id, s.active, s.photo_v, (s.photo IS NOT NULL) AS has_photo, ${ROLES_JSON} FROM scouts s WHERE s.id = $1`, [id]),
    pool.query(
      `SELECT id, activity, activity_ar, xp, note, created_at, COALESCE(activity_date, created_at::date)::text AS day
       FROM xp_log WHERE scout_id = $1 ORDER BY COALESCE(activity_date, created_at::date) DESC, created_at DESC, id DESC`, [id]),
  ]);
  if (!s.rows[0]) return bad(res, 'not_found', 404);
  if (!s.rows[0].active && !(await isStaff(req))) return bad(res, 'not_found', 404); // deactivated scouts are only visible to leaders
  res.json({ ...s.rows[0], total_xp: log.rows.reduce((sum, r) => sum + r.xp, 0), log: log.rows });
}));

app.get('/api/scouts/:id/photo', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT photo, active FROM scouts WHERE id = $1', [intId(req.params.id)]);
  if (!rows[0] || !rows[0].photo) return res.sendStatus(404);
  if (!rows[0].active && !(await isStaff(req))) return res.sendStatus(404); // like the rest of a deactivated scout's page: leaders only
  res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'public, max-age=31536000, immutable').send(rows[0].photo);
}));

// ---- leader: scouts ----
// searchable list for leaders: includes private search fields, leader flag and role/tag ids
app.get('/api/leader/scouts', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.troop_id, s.patrol_id, s.active, s.photo_v, (s.photo IS NOT NULL) AS has_photo, s.full_name, s.phone,
       COALESCE((SELECT SUM(xp) FROM xp_log x WHERE x.scout_id = s.id), 0)::int AS total_xp,
       EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id) AS is_leader,
       EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id AND l.role = 'super_admin') AS is_super,
       EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id AND l.role <> 'super_admin') AS in_council,
       COALESCE((SELECT json_agg(sl.label_id) FROM scout_labels sl WHERE sl.scout_id = s.id), '[]'::json) AS label_ids
     FROM scouts s
     WHERE s.troop_id = $1
     ORDER BY (SELECT COALESCE(MAX(l.priority), 0) FROM scout_labels sl JOIN labels l ON l.id = sl.label_id AND l.kind = 'role' WHERE sl.scout_id = s.id) DESC, total_xp DESC, s.name`,
    [req.troop]);
  res.json(rows);
}));

// ---- patrols: each troop splits its scouts into its own patrols. The names are public (the dashboard groups scouts by them);
// admins manage them, any leader of the troop puts a scout in one ----
const LEADERSHIP_ROVERS = ['Honor council', 'مجلس الشرف']; // the same patrol as shown in Rovers-themed troops
const LEADERSHIP = ['Troop leadership', 'قيادة الفرقة']; // name of every troop's pre-made leaders' patrol
app.get('/api/patrols', wrap(async (req, res) => {
  let troop = parseInt(req.query.troop, 10);
  if (!Number.isInteger(troop)) troop = await firstTroopId();
  // the leaders' patrol always comes first; in a Rovers-themed troop it is called "مجلس الشرف" instead of "قيادة الفرقة"
  res.json((await pool.query(
    `SELECT p.id, CASE WHEN p.is_leadership AND t.theme = 'rovers' THEN $2 ELSE p.name_en END AS name_en,
            CASE WHEN p.is_leadership AND t.theme = 'rovers' THEN $3 ELSE p.name_ar END AS name_ar, p.is_leadership
     FROM patrols p JOIN troops t ON t.id = p.troop_id WHERE p.troop_id = $1 ORDER BY p.is_leadership DESC, p.id`, [troop, ...LEADERSHIP_ROVERS])).rows);
}));

const patrolNames = (b) => {
  const en = text(b?.name_en, 40), ar = text(b?.name_ar, 40);
  if (!en && !ar) throw invalid();
  return [en || ar, ar || en];
};

app.post('/api/patrols', requireLeader, wrap(async (req, res) => {
  const [en, ar] = patrolNames(req.body);
  const { rows } = await pool.query('INSERT INTO patrols (troop_id, name_en, name_ar) VALUES ($1,$2,$3) RETURNING id, name_en, name_ar', [req.troop, en, ar]);
  audit(req.leader, 'patrol_add', { name: en }, req.troop);
  res.status(201).json(rows[0]);
}));

app.put('/api/patrols/:id', requireLeader, wrap(async (req, res) => {
  const [en, ar] = patrolNames(req.body);
  const cur = (await pool.query('SELECT is_leadership FROM patrols WHERE id = $1 AND troop_id = $2', [intId(req.params.id), req.troop])).rows[0];
  if (!cur) return bad(res, 'not_found', 404);
  if (cur.is_leadership) return bad(res, 'forbidden', 403); // the leaders' patrol is pre-made and fixed
  await pool.query('UPDATE patrols SET name_en = $1, name_ar = $2 WHERE id = $3', [en, ar, intId(req.params.id)]);
  audit(req.leader, 'patrol_update', { name: en }, req.troop);
  res.json({ ok: true });
}));

app.delete('/api/patrols/:id', requireLeader, wrap(async (req, res) => {
  // its scouts stay in the troop and simply end up without a patrol
  const { rows } = await pool.query('DELETE FROM patrols WHERE id = $1 AND troop_id = $2 AND NOT is_leadership RETURNING name_en', [intId(req.params.id), req.troop]); // the leaders' patrol can't be deleted
  if (rows[0]) audit(req.leader, 'patrol_delete', { name: rows[0].name_en }, req.troop);
  res.json({ ok: true });
}));

app.put('/api/scouts/:id/patrol', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const sc = await scoutFor(req, id);
  if (!sc) return bad(res, 'not_found', 404);
  // an account (admin / mod) is in the leaders' patrol automatically and may also be put in a regular patrol; the super admin is never in the leaders' patrol
  const acct = (await pool.query('SELECT role FROM leaders WHERE scout_id = $1', [id])).rows[0];
  const pid = req.body?.patrol_id == null || req.body.patrol_id === '' ? null : intId(req.body.patrol_id);
  let name = null;
  if (pid !== null) {
    const p = await pool.query('SELECT name_en, is_leadership FROM patrols WHERE id = $1 AND troop_id = $2', [pid, sc.troop_id]); // only a patrol of the scout's own troop
    if (!p.rows[0]) return bad(res, 'not_found', 404);
    if (acct?.role === 'super_admin' && p.rows[0].is_leadership) return bad(res, 'super_not_in_council', 400);
    if (acct && acct.role !== 'super_admin' && p.rows[0].is_leadership) return bad(res, 'patrol_not_council', 400); // the leaders' patrol comes on top of it, not instead
    name = p.rows[0].name_en;
  }
  await pool.query('UPDATE scouts SET patrol_id = $1 WHERE id = $2', [pid, id]);
  audit(req.leader, 'scout_patrol', { name: sc.name, patrol: name }, sc.troop_id);
  res.json({ ok: true });
}));

// ---- leader: roles and tags (each troop has its own set; everyone reads their troop's, only list editors change them) ----
app.get('/api/labels', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, kind, name_en, name_ar, color, priority FROM labels WHERE troop_id = $1 ORDER BY kind, priority DESC, name_en, id', [req.troop]);
  res.json(rows);
}));

app.post('/api/labels', requireLeader, requireLabelEditor, wrap(async (req, res) => {
  const kind = req.body?.kind;
  const en = text(req.body?.name_en, 40), ar = text(req.body?.name_ar, 40);
  if (!['role', 'tag'].includes(kind) || (!en && !ar)) throw invalid();
  const { rows } = await pool.query(
    'INSERT INTO labels (kind, name_en, name_ar, color, priority, troop_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, kind, name_en, name_ar, color, priority',
    [kind, en || ar, ar || en, hexColor(req.body?.color), kind === 'role' ? priority(req.body?.priority) : 0, req.troop]);
  audit(req.leader, 'label_add', { name: `${en || ar} (${kind})` }, req.troop);
  res.status(201).json(rows[0]);
}));

app.put('/api/labels/:id', requireLeader, requireLabelEditor, wrap(async (req, res) => {
  const b = req.body || {}, sets = [], vals = [];
  if ('color' in b) { vals.push(hexColor(b.color)); sets.push(`color = $${vals.length}`); }
  if ('priority' in b) { vals.push(priority(b.priority)); sets.push(`priority = $${vals.length}`); }
  if (!sets.length) throw invalid();
  vals.push(intId(req.params.id), req.troop);
  const { rows } = await pool.query(`UPDATE labels SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND troop_id = $${vals.length} RETURNING name_en, kind`, vals);
  if (!rows[0]) return bad(res, 'not_found', 404);
  audit(req.leader, 'label_update', { name: `${rows[0].name_en} (${rows[0].kind})` }, req.troop);
  res.json({ ok: true });
}));

app.delete('/api/labels/:id', requireLeader, requireLabelEditor, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM labels WHERE id = $1 AND troop_id = $2 RETURNING name_en, kind', [intId(req.params.id), req.troop]);
  if (rows[0]) audit(req.leader, 'label_delete', { name: `${rows[0].name_en} (${rows[0].kind})` }, req.troop);
  res.json({ ok: true });
}));

// replace the full set of roles/tags of one scout
app.put('/api/scouts/:id/labels', requireLeader, requireLabelEditor, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const ids = req.body?.label_ids;
  if (!Array.isArray(ids) || ids.length > 100) throw invalid();
  const labelIds = [...new Set(ids.map(intId))];
  const sc = await scoutFor(req, id);
  if (!sc) return bad(res, 'not_found', 404);
  await tx(async (c) => {
    await c.query('DELETE FROM scout_labels WHERE scout_id = $1', [id]);
    if (labelIds.length) await c.query(
      'INSERT INTO scout_labels (scout_id, label_id) SELECT $1::int, id FROM labels WHERE id = ANY($2::int[]) AND troop_id = $3', [id, labelIds, sc.troop_id]);
  });
  audit(req.leader, 'labels_set', { name: sc.name }, sc.troop_id);
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

const DETAIL_COLS = 'id, name, full_name, phone, join_date, address, birth_date, guardian_name, guardian_phone, medical_notes, notes';

app.get('/api/leader/scouts/:id', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT ${DETAIL_COLS}, troop_id FROM scouts WHERE id = $1`, [intId(req.params.id)]);
  if (!rows[0]) return bad(res, 'not_found', 404); // read-only, so every signed-in account may read any troop's scout (editing is still limited to the account's own troop(s))
  // tags are leader-only: they come with the private details
  const tags = (await pool.query("SELECT lb.id, lb.name_en, lb.name_ar, lb.color FROM scout_labels sl JOIN labels lb ON lb.id = sl.label_id AND lb.kind = 'tag' WHERE sl.scout_id = $1 ORDER BY lb.name_en, lb.id", [rows[0].id])).rows;
  res.json({ ...rows[0], tags });
}));

app.post('/api/scouts', requireLeader, wrap(async (req, res) => {
  const name = text(req.body?.name, 60);
  if (!name) throw invalid();
  // scouts are added to the troop being worked on (a leader's own, or the one the super admin switched to)
  const troop = req.troop;
  const { rows } = await pool.query('INSERT INTO scouts (name, troop_id) VALUES ($1, $2) RETURNING id, name', [name, troop]);
  audit(req.leader, 'scout_add', { name }, troop);
  res.status(201).json(rows[0]);
}));

app.put('/api/scouts/:id', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const b = req.body || {};
  const name = text(b.name, 60);
  if (!name) throw invalid();
  const sc = await scoutFor(req, id);
  if (!sc) return bad(res, 'not_found', 404);
  const r = await pool.query(
    `UPDATE scouts SET name=$1, full_name=$2, phone=$3, join_date=$4, address=$5, birth_date=$6,
       guardian_name=$7, guardian_phone=$8, medical_notes=$9, notes=$10 WHERE id=$11`,
    [name, text(b.full_name, 120), phone(b.phone), date(b.join_date), text(b.address, 300), date(b.birth_date),
     text(b.guardian_name, 120), phone(b.guardian_phone), text(b.medical_notes, 1000),
     text(b.notes, 1000), id]);
  if (!r.rowCount) return bad(res, 'not_found', 404);
  audit(req.leader, 'scout_update', { name }, sc.troop_id);
  res.json({ ok: true });
}));

// leaving the movement: a scout is deactivated, never deleted (their history stays; they disappear from the public dashboard and the default lists)
app.put('/api/scouts/:id/active', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const sc = await scoutFor(req, id);
  if (!sc) return bad(res, 'not_found', 404);
  const active = req.body?.active === true;
  if (!active && (await pool.query('SELECT 1 FROM leaders WHERE scout_id = $1', [id])).rows[0]) return bad(res, 'scout_is_leader', 409); // remove the account first
  await pool.query('UPDATE scouts SET active = $1, deactivated_at = CASE WHEN $1 THEN NULL ELSE now() END WHERE id = $2', [active, id]);
  audit(req.leader, active ? 'scout_reactivate' : 'scout_deactivate', { name: sc.name }, sc.troop_id);
  res.json({ ok: true });
}));

// permanent deletion: the super admin only (everyone else deactivates)
app.delete('/api/scouts/:id', requireLeader, requireSuper, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const sc = await scoutFor(req, id);
  if (!sc) return res.json({ ok: true });
  if ((await pool.query('SELECT 1 FROM leaders WHERE scout_id = $1', [id])).rows[0]) return bad(res, 'scout_is_leader', 409);
  await pool.query('DELETE FROM scouts WHERE id = $1', [id]);
  audit(req.leader, 'scout_delete', { name: sc.name }, sc.troop_id);
  res.json({ ok: true });
}));

// promote: move a scout to another troop (XP and history go with them; the old troop's patrol, roles and tags don't apply any more)
app.put('/api/scouts/:id/promote', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const to = intId(req.body?.troop_id);
  const sc = await scoutFor(req, id);
  if (!sc) return bad(res, 'not_found', 404);
  if (to === sc.troop_id) throw invalid();
  const target = (await pool.query('SELECT name_en FROM troops WHERE id = $1', [to])).rows[0];
  if (!target) return bad(res, 'not_found', 404);
  if ((await pool.query('SELECT 1 FROM leaders WHERE scout_id = $1', [id])).rows[0]) return bad(res, 'scout_is_leader', 409); // accounts belong to their troop
  await tx(async (c) => {
    await c.query('DELETE FROM scout_labels WHERE scout_id = $1', [id]);
    await c.query('UPDATE scouts SET troop_id = $1, patrol_id = NULL WHERE id = $2', [to, id]);
  });
  audit(req.leader, 'scout_promote', { name: sc.name, to: target.name_en }, sc.troop_id);
  res.json({ ok: true });
}));


app.put('/api/scouts/:id/photo', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
  if (!m) throw invalid();
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 300 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) throw invalid();
  const sc = await scoutFor(req, id);
  if (!sc) return bad(res, 'not_found', 404);
  await pool.query('UPDATE scouts SET photo = $1, photo_v = photo_v + 1 WHERE id = $2', [buf, id]);
  audit(req.leader, 'photo_set', { name: sc.name }, sc.troop_id);
  res.json({ ok: true });
}));

app.delete('/api/scouts/:id/photo', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const sc = await scoutFor(req, id);
  if (!sc) return bad(res, 'not_found', 404);
  await pool.query('UPDATE scouts SET photo = NULL, photo_v = photo_v + 1 WHERE id = $1', [id]);
  audit(req.leader, 'photo_delete', { name: sc.name }, sc.troop_id);
  res.json({ ok: true });
}));

app.post('/api/scouts/:id/xp', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const note = text(req.body?.note, 200);
  const day = date(req.body?.date);
  if (day && Date.parse(day) > Date.now() + 2 * 86400000) throw invalid(); // no dates in the future
  const activityId = intId(req.body?.activity_id);
  const sc = await scoutFor(req, id);
  if (!sc) return bad(res, 'not_found', 404);
  if (!(await pool.query('SELECT active FROM scouts WHERE id = $1', [id])).rows[0].active) return bad(res, 'scout_inactive', 409); // reactivate first
  const a = await pool.query('SELECT * FROM activities WHERE id = $1 AND troop_id = $2', [activityId, sc.troop_id]); // each troop only uses its own activities
  if (!a.rows[0]) return bad(res, 'not_found', 404);
  const act = a.rows[0];
  await pool.query(
    `INSERT INTO xp_log (scout_id, activity, activity_ar, activity_id, xp, note, leader_id, activity_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::date, CURRENT_DATE))`,
    [id, act.name_en, act.name_ar, act.id, act.xp, note, req.leader.id, day]);
  audit(req.leader, 'xp_award', { name: sc.name, activity_en: act.name_en, activity_ar: act.name_ar, xp: act.xp }, sc.troop_id);
  res.status(201).json({ ok: true });
}));

app.delete('/api/xp/:id', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `DELETE FROM xp_log x USING scouts s WHERE x.id = $1 AND s.id = x.scout_id AND ($2::int IS NULL OR s.troop_id = $2)
     RETURNING s.name, s.troop_id, x.activity, x.activity_ar, x.xp`, [intId(req.params.id), troopScope(req.leader)]);
  if (rows[0]) audit(req.leader, 'xp_undo', { name: rows[0].name, activity_en: rows[0].activity, activity_ar: rows[0].activity_ar || rows[0].activity, xp: rows[0].xp }, rows[0].troop_id);
  res.json({ ok: true });
}));

// ---- activity list: each troop has its own; leaders read their troop's, only list editors change it ----
app.get('/api/activities', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name_en, name_ar, xp FROM activities WHERE troop_id = $1 ORDER BY xp, id', [req.troop]);
  res.json(rows);
}));

app.post('/api/activities', requireLeader, requireNotMod, wrap(async (req, res) => {
  const en = text(req.body?.name_en, 60), ar = text(req.body?.name_ar, 60);
  const xp = Number(req.body?.xp);
  if ((!en && !ar) || !Number.isInteger(xp) || xp === 0 || xp < -10000 || xp > 10000) throw invalid();
  const { rows } = await pool.query(
    'INSERT INTO activities (name_en, name_ar, xp, troop_id) VALUES ($1, $2, $3, $4) RETURNING id', [en || ar, ar || en, xp, req.troop]);
  audit(req.leader, 'activity_add', { name_en: en || ar, name_ar: ar || en, xp }, req.troop);
  res.status(201).json(rows[0]);
}));

app.delete('/api/activities/:id', requireLeader, requireNotMod, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM activities WHERE id = $1 AND troop_id = $2 RETURNING name_en, name_ar', [intId(req.params.id), req.troop]);
  if (rows[0]) audit(req.leader, 'activity_delete', rows[0], req.troop);
  res.json({ ok: true });
}));

// ---- leader: manage accounts (super admin only) ----
app.get('/api/leaders', requireLeader, requireSuper, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.id, l.username, l.role, l.created_at, l.scout_id, l.troop_id, s.name AS scout_name,
            t.name_en AS troop_name_en, t.name_ar AS troop_name_ar
     FROM leaders l LEFT JOIN scouts s ON s.id = l.scout_id LEFT JOIN troops t ON t.id = l.troop_id
     WHERE l.troop_id = $1 OR ($2::boolean AND l.role = 'super_admin')
     ORDER BY (l.role = 'super_admin') DESC, (l.role = 'admin') DESC, (l.role = 'leader') DESC, (l.role = 'mod') DESC, l.id`, [req.troop, isSuper(req.leader)]);
  res.json(rows.map((r) => ({ ...r, can_manage: canManage(req, r) })));
}));

app.post('/api/leaders', requireLeader, requireSuper, wrap(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = req.body?.password;
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) throw invalid();
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) return bad(res, 'weak_password');
  // new accounts are admins, leaders (like an admin, but can switch troops and have no roles/tags) or mods (members and their activity only)
  const role = req.body?.role == null || req.body.role === '' ? 'admin' : req.body.role;
  if (!['admin', 'leader', 'mod'].includes(role)) throw invalid();
  const display = text(req.body?.display_name, 60) || username;
  // a new account starts in the leaders' patrol only (automatic, see in_council); its regular patrol, if any, is set later from its scout page
  const patrolId = null;
  // new accounts join the troop being worked on (an admin's own, or the one the super admin switched to)
  const troop = req.troop;
  try {
    // one statement: creates the leader's scout profile and the leader together (or neither)
    const { rows } = await pool.query(
      `WITH s AS (INSERT INTO scouts (name, troop_id, patrol_id) VALUES ($3, $5, $6::int) RETURNING id)
       INSERT INTO leaders (username, password_hash, scout_id, role, troop_id) SELECT $1::text, $2::text, id, $4::text, $5::int FROM s RETURNING id, username, role`,
      [username, await bcrypt.hash(password, 12), display, role, troop, patrolId]);
    audit(req.leader, 'leader_add', { name: rows[0].username }, troop);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return bad(res, 'username_taken', 409);
    if (e.code === '23503') throw invalid(); // no such troop
    throw e;
  }
}));

app.delete('/api/leaders/:id', requireLeader, requireSuper, wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (id === req.leader.id) return bad(res, 'cannot_delete_self', 400);
  const t = (await pool.query('SELECT id, username, role, troop_id, scout_id FROM leaders WHERE id = $1', [id])).rows[0];
  if (!t) return res.json({ ok: true });
  if (!canManage(req, t)) return bad(res, 'forbidden', 403);
  await pool.query('DELETE FROM leaders WHERE id = $1', [id]);
  audit(req.leader, 'leader_delete', { name: t.username }, t.troop_id);
  res.json({ ok: true });
}));

// reset someone else's password (the super admin's own password can only be changed by the super admin or with reset-password.js)
app.put('/api/leaders/:id/password', requireLeader, requireSuper, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) return bad(res, 'weak_password');
  const t = (await pool.query('SELECT id, username, role, troop_id, scout_id FROM leaders WHERE id = $1', [id])).rows[0];
  if (!t) return bad(res, 'not_found', 404);
  if (!canManage(req, t)) return bad(res, 'forbidden', 403);
  await pool.query('UPDATE leaders SET password_hash = $1, session_v = session_v + 1 WHERE id = $2', [await bcrypt.hash(password, 12), id]); // also signs them out everywhere
  audit(req.leader, 'leader_password_reset', { name: t.username }, t.troop_id);
  res.json({ ok: true });
}));

app.get('/api/audit', requireLeader, requireSuper, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.leader_name, a.action, a.meta, a.created_at, a.troop_id, t.name_en AS troop_name_en, t.name_ar AS troop_name_ar
     FROM audit_log a LEFT JOIN troops t ON t.id = a.troop_id
     WHERE a.troop_id = $1 OR ($2::boolean AND a.troop_id IS NULL) ORDER BY a.id DESC LIMIT 300`, [req.troop, isSuper(req.leader)]);
  res.json(rows);
}));

// ---- depot (مستودع): the inventory. Everyone can read and search it; admins and the super admin edit and remove items, only the super admin adds them ----
const depotBody = (b) => {
  const en = text(b?.name_en, 80), ar = text(b?.name_ar, 80);
  const quantity = Number(b?.quantity);
  if ((!en && !ar) || !Number.isInteger(quantity) || quantity < 0 || quantity > 1000000) throw invalid();
  return [en || ar, ar || en, quantity, text(b?.notes, 500)];
};
app.get('/api/depot', wrap(async (req, res) => {
  res.json((await pool.query('SELECT id, name_en, name_ar, quantity, notes, updated_at FROM depot_items ORDER BY name_ar, id')).rows);
}));
app.post('/api/depot', requireLeader, requireSuper, wrap(async (req, res) => {
  const v = depotBody(req.body);
  const { rows } = await pool.query('INSERT INTO depot_items (name_en, name_ar, quantity, notes) VALUES ($1,$2,$3,$4) RETURNING id', v);
  audit(req.leader, 'depot_add', { name: v[0], quantity: v[2] }, null);
  res.status(201).json(rows[0]);
}));
app.put('/api/depot/:id', requireLeader, requireAdmin, wrap(async (req, res) => {
  const v = depotBody(req.body);
  const r = await pool.query('UPDATE depot_items SET name_en = $1, name_ar = $2, quantity = $3, notes = $4, updated_at = now() WHERE id = $5', [...v, intId(req.params.id)]);
  if (!r.rowCount) return bad(res, 'not_found', 404);
  audit(req.leader, 'depot_update', { name: v[0], quantity: v[2] }, null);
  res.json({ ok: true });
}));
app.delete('/api/depot/:id', requireLeader, requireAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM depot_items WHERE id = $1 RETURNING name_en', [intId(req.params.id)]);
  // the item leaves every booking with it; a booking that held nothing else is removed too
  if (rows[0]) await pool.query('DELETE FROM depot_bookings b WHERE NOT EXISTS (SELECT 1 FROM depot_booking_items bi WHERE bi.booking_id = b.id)');
  if (rows[0]) audit(req.leader, 'depot_delete', { name: rows[0].name_en }, null);
  res.json({ ok: true });
}));

// ---- depot reservations (bookings): made for a troop. A booking is a basket of items, each with a quantity, for one time window,
// accepted only if every item has that much free for the whole window. Admins and mods book for their own troop; the super admin
// and leaders pick the troop. Leaders only (they show who booked). ----
const when = (v) => { const d = new Date(String(v ?? '')); if (!v || isNaN(d)) throw invalid(); return d.toISOString(); };
// leader_name in the list is the display name on the booker's scout profile (the username stored with the booking if the account is gone)
// who may cancel a booking: the one who made it, the admins of its troop, and the super admin and leaders (who work in every troop)
const canCancel = (l, b) => b.leader_id === l.id || roams(l) || (l.role === 'admin' && b.troop_id === l.troop_id);
// the basket: [{ item_id, quantity }], the same item twice is added up; 1-100 different items
const basketOf = (v) => {
  if (!Array.isArray(v) || !v.length || v.length > 100) throw invalid();
  const m = new Map();
  for (const x of v) {
    const id = intId(x?.item_id), q = Number(x?.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 1000000) throw invalid();
    m.set(id, (m.get(id) || 0) + q);
  }
  return m;
};
// the item names of a booking for the activity log (both languages, so the log follows the reader's language)
const logItems = (lines) => lines.map((x) => ({ name_en: x.name_en, name_ar: x.name_ar, quantity: x.quantity }));
// ?past=1: the history instead (bookings that are over, latest first, up to 200); nothing in it can be cancelled
app.get('/api/depot/bookings', requireLeader, wrap(async (req, res) => {
  const past = req.query.past === '1';
  const { rows } = await pool.query(
    `SELECT b.id, b.troop_id, b.starts_at, b.ends_at, b.note, b.leader_id, COALESCE(sc.name, b.leader_name) AS leader_name,
            t.name_en AS troop_name_en, t.name_ar AS troop_name_ar,
            COALESCE(json_agg(json_build_object('item_id', bi.item_id, 'quantity', bi.quantity) ORDER BY bi.item_id) FILTER (WHERE bi.item_id IS NOT NULL), '[]') AS items
     FROM depot_bookings b LEFT JOIN troops t ON t.id = b.troop_id LEFT JOIN depot_booking_items bi ON bi.booking_id = b.id
     LEFT JOIN leaders ld ON ld.id = b.leader_id LEFT JOIN scouts sc ON sc.id = ld.scout_id
     WHERE b.ends_at ${past ? '<=' : '>'} now() GROUP BY b.id, t.id, sc.id ORDER BY ${past ? 'b.ends_at DESC, b.id DESC LIMIT 200' : 'b.starts_at, b.id LIMIT 500'}`);
  res.json(rows.map(({ leader_id, ...b }) => ({ ...b, mine: leader_id === req.leader.id, can_cancel: !past && canCancel(req.leader, { ...b, leader_id }) })));
}));
app.post('/api/depot/bookings', requireLeader, wrap(async (req, res) => {
  const basket = basketOf(req.body?.items), ids = [...basket.keys()].sort((a, b) => a - b);
  const start = when(req.body?.starts_at), end = when(req.body?.ends_at);
  const s = Date.parse(start), e = Date.parse(end);
  if (e <= s || e <= Date.now() || e - s > 60 * 86400000) throw invalid(); // ends after it starts, not over yet, at most 60 days
  const note = text(req.body?.note, 200);
  // the troop it is for: an admin's or mod's own troop; the super admin names one (or works in the troop picked with X-Troop)
  let troop = req.leader.troop_id;
  if (roams(req.leader)) { // the super admin has no troop, leaders may book for any: they name one (default: the troop they are working in)
    troop = req.body?.troop_id == null || req.body.troop_id === '' ? req.troop : intId(req.body.troop_id);
    if (!(await troopList()).some((x) => x.id === troop)) throw invalid();
  }
  const out = await tx(async (c) => {
    // the item rows are locked (always in id order, so two baskets can't deadlock) so two bookings at the same moment can't both take the last ones
    const items = (await c.query('SELECT id, name_en, name_ar, quantity FROM depot_items WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [ids])).rows;
    if (items.length !== ids.length) return { status: 404 };
    // everything booked in an overlapping window counts against the stock (simple and never overbooks)
    const held = new Map((await c.query(
      `SELECT bi.item_id, SUM(bi.quantity)::int AS n FROM depot_booking_items bi JOIN depot_bookings b ON b.id = bi.booking_id
       WHERE bi.item_id = ANY($1::int[]) AND b.starts_at < $3 AND b.ends_at > $2 GROUP BY bi.item_id`, [ids, start, end])).rows.map((r) => [r.item_id, r.n]));
    const short = items.map((i) => ({ item_id: i.id, available: Math.max(0, i.quantity - (held.get(i.id) || 0)) })).filter((x) => basket.get(x.item_id) > x.available);
    if (short.length) return { status: 409, short };
    const { rows } = await c.query('INSERT INTO depot_bookings (troop_id, starts_at, ends_at, note, leader_id, leader_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [troop, start, end, note, req.leader.id, req.leader.username]);
    await c.query('INSERT INTO depot_booking_items (booking_id, item_id, quantity) SELECT $1, unnest($2::int[]), unnest($3::int[])', [rows[0].id, ids, ids.map((id) => basket.get(id))]);
    return { row: rows[0], lines: items.map((i) => ({ ...i, quantity: basket.get(i.id) })) };
  });
  if (out.status === 404) return bad(res, 'not_found', 404);
  if (out.status === 409) return res.status(409).json({ error: 'not_available', short: out.short });
  audit(req.leader, 'depot_book', { items: logItems(out.lines) }, troop);
  res.status(201).json(out.row);
}));
app.delete('/api/depot/bookings/:id', requireLeader, wrap(async (req, res) => {
  const b = (await pool.query('SELECT id, troop_id, leader_id FROM depot_bookings WHERE id = $1', [intId(req.params.id)])).rows[0];
  if (!b) return res.json({ ok: true });
  if (!canCancel(req.leader, b)) return bad(res, 'forbidden', 403);
  const lines = (await pool.query('SELECT d.name_en, d.name_ar, bi.quantity FROM depot_booking_items bi JOIN depot_items d ON d.id = bi.item_id WHERE bi.booking_id = $1 ORDER BY d.id', [b.id])).rows;
  await pool.query('DELETE FROM depot_bookings WHERE id = $1', [b.id]);
  audit(req.leader, 'depot_unbook', { items: logItems(lines) }, b.troop_id);
  res.json({ ok: true });
}));

// ---- meetings attendance register (سجل حضور اجتماعات): every troop keeps its own meetings and marks which scouts were present.
// Every signed-in account of the troop can take attendance; deleting a meeting is closed to mods. Leader-only: nothing here is public. ----
const NOT_SUPER = "NOT EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id AND l.role = 'super_admin')"; // the super admin belongs to no troop, so is never on an attendance sheet
const meetingBody = (b) => {
  const day = date(b?.date);
  if (!day || Date.parse(day) > Date.now() + 2 * 86400000) throw invalid(); // a date is required; none in the future
  return [day, text(b?.title, 80)];
};
const meetingOf = async (req, id) => (await pool.query('SELECT id, meeting_date, title FROM meetings WHERE id = $1 AND troop_id = $2', [id, req.troop])).rows[0];

app.get('/api/meetings', requireLeader, wrap(async (req, res) => {
  res.json((await pool.query(
    `SELECT m.id, m.meeting_date, m.title,
       (SELECT COUNT(*) FROM meeting_attendance a JOIN scouts s ON s.id = a.scout_id WHERE a.meeting_id = m.id AND s.active AND ${NOT_SUPER})::int AS present
     FROM meetings m WHERE m.troop_id = $1 ORDER BY m.meeting_date DESC, m.id DESC LIMIT 300`, [req.troop])).rows);
}));

// per scout: meetings attended out of the troop's meetings held since the scout joined
app.get('/api/attendance/summary', requireLeader, wrap(async (req, res) => {
  res.json((await pool.query(
    `SELECT s.id, COUNT(m.id)::int AS total, COUNT(a.scout_id)::int AS attended
     FROM scouts s
     LEFT JOIN meetings m ON m.troop_id = s.troop_id AND (s.join_date IS NULL OR m.meeting_date >= s.join_date)
     LEFT JOIN meeting_attendance a ON a.meeting_id = m.id AND a.scout_id = s.id
     WHERE s.troop_id = $1 AND s.active AND ${NOT_SUPER} GROUP BY s.id`, [req.troop])).rows);
}));

app.post('/api/meetings', requireLeader, wrap(async (req, res) => {
  const [day, title] = meetingBody(req.body);
  const { rows } = await pool.query('INSERT INTO meetings (troop_id, meeting_date, title, created_by) VALUES ($1,$2,$3,$4) RETURNING id, meeting_date, title', [req.troop, day, title, req.leader.id]);
  audit(req.leader, 'meeting_add', { name: `${day}${title ? ' ' + title : ''}` }, req.troop);
  res.status(201).json({ ...rows[0], present: 0 });
}));

app.get('/api/meetings/:id', requireLeader, wrap(async (req, res) => {
  const m = await meetingOf(req, intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  const ids = (await pool.query('SELECT scout_id FROM meeting_attendance WHERE meeting_id = $1', [m.id])).rows.map((r) => r.scout_id);
  res.json({ ...m, present_ids: ids });
}));

app.put('/api/meetings/:id', requireLeader, wrap(async (req, res) => {
  const [day, title] = meetingBody(req.body);
  const m = await meetingOf(req, intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  await pool.query('UPDATE meetings SET meeting_date = $1, title = $2 WHERE id = $3', [day, title, m.id]);
  audit(req.leader, 'meeting_update', { name: `${day}${title ? ' ' + title : ''}` }, req.troop);
  res.json({ ok: true });
}));

app.delete('/api/meetings/:id', requireLeader, requireNotMod, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM meetings WHERE id = $1 AND troop_id = $2 RETURNING meeting_date, title', [intId(req.params.id), req.troop]);
  if (rows[0]) audit(req.leader, 'meeting_delete', { name: `${rows[0].meeting_date}${rows[0].title ? ' ' + rows[0].title : ''}` }, req.troop);
  res.json({ ok: true });
}));

// everyone at once: present = true marks all of the troop's active scouts present, false clears the sheet
app.put('/api/meetings/:id/attendance', requireLeader, wrap(async (req, res) => {
  const m = await meetingOf(req, intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  if (typeof req.body?.present !== 'boolean') throw invalid();
  if (req.body.present) {
    await pool.query(
      `INSERT INTO meeting_attendance (meeting_id, scout_id) SELECT $1, s.id FROM scouts s WHERE s.troop_id = $2 AND s.active AND ${NOT_SUPER} ON CONFLICT DO NOTHING`, [m.id, req.troop]);
  } else {
    await pool.query('DELETE FROM meeting_attendance WHERE meeting_id = $1', [m.id]);
  }
  res.json({ ok: true });
}));

// one scout: present = true / false
app.put('/api/meetings/:id/attendance/:scoutId', requireLeader, wrap(async (req, res) => {
  const m = await meetingOf(req, intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  if (typeof req.body?.present !== 'boolean') throw invalid();
  const sid = intId(req.params.scoutId);
  if (req.body.present) {
    const ok = await pool.query(`SELECT 1 FROM scouts s WHERE s.id = $1 AND s.troop_id = $2 AND s.active AND ${NOT_SUPER}`, [sid, req.troop]); // only an active scout of this troop
    if (!ok.rowCount) return bad(res, 'not_found', 404);
    await pool.query('INSERT INTO meeting_attendance (meeting_id, scout_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [m.id, sid]);
  } else {
    await pool.query('DELETE FROM meeting_attendance WHERE meeting_id = $1 AND scout_id = $2', [m.id, sid]);
  }
  res.json({ ok: true });
}));

app.use((err, req, res, next) => {
  if (err.message === 'invalid_input') return res.status(400).json({ error: 'invalid_input' });
  // body-parser errors (broken JSON, a body over the size limit) and values Postgres refuses (22xxx: number out of range, impossible date...)
  // are the client's mistake: answer with a code the pages can translate instead of the raw message or a 500
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
  if ((err.status >= 400 && err.status < 500) || /^22/.test(err.code || '')) return res.status(400).json({ error: 'invalid_input' });
  console.error(err);
  res.status(500).json({ error: 'server' });
});

// ---- startup ----
(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  // troops: make sure one exists and that everything created before troops existed belongs to it
  await pool.query("UPDATE troops SET theme = 'default' WHERE theme = 'pink'"); // the pink theme was removed: troops that used it fall back to the main purple
  let firstTroop = (await pool.query('SELECT MIN(id) AS id FROM troops')).rows[0].id;
  if (!firstTroop) {
    firstTroop = (await pool.query("INSERT INTO troops (name_en, name_ar) VALUES ('Rovers', 'الجوالة') RETURNING id")).rows[0].id;
    console.log('Created the first troop "Rovers" (rename it in the Troops tab)');
  }
  // the first troop is the Rovers: give it the Rovers identity unless a theme was chosen already
  await pool.query("UPDATE troops SET theme = 'rovers' WHERE id = $1 AND theme IS NULL", [firstTroop]);
  await pool.query('UPDATE scouts SET troop_id = $1 WHERE troop_id IS NULL', [firstTroop]);
  await pool.query("UPDATE leaders SET troop_id = $1 WHERE troop_id IS NULL AND role <> 'super_admin'", [firstTroop]); // the super admin is not bound to a troop
  await pool.query('UPDATE audit_log SET troop_id = $1 WHERE troop_id IS NULL AND leader_id IN (SELECT id FROM leaders WHERE role <> \'super_admin\')', [firstTroop]);
  await pool.query('ALTER TABLE scouts ALTER COLUMN troop_id SET NOT NULL');
  await pool.query('ALTER TABLE leaders VALIDATE CONSTRAINT leaders_troop_check');
  // activities and roles/tags used to be one list shared by every troop: give each troop its own copy.
  // The existing list stays with the first troop; every other troop gets a copy, and its scouts' XP entries
  // and role/tag assignments are pointed at that copy, so nothing changes for anyone. Runs once.
  const loose = await pool.query('SELECT (SELECT COUNT(*) FROM activities WHERE troop_id IS NULL) + (SELECT COUNT(*) FROM labels WHERE troop_id IS NULL) AS n');
  if (Number(loose.rows[0].n) > 0) {
    await tx(async (c) => {
      const others = (await c.query('SELECT id FROM troops WHERE id <> $1 ORDER BY id', [firstTroop])).rows;
      const acts = (await c.query('SELECT id, name_en, name_ar, xp FROM activities WHERE troop_id IS NULL ORDER BY id')).rows;
      const labs = (await c.query('SELECT id, kind, name_en, name_ar, color, priority FROM labels WHERE troop_id IS NULL ORDER BY id')).rows;
      for (const { id: tid } of others) {
        for (const a of acts) {
          const n = (await c.query('INSERT INTO activities (name_en, name_ar, xp, troop_id) VALUES ($1,$2,$3,$4) RETURNING id', [a.name_en, a.name_ar, a.xp, tid])).rows[0].id;
          await c.query('UPDATE xp_log SET activity_id = $1 WHERE activity_id = $2 AND scout_id IN (SELECT id FROM scouts WHERE troop_id = $3)', [n, a.id, tid]);
        }
        for (const l of labs) {
          const n = (await c.query('INSERT INTO labels (kind, name_en, name_ar, color, priority, troop_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [l.kind, l.name_en, l.name_ar, l.color, l.priority, tid])).rows[0].id;
          await c.query('UPDATE scout_labels SET label_id = $1 WHERE label_id = $2 AND scout_id IN (SELECT id FROM scouts WHERE troop_id = $3)', [n, l.id, tid]);
        }
      }
      await c.query('UPDATE activities SET troop_id = $1 WHERE troop_id IS NULL', [firstTroop]);
      await c.query('UPDATE labels SET troop_id = $1 WHERE troop_id IS NULL', [firstTroop]);
    });
    console.log('Gave every troop its own activities and roles/tags');
  }
  await pool.query('ALTER TABLE activities ALTER COLUMN troop_id SET NOT NULL');
  await pool.query('ALTER TABLE labels ALTER COLUMN troop_id SET NOT NULL');
  const acts = await pool.query('SELECT COUNT(*)::int AS n FROM activities');
  if (acts.rows[0].n === 0) {
    await pool.query(
      `INSERT INTO activities (name_en, name_ar, xp, troop_id) VALUES ('Presence','حضور',5,$1), ('Idea','فكرة',3,$1), ('Event','فعالية',10,$1)`, [firstTroop]);
  }
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM leaders');
  const { LEADER_USERNAME, LEADER_PASSWORD } = process.env;
  if (rows[0].n === 0 && LEADER_USERNAME && LEADER_PASSWORD) {
    await pool.query("INSERT INTO leaders (username, password_hash, role, troop_id) VALUES ($1, $2, 'super_admin', NULL)",
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
  // the super admin is bound to no troop (a promoted account that used to belong to one is released); their scout profile stays where it is
  await pool.query("UPDATE leaders SET troop_id = NULL WHERE role = 'super_admin' AND troop_id IS NOT NULL");
  // make sure every leader has a scout profile (covers leaders created before this feature; the super admin's goes in the first troop)
  const missing = await pool.query('SELECT id, username, troop_id FROM leaders WHERE scout_id IS NULL');
  for (const l of missing.rows) {
    await pool.query(
      'WITH s AS (INSERT INTO scouts (name, troop_id) VALUES ($2, $3) RETURNING id) UPDATE leaders SET scout_id = (SELECT id FROM s) WHERE id = $1',
      [l.id, l.username, l.troop_id ?? firstTroop]);
    console.log(`Created scout profile for leader "${l.username}"`);
  }
  // every troop has its pre-made leaders' patrol, and every leader account's scout profile is in it
  await pool.query('INSERT INTO patrols (troop_id, name_en, name_ar, is_leadership) SELECT t.id, $1, $2, true FROM troops t WHERE NOT EXISTS (SELECT 1 FROM patrols p WHERE p.troop_id = t.id AND p.is_leadership)', LEADERSHIP);
  // the super admin is never in the leaders' patrol (admin and mod accounts are in it automatically, see in_council)
  await pool.query("UPDATE scouts s SET patrol_id = NULL FROM leaders l, patrols p WHERE l.scout_id = s.id AND l.role = 'super_admin' AND p.id = s.patrol_id AND p.is_leadership");
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Listening on ${port}`));
})().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
