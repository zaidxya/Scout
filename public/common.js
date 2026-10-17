const state = { lang: 'ar', dict: {} };

// ---- visual identity ----
// The main site (home dashboard, login screen) uses the purple main identity. Each troop picks a theme
// (see the :root[data-theme=...] blocks in style.css); the leader area switches to it after sign-in.
const THEMES = {
  default: { logo: '/logo-mark.png', wordmark: false, color: '#671e93' },
  rovers: { logo: '/logo.jpg', wordmark: true, color: '#4a0313' },
  forest: { logo: '/logo-mark.png', wordmark: false, color: '#1d5c3f' }, // Forest (boys)
  forest_girls: { logo: '/logo-mark.png', wordmark: false, color: '#1d5c3f' },
  ocean: { logo: '/logo-guides-v3.png', onWhite: true, wordmark: false, color: '#14507a' }, // Aqua (guides): the blue looping fleur-de-lis, on a white disc
  yellow: { logo: '/logo-cubs.png', onWhite: true, wordmark: false, color: '#f6c21c' }, // Yellow (cubs)
  yellow_hannabies: { logo: '/logo-hannabies.png', onWhite: true, wordmark: false, color: '#f6c21c' },
  red: { logo: '/logo-mark.png', wordmark: false, color: '#c62828' }, // Red (guides)
  red_advanced: { logo: '/logo-mark.png', wordmark: false, color: '#c62828' },
  white: { logo: '/logo-mark-dark.png', wordmark: false, color: '#ffffff' },
};
const look = { theme: 'default', brand: null, title: null }; // title = { en, ar }: the troop's name shown as the tab title in the leader area (null = the site name) // brand = { en, ar } custom text next to the logo (null = the site name)
// the text next to the logo: the troop's own text if it has one, otherwise the site name
function paintBrand() {
  const brand = document.querySelector('header .brand'); if (!brand) return;
  const custom = look.brand && (state.lang === 'ar' ? look.brand.ar || look.brand.en : look.brand.en || look.brand.ar);
  brand.querySelector('span').textContent = custom || t('title');
  brand.classList.toggle('notext', !custom && !!(THEMES[look.theme] || {}).wordmark); // a wordmark logo already says the name
}
// patrols are called "patrol" / طليعة, except in the Rovers troop where Arabic says رهط; the word depends on the theme of the troop being looked at.
// Texts use {unit} / {units} (and {unit_l} / {units_l} in lowercase for English) and go through tu() instead of t().
let unitTheme = 'default';
const setUnitTheme = (key) => { unitTheme = key || 'default'; };
function tu(key) {
  const r = unitTheme === 'rovers' ? '_r' : '', one = t('unit' + r), many = t('units' + r);
  return t(key).replaceAll('{unit_l}', one.toLowerCase()).replaceAll('{units_l}', many.toLowerCase()).replaceAll('{unit}', one).replaceAll('{units}', many);
}
// Public dashboard only: the page keeps the main purple identity; just the patrol headings, XP chips, selected row and
// initial-letter avatars wear the colour of the troop being looked at (custom properties --troop*, separate from --primary).
const TROOP_TINT = { // theme key -> [strong, accent, soft], the same colours as the theme blocks in style.css
  rovers: ['#4a0313', '#d3ad80', '#f0e3d1'], forest: ['#1d5c3f', '#b9d3bd', '#e8f1e8'], forest_girls: ['#1d5c3f', '#b9d3bd', '#e8f1e8'],
  ocean: ['#14507a', '#b7d4e8', '#e6f1f8'], yellow: ['#a86f00', '#f3dc8a', '#fdf4d3'], yellow_hannabies: ['#a86f00', '#f3dc8a', '#fdf4d3'],
  red: ['#c62828', '#f2b9b3', '#fdeceb'], red_advanced: ['#c62828', '#f2b9b3', '#fdeceb'], white: ['#2d2d2d', '#d9d9de', '#f3f3f5'],
};
function setTroopTint(key) {
  const s = document.documentElement.style, c = TROOP_TINT[key];
  ['--troop', '--troop-accent', '--troop-soft'].forEach((v, i) => (c ? s.setProperty(v, c[i]) : s.removeProperty(v))); // no tint = main purple
}
// elements marked data-unit="key" are filled with the troop's own word (call again after a language or troop change)
const paintUnits = () => document.querySelectorAll('[data-unit]').forEach((n) => { n.textContent = tu(n.dataset.unit); });
const patrolName = (p) => (state.lang === 'ar' ? p.name_ar : p.name_en);

