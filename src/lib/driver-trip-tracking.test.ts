import test from 'node:test'
import assert from 'node:assert/strict'
import { isTripUnderway, tripTrackingAction } from './driver-trip-tracking.ts'

const now = 1_000_000

test('a trip is underway once started, however the status is spelled', () => {
  for (const status of ['IN_PROGRESS', 'in_transit', 'OUT_FOR_DELIVERY']) assert.equal(isTripUnderway(status), true)
  for (const status of ['PLANNED', 'COMPLETED', 'CANCELLED', '', null, undefined]) assert.equal(isTripUnderway(status), false)
})

test('opening a trip that has not started does not start tracking the phone', () => {
  const action = tripTrackingAction({
    trips: [{ id: 't1', status: 'PLANNED' }], selectedTripId: 't1', running: false, explicitStartAtMs: 0, nowMs: now,
  })
  assert.equal(action, 'leave')
})

test('an unstarted trip left open does not keep an old session running', () => {
  const action = tripTrackingAction({
    trips: [{ id: 't1', status: 'PLANNED' }], selectedTripId: 't1', running: true, explicitStartAtMs: 0, nowMs: now,
  })
  assert.equal(action, 'stop')
})

test('the session Start Trip just opened survives until the server confirms the start', () => {
  const action = tripTrackingAction({
    trips: [{ id: 't1', status: 'PLANNED' }], selectedTripId: 't1', running: true, explicitStartAtMs: now - 5_000, nowMs: now,
  })
  assert.equal(action, 'leave')
})

test('a trip underway keeps the phone tracked, even while another trip is open', () => {
  const action = tripTrackingAction({
    trips: [{ id: 't1', status: 'PLANNED' }, { id: 't2', status: 'IN_PROGRESS' }],
    selectedTripId: 't1', running: false, explicitStartAtMs: 0, nowMs: now,
  })
  assert.equal(action, 'ensure-running')
})

test('tracking stops once no trip is underway', () => {
  const action = tripTrackingAction({
    trips: [{ id: 't1', status: 'COMPLETED' }], selectedTripId: 't1', running: true, explicitStartAtMs: 0, nowMs: now,
  })
  assert.equal(action, 'stop')
})
