// Minimal service worker — required for PWA installability.
// No caching strategy; requests pass through to the network so the
// app behaves identically to the non-SW version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