// the browser tab title: the troop's name inside a troop's leader area, otherwise the page's own title
function paintTitle() {
  const own = look.title && (state.lang === 'ar' ? look.title.ar || look.title.en : look.title.en || look.title.ar);
  document.title = own || t(document.documentElement.dataset.title || 'title');
}
function applyTheme(key, brand, title) {
  const th = THEMES[key] || THEMES.default;
  look.theme = THEMES[key] ? key : 'default';
  look.brand = brand && (brand.en || brand.ar) ? brand : null;
  look.title = title && (title.en || title.ar) ? title : null;
  if (look.theme !== 'default') document.documentElement.dataset.theme = look.theme; else delete document.documentElement.dataset.theme;
  const el = document.querySelector('header .brand');
  if (el) { el.classList.toggle('wordmark', th.wordmark); const img = el.querySelector('img'); img.src = th.logo; img.classList.toggle('on-white', !!th.onWhite); }
  paintBrand(); paintTitle();
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = th.color;
}
const t = (k) => state.dict[k] || k;

// each language file is downloaded once; switching back and forth reuses it
const dicts = {};
const loadDict = (l) => (dicts[l] ||= fetch(`/i18n/${l}.json`).then((r) => r.json()).catch((e) => { delete dicts[l]; throw e; }));

// pages start hidden (see style.css) and are revealed once the text is translated,
// so nobody ever sees the untranslated page flash before the Arabic appears
const showPage = () => document.body.classList.add('ready');
setTimeout(showPage, 4000); // safety net: never leave the page blank if the language file is slow

// run at most once per animation frame (keeps typing in search boxes smooth)
const frame = (fn) => { let q; return (...a) => { cancelAnimationFrame(q); q = requestAnimationFrame(() => fn(...a)); }; };
// wait (briefly) for the Cairo font so text doesn't jump when it swaps in after the page is revealed
const fontsReady = () => Promise.race([
  Promise.all([document.fonts.load('600 1rem Cairo', 'ابت'), document.fonts.load('600 1rem Cairo', 'Ab')]).catch(() => {}),
  new Promise((r) => setTimeout(r, 600)),
]);

