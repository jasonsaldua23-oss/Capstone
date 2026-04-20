"use client";

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Next.js + Leaflet
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export type DriverLocation = {
  id: string;
  driverName: string;
  vehiclePlate: string;
  lat: number;
  lng: number;
  status: string;
  markerColor?: string;
  markerLabel?: string;
  markerType?: 'pin' | 'dot' | 'truck' | 'default';
};

export type LiveRouteLine = {
  id: string;
  points: [number, number][];
  color: string;
  label?: string;
};

interface LiveTrackingMapProps {
  locations: DriverLocation[];
  center?: [number, number]; // [lat, lng]
  zoom?: number;
  routeLines?: LiveRouteLine[];
  restrictToNegrosOccidental?: boolean;
}

const NEGROS_OCCIDENTAL_BOUNDS = L.latLngBounds(
  [9.18, 122.22],
  [11.05, 123.35]
);

function MapBoundsGuard({ enabled }: { enabled: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return;
    map.setMaxBounds(NEGROS_OCCIDENTAL_BOUNDS);
    map.fitBounds(NEGROS_OCCIDENTAL_BOUNDS, { padding: [10, 10] });
  }, [enabled, map]);

  return null;
}

const pinIconCache = new Map<string, L.Icon>();
const truckIconCache = new Map<string, L.Icon>();

function getPinIcon(color: string) {
  const normalized = color || '#16a34a';
  const cacheKey = normalized.toLowerCase();
  const cached = pinIconCache.get(cacheKey);
  if (cached) return cached;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 34 46">
      <defs>
        <linearGradient id="pinGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${normalized}" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="${normalized}" stop-opacity="0.8"/>
        </linearGradient>
      </defs>
      <path d="M17 1C8.716 1 2 7.716 2 16c0 11.373 15 28 15 28s15-16.627 15-28C32 7.716 25.284 1 17 1z" fill="url(#pinGrad)" stroke="rgba(0,0,0,0.22)" stroke-width="1.2"/>
      <circle cx="17" cy="16" r="6" fill="#ffffff"/>
    </svg>
  `.trim();

  const icon = L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    iconSize: [30, 42],
    iconAnchor: [15, 41],
    popupAnchor: [1, -34],
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    shadowSize: [41, 41],
  });

  pinIconCache.set(cacheKey, icon);
  return icon;
}

function getTruckIcon(color: string) {
  const normalized = color || '#1d4ed8';
  const cacheKey = normalized.toLowerCase();
  const cached = truckIconCache.get(cacheKey);
  if (cached) return cached;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r="24" fill="${normalized}" fill-opacity="0.98" stroke="rgba(0,0,0,0.32)" stroke-width="1.4"/>
      <path d="M12 22h18v8h4.3l3.2 4v4h-2.8a3.9 3.9 0 0 1-7.8 0h-8.1a3.9 3.9 0 0 1-7.8 0H12z" fill="#ffffff"/>
      <rect x="30.2" y="24.2" width="6.6" height="4.9" rx="1.1" fill="#ffffff"/>
      <circle cx="15.9" cy="38" r="1.9" fill="${normalized}"/>
      <circle cx="29.8" cy="38" r="1.9" fill="${normalized}"/>
    </svg>
  `.trim();

  const icon = L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -16],
  });

  truckIconCache.set(cacheKey, icon);
  return icon;
}

export default function LiveTrackingMap({
  locations,
  center = [39.8283, -98.5795],
  zoom = 4,
  routeLines = [],
  restrictToNegrosOccidental = false,
}: LiveTrackingMapProps) {
  useEffect(() => {
    // Apply the icon fix on the client side
    L.Marker.prototype.options.icon = DefaultIcon;
  }, []);

  return (
    <div className="w-full h-[500px] rounded-xl overflow-hidden border shadow-sm">
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={true}
        className="w-full h-full z-0"
        minZoom={restrictToNegrosOccidental ? 9 : undefined}
        maxBounds={restrictToNegrosOccidental ? NEGROS_OCCIDENTAL_BOUNDS : undefined}
        maxBoundsViscosity={restrictToNegrosOccidental ? 1.0 : undefined}
      >
        <MapBoundsGuard enabled={restrictToNegrosOccidental} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {routeLines.map((line) =>
          Array.isArray(line.points) && line.points.length > 1 ? (
            <Polyline
              key={line.id}
              positions={line.points}
              pathOptions={{ color: line.color, weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
            >
              {line.label ? <Popup>{line.label}</Popup> : null}
            </Polyline>
          ) : null
        )}
        
        {locations.map((loc) => (
          loc.markerType === 'truck' ? (
            <Marker key={loc.id} position={[loc.lat, loc.lng]} icon={getTruckIcon(loc.markerColor || '#1d4ed8')} zIndexOffset={1000}>
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-base mb-1">{loc.driverName}</p>
                  <p className="text-gray-600">{loc.markerLabel || `Vehicle: ${loc.vehiclePlate}`}</p>
                  <p className="text-gray-600">Status: <span className="capitalize">{loc.status.toLowerCase()}</span></p>
                </div>
              </Popup>
            </Marker>
          ) : loc.markerType === 'pin' ? (
            <Marker key={loc.id} position={[loc.lat, loc.lng]} icon={getPinIcon(loc.markerColor || '#16a34a')}>
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-base mb-1">{loc.driverName}</p>
                  <p className="text-gray-600">{loc.markerLabel || `Vehicle: ${loc.vehiclePlate}`}</p>
                  <p className="text-gray-600">Status: <span className="capitalize">{loc.status.toLowerCase()}</span></p>
                </div>
              </Popup>
            </Marker>
          ) : loc.markerType === 'dot' || loc.markerColor ? (
            <CircleMarker
              key={loc.id}
              center={[loc.lat, loc.lng]}
              radius={8}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: loc.markerColor, fillOpacity: 1 }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-base mb-1">{loc.driverName}</p>
                  <p className="text-gray-600">{loc.markerLabel || `Vehicle: ${loc.vehiclePlate}`}</p>
                  <p className="text-gray-600">Status: <span className="capitalize">{loc.status.toLowerCase()}</span></p>
                </div>
              </Popup>
            </CircleMarker>
          ) : (
            <Marker key={loc.id} position={[loc.lat, loc.lng]}>
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-base mb-1">{loc.driverName}</p>
                  <p className="text-gray-600">Vehicle: {loc.vehiclePlate}</p>
                  <p className="text-gray-600">Status: <span className="capitalize">{loc.status.toLowerCase()}</span></p>
                </div>
              </Popup>
            </Marker>
          )
        ))}
      </MapContainer>
    </div>
  );
}
