import test from 'node:test'
import assert from 'node:assert/strict'

import { buildDeliveredTransactions } from './delivered-transactions'

// Local-time constructors keep these independent of the test machine's zone.
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 8, day, hours, minutes).toISOString()

const completedTrip = {
  id: 'trip-83',
  tripNumber: 'TRP-2026-0083',
  status: 'COMPLETED',
  driver: { name: 'Dan Driver' },
  dropPoints: [
    {
      id: 'dp-117',
      orderId: 'order-117',
      orderNumber: 'PO-2026-0117',
      status: 'COMPLETED',
      locationName: 'Ana Customer',
      address: 'Lot 1, Talisay',
      latitude: 10.74,
      longitude: 122.98,
      actualArrival: at(26, 22, 40),
      actualDeparture: at(26, 22, 41),
      recipientName: 'Ana',
      order: { id: 'order-117', deliveryDate: at(26, 0) },
    },
    {
      id: 'dp-failed',
      orderId: 'order-failed',
      orderNumber: 'PO-2026-0120',
      status: 'FAILED',
      latitude: 10.7,
      longitude: 122.9,
      actualDeparture: at(26, 21),
    },
  ],
}

test('a stop counts on the day it was delivered, not the day it was scheduled', () => {
  const lateTrip = {
    id: 'trip-77',
    tripNumber: 'TRP-2026-0077',
    status: 'COMPLETED',
    driver: { user: { name: 'Lee Driver' } },
    dropPoints: [
      {
        id: 'dp-109',
        orderId: 'order-109',
        orderNumber: 'PO-2026-0109',
        status: 'COMPLETED',
        latitude: 10.7,
        longitude: 122.9,
        actualArrival: at(25, 3, 12),
        actualDeparture: at(26, 22, 10),
        // Scheduled two days earlier; it must still appear on the 26th.
        order: { id: 'order-109', deliveryDate: at(24, 0) },
      },
    ],
  }

  const delivered = buildDeliveredTransactions({ trips: [completedTrip, lateTrip], dayKey: '2026-09-26' })

  assert.deepEqual(delivered.map((row) => row.orderNumber), ['PO-2026-0117', 'PO-2026-0109'])
  assert.equal(delivered[0].tripNumber, 'TRP-2026-0083')
  assert.equal(delivered[0].driverName, 'Dan Driver')
  assert.equal(delivered[0].customerName, 'Ana Customer')
  assert.equal(delivered[0].deliveredAt, at(26, 22, 41))
  assert.equal(delivered[1].driverName, 'Lee Driver')
  assert.deepEqual(buildDeliveredTransactions({ trips: [lateTrip], dayKey: '2026-09-24' }), [])
})

test('failed stops are not deliveries', () => {
  const delivered = buildDeliveredTransactions({ trips: [completedTrip], dayKey: '2026-09-26' })
  assert.equal(delivered.some((row) => row.orderNumber === 'PO-2026-0120'), false)
})

test('orders marked delivered without a trip stop still appear, once', () => {
  const orders = [
    // Already covered by the trip stop above.
    { id: 'order-117', orderNumber: 'PO-2026-0117', status: 'DELIVERED', deliveredAt: at(26, 22, 41) },
    // Delivered by a direct status update; no trip carried it.
    {
      id: 'order-130', orderNumber: 'PO-2026-0130', status: 'DELIVERED', deliveredAt: at(26, 9),
      shippingName: 'Walk-up', shippingAddress: 'Silay', shippingLatitude: 10.8, shippingLongitude: 122.97,
    },
    { id: 'order-131', orderNumber: 'PO-2026-0131', status: 'OUT_FOR_DELIVERY', deliveredAt: null },
    { id: 'order-132', orderNumber: 'PO-2026-0132', status: 'DELIVERED', deliveredAt: at(25, 9) },
  ]

  const delivered = buildDeliveredTransactions({ trips: [completedTrip], orders, dayKey: '2026-09-26' })

  assert.deepEqual(delivered.map((row) => row.orderNumber), ['PO-2026-0117', 'PO-2026-0130'])
  assert.equal(delivered[1].tripNumber, '')
  assert.equal(delivered[1].latitude, 10.8)
})

test('a legacy delivered order with no delivery time falls back to its scheduled day', () => {
  const orders = [{ id: 'order-140', orderNumber: 'PO-2026-0140', status: 'DELIVERED', deliveredAt: null, deliveryDate: at(26, 0) }]
  assert.deepEqual(
    buildDeliveredTransactions({ trips: [], orders, dayKey: '2026-09-26' }).map((row) => row.orderNumber),
    ['PO-2026-0140']
  )
})
