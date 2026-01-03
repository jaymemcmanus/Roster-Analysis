const CACHE_NAME = 'va-pay-v14';
const CORE_ASSETS = [
  './',
  './index.html',
  './app.js?v=14',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const resp = await fetch(event.request);
    if (event.request.method === 'GET') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(event.request, resp.clone()).catch(() => {});
    }
    return resp;
  })());
});
