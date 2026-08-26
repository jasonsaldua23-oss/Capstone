export function normalizeMapAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

export function shortestMapAngleDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

export function bearingBetweenMapPoints(from: [number, number], to: [number, number]) {
  const refLat = (from[0] + to[0]) / 2;
  const dx = (to[1] - from[1]) * Math.cos((refLat * Math.PI) / 180);
  const dy = to[0] - from[0];
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return null;
  return normalizeMapAngle((Math.atan2(dx, dy) * 180) / Math.PI);
}

export type ProjectedRoutePosition = {
  point: [number, number];
  segmentIndex: number;
  segmentProgress: number;
  distanceAlongMeters: number;
  distanceFromRouteMeters: number;
};

function approximateMapDistanceMeters(from: [number, number], to: [number, number]) {
  const refLat = (from[0] + to[0]) / 2;
  const dx = (to[1] - from[1]) * Math.cos((refLat * Math.PI) / 180) * 111320;
  const dy = (to[0] - from[0]) * 110540;
  return Math.hypot(dx, dy);
}

// Projects GPS onto the existing road polyline and records distance from its
// start, allowing movement and completed-route progress to share one position.
export function projectPointOntoRoute(
  point: [number, number],
  route: [number, number][]
): ProjectedRoutePosition | null {
  if (route.length < 2) return null;

  const refLat = point[0];
  const longitudeScale = Math.cos((refLat * Math.PI) / 180) || 1;
  const targetX = point[1] * longitudeScale;
  const targetY = point[0];
  let distanceBeforeSegment = 0;
  let best: ProjectedRoutePosition | null = null;

  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const startX = start[1] * longitudeScale;
    const startY = start[0];
    const endX = end[1] * longitudeScale;
    const endY = end[0];
    const dx = endX - startX;
    const dy = endY - startY;
    const length2 = dx * dx + dy * dy;
    const segmentLength = approximateMapDistanceMeters(start, end);

    if (length2 > 1e-16) {
      const rawProgress = ((targetX - startX) * dx + (targetY - startY) * dy) / length2;
      const segmentProgress = Math.max(0, Math.min(1, rawProgress));
      const projectedPoint: [number, number] = [
        start[0] + (end[0] - start[0]) * segmentProgress,
        start[1] + (end[1] - start[1]) * segmentProgress,
      ];
      const distanceFromRouteMeters = approximateMapDistanceMeters(point, projectedPoint);
      if (!best || distanceFromRouteMeters < best.distanceFromRouteMeters) {
        best = {
          point: projectedPoint,
          segmentIndex: index,
          segmentProgress,
          distanceAlongMeters: distanceBeforeSegment + segmentLength * segmentProgress,
          distanceFromRouteMeters,
        };
      }
    }

    distanceBeforeSegment += segmentLength;
  }

  return best;
}

// Returns the exact point on route geometry for an accumulated route distance.
export function pointAtRouteDistance(route: [number, number][], distanceMeters: number): [number, number] | null {
  if (route.length === 0) return null;
  if (route.length === 1) return route[0];

  let remaining = Math.max(0, distanceMeters);
  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const segmentLength = approximateMapDistanceMeters(start, end);
    if (remaining <= segmentLength || index === route.length - 2) {
      const progress = segmentLength > 0 ? Math.max(0, Math.min(1, remaining / segmentLength)) : 0;
      return [
        start[0] + (end[0] - start[0]) * progress,
        start[1] + (end[1] - start[1]) * progress,
      ];
    }
    remaining -= segmentLength;
  }

  return route[route.length - 1];
}

// Splits one routed polyline at an exact distance so the gray and active lines
// meet at the truck without drawing straight GPS-to-GPS shortcuts.
export function splitRouteAtDistance(route: [number, number][], distanceMeters: number) {
  if (!Array.isArray(route) || route.length < 2) {
    return { completed: [] as [number, number][], remaining: route || [] };
  }

  const projected = pointAtRouteDistance(route, distanceMeters);
  if (!projected) {
    return { completed: route, remaining: [] as [number, number][] };
  }

  let remainingDistance = Math.max(0, distanceMeters);
  let splitIndex = 0;
  for (; splitIndex < route.length - 1; splitIndex += 1) {
    const segmentLength = approximateMapDistanceMeters(route[splitIndex], route[splitIndex + 1]);
    if (remainingDistance <= segmentLength) break;
    remainingDistance -= segmentLength;
  }

  const rawCompleted: [number, number][] = [...route.slice(0, splitIndex + 1), projected];
  const rawRemaining: [number, number][] = [projected, ...route.slice(splitIndex + 1)];

  const dedupe = (points: [number, number][]) =>
    points.filter((point, index, list) => {
      if (index === 0) return true;
      const prev = list[index - 1];
      return !(Math.abs(point[0] - prev[0]) < 1e-7 && Math.abs(point[1] - prev[1]) < 1e-7);
    });

  const completed = dedupe(rawCompleted);
  const remaining = dedupe(rawRemaining);

  return {
    completed: completed.length >= 2 ? completed : [],
    remaining: remaining.length >= 2 ? remaining : route,
  };
}

export function resolveNavigationHeading(routeHeading: number | null | undefined, gpsHeading: number | null | undefined) {
  if (typeof routeHeading === 'number' && Number.isFinite(routeHeading)) return normalizeMapAngle(routeHeading);
  if (typeof gpsHeading === 'number' && Number.isFinite(gpsHeading) && gpsHeading >= 0) return normalizeMapAngle(gpsHeading);
  return null;
}

export function calculateTruckScreenRotation(routeHeading: number, cameraBearing: number, assetForwardHeading = 0) {
  return shortestMapAngleDelta(0, normalizeMapAngle(routeHeading - cameraBearing - assetForwardHeading));
}

export type NavigationViewportInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

type VerticalRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export function calculateNavigationViewportInsets(
  mapRect: VerticalRect,
  topOverlayRect?: VerticalRect | null,
  bottomOverlayRect?: VerticalRect | null
): NavigationViewportInsets {
  const height = Math.max(0, mapRect.bottom - mapRect.top);
  const top = topOverlayRect
    ? Math.max(0, Math.min(height, topOverlayRect.bottom - mapRect.top))
    : 0;
  const bottom = bottomOverlayRect
    ? Math.max(0, Math.min(height, mapRect.bottom - bottomOverlayRect.top))
    : 0;

  // Keep a usable camera viewport even while the drawer is nearly full-screen.
  // MapLibre centers the tracked coordinate in the area left by these insets.
  if (top + bottom >= height) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  // Equal horizontal insets keep the coordinate at the map's true width center.
  return { top, bottom, left: 0, right: 0 };
}
