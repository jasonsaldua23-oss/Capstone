import test from 'node:test'
import assert from 'node:assert/strict'
import { countOpenStops, getTripQueue, ordinal } from './driver-trip-queue.ts'

const TODAY = '2026-10-22'
const trip = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  tripNumber: id,
  status: 'PLANNED',
  scheduledDate: TODAY,
  isOverdue: false,
  ...overrides,
})

test('the running trip leads, then the day runs in planned order', () => {
  const queue = getTripQueue([
    trip('TRP-3', { plannedStartAt: '2026-10-22T00:00:00Z' }),
    trip('TRP-1', { status: 'IN_PROGRESS', plannedStartAt: '2026-10-22T07:00:00Z' }),
    trip('TRP-2', { plannedStartAt: '2026-10-22T05:00:00Z' }),
    trip('TRP-4'),
  ], TODAY)

  const order = [...queue.entries()].sort((a, b) => a[1].position - b[1].position).map(([id]) => id)
  assert.deepEqual(order, ['TRP-1', 'TRP-3', 'TRP-2', 'TRP-4'])
  assert.deepEqual(queue.get('TRP-1'), { dayKey: TODAY, position: 1, count: 4, isRunning: true, blockedBy: null, plannedAfter: null })
  // Behind the running trip: it must finish first.
  assert.equal(queue.get('TRP-3')?.blockedBy, 'TRP-1')
  assert.equal(queue.get('TRP-3')?.plannedAfter, null)
  // Behind a planned trip: that one is planned to go first.
  assert.equal(queue.get('TRP-2')?.plannedAfter, 'TRP-3')
})

test('trips planned for the same time follow their trip numbers', () => {
  const queue = getTripQueue([trip('TRP-2026-0012'), trip('TRP-2026-0011')], TODAY)
  assert.equal(queue.get('TRP-2026-0011')?.position, 1)
  assert.equal(queue.get('TRP-2026-0012')?.plannedAfter, 'TRP-2026-0011')
})

test('each day keeps its own queue, and closed or overdue trips have none', () => {
  const queue = getTripQueue([
    trip('TODAY-A'),
    trip('TOMORROW-A', { scheduledDate: '2026-10-23' }),
    trip('TOMORROW-B', { scheduledDate: '2026-10-23' }),
    trip('DONE', { status: 'COMPLETED' }),
    trip('MISSED', { scheduledDate: '2026-10-21', isOverdue: true }),
  ], TODAY)

  assert.deepEqual([queue.get('TODAY-A')?.position, queue.get('TODAY-A')?.count], [1, 1])
  assert.deepEqual([queue.get('TOMORROW-B')?.position, queue.get('TOMORROW-B')?.count], [2, 2])
  assert.equal(queue.has('DONE'), false)
  assert.equal(queue.has('MISSED'), false)
})

test('a trip still running from yesterday holds today', () => {
  const queue = getTripQueue([
    trip('YESTERDAY', { status: 'IN_PROGRESS', scheduledDate: '2026-10-21' }),
    trip('TODAY-A'),
  ], TODAY)

  assert.equal(queue.get('YESTERDAY')?.dayKey, TODAY)
  assert.equal(queue.get('TODAY-A')?.blockedBy, 'YESTERDAY')
})

test('a load transfer counts for today, whatever day its orders were due', () => {
  const queue = getTripQueue([
    trip('RESCUE', { scheduledDate: '2026-10-20', transferredFromNumber: 'BROKEN' }),
    trip('TODAY-A'),
  ], TODAY)

  assert.equal(queue.get('RESCUE')?.dayKey, TODAY)
  // Its goods wait at the roadside, so it runs before the day's other planned trips.
  assert.equal(queue.get('RESCUE')?.position, 1)
  assert.equal(queue.get('TODAY-A')?.plannedAfter, 'RESCUE')
})

test('open stops are the ones still waiting for an outcome', () => {
  const dropPoints = ['COMPLETED', 'PENDING', 'ARRIVED', 'FAILED', 'CANCELLED', 'IN_TRANSIT'].map((status) => ({ status }))
  assert.equal(countOpenStops({ dropPoints }), 3)
  assert.equal(countOpenStops({}), 0)
})

test('ordinals read naturally', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd'])
})
