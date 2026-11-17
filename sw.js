// sw.js: versioned cache, precache the whole shell, cache-first. A new version waits until the user taps "Update".
const VERSION = '1.0.0';
const CACHE = `daily-ledger-v${VERSION}`;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/boot.js', 'js/main.js', 'js/engine.js', 'js/config.js', 'js/store.js', 'js/io.js', 'js/metrics.js', 'js/copy.js', 'js/dom.js',
  'js/ui/setup.js', 'js/ui/today.js', 'js/ui/vault.js', 'js/ui/reflect.js', 'js/ui/setback.js', 'js/ui/settings.js',
  'config/default.json', 'config/interview.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // No skipWaiting here: the page decides when to switch (user taps "Update").
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('daily-ledger-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (the app makes none)
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
