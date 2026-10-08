const state = { lang: 'en', dict: {} };
const t = (k) => state.dict[k] || k;

async function setLang(l) {
  const r = await fetch(`/i18n/${l}.json`);
  state.dict = await r.json();
  state.lang = l;
  localStorage.setItem('lang', l);
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((e) => (e.textContent = t(e.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach((e) => (e.placeholder = t(e.dataset.i18nPh)));
  document.dispatchEvent(new Event('langchange'));
}

function initLang() {
  const saved = localStorage.getItem('lang');
  const l = saved || ((navigator.language || '').startsWith('ar') ? 'ar' : 'en');
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
          el('span', {}, s.name),
          el('span', { class: 'xp' }, `${fmt(s.total_xp)} ${t('xp')}`)))
    )
  );
}

function renderDetailHead(scout) {
  return el('div', { class: 'detail-head' },
    el('div', { class: 'badge' }, el('b', {}, fmt(scout.total_xp)), el('span', {}, t('xp'))),
    el('h2', {}, scout.name));
}

function renderLog(scout, onUndo) {
  const wrap = el('div', {}, el('h3', { style: 'margin:0 0 .25rem;font-size:1.05rem' }, t('activity_log')));
  if (!scout.log.length) return wrap.appendChild(el('p', { class: 'empty' }, t('no_activity'))), wrap;
  const ul = el('ul', { class: 'log' });
  scout.log.forEach((r) =>
    ul.append(
      el('li', {},
        el('div', { class: 'what' }, r.activity, el('small', {}, [fmtDate(r.created_at), r.note ? ` — ${r.note}` : ''].join(''))),
        el('span', { class: 'gain' + (r.xp < 0 ? ' neg' : '') }, `${r.xp > 0 ? '+' : ''}${fmt(r.xp)}`),
        onUndo ? el('button', { class: 'btn quiet small', type: 'button', onclick: () => onUndo(r.id) }, t('undo')) : ''))
  );
  wrap.append(ul);
  return wrap;
}
