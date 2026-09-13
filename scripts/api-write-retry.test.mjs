import assert from 'node:assert/strict'
import test from 'node:test'

import { apiWrite } from '../src/lib/api-write.ts'

// Fix: a lost response after commit must never cause a second mutation.
test('write reports an ambiguous connection failure without replaying a committed write', async () => {
  let commits = 0
  await assert.rejects(apiWrite(async () => {
    commits++
    throw new TypeError('response lost after commit')
  }), /Refresh the record/)
  assert.equal(commits, 1)
})

test('temporary server errors and malformed success never replay writes', async () => {
  for (const status of [408, 425, 429, 503]) {
    let calls = 0
    const response = await apiWrite(async () => {
      calls++
      return Response.json({ success: false }, { status })
    })
    assert.equal(response.status, status)
    assert.equal(calls, 1)
  }
  let calls = 0
  await assert.rejects(apiWrite(async () => {
    calls++
    return new Response('<html>Proxy error</html>')
  }), /Refresh the record/)
  assert.equal(calls, 1)
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
