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
