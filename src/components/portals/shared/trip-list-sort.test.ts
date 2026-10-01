import test from 'node:test'
import assert from 'node:assert/strict'

import { sortTripsForList, tripListSortParam } from './trip-list-sort.ts'

test('delivery-date sorting shows the latest day first and does not use creation time', () => {
  const trips = [
    { tripNumber: 'TRP-3', tripSchedule: null, createdAt: '2026-01-01' },
    { tripNumber: 'TRP-2', tripSchedule: '2026-09-26T08:00:00+08:00', createdAt: '2026-01-01' },
    { tripNumber: 'TRP-1', tripSchedule: '2026-09-22T08:00:00+08:00', createdAt: '2026-09-21' },
  ]

  assert.deepEqual(
    sortTripsForList(trips, 'DELIVERY_DATE').map((trip) => trip.tripNumber),
    ['TRP-2', 'TRP-1', 'TRP-3'],
  )
  assert.equal(tripListSortParam('DELIVERY_DATE'), 'scheduled')
})

test('planned trips that missed their day come first under the delivery-date sort', () => {
  const trips = [
    { tripNumber: 'TRP-10', status: 'PLANNED', isOverdue: false, tripSchedule: '2026-10-09T08:00:00+08:00' },
    { tripNumber: 'TRP-11', status: 'PLANNED', isOverdue: true, tripSchedule: '2026-09-28T08:00:00+08:00' },
    { tripNumber: 'TRP-12', status: 'COMPLETED', tripSchedule: '2026-09-30T08:00:00+08:00' },
  ]

  assert.deepEqual(
    sortTripsForList(trips, 'DELIVERY_DATE').map((trip) => trip.tripNumber),
    ['TRP-11', 'TRP-10', 'TRP-12'],
  )
  // The trip-ID sort is for looking a trip up, so it stays a plain ID order.
  assert.deepEqual(
    sortTripsForList(trips, 'TRIP_ID').map((trip) => trip.tripNumber),
    ['TRP-12', 'TRP-11', 'TRP-10'],
  )
})
