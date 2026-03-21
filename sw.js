// SportTrack Pro — Service Worker
const CACHE = 'sporttrack-v4';
const ASSETS = [
  './',
  './index.html',
  './config.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Syne:wght@700;800&family=JetBrains+Mono:wght@400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

// Install: pre-cache assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(ASSETS).catch(() => {})
    ).then(() => self.skipWaiting())
  );
});

// Activate: remove old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network first per Supabase, cache first per assets statici
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Supabase API: sempre network, no cache
  if (url.hostname.includes('supabase.co')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Assets statici: cache first, fallback network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
