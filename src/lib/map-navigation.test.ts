import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bearingBetweenMapPoints,
  calculateNavigationViewportInsets,
  calculateTruckScreenRotation,
  resolveNavigationHeading,
  shortestMapAngleDelta,
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
