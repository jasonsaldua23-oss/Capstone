import test from 'node:test'
import assert from 'node:assert/strict'

import { sortTripsForList, tripListSortParam } from './trip-list-sort'

test('delivery-date sorting is chronological and does not use creation time', () => {
  const trips = [
    { tripNumber: 'TRP-3', tripSchedule: null, createdAt: '2026-01-01' },
    { tripNumber: 'TRP-2', tripSchedule: '2026-09-26T08:00:00+08:00', createdAt: '2026-01-01' },
    { tripNumber: 'TRP-1', tripSchedule: '2026-09-22T08:00:00+08:00', createdAt: '2026-09-21' },
  ]

  assert.deepEqual(
    sortTripsForList(trips, 'DELIVERY_DATE').map((trip) => trip.tripNumber),
    ['TRP-1', 'TRP-2', 'TRP-3'],
  )
  assert.equal(tripListSortParam('DELIVERY_DATE'), 'scheduled')
})
