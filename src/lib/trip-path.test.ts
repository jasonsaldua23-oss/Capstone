import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeTripPathTails, tripPathPoints, tripPathsFromTrips, type TripPaths } from './trip-path.ts'

const at = (seconds: number) => Date.parse('2026-09-29T08:00:00Z') + seconds * 1000
const iso = (seconds: number) => new Date(at(seconds)).toISOString()

test('a trip refresh gives each trip the road it has taken so far', () => {
  const paths = tripPathsFromTrips([
    { id: 't1', pathPoints: [[10.70, 122.95], [10.70, 122.951]], pathEndsAt: iso(10) },
    { id: 't2', pathPoints: [] },
  ], {})
  assert.deepEqual(tripPathPoints(paths.t1), [[10.70, 122.95], [10.70, 122.951]])
  assert.equal(paths.t2, undefined)
})

test('position refreshes grow the road with only what is new, in order', () => {
  let paths: TripPaths = tripPathsFromTrips([
    { id: 't1', pathPoints: [[10.70, 122.95], [10.70, 122.951]], pathEndsAt: iso(10) },
  ], {})
  paths = mergeTripPathTails(paths, [{ tripId: 't1', pathTail: [[10.70, 122.951, at(10)], [10.70, 122.952, at(15)]] }])
  paths = mergeTripPathTails(paths, [{ tripId: 't1', pathTail: [[10.70, 122.952, at(15)], [10.70, 122.953, at(20)]] }])
  assert.deepEqual(tripPathPoints(paths.t1), [[10.70, 122.95], [10.70, 122.951], [10.70, 122.952], [10.70, 122.953]])
})

test('a later trip refresh takes over the road it covers and keeps what came after it', () => {
  let paths: TripPaths = tripPathsFromTrips([{ id: 't1', pathPoints: [[10.70, 122.95]], pathEndsAt: iso(0) }], {})
  paths = mergeTripPathTails(paths, [{ tripId: 't1', pathTail: [[10.70, 122.951, at(5)], [10.70, 122.952, at(10)], [10.70, 122.953, at(15)]] }])
  paths = tripPathsFromTrips([{ id: 't1', pathPoints: [[10.70, 122.95], [10.70, 122.951], [10.70, 122.9521]], pathEndsAt: iso(10) }], paths)
  assert.deepEqual(tripPathPoints(paths.t1), [[10.70, 122.95], [10.70, 122.951], [10.70, 122.9521], [10.70, 122.953]])
})

test('a trip first seen through position refreshes starts its road from them', () => {
  const paths = mergeTripPathTails({}, [{ tripId: 't9', pathTail: [[10.7, 122.95, at(0)], [10.7, 122.951, at(5)]] }])
  assert.deepEqual(tripPathPoints(paths.t9), [[10.7, 122.95], [10.7, 122.951]])
})

test('malformed points are ignored', () => {
  const paths = mergeTripPathTails({}, [{ tripId: 't1', pathTail: [[10.7, 'x', at(0)], null, [10.7, 122.95, at(1)]] }])
  assert.deepEqual(tripPathPoints(paths.t1), [[10.7, 122.95]])
})
