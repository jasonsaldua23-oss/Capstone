import assert from 'node:assert/strict'
import test from 'node:test'

import { apiWrite } from '../src/lib/api-write.ts'

test('write remains pending through connection and temporary server failures until success', async () => {
  let attempts = 0
  const response = await apiWrite(async () => {
    attempts += 1
    if (attempts === 1) throw new TypeError('connection lost')
    if (attempts === 2) return Response.json({ success: false, dbUnavailable: true }, { status: 503 })
    return Response.json({ success: true })
  }, { retryDelayMs: 0 })

  assert.equal(response.ok, true)
  assert.equal(attempts, 3)
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
