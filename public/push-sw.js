self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

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
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => new URL(client.url).origin === self.location.origin)
      if (existingClient) {
        existingClient.navigate(targetUrl)
        return existingClient.focus()
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})

// A service worker only makes a site installable once it handles fetches. This one
// stays a pass-through on purpose: the portals are dynamic and must never be served
// stale data from a cache, so the request goes to the network exactly as it would
// without a worker, and a failure is left for the page to handle.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  event.respondWith(fetch(event.request))
})
