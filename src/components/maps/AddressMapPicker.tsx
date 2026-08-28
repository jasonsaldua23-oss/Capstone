'use client'

import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { expandBounds, useServiceArea } from '@/lib/service-area'

interface AddressMapPickerProps {
  latitude: number | null
  longitude: number | null
  onChange: (latitude: number, longitude: number) => void
  // Called when a click lands outside Silay/Talisay, so the caller can explain the
  // rejection instead of the map appearing to ignore the tap.
  onOutsideServiceArea?: (latitude: number, longitude: number) => void
}

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

function MapClickHandler({
  onChange,
  onOutsideServiceArea,
  isAllowed,
}: {
  onChange: (latitude: number, longitude: number) => void
  onOutsideServiceArea?: (latitude: number, longitude: number) => void
  isAllowed: (latitude: number, longitude: number) => boolean
}) {
  useMapEvents({
    click(event) {
      const { lat, lng } = event.latlng
      if (isAllowed(lat, lng)) {
        onChange(lat, lng)
        return
      }
      onOutsideServiceArea?.(lat, lng)
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

export function AddressMapPicker({
  latitude,
  longitude,
  onChange,
  onOutsideServiceArea,
}: AddressMapPickerProps) {
  const { bounds: dynamicBounds, center: dynamicCenter, isInServiceArea } = useServiceArea()

  const mapDragBounds = useMemo(
    // Wider map-only padding so east/mountain territories of Silay/Talisay stay draggable.
    () => expandBounds(dynamicBounds, 0.05, 0.18),
    [dynamicBounds]
  )
  const isAllowed = isInServiceArea

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
          <MapClickHandler
            onChange={onChange}
            onOutsideServiceArea={onOutsideServiceArea}
            isAllowed={isAllowed}
          />
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
