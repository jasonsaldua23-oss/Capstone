import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bearingBetweenMapPoints,
  calculateNavigationViewportInsets,
  calculateTruckScreenRotation,
  navigationReckoningSpeedMps,
  pointAtRouteDistance,
  predictedRouteProgressMeters,
  projectPointOntoRoute,
  quantizeRouteSplitMeters,
  resolveNavigationHeading,
  shortestMapAngleDelta,
  splitRouteAtDistance,
  NAVIGATION_DEAD_RECKONING_MAX_MS,
  NAVIGATION_DEAD_RECKONING_SPEED_FACTOR,
  NAVIGATION_ROUTE_SPLIT_QUANTIZATION_METERS,
} from './map-navigation.ts';

test('route bearings follow the four cardinal directions', () => {
  assert.equal(bearingBetweenMapPoints([10, 123], [11, 123]), 0);
  assert.equal(bearingBetweenMapPoints([10, 123], [10, 124]), 90);
  assert.equal(bearingBetweenMapPoints([10, 123], [9, 123]), 180);
  assert.equal(bearingBetweenMapPoints([10, 123], [10, 122]), 270);
});

test('camera insets center the tracked point between the measured overlays', () => {
  const insets = calculateNavigationViewportInsets(
    { top: 20, bottom: 820, left: 10, right: 410 },
    { top: 40, bottom: 180, left: 20, right: 400 },
    { top: 700, bottom: 840, left: 0, right: 420 }
  );

  assert.deepEqual(insets, { top: 160, bottom: 120, left: 0, right: 0 });
  assert.equal(insets.top + (800 - insets.top - insets.bottom) / 2, 420);
});

test('truck is upright when camera and route bearings match', () => {
  assert.equal(calculateTruckScreenRotation(42, 42), 0);
});

test('truck counter-rotates against a manually rotated camera', () => {
  assert.equal(calculateTruckScreenRotation(90, 120), -30);
  assert.equal(calculateTruckScreenRotation(120, 90), 30);
});

test('screen rotation wraps across north by the shortest angle', () => {
  assert.equal(calculateTruckScreenRotation(1, 359), 2);
  assert.equal(calculateTruckScreenRotation(359, 1), -2);
  assert.equal(shortestMapAngleDelta(359, 1), 2);
});

test('route heading takes precedence and GPS remains a safe fallback', () => {
  assert.equal(resolveNavigationHeading(90, 270), 90);
  assert.equal(resolveNavigationHeading(null, 270), 270);
  assert.equal(resolveNavigationHeading(Number.NaN, -1), null);
});

test('GPS is projected onto route geometry and measured from the route start', () => {
  const route: [number, number][] = [[10, 123], [10, 123.001], [10.001, 123.001]];
  const projected = projectPointOntoRoute([10.0005, 123.0012], route);

  assert.ok(projected);
  assert.ok(Math.abs(projected.point[0] - 10.0005) < 1e-9);
  assert.ok(Math.abs(projected.point[1] - 123.001) < 1e-9);
  assert.ok(projected.distanceAlongMeters > 100);
});

test('completed and remaining route sections meet at the exact projected point', () => {
  const route: [number, number][] = [[10, 123], [10, 123.001], [10.001, 123.001]];
  const projected = projectPointOntoRoute([10.0005, 123.0012], route);
  assert.ok(projected);

  const split = splitRouteAtDistance(route, projected.distanceAlongMeters);
  assert.deepEqual(split.completed.at(-1), projected.point);
  assert.deepEqual(split.remaining[0], projected.point);
  assert.deepEqual(pointAtRouteDistance(route, projected.distanceAlongMeters), projected.point);
});

test('completed route grows progressively while the active route starts at the vehicle', () => {
  const route: [number, number][] = [[10, 123], [10, 123.001], [10.001, 123.001]];
  const earlier = splitRouteAtDistance(route, 40);
  const later = splitRouteAtDistance(route, 120);

  assert.ok(later.completed.length >= earlier.completed.length);
  assert.deepEqual(earlier.completed.at(-1), earlier.remaining[0]);
  assert.deepEqual(later.completed.at(-1), later.remaining[0]);
  assert.notDeepEqual(later.completed.at(-1), earlier.completed.at(-1));
});

test('a crawling or absent speed reading never drives prediction', () => {
  // Below the noise floor a reported speed says nothing about real movement.
  assert.equal(navigationReckoningSpeedMps(0), 0);
  assert.equal(navigationReckoningSpeedMps(1.4), 0);
  assert.equal(navigationReckoningSpeedMps(null), 0);
  assert.equal(navigationReckoningSpeedMps(undefined), 0);
  assert.equal(navigationReckoningSpeedMps(Number.NaN), 0);
  // Above it the vehicle is advanced at a deliberately conservative fraction.
  assert.equal(navigationReckoningSpeedMps(10), 10 * NAVIGATION_DEAD_RECKONING_SPEED_FACTOR);
  assert.ok(NAVIGATION_DEAD_RECKONING_SPEED_FACTOR < 1);
});

