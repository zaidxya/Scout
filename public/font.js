// Site font and colour mode (loaded in <head> so nothing flashes). Site font: one font for the whole site, chosen by the super admin (Administration > Troops).
// Every font comes from Google Fonts (nothing is served by this server) and only the chosen one is downloaded.
// The last choice is kept in this browser so the page paints in it at once; the server's setting is checked in the background.
const SITE_FONTS = {
  cairo: { family: 'Cairo', spec: 'Cairo:wght@400;600;700;800', en: 'Cairo', ar: 'القاهرة (Cairo)' },
  tajawal: { family: 'Tajawal', spec: 'Tajawal:wght@400;500;700;800', en: 'Tajawal', ar: 'تجوال (Tajawal)' },
  almarai: { family: 'Almarai', spec: 'Almarai:wght@400;700;800', en: 'Almarai', ar: 'المراعي (Almarai)' },
  ibm_plex: { family: 'IBM Plex Sans Arabic', spec: 'IBM+Plex+Sans+Arabic:wght@400;500;600;700', en: 'IBM Plex Sans Arabic', ar: 'IBM Plex Sans Arabic' },
  noto_kufi: { family: 'Noto Kufi Arabic', spec: 'Noto+Kufi+Arabic:wght@400;600;700;800', en: 'Noto Kufi Arabic', ar: 'نوتو كوفي (Noto Kufi)' },
  noto_sans: { family: 'Noto Sans Arabic', spec: 'Noto+Sans+Arabic:wght@400;600;700;800', en: 'Noto Sans Arabic', ar: 'نوتو سانس (Noto Sans Arabic)' },
  noto_naskh: { family: 'Noto Naskh Arabic', spec: 'Noto+Naskh+Arabic:wght@400;600;700', en: 'Noto Naskh Arabic', ar: 'نوتو نسخ (Noto Naskh)' },
  amiri: { family: 'Amiri', spec: 'Amiri:wght@400;700', en: 'Amiri', ar: 'أميري (Amiri)' },
  readex: { family: 'Readex Pro', spec: 'Readex+Pro:wght@400;600;700', en: 'Readex Pro', ar: 'ريدكس (Readex Pro)' },
  el_messiri: { family: 'El Messiri', spec: 'El+Messiri:wght@400;600;700', en: 'El Messiri', ar: 'المسيري (El Messiri)' },
  changa: { family: 'Changa', spec: 'Changa:wght@400;600;700;800', en: 'Changa', ar: 'تشانغا (Changa)' },
  mada: { family: 'Mada', spec: 'Mada:wght@400;600;700;900', en: 'Mada', ar: 'مدى (Mada)' },
  system: { family: null, spec: null, en: 'Device font (no download)', ar: 'خط الجهاز (بدون تحميل)' },
};
const DEFAULT_FONT = 'cairo';
function applyFont(key, remember) {
  const f = SITE_FONTS[key] ? key : DEFAULT_FONT, d = SITE_FONTS[f];
  document.documentElement.style.setProperty('--site-font', d.family ? `"${d.family}"` : 'system-ui');
  document.querySelectorAll('link[data-sitefont]').forEach((l) => { if (l.dataset.sitefont !== f) l.remove(); });
  if (d.spec && !document.querySelector('link[data-sitefont="' + f + '"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.dataset.sitefont = f;
    l.href = 'https://fonts.googleapis.com/css2?family=' + d.spec + '&display=swap';
    document.head.append(l);
  }
  if (remember) try { localStorage.setItem('siteFont', f); } catch { /* ignore */ }
  return f;
}
(function () {
  let saved = null;
  try { saved = localStorage.getItem('siteFont'); } catch { /* ignore */ }
  let now = applyFont(saved);
  fetch('/api/settings', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((s) => {
    if (s && s.font && SITE_FONTS[s.font]) { if (s.font !== now) now = applyFont(s.font); try { localStorage.setItem('siteFont', s.font); } catch { /* ignore */ } }
  }).catch(() => {});
})();

// Colour mode: the visitor's own choice (kept in this browser), otherwise the device's light/dark setting.
function currentMode() { return document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light'; }
function applyMode(m, remember) {
  if (m === 'dark') document.documentElement.dataset.mode = 'dark'; else delete document.documentElement.dataset.mode;
  if (remember) try { localStorage.setItem('siteMode', m); } catch { /* ignore */ }
  document.dispatchEvent(new Event('modechange'));
}
(function () {
  let saved = null;
  try { saved = localStorage.getItem('siteMode'); } catch { /* ignore */ }
  const dm = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  applyMode(saved === 'dark' || saved === 'light' ? saved : dm && dm.matches ? 'dark' : 'light');
  if (dm && dm.addEventListener) dm.addEventListener('change', (e) => { // follows the device until the visitor picks one
    let s = null; try { s = localStorage.getItem('siteMode'); } catch { /* ignore */ }
    if (s !== 'dark' && s !== 'light') applyMode(e.matches ? 'dark' : 'light');
  });
})();
