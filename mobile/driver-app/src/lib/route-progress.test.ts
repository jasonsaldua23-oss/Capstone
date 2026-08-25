import assert from "node:assert/strict";
import test from "node:test";

import {
  bearingDegrees,
  interpolateHeading,
  projectCoordinateOnRoute,
  shortestHeadingDelta,
  splitRouteAtDistance,
} from "./route-progress.ts";

const straightRoute: [number, number][] = [
  [122.97, 10.80],
  [122.98, 10.80],
  [122.99, 10.80],
];

test("route projection snaps a GPS point onto road geometry", () => {
  const projection = projectCoordinateOnRoute([122.985, 10.801], straightRoute);
  assert.ok(projection);
  assert.ok(Math.abs(projection.coordinate[1] - 10.80) < 0.000001);
  assert.equal(projection.segmentIndex, 1);
});

test("route projection respects monotonic progress bounds", () => {
  const forward = projectCoordinateOnRoute([122.985, 10.80], straightRoute);
  assert.ok(forward);
  const noisyBackward = projectCoordinateOnRoute([122.975, 10.80], straightRoute, forward.alongRouteMeters);
  assert.equal(noisyBackward, null);
});

test("completed and remaining routes meet at the same projected point", () => {
  const split = splitRouteAtDistance(straightRoute, 1_600);
  assert.ok(split.completed.length >= 2);
  assert.ok(split.remaining.length >= 2);
  assert.deepEqual(split.completed.at(-1), split.remaining[0]);
});

test("heading interpolation takes the shortest turn across north", () => {
  assert.equal(shortestHeadingDelta(350, 10), 20);
  assert.equal(shortestHeadingDelta(10, 350), -20);
  assert.equal(interpolateHeading(350, 10, 0.5), 0);
});

test("bearing follows the direction of travel", () => {
  assert.ok(Math.abs(bearingDegrees([122.97, 10.80], [122.97, 10.81])) < 0.01);
  assert.ok(Math.abs(bearingDegrees([122.97, 10.80], [122.98, 10.80]) - 90) < 0.1);
});
