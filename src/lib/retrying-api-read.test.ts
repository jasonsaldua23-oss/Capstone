import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { retryingApiRead } from './retrying-api-read.ts'

// Allow fetch body streams and promise continuations to settle between retry ticks.
async function flushReads() {
  for (let i = 0; i < 10; i++) await setImmediate()
}

test('persistent outages stop after three attempts so the loader can show an error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const pending = retryingApiRead(async () => {
    calls++
    throw new TypeError('Failed to fetch')
  }, new AbortController().signal)
  const rejected = assert.rejects(pending, /Could not load the latest data/)
  for (let i = 0; i < 2; i++) {
    await flushReads()
    t.mock.timers.tick(30_000)
  }
  await rejected
  assert.equal(calls, 3)
})

test('transient gateway, malformed and unsuccessful responses recover without consuming the result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const first of [
    new Response('Gateway unavailable', { status: 503 }),
    new Response('', { status: 429 }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    Response.json({ success: false }),
  ]) {
    let calls = 0
    const pending = retryingApiRead(async () => ++calls === 1 ? first : Response.json({ orders: [] }), new AbortController().signal)
    await flushReads()
    t.mock.timers.tick(30_000)
    assert.deepEqual(await (await pending).json(), { orders: [] })
    assert.equal(calls, 2)
  }
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
