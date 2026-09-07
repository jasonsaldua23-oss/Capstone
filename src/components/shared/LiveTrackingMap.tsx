"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, Tooltip, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MapLibreNavigationMap from './MapLibreNavigationMap';
import {
  bearingBetweenMapPoints,
  navigationReckoningSpeedMps,
  pointAtRouteDistance,
  predictedRouteProgressMeters,
  projectPointOntoRoute,
  quantizeRouteSplitMeters,
  splitRouteAtDistance,
  NAVIGATION_DEAD_RECKONING_MAX_MS,
  type NavigationViewportInsets,
} from '@/lib/map-navigation';

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
const NEGROS_OCCIDENTAL_MUNICIPAL_BOUNDARY_GEOJSON_URL = '/geo/negros-occidental-municipal-maritime.json?v=1';
const SILAY_TALISAY_FALLBACK_BOUNDS: [[number, number], [number, number]] = [
  [10.62, 122.86],
  [10.94, 123.08],
];

type NegrosIslandGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
};

type NegrosBoundary = {
  maskGeometries?: NegrosIslandGeometry[];
  geometries: NegrosIslandGeometry[];
  bbox: [number, number, number, number];
};
type ServiceBoundary = {
  geometries: NegrosIslandGeometry[];
  bbox: [number, number, number, number];
};

