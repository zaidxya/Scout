const state = { lang: 'ar', dict: {} };

// ---- visual identity ----
// The main site (home dashboard, login screen) uses the purple main identity. Each troop picks a theme
// (see the :root[data-theme=...] blocks in style.css); the leader area switches to it after sign-in.
const THEMES = {
  default: { logo: '/logo-mark.png', wordmark: false, color: '#671e93' },
  rovers: { logo: '/logo.jpg', wordmark: true, color: '#4a0313' },
  forest: { logo: '/logo-mark.png', wordmark: false, color: '#1d5c3f' }, // Forest (boys)
  forest_girls: { logo: '/logo-mark.png', wordmark: false, color: '#1d5c3f' },
  ocean: { logo: '/logo-guides.png', wordmark: false, color: '#14507a' },
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
// the browser tab title: the troop's name inside a troop's leader area, otherwise the page's own title
// patrols are called "patrol" / طليعة, except in the Rovers troop where Arabic says رهط; the word depends on the theme of the troop being looked at.
// Texts use {unit} / {units} (and {unit_l} / {units_l} in lowercase for English) and go through tu() instead of t().
let unitTheme = 'default';
const setUnitTheme = (key) => { unitTheme = key || 'default'; };
function tu(key) {
  const r = unitTheme === 'rovers' ? '_r' : '', one = t('unit' + r), many = t('units' + r);
  return t(key).replaceAll('{unit_l}', one.toLowerCase()).replaceAll('{units_l}', many.toLowerCase()).replaceAll('{unit}', one).replaceAll('{units}', many);
}
// elements marked data-unit="key" are filled with the troop's own word (call again after a language or troop change)
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
const paintUnits = () => document.querySelectorAll('[data-unit]').forEach((n) => { n.textContent = tu(n.dataset.unit); });
const patrolName = (p) => (state.lang === 'ar' ? p.name_ar : p.name_en);

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

function initLang() {
  const saved = localStorage.getItem('lang');
  const l = saved === 'en' ? 'en' : 'ar'; // Arabic unless the visitor chose English before
  document.getElementById('langBtn').addEventListener('click', () => setLang(state.lang === 'ar' ? 'en' : 'ar'));
  const ready = setLang(l);
  ready.then(() => loadDict(l === 'en' ? 'ar' : 'en')).catch(() => {}); // then fetch the other language in the background so the toggle is instant
  return ready;
}

async function api(url, method = 'GET', body) {
  const r = await fetch(url, {
    method,
    credentials: 'same-origin',
    // state.troop is set in the leader area only: it tells the server which troop the super admin is working in
    headers: { 'Content-Type': 'application/json', ...(state.troop ? { 'X-Troop': String(state.troop) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'server'), { status: r.status, code: data.error || 'server' });
  return data;
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

const locale = () => (state.lang === 'ar' ? 'ar-EG' : 'en');
const fmt = (n) => Number(n).toLocaleString(locale());
// activity day arrives as plain YYYY-MM-DD; format it in UTC so it never shifts by timezone
const fmtDay = (d) => new Date(d).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const errText = (e) => t('err_' + (e.code || 'server'));
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
function renderScoutList(ul, scouts, selectedId, onSelect, extra, emptyKey = 'no_scouts', patrols = []) {
  ul.replaceChildren();
  if (!scouts.length) {
    ul.append(el('li', { class: 'empty', style: 'padding:.75rem .5rem' }, t(emptyKey)));
    return;
  }
  const row = (s) => el('li', {},
    el('button', { type: 'button', 'aria-current': String(s.id === selectedId), onclick: () => onSelect(s.id) },
      avatar(s), el('span', { class: 'nm' }, s.name, extra ? extra(s) : ''), el('span', { class: 'xp' + (s.total_xp < 0 ? ' neg' : '') }, `${fmt(s.total_xp)} ${t('xp')}`)));
  if (!patrols.length) { scouts.forEach((s) => ul.append(row(s))); return; }
  const group = (title, list) => { if (list.length) ul.append(el('li', { class: 'group-head' }, el('span', {}, title), el('small', {}, fmt(list.length))), ...list.map(row)); };
  // leader accounts (in_council) are in the leaders' patrol as well as their own patrol, so they are listed under both
  patrols.forEach((p) => group(patrolName(p), scouts.filter((s) => s.patrol_id === p.id || (p.is_leadership && s.in_council))));
  const ids = new Set(patrols.map((p) => p.id));
  group(tu('no_patrol'), scouts.filter((s) => !ids.has(s.patrol_id)));
}

function renderDetailHead(scout, showRoles = true) {
  const hasRoles = showRoles && scout.roles && scout.roles.length;
  return el('div', { class: 'detail-head' },
    avatar(scout, true),
    hasRoles ? el('div', { style: 'flex:1;min-width:8rem' }, el('h2', { style: 'margin-bottom:.35rem' }, scout.name), roleChips(scout.roles))
             : el('h2', {}, scout.name),
    el('div', { class: 'badge' + (scout.total_xp < 0 ? ' neg' : '') }, el('b', {}, fmt(scout.total_xp)), el('span', {}, t('xp'))));
}

function renderLog(scout, onUndo) {
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
      if (e.target === dlg) done(false); // click on the dimmed backdrop
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
