'use client'

import { useEffect } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface AddressMapPickerProps {
  latitude: number | null
  longitude: number | null
  onChange: (latitude: number, longitude: number) => void
}

const NEGROS_OCCIDENTAL_BOUNDS: [[number, number], [number, number]] = [
  [9.18, 122.22],
  [11.05, 123.35],
]
const NEGROS_OCCIDENTAL_CENTER: [number, number] = [10.55, 122.95]
const MapContainerUnsafe = MapContainer as any
const TileLayerUnsafe = TileLayer as any
const CircleMarkerUnsafe = CircleMarker as any

const isWithinNegrosOccidental = (lat: number, lng: number) =>
  lat >= NEGROS_OCCIDENTAL_BOUNDS[0][0] &&
  lat <= NEGROS_OCCIDENTAL_BOUNDS[1][0] &&
  lng >= NEGROS_OCCIDENTAL_BOUNDS[0][1] &&
  lng <= NEGROS_OCCIDENTAL_BOUNDS[1][1]

function MapClickHandler({ onChange }: { onChange: (latitude: number, longitude: number) => void }) {
  useMapEvents({
    click(event) {
      if (isWithinNegrosOccidental(event.latlng.lat, event.latlng.lng)) {
        onChange(event.latlng.lat, event.latlng.lng)
      }
    },
  })

  return null
}

function RecenterMap({ latitude, longitude }: { latitude: number | null; longitude: number | null }) {
  const map = useMap()

  useEffect(() => {
    if (typeof latitude === 'number' && typeof longitude === 'number' && isWithinNegrosOccidental(latitude, longitude)) {
      map.setView([latitude, longitude], Math.max(map.getZoom(), 15))
      return
    }
    map.setView(NEGROS_OCCIDENTAL_CENTER, Math.max(map.getZoom(), 10))
  }, [latitude, longitude, map])

  return null
}

export function AddressMapPicker({ latitude, longitude, onChange }: AddressMapPickerProps) {
  const hasPin =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    isWithinNegrosOccidental(latitude, longitude)
  const center: [number, number] = hasPin ? [latitude as number, longitude as number] : NEGROS_OCCIDENTAL_CENTER

  return (
    <div className="space-y-2">
      <div className="h-64 w-full overflow-hidden rounded-md border">
        <MapContainerUnsafe
          center={center}
          zoom={hasPin ? 15 : 10}
          minZoom={9}
          maxBounds={NEGROS_OCCIDENTAL_BOUNDS}
          maxBoundsViscosity={1}
          className="h-full w-full z-0"
        >
          <TileLayerUnsafe
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler onChange={onChange} />
          <RecenterMap latitude={latitude} longitude={longitude} />
          {hasPin && (
            <CircleMarkerUnsafe
              center={[latitude as number, longitude as number]}
              radius={8}
              pathOptions={{ color: '#7e22ce', fillColor: '#a855f7', fillOpacity: 0.85 }}
            />
          )}
        </MapContainerUnsafe>
      </div>
      <p className="text-xs text-gray-500">Click on the map to pin your delivery location.</p>
    </div>
  )
}
