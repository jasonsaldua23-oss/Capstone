'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface AddressMapPickerProps {
  latitude: number | null
  longitude: number | null
  onChange: (latitude: number, longitude: number) => void
}

const NEGROS_OCCIDENTAL_MUNICIPAL_BOUNDARY_GEOJSON_URL = '/geo/negros-occidental-municipal-maritime.json?v=1'
const SILAY_TALISAY_FALLBACK_BOUNDS: [[number, number], [number, number]] = [
  [10.62, 122.86],
  [10.94, 123.08],
]
const SILAY_TALISAY_FALLBACK_CENTER: [number, number] = [10.78, 122.97]
const MapContainerUnsafe = MapContainer as any
const TileLayerUnsafe = TileLayer as any
const MarkerUnsafe = Marker as any

type PolygonGeometry = {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: number[][][] | number[][][][]
}

function geometryToExteriorRings(geometry: PolygonGeometry | null) {
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

function isPointInGeometries(point: [number, number], geometries: PolygonGeometry[]) {
  return geometries.some((geometry) =>
    geometryToExteriorRings(geometry).some((ring) => ring.length > 2 && pointInRing(point, ring))
  )
}

function featureName(feature: any) {
  const props = feature?.properties || {}
  const value = props.name || props.NAME_2 || props.display_name || ''
  return String(value).toLowerCase()
}

function computeBounds(geometries: PolygonGeometry[]): [[number, number], [number, number]] | null {
  let minLat = Infinity
  let minLng = Infinity
  let maxLat = -Infinity
  let maxLng = -Infinity
  for (const geometry of geometries) {
    const rings = geometryToExteriorRings(geometry)
    for (const ring of rings) {
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

function expandBounds(
  bounds: [[number, number], [number, number]],
  latPad: number,
  lngPad: number
): [[number, number], [number, number]] {
  return [
    [bounds[0][0] - latPad, bounds[0][1] - lngPad],
    [bounds[1][0] + latPad, bounds[1][1] + lngPad],
  ]
}

const PickerPinIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

function MapClickHandler({
  onChange,
  isAllowed,
}: {
  onChange: (latitude: number, longitude: number) => void
  isAllowed: (latitude: number, longitude: number) => boolean
}) {
  useMapEvents({
    click(event) {
      if (isAllowed(event.latlng.lat, event.latlng.lng)) {
        onChange(event.latlng.lat, event.latlng.lng)
      }
    },
  })

  return null
}

function RecenterMap({
  latitude,
  longitude,
  hasPin,
  fallbackCenter,
}: {
  latitude: number | null
  longitude: number | null
  hasPin: boolean
  fallbackCenter: [number, number]
}) {
  const map = useMap()
  const lastKeyRef = useRef<string>('')

  useEffect(() => {
    const nextKey = hasPin && typeof latitude === 'number' && typeof longitude === 'number'
      ? `pin:${latitude.toFixed(6)},${longitude.toFixed(6)}`
      : `fallback:${fallbackCenter[0].toFixed(6)},${fallbackCenter[1].toFixed(6)}`
    if (lastKeyRef.current === nextKey) return
    lastKeyRef.current = nextKey

    if (hasPin && typeof latitude === 'number' && typeof longitude === 'number') {
      map.setView([latitude, longitude], Math.max(map.getZoom(), 15))
      return
    }
    map.setView(fallbackCenter, Math.max(map.getZoom(), 10))
  }, [latitude, longitude, hasPin, fallbackCenter, map])

  return null
}

function MapAutoResizeFix() {
  const map = useMap()

  useEffect(() => {
    const refresh = () => map.invalidateSize({ pan: false, animate: false })
    const timer = window.setTimeout(refresh, 0)
    const timer2 = window.setTimeout(refresh, 140)

    const container = map.getContainer()
    const observer = new ResizeObserver(() => refresh())
    observer.observe(container)

    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(timer2)
      observer.disconnect()
    }
  }, [map])

  return null
}

export function AddressMapPicker({ latitude, longitude, onChange }: AddressMapPickerProps) {
  const [serviceGeometries, setServiceGeometries] = useState<PolygonGeometry[]>([])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const response = await fetch(NEGROS_OCCIDENTAL_MUNICIPAL_BOUNDARY_GEOJSON_URL)
        if (!response.ok) return
        const payload = await response.json().catch(() => ({}))
        const features = Array.isArray(payload?.features) ? payload.features : []
        const geometries = features
          .filter((feature: any) => {
            const name = featureName(feature)
            return name.includes('silay') || name.includes('talisay')
          })
          .map((feature: any) => feature?.geometry as PolygonGeometry)
          .filter((geometry: any) => geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon'))
        if (!cancelled) setServiceGeometries(geometries)
      } catch {
        // keep fallback box-only behavior
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const dynamicBounds = useMemo(
    () => computeBounds(serviceGeometries) || SILAY_TALISAY_FALLBACK_BOUNDS,
    [serviceGeometries]
  )
  const mapDragBounds = useMemo(
    // Wider map-only padding so east/mountain territories of Silay/Talisay stay draggable.
    () => expandBounds(dynamicBounds, 0.05, 0.18),
    [dynamicBounds]
  )
  const dynamicCenter = useMemo<[number, number]>(
    () => [
      (dynamicBounds[0][0] + dynamicBounds[1][0]) / 2,
      (dynamicBounds[0][1] + dynamicBounds[1][1]) / 2,
    ],
    [dynamicBounds]
  )
  const isAllowed = (lat: number, lng: number) =>
    serviceGeometries.length > 0
      ? isPointInGeometries([lat, lng], serviceGeometries)
      : lat >= SILAY_TALISAY_FALLBACK_BOUNDS[0][0] &&
        lat <= SILAY_TALISAY_FALLBACK_BOUNDS[1][0] &&
        lng >= SILAY_TALISAY_FALLBACK_BOUNDS[0][1] &&
        lng <= SILAY_TALISAY_FALLBACK_BOUNDS[1][1]

  const hasPin =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    isAllowed(latitude, longitude)
  const center: [number, number] = hasPin ? [latitude as number, longitude as number] : dynamicCenter

  return (
    <div className="portal-map-picker space-y-2">
      <div className="relative h-64 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        <MapContainerUnsafe
          center={center}
          zoom={hasPin ? 15 : 10}
          minZoom={11}
          maxZoom={22}
          maxBounds={mapDragBounds}
          maxBoundsViscosity={0.1}
          className="absolute inset-0 z-0 h-full w-full"
        >
          <TileLayerUnsafe
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxNativeZoom={19}
            maxZoom={22}
          />
          <MapClickHandler onChange={onChange} isAllowed={isAllowed} />
          <MapAutoResizeFix />
          <RecenterMap latitude={latitude} longitude={longitude} hasPin={hasPin} fallbackCenter={dynamicCenter} />
          {hasPin && <MarkerUnsafe position={[latitude as number, longitude as number]} icon={PickerPinIcon} />}
        </MapContainerUnsafe>
      </div>
      <p className="text-xs text-slate-500">Click on the map to pin your location within Silay or Talisay.</p>
      <style jsx global>{`
        .portal-map-picker .leaflet-control-zoom {
          border: 1px solid #d1fae5;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 6px 20px rgba(2, 132, 199, 0.08);
        }
        .portal-map-picker .leaflet-control-zoom a {
          width: 34px;
          height: 34px;
          line-height: 34px;
          color: #0f172a;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
        }
        .portal-map-picker .leaflet-control-zoom a:hover {
          background: #ecfdf5;
          color: #047857;
        }
        .portal-map-picker .leaflet-control-attribution {
          background: rgba(255, 255, 255, 0.9);
          color: #64748b;
          border-top-left-radius: 10px;
          padding: 2px 8px;
        }
        .portal-map-picker .leaflet-popup-content-wrapper {
          border: 1px solid #d1fae5;
          border-radius: 14px;
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.14);
          color: #0f172a;
        }
        .portal-map-picker .leaflet-popup-tip {
          background: #ffffff;
          border: 1px solid #d1fae5;
          box-shadow: none;
        }
      `}</style>
    </div>
  )
}
