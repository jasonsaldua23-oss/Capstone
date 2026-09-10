import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { retryingApiRead } from './retrying-api-read.ts'

// Allow fetch body streams and promise continuations to settle between retry ticks.
async function flushReads() {
  for (let i = 0; i < 10; i++) await setImmediate()
}

test('a long outage keeps loading pending and eventually returns the real replacement data', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  let settled = false
  const pending = retryingApiRead(async () => {
    calls++
    if (calls <= 8) throw new TypeError('Failed to fetch')
    return Response.json({ replacements: [{ id: 'replacement-1' }] })
  }, new AbortController().signal).then((response) => {
    settled = true
    return response
  })

  for (let i = 0; i < 8; i++) {
    await flushReads()
    assert.equal(settled, false)
    assert.equal(calls, i + 1)
    t.mock.timers.tick(30_000)
  }
  assert.deepEqual(await (await pending).json(), { replacements: [{ id: 'replacement-1' }] })
  assert.equal(calls, 9)
})

test('gateway, rate-limit, malformed body and unsuccessful payloads retry without consuming the result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const responses = [
    new Response('Gateway unavailable', { status: 503 }),
    new Response('', { status: 429 }),
    new Response('', { status: 408 }),
    new Response('<html>Proxy error</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    Response.json({ success: false, error: 'Temporarily unavailable' }),
    Response.json({ success: true, dbUnavailable: true, orders: [] }),
    Response.json({ success: true, orders: [] }),
  ]
  let calls = 0
  const pending = retryingApiRead(async () => responses[calls++], new AbortController().signal)
  for (let i = 0; i < responses.length - 1; i++) {
    await flushReads()
    assert.equal(calls, i + 1)
    t.mock.timers.tick(30_000)
  }
  assert.deepEqual(await (await pending).json(), { success: true, orders: [] })
})

test('authentication, permission and invalid request responses are returned without retrying', async () => {
  for (const status of [400, 401, 403, 404, 405, 409, 410, 422]) {
    let calls = 0
    const response = await retryingApiRead(async () => {
      calls++
      return Response.json({ error: 'Request denied' }, { status })
    }, new AbortController().signal)
    assert.equal(response.status, status)
    assert.equal(calls, 1)
  }
})

test('cancelling during backoff stops retries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const controller = new AbortController()
  let calls = 0
  const pending = retryingApiRead(async () => {
    calls++
    throw new TypeError('Failed to fetch')
  }, controller.signal)
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await flushReads()
  controller.abort()
  await rejected
  t.mock.timers.tick(60_000)
  assert.equal(calls, 1)
})

test('cancelling in flight reaches the underlying request', async () => {
  const controller = new AbortController()
  const pending = retryingApiRead((signal) => new Promise<Response>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }), controller.signal)
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  controller.abort()
  await rejected
})

test('successful downloads and programming errors keep their original behavior', async () => {
  const download = new Response('report', { headers: { 'content-type': 'text/csv' } })
  assert.equal(await retryingApiRead(async () => download, new AbortController().signal), download)
  await assert.rejects(retryingApiRead(async () => {
    throw new ReferenceError('Broken handler')
  }, new AbortController().signal), ReferenceError)
})