async function setLang(l) {
  state.dict = await loadDict(l);
  state.lang = l;
  localStorage.setItem('lang', l);
  document.documentElement.lang = l;
  document.documentElement.dir = 'rtl'; // layout stays right-to-left in both languages
  document.querySelectorAll('[data-i18n]').forEach((e) => (e.textContent = t(e.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach((e) => (e.placeholder = t(e.dataset.i18nPh)));
  paintBrand(); paintTitle(); // each page sets its own title key; the leader area uses the troop's name
  document.dispatchEvent(new Event('langchange'));
  if (document.fonts && !document.body.classList.contains('ready')) await fontsReady();
  showPage();
}

// light/dark toggle in the header, next to the language button (font.js applies and remembers the choice)
const MODE_ICONS = {
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};
function initMode() {
  const lang = document.getElementById('langBtn');
  if (!lang || document.getElementById('modeBtn')) return;
  const b = document.createElement('button');
  b.id = 'modeBtn'; b.type = 'button'; b.className = 'mode';
  b.addEventListener('click', () => applyMode(currentMode() === 'dark' ? 'light' : 'dark', true));
  lang.before(b);
  const paint = () => {
    const dark = currentMode() === 'dark', label = t(dark ? 'light_mode' : 'dark_mode');
    b.innerHTML = dark ? MODE_ICONS.sun : MODE_ICONS.moon; // sun (switch to light) / moon (switch to dark): line icons, same size, no emoji
    b.title = label; b.setAttribute('aria-label', label);
  };
  document.addEventListener('modechange', paint); document.addEventListener('langchange', paint);
  paint();
}

function initLang() {
  initMode();
  const saved = localStorage.getItem('lang');
  const l = saved === 'en' ? 'en' : 'ar'; // Arabic unless the visitor chose English before
  document.getElementById('langBtn').addEventListener('click', () => setLang(state.lang === 'ar' ? 'en' : 'ar'));
  const ready = setLang(l);
  ready.then(() => loadDict(l === 'en' ? 'ar' : 'en')).catch(() => {}); // then fetch the other language in the background so the toggle is instant
  return ready;
}

// A form can't be sent again while its requests are still running (double-clicking "Award" used to give the XP twice).
// The form stays locked until every request has finished, including the reloads its handler starts after saving.
let pending = 0;
const busyForms = new Set();
const releaseForms = () => setTimeout(() => {
  if (pending) return;
  busyForms.forEach((f) => { delete f.dataset.busy; f.querySelectorAll('[type=submit]').forEach((b) => { b.disabled = false; }); });
  busyForms.clear();
}, 0);
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.dataset.busy) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  f.dataset.busy = '1'; busyForms.add(f);
  f.querySelectorAll('[type=submit]').forEach((b) => { b.disabled = true; });
  releaseForms(); // a handler that sends nothing is released straight away
}, true);

