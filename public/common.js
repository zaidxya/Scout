const state = { lang: 'ar', dict: {} };
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
  document.title = t(document.documentElement.dataset.title || 'title'); // each page sets its own title key
  document.querySelectorAll('[data-i18n]').forEach((e) => (e.textContent = t(e.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach((e) => (e.placeholder = t(e.dataset.i18nPh)));
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
    headers: { 'Content-Type': 'application/json' },
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
  return `background:${l.color};border:1px solid ${l.color};color:${dark ? '#fff' : '#2b0a12'}`;
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

function renderScoutList(ul, scouts, selectedId, onSelect, extra, emptyKey = 'no_scouts') {
  ul.replaceChildren();
  if (!scouts.length) {
    ul.append(el('li', { class: 'empty', style: 'padding:.75rem .5rem' }, t(emptyKey)));
    return;
  }
  scouts.forEach((s) =>
    ul.append(
      el('li', {},
        el('button', { type: 'button', 'aria-current': String(s.id === selectedId), onclick: () => onSelect(s.id) },
          avatar(s), el('span', { class: 'nm' }, s.name, extra ? extra(s) : ''), el('span', { class: 'xp' + (s.total_xp < 0 ? ' neg' : '') }, `${fmt(s.total_xp)} ${t('xp')}`)))
    )
  );
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
