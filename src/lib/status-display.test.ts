import test from 'node:test'
import assert from 'node:assert/strict'
import { toDisplayStatus } from './status-display.ts'

test('toDisplayStatus shows the stored PREPARING status as Processing', () => {
  assert.equal(toDisplayStatus('PREPARING'), 'PROCESSING')
  assert.equal(toDisplayStatus(' preparing '), 'PROCESSING')
  // Screens keep their own casing and underscore handling after the swap.
  assert.equal(toDisplayStatus('PREPARING').replace(/_/g, ' ').toLowerCase(), 'processing')
})

test('toDisplayStatus shows IN_TRANSIT as In Progress', () => {
  // Stops, delivery legs and legacy trips all carry IN_TRANSIT; every portal says In Progress.
  assert.equal(toDisplayStatus('IN_TRANSIT'), 'IN_PROGRESS')
  assert.equal(toDisplayStatus('in_transit'), 'IN_PROGRESS')
  assert.equal(toDisplayStatus('IN_TRANSIT').replace(/_/g, ' '), 'IN PROGRESS')
})

test('toDisplayStatus leaves every other status as it was', () => {
  for (const status of ['PENDING', 'APPROVED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PENDING_APPROVAL', 'IN_PROGRESS']) {
    assert.equal(toDisplayStatus(status), status)
  }
  assert.equal(toDisplayStatus(null), '')
  assert.equal(toDisplayStatus(undefined), '')
})
