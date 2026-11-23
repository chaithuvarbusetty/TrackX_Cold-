// ColdChain Telemetry - Native Background Service Worker
// Provides 100% zero-cost lock-screen push notifications & deep-linking

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming background push payload
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'ColdChain Telemetry Alert', body: event.data.text() };
    }
  }

  const title = data.title || '🚨 ColdChain Critical Alert';
  const options = {
    body: data.body || 'Telemetry threshold exceeded on monitored vehicle.',
    icon: data.icon || '/favicon.ico',
    badge: data.badge || '/favicon.ico',
    tag: data.tag || 'coldchain-' + Date.now(),
    data: {
      url: data.url || '/',
      device_id: data.device_id || 'GW-001',
      created_at_ms: Date.now()
    },
    vibrate: [300, 100, 300, 100, 400],
    requireInteraction: true,
    renotify: true,
    actions: [
      { action: 'open_map', title: '📍 View Fleet Map' },
      { action: 'dismiss', title: '✕ Dismiss' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle user clicking the notification on lock screen or status bar
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a dashboard window is already open, focus it and navigate
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && client.url !== targetUrl) {
            client.navigate(targetUrl);
          }
          return;
        }
      }
      // If no window is open, open a new window to the dashboard
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
