import test from 'node:test'
import assert from 'node:assert/strict'
import { joinRoadTrack, pointAtRouteDistance } from '../../../lib/map-navigation.ts'
import { acceptTruckFix, snapTruckMotion, stepTruckMotion, truckMotionPose, type TruckMotionContext } from './truck-motion.ts'
import type { DriverLocation } from './types'

const FRAME_MS = 1000 / 60

// A straight road north from [10, 123], a vertex every 20 m.
const road = (fromMeters: number, toMeters: number): [number, number][] =>
  Array.from({ length: Math.round((toMeters - fromMeters) / 20) + 1 }, (_, i) => [10 + (fromMeters + i * 20) / 110540, 123] as [number, number])

const truckAt = (routeProgressMeters: number, point: [number, number]): DriverLocation => ({
  id: 'driver-1', driverName: 'Driver', vehiclePlate: 'ABC 123', status: 'IN_PROGRESS', markerType: 'truck',
  lat: point[0], lng: point[1], routeProgressMeters, speedMps: 0.1,
})

const meters = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 109360)

test('a replaced route does not move the icon', () => {
  // The icon stands 448 m along the road. The route is then redrawn from 400 m on -
  // the same street, measured from a new start - as a reroute or a map that redraws
  // the road at every report does. Nothing about where the vehicle is has changed.
  const routeA = road(0, 1000)
  const routeB = road(400, 1000)
  const here = pointAtRouteDistance(routeA, 448)!
  const ctx = (route: [number, number][], routeKey: string, nowMs: number): TruckMotionContext => ({ route, routeKey, predict: false, nowMs })
  let motion = snapTruckMotion(undefined, truckAt(448, here), ctx(routeA, 'A', 0))
  for (let t = FRAME_MS; t < 1000; t += FRAME_MS) motion = stepTruckMotion(motion, ctx(routeA, 'A', t))
  const before = truckMotionPose(motion).point

  motion = acceptTruckFix(motion, truckAt(48, here), ctx(routeB, 'B', 1000))
  let furthest = meters(truckMotionPose(motion).point, before)
  for (let t = 1000 + FRAME_MS; t < 4000; t += FRAME_MS) {
    motion = stepTruckMotion(motion, ctx(routeB, 'B', t))
    furthest = Math.max(furthest, meters(truckMotionPose(motion).point, before))
  }
  assert.ok(furthest < 0.5, `the icon moved ${furthest.toFixed(1)} m when only its route was redrawn`)
})

test('a road redrawn while the icon is on its way to a report does not carry it past the report', () => {
  // The report maps redraw a truck's road from each report, and the redraw can land
  // while the icon is still gliding there. It is the same journey: the icon must
  // arrive and stop on the report, not overshoot it on the momentum it had.
  const routeA = road(0, 1000)
  const report = pointAtRouteDistance(routeA, 55)!
  // Redrawn from the report onward and joined onto the road it led from, as LiveTrackingMap does.
  const routeB = joinRoadTrack(routeA, road(55, 1000).map((point, i) => (i === 0 ? report : point)))
  const ctx = (route: [number, number][], routeKey: string, nowMs: number): TruckMotionContext => ({ route, routeKey, predict: false, nowMs })
  const moving = (progress: number, point: [number, number]): DriverLocation => ({ ...truckAt(progress, point), speedMps: 11 })
  let motion = snapTruckMotion(undefined, moving(0, routeA[0]), ctx(routeA, 'A', 0))
  motion = acceptTruckFix(motion, moving(55, report), ctx(routeA, 'A', FRAME_MS))
  let furthestPast = 0
  let t = 2 * FRAME_MS
  for (; t < 800; t += FRAME_MS) motion = stepTruckMotion(motion, ctx(routeA, 'A', t))
  motion = acceptTruckFix(motion, moving(55, report), ctx(routeB, 'B', t))
  for (; t < 4000; t += FRAME_MS) {
    motion = stepTruckMotion(motion, ctx(routeB, 'B', t))
    const past = (truckMotionPose(motion).point[0] - report[0]) * 110540
    furthestPast = Math.max(furthestPast, past)
  }
  assert.ok(furthestPast < 0.5, `ran ${furthestPast.toFixed(1)} m past the report`)
  assert.ok(meters(truckMotionPose(motion).point, report) < 0.5, 'and ends on it')
})
