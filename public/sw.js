// Service worker: makes the site installable and shows a friendly page when there is no connection.
// It never stores data: everything under /api/ (and every non-GET request, and other sites' files such as the fonts) goes straight to the network.
// Pages always come from the network (so an update shows at once); only when it fails is /offline.html shown.
// Scripts, styles, language files and images are fetched from the network first and kept, so the site's look still loads when the connection drops.
const CACHE = 'scout-v1';
const SHELL = ['/offline.html', '/pwa-icon-192.png', '/logo-mark.png', '/style.css', '/common.js', '/font.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === '/sw.js') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req)));
});
