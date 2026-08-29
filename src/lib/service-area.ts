'use client'

import { useEffect, useMemo, useState } from 'react'

export const SERVICE_AREA_GEOJSON_URL = '/geo/negros-occidental-municipal-maritime.json?v=1'

// Coarse box around Silay/Talisay, used to frame the map and as the fallback check
// when the municipal boundaries cannot be loaded.
// Geometry, bounds and wording moved to shared/customer-logic so the Expo customer
// app enforces the same service area. Only the browser fetch and hook stay here.
export {
  SERVICE_AREA_BOUNDS,
  SERVICE_AREA_MESSAGE,
  geometryToExteriorRings,
  isPointInGeometries,
  isWithinServiceAreaBounds,
  isWithinServiceArea,
  computeBounds,
  expandBounds,
  extractServiceAreaGeometries,
  composeShippingAddress,
} from '@shared/customer-logic/service-area'
export type { PolygonGeometry } from '@shared/customer-logic/service-area'

import {
  SERVICE_AREA_BOUNDS,
  computeBounds,
  extractServiceAreaGeometries,
  isWithinServiceArea,
  type PolygonGeometry,
} from '@shared/customer-logic/service-area'

// One fetch per page load, shared by every component that needs the boundaries.
let serviceAreaGeometriesPromise: Promise<PolygonGeometry[]> | null = null

export function loadServiceAreaGeometries(): Promise<PolygonGeometry[]> {
  if (!serviceAreaGeometriesPromise) {
    serviceAreaGeometriesPromise = (async () => {
      try {
        const response = await fetch(SERVICE_AREA_GEOJSON_URL)
        if (!response.ok) return []
        const payload = await response.json().catch(() => ({}))
        return extractServiceAreaGeometries(payload)
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
