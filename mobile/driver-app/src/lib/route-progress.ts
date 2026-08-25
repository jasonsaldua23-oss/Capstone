export type RouteCoordinate = [number, number];

export type RouteProjection = {
  coordinate: RouteCoordinate;
  segmentIndex: number;
  segmentFraction: number;
  alongRouteMeters: number;
  distanceFromRouteMeters: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function coordinateDistanceMeters(from: RouteCoordinate, to: RouteCoordinate): number {
  const latitude1 = toRadians(from[1]);
  const latitude2 = toRadians(to[1]);
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = toRadians(to[0] - from[0]);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function routeLengthMeters(coordinates: RouteCoordinate[]): number {
  let total = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    total += coordinateDistanceMeters(coordinates[index], coordinates[index + 1]);
  }
  return total;
}

export function bearingDegrees(from: RouteCoordinate, to: RouteCoordinate): number {
  const latitude1 = toRadians(from[1]);
  const latitude2 = toRadians(to[1]);
  const deltaLongitude = toRadians(to[0] - from[0]);
  const y = Math.sin(deltaLongitude) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2)
    - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(deltaLongitude);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function shortestHeadingDelta(from: number, to: number): number {
  // A normalized delta prevents a 350 -> 10 degree turn from spinning 340 degrees.
  return ((to - from + 540) % 360) - 180;
}

export function interpolateHeading(from: number, to: number, progress: number): number {
  return (from + shortestHeadingDelta(from, to) * progress + 360) % 360;
}

export function interpolateCoordinate(from: RouteCoordinate, to: RouteCoordinate, progress: number): RouteCoordinate {
  return [
    from[0] + (to[0] - from[0]) * progress,
    from[1] + (to[1] - from[1]) * progress,
  ];
}

export function projectCoordinateOnRoute(
  coordinate: RouteCoordinate,
  route: RouteCoordinate[],
  minimumAlongRouteMeters = 0,
  maximumAlongRouteMeters = Number.POSITIVE_INFINITY,
): RouteProjection | null {
  if (route.length < 2) return null;

  let best: RouteProjection | null = null;
  let traversedMeters = 0;
  const latitudeScale = Math.cos(toRadians(coordinate[1]));

  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const segmentMeters = coordinateDistanceMeters(start, end);
    if (segmentMeters <= 0.01) continue;

    // Project in a local equirectangular plane, which is stable for short road segments.
    const segmentX = toRadians(end[0] - start[0]) * EARTH_RADIUS_METERS * latitudeScale;
    const segmentY = toRadians(end[1] - start[1]) * EARTH_RADIUS_METERS;
    const pointX = toRadians(coordinate[0] - start[0]) * EARTH_RADIUS_METERS * latitudeScale;
    const pointY = toRadians(coordinate[1] - start[1]) * EARTH_RADIUS_METERS;
    const denominator = segmentX ** 2 + segmentY ** 2;
    const fraction = Math.max(0, Math.min(1, denominator > 0 ? (pointX * segmentX + pointY * segmentY) / denominator : 0));
    const alongRouteMeters = traversedMeters + segmentMeters * fraction;

    // GPS noise is not allowed to move route progress backward or unrealistically far forward.
    if (alongRouteMeters + 0.5 < minimumAlongRouteMeters || alongRouteMeters - 0.5 > maximumAlongRouteMeters) {
      traversedMeters += segmentMeters;
      continue;
    }

    const projected: RouteCoordinate = [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ];
    const distanceFromRouteMeters = coordinateDistanceMeters(coordinate, projected);
    if (!best || distanceFromRouteMeters < best.distanceFromRouteMeters) {
      best = { coordinate: projected, segmentIndex: index, segmentFraction: fraction, alongRouteMeters, distanceFromRouteMeters };
    }
    traversedMeters += segmentMeters;
  }

  return best;
}

export function projectionAtRouteDistance(route: RouteCoordinate[], requestedMeters: number): RouteProjection | null {
  if (route.length < 2) return null;
  const targetMeters = Math.max(0, Math.min(routeLengthMeters(route), requestedMeters));
  let traversedMeters = 0;

  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const segmentMeters = coordinateDistanceMeters(start, end);
    if (index === route.length - 2 || traversedMeters + segmentMeters >= targetMeters) {
      const fraction = segmentMeters > 0 ? Math.max(0, Math.min(1, (targetMeters - traversedMeters) / segmentMeters)) : 0;
      return {
        coordinate: interpolateCoordinate(start, end, fraction),
        segmentIndex: index,
        segmentFraction: fraction,
        alongRouteMeters: targetMeters,
        distanceFromRouteMeters: 0,
      };
    }
    traversedMeters += segmentMeters;
  }
  return null;
}

export function splitRouteAtDistance(route: RouteCoordinate[], alongRouteMeters: number): {
  completed: RouteCoordinate[];
  remaining: RouteCoordinate[];
} {
  const projection = projectionAtRouteDistance(route, alongRouteMeters);
  if (!projection) return { completed: [], remaining: route };
  return {
    // The shared projected coordinate makes the gray and active lines meet with no visual gap.
    completed: [...route.slice(0, projection.segmentIndex + 1), projection.coordinate],
    remaining: [projection.coordinate, ...route.slice(projection.segmentIndex + 1)],
  };
}

export function routeBearingAtProjection(route: RouteCoordinate[], projection: RouteProjection): number {
  const start = route[projection.segmentIndex];
  const end = route[Math.min(route.length - 1, projection.segmentIndex + 1)];
  return start && end ? bearingDegrees(start, end) : 0;
}

export function movementAnimationDurationMs(previousTimestamp: number | null, nextTimestamp: number | null): number {
  if (previousTimestamp && nextTimestamp && nextTimestamp > previousTimestamp) {
    // Finish just before the next expected GPS sample so movement appears continuous between updates.
    return Math.max(650, Math.min(4_800, (nextTimestamp - previousTimestamp) * 0.92));
  }
  return 1_200;
}
