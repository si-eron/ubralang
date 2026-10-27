/* Offline copy of the app itself (never of the live data).
   Network first: when online, every file comes fresh, so a new version shows
   up on the next open with nothing to clear. When the network is missing or
   slow, the copy saved last time is used, so the app still opens at a venue
   with bad signal and shows the last state it saw. */
const CACHE = 'event-timer-v14';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/app.css',
  'assets/js/app.js',
  'assets/js/admin.js',
  'assets/js/components.js',
  'assets/js/config.js',
  'assets/js/install.js',
  'assets/js/presenter.js',
  'assets/js/notices.js',
  'assets/js/realtime.js',
  'assets/js/shell.js',
  'assets/js/stage.js',
  'assets/js/station.js',
  'assets/js/store.js',
  'assets/js/sync.js',
  'assets/js/time.js',
  'assets/js/ui.js',
  'assets/vendor/qrcode.js',
  'assets/fonts/bricolage-grotesque-latin-600-normal.woff2',
  'assets/fonts/bricolage-grotesque-latin-700-normal.woff2',
  'assets/fonts/public-sans-latin-400-normal.woff2',
  'assets/fonts/public-sans-latin-500-normal.woff2',
  'assets/fonts/public-sans-latin-600-normal.woff2',
  'assets/fonts/public-sans-latin-700-normal.woff2',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), ms));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only this site's own files. The database is always asked directly.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/rest/v1/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(4000)]);
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch {
      const saved = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' ? await cache.match('index.html') : null);
      return saved || Response.error();
    }
  })());
});
