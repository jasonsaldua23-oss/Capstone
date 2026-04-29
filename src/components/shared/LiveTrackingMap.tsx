"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, Tooltip, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const MapContainerUnsafe = MapContainer as any;
const TileLayerUnsafe = TileLayer as any;
const MarkerUnsafe = Marker as any;
const PolylineUnsafe = Polyline as any;
const CircleMarkerUnsafe = CircleMarker as any;
const TooltipUnsafe = Tooltip as any;
const PolygonUnsafe = Polygon as any;

const NEGROS_OCCIDENTAL_LOCAL_BOUNDARY_GEOJSON_URL = '/geo/negros-occidental-maritime-with-bacolod.json?v=3';
const NEGROS_ISLAND_REGION_BOUNDARY_GEOJSON_URL = '/geo/negros-island-region-boundary.json?v=2';
const NEGROS_ORIENTAL_BOUNDARY_GEOJSON_URL = '/geo/negros-oriental-boundary.json?v=1';

type NegrosIslandGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
};

type NegrosBoundary = {
  maskGeometries?: NegrosIslandGeometry[];
  geometries: NegrosIslandGeometry[];
  bbox: [number, number, number, number];
};

let negrosBoundaryCache: NegrosBoundary | null = null;
let negrosBoundaryPromise: Promise<NegrosBoundary | null> | null = null;

function getFeatureName(feature: any) {
  const props = feature?.properties || {};
  const candidates = [
    props.display_name,
    props.name,
    props.NAME_1,
    props.NAME_2,
    props.PROVINCE,
    props.province,
    props.ADM1_EN,
    props.adm1_en,
  ];
  const value = candidates.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
  return String(value || '').toLowerCase();
}

function scoreBoundaryFeature(feature: any, requiredTerms: string[]) {
  const name = getFeatureName(feature);
  const addresstype = String(feature?.properties?.addresstype || '').toLowerCase();
  const type = String(feature?.properties?.type || '').toLowerCase();
  const className = String(feature?.properties?.class || '').toLowerCase();
  const adminLevel = String(feature?.properties?.admin_level || '').toLowerCase();

  let score = 0;
  const required = requiredTerms.map((term) => term.toLowerCase()).filter(Boolean);
  const requiredMatches = required.filter((term) => name.includes(term)).length;
  score += requiredMatches * 20;
  if (name.includes('philippines')) score += 4;
  if (name.includes('province')) score += 8;
  if (addresstype === 'province') score += 16;
  if (addresstype === 'state') score += 8;
  if (addresstype === 'city' || addresstype === 'municipality') score -= 8;
  if (type === 'administrative') score += 10;
  if (className === 'boundary') score += 10;
  if (adminLevel === '6') score += 12;
  if (name.includes('region')) score -= 8;
  return score;
}

function computeBBoxFromGeometry(geometry: NegrosIslandGeometry) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visitPoint = (pair: any) => {
    const lng = Number(pair?.[0]);
    const lat = Number(pair?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  };

  if (geometry.type === 'Polygon') {
    (geometry.coordinates as number[][][]).forEach((ring) => ring.forEach(visitPoint));
  } else {
    (geometry.coordinates as number[][][][]).forEach((polygon) =>
      polygon.forEach((ring) => ring.forEach(visitPoint))
    );
  }

  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
  return [minLng, minLat, maxLng, maxLat] as [number, number, number, number];
}

function bboxAreaScore(bbox: [number, number, number, number]) {
  const width = Math.max(0, bbox[2] - bbox[0]);
  const height = Math.max(0, bbox[3] - bbox[1]);
  return width * height;
}

