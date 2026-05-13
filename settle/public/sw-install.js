// Minimal service worker — required for PWA installability + Web Push.
//
// Caching strategy: none, requests pass through to the network so the app
// behaves identically to the non-SW version.
//
// Push: receives notification payloads sent via web-push on the server,
// renders them through the OS notification UI, and routes the click to
// the URL embedded in the payload.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // Fall back to raw text if the payload wasn't JSON.
    try { data = { title: 'Blip Money', body: event.data ? event.data.text() : '' }; } catch { data = {}; }
  }

  const title = data.title || 'Blip Money';
  const body = data.body || '';
  const tag = data.tag || undefined;
  const url = data.url || '/';
  const icon = data.icon || '/icons/icon.svg';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon,
      badge: '/icons/icon.svg',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // If a window is already open at any URL on this origin, focus it and
    // navigate to the deep link rather than spawning a new tab.
    for (const client of allClients) {
      if ('focus' in client) {
        try {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(url);
          }
          return;
        } catch {
          // fall through to openWindow
        }
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(url);
    }
  })());
});
