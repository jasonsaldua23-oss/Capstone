import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDeliveryEta } from './delivery-eta.ts'

test('reads the time and distance left from where the driver is now', () => {
  assert.equal(formatDeliveryEta(7, 2224), 'Arriving in about 7 min · 2.2 km away')
  assert.equal(formatDeliveryEta(2, 846), 'Arriving in about 2 min · 850 m away')
  assert.equal(formatDeliveryEta(75, 31000), 'Arriving in about 1 hr 15 min · 31.0 km away')
})

test('says the driver is almost there when a few steps from the address', () => {
  assert.equal(formatDeliveryEta(1, 60), 'Your driver is almost there')
})

test('shows the distance alone before the order is out for delivery', () => {
  assert.equal(formatDeliveryEta(null, 1500), '1.5 km away')
})

test('says nothing without a live driver position', () => {
  assert.equal(formatDeliveryEta(5, null), null)
  assert.equal(formatDeliveryEta(undefined, undefined), null)
})
