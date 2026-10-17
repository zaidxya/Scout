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
    troopCache = (await pool.query("SELECT id, name_en, name_ar, COALESCE(theme, 'default') AS theme, brand_en, brand_ar, slogan_en, slogan_ar, COALESCE(level, id) AS level, xp_enabled FROM troops ORDER BY COALESCE(level, id), id")).rows;
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
// troop level: a whole number 1-1000 (empty = none given)
const levelOf = (b) => { const v = b?.level; if (v == null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 1000) throw invalid(); return n; };
// does this troop use the XP system? (the Troops tab switches it per troop)
const xpOn = async (troopId) => (await troopList()).find((x) => x.id === troopId)?.xp_enabled !== false;
const xpFlag = (b) => (typeof b?.xp_enabled === 'boolean' ? b.xp_enabled : null); // null: not given
const brandOf = (b) => [text(b?.brand_en, 40), text(b?.brand_ar, 40)];
const sloganOf = (b) => [text(b?.slogan_en, 60), text(b?.slogan_ar, 60)]; // the slogan shown next to the troop's name in the leader area
const themeOf = (b) => { const k = b?.theme ?? 'default'; if (!THEME_KEYS.includes(k)) throw invalid(); return k; };

// ---- auth ----
const ACCOUNT_ROLES = ['admin', 'leader', 'mod', 'helper', 'general_leader']; // the levels the super admin can give
const requireLeader = wrap(async (req, res, next) => {
  let p;
  try { p = jwt.verify(req.cookies.token, SECRET); } catch { return bad(res, 'unauthorized', 401); }
  const who = await pool.query('SELECT id, username, role, troop_id, scout_id, session_v FROM leaders WHERE id = $1', [p.id]);
  // the leader was deleted, or their password was changed or reset after this session started (that ends every older session)
  if (!who.rows[0] || who.rows[0].session_v !== (p.v ?? 0)) return bad(res, 'unauthorized', 401);
  req.real = who.rows[0]; // the account that is signed in
  req.leader = req.real;
  // the super admin can look at the leader area as another account (the X-View-As header carries its id): the request then runs as that account,
  // so the lists and tabs are exactly what it sees, but read-only (nothing is changed in someone else's name)
  const viewAs = parseInt(req.get('x-view-as'), 10);
  if (req.real.role === 'super_admin' && Number.isInteger(viewAs) && viewAs !== req.real.id) {
    const other = (await pool.query("SELECT id, username, role, troop_id, scout_id, session_v FROM leaders WHERE id = $1 AND role <> 'super_admin'", [viewAs])).rows[0];
    if (other) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return bad(res, 'view_only', 403);
      req.leader = other; req.viewing = true;
    }
  }
  // the troop this request works on: an admin's or mod's own troop. The super admin (no troop of their own) and leaders (a home troop) can switch:
  // they pick it with the X-Troop header (an unknown or missing value falls back to the leader's home troop, or to the first troop for the super admin)
  req.troop = req.leader.troop_id;
  if (roams(req.leader)) {
    const all = await troopList();
    req.troop = (all.find((x) => x.id === parseInt(req.get('x-troop'), 10)) || all.find((x) => x.id === req.leader.troop_id) || all[0]).id;
  }
  // a mod (مساعد القائد) or helper (عريف / رائد) only works with the patrol it is in charge of: the patrol set on its own scout profile (null: none assigned yet)
  req.patrol = null;
  if (isHelper(req.leader) && req.leader.scout_id) req.patrol = (await pool.query('SELECT patrol_id FROM scouts WHERE id = $1', [req.leader.scout_id])).rows[0]?.patrol_id ?? null;
  next();
});
// account levels: super_admin (everything), admin (their own troop, incl. roles/tags), leader (like an admin but can switch troops, and has no roles/tags),
// mod (members and their activity only). Only the super admin manages troops and accounts and sees the activity log.
// the super admin and leaders work in any troop they switch to; admins and mods only in their own
// the helper (عريف, called رائد in a Rovers troop) works with the members of its own patrol only (the old mod's limits); it can't edit the musical team (see requireMusicManager)
const isHelper = (l) => l.role === 'helper';
// the deputy leader (نائب القائد, admin), the assistant leader (مساعد القائد, mod) and the leader (القائد) are one level under three names: they work in their own troop only
// (no Activities, no Roles & tags). The general leader (القائد العام) has the same permissions but works in every troop, like the super admin.
const isTroopStaff = (l) => l.role === 'admin' || l.role === 'mod' || l.role === 'leader';
const roams = (l) => l.role === 'super_admin' || l.role === 'general_leader';
// may edit the depot items and cancel their troop's reservations
const isAdmin = (l) => l.role === 'super_admin' || l.role === 'general_leader' || isTroopStaff(l);
// a mod (رائد) works with the members of its own patrol and their activity (and adds meetings of that patrol): the rest of the troop's setup (activities, roles/tags, the patrols themselves) is closed to it
const requireNotMod = (req, res, next) => (isHelper(req.leader) ? bad(res, 'forbidden', 403) : next());
const requireAdmin = (req, res, next) => (isAdmin(req.leader) ? next() : bad(res, 'forbidden', 403));
// activities (the troop's list of awards): admins and the super admin (not mods, not leaders)
const requireActivityEditor = (req, res, next) => (req.leader.role === 'super_admin' ? next() : bad(res, 'forbidden', 403));
// roles and tags: admins and the super admin (not mods, not leaders)
const requireLabelEditor = (req, res, next) => (req.leader.role === 'super_admin' ? next() : bad(res, 'forbidden', 403));
// the super admin alone: the troops, the accounts and the activity log
const isSuper = (l) => l.role === 'super_admin';
const requireSuper = (req, res, next) => (isSuper(req.leader) ? next() : bad(res, 'forbidden', 403));
// which troops' scouts a leader may touch: their own troop, or every troop (null) for the super admin
const troopScope = (l) => (roams(l) ? null : l.troop_id);
// may the requester (the super admin) delete / reset the password of `target`? Never the super admin, never themselves.
const canManage = (req, target) => target.id !== req.leader.id && target.role !== 'super_admin';

// ---- audit log: who did what (never stores passwords or private scout details) ----
// SQL for the level of the account `idExpr` points at, as <p>_role and <p>_rovers (its troop has the Rovers theme); null when the account is gone
const whoSql = (idExpr, p) => `(SELECT x.role FROM leaders x WHERE x.id = ${idExpr}) AS ${p}_role,
  COALESCE((SELECT tr.theme = 'rovers' FROM leaders x JOIN troops tr ON tr.id = x.troop_id WHERE x.id = ${idExpr}), false) AS ${p}_rovers`;
function audit(leader, action, meta, troopId) {
  pool.query('INSERT INTO audit_log (leader_id, leader_name, action, meta, troop_id) VALUES ($1,$2,$3,$4,$5)',
    [leader.id, leader.username, action, meta ? JSON.stringify(meta) : null, troopId ?? leader.troop_id ?? null])
    .catch((e) => console.error('audit failed:', e.message));
}
// a mod (رائد) can see everyone like any other account, but only CHANGE the scouts of its own patrol (its own profile is in it). A mod with no patrol changes nobody.
// editableSql is SQL for "this scout may be changed by this account" on the scouts table aliased `a` (always true for everyone else), patrolSql the same
// as a condition to append to a WHERE; only whole numbers read from the database are put in, never request data
const modOnly = (req) => isHelper(req.leader);
const editableSql = (req, a) => (modOnly(req) ? (req.patrol ? `${a}.patrol_id = ${Number(req.patrol)}` : 'false') : 'true');
const patrolSql = (req, a) => (modOnly(req) ? ` AND ${editableSql(req, a)}` : '');
const inPatrol = (req, s) => !modOnly(req) || (req.patrol != null && s.patrol_id === req.patrol);
// the scout to change, but only if this leader may work with that troop (and, for a mod, that patrol); otherwise null (answered as "not found" so other troops stay invisible)
async function scoutFor(req, id) {
  const { rows } = await pool.query('SELECT id, name, troop_id, patrol_id FROM scouts WHERE id = $1', [id]);
  const s = rows[0];
  return s && (roams(req.leader) || s.troop_id === req.leader.troop_id) && inPatrol(req, s) ? s : null;
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
  setSession(res, leader);
  res.json({ username: leader.username, display_name: await displayNameOf(leader), role: leader.role, troop_id: leader.troop_id, ...(await troopLook(leader.troop_id)) });
}));

