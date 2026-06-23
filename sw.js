// Service worker: офлайн-оболочка приложения.
//  • Навигации (HTML) — network-first: свежий index онлайн, кэш офлайн.
//  • Статические ассеты того же origin (app*.js, styles.css, data.js, favicon, manifest)
//    — stale-while-revalidate: мгновенно из кэша + фоновое обновление.
//  • Живые данные (Supabase, worker PRICE_PROXY, Yahoo, CDN-шрифты/supabase-js) —
//    чужой origin → идут в сеть и НЕ кэшируются (офлайн показываем встроенные данные).
// Хэш-версии в ?v= = разные ключи кэша, поэтому новый деплой подтягивается сам.
const CACHE = 'idx-dash-v1';
const SHELL = ['./', './index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;   // чужой origin (API/CDN) — обычная сеть

  if (req.mode === 'navigate') {                       // HTML: свежий онлайн, кэш офлайн
    e.respondWith(
      fetch(req)
        .then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res; })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Ассеты: stale-while-revalidate
  e.respondWith(caches.open(CACHE).then(async c => {
    const cached = await c.match(req);
    const net = fetch(req)
      .then(res => { if (res && res.ok && res.type === 'basic') c.put(req, res.clone()); return res; })
      .catch(() => cached);
    return cached || net;
  }));
});