// the super admin can view the site as another account (kept per browser tab): every request then carries that account's id and the server answers as it, read-only
const viewAsId = () => { try { return sessionStorage.getItem('viewAs') || ''; } catch { return ''; } };
const setViewAs = (id) => { try { if (id) sessionStorage.setItem('viewAs', String(id)); else sessionStorage.removeItem('viewAs'); } catch { /* ignore */ } };
const viewAsHeader = () => (viewAsId() ? { 'X-View-As': viewAsId() } : {});
async function api(url, method = 'GET', body) {
  pending++;
  try {
    const r = await fetch(url, {
      method,
      credentials: 'same-origin',
      // state.troop is set in the leader area only: it tells the server which troop the super admin is working in
      headers: { 'Content-Type': 'application/json', ...(state.troop ? { 'X-Troop': String(state.troop) } : {}), ...viewAsHeader() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'server'), { status: r.status, code: data.error || 'server' });
    return data;
  } finally {
    if (!--pending) releaseForms();
  }
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  kids.flat().forEach((c) => n.append(c));
  return n;
}

const locale = () => (state.lang === 'ar' ? 'ar-u-nu-latn' : 'en'); // Arabic words and month names, but always 0-9 digits (never ٠-٩)
const fmt = (n) => Number(n).toLocaleString(locale());
// activity day arrives as plain YYYY-MM-DD; format it in UTC so it never shifts by timezone
const fmtDay = (d) => new Date(d).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
// an error code without a translation (e.g. a network failure) shows the general "something went wrong" text instead of a raw key
const errText = (e) => { const k = 'err_' + (e.code || 'server'); const s = tu(k); return s && s !== k ? s : t('err_server'); }; // tu: some errors name the patrol word
// +5 / -5 (a minus sign for losses, a plus sign for gains)
const signed = (n) => (n > 0 ? '+' : '') + fmt(n);
const roleName = (r) => (state.lang === 'ar' ? r.name_ar : r.name_en);
// chosen color as background, with white or dark text depending on how light it is
function chipStyle(l) {
  if (!l.color) return '';
  const n = parseInt(l.color.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const dark = (r * 299 + g * 587 + b * 114) / 1000 < 150;
  return `background:${l.color};border:1px solid ${l.color};color:${dark ? '#fff' : '#26122f'}`;
}
function roleChips(roles) {
  return el('span', { class: 'chips' }, (roles || []).map((r) => el('span', { class: 'chip role', style: chipStyle(r) }, roleName(r))));
}
const actName = (r) => (state.lang === 'ar' ? r.activity_ar || r.activity : r.activity);

function avatar(s, big) {
  const cls = 'avatar' + (big ? ' big' : '');
  if (s.has_photo) return el('img', { class: cls, src: `/api/scouts/${s.id}/photo?v=${s.photo_v}`, alt: '', loading: 'lazy', decoding: 'async' });
  return el('span', { class: cls + ' initial', 'aria-hidden': 'true' }, [...s.name][0] || '?');
}

// search helper: lowercase, drop Arabic diacritics, unify alef/yaa/taa-marbuta forms
const norm = (v) => String(v ?? '').toLowerCase().normalize('NFKD')
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

// patrols (optional): the troop's patrols; when it has any, the list is split under a heading per patrol, with scouts in none last
// phones: opening a scout shows their page on its own screen (the list is hidden) instead of scrolling down past the whole list.
// Back (the button, or the phone's own back) returns to the list exactly where it was. root = the element holding the list and the page (class "cols").
let detailRoot = null, detailScroll = 0;
const isPhone = () => matchMedia('(max-width: 760px)').matches;
function openDetailView(root) {
  if (!isPhone()) return; // wider screens show the list and the page side by side
  if (!root.classList.contains('show-detail')) { detailScroll = window.scrollY; history.pushState({ scoutView: 1 }, ''); } // one history step, so the phone's back button comes here
  detailRoot = root; root.classList.add('show-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function leaveDetailView() {
  if (!detailRoot || !detailRoot.classList.contains('show-detail')) return;
  detailRoot.classList.remove('show-detail');
  window.scrollTo({ top: detailScroll, behavior: 'instant' }); // back to the spot in the list
}
function closeDetailView() {
  if (!detailRoot || !detailRoot.classList.contains('show-detail')) return;
  if (history.state && history.state.scoutView) history.back(); else leaveDetailView(); // back() fires popstate, which leaves the view
}
window.addEventListener('popstate', leaveDetailView);

// does the troop being looked at use the XP system? (pages call setXpEnabled when the troop is known; off hides every XP number and history)
let xpEnabled = true;
const setXpEnabled = (v) => { xpEnabled = v !== false; };
function renderScoutList(ul, scouts, selectedId, onSelect, extra, emptyKey = 'no_scouts', patrols = []) {
  ul.replaceChildren();
  if (!scouts.length) {
    ul.append(el('li', { class: 'empty', style: 'padding:.75rem .5rem' }, t(emptyKey)));
    return;
  }
  const row = (s) => el('li', {},
    el('button', { type: 'button', 'aria-current': String(s.id === selectedId), onclick: () => onSelect(s.id) },
      avatar(s), el('span', { class: 'nm' }, s.name, extra ? extra(s) : ''), xpEnabled ? el('span', { class: 'xp' + (s.total_xp < 0 ? ' neg' : '') }, `${fmt(s.total_xp)} ${t('xp')}`) : ''));
  if (!patrols.length) { scouts.forEach((s) => ul.append(row(s))); return; }
  const group = (title, list) => { if (list.length) ul.append(el('li', { class: 'group-head' }, el('span', {}, title), el('small', {}, fmt(list.length))), ...list.map(row)); };
  // leader accounts (in_council) are in the leaders' patrol as well as their own patrol, so they are listed under both
  patrols.forEach((p) => group(patrolName(p), scouts.filter((s) => s.patrol_id === p.id || (p.is_leadership && s.in_council))));
  const ids = new Set(patrols.map((p) => p.id));
  // accounts (in_council) already sit in the leaders' patrol, so they never count as "no patrol"
  group(tu('no_patrol'), scouts.filter((s) => !ids.has(s.patrol_id) && !s.in_council && !s.is_super));
}

function renderDetailHead(scout, showRoles = true) {
  const hasRoles = showRoles && scout.roles && scout.roles.length;
  return el('div', { class: 'detail-head' },
    avatar(scout, true),
    hasRoles ? el('div', { style: 'flex:1;min-width:8rem' }, el('h2', { style: 'margin-bottom:.35rem' }, scout.name), roleChips(scout.roles))
             : el('h2', {}, scout.name),
    xpEnabled ? el('div', { class: 'badge' + (scout.total_xp < 0 ? ' neg' : '') }, el('b', {}, fmt(scout.total_xp)), el('span', {}, t('xp'))) : '');
}

function renderLog(scout, onUndo) {
  if (!xpEnabled) return el('span'); // no XP in this troop: no activity history
  const wrap = el('div', {}, el('h3', {}, t('activity_log')));
  if (!scout.log.length) { wrap.append(el('p', { class: 'empty' }, t('no_activity'))); return wrap; }
  const ul = el('ul', { class: 'log' });
  scout.log.forEach((r) =>
    ul.append(
      el('li', {},
        el('div', { class: 'what' }, actName(r), el('small', {}, fmtDay(r.day) + (r.note ? ` — ${r.note}` : ''))),
        el('span', { class: 'gain' + (r.xp < 0 ? ' neg' : '') }, signed(r.xp)),
        onUndo ? el('button', { class: 'btn quiet small', type: 'button', onclick: () => onUndo(r.id) }, t('undo')) : ''))
  );
  wrap.append(ul);
  return wrap;
}

// Styled confirmation popup. Usage: if (!(await confirmBox(message, buttonLabel))) return;
// like confirmBox, but also asks for a required written reason; resolves to the reason text, or null when cancelled
function reasonBox(message, okLabel, labelKey, hintKey) {
  return new Promise((resolve) => {
    const input = el('textarea', { rows: '3', maxlength: '300', required: true, placeholder: t(hintKey), 'aria-label': t(labelKey), dir: 'auto' });
    const ok = el('button', { class: 'btn danger', type: 'button', disabled: true }, okLabel || t('delete'));
    const no = el('button', { class: 'btn ghost', type: 'button' }, t('cancel'));
    const dlg = el('dialog', { class: 'confirm' },
      el('h3', {}, t('confirm_title')), el('p', {}, message),
      el('label', {}, el('span', {}, t(labelKey)), input),
      el('div', { class: 'actions' }, no, ok));
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    input.addEventListener('input', () => { ok.disabled = !input.value.trim(); }); // a reason is required
    ok.addEventListener('click', () => { if (input.value.trim()) done(input.value.trim()); });
    no.addEventListener('click', () => done(null));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
  });
}
function confirmBox(message, okLabel) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: 'confirm' },
      el('h3', {}, t('confirm_title')),
      el('p', {}, message),
      el('div', { class: 'actions' },
        el('button', { class: 'btn ghost', type: 'button', 'data-r': '0' }, t('cancel')),
        el('button', { class: 'btn danger', type: 'button', 'data-r': '1' }, okLabel || t('delete'))));
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) { // the dialog itself: either its padding or the dimmed backdrop around it; only the backdrop cancels
        const b = dlg.getBoundingClientRect();
        if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) done(false);
      }
      else if (e.target.dataset && e.target.dataset.r) done(e.target.dataset.r === '1');
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); }); // Esc key
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('[data-r="0"]').focus(); // safe default: Cancel
  });
}