function parseFirstBoundaryFeature(
  payload: any,
  requiredTerms: string[]
): { geometry: NegrosIslandGeometry; bbox: [number, number, number, number] } | null {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const candidates = features
    .map((feature: any) => {
      const name = getFeatureName(feature);
      const required = requiredTerms.map((term) => String(term || '').toLowerCase().trim()).filter(Boolean);
      if (required.length > 0 && !required.every((term) => name.includes(term))) return null;

      const geometry = feature?.geometry as NegrosIslandGeometry | undefined;
      if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null;
      const bbox =
        Array.isArray(feature?.bbox) && feature.bbox.length === 4
          ? [Number(feature.bbox[0]), Number(feature.bbox[1]), Number(feature.bbox[2]), Number(feature.bbox[3])] as [number, number, number, number]
          : computeBBoxFromGeometry(geometry);
      if (!bbox) return null;
      if (!bbox.every((value) => Number.isFinite(value))) return null;
      return { geometry, bbox, score: scoreBoundaryFeature(feature, requiredTerms), area: bboxAreaScore(bbox) };
    })
    .filter((candidate: any): candidate is { geometry: NegrosIslandGeometry; bbox: [number, number, number, number]; score: number; area: number } => Boolean(candidate))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.area - left.area;
    });

  if (candidates.length === 0) return null;
  return { geometry: candidates[0].geometry, bbox: candidates[0].bbox };
}

function parseAllBoundaryFeatures(
  payload: any,
  requiredTerms: string[]
): { geometries: NegrosIslandGeometry[]; bbox: [number, number, number, number] } | null {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const required = requiredTerms.map((term) => String(term || '').toLowerCase().trim()).filter(Boolean);

  const parsed = features
    .map((feature: any) => {
      const name = getFeatureName(feature);
      if (required.length > 0 && !required.every((term) => name.includes(term))) return null;

      const geometry = feature?.geometry as NegrosIslandGeometry | undefined;
      if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null;

      const bbox =
        Array.isArray(feature?.bbox) && feature.bbox.length === 4
          ? [Number(feature.bbox[0]), Number(feature.bbox[1]), Number(feature.bbox[2]), Number(feature.bbox[3])] as [number, number, number, number]
          : computeBBoxFromGeometry(geometry);
      if (!bbox || !bbox.every((value) => Number.isFinite(value))) return null;
      return { geometry, bbox };
    })
    .filter((entry: any): entry is { geometry: NegrosIslandGeometry; bbox: [number, number, number, number] } => Boolean(entry));

  if (parsed.length === 0) return null;

  const bbox = parsed.reduce<[number, number, number, number]>(
    (acc, entry) => [
      Math.min(acc[0], entry.bbox[0]),
      Math.min(acc[1], entry.bbox[1]),
      Math.max(acc[2], entry.bbox[2]),
      Math.max(acc[3], entry.bbox[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity]
  );

  return {
    geometries: parsed.map((entry) => entry.geometry),
    bbox,
  };
}

async function loadFirstValidBoundaryFromUrls(
  urls: string[],
  requiredTerms: string[]
): Promise<{ geometry: NegrosIslandGeometry; bbox: [number, number, number, number] } | null> {
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const payload = await response.json().catch(() => ({}));
      const parsed = parseFirstBoundaryFeature(payload, requiredTerms);
      if (parsed) return parsed;
    } catch {
      // try next URL
    }
  }
  return null;
}

function loadNegrosBoundary() {
  if (negrosBoundaryCache) return Promise.resolve(negrosBoundaryCache);
  if (negrosBoundaryPromise) return negrosBoundaryPromise;

  negrosBoundaryPromise = (async () => {
    const localBoundary = await loadFirstValidBoundaryFromUrls([NEGROS_OCCIDENTAL_LOCAL_BOUNDARY_GEOJSON_URL], [
      'negros occidental',
    ]);
    if (!localBoundary) {
      throw new Error('Failed to load local Negros Occidental maritime boundary geometry');
    }

    const regionBoundary = await loadFirstValidBoundaryFromUrls([NEGROS_ISLAND_REGION_BOUNDARY_GEOJSON_URL], [
      'negros island region',
    ]);
    const orientalBoundary = await loadFirstValidBoundaryFromUrls([NEGROS_ORIENTAL_BOUNDARY_GEOJSON_URL], [
      'negros oriental',
    ]);

    negrosBoundaryCache = {
      geometries: [localBoundary.geometry],
      bbox: localBoundary.bbox,
      maskGeometries:
        regionBoundary && orientalBoundary
          ? [regionBoundary.geometry, orientalBoundary.geometry]
          : regionBoundary
            ? [regionBoundary.geometry]
            : [localBoundary.geometry],
    };
    return negrosBoundaryCache;
  })()
    .catch(() => null)
    .finally(() => {
      negrosBoundaryPromise = null;
    });

  return negrosBoundaryPromise;
}

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
  accuracyMeters?: number;
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
  recenterSignal?: number;
  showZoomControls?: boolean;
  showDriverSelfBadge?: boolean;
  className?: string;
}

