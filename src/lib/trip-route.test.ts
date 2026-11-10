import test from 'node:test'
import assert from 'node:assert/strict'
import { describeTripDestination, describeTripRoute } from './trip-route.ts'

test('a trip runs from its warehouse to its last stop', () => {
  const trip = { warehouse: { name: 'AAB Silay Warehouse' }, dropPoints: [{ locationName: 'Stop A' }, { locationName: 'Lopez Store' }] }
  assert.equal(describeTripRoute(trip), 'AAB Silay Warehouse -> Lopez Store')
  assert.equal(describeTripRoute(trip, 'Warehouse'), 'Warehouse -> Lopez Store')
})

test('a trip whose stops all moved names the trip that took them', () => {
  assert.equal(describeTripDestination({ dropPoints: [], transferredToNumber: 'TRP-2026-0205' }), 'stops moved to TRP-2026-0205')
})

test('a stop or warehouse without a name falls back to a generic label', () => {
  assert.equal(describeTripRoute({ dropPoints: [{}] }), 'Warehouse -> Destination')
  assert.equal(describeTripRoute({}), 'Warehouse -> Destination')
})
