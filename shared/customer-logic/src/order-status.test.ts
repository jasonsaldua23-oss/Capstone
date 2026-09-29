import test from 'node:test'
import assert from 'node:assert/strict'
import { formatOrderStatus, getOrderStageIndex, isOrderTrackable, normalizeDeliveryStatus } from './order-status.ts'

test('an approved order reads Approved until the warehouse starts processing it', () => {
  // CONFIRMED is the name APPROVED had before the rename; cached orders may still carry it.
  for (const status of ['APPROVED', 'CONFIRMED']) {
    assert.equal(normalizeDeliveryStatus(status), 'APPROVED')
    assert.equal(formatOrderStatus(status), 'APPROVED')
    // First step of the timeline ("Order Confirmed"), not yet Processing.
    assert.equal(getOrderStageIndex(status), 0)
    assert.equal(isOrderTrackable(status), true)
  }
})

test('Processing starts when the warehouse starts processing', () => {
  assert.equal(normalizeDeliveryStatus('PREPARING'), 'PREPARING')
  assert.equal(formatOrderStatus('PREPARING'), 'PROCESSING')
  assert.equal(getOrderStageIndex('PREPARING'), 1)
  assert.equal(getOrderStageIndex('OUT_FOR_DELIVERY'), 2)
  assert.equal(getOrderStageIndex('DELIVERED'), 3)
})

test('an order whose payment awaits approval still reads Pending', () => {
  assert.equal(formatOrderStatus('APPROVED', 'pending_approval'), 'PENDING')
  assert.equal(getOrderStageIndex('APPROVED', 'pending_approval'), 0)
})
