import L from 'leaflet';
import type { SnappedPointOnRoute } from './types'
import { TRUCK_ROUTE_LOOKAHEAD_METERS } from './tuning'

// Keeps the latest successful road geometry available if the map remounts while
// the external routing service is temporarily unavailable.
export const roadSnappedRouteCache = new Map<string, [number, number][]>();

export function normalizeAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

export function shortestAngleDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

export function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

export function lerpAngle(from: number, to: number, t: number) {
  return normalizeAngle(from + shortestAngleDelta(from, to) * t);
}

function toLocalXY(lat: number, lng: number, refLat: number) {
  const cosRef = Math.cos((refLat * Math.PI) / 180);
  return { x: lng * cosRef, y: lat };
}

function fromLocalXY(x: number, y: number, refLat: number) {
  const cosRef = Math.cos((refLat * Math.PI) / 180) || 1;
  return { lat: y, lng: x / cosRef };
}

export function approximateDistanceMeters(a: [number, number], b: [number, number]) {
  const refLat = (a[0] + b[0]) / 2;
  const p1 = toLocalXY(a[0], a[1], refLat);
  const p2 = toLocalXY(b[0], b[1], refLat);
  const dxMeters = (p2.x - p1.x) * 111320;
  const dyMeters = (p2.y - p1.y) * 110540;
  return Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);
}

export function destinationPoint(lat: number, lng: number, bearingDeg: number, distanceMeters: number) {
  const R = 6371000;
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lng * Math.PI) / 180;
  const theta = (bearingDeg * Math.PI) / 180;
  const delta = distanceMeters / R;
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);

  const sinPhi2 = sinPhi1 * cosDelta + cosPhi1 * sinDelta * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const y = Math.sin(theta) * sinDelta * cosPhi1;
  const x = cosDelta - sinPhi1 * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  return {
    lat: (phi2 * 180) / Math.PI,
    lng: ((lambda2 * 180) / Math.PI + 540) % 360 - 180,
  };
}

function bearingBetweenPoints(from: [number, number], to: [number, number]) {
  const refLat = (from[0] + to[0]) / 2;
  const a = toLocalXY(from[0], from[1], refLat);
  const b = toLocalXY(to[0], to[1], refLat);
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return null;
  return normalizeAngle((Math.atan2(dx, dy) * 180) / Math.PI);
}

function nearestPointOnSegment(point: [number, number], start: [number, number], end: [number, number]) {
  const refLat = point[0];
  const p = toLocalXY(point[0], point[1], refLat);
  const a = toLocalXY(start[0], start[1], refLat);
  const b = toLocalXY(end[0], end[1], refLat);
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;

  if (len2 <= 1e-12) {
    return {
      point: start as [number, number],
      t: 0,
      distance2: (p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y),
      heading: 0,
    };
  }

  const tRaw = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  const t = Math.max(0, Math.min(1, tRaw));
  const projX = a.x + vx * t;
  const projY = a.y + vy * t;
  const projected = fromLocalXY(projX, projY, refLat);

  return {
    point: [projected.lat, projected.lng] as [number, number],
    t,
    distance2: (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY),
    heading: normalizeAngle((Math.atan2(vx, vy) * 180) / Math.PI),
  };
}

export function nearestPointOnPolyline(point: [number, number], polyline: [number, number][]) {
  let best: SnappedPointOnRoute | null = null;

  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    const candidate = nearestPointOnSegment(point, start, end);

    if (!best || candidate.distance2 < best.distance2) {
      best = { ...candidate, segmentIndex: index };
    }
  }

  return best;
}

function pointAtDistanceAlongRoute(
  snapped: SnappedPointOnRoute,
  polyline: [number, number][],
  distanceMeters: number
): [number, number] | null {
  if (!polyline || polyline.length < 2) return null;

  let currentPoint = snapped.point;
  let remainingDistance = Math.max(0, distanceMeters);
  let segmentIndex = snapped.segmentIndex;
  let startPoint = snapped.point;
  let endPoint = polyline[segmentIndex + 1];

  while (segmentIndex < polyline.length - 1) {
    const segmentLength = approximateDistanceMeters(startPoint, endPoint);

    if (segmentLength > 1e-6) {
      if (remainingDistance <= segmentLength) {
        const ratio = remainingDistance / segmentLength;
        return [
          lerp(startPoint[0], endPoint[0], ratio),
          lerp(startPoint[1], endPoint[1], ratio),
        ];
      }

      remainingDistance -= segmentLength;
      currentPoint = endPoint;
    }

    segmentIndex += 1;
    if (segmentIndex >= polyline.length - 1) break;
    startPoint = currentPoint;
    endPoint = polyline[segmentIndex + 1];
  }

  return polyline[polyline.length - 1] ?? null;
}

