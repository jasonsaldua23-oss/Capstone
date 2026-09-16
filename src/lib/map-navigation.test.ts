import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bearingBetweenMapPoints,
  calculateNavigationViewportInsets,
  calculateTruckScreenRotation,
  pointAtRouteDistance,
  projectPointOntoRoute,
  shouldRefreshDriverRoute,
  selectFollowedRoute,
  resolveDriverRouteProgress,
  quantizeRouteSplitMeters,
  resolveNavigationHeading,
  routePoseAtDistance,
  shortestMapAngleDelta,
  splitRouteAtDistance,
  NAVIGATION_ROUTE_SPLIT_QUANTIZATION_METERS,
} from './map-navigation.ts';

test('a detour retries after a request finishes without needing a changed GPS coordinate', () => {
  const sample = { point: [10.005, 123.002] as [number, number], route: [[10, 123], [10.01, 123]] as [number, number][], elapsedMs: 13000 };
  assert.equal(shouldRefreshDriverRoute({ ...sample, inFlight: true }), false);
  assert.equal(shouldRefreshDriverRoute({ ...sample, inFlight: false }), true);
  assert.equal(shouldRefreshDriverRoute({ ...sample, inFlight: false, elapsedMs: 0 }), true);
  // Repeated failures do not permanently exhaust rerouting for this coordinate.
  for (let attempt = 1; attempt <= 6; attempt++) {
    assert.equal(shouldRefreshDriverRoute({ ...sample, inFlight: false, elapsedMs: attempt * 13000 }), true);
  }
});

test('following an alternative promotes it immediately without flapping on the shared road', () => {
  const routes: [number, number][][] = [
    [[10, 123], [10.01, 123]], [[10, 123], [10.005, 123], [10.01, 123.002]],
  ];
  assert.equal(selectFollowedRoute([10.0075, 123.001], routes, 0), 1);
  assert.equal(selectFollowedRoute([10.003, 123], routes, 0), 0);
  assert.equal(selectFollowedRoute([10.003, 123], routes, 1), 1);
  assert.equal(selectFollowedRoute([10.02, 123.01], routes, 0), 0);
});

test('missing routes recover and on-route travel does not trigger repeated requests', () => {
  const sample = { point: [10.005, 123] as [number, number], inFlight: false, elapsedMs: 6000 };
  assert.equal(shouldRefreshDriverRoute({ ...sample, route: [] }), true);
  assert.equal(shouldRefreshDriverRoute({ ...sample, route: [[10, 123], [10.01, 123]], heading: 0, speed: 10 }), false);
});

test('a moving U-turn reroutes even while GPS remains on the same road', () => {
  const sample = { point: [10.005, 123] as [number, number], route: [[10, 123], [10.01, 123]] as [number, number][], inFlight: false, elapsedMs: 6000, heading: 180 };
  assert.equal(shouldRefreshDriverRoute({ ...sample, speed: 10 }), true);
  assert.equal(shouldRefreshDriverRoute({ ...sample, speed: 0 }), false);
});

test('backtracking and real movement release the truck while small GPS jitter stays suppressed', () => {
  assert.equal(resolveDriverRouteProgress(960, 1000, false), 960);
  assert.equal(resolveDriverRouteProgress(995, 1000, false), 1000);
  assert.equal(resolveDriverRouteProgress(1040, 1000, true), 1040);
  assert.equal(resolveDriverRouteProgress(1005, 1000, true), 1000);
  assert.equal(resolveDriverRouteProgress(5, undefined, false), 5);
});

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

// Fix regression: arrival and predicted overshoot must leave only the grey route.
test('arrival never restores the completed route as an upcoming blue line', () => {
  const route: [number, number][] = [[10, 123], [10, 123.001], [10.001, 123.001]];
  const endpoint = projectPointOntoRoute(route[route.length - 1], route);
  assert.ok(endpoint);

  for (const distance of [endpoint.distanceAlongMeters, endpoint.distanceAlongMeters + 20]) {
    const split = splitRouteAtDistance(route, distance);
    assert.deepEqual(split.completed, route);
    assert.deepEqual(split.remaining, []);
  }
  assert.deepEqual(splitRouteAtDistance(route, 0).remaining, route);
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

test('a route pose gives the same point as the distance lookup plus the road bearing there', () => {
  const route: [number, number][] = [[10.7, 122.9], [10.7, 122.91], [10.71, 122.91]];
  for (const distance of [0, 500, 1100, 1500, 5000]) {
    const pose = routePoseAtDistance(route, distance);
    assert.ok(pose);
    assert.deepEqual(pose.point, pointAtRouteDistance(route, distance));
  }
  // Eastbound on the first leg, northbound on the second, and the last bearing holds past the end.
  assert.equal(Math.round(routePoseAtDistance(route, 100)!.heading!), 90);
  assert.equal(Math.round(routePoseAtDistance(route, 1500)!.heading!), 0);
  assert.equal(Math.round(routePoseAtDistance(route, 5000)!.heading!), 0);
  assert.equal(routePoseAtDistance([], 10), null);
  assert.equal(routePoseAtDistance([[1, 2]], 10)!.heading, null);
});
