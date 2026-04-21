"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const MapContainerUnsafe = MapContainer as any;
const TileLayerUnsafe = TileLayer as any;
const MarkerUnsafe = Marker as any;
const PolylineUnsafe = Polyline as any;
const CircleMarkerUnsafe = CircleMarker as any;
const TooltipUnsafe = Tooltip as any;

// Fix for default marker icons in Next.js + Leaflet
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export type DriverLocation = {
  id: string;
  driverName: string;
  vehiclePlate: string;
  lat: number;
  lng: number;
  status: string;
  markerColor?: string;
  markerLabel?: string;
  markerDirection?: 'left' | 'right';
  markerHeading?: number;
  markerType?: 'pin' | 'dot' | 'truck' | 'default';
  markerNumber?: number | string;
  markerEta?: string;
  markerEtaPhase?: 'completed' | 'next' | 'upcoming';
};

export type LiveRouteLine = {
  id: string;
  points: [number, number][];
  color: string;
  label?: string;
  opacity?: number;
  weight?: number;
  dashArray?: string;
  snapToRoad?: boolean;
};

interface LiveTrackingMapProps {
  locations: DriverLocation[];
  center?: [number, number];
  zoom?: number;
  routeLines?: LiveRouteLine[];
  restrictToNegrosOccidental?: boolean;
  navigationPerspective?: boolean;
  className?: string;
}

type SnappedPointOnRoute = {
  point: [number, number];
  t: number;
  distance2: number;
  heading: number;
  segmentIndex: number;
};

const NEGROS_OCCIDENTAL_BOUNDS = L.latLngBounds([9.18, 122.22], [11.05, 123.35]);

const truckIconCache = new Map<string, L.DivIcon>();
const statusPinIconCache = new Map<'green' | 'blue', L.Icon>();
type TruckIconDirection = 'left' | 'right';
const TRUCK_ICON_URL = '/icons/driver-location-cropped.png';
// This icon's nose points upper-right (~northeast, 45deg) at 0deg image rotation.
const TRUCK_ICON_BASE_HEADING = 45;
const TRUCK_ROTATION_QUANTIZATION_DEG = 1;
const NAV_CAMERA_LOOKAHEAD_METERS = 95;
const NAV_CAMERA_ANIMATION_SECONDS = 0.35;
const TRUCK_SMOOTHING_DURATION_MS = 300;
const TRUCK_ROUTE_LOOKAHEAD_METERS = 20;
const TRUCK_LOCAL_TANGENT_LOOKAHEAD_METERS = 8;

function getStatusPinIcon(color: 'green' | 'blue') {
  const cached = statusPinIconCache.get(color);
  if (cached) return cached;

  const icon = L.icon({
    iconUrl:
      color === 'green'
        ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png'
        : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
    iconRetinaUrl:
      color === 'green'
        ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png'
        : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });

  statusPinIconCache.set(color, icon);
  return icon;
}

function normalizeAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

function shortestAngleDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

function lerpAngle(from: number, to: number, t: number) {
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

function approximateDistanceMeters(a: [number, number], b: [number, number]) {
  const refLat = (a[0] + b[0]) / 2;
  const p1 = toLocalXY(a[0], a[1], refLat);
  const p2 = toLocalXY(b[0], b[1], refLat);
  const dxMeters = (p2.x - p1.x) * 111320;
  const dyMeters = (p2.y - p1.y) * 110540;
  return Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);
}