// ---- show/hide button on every password field (also on fields the page adds later, like the reset-password row) ----
(() => {
  const label = (b) => { const shown = b.previousElementSibling?.type === 'text'; b.textContent = t(shown ? 'hide_password' : 'show_password'); b.setAttribute('aria-pressed', String(shown)); };
  const wrap = (input) => {
    if (input.dataset.pw) return;
    input.dataset.pw = '1';
    const box = document.createElement('span'); box.className = 'pw-wrap';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'pw-toggle'; btn.tabIndex = -1;
    input.replaceWith(box); box.append(input, btn);
    btn.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; label(btn); input.focus(); });
    label(btn);
  };
  const scan = () => document.querySelectorAll('input[type=password]:not([data-pw])').forEach(wrap);
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scan);
  document.addEventListener('langchange', () => document.querySelectorAll('.pw-toggle').forEach(label));
})();

// header dropdown menus close when you click elsewhere or press Esc
document.addEventListener('click', (e) => document.querySelectorAll('header details.menu[open]').forEach((d) => { if (!d.contains(e.target) || e.target === d) d.removeAttribute('open'); })); // (e.target === d: the dimmed page behind the phone menu)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('header details.menu[open]').forEach((d) => d.removeAttribute('open')); });

// the header menu (same on every page): the button names the page you are on, the list holds the other pages
const SITE_PAGES = { home: ['/', 'home'], scouts: ['/scouts.html', 'scout_list'], reports: ['/reports.html', 'reports_page'], music: ['/music.html', 'music_page'], leader: ['/leader.html', 'leader_area'], depot: ['/depot.html', 'depot'], admin: ['/admin.html', 'tab_admin'], account: ['/account.html', 'my_account'] };
let signedIn = null; // null = not known yet
let meDisplay = null;
// the session check runs once per page load and is shared: pages call getMe() instead of asking the server again (null = not signed in)
let mePromise = null;
const getMe = () => (mePromise ||= fetch('/api/me', { credentials: 'same-origin', headers: viewAsHeader() }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
// the name of an account level: the helper is عريف, but رائد in a Rovers troop (rovers = that account's troop has the Rovers theme)
const accountLevel = (role, rovers) => t(role === 'helper' && rovers ? 'acct_helper_r' : 'acct_' + role);
// a person's name with their level in front of it (just the name when the account is gone: role is null)
const withRole = (name, role, rovers) => (role ? accountLevel(role, rovers) + ' ' + name : name);
let meRole = null, meTheme = null, meViewing = null; // the role being shown (the viewed account's while the super admin is viewing as it) and that account
getMe().then((me) => {
  signedIn = !!me; meDisplay = me?.display_name || me?.username || null; meRole = me?.role || null; meTheme = me?.theme || null; meViewing = me?.viewing || null;
  if (!meViewing && viewAsId()) setViewAs(null); // a stale choice (the account is gone, or this is not the super admin)
  paintMenu(); paintWelcome(); paintViewBanner();
});
// the strip across the top while the super admin is viewing as another account: who, that it is read-only, and the way out
function paintViewBanner() {
  document.querySelector('.view-banner')?.remove();
  if (!meViewing || !state.dict.view_banner || !document.body) return;
  const b = document.createElement('div'); b.className = 'view-banner'; b.setAttribute('role', 'status');
  const txt = document.createElement('span');
  txt.textContent = t('view_banner').replace('{name}', meViewing.display_name || meViewing.username).replace('{level}', accountLevel(meViewing.role, meTheme === 'rovers'));
  const x = document.createElement('button'); x.type = 'button'; x.textContent = t('view_exit');
  x.addEventListener('click', () => { setViewAs(null); location.reload(); });
  b.append(txt, x); document.body.prepend(b);
}
document.addEventListener('langchange', paintViewBanner);
// signed in: the welcome caption on the dashboard greets the account by the first word of its display name (the first name)
function paintWelcome() {
  if (!meDisplay || !state.dict.subtitle_named) return;
  document.querySelectorAll('header p[data-i18n="subtitle"]').forEach((p) => { p.textContent = t('subtitle_named').replace('{name}', meDisplay.trim().split(/\s+/)[0]); });
}
document.addEventListener('langchange', paintWelcome);
// a small line icon in front of each page in the menu (fixed drawings, never built from data)
const MENU_ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  scouts: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5a3.2 3.2 0 0 1 0 6"/><path d="M18 14.3c1.8.7 3 2.4 3 4.7"/>',
  reports: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M8.5 10h7M8.5 14h7M8.5 18h4"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  leader: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  depot: '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>',
  admin: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  signin: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
};
function menuLink(href, textKey, icon, cls) {
  const a = document.createElement('a'); a.href = href; if (cls) a.className = cls;
  const i = document.createElement('span'); i.className = 'mi'; i.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + (MENU_ICONS[icon] || '') + '</svg>';
  a.append(i, document.createTextNode(t(textKey)));
  return a;
}
function paintMenu() {
  document.querySelectorAll('header details.menu[data-page]').forEach((d) => {
    if (!state.dict.home) return; // language file not loaded yet
    const here = d.dataset.page;
    let sum = d.querySelector('summary'), list = d.querySelector('.menu-list');
    if (!sum) { sum = document.createElement('summary'); list = document.createElement('div'); list.className = 'menu-list'; d.append(sum, list); }
    sum.textContent = t(SITE_PAGES[here][1]);
    const links = Object.entries(SITE_PAGES).filter(([k]) => k !== here && k !== 'account' && (k !== 'leader' || signedIn === true) && (k !== 'admin' || (signedIn === true && meRole === 'super_admin'))).map(([k, [href, key]]) => menuLink(href, key, k)); // (My account is not a regular entry: it takes the place of Sign in once signed in)
    // visitors who aren't signed in get a Sign in option (the sign-in form lives on the leader page, so not shown there)
    if (signedIn === false && here !== 'leader') {
      links.push(menuLink('/leader.html?next=' + encodeURIComponent(location.pathname + location.search), 'sign_in', 'signin', 'signin'));
    }
    // signed in: My account takes the place of Sign in (the last row, set apart by a line)
    if (signedIn === true && here !== 'account') {
      links.push(menuLink(SITE_PAGES.account[0], 'my_account', 'account', 'signin'));
    }
    list.replaceChildren(...links);
  });
}
document.addEventListener('langchange', paintMenu);
document.addEventListener('DOMContentLoaded', paintMenu);

// ---- dropdowns: every <select> opens a styled list (a bottom sheet on phones, a small popover on wide screens) instead of the browser's own one.
// The <select> itself stays in the page (it shows the choice, takes focus, is validated and submitted as always); only its list is replaced:
// choosing sets its value and fires input and change on it, so the code listening to it needs nothing new. Add data-native to a select to keep the browser's own list.
(function () {
  const phone = () => matchMedia('(max-width: 760px)').matches;
  let cur = null; // the open list: { sel, dim, pop, items, active, ... }
  function close(refocus) {
    if (!cur) return;
    const c = cur; cur = null;
    c.pop.remove(); c.dim.remove();
    document.removeEventListener('keydown', c.onKey, true); removeEventListener('resize', c.onAway); removeEventListener('scroll', c.onScroll, true);
    if (refocus) c.sel.focus({ preventScroll: true });
  }
  function choose(sel, i) {
    const o = sel.options[i];
    if (!o || o.disabled) return false;
    const changed = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    return true;
  }
  function show(sel) {
    if (cur) { const same = cur.sel === sel; close(); if (same) return; }
    if (sel.disabled || !sel.options.length) return;
    const dim = document.createElement('div'); dim.className = 'cs-dim';
    const pop = document.createElement('div'); pop.className = 'cs-pop'; pop.setAttribute('role', 'listbox');
    const title = (sel.closest('label')?.querySelector('span')?.textContent || sel.getAttribute('aria-label') || '').trim(); // shown on top of the phone sheet
    if (title) { const h = document.createElement('div'); h.className = 'cs-title'; h.textContent = title; pop.append(h); }
    const list = document.createElement('div'); list.className = 'cs-list'; pop.append(list);
    const items = [...sel.options].map((o, i) => {
      const d = document.createElement('div'); d.className = 'cs-opt'; d.setAttribute('role', 'option'); d.dataset.i = String(i); d.textContent = o.text;
      if (o.disabled) d.setAttribute('aria-disabled', 'true');
      if (i === sel.selectedIndex) d.setAttribute('aria-selected', 'true');
      list.append(d); return d;
    });
    document.body.append(dim, pop);
    let active = sel.selectedIndex >= 0 && !sel.options[sel.selectedIndex].disabled ? sel.selectedIndex : items.findIndex((d) => !d.hasAttribute('aria-disabled'));
    const setActive = (i) => { if (i < 0 || i >= items.length) return; items[active]?.classList.remove('active'); active = i; items[i].classList.add('active'); items[i].scrollIntoView({ block: 'nearest' }); };
    setActive(active);
    if (!phone()) { // a popover under the select (above it when there is no room below), kept inside the window
      const r = sel.getBoundingClientRect();
      pop.style.minWidth = Math.max(r.width, 160) + 'px';
      const w = pop.offsetWidth, h = pop.offsetHeight;
      pop.style.left = Math.min(Math.max(8, r.left), Math.max(8, innerWidth - w - 8)) + 'px';
      pop.style.top = (r.bottom + 4 + h > innerHeight - 8 && r.top - 4 - h > 8 ? r.top - 4 - h : r.bottom + 4) + 'px';
    }
    pop.addEventListener('click', (e) => { const d = e.target.closest('.cs-opt'); if (d && choose(sel, Number(d.dataset.i))) close(true); });
    pop.addEventListener('mousemove', (e) => { const d = e.target.closest('.cs-opt'); if (d && !d.hasAttribute('aria-disabled')) setActive(Number(d.dataset.i)); });
    dim.addEventListener('click', () => close(true));
    let typed = '', typedAt = 0;
    const onKey = (e) => {
      const k = e.key;
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
      if (k === 'Tab') { close(); return; }
      const move = (step, from) => { let i = from; do { i += step; } while (i >= 0 && i < items.length && items[i].hasAttribute('aria-disabled')); if (i >= 0 && i < items.length) setActive(i); };
      if (k === 'ArrowDown') move(1, active); else if (k === 'ArrowUp') move(-1, active);
      else if (k === 'Home') move(1, -1); else if (k === 'End') move(-1, items.length);
      else if (k === 'Enter' || k === ' ') { if (choose(sel, active)) close(true); }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { // type the first letters of an option to jump to it
        typed = (Date.now() - typedAt > 800 ? '' : typed) + k.toLowerCase(); typedAt = Date.now();
        const hit = items.findIndex((d, i) => !d.hasAttribute('aria-disabled') && sel.options[i].text.trim().toLowerCase().startsWith(typed));
        if (hit >= 0) setActive(hit);
      } else return;
      e.preventDefault(); e.stopPropagation();
    };
    const onAway = () => close();
    const onScroll = (e) => { if (!pop.contains(e.target)) close(); };
    document.addEventListener('keydown', onKey, true);
    if (!phone()) { addEventListener('resize', onAway); addEventListener('scroll', onScroll, true); }
    cur = { sel, dim, pop, onKey, onAway, onScroll };
  }
  function enhance(sel) {
    if (sel.dataset.cs || sel.multiple || sel.size > 1 || sel.hasAttribute('data-native')) return;
    sel.dataset.cs = '1';
    sel.addEventListener('mousedown', (e) => { if (e.button !== 0) return; e.preventDefault(); sel.focus({ preventScroll: true }); show(sel); }); // (nothing opens the browser's own list)
    let sx = 0, sy = 0, moved = false;
    sel.addEventListener('touchstart', (e) => { const p = e.touches[0]; sx = p.clientX; sy = p.clientY; moved = false; }, { passive: true });
    sel.addEventListener('touchmove', (e) => { const p = e.touches[0]; if (Math.abs(p.clientX - sx) > 10 || Math.abs(p.clientY - sy) > 10) moved = true; }, { passive: true });
    sel.addEventListener('touchend', (e) => { if (moved || e.touches.length) return; e.preventDefault(); show(sel); }, { passive: false }); // a tap, not a scroll
    sel.addEventListener('click', (e) => e.preventDefault());
    sel.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) { e.preventDefault(); show(sel); } });
  }
  const scan = (root) => { if (root.matches?.('select')) enhance(root); root.querySelectorAll?.('select').forEach(enhance); };
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); }))).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => scan(document));
})();

// installable app (PWA): the service worker (/sw.js) only shows the offline page and keeps the site's own files; it never stores data from /api
if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* not available (no HTTPS, private window...): the site works as before */ }); });
