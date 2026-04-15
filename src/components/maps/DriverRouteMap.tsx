'use client'

import { CircleMarker, MapContainer, Polyline, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/utils'

const MapContainerUnsafe = MapContainer as any
const TileLayerUnsafe = TileLayer as any
const CircleMarkerUnsafe = CircleMarker as any
const PolylineUnsafe = Polyline as any

interface RoutePoint {
  latitude: number
  longitude: number
}

interface DriverRouteMapProps {
  latitude: number
  longitude: number
  routePoints?: RoutePoint[]
  className?: string
}

export function DriverRouteMap({ latitude, longitude, routePoints = [], className }: DriverRouteMapProps) {
  const validRoute = routePoints.filter(
    (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
  )
  const path = validRoute.map((point) => [point.latitude, point.longitude])

  return (
    <div className={cn('h-44 w-full overflow-hidden rounded-md border', className)}>
      <MapContainerUnsafe center={[latitude, longitude]} zoom={14} className="h-full w-full z-0" scrollWheelZoom={false}>
        <TileLayerUnsafe
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {path.length > 1 ? (
          <PolylineUnsafe positions={path} pathOptions={{ color: '#0e7490', weight: 4, opacity: 0.85 }} />
        ) : null}
        {path.length > 0 ? (
          <CircleMarkerUnsafe
            center={path[0]}
            radius={6}
            pathOptions={{ color: '#0369a1', fillColor: '#38bdf8', fillOpacity: 0.95 }}
          />
        ) : null}
        <CircleMarkerUnsafe
          center={[latitude, longitude]}
          radius={8}
          pathOptions={{ color: '#0f766e', fillColor: '#14b8a6', fillOpacity: 0.95 }}
        />
      </MapContainerUnsafe>
    </div>
  )
}
