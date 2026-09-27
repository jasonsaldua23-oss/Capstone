import test from 'node:test'
import assert from 'node:assert/strict'

import { IDLE_STATUS_RETRY_MS, idleCheckOutcome, parseSessionIdleStatus } from './session-idle.ts'

test('a rejected session is over', () => {
  assert.deepEqual(parseSessionIdleStatus(401, { error: 'Unauthorized' }), { kind: 'expired' })
  assert.deepEqual(idleCheckOutcome({ kind: 'expired' }), { action: 'logout' })
})

test('activity in another tab postpones this tab until the shared limit', () => {
  const status = parseSessionIdleStatus(200, { success: true, idleLogout: true, idleMinutes: 30, remainingSeconds: 1200 })
  assert.deepEqual(status, { kind: 'active', remainingMs: 1_200_000 })
  assert.deepEqual(idleCheckOutcome(status), { action: 'recheck', delayMs: 1_201_000 })
})

test('a session right at its limit is checked again just past it', () => {
  const status = parseSessionIdleStatus(200, { idleLogout: true, remainingSeconds: 0 })
  assert.deepEqual(idleCheckOutcome(status), { action: 'recheck', delayMs: 1000 })
})

test('a token issued before the server rule falls back to the tab timer', () => {
  const status = parseSessionIdleStatus(200, { success: true, idleLogout: false })
  assert.deepEqual(status, { kind: 'unlimited' })
  assert.deepEqual(idleCheckOutcome(status), { action: 'logout' })
})

test('an unreachable server is asked again instead of logging out', () => {
  for (const [httpStatus, body] of [[502, null], [200, 'not json'], [200, { idleLogout: true, remainingSeconds: 'soon' }]] as const) {
    const status = parseSessionIdleStatus(httpStatus, body)
    assert.deepEqual(status, { kind: 'unknown' })
    assert.deepEqual(idleCheckOutcome(status), { action: 'recheck', delayMs: IDLE_STATUS_RETRY_MS })
  }
})
