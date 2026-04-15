"use client";

import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
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
};

interface LiveTrackingMapProps {
  locations: DriverLocation[];
  center?: [number, number]; // [lat, lng]
  zoom?: number;
}

export default function LiveTrackingMap({ locations, center = [39.8283, -98.5795], zoom = 4 }: LiveTrackingMapProps) {
  useEffect(() => {
    // Apply the icon fix on the client side
    L.Marker.prototype.options.icon = DefaultIcon;
  }, []);

  return (
    <div className="w-full h-[500px] rounded-xl overflow-hidden border shadow-sm">
      <MapContainer center={center} zoom={zoom} scrollWheelZoom={true} className="w-full h-full z-0">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {locations.map((loc) => (
          <Marker key={loc.id} position={[loc.lat, loc.lng]}>
            <Popup>
              <div className="text-sm">
                <p className="font-bold text-base mb-1">{loc.driverName}</p>
                <p className="text-gray-600">Vehicle: {loc.vehiclePlate}</p>
                <p className="text-gray-600">Status: <span className="capitalize">{loc.status.toLowerCase()}</span></p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}