type SnappedPointOnRoute = {
  point: [number, number];
  t: number;
  distance2: number;
  heading: number;
  segmentIndex: number;
};

const NEGROS_ISLAND_FALLBACK_BOUNDS = L.latLngBounds([9.0380812, 122.3758966], [11.002995, 123.5688567]);
const WORLD_MASK_RING: [number, number][] = [
  [-90, -180],
  [-90, 180],
  [90, 180],
  [90, -180],
];
const truckIconCache = new Map<string, L.DivIcon>();
const statusPinIconCache = new Map<string, L.DivIcon>();
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

function getStatusPinIcon(color: 'green' | 'blue', number?: number | string) {
  const label = number === undefined || number === null || String(number).trim() === '' ? '' : String(number);
  const cacheKey = `${color}:${label}`;
  const cached = statusPinIconCache.get(cacheKey);
  if (cached) return cached;

  const icon = L.divIcon({
    className: 'status-pin-icon',
    html: `
      <div style="position:relative;width:28px;height:44px;display:flex;align-items:flex-start;justify-content:center;">
        <img
          src="${
            color === 'green'
              ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png'
              : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png'
          }"
          alt="pin"
          style="width:25px;height:41px;display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.2));"
          onerror="this.onerror=null;this.src='https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';"
        />
        ${label ? `<div style="position:absolute;top:9px;left:50%;transform:translateX(-50%);min-width:14px;height:14px;padding:0 3px;border-radius:9999px;background:rgba(255,255,255,0.96);border:1px solid rgba(15,23,42,0.08);color:${color === 'green' ? '#047857' : '#0369a1'};font-size:10px;line-height:14px;font-weight:800;text-align:center;box-shadow:0 1px 2px rgba(15,23,42,0.14);">${label}</div>` : ''}
      </div>
    `,
    iconSize: [28, 44],
    iconAnchor: [14, 44],
    popupAnchor: [1, -34],
  });

  statusPinIconCache.set(cacheKey, icon);
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

function clampPointToBounds(point: [number, number], bounds: L.LatLngBounds | null): [number, number] {
  if (!bounds) return point;
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  return [
    Math.min(Math.max(point[0], southWest.lat), northEast.lat),
    Math.min(Math.max(point[1], southWest.lng), northEast.lng),
  ];
}

function geometryToExteriorRings(geometry: NegrosIslandGeometry | null) {
  if (!geometry) return [] as [number, number][][];

  const sanitizeRing = (ring: number[][]) => {
    const converted = ring
      .map((pair) => [Number(pair?.[1]), Number(pair?.[0])] as [number, number])
      .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));

    const deduped = converted.filter((point, index, list) => {
      if (index === 0) return true;
      const previous = list[index - 1];
      return !(Math.abs(point[0] - previous[0]) < 0.000001 && Math.abs(point[1] - previous[1]) < 0.000001);
    });

    return deduped.length > 2 ? deduped : [];
  };

  if (geometry.type === 'Polygon') {
    const outerRing = geometry.coordinates[0] || [];
    const sanitized = sanitizeRing(outerRing);
    return sanitized.length > 0 ? [sanitized] : [];
  }

  return (geometry.coordinates as number[][][][])
    .map((polygon) => polygon[0] || [])
    .filter((ring) => Array.isArray(ring) && ring.length > 0)
    .map((ring) => sanitizeRing(ring))
    .filter((ring) => ring.length > 0);
}

function pointInRing(point: [number, number], ring: [number, number][]) {
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const prior = ring[previous];
    const intersects =
      current[1] > point[1] !== prior[1] > point[1] &&
      point[0] < ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1] || Number.EPSILON) + current[0];

    if (intersects) inside = !inside;
  }

  return inside;
}

