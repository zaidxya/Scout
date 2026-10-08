const state = { lang: 'ar', dict: {} };
const t = (k) => state.dict[k] || k;

async function setLang(l) {
  const r = await fetch(`/i18n/${l}.json`);
  state.dict = await r.json();
  state.lang = l;
  localStorage.setItem('lang', l);
  document.documentElement.lang = l;
  document.documentElement.dir = 'rtl'; // layout stays right-to-left in both languages
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((e) => (e.textContent = t(e.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach((e) => (e.placeholder = t(e.dataset.i18nPh)));
  document.dispatchEvent(new Event('langchange'));
}

function initLang() {
  const saved = localStorage.getItem('lang');
  const l = saved === 'en' || saved === 'ar' ? saved : 'ar';
  document.getElementById('langBtn').addEventListener('click', () => setLang(state.lang === 'ar' ? 'en' : 'ar'));
  return setLang(l);
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
const fmtDate = (d) => new Date(d).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' });
const errText = (e) => t('err_' + (e.code || 'server'));
const actName = (r) => (state.lang === 'ar' ? r.activity_ar || r.activity : r.activity);

function avatar(s, big) {
  const cls = 'avatar' + (big ? ' big' : '');
  if (s.has_photo) return el('img', { class: cls, src: `/api/scouts/${s.id}/photo?v=${s.photo_v}`, alt: '' });
  return el('span', { class: cls + ' initial', 'aria-hidden': 'true' }, [...s.name][0] || '?');
}

function renderScoutList(ul, scouts, selectedId, onSelect) {
  ul.replaceChildren();
  if (!scouts.length) {
    ul.append(el('li', { class: 'empty', style: 'padding:.75rem .5rem' }, t('no_scouts')));
    return;
  }
  scouts.forEach((s) =>
    ul.append(
      el('li', {},
        el('button', { type: 'button', 'aria-current': String(s.id === selectedId), onclick: () => onSelect(s.id) },
          avatar(s), el('span', { class: 'nm' }, s.name), el('span', { class: 'xp' }, `${fmt(s.total_xp)} ${t('xp')}`)))
    )
  );
}

function renderDetailHead(scout) {
  return el('div', { class: 'detail-head' },
    avatar(scout, true),
    el('h2', {}, scout.name),
    el('div', { class: 'badge' }, el('b', {}, fmt(scout.total_xp)), el('span', {}, t('xp'))));
}

function renderLog(scout, onUndo) {
  const wrap = el('div', {}, el('h3', {}, t('activity_log')));
  if (!scout.log.length) { wrap.append(el('p', { class: 'empty' }, t('no_activity'))); return wrap; }
  const ul = el('ul', { class: 'log' });
  scout.log.forEach((r) =>
    ul.append(
      el('li', {},
        el('div', { class: 'what' }, actName(r), el('small', {}, fmtDate(r.created_at) + (r.note ? ` — ${r.note}` : ''))),
        el('span', { class: 'gain' }, `+${fmt(r.xp)}`),
        onUndo ? el('button', { class: 'btn quiet small', type: 'button', onclick: () => onUndo(r.id) }, t('undo')) : ''))
  );
  wrap.append(ul);
  return wrap;
}
