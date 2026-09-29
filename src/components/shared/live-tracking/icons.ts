import L from 'leaflet';
import type { TruckIconDirection } from './types'
import { normalizeAngle } from './geometry'
import { rotateScreenOffset } from './pin-spread'

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

// Neighbouring heads of a fanned group lean this far apart, which about clears a 25px head.
export const STATUS_PIN_TILT_STEP_DEG = 45;

// The ETA tooltip already carries a [0, -34] offset, so its anchor supplies only the difference.
const offsetBetween = ([x1, y1]: [number, number], [x2, y2]: [number, number]): [number, number] => [x1 - x2, y1 - y2];

/**
 * `tilt` is set only for a pin sharing its coordinate with others (see
 * pin-spread): the pin leans that many degrees about the coordinate it stands
 * on, so its tip stays there while its head moves clear of the others. Its
 * number stays upright.
 */
export function getStatusPinIcon(color: 'green' | 'blue' | 'red' | 'orange', number?: number | string, tilt?: number) {
  const label = number === undefined || number === null || String(number).trim() === '' ? '' : String(number);
  const fanned = typeof tilt === 'number';
  const angle = fanned ? tilt : 0;
  const cacheKey = `${color}:${label}:${fanned ? angle : '-'}`;
  const cached = statusPinIconCache.get(cacheKey);
  if (cached) return cached;

  // A fanned group's markers all stand on one point, so their untilted boxes
  // overlap exactly; only the drawn pin and its number take clicks, or the
  // top box would open its own order wherever the others' heads were clicked.
  const fanStyle = fanned ? `transform:rotate(${angle}deg);transform-origin:14px 44px;pointer-events:none;` : '';
  const hitStyle = fanned ? 'pointer-events:auto;' : '';
  const icon = L.divIcon({
    className: 'status-pin-icon',
    html: `
      <div style="position:relative;width:28px;height:44px;display:flex;align-items:flex-start;justify-content:center;${fanStyle}">
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
          style="width:25px;height:41px;display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.2));${hitStyle}"
          onerror="this.onerror=null;this.src='https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';"
        />
        ${label ? `<div style="position:absolute;top:9px;left:50%;transform:translateX(-50%)${fanned ? ` rotate(${-angle}deg)` : ''};min-width:14px;height:14px;padding:0 3px;border-radius:9999px;background:rgba(255,255,255,0.96);border:1px solid rgba(15,23,42,0.08);color:${color === 'green' ? '#047857' : '#0369a1'};font-size:10px;line-height:14px;font-weight:800;text-align:center;box-shadow:0 1px 2px rgba(15,23,42,0.14);${hitStyle}">${label}</div>` : ''}
      </div>
    `,
    // A zero-size box leaves nothing but the tilted pin to hit; the anchor still sets where it stands.
    iconSize: fanned ? [0, 0] : [28, 44],
    iconAnchor: [14, 44],
    // The popup and the ETA label follow the head as it leans.
    popupAnchor: rotateScreenOffset([1, -34], angle),
    tooltipAnchor: fanned ? offsetBetween(rotateScreenOffset([0, -34], angle), [0, -34]) : [0, 0],
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

// lucide-react's Warehouse glyph (roof over a three-line door), drawn in the pin's
// head: 24 units scaled to 18px about the head's centre at (20, 20).
const WAREHOUSE_GLYPH = `<g transform="translate(11 11) scale(0.75)" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11"/>
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.132-1.803l7.95-3.974a2 2 0 0 1 1.837 0l7.948 3.974A2 2 0 0 1 22 8z"/>
  <path d="M6 13h12"/>
  <path d="M6 17h12"/>
</g>`;

// A teardrop pin: an 18px-radius head at (20, 20) whose sides run tangent to it
// down to the tip at (20, 48).
const WAREHOUSE_PIN_PATH = 'M20 48 L6.25 31.6 A18 18 0 1 1 33.75 31.6 Z';

let warehouseIcon: L.DivIcon | null = null;

/** Navy-to-blue map pin with a white outline, standing on its tip at the warehouse. */
export function getWarehouseIcon() {
  if (warehouseIcon) return warehouseIcon;
  warehouseIcon = L.divIcon({
    className: 'warehouse-marker-icon',
    html: `<div style="position:relative;width:40px;height:52px;">
      <div style="position:absolute;left:10px;top:45px;width:20px;height:7px;border-radius:50%;background:rgba(15,23,42,0.32);filter:blur(2px);"></div>
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 40 52" aria-hidden="true" style="position:relative;display:block;overflow:visible;filter:drop-shadow(0 1px 2px rgba(15,23,42,0.35));">
        <defs>
          <linearGradient id="warehouse-pin-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#0b2a66"/>
            <stop offset="0.55" stop-color="#103c8a"/>
            <stop offset="1" stop-color="#1f7bff"/>
          </linearGradient>
        </defs>
        <path d="${WAREHOUSE_PIN_PATH}" fill="url(#warehouse-pin-fill)" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>
        ${WAREHOUSE_GLYPH}
      </svg>
    </div>`,
    iconSize: [40, 52],
    // The tip marks the warehouse, like the stop pins.
    iconAnchor: [20, 49],
    popupAnchor: [0, -46],
  });
  return warehouseIcon;
}
