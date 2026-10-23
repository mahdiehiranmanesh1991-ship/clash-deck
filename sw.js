// Offline service worker for «دک‌ساز کلش رویال».
// - App shell: precached, cache-first, replaced when VERSION changes.
// - data/*.json: NETWORK-FIRST (so the daily card update reaches the phone), cached fallback offline.
// - Card images: local thumbnails precached from data/cards.json at install; any other image
//   (new cards, official CDN api-assets.clashroyale.com) cached on first view in a long-lived cache.
const VERSION = 'clash-deck-v1.0.1';
const IMG_CACHE = 'clash-deck-img-v1';
const DATA_CACHE = 'clash-deck-data-v1';
const KEEP = new Set([VERSION, IMG_CACHE, DATA_CACHE]);
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/engine.js', './js/catalog.js', './js/knowledge.js', './js/store.js', './js/jalali.js',
  './fonts/Vazirmatn-Variable.woff2',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    await (await caches.open(VERSION)).addAll(ASSETS);
    try {
      const res = await fetch('./data/cards.json', { cache: 'no-cache' });
      const dc = await caches.open(DATA_CACHE);
      await dc.put('./data/cards.json', res.clone());
      const cat = await res.json();
      const imgs = [...new Set(cat.cards.flatMap((c) => Object.values(c.img || {})))].map((p) => './' + p);
      const ic = await caches.open(IMG_CACHE);
      const have = new Set((await ic.keys()).map((r) => new URL(r.url).pathname));
      await Promise.all(imgs.filter((p) => !have.has(new URL(p, self.location).pathname)).map((p) => ic.add(p).catch(() => {})));
    } catch { /* offline install: images will be cached on first view */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('clash-deck') && !KEEP.has(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isImg = req.destination === 'image' || /\/img\/cards\//.test(url.pathname) || url.hostname === 'api-assets.clashroyale.com';
  if (url.origin !== self.location.origin && url.hostname !== 'api-assets.clashroyale.com') return; // player API etc: never cached

  if (url.origin === self.location.origin && url.pathname.includes('/data/')) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA_CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error())));
    return;
  }
  if (isImg) {
    e.respondWith(caches.open(IMG_CACHE).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }))).catch(() => Response.error()));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
