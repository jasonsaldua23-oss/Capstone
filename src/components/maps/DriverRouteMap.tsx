'use client'

import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/utils'

const MapContainerUnsafe = MapContainer as any
const TileLayerUnsafe = TileLayer as any
const CircleMarkerUnsafe = CircleMarker as any
const MarkerUnsafe = Marker as any
const PolygonUnsafe = Polygon as any
const PolylineUnsafe = Polyline as any

const NEGROS_ISLAND_GEOJSON_URL =
  'https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&limit=1&q=Negros%20Island%20Philippines'
const NEGROS_ISLAND_FALLBACK_BOUNDS = L.latLngBounds([9.0380812, 122.3758966], [11.002995, 123.5688567])
const WORLD_MASK_RING: [number, number][] = [
  [-90, -180],
  [-90, 180],
  [90, 180],
  [90, -180],
]

type NegrosIslandGeometry = {
  type: 'Polygon' | 'MultiPolygon'
  coordinates: number[][][] | number[][][][]
}

type NegrosIslandBoundary = {
  geometry: NegrosIslandGeometry
  bbox: [number, number, number, number]
}

const truckMarkerIcon = L.divIcon({
  className: 'driver-truck-marker',
  html: '<div style="width:58px;height:58px;display:flex;align-items:center;justify-content:center;overflow:visible;"><img src="/icons/driver-location-cropped.png" alt="truck" style="width:58px;height:58px;display:block;image-rendering:auto;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.35)) drop-shadow(0 4px 6px rgba(0,0,0,0.4)) contrast(1.08) saturate(1.08);" onerror="this.onerror=null;this.src=\'/icons/delivery-truck.png\';" /></div>',
  iconSize: [58, 58],
  iconAnchor: [29, 29],
})

function getDestinationMarkerIcon(color: 'green' | 'blue') {
  return L.divIcon({
    className: `driver-destination-marker-${color}`,
    html: `
      <div style="position:relative;width:28px;height:44px;display:flex;align-items:flex-start;justify-content:center;">
        <img
          src="${
            color === 'green'
              ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png'
              : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png'
          }"
          alt="destination pin"
          style="width:25px;height:41px;display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.25));"
          onerror="this.onerror=null;this.src='https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';"
        />
      </div>
    `,
    iconSize: [28, 44],
    iconAnchor: [14, 44],
  })
}

interface RoutePoint {
  latitude: number
  longitude: number
}

interface DriverRouteMapProps {
  latitude: number
  longitude: number
  routePoints?: RoutePoint[]
  destinationLatitude?: number | null
  destinationLongitude?: number | null
  warehouseLatitude?: number | null
  warehouseLongitude?: number | null
  destinationCompleted?: boolean
  className?: string
}

function toLatLngRing(ring: number[][]): [number, number][] {
  return ring
    .map((coord) => [Number(coord?.[1]), Number(coord?.[0])] as [number, number])
    .filter((coord) => Number.isFinite(coord[0]) && Number.isFinite(coord[1]))
}

function geometryToExteriorRings(geometry: NegrosIslandGeometry | null): [number, number][][] {
  if (!geometry) return []
  if (geometry.type === 'Polygon') {
    const polygon = geometry.coordinates as number[][][]
    return polygon.length > 0 ? [toLatLngRing(polygon[0])] : []
  }
  if (geometry.type === 'MultiPolygon') {
    const multipolygon = geometry.coordinates as number[][][][]
    return multipolygon.map((polygon) => toLatLngRing(polygon[0])).filter((ring) => ring.length > 0)
  }
  return []
}

function MapBoundsGuard({ enabled, bounds }: { enabled: boolean; bounds: L.LatLngBounds | null }) {
  const map = useMap()

  useEffect(() => {
    if (!enabled || !bounds) return
    if (!bounds.contains(map.getCenter())) {
      map.flyTo(bounds.getCenter(), Math.max(map.getZoom(), 10), { duration: 0.25 })
    }
  }, [enabled, bounds, map])

  return null
}

function NegrosMaskPane() {
  const map = useMap()

  useEffect(() => {
    const paneName = 'negros-mask-pane'
    if (!map.getPane(paneName)) {
      const pane = map.createPane(paneName)
      pane.style.zIndex = '650'
      pane.style.pointerEvents = 'none'
    }
  }, [map])

  return null
}

