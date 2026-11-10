import test from 'node:test'
import assert from 'node:assert/strict'
import { alarmHeadline, alarmingIncidents } from './incident-alarm.ts'
import { parseIncident, type VehicleIncident } from './vehicle-incidents.ts'

const incident = (overrides: Partial<Record<string, unknown>> = {}): VehicleIncident => {
  const parsed = parseIncident({
    id: 'inc-1',
    incidentNumber: 'INC-2026-0001',
    type: 'ACCIDENT',
    status: 'REPORTED',
    vehicleCanContinue: false,
    description: 'Rear-ended at the rotunda',
    tripId: 'trip-1',
    tripNumber: 'TRP-2026-0001',
    driverName: 'Juan',
    vehiclePlate: 'ABC-1234',
    reportedAt: '2026-11-10T06:00:00Z',
    canManage: true,
    ...overrides,
  })
  assert.ok(parsed)
  return parsed
}

test('a report nobody has acknowledged rings for the staff who can acknowledge it', () => {
  assert.deepEqual(alarmingIncidents([incident()]).map((row) => row.id), ['inc-1'])
})

test('acknowledging or resolving it stops the alarm', () => {
  assert.deepEqual(alarmingIncidents([incident({ status: 'ACKNOWLEDGED', acknowledgedBy: 'Wally' })]), [])
  assert.deepEqual(alarmingIncidents([incident({ status: 'RESOLVED', resolutionOutcome: 'RESUMED' })]), [])
})

test('staff who cannot acknowledge it are not rung, or it would never stop for them', () => {
  // Another warehouse's trip, or an admin reading the list.
  assert.deepEqual(alarmingIncidents([incident({ canManage: false })]), [])
})

test('several reports ring together, newest first', () => {
  const rows = alarmingIncidents([
    incident({ id: 'older', reportedAt: '2026-11-10T06:00:00Z' }),
    incident({ id: 'done', status: 'ACKNOWLEDGED', reportedAt: '2026-11-10T06:30:00Z' }),
    incident({ id: 'newer', reportedAt: '2026-11-10T07:00:00Z', type: 'VEHICLE_DAMAGE' }),
  ])
  assert.deepEqual(rows.map((row) => row.id), ['newer', 'older'])
})

test('the headline says what happened in capitals', () => {
  assert.equal(alarmHeadline(incident()), 'ACCIDENT REPORTED')
  assert.equal(alarmHeadline(incident({ type: 'VEHICLE_DAMAGE' })), 'VEHICLE DAMAGE REPORTED')
})
