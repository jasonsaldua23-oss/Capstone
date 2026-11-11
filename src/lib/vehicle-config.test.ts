import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatVehicleStatus,
  OFF_ROAD_VEHICLE_STATUSES,
  VEHICLE_STATUS_OPTIONS,
  vehicleDispatchBlockMessage,
} from './vehicle-config.ts'

const ASK = 'Ask an administrator to assign another vehicle.'

test('a truck off the road says why, in the words trip_start answers with', () => {
  assert.equal(
    vehicleDispatchBlockMessage({ licensePlate: 'ABC-123', status: 'OUT_OF_SERVICE' }),
    `Vehicle ABC-123 is out of service and cannot be dispatched. ${ASK}`,
  )
  assert.equal(
    vehicleDispatchBlockMessage({ licensePlate: 'ABC-123', status: 'maintenance' }),
    `Vehicle ABC-123 is under maintenance and cannot be dispatched. ${ASK}`,
  )
  // A trip payload without a plate still names the problem.
  assert.equal(
    vehicleDispatchBlockMessage({ status: 'OUT_OF_SERVICE' }),
    `The vehicle is out of service and cannot be dispatched. ${ASK}`,
  )
})

test('a usable or unknown truck is not blocked here; the server stays the judge', () => {
  for (const vehicle of [{ status: 'AVAILABLE' }, { status: 'IN_USE' }, { status: '' }, {}, null, undefined]) {
    assert.equal(vehicleDispatchBlockMessage(vehicle), null)
  }
})

test('staff can set a truck Out of Service, beside Maintenance, and both keep it off the road', () => {
  assert.deepEqual(
    VEHICLE_STATUS_OPTIONS.map((option) => option.value),
    ['AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE'],
  )
  assert.equal(formatVehicleStatus('OUT_OF_SERVICE'), 'Out of Service')
  assert.deepEqual([...OFF_ROAD_VEHICLE_STATUSES].sort(), ['MAINTENANCE', 'OUT_OF_SERVICE'])
})
