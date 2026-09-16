import L from 'leaflet';
import type { TruckIconDirection } from './types'
import { normalizeAngle } from './geometry'

// Fix for default marker icons in Next.js + Leaflet
export const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const truckIconCache = new Map<string, L.DivIcon>();

const statusPinIconCache = new Map<string, L.DivIcon>();

// Updated: use the Driver Portal's 2D van icon consistently across shared portal maps.
const TRUCK_ICON_URL = '/icons/aab-van-iso.png';

// This icon's nose points upper-right (~northeast, 45deg) at 0deg image rotation.
const TRUCK_ICON_BASE_HEADING = 45;

const TRUCK_ROTATION_QUANTIZATION_DEG = 1;

export function getStatusPinIcon(color: 'green' | 'blue' | 'red' | 'orange', number?: number | string) {
  const label = number === undefined || number === null || String(number).trim() === '' ? '' : String(number);
  const cacheKey = `${color}:${label}`;
  const cached = statusPinIconCache.get(cacheKey);
  if (cached) return cached;

  const icon = L.divIcon({
    className: 'status-pin-icon',
    html: `
      <div style="position:relative;width:28px;height:44px;display:flex;align-items:flex-start;justify-content:center;">
        <img
            src="${color === 'green'
        ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png'
        : color === 'red'
          ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png'
          : color === 'orange'
            ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png'
            : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png'
      }"
          alt="pin"
          style="width:25px;height:41px;display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.2));"
          onerror="this.onerror=null;this.src='https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';"
        />
        ${label ? `<div style="position:absolute;top:9px;left:50%;transform:translateX(-50%);min-width:14px;height:14px;padding:0 3px;border-radius:9999px;background:rgba(255,255,255,0.96);border:1px solid rgba(15,23,42,0.08);color:${color === 'green' ? '#047857' : '#0369a1'};font-size:10px;line-height:14px;font-weight:800;text-align:center;box-shadow:0 1px 2px rgba(15,23,42,0.14);">${label}</div>` : ''}
      </div>
    `,
    iconSize: [28, 44],
    iconAnchor: [14, 44],
    popupAnchor: [1, -34],
  });

  statusPinIconCache.set(cacheKey, icon);
  return icon;
}

export function getTruckIcon(options: { direction?: TruckIconDirection; heading?: number; showSelfBadge?: boolean } = {}) {
  const direction = options.direction || 'right';
  const showSelfBadge = Boolean(options.showSelfBadge);
  const heading = typeof options.heading === 'number' && Number.isFinite(options.heading) ? options.heading : null;
  const quantizedHeading =
    heading === null
      ? null
      : Math.round(heading / TRUCK_ROTATION_QUANTIZATION_DEG) * TRUCK_ROTATION_QUANTIZATION_DEG;

  // Rotate around center so heading matches road tangent consistently.
  const iconAnchor: [number, number] = [36, 36];
  const popupAnchor: [number, number] = [0, -36];
  const rotation =
    quantizedHeading !== null
      ? normalizeAngle(quantizedHeading - TRUCK_ICON_BASE_HEADING)
      : direction === 'left'
        ? 180
        : 0;
  const cacheKey = `${direction}:${rotation.toFixed(1)}:${showSelfBadge ? 'self' : 'driver'}`;
  const cached = truckIconCache.get(cacheKey);
  if (cached) return cached;

  const icon = L.divIcon({
    className: 'custom-truck-marker',
    html: `<div style="position:relative;width:72px;height:72px;display:flex;align-items:center;justify-content:center;overflow:visible;">
      ${showSelfBadge ? '<div style="position:absolute;left:50%;top:-8px;transform:translateX(-50%);border-radius:9999px;background:#ffffff;border:1px solid rgba(15,23,42,0.18);padding:1px 6px;color:#0f3d72;font-size:10px;line-height:14px;font-weight:900;letter-spacing:0;">YOU</div>' : ''}
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:9999px;background:#1d4ed8;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.35);"></div>
      <img src="${TRUCK_ICON_URL}" alt="truck" style="position:relative;z-index:1;width:72px;height:72px;display:block;object-fit:contain;image-rendering:auto;transform:rotate(${rotation}deg);transform-origin:36px 36px;will-change:transform;filter:drop-shadow(0 4px 10px rgba(15,23,42,0.38)) contrast(1.08) saturate(1.08);" onerror="this.onerror=null;this.src='/icons/driver-location-cropped.png';" />
    </div>`,
    iconSize: [72, 72],
    iconAnchor,
    popupAnchor,
  });
  truckIconCache.set(cacheKey, icon);
  return icon;
}
