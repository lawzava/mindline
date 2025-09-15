// Mindline PWA Service Worker
const CACHE_NAME = 'mindline-v1.0.0';
const STATIC_CACHE_NAME = 'mindline-static-v1.0.0';
const DYNAMIC_CACHE_NAME = 'mindline-dynamic-v1.0.0';

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/js/config.js',
  '/js/env-config.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  // Webpack bundles will be cached dynamically
];

// Install event - cache static assets
self.addEventListener('install', event => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached successfully');
        return self.skipWaiting(); // Activate immediately
      })
      .catch(error => {
        console.error('[SW] Failed to cache static assets:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            // Delete old caches that don't match current version
            if (cacheName !== STATIC_CACHE_NAME &&
                cacheName !== DYNAMIC_CACHE_NAME &&
                (cacheName.startsWith('mindline-static-') ||
                 cacheName.startsWith('mindline-dynamic-'))) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim(); // Take control of all pages
      })
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and chrome-extension requests
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') {
    return;
  }

  // Skip WebSocket and EventSource requests
  if (request.headers.get('upgrade') === 'websocket' ||
      request.headers.get('accept') === 'text/event-stream') {
    return;
  }

  // Handle navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // If successful, return the fresh response
          if (response.ok) {
            return response;
          }
          // If failed, try cache as fallback
          return caches.match('/');
        })
        .catch(() => {
          // Return cached index page as fallback for offline
          return caches.match('/');
        })
    );
    return;
  }

  // Handle static assets
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request)
        .then(response => {
          if (response) {
            console.log('[SW] Serving from cache:', request.url);
            return response;
          }

          // Not in cache, fetch from network
          return fetch(request)
            .then(networkResponse => {
              // Only cache successful responses
              if (networkResponse.status === 200) {
                const responseClone = networkResponse.clone();

                // Cache CSS, JS, and other assets dynamically
                if (request.url.includes('.css') ||
                    request.url.includes('.js') ||
                    request.url.includes('.wasm') ||
                    request.url.includes('/icons/') ||
                    request.url.includes('.png') ||
                    request.url.includes('.jpg') ||
                    request.url.includes('.svg')) {

                  caches.open(DYNAMIC_CACHE_NAME)
                    .then(cache => {
                      console.log('[SW] Caching dynamic asset:', request.url);
                      cache.put(request, responseClone);
                    });
                }
              }

              return networkResponse;
            })
            .catch(error => {
              console.log('[SW] Network fetch failed:', error);

              // Return cached version if available
              return caches.match(request);
            });
        })
    );
  }
});

// Background sync for offline message queue (future enhancement)
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    console.log('[SW] Background sync triggered');
    event.waitUntil(syncOfflineActions());
  }
});

// Push notifications (future enhancement)
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    console.log('[SW] Push notification received:', data);

    const options = {
      body: data.body || 'New message in Mindline',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      vibrate: [100, 50, 100],
      data: data.data || {},
      actions: [
        {
          action: 'open',
          title: 'Open Chat',
          icon: '/icons/icon-72x72.png'
        },
        {
          action: 'close',
          title: 'Dismiss'
        }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'Mindline', options)
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window' })
        .then(clientList => {
          // If a window is already open, focus it
          for (const client of clientList) {
            if (client.url === '/' && 'focus' in client) {
              return client.focus();
            }
          }

          // Otherwise, open a new window
          if (clients.openWindow) {
            return clients.openWindow('/');
          }
        })
    );
  }
});

// Helper function for background sync (future enhancement)
async function syncOfflineActions() {
  try {
    // This would sync any queued messages or actions when back online
    console.log('[SW] Syncing offline actions...');

    // Implementation would go here to:
    // 1. Get queued actions from IndexedDB
    // 2. Send them to the server
    // 3. Clear the queue on success

    return Promise.resolve();
  } catch (error) {
    console.error('[SW] Sync failed:', error);
    throw error;
  }
}

// Message handler for communication with main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('[SW] Service worker loaded successfully');