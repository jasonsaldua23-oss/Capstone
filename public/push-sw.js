self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }
  // A malformed payload must not prevent the OS from showing a received push.
  if (!payload || typeof payload !== 'object') payload = {}

  const data = payload.data || {}
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Ann Ann\'s Beverages Trading', {
      body: payload.body || '',
      icon: payload.icon || '/ann-anns-logo.png',
      badge: payload.badge || '/ann-anns-logo.png',
      data,
      // Group repeated updates for the same order or trip without hiding unrelated events.
      tag: data.referenceId ? `${data.referenceType || 'notification'}:${data.referenceId}` : undefined,
      // Fix: replacing an order/trip notification should alert again instead of updating silently.
      renotify: Boolean(data.referenceId),
      silent: false,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const existingClient = clients.find((client) => new URL(client.url).origin === self.location.origin)
      if (existingClient) {
        // Keep the worker alive until navigation finishes, including a cold-started portal.
        await existingClient.navigate(targetUrl)
        return existingClient.focus()
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Fix: this worker exists only for Web Push. Do not intercept page or API requests;
// a pass-through respondWith() turns an upstream outage into a rejected FetchEvent
// and can make navigation fail under the worker instead of the browser network stack.
