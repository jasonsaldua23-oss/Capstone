import test from 'node:test'
import assert from 'node:assert/strict'
import { remainingToNextStop, type RemainingStep } from './navigation-remaining.ts'

// Next stop: 300 m then 200 m then arrive (60 s + 40 s). A second stop follows.
const steps: RemainingStep[] = [
  { distance: 300, duration: 60 },
  { distance: 200, duration: 40 },
  { distance: 0, duration: 0 },
  { distance: 900, duration: 150 },
  { distance: 0, duration: 0 },
]
const nextStopStepCount = 3

test('counts only the road to the next stop, not the stops after it', () => {
  const remaining = remainingToNextStop({ steps, nextStopStepCount, alongMeters: 0, offRouteMeters: 0 })
  assert.equal(remaining.meters, 500)
  assert.equal(remaining.seconds, 100)
})

test('falls as the driver moves toward the stop, part way through a step', () => {
  const remaining = remainingToNextStop({ steps, nextStopStepCount, alongMeters: 450, offRouteMeters: 0 })
  assert.equal(remaining.meters, 50)
  assert.ok(Math.abs(remaining.seconds - 10) < 1e-9)
})

test('rises again when the driver goes back the way they came', () => {
  const ahead = remainingToNextStop({ steps, nextStopStepCount, alongMeters: 400, offRouteMeters: 0 })
  const back = remainingToNextStop({ steps, nextStopStepCount, alongMeters: 250, offRouteMeters: 0 })
  assert.ok(back.meters > ahead.meters && back.seconds > ahead.seconds)
})

test('rises as the driver moves away from the route, before any reroute', () => {
  const onRoad = remainingToNextStop({ steps, nextStopStepCount, alongMeters: 300, offRouteMeters: 8 })
  const offBy60 = remainingToNextStop({ steps, nextStopStepCount, alongMeters: 300, offRouteMeters: 60 })
  const offBy200 = remainingToNextStop({ steps, nextStopStepCount, alongMeters: 300, offRouteMeters: 200 })
  // GPS wander beside the road is not distance still to drive.
  assert.equal(onRoad.meters, 200)
  assert.ok(offBy60.meters > onRoad.meters && offBy200.meters > offBy60.meters)
  assert.ok(offBy200.seconds > offBy60.seconds)
  // No step where the road is left: the count moves continuously as the driver drifts off.
  const atTolerance = remainingToNextStop({ steps, nextStopStepCount, alongMeters: 300, offRouteMeters: 15.001 })
  assert.ok(atTolerance.meters - onRoad.meters < 0.01)
})

test('is zero at the stop and never negative past it', () => {
  const past = remainingToNextStop({ steps, nextStopStepCount, alongMeters: 700, offRouteMeters: 0 })
  assert.equal(past.meters, 0)
  assert.equal(past.seconds, 0)
})
