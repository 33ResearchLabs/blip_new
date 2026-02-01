// Self-destructing service worker - unregisters itself immediately
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clear all caches
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));

      // Unregister this service worker
      await self.registration.unregister();

      // Refresh all clients to load without SW
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => client.navigate(client.url));
    })()
  );
});

// Don't intercept any requests - let them pass through
self.addEventListener('fetch', () => {});