let negrosBoundaryCache: NegrosBoundary | null = null;
let negrosBoundaryPromise: Promise<NegrosBoundary | null> | null = null;
let serviceBoundaryCache: ServiceBoundary | null = null;
let serviceBoundaryPromise: Promise<ServiceBoundary | null> | null = null;
// Keeps the latest successful road geometry available if the map remounts while
// the external routing service is temporarily unavailable.
const roadSnappedRouteCache = new Map<string, [number, number][]>();

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

  const bbox = parsed.reduce(
    (acc, entry) => [
      Math.min(acc[0], entry.bbox[0]),
      Math.min(acc[1], entry.bbox[1]),
      Math.max(acc[2], entry.bbox[2]),
      Math.max(acc[3], entry.bbox[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number]
  );

  return {
    geometries: parsed.map((entry) => entry.geometry),
    bbox,
  };
}

function parseBoundaryFeaturesByNames(
  payload: any,
  targetNames: string[]
): { geometries: NegrosIslandGeometry[]; bbox: [number, number, number, number] } | null {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const targets = targetNames.map((name) => String(name || '').toLowerCase().trim()).filter(Boolean);
  const parsed = features
    .map((feature: any) => {
      const name = getFeatureName(feature);
      if (!targets.some((target) => name.includes(target))) return null;
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
  const bbox = parsed.reduce(
    (acc, entry) => [
      Math.min(acc[0], entry.bbox[0]),
      Math.min(acc[1], entry.bbox[1]),
      Math.max(acc[2], entry.bbox[2]),
      Math.max(acc[3], entry.bbox[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number]
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

function loadSilayTalisayServiceBoundary() {
  if (serviceBoundaryCache) return Promise.resolve(serviceBoundaryCache);
  if (serviceBoundaryPromise) return serviceBoundaryPromise;

  serviceBoundaryPromise = (async () => {
    const response = await fetch(NEGROS_OCCIDENTAL_MUNICIPAL_BOUNDARY_GEOJSON_URL);
    if (!response.ok) throw new Error('Failed to load municipal boundary geometry');
    const payload = await response.json().catch(() => ({}));
    const parsed = parseBoundaryFeaturesByNames(payload, ['silay', 'talisay']);
    if (!parsed) throw new Error('Failed to parse Silay/Talisay service geometry');
    serviceBoundaryCache = { geometries: parsed.geometries, bbox: parsed.bbox };
    return serviceBoundaryCache;
  })()
    .catch(() => null)
    .finally(() => {
      serviceBoundaryPromise = null;
    });

  return serviceBoundaryPromise;
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

export type DriverLocationPopupItem = {
  name: string;
  qty: string;
};

export type DriverLocation = {
  id: string;
  driverName: string;
  vehiclePlate: string;
  lat: number;
  lng: number;
  actualLat?: number;
  actualLng?: number;
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
  // Ground speed in m/s from the GPS fix. Drives dead reckoning between fixes so
  // the icon moves with the driver instead of trailing one full update interval.
  speedMps?: number;
  routeProgressMeters?: number;
  popupCustomerName?: string;
  popupAddress?: string;
  popupOrderItems?: DriverLocationPopupItem[];
  assignedTripNumber?: string;
  destinationCustomer?: string;
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
  preserveExactEndpoints?: boolean;
  selectable?: boolean;
};

interface LiveTrackingMapProps {
  locations: DriverLocation[];
  center?: [number, number];
  zoom?: number;
  routeLines?: LiveRouteLine[];
  restrictToNegrosOccidental?: boolean;
  navigationPerspective?: boolean;
  is3DPerspective?: boolean;
  recenterSignal?: number;
  zoomInSignal?: number;
  zoomOutSignal?: number;
  navigationViewportInsets?: NavigationViewportInsets;
  showZoomControls?: boolean;
  showDriverSelfBadge?: boolean;
  onRouteLineSelect?: (routeLineId: string) => void;
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
// Updated: use the Driver Portal's 2D van icon consistently across shared portal maps.
const TRUCK_ICON_URL = '/icons/aab-van-iso.png';
// This icon's nose points upper-right (~northeast, 45deg) at 0deg image rotation.
const TRUCK_ICON_BASE_HEADING = 45;
const TRUCK_ROTATION_QUANTIZATION_DEG = 1;
const NAV_CAMERA_LOOKAHEAD_METERS = 95;
const NAV_CAMERA_ANIMATION_SECONDS = 0.35;
const TRUCK_DEFAULT_SMOOTHING_DURATION_MS = 1000;
const TRUCK_MIN_SMOOTHING_DURATION_MS = 450;
// Matches the animation span to the real elapsed time between GPS fixes (see
// the *1 factor below) instead of a short cap, so fast movement over a long
// update gap plays out as continuous travel rather than a dash-then-freeze.
const TRUCK_MAX_SMOOTHING_DURATION_MS = 9000;
const TRUCK_STATIONARY_THRESHOLD_METERS = 1.5;
const TRUCK_REROUTE_CONTINUITY_MAX_DISTANCE_METERS = 120;
// Beyond this distance from the active route the driver is treated as off-route
// (a missed turn or a self-chosen detour). The icon then follows the live GPS
// position instead of being pinned to the stale route — this is what stops the
// vehicle from freezing when the driver changes roads, until the reroute lands.
const TRUCK_MAX_ROUTE_SNAP_METERS = 60;
const TRUCK_ROUTE_LOOKAHEAD_METERS = 20;
const TRUCK_LOCAL_TANGENT_LOOKAHEAD_METERS = 8;
// Stationary clamp: with speed at or below this, route progress is frozen so
// jitter cannot ratchet a parked vehicle forward through the monotonic clamp.
// The dead-reckoning constants this pairs with live in `@/lib/map-navigation`.
const TRUCK_PARKED_SPEED_MPS = 0.6;

function getStatusPinIcon(color: 'green' | 'blue' | 'red' | 'orange', number?: number | string) {
  const label = number === undefined || number === null || String(number).trim() === '' ? '' : String(number);
  const cacheKey = `${color}:${label}`;
  const cached = statusPinIconCache.get(cacheKey);
  if (cached) return cached;

  const icon = L.divIcon({
    className: 'status-pin-icon',
    html: `
      <div style="position:relative;width:28px;height:44px;display:flex;align-items:flex-start;justify-content:center;">
        <img
            src="${color === 'green'
        ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png'
        : color === 'red'
          ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png'
          : color === 'orange'
            ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png'
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

function expandBounds(bounds: L.LatLngBounds, latPad: number, lngPad: number) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return L.latLngBounds([sw.lat - latPad, sw.lng - lngPad], [ne.lat + latPad, ne.lng + lngPad]);
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
    const outerRing = (geometry.coordinates[0] || []) as number[][];
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

function bearingAtRouteEnd(points: [number, number][]) {
  const end = points[points.length - 1];
  for (let index = points.length - 2; index >= 0; index -= 1) {
    if (approximateDistanceMeters(points[index], end) >= 12) {
      return bearingBetweenPoints(points[index], end);
    }
  }
  return null;
}

async function fetchRoadSnappedPoints(
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

function MapBoundsGuard({ enabled, bounds }: { enabled: boolean; bounds: L.LatLngBounds | null }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !bounds) return;
    const guardedBounds = bounds;
    map.setMaxBounds(guardedBounds);
    const minRestrictedZoom = 11;
    if (map.getZoom() < minRestrictedZoom) {
      map.setZoom(minRestrictedZoom);
    }

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
  const iconAnchor: [number, number] = [36, 36];
  const popupAnchor: [number, number] = [0, -36];
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
    html: `<div style="position:relative;width:72px;height:72px;display:flex;align-items:center;justify-content:center;overflow:visible;">
      ${showSelfBadge ? '<div style="position:absolute;left:50%;top:-8px;transform:translateX(-50%);border-radius:9999px;background:#ffffff;border:1px solid rgba(15,23,42,0.18);padding:1px 6px;color:#0f3d72;font-size:10px;line-height:14px;font-weight:900;letter-spacing:0;">YOU</div>' : ''}
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:9999px;background:#1d4ed8;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>
      <img src="${TRUCK_ICON_URL}" alt="truck" style="position:relative;z-index:1;width:72px;height:72px;display:block;object-fit:contain;image-rendering:auto;transform:rotate(${rotation}deg);transform-origin:36px 36px;will-change:transform;filter:drop-shadow(0 4px 10px rgba(15,23,42,0.38)) contrast(1.08) saturate(1.08);" onerror="this.onerror=null;this.src='/icons/driver-location-cropped.png';" />
    </div>`,
    iconSize: [72, 72],
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
  is3DPerspective = false,
  recenterSignal,
  zoomInSignal,
  zoomOutSignal,
  navigationViewportInsets,
  showZoomControls = true,
  showDriverSelfBadge = false,
  onRouteLineSelect,
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

  const [smoothedLocations, setSmoothedLocations] = useState<DriverLocation[]>(
    // Navigation trucks are shown only after verified road geometry is available;
    // briefly hiding the icon is safer than ever presenting a raw off-road fix.
    navigationPerspective ? rawSafeLocations.filter((location) => location.markerType !== 'truck') : rawSafeLocations
  );
  const smoothedLocationsRef = useRef(smoothedLocations);
  const [snappedRoutePointsById, setSnappedRoutePointsById] = useState<Record<string, [number, number][]>>(
    () => Object.fromEntries(roadSnappedRouteCache.entries())
  );
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const [negrosBoundary, setNegrosBoundary] = useState<NegrosBoundary | null>(null);
  const [serviceBoundary, setServiceBoundary] = useState<ServiceBoundary | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTruckTargetAtRef = useRef<number | null>(null);
  const acceptedRouteProgressRef = useRef<{ routeKey: string; distanceMeters: number } | null>(null);

  useEffect(() => {
    if (!restrictToNegrosOccidental) {
      window.queueMicrotask(() => {
        setNegrosBoundary(null);
        setServiceBoundary(null);
      });
      return;
    }

    let cancelled = false;

    const run = async () => {
      const boundary = await loadNegrosBoundary();
      const service = await loadSilayTalisayServiceBoundary();
      if (!cancelled) {
        setNegrosBoundary(boundary);
        setServiceBoundary(service);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [restrictToNegrosOccidental]);

  const safeLocations = useMemo(
    () =>
      restrictToNegrosOccidental
        ? serviceBoundary
          ? rawSafeLocations.filter((loc) => isPointInNegrosBoundary([loc.lat, loc.lng], serviceBoundary.geometries))
          : rawSafeLocations
        : rawSafeLocations,
    [rawSafeLocations, restrictToNegrosOccidental, serviceBoundary]
  );

  const safeRouteLines = useMemo(
    () =>
      restrictToNegrosOccidental
        ? serviceBoundary
          ? rawSafeRouteLines
            .map((line) => ({
              ...line,
              points: line.points.filter((point) => isPointInNegrosBoundary(point, serviceBoundary.geometries)),
            }))
            .filter((line) => line.points.length > 1)
          : rawSafeRouteLines
        : rawSafeRouteLines,
    [rawSafeRouteLines, restrictToNegrosOccidental, serviceBoundary]
  );

  const roadSnapSignature = useMemo(
    () =>
      safeRouteLines
        .filter((line) => line.snapToRoad)
        .map(
          (line) =>
            // Fix: ignore sub-road-scale GPS jitter so an in-flight OSRM request
            // can finish instead of being aborted for every tiny coordinate change.
            `${line.id}:${line.points.map((point) => `${point[0].toFixed(4)},${point[1].toFixed(4)}`).join('|')}`
        )
        .join('||'),
    [safeRouteLines]
  );

  useEffect(() => {
    const linesNeedingRoadSnap = safeRouteLines
      .filter((line) => line.snapToRoad && line.points.length > 1)
      // Fix: snap the taken route first so its arrival tangent can constrain the
      // upcoming route to leave from the front of the truck instead of its rear.
      .sort((a, b) => Number(b.id.endsWith('-route-completed')) - Number(a.id.endsWith('-route-completed')));
    if (linesNeedingRoadSnap.length === 0) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      const nextSnappedLines: Record<string, [number, number][]> = {};
      let sharedDriverRoadPoint: [number, number] | null = null;
      let sharedDriverBearing: number | null = null;
      for (const line of linesNeedingRoadSnap) {
        try {
          const isCompletedPath = line.id.endsWith('-route-completed');
          const isUpcomingPath = line.id.endsWith('-route-upcoming');
          const routeInputPoints = isUpcomingPath && sharedDriverRoadPoint
            ? [sharedDriverRoadPoint, ...line.points.slice(1)]
            : line.points;
          const snappedPoints = await fetchRoadSnappedPoints(
            routeInputPoints,
            controller.signal,
            isUpcomingPath ? sharedDriverBearing : null
          );

          const anchoredSnappedPoints = [...snappedPoints];
          if (line.preserveExactEndpoints) {
            // Driver Portal only: keep the path attached to the live/raw GPS endpoint.
            const startPoint = routeInputPoints[0];
            const endPoint = routeInputPoints[routeInputPoints.length - 1];
            const samePoint = (left: [number, number], right: [number, number]) =>
              Math.abs(left[0] - right[0]) < 0.000001 && Math.abs(left[1] - right[1]) < 0.000001;
            if (startPoint && anchoredSnappedPoints[0] && !samePoint(startPoint, anchoredSnappedPoints[0])) {
              anchoredSnappedPoints.unshift(startPoint);
            }
            if (
              endPoint &&
              anchoredSnappedPoints[anchoredSnappedPoints.length - 1] &&
              !samePoint(endPoint, anchoredSnappedPoints[anchoredSnappedPoints.length - 1])
            ) {
              anchoredSnappedPoints.push(endPoint);
            }
          }

          if (isCompletedPath && anchoredSnappedPoints.length > 1) {
            // The completed route defines both the truck junction and the
            // direction of travel through that junction.
            sharedDriverRoadPoint = anchoredSnappedPoints[anchoredSnappedPoints.length - 1];
            sharedDriverBearing = bearingAtRouteEnd(anchoredSnappedPoints);
          }
          if (anchoredSnappedPoints.length > 1) {
            nextSnappedLines[line.id] = anchoredSnappedPoints;
          }
        } catch {
          // Keep the line hidden rather than drawing a shortcut across buildings.
        }
        if (cancelled) return;
      }

      // Preserve the last successful road geometry during transient OSRM errors.
      Object.entries(nextSnappedLines).forEach(([lineId, points]) => {
        roadSnappedRouteCache.set(lineId, points);
      });
      setSnappedRoutePointsById((previous) => ({ ...previous, ...nextSnappedLines }));
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roadSnapSignature]);

  const renderedRouteLines = useMemo(
    () =>
      safeRouteLines.flatMap((line) => {
        if (!line.snapToRoad) return [line];
        const snappedPoints = snappedRoutePointsById[line.id];
        // Only render verified road geometry; never draw a shortcut across buildings.
        if (!snappedPoints || snappedPoints.length < 2) return [];
        return [{ ...line, points: snappedPoints }];
      }),
    [safeRouteLines, snappedRoutePointsById]
  );

  const completedRouteHeading = useMemo(() => {
    const completedRoute = renderedRouteLines.find((line) => line.id.endsWith('-route-completed'));
    return completedRoute && completedRoute.points.length > 1
      ? bearingAtRouteEnd(completedRoute.points)
      : null;
  }, [renderedRouteLines]);

  const navigationRouteGeometry = useMemo(() => {
    const completed = renderedRouteLines.find((line) => line.id.endsWith('-route-completed'));
    const upcoming = renderedRouteLines.find((line) => line.id.endsWith('-route-upcoming'));
    if (!completed && !upcoming) return [] as [number, number][];

    // The completed and upcoming lines share the truck junction. Joining them
    // produces one authoritative road geometry for projection and animation.
    return dedupeConsecutivePoints([
      ...(completed?.points || []),
      ...(upcoming?.points || []),
    ]);
  }, [renderedRouteLines]);
  const navigationRouteKey = useMemo(
    () => renderedRouteLines
      .filter((line) => line.id.endsWith('-route-completed') || line.id.endsWith('-route-upcoming'))
      // Route-relative distances are valid only for the exact geometry on which
      // they were measured. Include its coordinates so reroutes reset progress.
      .map((line) => `${line.id}:${line.points.map((point) => `${point[0].toFixed(6)},${point[1].toFixed(6)}`).join('|')}`)
      .join('|'),
    [renderedRouteLines]
  );

  const routeOriginPoint = useMemo<[number, number] | null>(() => {
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
    if (routePolylines.length === 0) return null;
    const first = routePolylines[0]?.points?.[0];
    return Array.isArray(first) && Number.isFinite(first[0]) && Number.isFinite(first[1]) ? first : null;
  }, [renderedRouteLines]);

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

    return safeLocations.flatMap((loc) => {
      if (loc.markerType !== 'truck') return [loc];
      // Fix: never hide the truck while route geometry is briefly unavailable
      // (initial load, reroute in flight, OSRM hiccup) — that read as the
      // vehicle "jumping" when it reappeared moments later at a new spot.
      if (snapTargetPolylines.length === 0) return [loc];

      // Fix: every GPS fix is independently map-matched. Using the prior route
      // junction here made the marker lag behind instead of following the driver.
      const authoritativeRoadPoint: [number, number] = [loc.lat, loc.lng];

      let bestSnap: SnappedPointOnRoute | null = null;
      let bestPolyline: [number, number][] | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      const expectedHeading =
        typeof loc.markerHeading === 'number' && Number.isFinite(loc.markerHeading)
          ? normalizeAngle(loc.markerHeading)
          : null;

      for (const polyline of snapTargetPolylines) {
        const candidate = nearestPointOnPolyline(authoritativeRoadPoint, polyline.points);
        if (!candidate) continue;

        const distanceMeters = approximateDistanceMeters(authoritativeRoadPoint, candidate.point);
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
        return [loc];
      }

      // Fix: keep the displayed vehicle on the available road while raw GPS drives rerouting.

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
      // Fix: navigation follows the segment beneath the vehicle; looking ahead
      // across a bend would tilt its body before it reaches the turn.
      const headingCandidate =
        navigationPerspective && typeof segmentHeading === 'number'
          ? segmentHeading
          : typeof localForwardHeading === 'number' && Number.isFinite(localForwardHeading)
          ? normalizeAngle(localForwardHeading)
          : typeof routeHeading === 'number' && Number.isFinite(routeHeading)
            ? normalizeAngle(routeHeading)
            : typeof completedRouteHeading === 'number' && Number.isFinite(completedRouteHeading)
              ? normalizeAngle(completedRouteHeading)
              : typeof segmentHeading === 'number'
                ? segmentHeading
                : typeof loc.markerHeading === 'number' && Number.isFinite(loc.markerHeading)
                  ? normalizeAngle(loc.markerHeading)
                  : undefined;
      // Fix: when the driver's actual GPS heading disagrees with the route
      // tangent by more than 90°, reverse the navigation icon along the road
      // so its body stays aligned even when the GPS heading is noisy.
      const gpsHeading =
        typeof loc.markerHeading === 'number' && Number.isFinite(loc.markerHeading) && loc.markerHeading >= 0
          ? normalizeAngle(loc.markerHeading)
          : null;
      const routeDerivedHeading =
        typeof headingCandidate === 'number' ? headingCandidate : null;
      const snappedHeading = (() => {
        if (gpsHeading !== null && routeDerivedHeading !== null) {
          const delta = Math.abs(shortestAngleDelta(gpsHeading, routeDerivedHeading));
          // A delta > 90° means the driver is heading roughly opposite to the
          // route tangent; navigation still keeps the body parallel to the road.
          if (delta > 90) return navigationPerspective ? normalizeAngle(routeDerivedHeading + 180) : gpsHeading;
        }
        return headingCandidate;
      })();

      return [{
        ...loc,
        // Preserve raw GPS separately while the visible truck stays on the road.
        actualLat: loc.lat,
        actualLng: loc.lng,
        lat: bestSnap.point[0],
        lng: bestSnap.point[1],
        markerHeading: snappedHeading,
      }];
    });
  }, [completedRouteHeading, navigationPerspective, safeLocations, renderedRouteLines]);

  useEffect(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const receivedAt = performance.now();
    const observedUpdateInterval = lastTruckTargetAtRef.current === null
      ? TRUCK_DEFAULT_SMOOTHING_DURATION_MS
      : receivedAt - lastTruckTargetAtRef.current;
    lastTruckTargetAtRef.current = receivedAt;
    const animationDurationMs = navigationPerspective
      ? Math.max(
        TRUCK_MIN_SMOOTHING_DURATION_MS,
        Math.min(TRUCK_MAX_SMOOTHING_DURATION_MS, observedUpdateInterval * 0.9)
      )
      : TRUCK_DEFAULT_SMOOTHING_DURATION_MS;
    const previousAcceptedProgress = acceptedRouteProgressRef.current;
    const routeGeometryChanged = Boolean(
      previousAcceptedProgress && previousAcceptedProgress.routeKey !== navigationRouteKey
    );
    const stabilizedTargets = snappedLocations.map((location) => {
      if (location.markerType !== 'truck' || navigationRouteGeometry.length < 2) {
        return location;
      }

      const projected = projectPointOntoRoute([location.lat, location.lng], navigationRouteGeometry);
      if (!projected) return location;

      // Off-route: the monotonic progress clamp below would pin the icon to the
      // furthest point it reached on the old route, which is exactly the freeze
      // that happened when the driver took another road. Drop the clamp and let
      // the icon track the live position; the replacement route re-anchors
      // progress from scratch once it loads.
      if (projected.distanceFromRouteMeters > TRUCK_MAX_ROUTE_SNAP_METERS) {
        acceptedRouteProgressRef.current = null;
        return location;
      }

      const previousProgress = acceptedRouteProgressRef.current;
      const reportedSpeedMps = Number(location.speedMps);
      const isReportedStationary =
        Number.isFinite(reportedSpeedMps) && reportedSpeedMps <= TRUCK_PARKED_SPEED_MPS;
      let acceptedDistance = projected.distanceAlongMeters;
      if (previousProgress?.routeKey === navigationRouteKey) {
        // Monotonic forward progress: GPS noise or slight off-route deviations
        // must not move the progress backward on the current route. That same
        // clamp would ratchet a parked vehicle forward one jitter sample at a
        // time, so while the fix reports itself stopped the progress is held.
        acceptedDistance = isReportedStationary
          ? previousProgress.distanceMeters
          : Math.max(previousProgress.distanceMeters, projected.distanceAlongMeters);
      } else if (routeGeometryChanged) {
        const previousVisibleLocation = smoothedLocationsRef.current.find(
          (candidate) => candidate.id === location.id && candidate.markerType === 'truck'
        );
        const previousVisibleProgress = previousVisibleLocation
          ? projectPointOntoRoute(
            [previousVisibleLocation.lat, previousVisibleLocation.lng],
            navigationRouteGeometry
          )
          : null;
        if (
          previousVisibleProgress &&
          previousVisibleProgress.distanceFromRouteMeters <= TRUCK_REROUTE_CONTINUITY_MAX_DISTANCE_METERS
        ) {
          // Fix: refreshed OSRM geometry must not retract the already-grey path.
          // Continue from the visible truck's position on the replacement route.
          acceptedDistance = Math.max(acceptedDistance, previousVisibleProgress.distanceAlongMeters);
        }
      }
      acceptedRouteProgressRef.current = { routeKey: navigationRouteKey, distanceMeters: acceptedDistance };
      const roadPoint = pointAtRouteDistance(navigationRouteGeometry, acceptedDistance);
      return roadPoint
        ? { ...location, lat: roadPoint[0], lng: roadPoint[1], routeProgressMeters: acceptedDistance }
        : { ...location, routeProgressMeters: acceptedDistance };
    });

    setSmoothedLocations((previousLocations) => {
      const previousById = new Map(previousLocations.map((loc) => [loc.id, loc]));
      const hasMovement = stabilizedTargets.some((loc) => {
        if (loc.markerType !== 'truck') return false;
        const previous = previousById.get(loc.id);
        if (!previous) return true;
        const distanceMoved = approximateDistanceMeters([previous.lat, previous.lng], [loc.lat, loc.lng]);
        const headingChanged =
          typeof loc.markerHeading === 'number' &&
          typeof previous.markerHeading === 'number' &&
          Math.abs(shortestAngleDelta(previous.markerHeading, loc.markerHeading)) > 1;
        const progressChanged =
          typeof loc.routeProgressMeters === 'number' &&
          typeof previous.routeProgressMeters === 'number' &&
          Math.abs(loc.routeProgressMeters - previous.routeProgressMeters) > 0.05;
        return distanceMoved > 0.05 || headingChanged || progressChanged;
      });

      if (!hasMovement) {
        const nextLocations = stabilizedTargets.map((targetLocation) => {
          if (targetLocation.markerType !== 'truck') return targetLocation;
          const previous = previousById.get(targetLocation.id);
          return previous
            ? {
              ...targetLocation,
              // On first route load, adopt the projected road point once;
              // subsequent sub-threshold GPS fixes retain the prior position.
              lat: previous.lat,
              lng: previous.lng,
              markerHeading: previous.markerHeading ?? targetLocation.markerHeading,
              routeProgressMeters: previous.routeProgressMeters ?? targetLocation.routeProgressMeters,
            }
            : targetLocation;
        });
        smoothedLocationsRef.current = nextLocations;
        return nextLocations;
      }

      const startTime = performance.now();
      // Ground speed the icon may be advanced with between fixes. Dead reckoning
      // is a navigation-view behaviour: other maps keep showing reported
      // positions only. Zero disables prediction for that vehicle entirely.
      const deadReckoningSpeedFor = (location: DriverLocation) => {
        if (!navigationPerspective || navigationRouteGeometry.length < 2) return 0;
        if (typeof location.routeProgressMeters !== 'number') return 0;
        return navigationReckoningSpeedMps(location.speedMps);
      };
      const hasDeadReckoning = stabilizedTargets.some(
        (location) => location.markerType === 'truck' && deadReckoningSpeedFor(location) > 0
      );
      // With prediction on, the loop outlives the catch-up so a late fix does not
      // strand the icon; without it the loop still ends when the catch-up does.
      const totalLoopDurationMs = animationDurationMs + (hasDeadReckoning ? NAVIGATION_DEAD_RECKONING_MAX_MS : 0);

      const animate = (now: number) => {
        const elapsedMs = now - startTime;
        const progress = Math.min(1, elapsedMs / animationDurationMs);
        // Smoothstep keeps velocity continuous at both ends while using almost
        // the entire GPS interval, so multi-second updates still look continuous.
        const easedProgress = progress * progress * (3 - 2 * progress);
        // Time the next fix is overdue by, which is how far past the predicted
        // position the icon is allowed to keep coasting.
        const overdueMs = Math.max(0, elapsedMs - animationDurationMs);

        setSmoothedLocations(() => {
          const nextLocations = stabilizedTargets.map((targetLoc) => {
            if (targetLoc.markerType !== 'truck') {
              return targetLoc;
            }

            const previous = previousById.get(targetLoc.id);
            if (!previous) {
              return targetLoc;
            }

            const movementMeters = approximateDistanceMeters(
              [previous.lat, previous.lng],
              [targetLoc.lat, targetLoc.lng]
            );
            // Movement bearing is useful only when routed geometry has no tangent.
            // Prefer the road-derived target heading so the icon stays lane-aligned.
            const movementHeading = movementMeters >= TRUCK_STATIONARY_THRESHOLD_METERS
              ? bearingBetweenMapPoints([previous.lat, previous.lng], [targetLoc.lat, targetLoc.lng])
              : null;
            const startHeading =
              typeof previous.markerHeading === 'number' && Number.isFinite(previous.markerHeading)
                ? previous.markerHeading
                : typeof targetLoc.markerHeading === 'number' && Number.isFinite(targetLoc.markerHeading)
                  ? targetLoc.markerHeading
                  : undefined;
            const endHeading =
              typeof targetLoc.markerHeading === 'number' && Number.isFinite(targetLoc.markerHeading)
                ? targetLoc.markerHeading
                : movementHeading ?? startHeading;
            // A prior frame may belong to replaced route geometry. Reproject its
            // visible coordinate onto the current road before interpolating.
            const startRouteProgress =
              navigationRouteGeometry.length >= 2
                ? projectPointOntoRoute([previous.lat, previous.lng], navigationRouteGeometry)?.distanceAlongMeters
                : previous.routeProgressMeters;
            const endRouteProgress = targetLoc.routeProgressMeters;
            // Dead reckoning. Animating to the received fix always leaves the
            // icon one full update interval behind the driver, so it aims at
            // where the measured ground speed says the driver will be when this
            // animation lands, and keeps coasting while the next fix is overdue.
            // The next accepted fix corrects whatever the prediction got wrong.
            const animatedRouteProgress =
              typeof startRouteProgress === 'number' && typeof endRouteProgress === 'number'
                ? predictedRouteProgressMeters({
                  startProgressMeters: startRouteProgress,
                  targetProgressMeters: endRouteProgress,
                  easedProgress,
                  reckoningSpeedMps: deadReckoningSpeedFor(targetLoc),
                  catchUpDurationMs: animationDurationMs,
                  overdueMs,
                })
                : endRouteProgress;
            const animatedRoadPoint =
              navigationRouteGeometry.length >= 2 && typeof animatedRouteProgress === 'number'
                ? pointAtRouteDistance(navigationRouteGeometry, animatedRouteProgress)
                : null;

            // Fix: orientation follows the segment under this animation frame,
            // rather than blending headings across a bend before reaching it.
            const animatedSegment = animatedRoadPoint
              ? nearestPointOnPolyline(animatedRoadPoint, navigationRouteGeometry)
              : null;
            const roadHeading = animatedSegment && Number.isFinite(animatedSegment.heading)
              ? normalizeAngle(animatedSegment.heading)
              : null;
            const alignedHeading = roadHeading !== null && typeof endHeading === 'number'
              && Math.abs(shortestAngleDelta(roadHeading, endHeading)) > 90
              ? normalizeAngle(roadHeading + 180)
              : roadHeading;

            return {
              ...targetLoc,
              // In navigation mode interpolate distance along the routed road,
              // never a straight chord between two GPS fixes.
              lat: animatedRoadPoint?.[0] ?? lerp(previous.lat, targetLoc.lat, easedProgress),
              lng: animatedRoadPoint?.[1] ?? lerp(previous.lng, targetLoc.lng, easedProgress),
              routeProgressMeters: animatedRouteProgress,
              markerHeading: alignedHeading ?? (
                typeof startHeading === 'number' && typeof endHeading === 'number'
                  ? lerpAngle(startHeading, endHeading, easedProgress)
                  : endHeading),
            };
          });
          // Keep reroute continuity synchronized with the exact interpolated
          // frame that also drives the grey/active route split.
          smoothedLocationsRef.current = nextLocations;
          return nextLocations;
        });

        if (elapsedMs < totalLoopDurationMs) {
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
  }, [navigationPerspective, navigationRouteGeometry, navigationRouteKey, snappedLocations]);

  const singleTruck = smoothedLocations.filter((loc) => loc.markerType === 'truck');
  const navTruck = singleTruck.length === 1 ? singleTruck[0] : null;
  // The truck's position changes every animation frame, but the grey/blue
  // junction only has to follow it to within a couple of metres. Quantizing the
  // split distance keeps this memo — and therefore the entire route payload
  // handed to the navigation map — stable across most frames, instead of
  // rebuilding every source and layer 60 times a second.
  const navTruckSplitDistance = useMemo(() => {
    if (navigationRouteGeometry.length < 2 || !navTruck) return null;
    const projected = typeof navTruck.routeProgressMeters === 'number'
      ? navTruck.routeProgressMeters
      : projectPointOntoRoute([navTruck.lat, navTruck.lng], navigationRouteGeometry)?.distanceAlongMeters;
    if (typeof projected !== 'number') return null;
    return quantizeRouteSplitMeters(projected);
  }, [navTruck, navigationRouteGeometry]);
  const navigationDisplayRouteLines = useMemo(() => {
    if (navigationRouteGeometry.length < 2 || navTruckSplitDistance === null) return renderedRouteLines;

    // Gray and active route sections are split at the same road position the
    // truck is travelling along, so progress grows continuously with it.
    const split = splitRouteAtDistance(navigationRouteGeometry, navTruckSplitDistance);
    const completedTemplate = renderedRouteLines.find((line) => line.id.endsWith('-route-completed'));
    const upcomingTemplate = renderedRouteLines.find((line) => line.id.endsWith('-route-upcoming'));
    const unrelatedLines = renderedRouteLines.filter(
      (line) => !line.id.endsWith('-route-completed') && !line.id.endsWith('-route-upcoming')
    );
    const completedLine: LiveRouteLine = {
      ...(completedTemplate || upcomingTemplate!),
      id: completedTemplate?.id || `${upcomingTemplate?.id || 'navigation-route'}-completed`,
      points: split.completed,
      color: '#6b7280',
    };
    const upcomingLine: LiveRouteLine = {
      ...(upcomingTemplate || completedTemplate!),
      id: upcomingTemplate?.id || `${completedTemplate?.id || 'navigation-route'}-upcoming`,
      points: split.remaining,
      color: '#2563eb',
    };
    return [
      ...unrelatedLines,
      ...(completedLine.points.length > 1 ? [completedLine] : []),
      ...(upcomingLine.points.length > 1 ? [upcomingLine] : []),
    ];
  }, [navTruckSplitDistance, navigationRouteGeometry, renderedRouteLines]);

  const strictBounds = restrictToNegrosOccidental
    ? serviceBoundary
      ? L.latLngBounds([serviceBoundary.bbox[1], serviceBoundary.bbox[0]], [serviceBoundary.bbox[3], serviceBoundary.bbox[2]])
      : L.latLngBounds(SILAY_TALISAY_FALLBACK_BOUNDS[0], SILAY_TALISAY_FALLBACK_BOUNDS[1])
    : null;
  const activeBounds = useMemo(() => {
    if (!strictBounds) return null;
    // Add map-only panning space so mountain-side and edge territories are easy to explore.
    return expandBounds(strictBounds, 0.05, 0.10);
  }, [strictBounds]);
  const serviceMaskRings = useMemo(
    () => (serviceBoundary?.geometries || []).flatMap((geometry) => geometryToExteriorRings(geometry)),
    [serviceBoundary]
  );
  const resolvedCenter =
    useMemo(() => (
      restrictToNegrosOccidental && Array.isArray(center) && center.length === 2
        ? clampPointToBounds(center, activeBounds)
        : center
    ), [restrictToNegrosOccidental, center, activeBounds]);

  if (navigationPerspective) {
    return (
      <MapLibreNavigationMap
        locations={smoothedLocations}
        center={resolvedCenter}
        zoom={zoom}
        routeLines={navigationDisplayRouteLines}
        is3DPerspective={is3DPerspective}
        recenterSignal={recenterSignal}
        zoomInSignal={zoomInSignal}
        zoomOutSignal={zoomOutSignal}
        navigationViewportInsets={navigationViewportInsets}
        showDriverSelfBadge={showDriverSelfBadge}
        onRouteLineSelect={onRouteLineSelect}
        className={className}
      />
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <MapContainerUnsafe
        center={resolvedCenter}
        zoom={zoom}
        scrollWheelZoom={true}
        inertia={false}
        bounceAtZoomLimits={false}
        className="absolute inset-0 h-full w-full z-0"
        zoomControl={showZoomControls}
        zoomAnimation={false}
        markerZoomAnimation={false}
        preferCanvas
        minZoom={restrictToNegrosOccidental ? 11 : undefined}
        maxZoom={22}
        bounds={activeBounds ?? undefined}
        maxBounds={activeBounds ?? undefined}
        maxBoundsViscosity={restrictToNegrosOccidental ? 0.2 : undefined}
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
          maxNativeZoom={19}
          maxZoom={22}
          noWrap={restrictToNegrosOccidental}
        />
        {restrictToNegrosOccidental && serviceMaskRings.length > 0 ? (
          <PolygonUnsafe
            positions={[WORLD_MASK_RING, ...serviceMaskRings]}
            pane="negros-mask-pane"
            interactive={false}
            pathOptions={{
              stroke: false,
              fillColor: '#7fb3c4',
              fillOpacity: 0.72,
              fillRule: 'evenodd',
              opacity: 1,
            }}
          />
        ) : null}
        {restrictToNegrosOccidental && serviceMaskRings.length > 0
          ? serviceMaskRings.map((ring, index) => (
            <PolygonUnsafe
              key={`service-outline-${index}`}
              positions={ring}
              pane="negros-mask-pane"
              interactive={false}
              pathOptions={{
                color: '#1d4ed8',
                weight: 2,
                fillOpacity: 0,
                opacity: 0.95,
              }}
            />
          ))
          : null}
        {navigationDisplayRouteLines.map((line) =>
          Array.isArray(line.points) && line.points.length > 1 ? (
            <Fragment key={line.id}>
              {(() => {
                const rawColor = String(line.color || '').toLowerCase();
                const isUpcoming = rawColor === '#2563eb' && !line.dashArray;
                const isCompletedLike = Boolean(line.dashArray) || rawColor === '#93c5fd';
                const outerColor = isUpcoming ? '#7ddfff' : '#2f3743';
                const innerColor = isUpcoming ? '#2ecbff' : '#4b5563';
                const outerOpacity = isUpcoming ? 0.42 : 0.32;
                const innerOpacity = typeof line.opacity === 'number' ? line.opacity : isUpcoming ? 0.99 : 0.93;
                const zoomScale = currentZoom <= 10 ? 0.58 : currentZoom <= 11 ? 0.68 : currentZoom <= 12 ? 0.8 : currentZoom <= 13 ? 0.9 : currentZoom <= 14 ? 0.96 : 1;
                const baseInnerWeight = isUpcoming ? 7.2 : 6.8;
                const baseOuterWeight = isUpcoming ? 9.4 : 8.8;
                const outerWeight = Math.max(5.9, Math.round(baseOuterWeight * zoomScale * 10) / 10);
                const innerWeight = Math.max(4.8, Math.round(baseInnerWeight * zoomScale * 10) / 10);
                const centerWeight = Math.max(1.6, Math.round((isUpcoming ? 1.9 : 1.75) * zoomScale * 10) / 10);
                const centerDash = isCompletedLike ? '1 12' : '2 10';
                const centerOffset = isCompletedLike ? '0.5' : '0';

                return (
                  <>
                    <PolylineUnsafe
                      key={`${line.id}-outer`}
                      positions={line.points}
                      pathOptions={{
                        color: outerColor,
                        weight: outerWeight,
                        opacity: outerOpacity,
                        lineCap: 'round',
                        lineJoin: 'round',
                      }}
                    />
                    <PolylineUnsafe
                      key={`${line.id}-base`}
                      positions={line.points}
                      pathOptions={{
                        color: innerColor,
                        weight: innerWeight,
                        opacity: innerOpacity,
                        lineCap: 'round',
                        lineJoin: 'round',
                      }}
                    >
                      {line.label ? <Popup>{line.label}</Popup> : null}
                    </PolylineUnsafe>
                    <PolylineUnsafe
                      key={`${line.id}-center`}
                      positions={line.points}
                      pathOptions={{
                        color: '#f8fafc',
                        weight: centerWeight,
                        opacity: isUpcoming ? 0.55 : 0.9,
                        dashArray: centerDash,
                        dashOffset: centerOffset,
                        lineCap: 'round',
                        lineJoin: 'round',
                      }}
                    />
                  </>
                );
              })()}
            </Fragment>
          ) : null
        )}

        {routeOriginPoint ? (
          <CircleMarkerUnsafe
            center={routeOriginPoint}
            radius={7}
            pathOptions={{ color: '#111827', fillColor: '#9ca3af', fillOpacity: 0.95 }}
          />
        ) : null}

        {smoothedLocations.map((loc) =>
          loc.markerType === 'pin' ? (
            (() => {
              const normalizedStatus = String(loc.status || '').toUpperCase();
              const markerColor = String(loc.markerColor || '').toLowerCase();
              const pinColor: 'green' | 'blue' | 'red' | 'orange' =
                markerColor === '#ef4444'
                  ? 'red'
                  : markerColor === '#f59e0b'
                    ? 'orange'
                    : (
                      loc.markerEtaPhase === 'completed' ||
                      normalizedStatus === 'COMPLETED' ||
                      normalizedStatus === 'DELIVERED'
                    )
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
                    <div className="text-sm" style={{ minWidth: 180, maxWidth: 260 }}>
                      <p className="font-bold text-base mb-1">{loc.popupCustomerName || loc.driverName}</p>
                      <p className="text-gray-600">{loc.popupAddress || loc.markerLabel || `Vehicle: ${loc.vehiclePlate}`}</p>
                      <p className="text-gray-600">
                        Status: <span className="capitalize">{loc.status.replace(/_/g, ' ').toLowerCase()}</span>
                      </p>
                      {Array.isArray(loc.popupOrderItems) && loc.popupOrderItems.length > 0 ? (
                        <div style={{ marginTop: 8, borderTop: '1px solid #e5e7eb', paddingTop: 6 }}>
                          <p style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Ordered Items</p>
                          {loc.popupOrderItems.slice(0, 8).map((item, idx) => (
                            <p key={idx} style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4, margin: 0 }}>{item.name} — {item.qty}</p>
                          ))}
                          {loc.popupOrderItems.length > 8 ? (
                            <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>+{loc.popupOrderItems.length - 8} more item(s)</p>
                          ) : null}
                        </div>
                      ) : null}
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
                  <div className="text-sm" style={{ minWidth: 220 }}>
                    {/* Added: expose the active assignment details without changing map behavior. */}
                    <p className="font-bold text-base mb-1">Driver: {loc.driverName}</p>
                    <p className="text-gray-600">Plate Number: {loc.vehiclePlate || 'N/A'}</p>
                    <p className="text-gray-600">Assigned Trip #: {loc.assignedTripNumber || 'N/A'}</p>
                    <p className="text-gray-600">Destination Customer: {loc.destinationCustomer || 'N/A'}</p>
                    {loc.markerLabel ? <p className="text-gray-600">{loc.markerLabel}</p> : null}
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
