// =============================================================================
// ZAMORIN CAFÉ ERP — SERVICE WORKER (PWA & OFFLINE KIOSK ENGINE)
// =============================================================================

const CACHE_VERSION = 'zamorin-pwa-v2.9.0-topology';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

const PRECACHE_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './src/styles/tokens.css',
  './src/styles/layout.css',
  './src/styles/components.css',
  './src/styles/zamorin.css',
  './src/styles/login2.css',
  './src/assets/zamorin-app-icon-1024.png',
];

// Install: Pre-cache core shell resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_SHELL).catch((err) => {
        console.warn('[SW] Pre-cache partial fail (non-blocking):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Prune stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== STATIC_CACHE && key !== SHELL_CACHE).map((key) => {
          return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strategy-based resource handling
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Strict Network-Only for all API & Auth requests (Zero caching of sensitive ERP data)
  if (url.pathname.startsWith('/api/') || event.request.headers.has('authorization')) {
    return;
  }

  // 2. Cache-First for Google Fonts & External Static CDNs
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 3. Stale-While-Revalidate for local static assets (CSS, JS, WebP, PNG, SVG)
  if (
    url.origin === self.location.origin &&
    (url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.webp') ||
      url.pathname.endsWith('.avif') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.json'))
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // 4. Network-First with Shell fallback for HTML navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('./index.html') || caches.match('/index.html');
      })
    );
  }
});

// 5. Background Synchronization API Handler (REC-13 / R02-09)
// Feature-detected by browser. Dispatches sync trigger to active client windows without in-memory dependency.
self.addEventListener('sync', (event) => {
  if (event.tag === 'zamorin-pos-queue-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'TRIGGER_OFFLINE_SYNC', reason: 'BACKGROUND_SYNC' });
        }
      })
    );
  }
});