app.post('/api/logout', wrap(async (req, res) => {
  // (signing in and out are not logged)
  res.clearCookie('token');
  res.json({ ok: true });
}));
const displayNameOf = async (l) => (l.scout_id ? (await pool.query('SELECT name FROM scouts WHERE id = $1', [l.scout_id])).rows[0]?.name : null) || l.username; // the name on the account's scout profile
app.get('/api/me', requireLeader, wrap(async (req, res) => {
  setSession(res, req.real); // always the signed-in account's own session, never the one being viewed
  const display_name = await displayNameOf(req.leader);
  res.json({ username: req.leader.username, display_name, role: req.leader.role, troop_id: req.leader.troop_id, real_role: req.real.role,
    ...(req.viewing ? { viewing: { id: req.leader.id, username: req.leader.username, display_name, role: req.leader.role } } : {}), ...(await troopLook(req.leader.troop_id)) });
}));
// the accounts the super admin can view the leader area as (every account but the super admin's, in every troop)
app.get('/api/view-as/accounts', requireLeader, wrap(async (req, res) => {
  if (req.real.role !== 'super_admin') return bad(res, 'forbidden', 403);
  res.json((await pool.query(
    `SELECT l.id, l.username, l.role, l.troop_id, (t.theme = 'rovers') AS rovers, s.name AS display_name, t.name_en AS troop_name_en, t.name_ar AS troop_name_ar
     FROM leaders l LEFT JOIN scouts s ON s.id = l.scout_id LEFT JOIN troops t ON t.id = l.troop_id
     WHERE l.role <> 'super_admin' ORDER BY l.troop_id, (l.role = 'general_leader') DESC, (l.role = 'admin') DESC, (l.role = 'mod') DESC, (l.role = 'leader') DESC, l.username`)).rows);
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

// ---- site settings: the font for the whole site (public to read; the super admin changes it). Fonts load from Google Fonts in the browser, never from this server ----
const SITE_FONT_KEYS = ['cairo','tajawal','almarai','ibm_plex','noto_kufi','noto_sans','noto_naskh','amiri','readex','el_messiri','changa','mada','system'];
app.get('/api/settings', wrap(async (req, res) => {
  const r = (await pool.query("SELECT value FROM site_settings WHERE key = 'font'")).rows[0];
  res.set('Cache-Control', 'no-cache').json({ font: r && SITE_FONT_KEYS.includes(r.value) ? r.value : SITE_FONT_KEYS[0] });
}));
app.put('/api/settings/font', requireLeader, requireSuper, wrap(async (req, res) => {
  const font = String(req.body?.font ?? '');
  if (!SITE_FONT_KEYS.includes(font)) throw invalid();
  await pool.query("INSERT INTO site_settings (key, value) VALUES ('font', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [font]);
  audit(req.leader, 'site_font', { font });
  res.json({ ok: true });
}));

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
    // no level given: above every existing troop
    const { rows } = await c.query('INSERT INTO troops (name_en, name_ar, theme, brand_en, brand_ar, level, xp_enabled, slogan_en, slogan_ar) VALUES ($1,$2,$3,$4,$5, COALESCE($6::int, (SELECT COALESCE(MAX(level), 0) + 1 FROM troops)), $7, $8, $9) RETURNING id, name_en, name_ar, theme, brand_en, brand_ar, slogan_en, slogan_ar, level, xp_enabled', [en, ar, themeOf(req.body), bEn, bAr, levelOf(req.body), xpFlag(req.body) ?? true, ...sloganOf(req.body)]);
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
  const r = await pool.query('UPDATE troops SET name_en = $1, name_ar = $2, theme = $3, brand_en = $4, brand_ar = $5, level = COALESCE($7::int, level), xp_enabled = COALESCE($8::boolean, xp_enabled), slogan_en = $9, slogan_ar = $10 WHERE id = $6', [en, ar, themeOf(req.body), bEn, bAr, intId(req.params.id), levelOf(req.body), xpFlag(req.body), ...sloganOf(req.body)]);
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
  await pool.query('DELETE FROM posts WHERE id IN (SELECT post_id FROM post_troops GROUP BY post_id HAVING bool_and(troop_id = $1))', [id]); // posts only about this troop
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
    `SELECT s.id, s.name, s.patrol_id, s.photo_v, (s.photo IS NOT NULL AND NOT s.photo_hidden) AS has_photo, COALESCE((SELECT SUM(xp) FROM xp_log x WHERE x.scout_id = s.id), 0)::int AS total_xp, EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id AND l.role <> 'super_admin') AS in_council, ${ROLES_JSON}
     FROM scouts s
     WHERE s.troop_id = $1 AND s.active
     ORDER BY (SELECT COALESCE(MAX(l.priority), 0) FROM scout_labels sl JOIN labels l ON l.id = sl.label_id AND l.kind = 'role' WHERE sl.scout_id = s.id) DESC, (CASE WHEN COALESCE((SELECT t.xp_enabled FROM troops t WHERE t.id = s.troop_id), true) THEN COALESCE((SELECT SUM(xp) FROM xp_log x WHERE x.scout_id = s.id), 0) ELSE 0 END) DESC, s.name`,
    [troop]);
  res.json(rows);
}));

app.get('/api/scouts/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  const [s, log] = await Promise.all([
    pool.query(`SELECT s.id, s.name, s.troop_id, s.active, s.photo_v, (s.photo IS NOT NULL AND NOT s.photo_hidden) AS has_photo, ${ROLES_JSON} FROM scouts s WHERE s.id = $1`, [id]),
    pool.query(
      `SELECT id, activity, activity_ar, xp, note, created_at, COALESCE(activity_date, created_at::date)::text AS day
       FROM xp_log WHERE scout_id = $1 ORDER BY COALESCE(activity_date, created_at::date) DESC, created_at DESC, id DESC`, [id]),
  ]);
  if (!s.rows[0]) return bad(res, 'not_found', 404);
  if (!s.rows[0].active && !(await isStaff(req))) return bad(res, 'not_found', 404); // deactivated scouts are only visible to leaders
  res.json({ ...s.rows[0], total_xp: log.rows.reduce((sum, r) => sum + r.xp, 0), log: log.rows });
}));

app.get('/api/scouts/:id/photo', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT photo, active, photo_hidden FROM scouts WHERE id = $1', [intId(req.params.id)]);
  if (!rows[0] || !rows[0].photo) return res.sendStatus(404);
  if (rows[0].photo_hidden && !(await isStaff(req))) return res.sendStatus(404); // hidden on the dashboard: only signed-in accounts (the leader area) get it
  if (!rows[0].active && !(await isStaff(req))) return res.sendStatus(404); // like the rest of a deactivated scout's page: leaders only
  res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'public, max-age=31536000, immutable').send(rows[0].photo);
}));

// ---- leader: scouts ----
// searchable list for leaders: includes private search fields, leader flag and role/tag ids
app.get('/api/leader/scouts', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.troop_id, s.patrol_id, s.active, s.photo_v, (s.photo IS NOT NULL) AS has_photo, s.photo_hidden, s.full_name, s.phone, ${editableSql(req, 's')} AS editable,
       COALESCE((SELECT SUM(xp) FROM xp_log x WHERE x.scout_id = s.id), 0)::int AS total_xp,
       EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id) AS is_leader,
       EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id AND l.role = 'super_admin') AS is_super,
       EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id AND l.role <> 'super_admin') AS in_council,
       -- details still empty (the leader list flags them): a scout needs a full name, phone, join date, birth date, guardian name and phone, and address; accounts (every leader profile, the super admin too) are never flagged
       CASE WHEN EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id) THEN ARRAY[]::text[] ELSE ARRAY_REMOVE(ARRAY[
         CASE WHEN COALESCE(BTRIM(s.full_name), '') = '' THEN 'full_name' END,
         CASE WHEN COALESCE(BTRIM(s.phone), '') = '' THEN 'phone' END,
         CASE WHEN s.join_date IS NULL THEN 'join_date' END,
         CASE WHEN s.birth_date IS NULL THEN 'birth_date' END,
         CASE WHEN COALESCE(BTRIM(s.guardian_name), '') = '' THEN 'guardian_name' END,
         CASE WHEN COALESCE(BTRIM(s.guardian_phone), '') = '' THEN 'guardian_phone' END,
         CASE WHEN COALESCE(BTRIM(s.address), '') = '' THEN 'address' END
       ], NULL) END AS missing,
       COALESCE((SELECT json_agg(sl.label_id ORDER BY sl.pos, sl.label_id) FROM scout_labels sl WHERE sl.scout_id = s.id), '[]'::json) AS label_ids
     FROM scouts s
     WHERE s.troop_id = $1
     ORDER BY (SELECT COALESCE(MAX(l.priority), 0) FROM scout_labels sl JOIN labels l ON l.id = sl.label_id AND l.kind = 'role' WHERE sl.scout_id = s.id) DESC, (CASE WHEN COALESCE((SELECT t.xp_enabled FROM troops t WHERE t.id = s.troop_id), true) THEN COALESCE((SELECT SUM(xp) FROM xp_log x WHERE x.scout_id = s.id), 0) ELSE 0 END) DESC, s.name`,
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

app.post('/api/patrols', requireLeader, requireNotMod, wrap(async (req, res) => {
  const [en, ar] = patrolNames(req.body);
  const { rows } = await pool.query('INSERT INTO patrols (troop_id, name_en, name_ar) VALUES ($1,$2,$3) RETURNING id, name_en, name_ar', [req.troop, en, ar]);
  audit(req.leader, 'patrol_add', { name: en }, req.troop);
  res.status(201).json(rows[0]);
}));

app.put('/api/patrols/:id', requireLeader, requireNotMod, wrap(async (req, res) => {
  const [en, ar] = patrolNames(req.body);
  const cur = (await pool.query('SELECT is_leadership FROM patrols WHERE id = $1 AND troop_id = $2', [intId(req.params.id), req.troop])).rows[0];
  if (!cur) return bad(res, 'not_found', 404);
  if (cur.is_leadership) return bad(res, 'forbidden', 403); // the leaders' patrol is pre-made and fixed
  await pool.query('UPDATE patrols SET name_en = $1, name_ar = $2 WHERE id = $3', [en, ar, intId(req.params.id)]);
  audit(req.leader, 'patrol_update', { name: en }, req.troop);
  res.json({ ok: true });
}));

app.delete('/api/patrols/:id', requireLeader, requireNotMod, wrap(async (req, res) => {
  // its scouts stay in the troop and simply end up without a patrol
  const { rows } = await pool.query('DELETE FROM patrols WHERE id = $1 AND troop_id = $2 AND NOT is_leadership RETURNING name_en', [intId(req.params.id), req.troop]); // the leaders' patrol can't be deleted
  if (rows[0]) audit(req.leader, 'patrol_delete', { name: rows[0].name_en }, req.troop);
  res.json({ ok: true });
}));

app.put('/api/scouts/:id/patrol', requireLeader, requireNotMod, wrap(async (req, res) => {
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
      // the position is the place in the list the page sent (the ones already there first, a newly added one last)
      'INSERT INTO scout_labels (scout_id, label_id, pos) SELECT $1::int, l.id, u.ord::int FROM unnest($2::int[]) WITH ORDINALITY AS u(id, ord) JOIN labels l ON l.id = u.id WHERE l.troop_id = $3', [id, labelIds, sc.troop_id]);
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
  const { rows } = await pool.query(`SELECT ${DETAIL_COLS}, troop_id, patrol_id, (photo IS NOT NULL) AS has_photo, photo_hidden, deactivation_reason, deactivated_at FROM scouts WHERE id = $1`, [intId(req.params.id)]);
  // admins and mods only get their own troop's scouts (a mod gets all of them, but can change only its patrol's: `editable`); the super admin and leaders (who work in every troop) get any
  if (!rows[0] || (!roams(req.leader) && rows[0].troop_id !== req.leader.troop_id)) return bad(res, 'not_found', 404);
  // tags are leader-only: they come with the private details
  const tags = (await pool.query("SELECT lb.id, lb.name_en, lb.name_ar, lb.color FROM scout_labels sl JOIN labels lb ON lb.id = sl.label_id AND lb.kind = 'tag' WHERE sl.scout_id = $1 ORDER BY lb.name_en, lb.id", [rows[0].id])).rows;
  res.json({ ...rows[0], tags, editable: inPatrol(req, rows[0]) });
}));

app.post('/api/scouts', requireLeader, wrap(async (req, res) => {
  const b = req.body || {};
  const name = text(b.name, 60);
  if (!name) throw invalid();
  // scouts are added to the troop being worked on (a leader's own, or the one the super admin switched to); the details are optional and
  // checked exactly like when a scout is edited
  const troop = req.troop;
  if (modOnly(req) && !req.patrol) return bad(res, 'no_patrol', 403); // a mod's new scout joins its patrol, so it needs one
  const { rows } = await pool.query(
    `INSERT INTO scouts (name, troop_id, full_name, phone, join_date, address, birth_date, guardian_name, guardian_phone, medical_notes, notes, patrol_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, name`,
    [name, troop, text(b.full_name, 120), phone(b.phone), date(b.join_date), text(b.address, 300), date(b.birth_date),
     text(b.guardian_name, 120), phone(b.guardian_phone), text(b.medical_notes, 1000), text(b.notes, 1000), modOnly(req) ? req.patrol : null]);
  audit(req.leader, 'scout_add', { name }, troop);
  res.status(201).json(rows[0]);
}));

// many scouts at once (the import in the Add scout tab): each row is checked exactly like a single new scout; the valid ones are added together in
// one transaction to the troop being worked on, the numbers (1-based) of the refused rows come back. At most 200 at a time.
app.post('/api/scouts/bulk', requireLeader, wrap(async (req, res) => {
  const list = req.body?.scouts;
  if (!Array.isArray(list) || !list.length || list.length > 200) throw invalid();
  const troop = req.troop;
  if (modOnly(req) && !req.patrol) return bad(res, 'no_patrol', 403);
  const good = [], failed = [];
  list.forEach((b, i) => {
    try {
      const name = text(b?.name, 60);
      if (!name) throw invalid();
      good.push([name, troop, text(b.full_name, 120), phone(b.phone), date(b.join_date), text(b.address, 300), date(b.birth_date),
        text(b.guardian_name, 120), phone(b.guardian_phone), text(b.medical_notes, 1000), text(b.notes, 1000), modOnly(req) ? req.patrol : null]);
    } catch { failed.push(i + 1); }
  });
  if (good.length) {
    await tx(async (c) => {
      for (const v of good) {
        await c.query(
          `INSERT INTO scouts (name, troop_id, full_name, phone, join_date, address, birth_date, guardian_name, guardian_phone, medical_notes, notes, patrol_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, v);
      }
    });
    audit(req.leader, 'scout_import', { name: String(good.length) }, troop);
  }
  res.status(201).json({ created: good.length, failed });
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
  const reason = active ? null : text(req.body?.reason, 300);
  if (!active && !reason) return bad(res, 'reason_required', 400); // leaving the movement always has a reason
  await pool.query('UPDATE scouts SET active = $1, deactivated_at = CASE WHEN $1 THEN NULL ELSE now() END, deactivation_reason = $3 WHERE id = $2', [active, id, reason]);
  audit(req.leader, active ? 'scout_reactivate' : 'scout_deactivate', active ? { name: sc.name } : { name: sc.name, reason }, sc.troop_id);
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
  const all = await troopList(), target = all.find((x) => x.id === to), from = all.find((x) => x.id === sc.troop_id);
  if (!target) return bad(res, 'not_found', 404);
  if (!from || target.level <= from.level) return bad(res, 'not_higher', 400); // promotion only goes up: to a troop with a higher level
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

