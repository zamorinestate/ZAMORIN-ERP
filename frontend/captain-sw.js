// =============================================================================
// ZAMORIN CAFÉ ERP — CAPTAIN APP SERVICE WORKER (captain-sw.js)
// Handles: offline KOT outbox flush via Background Sync (B-Sync API)
// Registered by: waiterCaptainApp.js (navigator.serviceWorker.register)
// =============================================================================

const CAPTAIN_CACHE = 'zamorin-captain-v1.0';
const CAPTAIN_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './src/styles/tokens.css',
  './src/styles/zamorin.css',
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CAPTAIN_CACHE)
      .then((cache) => cache.addAll(CAPTAIN_SHELL).catch((err) => {
        console.warn('[CaptainSW] Pre-cache non-blocking warn:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys
          .filter((k) => k !== CAPTAIN_CACHE)
          .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch (Shell fallback for navigation only) ────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Pass API calls straight through — never cache POS/KOT data
  if (url.pathname.startsWith('/api/')) return;

  // Cache-first for static assets
  if (
    url.origin === self.location.origin &&
    (url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.svg'))
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CAPTAIN_CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Navigation: network-first → offline shell fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('./index.html') || caches.match('/index.html')
      )
    );
  }
});

// ── Background Sync ───────────────────────────────────────────────────────────
// When the browser comes back online it fires the registered sync tag.
// We post a message to the page so waiterCaptainApp.js can run flushOfflineOutbox().
self.addEventListener('sync', (event) => {
  if (event.tag === 'captain-kot-outbox-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => {
          for (const client of clients) {
            client.postMessage({ type: 'CAPTAIN_FLUSH_KOT_OUTBOX' });
          }
        })
    );
  }
});

// ── Push Notifications (KDS kitchen-ready alert) ──────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Zamorin Café';
  const body  = data.body  || 'Kitchen update ready.';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/src/assets/zamorin-app-icon-1024.png',
      badge: '/src/assets/zamorin-app-icon-1024.png',
      tag: 'captain-kitchen-update',
      renotify: true,
    })
  );
});
