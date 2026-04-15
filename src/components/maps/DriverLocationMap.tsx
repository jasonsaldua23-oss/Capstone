'use client'

import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/utils'
const MapContainerUnsafe = MapContainer as any
const TileLayerUnsafe = TileLayer as any
const CircleMarkerUnsafe = CircleMarker as any

interface DriverLocationMapProps {
  latitude: number
  longitude: number
  className?: string
}

export function DriverLocationMap({ latitude, longitude, className }: DriverLocationMapProps) {
  return (
    <div className={cn("h-44 w-full overflow-hidden rounded-md border", className)}>
      <MapContainerUnsafe center={[latitude, longitude]} zoom={14} className="h-full w-full z-0" scrollWheelZoom={false}>
        <TileLayerUnsafe
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <CircleMarkerUnsafe
          center={[latitude, longitude]}
          radius={8}
          pathOptions={{ color: '#0891b2', fillColor: '#06b6d4', fillOpacity: 0.9 }}
        />
      </MapContainerUnsafe>
    </div>
  )
}
