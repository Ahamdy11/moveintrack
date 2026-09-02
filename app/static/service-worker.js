const CACHE = 'moveintrack-shell-v2'; // تم رفع الإصدار إلى v2 لنسخ الكاش القديم
const ASSETS = [
  '/',
  '/static/styles.css?v=2.2',
  '/static/app.js?v=2.2',
  '/static/assets/moveintrack-logo.png',
  '/static/assets/icon-192.png'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // تجبر الـ Service Worker الجديد على التفعيل فوراً بدون انتظار إغلاق التبويب
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k)) // مسح كاش v1 القديم تلقائياً
      )
    ).then(() => self.clients.claim()) // الاستحواذ الفوري على الصفحات المفتوحة
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).pathname.startsWith('/api/')) return;

  // Network First Strategy للملفات البرمجية لضمان جلب الأحدث دائماً
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match('/')))
  );
});