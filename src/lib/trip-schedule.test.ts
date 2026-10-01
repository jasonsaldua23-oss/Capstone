import test from 'node:test'
import assert from 'node:assert/strict'
import { getTripScheduledDateKey, isOpenDeliveryTrip, isTripOverdue, toManilaDateKey } from './trip-schedule.ts'

test('the server flag decides whether a planned trip is overdue', () => {
  assert.equal(isTripOverdue({ status: 'PLANNED', isOverdue: true, scheduledDate: '2099-01-01' }), true)
  assert.equal(isTripOverdue({ status: 'PLANNED', isOverdue: false, scheduledDate: '2000-01-01' }), false)
})

test('only a planned trip can be overdue', () => {
  for (const status of ['IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
    assert.equal(isTripOverdue({ status, isOverdue: true, scheduledDate: '2000-01-01' }), false)
  }
})

test('without the server flag the scheduled day is compared with today in Manila', () => {
  assert.equal(isTripOverdue({ status: 'PLANNED', scheduledDate: '2000-01-01' }), true)
  assert.equal(isTripOverdue({ status: 'PLANNED', scheduledDate: toManilaDateKey() }), false)
  assert.equal(isTripOverdue({ status: 'PLANNED' }), false)
})

test('open delivery work is the running trip and planned trips that have not missed their day', () => {
  assert.equal(isOpenDeliveryTrip({ status: 'IN_PROGRESS' }), true)
  assert.equal(isOpenDeliveryTrip({ status: 'PLANNED', isOverdue: false }), true)
  // An overdue trip can no longer be started; it waits in History for the warehouse.
  assert.equal(isOpenDeliveryTrip({ status: 'PLANNED', isOverdue: true }), false)
  assert.equal(isOpenDeliveryTrip({ status: 'COMPLETED' }), false)
  assert.equal(isOpenDeliveryTrip({ status: 'CANCELLED' }), false)
})

test('trip days are Philippine calendar days', () => {
  // 16:30 UTC is already the next morning in Manila (UTC+8).
  assert.equal(toManilaDateKey('2026-09-30T16:30:00Z'), '2026-10-01')
  assert.equal(toManilaDateKey('2026-09-30T15:30:00Z'), '2026-09-30')
  assert.equal(toManilaDateKey(''), null)
})

test('the due day falls back to the earliest delivery, then the trip timestamps', () => {
  assert.equal(getTripScheduledDateKey({ scheduledDate: '2026-10-05' }), '2026-10-05')
  assert.equal(
    getTripScheduledDateKey({
      dropPoints: [
        { order: { deliveryDate: '2026-10-07T02:00:00Z' } },
        { order: { deliveryDate: '2026-10-06T02:00:00Z' } },
      ],
    }),
    '2026-10-06',
  )
  assert.equal(getTripScheduledDateKey({ plannedStartAt: '2026-10-08T01:00:00Z' }), '2026-10-08')
})
