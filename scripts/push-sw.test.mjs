// Runs the real public/push-sw.js against a stand-in service worker scope.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../public/push-sw.js', import.meta.url), 'utf8')

function receivePush(payload) {
  const listeners = {}
  const shown = []
  const self = {
    location: { origin: 'https://example.test' },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }) } },
    clients: { matchAll: async () => [], openWindow: async () => null, claim: async () => undefined },
    skipWaiting: () => undefined,
    addEventListener: (type, listener) => { listeners[type] = listener },
  }
  vm.runInNewContext(source, { self, URL })
  let waited
  listeners.push({ data: { json: () => payload, text: () => JSON.stringify(payload) }, waitUntil: (promise) => { waited = promise } })
  return waited.then(() => shown[0])
}

test('a reported incident stays on the warehouse screen until someone clicks it', async () => {
  const shown = await receivePush({
    title: 'Accident reported',
    body: 'Juan reported an accident on trip TRP-1.',
    data: { type: 'INCIDENT', referenceType: 'incident', referenceId: 'inc-1', url: '/' },
  })
  assert.equal(shown.title, 'Accident reported')
  assert.equal(shown.options.requireInteraction, true)
  assert.equal(shown.options.silent, false)
})

test('everything else, including the driver being told of an acknowledgement, fades as before', async () => {
  const order = await receivePush({ title: 'Order update', data: { type: 'ORDER', referenceType: 'order', referenceId: 'o-1' } })
  assert.equal(order.options.requireInteraction, false)
  const driver = await receivePush({ title: 'Incident acknowledged', data: { type: 'INCIDENT', referenceType: 'trip', referenceId: 't-1' } })
  assert.equal(driver.options.requireInteraction, false)
})