export function clampPointToBounds(point: [number, number], bounds: L.LatLngBounds | null): [number, number] {
  if (!bounds) return point;
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  return [
    Math.min(Math.max(point[0], southWest.lat), northEast.lat),
    Math.min(Math.max(point[1], southWest.lng), northEast.lng),
  ];
}

export function expandBounds(bounds: L.LatLngBounds, latPad: number, lngPad: number) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return L.latLngBounds([sw.lat - latPad, sw.lng - lngPad], [ne.lat + latPad, ne.lng + lngPad]);
}

export function calculateBearingAlongRoute(
  snapped: SnappedPointOnRoute,
  polyline: [number, number][],
  lookAheadMeters = TRUCK_ROUTE_LOOKAHEAD_METERS
): number | null {
  if (!polyline || polyline.length < 2) return null;

  const lookAheadPoint = pointAtDistanceAlongRoute(snapped, polyline, lookAheadMeters);
  if (!lookAheadPoint) return null;

  const lookAheadBearing = bearingBetweenPoints(snapped.point, lookAheadPoint);
  if (lookAheadBearing !== null) return lookAheadBearing;

  const currentSegmentEnd = polyline[Math.min(snapped.segmentIndex + 1, polyline.length - 1)];
  const fallbackBearing = currentSegmentEnd ? bearingBetweenPoints(snapped.point, currentSegmentEnd) : null;
  if (fallbackBearing !== null) return fallbackBearing;

  return Number.isFinite(snapped.heading) ? normalizeAngle(snapped.heading) : null;
}

export function dedupeConsecutivePoints(points: [number, number][]) {
  return points.filter((point, index, list) => {
    if (index === 0) return true;
    const previous = list[index - 1];
    return !(Math.abs(point[0] - previous[0]) < 0.000001 && Math.abs(point[1] - previous[1]) < 0.000001);
  });
}

export function bearingAtRouteEnd(points: [number, number][]) {
  const end = points[points.length - 1];
  for (let index = points.length - 2; index >= 0; index -= 1) {
    if (approximateDistanceMeters(points[index], end) >= 12) {
      return bearingBetweenPoints(points[index], end);
    }
  }
  return null;
}

export async function fetchRoadSnappedPoints(
  points: [number, number][],
  signal: AbortSignal,
  initialBearing?: number | null
): Promise<[number, number][]> {
  const uniquePoints = dedupeConsecutivePoints(points);
  if (uniquePoints.length < 2) return [];

  const coordinates = uniquePoints
    .map((point) => `${encodeURIComponent(String(point[1]))},${encodeURIComponent(String(point[0]))}`)
    .join(';');

  const bearings = typeof initialBearing === 'number' && Number.isFinite(initialBearing)
    ? `&bearings=${Math.round(normalizeAngle(initialBearing))},60${';'.repeat(uniquePoints.length - 1)}&continue_straight=true`
    : '';
  const requestRoute = async (bearingQuery: string) => {
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false${bearingQuery}`,
      { signal }
    );
    const payload = await response.json().catch(() => ({}));
    const rawCoordinates = payload?.routes?.[0]?.geometry?.coordinates;
    return response.ok && Array.isArray(rawCoordinates) && rawCoordinates.length > 1
      ? rawCoordinates
      : null;
  };

  let rawCoordinates = await requestRoute(bearings);
  if (!rawCoordinates && bearings) {
    // Fix: retry without the heading constraint so the road path remains available near junctions.
    rawCoordinates = await requestRoute('');
  }
  if (!rawCoordinates) return [];

  const snappedPoints = rawCoordinates
    .map((pair: any) => [Number(pair?.[1]), Number(pair?.[0])] as [number, number])
    .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));

  return snappedPoints.length > 1 ? snappedPoints : [];
}
