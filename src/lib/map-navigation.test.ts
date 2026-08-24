import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bearingBetweenMapPoints,
  calculateNavigationViewportInsets,
  calculateTruckScreenRotation,
  pointAtRouteDistance,
  projectPointOntoRoute,
  resolveNavigationHeading,
  shortestMapAngleDelta,
  splitRouteAtDistance,
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
