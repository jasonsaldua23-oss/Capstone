"use client";

import { Polygon } from 'react-leaflet';
import L from 'leaflet';

const NEGROS_OCCIDENTAL_LOCAL_BOUNDARY_GEOJSON_URL = '/geo/negros-occidental-maritime-with-bacolod.json?v=3';

const NEGROS_ISLAND_REGION_BOUNDARY_GEOJSON_URL = '/geo/negros-island-region-boundary.json?v=2';

const NEGROS_ORIENTAL_BOUNDARY_GEOJSON_URL = '/geo/negros-oriental-boundary.json?v=1';

const NEGROS_OCCIDENTAL_MUNICIPAL_BOUNDARY_GEOJSON_URL = '/geo/negros-occidental-municipal-maritime.json?v=1';

export const SILAY_TALISAY_FALLBACK_BOUNDS: [[number, number], [number, number]] = [
  [10.62, 122.86],
  [10.94, 123.08],
];

type NegrosIslandGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
};

export type NegrosBoundary = {
  maskGeometries?: NegrosIslandGeometry[];
  geometries: NegrosIslandGeometry[];
  bbox: [number, number, number, number];
};

export type ServiceBoundary = {
  geometries: NegrosIslandGeometry[];
  bbox: [number, number, number, number];
};

let negrosBoundaryCache: NegrosBoundary | null = null;

let negrosBoundaryPromise: Promise<NegrosBoundary | null> | null = null;

let serviceBoundaryCache: ServiceBoundary | null = null;

let serviceBoundaryPromise: Promise<ServiceBoundary | null> | null = null;

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

export function loadNegrosBoundary() {
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

export function loadSilayTalisayServiceBoundary() {
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

const NEGROS_ISLAND_FALLBACK_BOUNDS = L.latLngBounds([9.0380812, 122.3758966], [11.002995, 123.5688567]);

export const WORLD_MASK_RING: [number, number][] = [
  [-90, -180],
  [-90, 180],
  [90, 180],
  [90, -180],
];

export function geometryToExteriorRings(geometry: NegrosIslandGeometry | null) {
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

export function isPointInNegrosBoundary(point: [number, number], geometries: NegrosIslandGeometry[]) {
  return geometries.some((geometry) => {
    const exteriorRings = geometryToExteriorRings(geometry);
    return exteriorRings.some((ring) => ring.length > 2 && pointInRing(point, ring));
  });
}
