/* Офлайн-кэш: после первого открытия Луи работает без интернета. */
const CACHE = 'louis-v2';
const FILES = ['./', 'index.html', 'style.css', 'brain.js', 'ai.js', 'app.js', 'manifest.webmanifest',
  'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // запросы к нейросети и прочим сайтам не кэшируем
  if (new URL(e.request.url).origin !== self.location.origin) return;
  // сначала сеть (чтобы получать обновления), при её отсутствии берём из кэша
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
