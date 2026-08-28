'use client'

import { useEffect, useMemo, useState } from 'react'

export const SERVICE_AREA_GEOJSON_URL = '/geo/negros-occidental-municipal-maritime.json?v=1'

// Coarse box around Silay/Talisay, used to frame the map and as the fallback check
// when the municipal boundaries cannot be loaded.
export const SERVICE_AREA_BOUNDS: [[number, number], [number, number]] = [
  [10.62, 122.86],
  [10.94, 123.08],
]

export const SERVICE_AREA_MESSAGE =
  'We only deliver within Silay and Talisay. Please pick a location inside those areas.'

export type PolygonGeometry = {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: number[][][] | number[][][][]
}

export function geometryToExteriorRings(geometry: PolygonGeometry | null) {
  if (!geometry) return [] as [number, number][][]
  const sanitizeRing = (ring: number[][]) =>
    ring
      .map((pair) => [Number(pair?.[1]), Number(pair?.[0])] as [number, number])
      .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))

  if (geometry.type === 'Polygon') {
    const outerRing = (geometry.coordinates[0] || []) as number[][]
    const sanitized = sanitizeRing(outerRing)
    return sanitized.length > 2 ? [sanitized] : []
  }

  return (geometry.coordinates as number[][][][])
    .map((polygon) => polygon[0] || [])
    .map((ring) => sanitizeRing(ring as number[][]))
    .filter((ring) => ring.length > 2)
}

function pointInRing(point: [number, number], ring: [number, number][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]
    const b = ring[j]
    const intersects =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1] || Number.EPSILON) + a[0]
    if (intersects) inside = !inside
  }
  return inside
}

export function isPointInGeometries(point: [number, number], geometries: PolygonGeometry[]) {
  return geometries.some((geometry) =>
    geometryToExteriorRings(geometry).some((ring) => ring.length > 2 && pointInRing(point, ring))
  )
}

export function isWithinServiceAreaBounds(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= SERVICE_AREA_BOUNDS[0][0] &&
    lat <= SERVICE_AREA_BOUNDS[1][0] &&
    lng >= SERVICE_AREA_BOUNDS[0][1] &&
    lng <= SERVICE_AREA_BOUNDS[1][1]
  )
}

// Exact check when the municipal boundaries are available; the coarse box otherwise, so
// a failed boundary fetch degrades to the previous behaviour instead of rejecting everyone.
export function isWithinServiceArea(lat: number, lng: number, geometries: PolygonGeometry[]) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (geometries.length > 0) return isPointInGeometries([lat, lng], geometries)
  return isWithinServiceAreaBounds(lat, lng)
}

export function computeBounds(geometries: PolygonGeometry[]): [[number, number], [number, number]] | null {
  let minLat = Infinity
  let minLng = Infinity
  let maxLat = -Infinity
  let maxLng = -Infinity
  for (const geometry of geometries) {
    for (const ring of geometryToExteriorRings(geometry)) {
      for (const point of ring) {
        minLat = Math.min(minLat, point[0])
        minLng = Math.min(minLng, point[1])
        maxLat = Math.max(maxLat, point[0])
        maxLng = Math.max(maxLng, point[1])
      }
    }
  }
  if (![minLat, minLng, maxLat, maxLng].every(Number.isFinite)) return null
  return [[minLat, minLng], [maxLat, maxLng]]
}

export function expandBounds(
  bounds: [[number, number], [number, number]],
  latPad: number,
  lngPad: number
): [[number, number], [number, number]] {
  return [
    [bounds[0][0] - latPad, bounds[0][1] - lngPad],
    [bounds[1][0] + latPad, bounds[1][1] + lngPad],
  ]
}

function featureName(feature: any) {
  const props = feature?.properties || {}
  const value = props.name || props.NAME_2 || props.display_name || ''
  return String(value).toLowerCase()
}

// One fetch per page load, shared by every component that needs the boundaries.
let serviceAreaGeometriesPromise: Promise<PolygonGeometry[]> | null = null

export function loadServiceAreaGeometries(): Promise<PolygonGeometry[]> {
  if (!serviceAreaGeometriesPromise) {
    serviceAreaGeometriesPromise = (async () => {
      try {
        const response = await fetch(SERVICE_AREA_GEOJSON_URL)
        if (!response.ok) return []
        const payload = await response.json().catch(() => ({}))
        const features = Array.isArray(payload?.features) ? payload.features : []
        return features
          .filter((feature: any) => {
            const name = featureName(feature)
            return name.includes('silay') || name.includes('talisay')
          })
          .map((feature: any) => feature?.geometry as PolygonGeometry)
          .filter(
            (geometry: any) =>
              geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')
          )
      } catch {
        // Fall back to the coarse box check.
        return []
      }
    })()
  }
  return serviceAreaGeometriesPromise
}

export function useServiceArea() {
  const [geometries, setGeometries] = useState<PolygonGeometry[]>([])

  useEffect(() => {
    let cancelled = false
    void loadServiceAreaGeometries().then((loaded) => {
      if (!cancelled) setGeometries(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const bounds = useMemo(() => computeBounds(geometries) || SERVICE_AREA_BOUNDS, [geometries])

  const center = useMemo<[number, number]>(
    () => [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2],
    [bounds]
  )

  const isInServiceArea = useMemo(
    () => (lat: number, lng: number) => isWithinServiceArea(lat, lng, geometries),
    [geometries]
  )

  return { geometries, bounds, center, isInServiceArea }
}
