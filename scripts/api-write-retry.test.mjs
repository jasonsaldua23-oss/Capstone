import assert from 'node:assert/strict'
import test from 'node:test'

import { apiWrite } from '../src/lib/api-write.ts'

test('write retries an interrupted response until success is confirmed', async () => {
  let calls = 0
  const response = await apiWrite(async () => {
    calls++
    if (calls === 1) throw new TypeError('response interrupted')
    return Response.json({ success: true })
  }, { retryDelayMs: 0 })
  assert.equal((await response.json()).success, true)
  assert.equal(calls, 2)
})

test('temporary server errors and malformed success keep retrying', async () => {
  let calls = 0
  const response = await apiWrite(async () => {
    calls++
    if (calls === 1) return Response.json({ success: false }, { status: 503 })
    if (calls === 2) return new Response('<html>Proxy error</html>')
    if (calls === 3) return Response.json({ dbUnavailable: true })
    return Response.json({ success: true })
  }, { retryDelayMs: 0 })
  assert.equal((await response.json()).success, true)
  assert.equal(calls, 4)
})

test('write returns real validation and permission errors without retrying', async () => {
  for (const status of [400, 401, 403, 409, 422]) {
    let attempts = 0
    const response = await apiWrite(async () => {
      attempts += 1
      return Response.json({ success: false, error: 'Rejected' }, { status })
    }, { retryDelayMs: 0 })

    assert.equal(response.status, status)
    assert.equal(attempts, 1)
  }
})

test('write accepts a two-factor challenge as a confirmed login step', async () => {
  let attempts = 0
  const response = await apiWrite(async () => {
    attempts += 1
    return Response.json({ success: false, requiresTwoFactor: true, challengeToken: 'test-challenge' }, { status: 202 })
  }, { retryDelayMs: 0 })

  assert.equal(response.status, 202)
  assert.equal(attempts, 1)
})

test('write can preserve a detail-free client error without inventing generic copy', async () => {
  const response = await apiWrite(
    async () => Response.json({ success: false }, { status: 400 }),
    { retryDelayMs: 0, fallbackError: null },
  )

  assert.deepEqual(await response.json(), { success: false })
})