function isPointInNegrosBoundary(point: [number, number], geometries: NegrosIslandGeometry[]) {
  return geometries.some((geometry) => {
    const exteriorRings = geometryToExteriorRings(geometry);
    return exteriorRings.some((ring) => ring.length > 2 && pointInRing(point, ring));
  });
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

function MapBoundsGuard({ enabled, bounds }: { enabled: boolean; bounds: L.LatLngBounds | null }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !bounds) return;
    const guardedBounds = bounds;
    map.setMaxBounds(guardedBounds);

    const center = map.getCenter();
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;

    if (!guardedBounds.contains(center)) {
      map.setView(guardedBounds.getCenter(), Math.max(map.getZoom(), 9), { animate: false });
    }
  }, [bounds, enabled, map]);

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

function ManualRecenter({
  center,
  recenterSignal,
  bounds,
}: {
  center: [number, number];
  recenterSignal?: number;
  bounds: L.LatLngBounds | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (typeof recenterSignal !== 'number') return;
    if (!Array.isArray(center) || center.length !== 2) return;
    if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
    map.setView(clampPointToBounds(center, bounds), map.getZoom(), { animate: true } as any);
  }, [bounds, center, map, recenterSignal]);

  return null;
}

function MapResizeSync() {
  const map = useMap();

  useEffect(() => {
    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;

    const invalidate = () => {
      if (cancelled) return;
      map.invalidateSize({ animate: false });
    };

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(invalidate);
    });

    const container = map.getContainer();
    const observer = 'ResizeObserver' in window
      ? new ResizeObserver(() => {
          window.requestAnimationFrame(invalidate);
        })
      : null;

    observer?.observe(container);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      observer?.disconnect();
    };
  }, [map]);

  return null;
}

function NegrosMaskPane() {
  const map = useMap();

  useEffect(() => {
    const paneName = 'negros-mask-pane';
    if (!map.getPane(paneName)) {
      const pane = map.createPane(paneName);
      pane.style.zIndex = '650';
      pane.style.pointerEvents = 'none';
    }
  }, [map]);

  return null;
}