function destinationPoint(lat: number, lng: number, bearingDeg: number, distanceMeters: number) {
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

function nearestPointOnPolyline(point: [number, number], polyline: [number, number][]) {
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

function calculateBearingAlongRoute(
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

function dedupeConsecutivePoints(points: [number, number][]) {
  return points.filter((point, index, list) => {
    if (index === 0) return true;
    const previous = list[index - 1];
    return !(Math.abs(point[0] - previous[0]) < 0.000001 && Math.abs(point[1] - previous[1]) < 0.000001);
  });
}

async function fetchRoadSnappedPoints(points: [number, number][], signal: AbortSignal): Promise<[number, number][]> {
  const uniquePoints = dedupeConsecutivePoints(points);
  if (uniquePoints.length < 2) return [];

  const coordinates = uniquePoints
    .map((point) => `${encodeURIComponent(String(point[1]))},${encodeURIComponent(String(point[0]))}`)
    .join(';');

  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
    { signal }
  );
  const payload = await response.json().catch(() => ({}));
  const rawCoordinates = payload?.routes?.[0]?.geometry?.coordinates;
  if (!response.ok || !Array.isArray(rawCoordinates) || rawCoordinates.length < 2) return [];

  const snappedPoints = rawCoordinates
    .map((pair: any) => [Number(pair?.[1]), Number(pair?.[0])] as [number, number])
    .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));

  return snappedPoints.length > 1 ? snappedPoints : [];
}

function MapBoundsGuard({ enabled }: { enabled: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;
    map.setMaxBounds(NEGROS_OCCIDENTAL_BOUNDS);
    map.fitBounds(NEGROS_OCCIDENTAL_BOUNDS, { padding: [10, 10] });
  }, [enabled, map]);

  return null;
}

function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();
  useEffect(() => {
    onZoomChange(map.getZoom());
    const onZoom = () => onZoomChange(map.getZoom());
    map.on('zoom', onZoom);
    return () => {
      map.off('zoom', onZoom);
    };
  }, [map, onZoomChange]);
  return null;
}

function NavigationCamera({
  enabled,
  truckPosition,
  truckHeading,
}: {
  enabled: boolean;
  truckPosition: [number, number] | null;
  truckHeading: number | null;
}) {
  const map = useMap();
  const lastViewRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!enabled || !truckPosition) return;
    const heading = truckHeading ?? 0;
    const lookAhead = destinationPoint(truckPosition[0], truckPosition[1], heading, NAV_CAMERA_LOOKAHEAD_METERS);
    const previous = lastViewRef.current;
    if (previous) {
      const latDiff = Math.abs(previous.lat - lookAhead.lat);
      const lngDiff = Math.abs(previous.lng - lookAhead.lng);
      if (latDiff < 0.00001 && lngDiff < 0.00001) {
        return;
      }
    }
    lastViewRef.current = { lat: lookAhead.lat, lng: lookAhead.lng };
    map.setView([lookAhead.lat, lookAhead.lng], map.getZoom(), { animate: false } as any);
  }, [enabled, map, truckHeading, truckPosition]);

  return null;
}

function getTruckIcon(options: { direction?: TruckIconDirection; heading?: number } = {}) {
  const direction = options.direction || 'right';
  const heading = typeof options.heading === 'number' && Number.isFinite(options.heading) ? options.heading : null;
  const quantizedHeading =
    heading === null
      ? null
      : Math.round(heading / TRUCK_ROTATION_QUANTIZATION_DEG) * TRUCK_ROTATION_QUANTIZATION_DEG;

  // Rotate around center so heading matches road tangent consistently.
  const iconAnchor: [number, number] = [29, 29];
  const popupAnchor: [number, number] = [0, -29];
  const rotation =
    quantizedHeading !== null
      ? normalizeAngle(quantizedHeading - TRUCK_ICON_BASE_HEADING)
      : direction === 'left'
        ? 180
        : 0;
  const cacheKey = `${direction}:${rotation.toFixed(1)}`;
  const cached = truckIconCache.get(cacheKey);
  if (cached) return cached;

  const icon = L.divIcon({
    className: 'custom-truck-marker',
    html: `<div style="width:58px;height:58px;display:flex;align-items:center;justify-content:center;overflow:visible;transform:rotate(${rotation}deg);transform-origin:29px 29px;will-change:transform;">
      <img src="${TRUCK_ICON_URL}" alt="truck" style="width:58px;height:58px;display:block;image-rendering:auto;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.35)) drop-shadow(0 4px 6px rgba(0,0,0,0.4)) contrast(1.08) saturate(1.08);" onerror="this.onerror=null;this.src='/icons/delivery-truck.png';" />
    </div>`,
    iconSize: [58, 58],
    iconAnchor,
    popupAnchor,
  });
  truckIconCache.set(cacheKey, icon);
  return icon;
}

