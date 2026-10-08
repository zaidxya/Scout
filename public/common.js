const state = { lang: 'en', dict: {} };
const t = (k) => state.dict[k] || k;

async function setLang(l) {
  const r = await fetch(`/i18n/${l}.json`);
  state.dict = await r.json();
  state.lang = l;
  localStorage.setItem('lang', l);
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  document.title = 'Jawalat · ' + t('title');
  const lb = document.getElementById('langBtn');
  if (lb) lb.textContent = t('lang_toggle');
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

// XP needed per level. Purely cosmetic (derived from total XP), so safe to tune.
const XP_PER_LEVEL = 100;

// Adds rank (ties share a rank) and pct (share of the top score) to a list sorted by XP desc.
function rankScouts(list) {
  const max = Math.max(1, ...list.map((s) => s.total_xp));
  list.forEach((s, i) => {
    s.rank = i > 0 && s.total_xp === list[i - 1].total_xp ? list[i - 1].rank : i + 1;
    s.pct = Math.max(0, Math.round((s.total_xp / max) * 100));
  });
  return list;
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
          el('span', { class: 'rank' + (s.rank <= 3 && s.total_xp > 0 ? ' r' + s.rank : ''), 'aria-label': `${t('rank')} ${fmt(s.rank)}` }, fmt(s.rank)),
          el('span', { class: 'nm' }, s.name),
          el('span', { class: 'xp' }, fmt(s.total_xp), ' ', el('small', {}, t('xp'))),
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `--w:${s.pct}%` }))))
    )
  );
}

function renderDetailHead(scout) {
  const xp = Math.max(0, scout.total_xp);
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const into = xp % XP_PER_LEVEL;
  return el('div', {},
    el('div', { class: 'detail-head' },
      el('div', { class: 'badge' }, el('b', {}, fmt(scout.total_xp)), el('span', {}, t('xp'))),
      el('div', { class: 'meta' }, el('h2', {}, scout.name), el('span', { class: 'lvl' }, `${t('level')} ${fmt(level)}`))),
    el('div', { class: 'progress' },
      el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(XP_PER_LEVEL), 'aria-valuenow': String(into) },
        el('i', { style: `--w:${into}%` })),
      el('p', {}, el('span', {}, `${fmt(into)} / ${fmt(XP_PER_LEVEL)} ${t('xp')}`), el('span', {}, `${fmt(XP_PER_LEVEL - into)} ${t('xp')} ${t('to_next')}`))));
}

function renderLog(scout, onUndo) {
  const wrap = el('div', {}, el('h3', { style: 'margin:0 0 .25rem;font-size:1.05rem' }, t('activity_log')));
  if (!scout.log.length) return wrap.appendChild(el('p', { class: 'empty' }, t('no_activity'))), wrap;
  const ul = el('ul', { class: 'log' });
  scout.log.forEach((r) =>
    ul.append(
      el('li', {},
        el('div', { class: 'what' }, r.activity, el('small', {}, [fmtDate(r.created_at), r.note ? ` — ${r.note}` : ''].join(''))),
        el('span', { class: 'gain' + (r.xp < 0 ? ' neg' : '') }, `${r.xp < 0 ? '-' : '+'}${fmt(Math.abs(r.xp))}`),
        onUndo ? el('button', { class: 'btn quiet small', type: 'button', onclick: () => onUndo(r.id) }, t('undo')) : ''))
  );
  wrap.append(ul);
  return wrap;
}
