// Service Worker — Watt Distributors Push Notifications
// This file runs in the browser background to receive and display push notifications.

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Watt Distributors', body: event.data.text() };
  }

  const { title = 'Watt Distributors', body = '', icon, url, tag } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: icon || '/logo-themed.svg',
      badge: '/logo-themed.svg',
      tag: tag || 'watt-notification',
      requireInteraction: true,       // stays until user interacts (critical alerts)
      data: { url: url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Otherwise open new tab
      return clients.openWindow(targetUrl);
    }),
  );
});