test('without a usable speed the vehicle only interpolates toward the fix', () => {
  const frame = {
    startProgressMeters: 100,
    targetProgressMeters: 200,
    reckoningSpeedMps: 0,
    catchUpDurationMs: 1000,
    overdueMs: 0,
  };
  assert.equal(predictedRouteProgressMeters({ ...frame, easedProgress: 0 }), 100);
  assert.equal(predictedRouteProgressMeters({ ...frame, easedProgress: 0.5 }), 150);
  assert.equal(predictedRouteProgressMeters({ ...frame, easedProgress: 1 }), 200);
  // A late fix must not move a vehicle that has no speed to move it with.
  assert.equal(predictedRouteProgressMeters({ ...frame, easedProgress: 1, overdueMs: 2500 }), 200);
});

test('prediction lands the vehicle ahead of the fix it animated toward', () => {
  const frame = {
    startProgressMeters: 100,
    targetProgressMeters: 200,
    reckoningSpeedMps: 9,
    catchUpDurationMs: 1000,
    overdueMs: 0,
  };
  // Over a 1s catch-up at 9 m/s the driver covers 9m more than the fix reported,
  // which is exactly the lag this replaces.
  assert.equal(predictedRouteProgressMeters({ ...frame, easedProgress: 1 }), 209);
  // The lead is applied through the easing, not bolted on at the end, so the
  // vehicle never jumps forward as the animation completes.
  assert.equal(predictedRouteProgressMeters({ ...frame, easedProgress: 0 }), 100);
  assert.equal(predictedRouteProgressMeters({ ...frame, easedProgress: 0.5 }), 154.5);
});

test('an overdue fix keeps the vehicle coasting, but only to the budget', () => {
  const frame = {
    startProgressMeters: 100,
    targetProgressMeters: 100,
    easedProgress: 1,
    reckoningSpeedMps: 10,
    catchUpDurationMs: 0,
  };
  assert.equal(predictedRouteProgressMeters({ ...frame, overdueMs: 0 }), 100);
  assert.equal(predictedRouteProgressMeters({ ...frame, overdueMs: 1000 }), 110);
  // Past the budget a stale fix stops moving the vehicle rather than running it
  // off down the road on a position nothing has confirmed.
  const atBudget = predictedRouteProgressMeters({ ...frame, overdueMs: NAVIGATION_DEAD_RECKONING_MAX_MS });
  assert.equal(atBudget, 130);
  assert.equal(predictedRouteProgressMeters({ ...frame, overdueMs: 60_000 }), atBudget);
  // Negative clock drift must not drag it backwards either.
  assert.equal(predictedRouteProgressMeters({ ...frame, overdueMs: -500 }), 100);
});

test('a long catch-up cannot lead the vehicle past the extrapolation budget', () => {
  const frame = {
    startProgressMeters: 0,
    targetProgressMeters: 0,
    easedProgress: 1,
    reckoningSpeedMps: 10,
    overdueMs: 0,
  };
  // The 9s smoothing span a very sparse fix can produce would otherwise lead the
  // vehicle 90m ahead of anything measured.
  assert.equal(predictedRouteProgressMeters({ ...frame, catchUpDurationMs: 9000 }), 30);
  assert.equal(predictedRouteProgressMeters({ ...frame, catchUpDurationMs: 3000 }), 30);
  assert.equal(predictedRouteProgressMeters({ ...frame, catchUpDurationMs: 1000 }), 10);
});

test('the route split snaps to a fixed step so the payload stays stable', () => {
  const step = NAVIGATION_ROUTE_SPLIT_QUANTIZATION_METERS;
  // Sub-step movement, which is what most animation frames produce, resolves to
  // the same split distance and so leaves the route lines untouched.
  assert.equal(quantizeRouteSplitMeters(100), quantizeRouteSplitMeters(100.4));
  assert.equal(quantizeRouteSplitMeters(100) % step, 0);
  assert.equal(quantizeRouteSplitMeters(0), 0);
  // Real movement still moves it, and the split never drifts far from the truck.
  assert.notEqual(quantizeRouteSplitMeters(100), quantizeRouteSplitMeters(100 + step));
  for (const distance of [0, 1.1, 37.9, 512.5, 1234.6]) {
    assert.ok(Math.abs(quantizeRouteSplitMeters(distance) - distance) <= step / 2);
  }
});