function getTruckIcon(options: { direction?: TruckIconDirection; heading?: number; showSelfBadge?: boolean } = {}) {
  const direction = options.direction || 'right';
  const showSelfBadge = Boolean(options.showSelfBadge);
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
  const cacheKey = `${direction}:${rotation.toFixed(1)}:${showSelfBadge ? 'self' : 'driver'}`;
  const cached = truckIconCache.get(cacheKey);
  if (cached) return cached;

  const icon = L.divIcon({
    className: 'custom-truck-marker',
    html: `<div style="position:relative;width:66px;height:66px;display:flex;align-items:center;justify-content:center;overflow:visible;">
      ${showSelfBadge ? '<div style="position:absolute;left:50%;top:-8px;transform:translateX(-50%);border-radius:9999px;background:#ffffff;border:1px solid rgba(15,23,42,0.18);padding:1px 6px;color:#0f3d72;font-size:10px;line-height:14px;font-weight:900;letter-spacing:0;">YOU</div>' : ''}
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:9999px;background:#1d4ed8;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>
      <img src="${TRUCK_ICON_URL}" alt="truck" style="position:relative;z-index:1;width:58px;height:58px;display:block;image-rendering:auto;transform:rotate(${rotation}deg);transform-origin:29px 29px;will-change:transform;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.35)) drop-shadow(0 3px 5px rgba(0,0,0,0.35)) contrast(1.08) saturate(1.08);" onerror="this.onerror=null;this.src='/icons/delivery-truck.png';" />
    </div>`,
    iconSize: [66, 66],
    iconAnchor: [33, 33],
    popupAnchor: [0, -33],
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
  recenterSignal,
  showZoomControls = true,
  showDriverSelfBadge = false,
  className = "w-full h-[350px] rounded-xl overflow-hidden border shadow-sm",
}: LiveTrackingMapProps) {
  const rawSafeLocations = useMemo(
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

  const rawSafeRouteLines = useMemo(
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

  const [smoothedLocations, setSmoothedLocations] = useState<DriverLocation[]>(rawSafeLocations);
  const [snappedRoutePointsById, setSnappedRoutePointsById] = useState<Record<string, [number, number][]>>({});
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const [negrosBoundary, setNegrosBoundary] = useState<NegrosBoundary | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!restrictToNegrosOccidental) {
      setNegrosBoundary(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      const boundary = await loadNegrosBoundary();
      if (!cancelled) {
        setNegrosBoundary(boundary);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [restrictToNegrosOccidental]);

  const negrosBounds = useMemo(
    () =>
      negrosBoundary
        ? L.latLngBounds(
            [negrosBoundary.bbox[1], negrosBoundary.bbox[0]],
            [negrosBoundary.bbox[3], negrosBoundary.bbox[2]]
          )
        : null,
    [negrosBoundary]
  );
  const safeLocations = useMemo(
    () =>
      restrictToNegrosOccidental
        ? negrosBoundary
          ? rawSafeLocations.filter((loc) => isPointInNegrosBoundary([loc.lat, loc.lng], negrosBoundary.geometries))
          : rawSafeLocations
        : rawSafeLocations,
    [negrosBoundary, rawSafeLocations, restrictToNegrosOccidental]
  );

  const safeRouteLines = useMemo(
    () =>
      restrictToNegrosOccidental
        ? negrosBoundary
          ? rawSafeRouteLines
              .map((line) => ({
                ...line,
                points: line.points.filter((point) => isPointInNegrosBoundary(point, negrosBoundary.geometries)),
              }))
              .filter((line) => line.points.length > 1)
          : rawSafeRouteLines
        : rawSafeRouteLines,
    [negrosBoundary, rawSafeRouteLines, restrictToNegrosOccidental]
  );

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
  }, [roadSnapSignature]);

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
  const activeBounds = restrictToNegrosOccidental ? (negrosBounds ?? NEGROS_ISLAND_FALLBACK_BOUNDS) : null;
  const negrosMaskRings = useMemo(
    () =>
      (negrosBoundary?.maskGeometries || negrosBoundary?.geometries || []).flatMap((geometry) =>
        geometryToExteriorRings(geometry)
      ),
    [negrosBoundary]
  );
  const resolvedCenter =
    restrictToNegrosOccidental && Array.isArray(center) && center.length === 2
      ? clampPointToBounds(center, activeBounds)
      : center;

  return (
    <div className={`bg-white ${className}`}>
      <MapContainerUnsafe
        center={resolvedCenter}
        zoom={zoom}
        scrollWheelZoom={true}
        inertia={false}
        bounceAtZoomLimits={false}
        className="w-full h-full z-0"
        zoomControl={showZoomControls}
        zoomAnimation={false}
        markerZoomAnimation={false}
        preferCanvas
        minZoom={restrictToNegrosOccidental ? 9 : undefined}
        bounds={activeBounds ?? undefined}
        maxBounds={activeBounds ?? undefined}
        maxBoundsViscosity={restrictToNegrosOccidental ? 1.0 : undefined}
      >
        <MapResizeSync />
        <NegrosMaskPane />
        <ZoomTracker onZoomChange={setCurrentZoom} />
        <MapBoundsGuard enabled={restrictToNegrosOccidental} bounds={activeBounds} />
        <ManualRecenter center={center} recenterSignal={recenterSignal} bounds={activeBounds} />
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
          noWrap={restrictToNegrosOccidental}
        />
        {restrictToNegrosOccidental && negrosMaskRings.length > 0 ? (
          <PolygonUnsafe
            positions={[WORLD_MASK_RING, ...negrosMaskRings]}
            pane="negros-mask-pane"
            interactive={false}
            pathOptions={{
              stroke: false,
              fillColor: '#aad3df',
              fillOpacity: 1,
              fillRule: 'evenodd',
              opacity: 1,
            }}
          />
        ) : null}
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
          loc.markerType === 'pin' ? (
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
              icon={getStatusPinIcon(pinColor, loc.markerNumber)}
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
          ) : loc.markerType === 'truck' ? (
            <Fragment key={loc.id}>
              <CircleMarkerUnsafe
                center={[loc.lat, loc.lng]}
                radius={11}
                pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 0.9 }}
              />
              <MarkerUnsafe
                position={[loc.lat, loc.lng]}
                icon={getTruckIcon({ direction: loc.markerDirection || 'right', heading: loc.markerHeading, showSelfBadge: showDriverSelfBadge })}
                zIndexOffset={10000}
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
            </Fragment>
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
      <style>{`
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
