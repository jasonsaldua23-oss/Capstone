import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVE_POLL_MS,
  HIDDEN_POLL_MS,
  MAX_BACKOFF_MS,
  MIN_BACKOFF_MS,
  nextPollDelayMs,
  readStampMap,
  scopesToRefresh,
} from './sync-hub-policy.ts'

test('the first read only takes a baseline, so portals do not reload right after mount', () => {
  assert.deepEqual(scopesToRefresh(null, { orders: 4, trips: 9 }), [])
})

test('only the scopes whose revision moved are refreshed', () => {
  const changed = scopesToRefresh({ orders: 4, trips: 9, products: 2 }, { orders: 5, trips: 9, products: 2 })
  assert.deepEqual(changed, ['orders'])
})

test('an unchanged server asks for no refresh at all', () => {
  assert.deepEqual(scopesToRefresh({ orders: 7, trips: 1 }, { orders: 7, trips: 1 }), [])
})

test('scopes that move together arrive as one refresh', () => {
  // A delivery bumps orders and both stock scopes; the portal should reload once.
  const changed = scopesToRefresh({ orders: 1, inventory: 1, stocks: 1 }, { orders: 2, inventory: 3, stocks: 3 })
  assert.deepEqual([...changed].sort(), ['inventory', 'orders', 'stocks'])
})

test('many writes missed while offline still cost a single refresh', () => {
  assert.deepEqual(scopesToRefresh({ orders: 1 }, { orders: 47 }), ['orders'])
})

test('a scope the server has just started reporting is refreshed', () => {
  // A deploy that adds a scope must not leave that screen permanently stale.
  assert.deepEqual(scopesToRefresh({ orders: 1 }, { orders: 1, notifications: 3 }), ['notifications'])
})

test('a scope the server stopped reporting does not trigger a refresh', () => {
  assert.deepEqual(scopesToRefresh({ orders: 1, retired: 5 }, { orders: 1 }), [])
})

test('a visible tab polls fast enough to read as immediate', () => {
  assert.equal(nextPollDelayMs({ failures: 0, visible: true }), ACTIVE_POLL_MS)
  assert.ok(ACTIVE_POLL_MS <= 2_000)
})

test('a hidden tab checks in rarely, since it has nothing to show', () => {
  assert.equal(nextPollDelayMs({ failures: 0, visible: false }), HIDDEN_POLL_MS)
  assert.ok(HIDDEN_POLL_MS > ACTIVE_POLL_MS)
})

test('a failing endpoint is backed off, not hammered every interval', () => {
  assert.equal(nextPollDelayMs({ failures: 1, visible: true }), MIN_BACKOFF_MS)
  assert.equal(nextPollDelayMs({ failures: 2, visible: true }), MIN_BACKOFF_MS * 2)
  assert.equal(nextPollDelayMs({ failures: 3, visible: true }), MIN_BACKOFF_MS * 4)
  assert.ok(MIN_BACKOFF_MS > ACTIVE_POLL_MS)
})

test('backoff is capped so a recovered server is noticed within a minute', () => {
  assert.equal(nextPollDelayMs({ failures: 50, visible: true }), MAX_BACKOFF_MS)
  assert.equal(nextPollDelayMs({ failures: 999, visible: false }), MAX_BACKOFF_MS)
})

test('a well-formed payload becomes the baseline', () => {
  assert.deepEqual(readStampMap({ success: true, stamps: { orders: 3, trips: 0 } }), { orders: 3, trips: 0 })
})

test('a malformed payload is rejected rather than poisoning the baseline', () => {
  // A NaN or string revision would differ from everything and refresh forever.
  assert.equal(readStampMap({ stamps: { orders: 'many' } }), null)
  assert.equal(readStampMap({ stamps: { orders: Number.NaN } }), null)
  assert.equal(readStampMap({ stamps: [] }), null)
  assert.equal(readStampMap({ stamps: null }), null)
  assert.equal(readStampMap({}), null)
  assert.equal(readStampMap(null), null)
})
