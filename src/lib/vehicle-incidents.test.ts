import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INCIDENT_OUTCOME_OPTIONS,
  incidentLocationNote,
  incidentOutcomeLabel,
  incidentProgressLabel,
  parseIncident,
  parseIncidents,
  vehicleStoppedBy,
  vehicleStoppedMessage,
  withIncidentMarkers,
  type VehicleIncident,
} from './vehicle-incidents.ts'

const incident = (overrides: Partial<Record<string, unknown>> = {}): VehicleIncident => {
  const parsed = parseIncident({
    id: 'inc-1',
    incidentNumber: 'INC-2026-0001',
    type: 'ACCIDENT',
    status: 'REPORTED',
    vehicleCanContinue: false,
    description: 'Rear-ended at the rotunda',
    latitude: 10.7971,
    longitude: 122.9746,
    locationSource: 'DEVICE',
    tripId: 'trip-1',
    tripNumber: 'TRP-2026-0001',
    driverId: 'driver-a',
    driverName: 'Juan',
    vehiclePlate: 'ABC-1234',
    reportedAt: '2026-10-20T06:00:00Z',
    ...overrides,
  })
  assert.ok(parsed)
  return parsed
}

const truck = (id: string, lat = 10.7971, lng = 122.9746) => ({ id, lat, lng, markerType: 'truck' as const, driverName: 'Juan' })
const pin = (id: string) => ({ id, lat: 10.79, lng: 122.97, markerType: 'pin' as const, driverName: 'ORD-1' })

test('rows the client cannot place are dropped, and open incidents sort first', () => {
  const rows = parseIncidents([
    { id: 'old-open', type: 'ACCIDENT', status: 'ACKNOWLEDGED', reportedAt: '2026-10-19T01:00:00Z' },
    { id: 'resolved', type: 'VEHICLE_DAMAGE', status: 'RESOLVED', reportedAt: '2026-10-20T09:00:00Z' },
    { id: 'new-open', type: 'VEHICLE_DAMAGE', status: 'REPORTED', reportedAt: '2026-10-20T08:00:00Z' },
    { id: 'bad-type', type: 'FLAT_TIRE', status: 'REPORTED' },
    null,
  ])
  assert.deepEqual(rows.map((row) => row.id), ['new-open', 'old-open', 'resolved'])
  assert.deepEqual(rows.map((row) => row.isOpen), [true, true, false])
})

test('the truck of a vehicle with an open incident carries the alert where it is now', () => {
  const locations = withIncidentMarkers([pin('order-1'), truck('driver-driver-a')], [incident()])
  const flagged = locations.find((location) => location.id === 'driver-driver-a')
  assert.equal(flagged?.incident?.typeLabel, 'Accident')
  assert.equal(flagged?.incident?.tone, 'accident')
  // Still at the reported spot: the truck is the indicator, no second marker.
  assert.equal(locations.length, 2)
  assert.equal(locations.find((location) => location.id === 'order-1')?.incident, undefined)
})

test('a warning pin marks the reported spot once the vehicle has moved on', () => {
  // About 1.1 km north of where it was reported.
  const locations = withIncidentMarkers([truck('driver-driver-a', 10.8071)], [incident({ vehicleCanContinue: true })])
  assert.equal(locations.length, 2)
  const site = locations.find((location) => location.id === 'incident-inc-1')
  assert.equal(site?.markerType, 'incident')
  assert.deepEqual([site?.lat, site?.lng], [10.7971, 122.9746])
  assert.ok(locations.find((location) => location.id === 'driver-driver-a')?.incident)
})

test('a vehicle with no live position is still shown at the reported spot', () => {
  const locations = withIncidentMarkers([pin('order-1')], [incident()])
  assert.deepEqual(locations.map((location) => location.id), ['order-1', 'incident-inc-1'])
})

test('a trip with no driver id is matched through its trip id', () => {
  const locations = withIncidentMarkers([truck('driver-trip-1')], [incident({ driverId: '' })])
  assert.ok(locations[0].incident)
})

test('resolved incidents and incidents without a position add nothing', () => {
  assert.equal(withIncidentMarkers([pin('order-1')], [incident({ status: 'RESOLVED' })]).length, 1)
  const noPosition = withIncidentMarkers([pin('order-1')], [incident({ latitude: null, longitude: null })])
  assert.equal(noPosition.length, 1)
})