// hide / show the picture on the public dashboard (it is kept, and the leader area still shows it)
app.put('/api/scouts/:id/photo-hidden', requireLeader, wrap(async (req, res) => {
  const id = intId(req.params.id);
  if (typeof req.body?.hidden !== 'boolean') throw invalid();
  const sc = await scoutFor(req, id);
  if (!sc) return bad(res, 'not_found', 404);
  await pool.query('UPDATE scouts SET photo_hidden = $1 WHERE id = $2', [req.body.hidden, id]);
  audit(req.leader, req.body.hidden ? 'photo_hide' : 'photo_show', { name: sc.name }, sc.troop_id);
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
  // a custom award: its own title and XP (any whole number but 0, as for activities), not from the troop's list
  const custom = req.body?.custom === true;
  let customAct = null;
  if (custom) {
    const title = text(req.body?.title, 80), cxp = Number(req.body?.xp);
    if (!title || !Number.isInteger(cxp) || cxp === 0 || Math.abs(cxp) > 10000) throw invalid();
    customAct = { id: null, name_en: title, name_ar: title, xp: cxp };
  }
  const activityId = custom ? null : intId(req.body?.activity_id);
  const sc = await scoutFor(req, id);
  if (!sc) return bad(res, 'not_found', 404);
  if (!(await xpOn(sc.troop_id))) return bad(res, 'xp_disabled', 409); // this troop doesn't use XP
  if (!(await pool.query('SELECT active FROM scouts WHERE id = $1', [id])).rows[0].active) return bad(res, 'scout_inactive', 409); // reactivate first
  const a = custom ? { rows: [customAct] } : await pool.query('SELECT * FROM activities WHERE id = $1 AND troop_id = $2', [activityId, sc.troop_id]); // each troop only uses its own activities
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
    `DELETE FROM xp_log x USING scouts s WHERE x.id = $1 AND s.id = x.scout_id AND ($2::int IS NULL OR s.troop_id = $2)${patrolSql(req, 's')}
     RETURNING s.name, s.troop_id, x.activity, x.activity_ar, x.xp`, [intId(req.params.id), troopScope(req.leader)]);
  if (rows[0]) audit(req.leader, 'xp_undo', { name: rows[0].name, activity_en: rows[0].activity, activity_ar: rows[0].activity_ar || rows[0].activity, xp: rows[0].xp }, rows[0].troop_id);
  res.json({ ok: true });
}));

// ---- activity list: each troop has its own; leaders read their troop's, only list editors change it ----
app.get('/api/activities', requireLeader, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, name_en, name_ar, xp FROM activities WHERE troop_id = $1 ORDER BY xp, id', [req.troop]);
  res.json(rows);
}));

app.post('/api/activities', requireLeader, requireActivityEditor, wrap(async (req, res) => {
  const en = text(req.body?.name_en, 60), ar = text(req.body?.name_ar, 60);
  const xp = Number(req.body?.xp);
  if ((!en && !ar) || !Number.isInteger(xp) || xp === 0 || xp < -10000 || xp > 10000) throw invalid();
  const { rows } = await pool.query(
    'INSERT INTO activities (name_en, name_ar, xp, troop_id) VALUES ($1, $2, $3, $4) RETURNING id', [en || ar, ar || en, xp, req.troop]);
  audit(req.leader, 'activity_add', { name_en: en || ar, name_ar: ar || en, xp }, req.troop);
  res.status(201).json(rows[0]);
}));

app.delete('/api/activities/:id', requireLeader, requireActivityEditor, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM activities WHERE id = $1 AND troop_id = $2 RETURNING name_en, name_ar', [intId(req.params.id), req.troop]);
  if (rows[0]) audit(req.leader, 'activity_delete', rows[0], req.troop);
  res.json({ ok: true });
}));