function findNearestPolylineIndex(
  target: { lat: number; lng: number },
  points: [number, number][]
) {
  if (!Array.isArray(points) || points.length === 0) return 0
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const latDiff = point[0] - target.lat
    const lngDiff = point[1] - target.lng
    const distance2 = latDiff * latDiff + lngDiff * lngDiff
    if (distance2 < bestDistance) {
      bestDistance = distance2
      bestIndex = index
    }
  }
  return bestIndex
}

export function DriverRouteMap({
  latitude,
  longitude,
  routePoints = [],
  destinationLatitude = null,
  destinationLongitude = null,
  warehouseLatitude = null,
  warehouseLongitude = null,
  destinationCompleted = false,
  className,
}: DriverRouteMapProps) {
  const [fullRoadRoute, setFullRoadRoute] = useState<{ key: string; points: [number, number][] }>({ key: '', points: [] })
  const [negrosIslandBoundary, setNegrosIslandBoundary] = useState<NegrosIslandBoundary | null>(null)

  const hasDestination = Number.isFinite(destinationLatitude as number) && Number.isFinite(destinationLongitude as number)
  const hasWarehouse = Number.isFinite(warehouseLatitude as number) && Number.isFinite(warehouseLongitude as number)

  const destinationColor: 'green' | 'blue' = destinationCompleted ? 'blue' : 'green'
  const destinationMarkerIcon = useMemo(() => getDestinationMarkerIcon(destinationColor), [destinationColor])
  const negrosIslandBounds = useMemo(
    () =>
      negrosIslandBoundary
        ? L.latLngBounds(
            [negrosIslandBoundary.bbox[1], negrosIslandBoundary.bbox[0]],
            [negrosIslandBoundary.bbox[3], negrosIslandBoundary.bbox[2]]
          )
        : null,
    [negrosIslandBoundary]
  )
  const negrosIslandMaskRings = useMemo(
    () => geometryToExteriorRings(negrosIslandBoundary?.geometry || null),
    [negrosIslandBoundary]
  )

  const routeWaypoints = useMemo(() => {
    const points: Array<{ lat: number; lng: number }> = []
    if (hasWarehouse) {
      points.push({ lat: Number(warehouseLatitude), lng: Number(warehouseLongitude) })
    }
    points.push({ lat: Number(latitude), lng: Number(longitude) })
    if (hasDestination) {
      points.push({ lat: Number(destinationLatitude), lng: Number(destinationLongitude) })
    }
    return points
  }, [hasWarehouse, warehouseLatitude, warehouseLongitude, latitude, longitude, hasDestination, destinationLatitude, destinationLongitude])

  const routeWaypointsKey = useMemo(
    () => routeWaypoints.map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`).join('|'),
    [routeWaypoints]
  )

  useEffect(() => {
    let cancelled = false

    const uniqueWaypoints = routeWaypoints.filter((point, index, list) => {
      if (index === 0) return true
      const prev = list[index - 1]
      return !(Math.abs(point.lat - prev.lat) < 0.000001 && Math.abs(point.lng - prev.lng) < 0.000001)
    })

    if (uniqueWaypoints.length < 2) {
      return () => {
        cancelled = true
      }
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12000)

    const run = async () => {
      try {
        const coordinates = uniqueWaypoints
          .map((point) => `${encodeURIComponent(String(point.lng))},${encodeURIComponent(String(point.lat))}`)
          .join(';')

        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
          { signal: controller.signal }
        )
        const payload = await response.json().catch(() => ({}))
        const coords = payload?.routes?.[0]?.geometry?.coordinates

        if (!response.ok || !Array.isArray(coords) || coords.length < 2) {
          return
        }

        const points = coords
          .map((pair: any) => [Number(pair?.[1]), Number(pair?.[0])] as [number, number])
          .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]))

        if (!cancelled) {
          setFullRoadRoute({ key: routeWaypointsKey, points: points.length > 1 ? points : [] })
        }
      } catch {
        // Keep fallback path if route request fails.
      }
    }

    void run()

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [routeWaypointsKey, routeWaypoints])

  useEffect(() => {
    const controller = new AbortController()

    const fetchBoundary = async () => {
      try {
        const response = await fetch(NEGROS_ISLAND_GEOJSON_URL, { signal: controller.signal })
        const payload = await response.json().catch(() => null)
        const feature = payload?.features?.[0]
        const geometry = feature?.geometry
        const bbox = feature?.bbox

        if (
          geometry &&
          (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') &&
          Array.isArray(bbox) &&
          bbox.length >= 4
        ) {
          setNegrosIslandBoundary({
            geometry: geometry as NegrosIslandGeometry,
            bbox: [Number(bbox[0]), Number(bbox[1]), Number(bbox[2]), Number(bbox[3])],
          })
        }
      } catch {
        // Best effort only for map masking.
      }
    }

    void fetchBoundary()
    return () => controller.abort()
  }, [])

  const historyPoints = routePoints
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
    .map((point) => [Number(point.latitude), Number(point.longitude)] as [number, number])

  const completedFallbackPoints = (() => {
    const currentPoint: [number, number] = [Number(latitude), Number(longitude)]
    if (hasWarehouse) {
      return [[Number(warehouseLatitude), Number(warehouseLongitude)] as [number, number], currentPoint]
    }
    if (historyPoints.length > 0) {
      const points = [...historyPoints]
      const last = points[points.length - 1]
      if (!last || Math.abs(last[0] - currentPoint[0]) > 1e-6 || Math.abs(last[1] - currentPoint[1]) > 1e-6) {
        points.push(currentPoint)
      }
      return points
    }
    return [] as [number, number][]
  })()

  const upcomingFallbackPoints = hasDestination
    ? [[Number(latitude), Number(longitude)] as [number, number], [Number(destinationLatitude), Number(destinationLongitude)] as [number, number]]
    : []

  const activeRoadRoutePoints =
    fullRoadRoute.key === routeWaypointsKey && fullRoadRoute.points.length > 1 ? fullRoadRoute.points : []

  const roadSplitIndex = (() => {
    if (activeRoadRoutePoints.length < 2) return null
    return findNearestPolylineIndex({ lat: Number(latitude), lng: Number(longitude) }, activeRoadRoutePoints)
  })()

  const completedRoutePoints =
    activeRoadRoutePoints.length > 1 && roadSplitIndex !== null
      ? roadSplitIndex > 0
        ? activeRoadRoutePoints.slice(0, roadSplitIndex + 1)
        : []
      : completedFallbackPoints

  const upcomingRoutePoints =
    activeRoadRoutePoints.length > 1 && roadSplitIndex !== null
      ? activeRoadRoutePoints.slice(Math.max(0, roadSplitIndex))
      : upcomingFallbackPoints

  return (
    <div className={cn('h-44 w-full overflow-hidden rounded-md border', className)}>
      <MapContainerUnsafe
        center={[latitude, longitude]}
        zoom={14}
        className="h-full w-full z-0"
        scrollWheelZoom={false}
        minZoom={10}
        bounds={negrosIslandBounds ?? NEGROS_ISLAND_FALLBACK_BOUNDS}
        maxBounds={negrosIslandBounds ?? NEGROS_ISLAND_FALLBACK_BOUNDS}
        maxBoundsViscosity={1.0}
      >
        <NegrosMaskPane />
        <MapBoundsGuard enabled bounds={negrosIslandBounds} />
        <TileLayerUnsafe
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          noWrap
        />
        {negrosIslandBoundary ? (
          <PolygonUnsafe
            positions={[WORLD_MASK_RING, ...negrosIslandMaskRings]}
            pane="negros-mask-pane"
            interactive={false}
            pathOptions={{
              stroke: false,
              fillColor: '#aad3df',
              fillOpacity: 1,
              opacity: 1,
            }}
          />
        ) : null}

        {completedRoutePoints.length > 1 ? (
          <PolylineUnsafe positions={completedRoutePoints} pathOptions={{ color: '#6b7280', weight: 5, opacity: 0.95 }} />
        ) : null}

        {upcomingRoutePoints.length > 1 ? (
          <>
            <PolylineUnsafe positions={upcomingRoutePoints} pathOptions={{ color: '#2563eb', weight: 8, opacity: 1 }} />
            <PolylineUnsafe
              positions={upcomingRoutePoints}
              pathOptions={{ color: '#ffffff', weight: 3, opacity: 0.8, dashArray: '4 3' }}
            />
          </>
        ) : null}

        {hasDestination ? (
          <MarkerUnsafe position={[destinationLatitude as number, destinationLongitude as number]} icon={destinationMarkerIcon} />
        ) : null}

        {hasWarehouse ? (
          <CircleMarkerUnsafe
            center={[warehouseLatitude as number, warehouseLongitude as number]}
            radius={7}
            pathOptions={{ color: '#111827', fillColor: '#9ca3af', fillOpacity: 0.95 }}
          />
        ) : null}

        <MarkerUnsafe position={[latitude, longitude]} icon={truckMarkerIcon} />
      </MapContainerUnsafe>
    </div>
  )
}