test('two open incidents on one vehicle flag its truck with the newer one', () => {
  const locations = withIncidentMarkers(
    [truck('driver-driver-a')],
    [
      incident({ id: 'older', reportedAt: '2026-10-20T01:00:00Z', tripId: 'trip-1' }),
      incident({ id: 'newer', reportedAt: '2026-10-20T05:00:00Z', tripId: 'trip-2', type: 'VEHICLE_DAMAGE' }),
    ]
  )
  assert.equal(locations[0].incident?.id, 'newer')
})

test('an incident closed because its trip ended keeps its outcome', () => {
  const closed = incident({ status: 'RESOLVED', resolutionOutcome: 'TRIP_ENDED' })
  assert.equal(closed.resolutionOutcome, 'TRIP_ENDED')
  assert.equal(incidentOutcomeLabel('TRIP_ENDED'), 'Closed when the trip ended')
})

test('the driver is stopped while the truck cannot move, as the server rules (incident_lifecycle)', () => {
  const stranded = incident({ vehicleCanContinue: false })
  assert.equal(vehicleStoppedBy([stranded])?.id, 'inc-1')
  assert.match(vehicleStoppedMessage(stranded), /unable to continue/)

  // Damaged but drivable, or cleared by the warehouse: the driver carries on.
  assert.equal(vehicleStoppedBy([incident({ vehicleCanContinue: true })]), null)
  assert.equal(vehicleStoppedBy([incident({ status: 'RESOLVED', resolutionOutcome: 'RESUMED' })]), null)
  assert.equal(vehicleStoppedBy([]), null)

  // Sent for repair, the truck stays put whatever the driver first said.
  const repaired = incident({ vehicleCanContinue: true, status: 'RESOLVED', resolutionOutcome: 'SENT_FOR_REPAIR' })
  assert.equal(vehicleStoppedBy([repaired])?.id, 'inc-1')
  assert.match(vehicleStoppedMessage(repaired), /sent for repair/)

  // Only the trip's latest report counts.
  const cleared = incident({ id: 'old', status: 'RESOLVED', resolutionOutcome: 'RESUMED', reportedAt: '2026-10-20T06:00:00Z' })
  const newer = incident({ id: 'new', reportedAt: '2026-10-20T07:00:00Z' })
  assert.equal(vehicleStoppedBy([cleared, newer])?.id, 'new')
  const repairedThenCleared = [
    incident({ id: 'old', status: 'RESOLVED', resolutionOutcome: 'SENT_FOR_REPAIR', reportedAt: '2026-10-20T06:00:00Z' }),
    incident({ id: 'new', status: 'RESOLVED', resolutionOutcome: 'RESUMED', reportedAt: '2026-10-20T07:00:00Z' }),
  ]
  assert.equal(vehicleStoppedBy(repairedThenCleared), null)
})

test('progress and location notes say what happens next and where the position came from', () => {
  assert.equal(incidentProgressLabel({ status: 'REPORTED', acknowledgedBy: null }), 'Awaiting warehouse response')
  assert.equal(incidentProgressLabel({ status: 'ACKNOWLEDGED', acknowledgedBy: 'Wally' }), 'Acknowledged by Wally')
  const time = () => '2:14 PM'
  assert.equal(
    incidentLocationNote({ latitude: 1, longitude: 2, locationSource: 'LAST_GPS', locationRecordedAt: '2026-10-20T06:14:00Z' }, time),
    "Driver's last GPS update at 2:14 PM"
  )
  assert.equal(
    incidentLocationNote({ latitude: null, longitude: null, locationSource: null, locationRecordedAt: null }, time),
    'No GPS position was available when this was reported'
  )
})

test('a vehicle sent for repair goes out of service, whatever was reported', () => {
  // fleet_sync.send_vehicle_for_repair: accident or damage alike, the truck stays in the yard.
  const repair = INCIDENT_OUTCOME_OPTIONS.find((option) => option.value === 'SENT_FOR_REPAIR')
  assert.equal(repair?.hint, 'The vehicle is set to Out of Service and cannot be dispatched until it is back in service.')
})