// ---- leader: manage accounts (super admin only) ----
// every account of every troop (the Administration page groups them by troop)
app.get('/api/leaders', requireLeader, requireSuper, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.id, l.username, l.role, l.created_at, l.scout_id, l.troop_id, s.name AS scout_name, (t.theme = 'rovers') AS rovers
     FROM leaders l LEFT JOIN scouts s ON s.id = l.scout_id LEFT JOIN troops t ON t.id = l.troop_id
     ORDER BY (l.role = 'super_admin') DESC, l.troop_id, (l.role = 'general_leader') DESC, (l.role = 'admin') DESC, (l.role = 'leader') DESC, (l.role = 'mod') DESC, (l.role = 'helper') DESC, l.id`);
  res.json(rows.map((r) => ({ ...r, can_manage: canManage(req, r) })));
}));
app.post('/api/leaders', requireLeader, requireSuper, wrap(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = req.body?.password;
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) throw invalid();
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) return bad(res, 'weak_password');
  // new accounts are admins, leaders (like an admin, but can switch troops and have no roles/tags) or mods / helpers (members and their activity only)
  const role = req.body?.role == null || req.body.role === '' ? 'admin' : req.body.role;
  if (!ACCOUNT_ROLES.includes(role)) throw invalid();
  const display = text(req.body?.display_name, 60) || username;
  // a new account starts in the leaders' patrol only (automatic, see in_council); its regular patrol, if any, is set later from its scout page
  const patrolId = null;
  // the troop the account belongs to: the one chosen on the Administration page (troop_id), else the one being worked on
  const troop = req.body?.troop_id == null || req.body.troop_id === '' ? req.troop : intId(req.body.troop_id);
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

// change an account's level (the super admin only; never its own or the super admin's). The account keeps its session and its scout profile; the new level applies from its next request
app.put('/api/leaders/:id/role', requireLeader, requireSuper, wrap(async (req, res) => {
  const id = intId(req.params.id), role = req.body?.role;
  if (!ACCOUNT_ROLES.includes(role)) throw invalid();
  const t = (await pool.query('SELECT id, username, role, troop_id, scout_id FROM leaders WHERE id = $1', [id])).rows[0];
  if (!t) return bad(res, 'not_found', 404);
  if (!canManage(req, t)) return bad(res, 'forbidden', 403);
  if (t.role !== role) {
    await pool.query('UPDATE leaders SET role = $1 WHERE id = $2', [role, id]);
    audit(req.leader, 'leader_role', { name: t.username, from: t.role, role }, t.troop_id);
  }
  res.json({ ok: true, role });
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

// the activity log (Administration page): every troop, or one (?troop=), newest first, `limit` entries (default 200, at most 500) older than `before` (an entry id).
// Sign-ins and sign-outs are not recorded any more; the ones recorded earlier are left out here
app.get('/api/audit', requireLeader, requireSuper, wrap(async (req, res) => {
  const troop = req.query.troop ? intId(req.query.troop) : null, before = req.query.before ? intId(req.query.before) : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
  res.json((await pool.query(
    `SELECT id, leader_name, ${whoSql('audit_log.leader_id', 'leader')}, action, meta, created_at, troop_id FROM audit_log
     WHERE action NOT IN ('login', 'logout') AND ($1::int IS NULL OR troop_id = $1) AND ($2::int IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`, [troop, before, limit])).rows);
}));

// ---- home page: news, activities and events (public to read; admins, leaders and the super admin write; mods don't) ----
const POST_KINDS = ['news', 'activity', 'event'];
const requirePoster = (req, res, next) => (isHelper(req.leader) ? bad(res, 'forbidden', 403) : next());
const postFields = (b) => {
  const kind = b?.kind ?? 'news';
  if (!POST_KINDS.includes(kind)) throw invalid();
  const title = text(b?.title, 120);
  if (!title) throw invalid();
  return { kind, title, body: text(b?.body, 2000), event_date: date(b?.event_date), ticker: b?.ticker === true, pinned: b?.pinned === true };
};
// every post, for everyone: pinned first, then newest. The home page is the same for all troops; a post can be about one troop, several (a joint event)
// or all: troop_ids lists them, empty = all troops
app.get('/api/posts', wrap(async (req, res) => {
  res.json((await pool.query(
    `SELECT p.id, p.kind, p.title, p.body, p.event_date::text AS event_date, p.ticker, p.pinned, p.created_at,
       COALESCE((SELECT json_agg(pt.troop_id ORDER BY pt.troop_id) FROM post_troops pt WHERE pt.post_id = p.id), '[]'::json) AS troop_ids
     FROM posts p ORDER BY p.pinned DESC, p.created_at DESC, p.id DESC LIMIT 100`)).rows);
}));
// something tied to one troop (a weekly report): the super admin's and leaders' any, an admin's or mod's own troop's
const canPost = (l, p) => roams(l) || p.troop_id === l.troop_id;
// a post: the super admin and leaders change any; an admin changes the posts its own troop is part of (so a post for all troops is theirs only)
const canEditPost = (l, troopIds) => roams(l) || troopIds.includes(l.troop_id);
// the troops a post is about. The super admin and leaders choose any set (empty or "all" = all troops); without a choice a new post is for the troop they work in
// and an edited one keeps its troops. An admin may add other troops that take part, but its own is always one of them (nobody posts only on behalf of other troops, or for all)
const postTroops = async (req, current) => {
  const v = req.body?.troop_ids, known = (await troopList()).map((x) => x.id);
  let ids;
  if (v === undefined || v === null) ids = current ?? (roams(req.leader) ? [req.troop] : []);
  else if (v === 'all') ids = [];
  else {
    if (!Array.isArray(v) || v.length > known.length) throw invalid();
    ids = [...new Set(v.map(intId))];
    if (!ids.every((x) => known.includes(x))) throw invalid();
  }
  return roams(req.leader) ? ids : [...new Set([req.leader.troop_id, ...ids])];
};
app.post('/api/posts', requireLeader, requirePoster, wrap(async (req, res) => {
  const f = postFields(req.body), ids = await postTroops(req);
  const id = await tx(async (c) => {
    const { rows } = await c.query(
      'INSERT INTO posts (kind, title, body, event_date, ticker, pinned, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [f.kind, f.title, f.body, f.event_date, f.ticker, f.pinned, req.leader.id]);
    await c.query('INSERT INTO post_troops (post_id, troop_id) SELECT $1, unnest($2::int[])', [rows[0].id, ids]);
    return rows[0].id;
  });
  audit(req.leader, 'post_add', { name: f.title }, req.troop);
  res.status(201).json({ id });
}));
const postTroopIds = async (id) => (await pool.query('SELECT troop_id FROM post_troops WHERE post_id = $1', [id])).rows.map((r) => r.troop_id);
app.put('/api/posts/:id', requireLeader, requirePoster, wrap(async (req, res) => {
  const id = intId(req.params.id), f = postFields(req.body);
  if (!(await pool.query('SELECT 1 FROM posts WHERE id = $1', [id])).rows[0]) return bad(res, 'not_found', 404);
  const current = await postTroopIds(id);
  if (!canEditPost(req.leader, current)) return bad(res, 'not_found', 404);
  const ids = await postTroops(req, current);
  await tx(async (c) => {
    await c.query('UPDATE posts SET kind=$1, title=$2, body=$3, event_date=$4, ticker=$5, pinned=$6, updated_at=now() WHERE id=$7', [f.kind, f.title, f.body, f.event_date, f.ticker, f.pinned, id]);
    await c.query('DELETE FROM post_troops WHERE post_id = $1', [id]);
    await c.query('INSERT INTO post_troops (post_id, troop_id) SELECT $1, unnest($2::int[])', [id, ids]);
  });
  audit(req.leader, 'post_update', { name: f.title }, req.troop);
  res.json({ ok: true });
}));
app.delete('/api/posts/:id', requireLeader, requirePoster, wrap(async (req, res) => {
  const id = intId(req.params.id);
  const cur = (await pool.query('SELECT title FROM posts WHERE id = $1', [id])).rows[0];
  if (!cur || !canEditPost(req.leader, await postTroopIds(id))) return res.json({ ok: true });
  await pool.query('DELETE FROM posts WHERE id = $1', [id]);
  audit(req.leader, 'post_delete', { name: cur.title }, req.troop);
  res.json({ ok: true });
}));

// ---- weekly reports: what each troop did at its Saturday meeting. Everyone can read them all (public); the super admin and leaders write for any troop,
// admins and mods only for their own troop (one report per troop and Saturday) ----
const isSaturday = (d) => new Date(d + 'T00:00:00Z').getUTCDay() === 6;
app.get('/api/reports', wrap(async (req, res) => {
  res.json((await pool.query(
    `SELECT r.id, r.troop_id, r.week_date::text AS week_date, r.body, r.updated_at, COALESCE(sc.name, l.username) AS author, ${whoSql('COALESCE(r.updated_by, r.created_by)', 'author')}
     FROM weekly_reports r LEFT JOIN leaders l ON l.id = COALESCE(r.updated_by, r.created_by) LEFT JOIN scouts sc ON sc.id = l.scout_id
     ORDER BY r.week_date DESC, r.troop_id LIMIT 600`)).rows);
}));
// the weeks that were removed from the page (public: the page leaves them out)
app.get('/api/reports/removed-weeks', wrap(async (req, res) => {
  res.json((await pool.query('SELECT week_date::text AS week_date FROM report_weeks_removed ORDER BY week_date DESC')).rows.map((r) => r.week_date));
}));
// write (or rewrite) a troop's report for a week: PUT because there is only ever one
app.put('/api/reports', requireLeader, wrap(async (req, res) => {
  const week = date(req.body?.week);
  if (!week || !isSaturday(week) || Date.parse(week) > Date.now() + 2 * 86400000) throw invalid(); // the weekly meeting is on a Saturday, not in the future
  const body = text(req.body?.body, 4000);
  if (!body) throw invalid();
  let troop = req.leader.troop_id; // admins and mods: their own troop, whatever is sent
  if (roams(req.leader)) {
    troop = req.body?.troop_id == null ? req.troop : intId(req.body.troop_id);
    if (!(await troopList()).some((x) => x.id === troop)) throw invalid();
  }
  await pool.query('DELETE FROM report_weeks_removed WHERE week_date = $1', [week]); // writing a report for a removed week puts the week back
  const { rows } = await pool.query(
    `INSERT INTO weekly_reports (troop_id, week_date, body, created_by, updated_by) VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (troop_id, week_date) DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING id`,
    [troop, week, body, req.leader.id]);
  audit(req.leader, 'report_save', { name: week }, troop);
  res.json({ id: rows[0].id });
}));
app.delete('/api/reports/:id', requireLeader, wrap(async (req, res) => {
  const cur = (await pool.query('SELECT troop_id, week_date::text AS week_date FROM weekly_reports WHERE id = $1', [intId(req.params.id)])).rows[0];
  if (!cur || !canPost(req.leader, cur)) return res.json({ ok: true }); // (not found, or another troop's)
  await pool.query('DELETE FROM weekly_reports WHERE id = $1', [intId(req.params.id)]);
  audit(req.leader, 'report_delete', { name: cur.week_date }, cur.troop_id);
  res.json({ ok: true });
}));

// remove a whole week from the page: the week itself goes (with every troop's report of it), not just the reports. A week belongs to every troop, so only
// the super admin and general leaders can (the others delete their own troop's single report)
app.delete('/api/reports/week/:date', requireLeader, wrap(async (req, res) => {
  if (!roams(req.leader)) return bad(res, 'forbidden', 403);
  const week = date(req.params.date);
  if (!week) throw invalid();
  const n = await tx(async (c) => {
    const { rowCount } = await c.query('DELETE FROM weekly_reports WHERE week_date = $1', [week]);
    await c.query('INSERT INTO report_weeks_removed (week_date, removed_by) VALUES ($1,$2) ON CONFLICT DO NOTHING', [week, req.leader.id]);
    return rowCount;
  });
  audit(req.leader, 'report_week_delete', { name: week, count: n }, null);
  res.json({ ok: true, deleted: n });
}));

// ---- depot (مستودع): the inventory. Everyone can read and search it; admins, leaders and the super admin edit and remove items, only the super admin adds them ----
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
  if (rows[0]) await pool.query('DELETE FROM depot_takes b WHERE NOT EXISTS (SELECT 1 FROM depot_take_items bi WHERE bi.take_id = b.id)');
  if (rows[0]) audit(req.leader, 'depot_delete', { name: rows[0].name_en }, null);
  res.json({ ok: true });
}));

// ---- depot: taking items out and putting them back. A take is a basket of items (each with a quantity) taken at once for a troop, at the moment
// it is made (now), and counted against the stock until it is put back. It is accepted only if every item has that much available right now.
// Admins and mods take for their own troop; the super admin and leaders pick the troop. Leaders only (they show who took what). ----
const when = (v) => { const d = new Date(String(v ?? '')); if (!v || isNaN(d)) throw invalid(); return d.toISOString(); };
// who may put a take back: the one who made it, the admins of its troop, and the super admin and leaders (who work in every troop)
const canReturn = (l, b) => b.leader_id === l.id || roams(l) || (isTroopStaff(l) && b.troop_id === l.troop_id);
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
// the item names of a take for the activity log (both languages, so the log follows the reader's language)
const logItems = (lines) => lines.map((x) => ({ name_en: x.name_en, name_ar: x.name_ar, quantity: x.quantity }));
// ?returned=1: the history instead (what was put back, latest first, up to 200); nothing in it can be put back again.
// The booker's name is the display name on their scout profile (the username stored with the take if the account is gone).
app.get('/api/depot/takes', requireLeader, wrap(async (req, res) => {
  const hist = req.query.returned === '1';
  const { rows } = await pool.query(
    `SELECT b.id, b.troop_id, b.taken_at, b.returned_at, b.note, b.leader_id, COALESCE(sc.name, b.leader_name) AS leader_name, ${whoSql('b.leader_id', 'leader')},
            t.name_en AS troop_name_en, t.name_ar AS troop_name_ar,
            COALESCE(json_agg(json_build_object('item_id', bi.item_id, 'quantity', bi.quantity) ORDER BY bi.item_id) FILTER (WHERE bi.item_id IS NOT NULL), '[]') AS items
     FROM depot_takes b LEFT JOIN troops t ON t.id = b.troop_id LEFT JOIN depot_take_items bi ON bi.take_id = b.id
     LEFT JOIN leaders ld ON ld.id = b.leader_id LEFT JOIN scouts sc ON sc.id = ld.scout_id
     WHERE b.returned_at IS ${hist ? 'NOT NULL' : 'NULL'} GROUP BY b.id, t.id, sc.id ORDER BY ${hist ? 'b.returned_at DESC, b.id DESC LIMIT 200' : 'b.taken_at DESC, b.id DESC LIMIT 500'}`);
  res.json(rows.map(({ leader_id, ...b }) => ({ ...b, mine: leader_id === req.leader.id, can_return: !hist && canReturn(req.leader, { ...b, leader_id }) })));
}));
app.post('/api/depot/takes', requireLeader, wrap(async (req, res) => {
  const basket = basketOf(req.body?.items), ids = [...basket.keys()].sort((a, b) => a - b);
  // when: now unless the page sends the time the account edited it to (not in the future, at most 60 days back)
  const takenAt = req.body?.taken_at ? when(req.body.taken_at) : new Date().toISOString();
  const tm = Date.parse(takenAt);
  if (tm > Date.now() + 5 * 60000 || tm < Date.now() - 60 * 86400000) throw invalid();
  const note = text(req.body?.note, 200);
  // the troop it is for: an admin's or mod's own troop; the super admin and leaders name one (default: the troop they are working in)
  let troop = req.leader.troop_id;
  if (roams(req.leader)) {
    troop = req.body?.troop_id == null || req.body.troop_id === '' ? req.troop : intId(req.body.troop_id);
    if (!(await troopList()).some((x) => x.id === troop)) throw invalid();
  }
  const out = await tx(async (c) => {
    // the item rows are locked (always in id order, so two baskets can't deadlock) so two takes at the same moment can't both take the last ones
    const items = (await c.query('SELECT id, name_en, name_ar, quantity FROM depot_items WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [ids])).rows;
    if (items.length !== ids.length) return { status: 404 };
    // what is out right now (not yet put back) counts against the stock
    const held = new Map((await c.query(
      `SELECT bi.item_id, SUM(bi.quantity)::int AS n FROM depot_take_items bi JOIN depot_takes b ON b.id = bi.take_id
       WHERE bi.item_id = ANY($1::int[]) AND b.returned_at IS NULL GROUP BY bi.item_id`, [ids])).rows.map((r) => [r.item_id, r.n]));
    const short = items.map((i) => ({ item_id: i.id, available: Math.max(0, i.quantity - (held.get(i.id) || 0)) })).filter((x) => basket.get(x.item_id) > x.available);
    if (short.length) return { status: 409, short };
    const { rows } = await c.query('INSERT INTO depot_takes (troop_id, taken_at, note, leader_id, leader_name) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [troop, takenAt, note, req.leader.id, req.leader.username]);
    await c.query('INSERT INTO depot_take_items (take_id, item_id, quantity) SELECT $1, unnest($2::int[]), unnest($3::int[])', [rows[0].id, ids, ids.map((id) => basket.get(id))]);
    return { row: rows[0], lines: items.map((i) => ({ ...i, quantity: basket.get(i.id) })) };
  });
  if (out.status === 404) return bad(res, 'not_found', 404);
  if (out.status === 409) return res.status(409).json({ error: 'not_available', short: out.short });
  audit(req.leader, 'depot_take', { items: logItems(out.lines) }, troop);
  res.status(201).json(out.row);
}));
// put back everything in a take
// the history of what was put back: only the super admin can delete from it (one entry, or all of it); things still out are put back, not deleted
app.delete('/api/depot/takes/:id', requireLeader, requireSuper, wrap(async (req, res) => {
  const r = await pool.query('DELETE FROM depot_takes WHERE id = $1 AND returned_at IS NOT NULL', [intId(req.params.id)]);
  if (!r.rowCount) return bad(res, 'not_found', 404);
  audit(req.leader, 'depot_history_delete', { count: 1 });
  res.json({ ok: true });
}));
app.delete('/api/depot-history', requireLeader, requireSuper, wrap(async (req, res) => {
  const r = await pool.query('DELETE FROM depot_takes WHERE returned_at IS NOT NULL');
  if (r.rowCount) audit(req.leader, 'depot_history_delete', { count: r.rowCount });
  res.json({ ok: true, deleted: r.rowCount });
}));
app.put('/api/depot/takes/:id/return', requireLeader, wrap(async (req, res) => {
  const b = (await pool.query('SELECT id, troop_id, leader_id, returned_at FROM depot_takes WHERE id = $1', [intId(req.params.id)])).rows[0];
  if (!b || b.returned_at) return res.json({ ok: true });
  if (!canReturn(req.leader, b)) return bad(res, 'forbidden', 403);
  const lines = (await pool.query('SELECT d.name_en, d.name_ar, bi.quantity FROM depot_take_items bi JOIN depot_items d ON d.id = bi.item_id WHERE bi.take_id = $1 ORDER BY d.id', [b.id])).rows;
  await pool.query('UPDATE depot_takes SET returned_at = now() WHERE id = $1 AND returned_at IS NULL', [b.id]);
  audit(req.leader, 'depot_return', { items: logItems(lines) }, b.troop_id);
  res.json({ ok: true });
}));

// ---- attendance register (الحضور): every troop keeps its own meetings and events and marks each scout present, absent, or neither.
// Each meeting/event has an XP value for attending (default 10, 0 = none) that every scout marked present gets automatically as an XP entry
// "Attended <title>", and an XP value taken for not attending (default 0 = none) that every scout marked absent loses ("Absent: <title>", a negative entry).
// Changing or clearing a mark takes its XP back; deleting the meeting removes it all. Marks with XP go to the activity log.
// Every signed-in account of the troop can take attendance; deleting a meeting is closed to mods. Leader-only: nothing here is public. ----
const NOT_SUPER = "NOT EXISTS (SELECT 1 FROM leaders l WHERE l.scout_id = s.id AND l.role = 'super_admin')"; // the super admin belongs to no troop, so is never on an attendance sheet
const meetingBody = (b) => {
  const day = date(b?.date);
  if (!day || Date.parse(day) > Date.now() + 2 * 86400000) throw invalid(); // a date is required; none in the future
  const kind = b?.kind == null || b.kind === '' ? 'meeting' : b.kind;
  if (!['meeting', 'event', 'patrol'].includes(kind)) throw invalid();
  const title = text(b?.title, 80);
  if (!title) throw invalid(); // a title is required
  const xps = [b?.xp == null || b.xp === '' ? 10 : Number(b.xp), b?.absent_xp == null || b.absent_xp === '' ? 0 : Number(b.absent_xp)];
  if (xps.some((x) => !Number.isInteger(x) || x < 0 || x > 1000)) throw invalid(); // XP for attending / taken for absence: 0 (none) to 1000
  return [day, title, kind, ...xps];
};
// the names of the XP entries: "Attended <title>" / "حضر <title>", "Absent: <title>" / "غاب عن <title>"
const ATTENDED = ['Attended ', 'حضر '], ABSENT = ['Absent: ', 'غاب عن '];
// give these scouts the XP of their mark for this meeting (the unique index allows one XP entry per scout and meeting, so a second grant is a no-op).
// m = { id, xp, absent_xp }; present = true: +xp as attended, false: -absent_xp as absent
async function grantMarkXp(c, m, scoutIds, leader, present) {
  const xp = present ? m.xp : m.absent_xp;
  if (!scoutIds.length || !xp) return;
  const names = present ? ATTENDED : ABSENT;
  await c.query(
    `INSERT INTO xp_log (scout_id, activity, activity_ar, xp, note, leader_id, activity_date, meeting_id)
     SELECT sid, $2::text || mt.title, $3::text || mt.title, $4, NULL, $5, mt.meeting_date, mt.id FROM meetings mt, unnest($1::int[]) AS sid WHERE mt.id = $6
     ON CONFLICT (meeting_id, scout_id) WHERE meeting_id IS NOT NULL DO NOTHING`, [scoutIds, names[0], names[1], present ? xp : -xp, leader.id, m.id]);
}
// a patrol meeting's sheet lists only that patrol's scouts (SQL to append to a WHERE on scouts `s`; patrol_id comes from the database)
const sheetSql = (m) => (m.kind === 'patrol' ? ` AND s.patrol_id = ${Number(m.patrol_id) || 0}` : '');
const meetingOf = async (req, id) => {
  const m = (await pool.query('SELECT id, meeting_date, title, kind, xp, absent_xp, patrol_id FROM meetings WHERE id = $1 AND troop_id = $2', [id, req.troop])).rows[0];
  if (m && !(await xpOn(req.troop))) { m.xp = 0; m.absent_xp = 0; } // a troop without XP: attendance gives and takes none
  return m;
};

app.get('/api/meetings', requireLeader, wrap(async (req, res) => {
  res.json((await pool.query(
    `SELECT m.id, m.meeting_date, m.title, m.kind, m.xp, m.absent_xp, m.patrol_id,
       (SELECT COUNT(*) FROM meeting_attendance a JOIN scouts s ON s.id = a.scout_id WHERE a.meeting_id = m.id AND s.active AND ${NOT_SUPER})::int AS present
     FROM meetings m WHERE m.troop_id = $1 ORDER BY m.meeting_date DESC, m.id DESC LIMIT 300`, [req.troop])).rows);
}));

// per scout: meetings and events attended out of the troop's held since the scout joined
app.get('/api/attendance/summary', requireLeader, wrap(async (req, res) => {
  res.json((await pool.query(
    `SELECT s.id, COUNT(m.id)::int AS total, COUNT(a.scout_id)::int AS attended
     FROM scouts s
     LEFT JOIN meetings m ON m.troop_id = s.troop_id AND (s.join_date IS NULL OR m.meeting_date >= s.join_date) AND (m.kind <> 'patrol' OR m.patrol_id = s.patrol_id)
     LEFT JOIN meeting_attendance a ON a.meeting_id = m.id AND a.scout_id = s.id
     WHERE s.troop_id = $1 AND s.active AND ${NOT_SUPER} GROUP BY s.id`, [req.troop])).rows);
}));

// a mod can only create patrol meetings, for its own patrol (it can't edit or delete any meeting afterwards); everyone else adds meetings, events and (for a patrol they pick) patrol meetings
app.post('/api/meetings', requireLeader, wrap(
async (req, res) => {
  let [day, title, kind, xp, absentXp] = meetingBody(req.body);
  if (!(await xpOn(req.troop))) xp = absentXp = 0;
  let patrolId = null;
  if (modOnly(req)) {
    if (!req.patrol) return bad(res, 'no_patrol', 403);
    kind = 'patrol'; patrolId = req.patrol;
  } else if (kind === 'patrol') {
    patrolId = intId(req.body?.patrol_id);
    if (!(await pool.query('SELECT 1 FROM patrols WHERE id = $1 AND troop_id = $2 AND NOT is_leadership', [patrolId, req.troop])).rows[0]) return bad(res, 'not_found', 404); // a regular patrol of this troop
  }
  const { rows } = await pool.query('INSERT INTO meetings (troop_id, meeting_date, title, kind, xp, absent_xp, created_by, patrol_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, meeting_date, title, kind, xp, absent_xp, patrol_id', [req.troop, day, title, kind, xp, absentXp, req.leader.id, patrolId]);
  audit(req.leader, 'meeting_add', { name: `${day} ${title}` }, req.troop);
  res.status(201).json({ ...rows[0], present: 0 });
}));

app.get('/api/meetings/:id', requireLeader, wrap(async (req, res) => {
  const m = await meetingOf(req, intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  const [pres, abs] = await Promise.all([
    pool.query('SELECT scout_id FROM meeting_attendance WHERE meeting_id = $1', [m.id]),
    pool.query('SELECT scout_id, excused FROM meeting_absences WHERE meeting_id = $1', [m.id])]);
  res.json({ ...m, present_ids: pres.rows.map((r) => r.scout_id), absent_ids: abs.rows.filter((r) => !r.excused).map((r) => r.scout_id), excused_ids: abs.rows.filter((r) => r.excused).map((r) => r.scout_id) });
}));

app.put('/api/meetings/:id', requireLeader, requireNotMod, wrap(async (req, res) => {
  const [day, title, kindIn, xp, absentXp] = meetingBody(req.body);
  const m = await meetingOf(req, intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  if (m.kind !== 'patrol' && kindIn === 'patrol') throw invalid(); // a patrol meeting is created as one; an existing meeting or event doesn't become one
  const kind = m.kind === 'patrol' ? 'patrol' : kindIn; // ...and a patrol meeting stays one, with its patrol
  const withXp = await xpOn(req.troop);
  await tx(async (c) => {
    if (!withXp) { // no XP here: only the plain details change (stored XP values and entries are left alone)
      await c.query('UPDATE meetings SET meeting_date = $1, title = $2, kind = $3 WHERE id = $4', [day, title, kind, m.id]);
      return;
    }
    await c.query('UPDATE meetings SET meeting_date = $1, title = $2, kind = $3, xp = $4, absent_xp = $5 WHERE id = $6', [day, title, kind, xp, absentXp, m.id]);
    // the XP already given follows the meeting's new date, title and values: for the present (table meeting_attendance) and the absent (meeting_absences)
    for (const [table, names, newXp, oldXp, sign, isPresent] of [['meeting_attendance', ATTENDED, xp, m.xp, 1, true], ['meeting_absences', ABSENT, absentXp, m.absent_xp, -1, false]]) {
      const only = isPresent ? '' : ' AND NOT t.excused'; // an excused absence has no XP entry
      if (newXp === 0) {
        await c.query(`DELETE FROM xp_log x USING ${table} t WHERE x.meeting_id = $1 AND t.meeting_id = x.meeting_id AND t.scout_id = x.scout_id${only}`, [m.id]); // none for this mark any more
      } else {
        await c.query(`UPDATE xp_log x SET activity = $1::text || $3::text, activity_ar = $2::text || $3::text, xp = $4, note = NULL, activity_date = $5 FROM ${table} t WHERE x.meeting_id = $6 AND t.meeting_id = x.meeting_id AND t.scout_id = x.scout_id${only}`,
          [names[0], names[1], title, sign * newXp, day, m.id]);
        if (!oldXp) { // it was off: the scouts already marked get it now
          const ids = (await c.query(`SELECT t.scout_id FROM ${table} t JOIN scouts s ON s.id = t.scout_id WHERE t.meeting_id = $1 AND s.active AND ${NOT_SUPER}${only}`, [m.id])).rows.map((r) => r.scout_id);
          await grantMarkXp(c, { id: m.id, xp, absent_xp: absentXp }, ids, req.leader, isPresent);
        }
      }
    }
  });
  audit(req.leader, 'meeting_update', { name: `${day} ${title}` }, req.troop);
  res.json({ ok: true });
}));

app.delete('/api/meetings/:id', requireLeader, requireNotMod, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM meetings WHERE id = $1 AND troop_id = $2 RETURNING meeting_date, title', [intId(req.params.id), req.troop]); // a mod: only its patrol's meetings // its marks and the XP they gave go with it
  if (rows[0]) audit(req.leader, 'meeting_delete', { name: `${rows[0].meeting_date}${rows[0].title ? ' ' + rows[0].title : ''}` }, req.troop);
  res.json({ ok: true });
}));

// everyone at once. status: 'present' = every active scout of the troop present; 'absent' = the scouts with no mark yet absent; 'none' = clear the whole sheet.
// One activity log entry per action (only when XP is involved).
app.put('/api/meetings/:id/attendance', requireLeader, wrap(async (req, res) => {
  const m = await meetingOf(req, intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  const status = req.body?.status;
  if (!['present', 'absent', 'none'].includes(status)) throw invalid();
  const everyone = `SELECT s.id FROM scouts s WHERE s.troop_id = $2 AND s.active AND ${NOT_SUPER}${patrolSql(req, 's')}${sheetSql(m)}`; // a mod: its patrol only
  const mine = modOnly(req) ? ` AND scout_id IN (SELECT s.id FROM scouts s WHERE true${patrolSql(req, 's')})` : ''; // clearing the sheet: a mod clears its patrol's marks only
  const count = await tx(async (c) => {
    if (status === 'present') {
      // scouts marked absent become present: their absence (and its XP) goes first
      await c.query(`DELETE FROM xp_log x USING meeting_absences t WHERE x.meeting_id = $1 AND t.meeting_id = x.meeting_id AND t.scout_id = x.scout_id AND t.scout_id IN (${everyone})`, [m.id, req.troop]);
      await c.query(`DELETE FROM meeting_absences WHERE meeting_id = $1 AND scout_id IN (${everyone})`, [m.id, req.troop]);
      const r = await c.query(`INSERT INTO meeting_attendance (meeting_id, scout_id) ${everyone.replace('SELECT s.id', 'SELECT $1, s.id')} ON CONFLICT DO NOTHING RETURNING scout_id`, [m.id, req.troop]);
      await grantMarkXp(c, m, r.rows.map((x) => x.scout_id), req.leader, true); // only those newly marked
      return r.rowCount;
    }
    if (status === 'absent') {
      const r = await c.query(
        `INSERT INTO meeting_absences (meeting_id, scout_id) SELECT $1, s.id FROM scouts s WHERE s.troop_id = $2 AND s.active AND ${NOT_SUPER}${patrolSql(req, 's')}${sheetSql(m)}
           AND NOT EXISTS (SELECT 1 FROM meeting_attendance a WHERE a.meeting_id = $1 AND a.scout_id = s.id) ON CONFLICT DO NOTHING RETURNING scout_id`, [m.id, req.troop]);
      await grantMarkXp(c, m, r.rows.map((x) => x.scout_id), req.leader, false);
      return r.rowCount;
    }
    const p = await c.query(`DELETE FROM meeting_attendance WHERE meeting_id = $1${mine}`, [m.id]);
    const a = await c.query(`DELETE FROM meeting_absences WHERE meeting_id = $1${mine}`, [m.id]);
    await c.query(`DELETE FROM xp_log WHERE meeting_id = $1${mine}`, [m.id]);
    return { present: p.rowCount, absent: a.rowCount };
  });
  if (status === 'present' && count && m.xp) audit(req.leader, 'attendance_bulk', { title: m.title, xp: m.xp, count }, req.troop);
  if (status === 'absent' && count && m.absent_xp) audit(req.leader, 'absence_bulk', { title: m.title, xp: -m.absent_xp, count }, req.troop);
  if (status === 'none') {
    if (count.present && m.xp) audit(req.leader, 'attendance_bulk_undo', { title: m.title, xp: m.xp, count: count.present }, req.troop);
    if (count.absent && m.absent_xp) audit(req.leader, 'absence_bulk_undo', { title: m.title, xp: -m.absent_xp, count: count.absent }, req.troop);
  }
  res.json({ ok: true });
}));

// one scout: status = 'present' | 'absent' (no excuse: loses the absence XP) | 'excused' (absent with an excuse: no XP) | 'none'.
// Changing a mark takes the old mark's XP back and gives the new one's.
app.put('/api/meetings/:id/attendance/:scoutId', requireLeader, wrap(async (req, res) => {
  const m = await meetingOf(req, intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  const status = req.body?.status;
  if (!['present', 'absent', 'excused', 'none'].includes(status)) throw invalid();
  const sid = intId(req.params.scoutId);
  const sc = (await pool.query(`SELECT s.name, s.active, ${NOT_SUPER} AS ok FROM scouts s WHERE s.id = $1 AND s.troop_id = $2${patrolSql(req, 's')}${sheetSql(m)}`, [sid, req.troop])).rows[0]; // only a scout of this troop (a mod: of its patrol)
  if (!sc || (status !== 'none' && !(sc.active && sc.ok))) return bad(res, 'not_found', 404); // marking: an active scout; the super admin is never on a sheet
  const before = await tx(async (c) => {
    const was = (await c.query('SELECT EXISTS (SELECT 1 FROM meeting_attendance WHERE meeting_id = $1 AND scout_id = $2) AS p, (SELECT excused FROM meeting_absences WHERE meeting_id = $1 AND scout_id = $2) AS e', [m.id, sid])).rows[0];
    const prev = was.p ? 'present' : was.e === true ? 'excused' : was.e === false ? 'absent' : 'none';
    if (prev === status) return prev; // nothing changes
    await c.query('DELETE FROM meeting_attendance WHERE meeting_id = $1 AND scout_id = $2', [m.id, sid]);
    await c.query('DELETE FROM meeting_absences WHERE meeting_id = $1 AND scout_id = $2', [m.id, sid]);
    await c.query('DELETE FROM xp_log WHERE meeting_id = $1 AND scout_id = $2', [m.id, sid]); // the old mark's XP is taken back
    if (status === 'present') await c.query('INSERT INTO meeting_attendance (meeting_id, scout_id) VALUES ($1,$2)', [m.id, sid]);
    if (status === 'absent' || status === 'excused') await c.query('INSERT INTO meeting_absences (meeting_id, scout_id, excused) VALUES ($1,$2,$3)', [m.id, sid, status === 'excused']);
    if (status === 'present' || status === 'absent') await grantMarkXp(c, m, [sid], req.leader, status === 'present'); // an excused absence takes nothing
    return prev;
  });
  if (before !== status) {
    const meta = (xp) => ({ name: sc.name, title: m.title, xp });
    if (before === 'present' && m.xp) audit(req.leader, 'attendance_undo', meta(m.xp), req.troop);
    if (before === 'absent' && m.absent_xp) audit(req.leader, 'absence_undo', meta(-m.absent_xp), req.troop);
    if (status === 'present' && m.xp) audit(req.leader, 'attendance', meta(m.xp), req.troop);
    if (status === 'absent' && m.absent_xp) audit(req.leader, 'absence', meta(-m.absent_xp), req.troop);
    if (status === 'excused') audit(req.leader, 'absence_excused', { name: sc.name, title: m.title }, req.troop);
  }
  res.json({ ok: true });
}));

// ---- the musical team (الفريق الموسيقي): one team for the whole site, made of existing scouts (each keeps their scout profile in their own troop; nobody is created here)
// in two groups, brass (فريق نحاسي) and percussion (فريق إيقاع), each split into two sub teams (فريق أول / فريق ثاني). It has its own weekly practices (تدريبات) with attendance, its own XP (music_xp_log) separate from
// every troop's XP. Everyone can see the team, its groups and the XP; the attendance register is signed-in only. The super admin, admins and leaders manage it
// (members from any troop, practices, attendance, XP, the instruments depot): every signed-in account except the helper; the helper only looks. ----
const MUSIC_GROUPS = ['brass', 'percussion'];
const musicGroup = (v) => { if (!MUSIC_GROUPS.includes(v)) throw invalid(); return v; };
// each group has two sub teams: 1 (فريق أول) and 2 (فريق ثاني); none given = 1
const musicSub = (v) => { const n = v == null || v === '' ? 1 : Number(v); if (n !== 1 && n !== 2) throw invalid(); return n; };
const requireMusicManager = (req, res, next) => (req.leader.role !== 'helper' ? next() : bad(res, 'forbidden', 403)); // every signed-in account but the helper
// the members that can be on a sheet: active scouts (a deactivated member is hidden, and comes back when reactivated)
const MUSIC_TEAM = 'SELECT mb.scout_id AS id FROM music_members mb JOIN scouts s ON s.id = mb.scout_id WHERE s.active';
const MUSIC_PHOTO = '(s.photo IS NOT NULL AND NOT s.photo_hidden) AS has_photo'; // like the dashboard: a hidden picture stays hidden

// public: the team, both groups, with each member's own troop and music XP
app.get('/api/music', wrap(async (req, res) => {
  res.json((await pool.query(
    `SELECT s.id, s.name, mb.grp, mb.sub, s.troop_id, s.photo_v, ${MUSIC_PHOTO},
       COALESCE((SELECT SUM(x.xp) FROM music_xp_log x WHERE x.scout_id = s.id), 0)::int AS total_xp
     FROM music_members mb JOIN scouts s ON s.id = mb.scout_id WHERE s.active
     ORDER BY mb.grp, mb.sub, total_xp DESC, s.name`)).rows);
}));
// public: one member's page (music XP history)
app.get('/api/music/members/:id', wrap(async (req, res) => {
  const id = intId(req.params.id);
  const [s, log] = await Promise.all([
    pool.query(`SELECT s.id, s.name, s.troop_id, mb.grp, mb.sub, s.photo_v, ${MUSIC_PHOTO} FROM music_members mb JOIN scouts s ON s.id = mb.scout_id WHERE s.id = $1 AND s.active`, [id]),
    pool.query(
      `SELECT id, activity, activity_ar, xp, note, COALESCE(activity_date, created_at::date)::text AS day
       FROM music_xp_log WHERE scout_id = $1 ORDER BY COALESCE(activity_date, created_at::date) DESC, created_at DESC, id DESC`, [id])]);
  if (!s.rows[0]) return bad(res, 'not_found', 404);
  res.json({ ...s.rows[0], roles: [], total_xp: log.rows.reduce((sum, r) => sum + r.xp, 0), log: log.rows });
}));

// managers: the scouts that can still be added (active, any troop, not the super admin who belongs to none)
app.get('/api/music/candidates', requireLeader, requireMusicManager, wrap(async (req, res) => {
  res.json((await pool.query(
    `SELECT s.id, s.name, s.troop_id FROM scouts s
     WHERE s.active AND ${NOT_SUPER} AND NOT EXISTS (SELECT 1 FROM music_members mb WHERE mb.scout_id = s.id) ORDER BY s.troop_id, s.name`)).rows);
}));
app.post('/api/music/members', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const id = intId(req.body?.scout_id), grp = musicGroup(req.body?.grp), sub = musicSub(req.body?.sub);
  const sc = (await pool.query(`SELECT s.id, s.name, s.troop_id FROM scouts s WHERE s.id = $1 AND s.active AND ${NOT_SUPER}`, [id])).rows[0]; // an existing scout profile: nothing is created here
  if (!sc) return bad(res, 'not_found', 404);
  const r = await pool.query('INSERT INTO music_members (scout_id, grp, sub, added_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [id, grp, sub, req.leader.id]);
  if (!r.rowCount) return bad(res, 'music_already', 409);
  audit(req.leader, 'music_member_add', { name: sc.name, group: grp, sub }, sc.troop_id);
  res.status(201).json({ ok: true });
}));
app.put('/api/music/members/:id', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const grp = musicGroup(req.body?.grp), sub = musicSub(req.body?.sub);
  const { rows } = await pool.query('UPDATE music_members mb SET grp = $1, sub = $2 FROM scouts s WHERE mb.scout_id = $3 AND s.id = mb.scout_id RETURNING s.name, s.troop_id', [grp, sub, intId(req.params.id)]);
  if (!rows[0]) return bad(res, 'not_found', 404);
  audit(req.leader, 'music_member_group', { name: rows[0].name, group: grp, sub }, rows[0].troop_id);
  res.json({ ok: true });
}));
// leaving the team: the scout stays in their troop; the team's XP and marks stay stored and come back if they are added again
app.delete('/api/music/members/:id', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM music_members mb USING scouts s WHERE mb.scout_id = $1 AND s.id = mb.scout_id RETURNING s.name, s.troop_id', [intId(req.params.id)]);
  if (rows[0]) audit(req.leader, 'music_member_remove', { name: rows[0].name }, rows[0].troop_id);
  res.json({ ok: true });
}));

// the team's own XP: a one-off award with its own title (a negative value deducts), and undoing an entry
app.post('/api/music/members/:id/xp', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const id = intId(req.params.id), title = text(req.body?.title, 80), xp = Number(req.body?.xp), note = text(req.body?.note, 200), day = date(req.body?.date);
  if (!title || !Number.isInteger(xp) || xp === 0 || Math.abs(xp) > 10000) throw invalid();
  if (day && Date.parse(day) > Date.now() + 2 * 86400000) throw invalid(); // no dates in the future
  const sc = (await pool.query('SELECT s.name, s.troop_id FROM music_members mb JOIN scouts s ON s.id = mb.scout_id WHERE s.id = $1 AND s.active', [id])).rows[0];
  if (!sc) return bad(res, 'not_found', 404);
  await pool.query(
    'INSERT INTO music_xp_log (scout_id, activity, activity_ar, xp, note, leader_id, activity_date) VALUES ($1,$2,$2,$3,$4,$5, COALESCE($6::date, CURRENT_DATE))', [id, title, xp, note, req.leader.id, day]);
  audit(req.leader, 'music_xp_award', { name: sc.name, activity_en: title, activity_ar: title, xp }, sc.troop_id);
  res.status(201).json({ ok: true });
}));
app.delete('/api/music/xp/:id', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM music_xp_log x USING scouts s WHERE x.id = $1 AND s.id = x.scout_id RETURNING s.name, s.troop_id, x.activity, x.activity_ar, x.xp', [intId(req.params.id)]);
  if (rows[0]) audit(req.leader, 'music_xp_undo', { name: rows[0].name, activity_en: rows[0].activity, activity_ar: rows[0].activity_ar || rows[0].activity, xp: rows[0].xp }, rows[0].troop_id);
  res.json({ ok: true });
}));

// ---- the team's depot: the instruments inventory (public to read; the managers add, edit and remove). Not the troops' depot, and nothing is taken out of it ----
const musicDepotBody = (b) => {
  const en = text(b?.name_en, 80), ar = text(b?.name_ar, 80), quantity = Number(b?.quantity);
  const grp = b?.grp == null || b.grp === '' ? null : musicGroup(b.grp); // empty: used by both groups
  if ((!en && !ar) || !Number.isInteger(quantity) || quantity < 0 || quantity > 1000000) throw invalid();
  return [en || ar, ar || en, grp, quantity, text(b?.notes, 500)];
};
app.get('/api/music/depot', wrap(async (req, res) => {
  res.json((await pool.query('SELECT id, name_en, name_ar, grp, quantity, notes, updated_at FROM music_depot_items ORDER BY name_ar, id')).rows);
}));
app.post('/api/music/depot', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const v = musicDepotBody(req.body);
  const { rows } = await pool.query('INSERT INTO music_depot_items (name_en, name_ar, grp, quantity, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id', v);
  audit(req.leader, 'music_depot_add', { name: v[0], quantity: v[3] }, null);
  res.status(201).json({ id: rows[0].id });
}));
app.put('/api/music/depot/:id', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const v = musicDepotBody(req.body);
  const r = await pool.query('UPDATE music_depot_items SET name_en = $1, name_ar = $2, grp = $3, quantity = $4, notes = $5, updated_at = now() WHERE id = $6', [...v, intId(req.params.id)]);
  if (!r.rowCount) return bad(res, 'not_found', 404);
  audit(req.leader, 'music_depot_update', { name: v[0], quantity: v[3] }, null);
  res.json({ ok: true });
}));
app.delete('/api/music/depot/:id', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM music_depot_items WHERE id = $1 RETURNING name_en', [intId(req.params.id)]);
  if (rows[0]) audit(req.leader, 'music_depot_delete', { name: rows[0].name_en }, null);
  res.json({ ok: true });
}));

// ---- the team's practices (تدريبات, the weekly practice meetings) and attendance (signed-in accounts read them; the managers write) ----
const musicMeetingBody = (b) => {
  const day = date(b?.date);
  if (!day || Date.parse(day) > Date.now() + 2 * 86400000) throw invalid(); // a date is required; none in the future
  const title = text(b?.title, 80);
  if (!title) throw invalid(); // a title is required
  const xps = [b?.xp == null || b.xp === '' ? 10 : Number(b.xp), b?.absent_xp == null || b.absent_xp === '' ? 0 : Number(b.absent_xp)];
  if (xps.some((x) => !Number.isInteger(x) || x < 0 || x > 1000)) throw invalid(); // XP for attending / taken for absence: 0 (none) to 1000
  return [day, title, ...xps];
};
const musicMeetingOf = async (id) => (await pool.query('SELECT id, meeting_date, title, xp, absent_xp FROM music_meetings WHERE id = $1', [id])).rows[0];
// give these members the XP of their mark for this meeting (one entry per member and meeting; a second grant is a no-op), same names as the troops' attendance entries
async function musicGrant(c, m, ids, leader, present) {
  const xp = present ? m.xp : m.absent_xp, names = present ? ATTENDED : ABSENT;
  if (!ids.length || !xp) return;
  await c.query(
    `INSERT INTO music_xp_log (scout_id, activity, activity_ar, xp, leader_id, activity_date, meeting_id)
     SELECT sid, $2::text || mt.title, $3::text || mt.title, $4, $5, mt.meeting_date, mt.id FROM music_meetings mt, unnest($1::int[]) AS sid WHERE mt.id = $6
     ON CONFLICT (meeting_id, scout_id) WHERE meeting_id IS NOT NULL DO NOTHING`, [ids, names[0], names[1], present ? xp : -xp, leader.id, m.id]);
}

app.get('/api/music/meetings', requireLeader, wrap(async (req, res) => {
  res.json((await pool.query(
    `SELECT m.id, m.meeting_date, m.title, m.xp, m.absent_xp,
       (SELECT COUNT(*) FROM music_attendance a JOIN music_members mb ON mb.scout_id = a.scout_id JOIN scouts s ON s.id = a.scout_id WHERE a.meeting_id = m.id AND a.status = 'present' AND s.active)::int AS present
     FROM music_meetings m ORDER BY m.meeting_date DESC, m.id DESC LIMIT 300`)).rows);
}));
// per member: meetings attended out of those held since they were added (or that they were marked for)
app.get('/api/music/summary', requireLeader, wrap(async (req, res) => {
  res.json((await pool.query(
    `SELECT mb.scout_id AS id, COUNT(mt.id)::int AS total, COUNT(a.scout_id) FILTER (WHERE a.status = 'present')::int AS attended
     FROM music_members mb JOIN scouts s ON s.id = mb.scout_id AND s.active
     LEFT JOIN music_meetings mt ON mt.meeting_date >= mb.added_at::date OR EXISTS (SELECT 1 FROM music_attendance x WHERE x.meeting_id = mt.id AND x.scout_id = mb.scout_id)
     LEFT JOIN music_attendance a ON a.meeting_id = mt.id AND a.scout_id = mb.scout_id
     GROUP BY mb.scout_id`)).rows);
}));
app.post('/api/music/meetings', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const [day, title, xp, absentXp] = musicMeetingBody(req.body);
  const { rows } = await pool.query('INSERT INTO music_meetings (meeting_date, title, xp, absent_xp, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, meeting_date, title, xp, absent_xp', [day, title, xp, absentXp, req.leader.id]);
  audit(req.leader, 'music_meeting_add', { name: `${day} ${title}` }, null);
  res.status(201).json({ ...rows[0], present: 0 });
}));
app.get('/api/music/meetings/:id', requireLeader, wrap(async (req, res) => {
  const m = await musicMeetingOf(intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  const marks = (await pool.query('SELECT scout_id, status FROM music_attendance WHERE meeting_id = $1', [m.id])).rows;
  const ids = (st) => marks.filter((r) => r.status === st).map((r) => r.scout_id);
  res.json({ ...m, present_ids: ids('present'), absent_ids: ids('absent'), excused_ids: ids('excused') });
}));
app.put('/api/music/meetings/:id', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const [day, title, xp, absentXp] = musicMeetingBody(req.body);
  const m = await musicMeetingOf(intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  await tx(async (c) => {
    await c.query('UPDATE music_meetings SET meeting_date = $1, title = $2, xp = $3, absent_xp = $4 WHERE id = $5', [day, title, xp, absentXp, m.id]);
    // the XP already given follows the meeting's new date, title and values (0 removes it; raising it from 0 gives it to those already marked)
    for (const [status, names, newXp, oldXp, sign] of [['present', ATTENDED, xp, m.xp, 1], ['absent', ABSENT, absentXp, m.absent_xp, -1]]) {
      if (newXp === 0) {
        await c.query('DELETE FROM music_xp_log x USING music_attendance t WHERE x.meeting_id = $1 AND t.meeting_id = x.meeting_id AND t.scout_id = x.scout_id AND t.status = $2', [m.id, status]);
        continue;
      }
      await c.query(
        `UPDATE music_xp_log x SET activity = $1::text || $3::text, activity_ar = $2::text || $3::text, xp = $4, note = NULL, activity_date = $5
         FROM music_attendance t WHERE x.meeting_id = $6 AND t.meeting_id = x.meeting_id AND t.scout_id = x.scout_id AND t.status = $7`, [names[0], names[1], title, sign * newXp, day, m.id, status]);
      if (!oldXp) {
        const ids = (await c.query(
          `SELECT t.scout_id FROM music_attendance t JOIN music_members mb ON mb.scout_id = t.scout_id JOIN scouts s ON s.id = t.scout_id WHERE t.meeting_id = $1 AND t.status = $2 AND s.active`, [m.id, status])).rows.map((r) => r.scout_id);
        await musicGrant(c, { id: m.id, xp, absent_xp: absentXp }, ids, req.leader, status === 'present');
      }
    }
  });
  audit(req.leader, 'music_meeting_update', { name: `${day} ${title}` }, null);
  res.json({ ok: true });
}));
app.delete('/api/music/meetings/:id', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const { rows } = await pool.query('DELETE FROM music_meetings WHERE id = $1 RETURNING meeting_date, title', [intId(req.params.id)]); // its marks and the XP they gave go with it
  if (rows[0]) audit(req.leader, 'music_meeting_delete', { name: `${rows[0].meeting_date} ${rows[0].title}` }, null);
  res.json({ ok: true });
}));
// everyone at once. status: 'present' = every active member present; 'absent' = the members with no mark yet absent (no excuse); 'none' = clear the whole sheet
app.put('/api/music/meetings/:id/attendance', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const m = await musicMeetingOf(intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  const status = req.body?.status;
  if (!['present', 'absent', 'none'].includes(status)) throw invalid();
  const count = await tx(async (c) => {
    if (status === 'present') {
      // members marked absent become present: their absence XP goes first
      await c.query(`DELETE FROM music_xp_log x USING music_attendance a WHERE x.meeting_id = $1 AND a.meeting_id = x.meeting_id AND a.scout_id = x.scout_id AND a.status = 'absent' AND a.scout_id IN (${MUSIC_TEAM})`, [m.id]);
      const r = await c.query(
        `INSERT INTO music_attendance (meeting_id, scout_id, status) SELECT $1::int, e.id, 'present' FROM (${MUSIC_TEAM}) e
         ON CONFLICT (meeting_id, scout_id) DO UPDATE SET status = 'present' WHERE music_attendance.status <> 'present' RETURNING scout_id`, [m.id]);
      await musicGrant(c, m, r.rows.map((x) => x.scout_id), req.leader, true); // only those newly marked
      return r.rowCount;
    }
    if (status === 'absent') {
      const r = await c.query(
        `INSERT INTO music_attendance (meeting_id, scout_id, status) SELECT $1::int, e.id, 'absent' FROM (${MUSIC_TEAM}) e
         WHERE NOT EXISTS (SELECT 1 FROM music_attendance a WHERE a.meeting_id = $1 AND a.scout_id = e.id) ON CONFLICT DO NOTHING RETURNING scout_id`, [m.id]);
      await musicGrant(c, m, r.rows.map((x) => x.scout_id), req.leader, false);
      return r.rowCount;
    }
    const a = await c.query('DELETE FROM music_attendance WHERE meeting_id = $1', [m.id]);
    await c.query('DELETE FROM music_xp_log WHERE meeting_id = $1', [m.id]);
    return a.rowCount;
  });
  if (count) audit(req.leader, 'music_mark_bulk', { title: m.title, status, count }, null);
  res.json({ ok: true });
}));
// one member: status = 'present' | 'absent' (no excuse: loses the absence XP) | 'excused' (no XP) | 'none'. Changing a mark takes the old mark's XP back and gives the new one's.
app.put('/api/music/meetings/:id/attendance/:scoutId', requireLeader, requireMusicManager, wrap(async (req, res) => {
  const m = await musicMeetingOf(intId(req.params.id));
  if (!m) return bad(res, 'not_found', 404);
  const status = req.body?.status;
  if (!['present', 'absent', 'excused', 'none'].includes(status)) throw invalid();
  const sid = intId(req.params.scoutId);
  const sc = (await pool.query('SELECT s.name, s.troop_id, s.active FROM music_members mb JOIN scouts s ON s.id = mb.scout_id WHERE mb.scout_id = $1', [sid])).rows[0]; // only a member of the team
  if (!sc || (status !== 'none' && !sc.active)) return bad(res, 'not_found', 404);
  const before = await tx(async (c) => {
    const prev = (await c.query('SELECT status FROM music_attendance WHERE meeting_id = $1 AND scout_id = $2', [m.id, sid])).rows[0]?.status || 'none';
    if (prev === status) return prev; // nothing changes
    await c.query('DELETE FROM music_attendance WHERE meeting_id = $1 AND scout_id = $2', [m.id, sid]);
    await c.query('DELETE FROM music_xp_log WHERE meeting_id = $1 AND scout_id = $2', [m.id, sid]); // the old mark's XP is taken back
    if (status !== 'none') await c.query('INSERT INTO music_attendance (meeting_id, scout_id, status) VALUES ($1,$2,$3)', [m.id, sid, status]);
    if (status === 'present' || status === 'absent') await musicGrant(c, m, [sid], req.leader, status === 'present'); // an excused absence takes nothing
    return prev;
  });
  if (before !== status) audit(req.leader, 'music_mark', { name: sc.name, title: m.title, status, xp: status === 'present' ? m.xp : status === 'absent' ? -m.absent_xp : 0 }, sc.troop_id);
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
    firstTroop = (await pool.query("INSERT INTO troops (name_en, name_ar, level) VALUES ('Rovers', 'الجوالة', 1) RETURNING id")).rows[0].id;
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
