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

test('a sign-in lockout is returned at once instead of retried silently until it ends', async () => {
  // The fourth verification-code send in 15 minutes is locked out for 15 minutes.
  // Retrying it kept the Log in button spinning, with no message, for that long.
  let attempts = 0
  const response = await apiWrite(async () => {
    attempts += 1
    return Response.json(
      { success: false, error: 'Too many attempts. Try again in 900 seconds.', retryAfter: 900 },
      { status: 429, headers: { 'Retry-After': '900' } },
    )
  }, { retryDelayMs: 0, fallbackError: null })

  assert.equal(attempts, 1)
  assert.equal(response.status, 429)
  assert.equal((await response.json()).error, 'Too many attempts. Try again in 900 seconds.')
})

test('a lockout reported only in the body is also returned at once', async () => {
  // A cross-origin reply hides Retry-After unless CORS exposes it; the body still says.
  let attempts = 0
  const response = await apiWrite(async () => {
    attempts += 1
    return Response.json({ success: false, error: 'Too many attempts.', retryAfter: 840 }, { status: 429 })
  }, { retryDelayMs: 0 })

  assert.equal(attempts, 1)
  assert.equal(response.status, 429)
})

test('a brief or unexplained 429 still retries quietly', async () => {
  for (const reply of [
    () => Response.json({ success: false }, { status: 429, headers: { 'Retry-After': '5' } }),
    () => new Response('Rate limited', { status: 429 }),
  ]) {
    let attempts = 0
    const response = await apiWrite(async () => {
      attempts += 1
      return attempts === 1 ? reply() : Response.json({ success: true })
    }, { retryDelayMs: 0 })

    assert.equal(attempts, 2)
    assert.equal((await response.json()).success, true)
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