export default function LiveTrackingMap({
  locations,
  center = [39.8283, -98.5795],
  zoom = 4,
  routeLines = [],
  restrictToNegrosOccidental = false,
  navigationPerspective = false,
  className = "w-full h-[350px] rounded-xl overflow-hidden border shadow-sm",
}: LiveTrackingMapProps) {
  const safeLocations = useMemo(
    () =>
      (locations || []).filter(
        (loc): loc is DriverLocation =>
          loc !== null &&
          loc !== undefined &&
          Number.isFinite(Number(loc.lat)) &&
          Number.isFinite(Number(loc.lng))
      ),
    [locations]
  );

  const safeRouteLines = useMemo(
    () =>
      (routeLines || [])
        .map((line) => ({
          ...line,
          points: (line.points || []).filter(
            (point): point is [number, number] =>
              Array.isArray(point) &&
              point.length === 2 &&
              Number.isFinite(Number(point[0])) &&
              Number.isFinite(Number(point[1]))
          ),
        }))
        .filter((line) => line.points.length > 1),
    [routeLines]
  );

  const [smoothedLocations, setSmoothedLocations] = useState<DriverLocation[]>(safeLocations);
  const [snappedRoutePointsById, setSnappedRoutePointsById] = useState<Record<string, [number, number][]>>({});
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const animationFrameRef = useRef<number | null>(null);

  const roadSnapSignature = useMemo(
    () =>
      safeRouteLines
        .filter((line) => line.snapToRoad)
        .map(
          (line) =>
            `${line.id}:${line.points.map((point) => `${point[0].toFixed(6)},${point[1].toFixed(6)}`).join('|')}`
        )
        .join('||'),
    [safeRouteLines]
  );

  useEffect(() => {
    const linesNeedingRoadSnap = safeRouteLines.filter((line) => line.snapToRoad && line.points.length > 1);
    if (linesNeedingRoadSnap.length === 0) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      const nextSnappedLines: Record<string, [number, number][]> = {};
      for (const line of linesNeedingRoadSnap) {
        try {
          const snappedPoints = await fetchRoadSnappedPoints(line.points, controller.signal);
          if (snappedPoints.length > 1) {
            nextSnappedLines[line.id] = snappedPoints;
          }
        } catch {
          // Fallback to original route if road snap fails.
        }
        if (cancelled) return;
      }

      setSnappedRoutePointsById(nextSnappedLines);
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roadSnapSignature, safeRouteLines]);

  const renderedRouteLines = useMemo(
    () =>
      safeRouteLines.map((line) => {
        const snappedPoints = snappedRoutePointsById[line.id];
        if (!line.snapToRoad || !snappedPoints || snappedPoints.length < 2) return line;
        return { ...line, points: snappedPoints };
      }),
    [safeRouteLines, snappedRoutePointsById]
  );

  useEffect(() => {
    L.Marker.prototype.options.icon = DefaultIcon;
  }, []);

  const snappedLocations = useMemo(() => {
    const routePolylines = renderedRouteLines
      .map((line) => ({
        points: line.points,
        priority: line.color === '#2563eb' && !line.dashArray ? 0 : 1,
      }))
      .filter(
        (line): line is { points: [number, number][]; priority: number } =>
          Array.isArray(line.points) && line.points.length > 1
      )
      .sort((a, b) => a.priority - b.priority);
    const preferredPolylines = routePolylines.filter((line) => line.priority === 0);
    const snapTargetPolylines = preferredPolylines.length > 0 ? preferredPolylines : routePolylines;

    return safeLocations.map((loc) => {
      if (loc.markerType !== 'truck' || snapTargetPolylines.length === 0) return loc;

      let bestSnap: SnappedPointOnRoute | null = null;
      let bestPolyline: [number, number][] | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      const expectedHeading =
        typeof loc.markerHeading === 'number' && Number.isFinite(loc.markerHeading)
          ? normalizeAngle(loc.markerHeading)
          : null;

      for (const polyline of snapTargetPolylines) {
        const candidate = nearestPointOnPolyline([loc.lat, loc.lng], polyline.points);
        if (!candidate) continue;

        const distanceMeters = approximateDistanceMeters([loc.lat, loc.lng], candidate.point);
        const candidateForwardHeading =
          calculateBearingAlongRoute(candidate, polyline.points, TRUCK_LOCAL_TANGENT_LOOKAHEAD_METERS) ??
          (Number.isFinite(candidate.heading) ? normalizeAngle(candidate.heading) : null);
        const headingPenaltyMeters =
          expectedHeading !== null && typeof candidateForwardHeading === 'number'
            ? Math.min(
                Math.abs(shortestAngleDelta(expectedHeading, candidateForwardHeading)),
                Math.abs(shortestAngleDelta(expectedHeading, normalizeAngle(candidateForwardHeading + 180)))
              ) * 0.2
            : 0;
        const score = distanceMeters + headingPenaltyMeters;

        if (score < bestScore) {
          bestScore = score;
          bestSnap = candidate;
          bestPolyline = polyline.points;
        }
      }

      if (!bestSnap || !bestPolyline) {
        return loc;
      }

      // Prefer a short local lookahead so orientation follows each turn on the active route.
      const localForwardHeading = calculateBearingAlongRoute(
        bestSnap,
        bestPolyline,
        TRUCK_LOCAL_TANGENT_LOOKAHEAD_METERS
      );
      const segmentHeading =
        typeof bestSnap.heading === 'number' && Number.isFinite(bestSnap.heading)
          ? normalizeAngle(bestSnap.heading)
          : null;
      const routeHeading = calculateBearingAlongRoute(bestSnap, bestPolyline, TRUCK_ROUTE_LOOKAHEAD_METERS);
      const headingCandidate =
        typeof localForwardHeading === 'number' && Number.isFinite(localForwardHeading)
          ? normalizeAngle(localForwardHeading)
          : typeof routeHeading === 'number' && Number.isFinite(routeHeading)
            ? normalizeAngle(routeHeading)
            : typeof segmentHeading === 'number'
              ? segmentHeading
              : typeof loc.markerHeading === 'number' && Number.isFinite(loc.markerHeading)
                ? normalizeAngle(loc.markerHeading)
                : undefined;
      const snappedHeading = currentZoom < 14
        ? (typeof loc.markerHeading === 'number' && Number.isFinite(loc.markerHeading) ? normalizeAngle(loc.markerHeading) : headingCandidate)
        : headingCandidate;

      return {
        ...loc,
        lat: bestSnap.point[0],
        lng: bestSnap.point[1],
        markerHeading: snappedHeading,
      };
    });
  }, [safeLocations, renderedRouteLines, currentZoom]);

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    setSmoothedLocations((previousLocations) => {
      const previousById = new Map(previousLocations.map((loc) => [loc.id, loc]));
      const hasAnimatedTruck = snappedLocations.some((loc) => {
        if (loc.markerType !== 'truck') return false;
        const previous = previousById.get(loc.id);
        return (
          previous &&
          (Math.abs(previous.lat - loc.lat) > 1e-9 ||
            Math.abs(previous.lng - loc.lng) > 1e-9 ||
            Math.abs(
              shortestAngleDelta(previous.markerHeading ?? loc.markerHeading ?? 0, loc.markerHeading ?? previous.markerHeading ?? 0)
            ) > 1e-6)
        );
      });

      if (!hasAnimatedTruck) {
        return snappedLocations;
      }

      const startTime = performance.now();

      const animate = (now: number) => {
        const progress = Math.min(1, (now - startTime) / TRUCK_SMOOTHING_DURATION_MS);

        setSmoothedLocations(() =>
          snappedLocations.map((targetLoc) => {
            if (targetLoc.markerType !== 'truck') {
              return targetLoc;
            }

            const previous = previousById.get(targetLoc.id);
            if (!previous) {
              return targetLoc;
            }

            const startHeading =
              typeof previous.markerHeading === 'number' && Number.isFinite(previous.markerHeading)
                ? previous.markerHeading
                : typeof targetLoc.markerHeading === 'number' && Number.isFinite(targetLoc.markerHeading)
                  ? targetLoc.markerHeading
                  : undefined;
            const endHeading =
              typeof targetLoc.markerHeading === 'number' && Number.isFinite(targetLoc.markerHeading)
                ? targetLoc.markerHeading
                : startHeading;

            return {
              ...targetLoc,
              lat: lerp(previous.lat, targetLoc.lat, progress),
              lng: lerp(previous.lng, targetLoc.lng, progress),
              markerHeading:
                typeof startHeading === 'number' && typeof endHeading === 'number'
                  ? lerpAngle(startHeading, endHeading, progress)
                  : endHeading,
            };
          })
        );

        if (progress < 1) {
          animationFrameRef.current = window.requestAnimationFrame(animate);
        } else {
          animationFrameRef.current = null;
        }
      };

      animationFrameRef.current = window.requestAnimationFrame(animate);
      return previousLocations;
    });

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [snappedLocations]);

  const singleTruck = smoothedLocations.filter((loc) => loc.markerType === 'truck');
  const navTruck = navigationPerspective && singleTruck.length === 1 ? singleTruck[0] : null;

  return (
    <div className={className}>
      <MapContainerUnsafe
        center={center}
        zoom={zoom}
        scrollWheelZoom={true}
        className="w-full h-full z-0"
        zoomAnimation={false}
        markerZoomAnimation={false}
        minZoom={restrictToNegrosOccidental ? 9 : undefined}
        maxBounds={restrictToNegrosOccidental ? NEGROS_OCCIDENTAL_BOUNDS : undefined}
        maxBoundsViscosity={restrictToNegrosOccidental ? 1.0 : undefined}
      >
        <ZoomTracker onZoomChange={setCurrentZoom} />
        <MapBoundsGuard enabled={restrictToNegrosOccidental} />
        <NavigationCamera
          enabled={Boolean(navTruck)}
          truckPosition={navTruck ? [navTruck.lat, navTruck.lng] : null}
          truckHeading={
            navTruck && typeof navTruck.markerHeading === 'number' && Number.isFinite(navTruck.markerHeading)
              ? navTruck.markerHeading
              : null
          }
        />
        <TileLayerUnsafe
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {renderedRouteLines.map((line) =>
          Array.isArray(line.points) && line.points.length > 1 ? (
            <Fragment key={line.id}>
              <PolylineUnsafe
                key={`${line.id}-base`}
                positions={line.points}
                pathOptions={{
                  color: line.color || '#2563eb',
                  weight: typeof line.weight === 'number' ? line.weight : (line.color === '#2563eb' ? 8 : 4),
                  opacity: typeof line.opacity === 'number' ? line.opacity : (line.color === '#2563eb' ? 1 : 0.6),
                  dashArray: line.dashArray,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              >
                {line.label ? <Popup>{line.label}</Popup> : null}
              </PolylineUnsafe>
              {line.color === '#2563eb' && !line.dashArray ? (
                <PolylineUnsafe
                  key={`${line.id}-center`}
                  positions={line.points}
                  pathOptions={{
                    color: '#ffffff',
                    weight: 3,
                    opacity: 0.8,
                    dashArray: '4 3',
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              ) : null}
            </Fragment>
          ) : null
        )}

        {smoothedLocations.map((loc) =>
          loc.markerType === 'truck' ? (
            <MarkerUnsafe
              key={loc.id}
              position={[loc.lat, loc.lng]}
              icon={getTruckIcon({ direction: loc.markerDirection || 'right', heading: loc.markerHeading })}
              zIndexOffset={1000}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-base mb-1">{loc.driverName}</p>
                  <p className="text-gray-600">{loc.markerLabel || `Vehicle: ${loc.vehiclePlate}`}</p>
                  <p className="text-gray-600">
                    Status: <span className="capitalize">{loc.status.toLowerCase()}</span>
                  </p>
                </div>
              </Popup>
            </MarkerUnsafe>
          ) : loc.markerType === 'pin' ? (
            (() => {
              const pinColor: 'green' | 'blue' =
                loc.markerEtaPhase === 'completed' ||
                String(loc.status || '').toUpperCase() === 'COMPLETED' ||
                String(loc.status || '').toUpperCase() === 'DELIVERED'
                  ? 'blue'
                  : 'green';
              return (
            <MarkerUnsafe
              key={loc.id}
              position={[loc.lat, loc.lng]}
              icon={getStatusPinIcon(pinColor)}
            >
              {loc.markerEta ? (
                <TooltipUnsafe
                  permanent
                  direction="top"
                  offset={[0, -34]}
                  opacity={1}
                  interactive={false}
                  className={`map-eta-tooltip map-eta-${loc.markerEtaPhase || 'upcoming'}`}
                >
                  {loc.markerEta}
                </TooltipUnsafe>
              ) : null}
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-base mb-1">{loc.driverName}</p>
                  <p className="text-gray-600">{loc.markerLabel || `Vehicle: ${loc.vehiclePlate}`}</p>
                  <p className="text-gray-600">
                    Status: <span className="capitalize">{loc.status.toLowerCase()}</span>
                  </p>
                </div>
              </Popup>
            </MarkerUnsafe>
              )
            })()
          ) : loc.markerType === 'dot' || loc.markerColor ? (
            <CircleMarkerUnsafe
              key={loc.id}
              center={[loc.lat, loc.lng]}
              radius={8}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: loc.markerColor, fillOpacity: 1 }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-base mb-1">{loc.driverName}</p>
                  <p className="text-gray-600">{loc.markerLabel || `Vehicle: ${loc.vehiclePlate}`}</p>
                  <p className="text-gray-600">
                    Status: <span className="capitalize">{loc.status.toLowerCase()}</span>
                  </p>
                </div>
              </Popup>
            </CircleMarkerUnsafe>
          ) : (
            <MarkerUnsafe key={loc.id} position={[loc.lat, loc.lng]}>
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-base mb-1">{loc.driverName}</p>
                  <p className="text-gray-600">Vehicle: {loc.vehiclePlate}</p>
                  <p className="text-gray-600">
                    Status: <span className="capitalize">{loc.status.toLowerCase()}</span>
                  </p>
                </div>
              </Popup>
            </MarkerUnsafe>
          )
        )}
      </MapContainerUnsafe>
      <style jsx global>{`
        .map-eta-tooltip {
          background: transparent;
          border: 0;
          box-shadow: none;
          padding: 0;
        }
        .map-eta-tooltip:before {
          display: none;
        }
        .map-eta-tooltip .leaflet-tooltip-content {
          margin: 0;
          padding: 2px 7px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.2;
          color: #ffffff;
          white-space: nowrap;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
          background: #22c55e;
        }
        .map-eta-tooltip.map-eta-completed .leaflet-tooltip-content {
          background: #2563eb !important;
          color: #ffffff !important;
        }
        .map-eta-tooltip.map-eta-next .leaflet-tooltip-content {
          background: #16a34a !important;
          color: #ffffff !important;
        }
        .map-eta-tooltip.map-eta-upcoming .leaflet-tooltip-content {
          background: #22c55e !important;
          color: #ffffff !important;
        }
      `}</style>
    </div>
  );
}
