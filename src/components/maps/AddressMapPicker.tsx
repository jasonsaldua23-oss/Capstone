'use client'

import { useEffect } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
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
const MarkerUnsafe = Marker as any

const PickerPinIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

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
  const hasPin =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    isWithinNegrosOccidental(latitude, longitude)
  const center: [number, number] = hasPin ? [latitude as number, longitude as number] : NEGROS_OCCIDENTAL_CENTER

  return (
    <div className="portal-map-picker space-y-2">
      <div className="relative h-64 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        <MapContainerUnsafe
          center={center}
          zoom={hasPin ? 15 : 10}
          minZoom={9}
          maxBounds={NEGROS_OCCIDENTAL_BOUNDS}
          maxBoundsViscosity={1}
          className="absolute inset-0 z-0 h-full w-full"
        >
          <TileLayerUnsafe
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickHandler onChange={onChange} />
          <MapAutoResizeFix />
          <RecenterMap latitude={latitude} longitude={longitude} />
          {hasPin && <MarkerUnsafe position={[latitude as number, longitude as number]} icon={PickerPinIcon} />}
        </MapContainerUnsafe>
      </div>
      <p className="text-xs text-slate-500">Click on the map to pin your delivery location.</p>
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
