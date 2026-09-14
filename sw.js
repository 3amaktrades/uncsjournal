// Unc's Journal service worker — installable PWA + fast/offline app shell.
// Bump CACHE when the shell changes to retire the old cache.
const CACHE = 'uncj-v1';
const SHELL = ['/app', '/assets/icon-192.png', '/assets/icon-512.png', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never touch live data — Supabase and the Workers must always hit the network.
  if (url.hostname.includes('supabase.co') || url.hostname.includes('workers.dev')) return;

  // Navigations: network-first (so deploys show up), fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); return r; })
        .catch(() => caches.match(req).then((m) => m || caches.match('/app')))
    );
    return;
  }

  // Static assets (same-origin + the CDN libs): cache-first, then network.
  e.respondWith(
    caches.match(req).then((m) => m || fetch(req).then((r) => {
      if (r.ok && (url.origin === self.location.origin || url.hostname.includes('jsdelivr'))) {
        const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp));
      }
      return r;
    }).catch(() => m))
  );
});
