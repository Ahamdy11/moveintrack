const CACHE = 'moveintrack-shell-v2';
const ASSETS = [
  '/',
  '/static/styles.css?v=2.2',
  '/static/app.js?v=2.2',
  '/static/assets/moveintrack-logo.png',
  '/static/assets/icon-192.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // تجاهل أي طلبات ليست GET أو طلبات الـ API
  if (event.request.method !== 'GET' || new URL(event.request.url).pathname.startsWith('/api/')) return;

  // Network-First Strategy حقيقية بدون إرجاع الكاش القديم عند نجاح الشبكة
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // لو الاستجابة سليمة، حدث الكاش في الخلفية للـ ASSETS فقط
        if (networkResponse && networkResponse.status === 200) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, cacheCopy));
        }
        return networkResponse;
      })
      .catch(() => {
        // يرجع للكاش فقط لو النت قطع تماماً (Offline)
        return caches.match(event.request).then(r => r || caches.match('/'));
      })
  );
});