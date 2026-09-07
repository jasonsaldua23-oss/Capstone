"use client";

import { useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  calculateTruckScreenRotation,
  normalizeMapAngle,
  type NavigationViewportInsets,
} from '@/lib/map-navigation';
import type { DriverLocation, LiveRouteLine } from './LiveTrackingMap';

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const TRUCK_BACK_ICON_URL = '/icons/aab-van-back.png';
const TRUCK_ISO_ICON_URL = '/icons/aab-van-iso.png';
const TRUCK_BACK_ASSET_FORWARD_HEADING = 0;
const TRUCK_ISO_ASSET_FORWARD_HEADING = 45;
const NAVIGATION_2D_ZOOM = 16.2;
// Updated: matches the close street-level framing requested for 3D navigation.
const NAVIGATION_3D_ZOOM = 19;
const NAVIGATION_3D_PITCH = 58;
// Updated: keeps the recentered truck at the second reference image's framing.
const NAVIGATION_3D_FORWARD_VIEW_RATIO = 0.12;
// Below this the fix is good enough that a halo would only add clutter; above
// it the driver needs to see that the position they are following is uncertain.
const NAVIGATION_ACCURACY_HALO_MIN_METERS = 30;

type TruckMarkerEntry = {
  marker: maplibregl.Marker;
  element: HTMLDivElement;
  popupHtml: string;
};

type DropPinMarkerEntry = {
  marker: maplibregl.Marker;
  lat: number;
  lng: number;
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function popupHtml(location: DriverLocation) {
  const customerName = escapeHtml(location.popupCustomerName || location.driverName);
  const address = escapeHtml(location.popupAddress || location.markerLabel || `Vehicle: ${location.vehiclePlate}`);
  const status = escapeHtml(String(location.status || '').replace(/_/g, ' ').toLowerCase());

  // Added: navigation truck popups mirror the assignment details shown on the tracking map.
  if (location.markerType === 'truck') {
    const driverName = escapeHtml(location.driverName || 'N/A');
    const plateNumber = escapeHtml(location.vehiclePlate || 'N/A');
    const assignedTripNumber = escapeHtml(location.assignedTripNumber || 'N/A');
    const destinationCustomer = escapeHtml(location.destinationCustomer || 'N/A');
    const markerLabel = location.markerLabel
      ? `<p style="font-size:12px;color:#4b5563;margin:4px 0 0 0">${escapeHtml(location.markerLabel)}</p>`
      : '';

    return `<div style="font:13px/1.35 system-ui,sans-serif;min-width:220px;max-width:280px">
      <strong style="display:block;font-size:14px;font-weight:700;color:#111827;margin-bottom:2px">Driver: ${driverName}</strong>
      <p style="font-size:12px;color:#4b5563;margin:0">Plate Number: ${plateNumber}</p>
      <p style="font-size:12px;color:#4b5563;margin:0">Assigned Trip #: ${assignedTripNumber}</p>
      <p style="font-size:12px;color:#4b5563;margin:0">Destination Customer: ${destinationCustomer}</p>
      ${markerLabel}
      <p style="font-size:11px;color:#6b7280;margin:4px 0 0 0">Status: <span style="text-transform:capitalize;font-weight:600">${status}</span></p>
    </div>`;
  }

  let itemsHtml = '';
  if (Array.isArray(location.popupOrderItems) && location.popupOrderItems.length > 0) {
    const items = location.popupOrderItems.slice(0, 8).map(
      (item) => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#4b5563;line-height:1.4"><span>${escapeHtml(item.name)}</span><strong style="white-space:nowrap">${escapeHtml(item.qty)}</strong></div>`
    ).join('');
    const more = location.popupOrderItems.length > 8 ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px">+${location.popupOrderItems.length - 8} more item(s)</div>` : '';
    itemsHtml = `<div style="margin-top:8px;border-top:1px solid #e5e7eb;padding-top:6px">
      <div style="font-size:11px;font-weight:700;color:#1f2937;margin-bottom:4px">Ordered Items</div>
      ${items}
      ${more}
    </div>`;
  }

  return `<div style="font:13px/1.35 system-ui,sans-serif;min-width:180px;max-width:260px">
    <strong style="display:block;font-size:14px;font-weight:700;color:#111827;margin-bottom:2px">${customerName}</strong>
    <p style="font-size:12px;color:#4b5563;margin:0 0 4px 0">${address}</p>
    <p style="font-size:11px;color:#6b7280;margin:0">Status: <span style="text-transform:capitalize;font-weight:600">${status}</span></p>
    ${itemsHtml}
  </div>`;
}

function createTruckElement(showSelfBadge: boolean, is3DPerspective: boolean) {
  const element = document.createElement('div');
  // A 1px anchor gives MapLibre measurable marker geometry while keeping its
  // center effectively identical to the route coordinate.
  element.style.cssText = 'position:relative;width:1px;height:1px;overflow:visible;cursor:pointer;';
  element.dataset.markerKind = 'truck';
  // Fix: Tailwind constrains images to their parent's width, so opt these images
  // out of max-width:100% to keep the 1px map anchor from collapsing the truck.
  // The 3D van is larger than the 2D marker to match the close navigation camera.
  element.innerHTML = `
    ${showSelfBadge ? '<div style="position:absolute;left:.5px;top:-47.5px;transform:translateX(-50%);z-index:3;border-radius:9999px;background:#fff;border:1px solid rgba(15,23,42,.18);padding:1px 6px;color:#0f3d72;font:900 10px/14px system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 6px rgba(15,23,42,.15)">YOU</div>' : ''}
    <div style="position:absolute;left:.5px;top:.5px;transform:translate(-50%,17px);width:26px;height:10px;border-radius:9999px;background:rgba(29,78,216,.3);filter:blur(2px)"></div>
    <img data-truck-image data-mode="3d" data-asset-forward-heading="${TRUCK_BACK_ASSET_FORWARD_HEADING}" src="${TRUCK_BACK_ICON_URL}" alt="truck" style="position:absolute;left:.5px;top:2.5px;z-index:2;width:96px;max-width:none;height:96px;display:${is3DPerspective ? 'block' : 'none'};object-fit:contain;transform:translate(-50%,-50%);transform-origin:center center;will-change:transform;filter:drop-shadow(0 4px 10px rgba(15,23,42,.38)) contrast(1.08) saturate(1.08)" />
    <img data-truck-image data-mode="2d" data-asset-forward-heading="${TRUCK_ISO_ASSET_FORWARD_HEADING}" src="${TRUCK_ISO_ICON_URL}" alt="truck" style="position:absolute;left:-1.5px;top:2.5px;z-index:2;width:72px;max-width:none;height:72px;display:${is3DPerspective ? 'none' : 'block'};object-fit:contain;transform:translate(-50%,-50%);transform-origin:center center;will-change:transform;filter:drop-shadow(0 4px 10px rgba(15,23,42,.38)) contrast(1.08) saturate(1.08)" />`;
  return element;
}

function rotateTruckElement(element: HTMLElement, heading: number, map: maplibregl.Map, position: maplibregl.LngLat) {
  // Fix: project the road tangent through the pitched camera so the body stays
  // parallel to the visible road, including while the driver pans or zooms.
  const radians = heading * Math.PI / 180;
  const origin = map.project(position);
  const forward = map.project([
    position.lng + Math.sin(radians) * 0.00001 / Math.max(Math.cos(position.lat * Math.PI / 180), 0.01),
    position.lat + Math.cos(radians) * 0.00001,
  ]);
  const screenHeading = Math.hypot(forward.x - origin.x, forward.y - origin.y) > 0.000001
    ? Math.atan2(forward.x - origin.x, origin.y - forward.y) * 180 / Math.PI
    : calculateTruckScreenRotation(heading, map.getBearing());
  applyTruckScreenHeading(element, screenHeading);
}

function applyTruckScreenHeading(element: HTMLElement, screenHeading: number) {
  element.querySelectorAll<HTMLElement>('[data-truck-image]').forEach((image) => {
    // Keep artwork orientation separate from the projected road direction.
    const declaredForwardHeading = Number(image.dataset.assetForwardHeading);
    const assetForwardHeading = Number.isFinite(declaredForwardHeading)
      ? declaredForwardHeading
      : image.dataset.mode === '3d'
        ? TRUCK_BACK_ASSET_FORWARD_HEADING
        : TRUCK_ISO_ASSET_FORWARD_HEADING;
    image.style.transform = `translate(-50%,-50%) rotate(${screenHeading - assetForwardHeading}deg)`;
  });
}

// Every drop point gets a dotted bridge from the nearest routed road coordinate
// to the order's exact stored coordinate, plus a dot marking that coordinate.
function buildPinBridgeFeatures(locations: DriverLocation[], routeLines: LiveRouteLine[]) {
  const features: GeoJSON.Feature[] = [];
  locations.filter((location) => location.markerType === 'pin').forEach((location) => {
    const roadCoordinate = nearestCoordinateOnRoutes(location, routeLines);
    if (!roadCoordinate) return;
    features.push({
      type: 'Feature',
      properties: { id: String(location.id) },
      geometry: {
        type: 'LineString',
        coordinates: [
          [roadCoordinate[1], roadCoordinate[0]],
          [location.lng, location.lat],
        ],
      },
    });
    features.push({
      type: 'Feature',
      properties: { id: String(location.id) },
      geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
    });
  });
  return features;
}

// Geographic ring approximating a circle of `radiusMeters` around a coordinate.
// MapLibre's circle-radius is measured in screen pixels, which would keep the
// halo the same size as the driver zooms — the opposite of what it must convey.
function accuracyHaloRing(lat: number, lng: number, radiusMeters: number): [number, number][] {
  const latitudeDegrees = radiusMeters / 110540;
  const longitudeDegrees = radiusMeters / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const ring: [number, number][] = [];
  const segments = 48;
  for (let step = 0; step <= segments; step += 1) {
    const angle = (step / segments) * Math.PI * 2;
    ring.push([lng + Math.cos(angle) * longitudeDegrees, lat + Math.sin(angle) * latitudeDegrees]);
  }
  return ring;
}

function nearestCoordinateOnRoutes(
  location: { lat: number; lng: number },
  routeLines: LiveRouteLine[]
): [number, number] | null {
  const longitudeScale = Math.cos((location.lat * Math.PI) / 180);
  const targetX = location.lng * longitudeScale;
  const targetY = location.lat;
  let nearest: { lat: number; lng: number; distance2: number } | null = null;

  routeLines.forEach((line) => {
    for (let index = 0; index < line.points.length - 1; index += 1) {
      const start = line.points[index];
      const end = line.points[index + 1];
      const startX = start[1] * longitudeScale;
      const startY = start[0];
      const endX = end[1] * longitudeScale;
      const endY = end[0];
      const dx = endX - startX;
      const dy = endY - startY;
      const length2 = dx * dx + dy * dy;
      if (length2 < 1e-16) continue;
      const t = Math.max(0, Math.min(1, ((targetX - startX) * dx + (targetY - startY) * dy) / length2));
      const projectedX = startX + dx * t;
      const projectedY = startY + dy * t;
      const distance2 = (targetX - projectedX) ** 2 + (targetY - projectedY) ** 2;
      if (!nearest || distance2 < nearest.distance2) {
        nearest = {
          lat: start[0] + (end[0] - start[0]) * t,
          lng: start[1] + (end[1] - start[1]) * t,
          distance2,
        };
      }
    }
  });

  if (!nearest) return null;
  const resolved = nearest as { lat: number; lng: number; distance2: number };
  return [resolved.lat, resolved.lng];
}

export default function MapLibreNavigationMap({
  locations,
  center,
  zoom,
  routeLines,
  is3DPerspective,
  recenterSignal,
  zoomInSignal,
  zoomOutSignal,
  navigationViewportInsets,
  showDriverSelfBadge,
  onRouteLineSelect,
  className,
}: {
  locations: DriverLocation[];
  center: [number, number];
  zoom: number;
  routeLines: LiveRouteLine[];
  is3DPerspective: boolean;
  recenterSignal?: number;
  zoomInSignal?: number;
  zoomOutSignal?: number;
  navigationViewportInsets?: NavigationViewportInsets;
  showDriverSelfBadge: boolean;
  onRouteLineSelect?: (routeLineId: string) => void;
  className: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const truckMarkersRef = useRef(new Map<string, TruckMarkerEntry>());
  const dropPinMarkersRef = useRef(new Map<string, DropPinMarkerEntry>());
  const routeLayerIdsRef = useRef<string[]>([]);
  const routeSourceIdsRef = useRef<string[]>([]);
  const pinBridgeCacheRef = useRef<{ key: string; features: GeoJSON.Feature[] }>({ key: '', features: [] });
  const isUserExploringRef = useRef(false);
  const previousRecenterRef = useRef(recenterSignal);
  const previousZoomInRef = useRef(zoomInSignal);
  const previousZoomOutRef = useRef(zoomOutSignal);
  const previous3DModeRef = useRef(is3DPerspective);
  const truck = locations.find((location) => location.markerType === 'truck') || null;
  const truckHeading = typeof truck?.markerHeading === 'number' && Number.isFinite(truck.markerHeading)
    ? normalizeMapAngle(truck.markerHeading)
    : 0;
  const routeSignature = useMemo(
    () => routeLines.map((line) => `${line.id}:${line.color}:${line.points.map((point) => point.join(',')).join('|')}`).join('||'),
    [routeLines]
  );
  const selectableRouteLineIdsKey = useMemo(
    () => routeLines.filter((line) => line.selectable).map((line) => String(line.id)).join('|'),
    [routeLines]
  );
  const pinSignature = useMemo(
    () => locations
      .filter((location) => location.markerType === 'pin')
      .map((location) => `${location.id}:${location.lat},${location.lng}`)
      .join('|'),
    [locations]
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: truck ? [truck.lng, truck.lat] : [center[1], center[0]],
      zoom: truck ? (is3DPerspective ? NAVIGATION_3D_ZOOM : NAVIGATION_2D_ZOOM) : zoom,
      pitch: is3DPerspective ? NAVIGATION_3D_PITCH : 0,
      bearing: is3DPerspective ? truckHeading : 0,
      attributionControl: false,
      maxPitch: 85,
    });
    mapRef.current = map;
    // Fix: remember initial readiness; loaded() becomes false again during tile/source updates.
    map.once('load', () => { mapReadyRef.current = true; });

    // Fix: refresh screen alignment whenever camera pitch or bearing changes.
    const syncTruckRotations = () => {
      truckMarkersRef.current.forEach(({ element, marker }) => {
        const heading = Number(element.dataset.routeHeading);
        if (Number.isFinite(heading)) rotateTruckElement(element, heading, map, marker.getLngLat());
      });
    };
    const markUserExploring = () => {
      isUserExploringRef.current = true;
    };

    map.on('move', syncTruckRotations);
    map.on('dragstart', markUserExploring);
    map.on('wheel', markUserExploring);
    map.on('touchstart', markUserExploring);
    map.on('mousedown', markUserExploring);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      truckMarkersRef.current.clear();
      dropPinMarkersRef.current.clear();
      // Mark the instance unavailable before MapLibre tears down its style so
      // later effect cleanups cannot query layers on a half-disposed map.
      mapRef.current = null;
      mapReadyRef.current = false;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const activeTruckIds = new Set<string>();
    locations.filter((location) => location.markerType === 'truck').forEach((location) => {
      activeTruckIds.add(location.id);
      let entry = truckMarkersRef.current.get(location.id);
      if (!entry) {
        const element = createTruckElement(showDriverSelfBadge, is3DPerspective);
        const marker = new maplibregl.Marker({ element, anchor: 'center', pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
          .setLngLat([location.lng, location.lat])
          .setPopup(new maplibregl.Popup({ closeButton: false, offset: [0, -42] }).setHTML(popupHtml(location)))
          .addTo(map);
        entry = { marker, element, popupHtml: popupHtml(location) };
        truckMarkersRef.current.set(location.id, entry);
      }
      // The position arrives already map-matched to the road and clamped to
      // monotonic route progress, in ground space. Re-deriving it here from
      // projected screen pixels cost a pass over the whole route every frame and
      // was wrong under pitch, where pixel distance is not ground distance.
      entry.marker.setLngLat([location.lng, location.lat]);
      const nextPopupHtml = popupHtml(location);
      // Position changes arrive every animation frame; keep static popup DOM out
      // of that hot path to avoid needless layout work and marker flicker.
      if (entry.popupHtml !== nextPopupHtml) {
        entry.marker.getPopup()?.setHTML(nextPopupHtml);
        entry.popupHtml = nextPopupHtml;
      }
      const hasRouteHeading = typeof location.markerHeading === 'number' && Number.isFinite(location.markerHeading);
      const heading = hasRouteHeading ? normalizeMapAngle(location.markerHeading as number) : 0;
      if (hasRouteHeading) entry.element.dataset.routeHeading = String(heading);
      else delete entry.element.dataset.routeHeading;
      entry.element.querySelectorAll<HTMLElement>('[data-truck-image]').forEach((image) => {
        image.style.display = image.dataset.mode === (is3DPerspective ? '3d' : '2d') ? 'block' : 'none';
      });
      if (hasRouteHeading) rotateTruckElement(entry.element, heading, map, entry.marker.getLngLat());
    });
    truckMarkersRef.current.forEach((entry, id) => {
      if (!activeTruckIds.has(id)) {
        entry.marker.remove();
        truckMarkersRef.current.delete(id);
      }
    });
  }, [is3DPerspective, locations, showDriverSelfBadge]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const activePinIds = new Set<string>();
    locations.filter((location) => location.markerType === 'pin').forEach((location) => {
      activePinIds.add(location.id);
      let entry = dropPinMarkersRef.current.get(location.id);
      if (!entry) {
        // Fix: MapLibre's native marker owns the anchor calculation, keeping the
        // pin tip bound to its geographic coordinate throughout every zoom level.
        const marker = new maplibregl.Marker({
          color: '#dc2626',
          scale: 1.2,
          // Fix: the native SVG tip is at y=34.8 inside its 41px viewBox.
          // This center offset places that visible tip—not the shadow box—on lngLat.
          anchor: 'center',
          offset: [0, -17.16],
          pitchAlignment: 'viewport',
          rotationAlignment: 'viewport',
          subpixelPositioning: true,
        })
          .setLngLat([location.lng, location.lat])
          .setPopup(new maplibregl.Popup({ closeButton: false, offset: [0, -52] }).setHTML(popupHtml(location)))
          .addTo(map);
        const markerElement = marker.getElement();
        markerElement.setAttribute('aria-label', 'Drop point');

        entry = { marker, lat: location.lat, lng: location.lng };
        dropPinMarkersRef.current.set(location.id, entry);
      }
      // Fix: live truck updates rebuild `locations`; do not reset a stationary
      // drop pin unless that drop point's stored coordinates actually changed.
      if (entry.lat !== location.lat || entry.lng !== location.lng) {
        entry.marker.setLngLat([location.lng, location.lat]);
        entry.lat = location.lat;
        entry.lng = location.lng;
      }
      entry.marker.getPopup()?.setHTML(popupHtml(location));
    });
    dropPinMarkersRef.current.forEach((entry, id) => {
      if (!activePinIds.has(id)) {
        entry.marker.remove();
        dropPinMarkersRef.current.delete(id);
      }
    });
  }, [locations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sourceId = 'drop-coordinate-bridges';
    const bridgeLayerId = 'drop-coordinate-bridge-dots';
    const coordinateLayerId = 'drop-coordinate-points';

    // Finding each drop point's road coordinate walks the entire route, and this
    // effect re-runs on every frame that moves the vehicle. The pins and the
    // route are unchanged on those frames, so their bridges are computed once
    // per real change and replayed from the cache in between.
    const pinBridgeKey = `${pinSignature}::${routeSignature}`;
    if (pinBridgeCacheRef.current.key !== pinBridgeKey) {
      pinBridgeCacheRef.current = {
        key: pinBridgeKey,
        features: buildPinBridgeFeatures(locations, routeLines),
      };
    }
    const features: GeoJSON.Feature[] = [...pinBridgeCacheRef.current.features];

    // Fix: the road-matched vehicle is the only driver marker; bridges remain for drop points.
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

    const updateBridges = () => {
      if (mapRef.current !== map || !map.getStyle()) return;
      const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (source) source.setData(data);
      else map.addSource(sourceId, { type: 'geojson', data });

      if (!map.getLayer(bridgeLayerId)) {
        map.addLayer({
          id: bridgeLayerId,
          type: 'line',
          source: sourceId,
          minzoom: 15,
          filter: ['==', '$type', 'LineString'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#64748b',
            'line-width': 2,
            'line-opacity': 0.8,
            // Short round dashes form the requested series of small gray dots.
            'line-dasharray': [0.1, 1.6],
          },
        });
      }
      if (!map.getLayer(coordinateLayerId)) {
        map.addLayer({
          id: coordinateLayerId,
          type: 'circle',
          source: sourceId,
          minzoom: 15,
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': 3.5,
            'circle-color': '#64748b',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        });
      }
    };

    if (map.loaded()) updateBridges();
    else map.once('load', updateBridges);
    return () => { map.off('load', updateBridges); };
  }, [locations, pinSignature, routeSignature]);

  // A degraded fix has to look degraded. Without this the vehicle renders
  // identically at 8 m and at 200 m of accuracy, leaving the driver no way to
  // tell that the position they are following has stopped being trustworthy.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sourceId = 'driver-accuracy-halo';
    const fillLayerId = 'driver-accuracy-halo-fill';
    const outlineLayerId = 'driver-accuracy-halo-outline';
    const features: GeoJSON.Feature[] = [];

    locations.filter((location) => location.markerType === 'truck').forEach((location) => {
      const accuracyMeters = Number(location.accuracyMeters);
      if (!Number.isFinite(accuracyMeters) || accuracyMeters < NAVIGATION_ACCURACY_HALO_MIN_METERS) return;
      // The halo belongs on the raw fix, not on the road-matched icon: it is the
      // measurement that is uncertain, not the position it was matched to.
      const haloLat = Number.isFinite(Number(location.actualLat)) ? Number(location.actualLat) : location.lat;
      const haloLng = Number.isFinite(Number(location.actualLng)) ? Number(location.actualLng) : location.lng;
      features.push({
        type: 'Feature',
        properties: { id: String(location.id) },
        geometry: { type: 'Polygon', coordinates: [accuracyHaloRing(haloLat, haloLng, accuracyMeters)] },
      });
    });
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

    const updateHalo = () => {
      if (mapRef.current !== map || !map.getStyle()) return;
      const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
      if (source) source.setData(data);
      else map.addSource(sourceId, { type: 'geojson', data });

      if (!map.getLayer(fillLayerId)) {
        map.addLayer({
          id: fillLayerId,
          type: 'fill',
          source: sourceId,
          paint: { 'fill-color': '#1d4ed8', 'fill-opacity': 0.12 },
        });
      }
      if (!map.getLayer(outlineLayerId)) {
        map.addLayer({
          id: outlineLayerId,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': '#1d4ed8', 'line-width': 1, 'line-opacity': 0.35 },
        });
      }
    };

    if (map.loaded()) updateHalo();
    else map.once('load', updateHalo);
    return () => { map.off('load', updateHalo); };
  }, [locations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const zoomInChanged = previousZoomInRef.current !== zoomInSignal;
    const zoomOutChanged = previousZoomOutRef.current !== zoomOutSignal;
    previousZoomInRef.current = zoomInSignal;
    previousZoomOutRef.current = zoomOutSignal;
    if (!zoomInChanged && !zoomOutChanged) return;

    // Added: custom mobile controls zoom the current camera while preserving
    // its center, pitch, and bearing until the driver taps recenter again.
    isUserExploringRef.current = true;
    const delta = zoomInChanged ? 1 : -1;
    const nextZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + delta));
    map.easeTo({ zoom: nextZoom, duration: 250, essential: true });
  }, [zoomInSignal, zoomOutSignal]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const updateRoutes = () => {
      if (mapRef.current !== map || !map.getStyle()) return;
      const activeSourceIds: string[] = [];
      const activeLayerIds: string[] = [];

      routeLines.forEach((line) => {
        if (line.points.length < 2) return;
        const sourceId = `navigation-route-${encodeURIComponent(String(line.id))}`;
        const shadowLayerId = `${sourceId}-shadow`;
        const mainLayerId = `${sourceId}-main`;
        const detailLayerId = `${sourceId}-detail`;
        const hitLayerId = `${sourceId}-hit`;
        const isUpcoming = line.color === '#2563eb' && !line.dashArray;
        const isAlternative = line.color === '#93c5fd' && !line.dashArray;
        const routeData = {
          type: 'Feature' as const,
          properties: { routeLineId: line.id },
          geometry: {
            type: 'LineString' as const,
            coordinates: line.points.map((point) => [point[1], point[0]]),
          },
        };
        activeSourceIds.push(sourceId);
        activeLayerIds.push(shadowLayerId, mainLayerId, detailLayerId, hitLayerId);

        const existingSource = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
        if (existingSource) {
          // Updating source data preserves the already-painted layers, eliminating
          // the blank frame caused by removeSource/addSource on live GPS refreshes.
          existingSource.setData(routeData);
        } else {
          map.addSource(sourceId, { type: 'geojson', lineMetrics: true, data: routeData });
        }

        if (!map.getLayer(shadowLayerId)) {
          map.addLayer({
            id: shadowLayerId,
            type: 'line',
            source: sourceId,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': isUpcoming ? '#0f3b8f' : isAlternative ? '#60a5fa' : '#1e293b',
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 18, 12],
              'line-opacity': isUpcoming ? 0.3 : isAlternative ? 0.24 : 0.24,
              'line-blur': 1.2,
            },
          });
        }
        if (!map.getLayer(mainLayerId)) {
          map.addLayer({
            id: mainLayerId,
            type: 'line',
            source: sourceId,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': isUpcoming ? '#0d61ad' : isAlternative ? '#93c5fd' : '#64748b',
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.6, 14, 5, 18, 8.5],
              'line-opacity': isUpcoming ? 0.98 : isAlternative ? 0.86 : 0.84,
            },
          });
        }
        if (!map.getLayer(detailLayerId)) {
          map.addLayer({
            id: detailLayerId,
            type: 'line',
            source: sourceId,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': isUpcoming ? '#e0f2fe' : isAlternative ? '#eff6ff' : '#cbd5e1',
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 16, 1.35, 19, 1.8],
              'line-opacity': isUpcoming ? 0.72 : isAlternative ? 0.5 : 0.62,
              'line-dasharray': isUpcoming ? [1.2, 3.2] : isAlternative ? [1, 3.6] : [0.8, 2.5],
            },
          });
        }
        if (!map.getLayer(hitLayerId)) {
          map.addLayer({
            id: hitLayerId,
            type: 'line',
            source: sourceId,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#ffffff',
              'line-width': 24,
              'line-opacity': 0.01,
            },
          });
        }
        // Reset any prior overlap experiment on already-mounted map layers.
        map.setPaintProperty(shadowLayerId, 'line-offset', 0);
        map.setPaintProperty(shadowLayerId, 'line-width', ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 18, 12]);
        map.setPaintProperty(mainLayerId, 'line-offset', 0);
        map.setPaintProperty(mainLayerId, 'line-width', ['interpolate', ['linear'], ['zoom'], 10, 2.6, 14, 5, 18, 8.5]);
        map.setPaintProperty(mainLayerId, 'line-opacity', isUpcoming ? 0.98 : isAlternative ? 0.86 : 0.84);
        map.setPaintProperty(detailLayerId, 'line-offset', 0);
      });

      const activeLayerSet = new Set(activeLayerIds);
      routeLayerIdsRef.current.slice().reverse().forEach((id) => {
        if (!activeLayerSet.has(id) && map.getLayer(id)) map.removeLayer(id);
      });
      const activeSourceSet = new Set(activeSourceIds);
      routeSourceIdsRef.current.slice().reverse().forEach((id) => {
        if (!activeSourceSet.has(id) && map.getSource(id)) map.removeSource(id);
      });
      routeLayerIdsRef.current = activeLayerIds;
      routeSourceIdsRef.current = activeSourceIds;
    };
    // Fix: keep the traveled section grey as the truck moves, even while tiles
    // or the previous GeoJSON update are loading. The load event only fires once.
    if (mapReadyRef.current) updateRoutes();
    else map.once('load', updateRoutes);
    return () => { map.off('load', updateRoutes); };
  }, [routeLines, routeSignature]);

  // Route selection is bound to layer ids, not to geometry. Registering it
  // alongside the geometry update tore down and rebuilt every listener each time
  // the vehicle advanced along the route. One map-level listener also survives
  // the hit layers being replaced, which per-layer delegates did not.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onRouteLineSelect) return;
    const selectableIds = new Set(
      selectableRouteLineIdsKey ? selectableRouteLineIdsKey.split('|') : []
    );
    if (selectableIds.size === 0) return;

    const topRouteLineIdAt = (point: maplibregl.Point) => {
      const hitLayerIds = routeLayerIdsRef.current.filter(
        (layerId) => layerId.endsWith('-hit') && map.getLayer(layerId)
      );
      if (hitLayerIds.length === 0) return '';
      // Only the visually top route receives the tap where routes overlap.
      const topRoute = map.queryRenderedFeatures(point, { layers: hitLayerIds })[0];
      return String(topRoute?.properties?.routeLineId || '');
    };
    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const routeLineId = topRouteLineIdAt(event.point);
      if (selectableIds.has(routeLineId)) onRouteLineSelect(routeLineId);
    };
    const handleMouseMove = (event: maplibregl.MapMouseEvent) => {
      map.getCanvas().style.cursor = selectableIds.has(topRouteLineIdAt(event.point)) ? 'pointer' : '';
    };

    map.on('click', handleClick);
    map.on('mousemove', handleMouseMove);
    return () => {
      map.off('click', handleClick);
      map.off('mousemove', handleMouseMove);
      map.getCanvas().style.cursor = '';
    };
  }, [onRouteLineSelect, selectableRouteLineIdsKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const recenterChanged = previousRecenterRef.current !== recenterSignal;
    const perspectiveChanged = previous3DModeRef.current !== is3DPerspective;
    previousRecenterRef.current = recenterSignal;
    previous3DModeRef.current = is3DPerspective;
    if (recenterChanged || perspectiveChanged) {
      isUserExploringRef.current = false;
    }
    if (isUserExploringRef.current) return;

    // Center the camera on the same coordinate the truck marker uses, and turn
    // it with the same smoothed heading. Deriving the bearing from route
    // vertices instead made the view snap round a curve in discrete steps, one
    // jump per vertex, rather than easing through it.
    const targetCenter = truck
      ? [truck.lng, truck.lat] as [number, number]
      : [center[1], center[0]] as [number, number];
    const cameraHeading = truckHeading;
    // MapLibre places the target at the center of the rectangle remaining after
    // padding, which is the measured space between the navigation overlays.
    const cameraPadding = navigationViewportInsets ?? { top: 0, bottom: 0, left: 0, right: 0 };
    const usableViewportHeight = Math.max(
      0,
      map.getContainer().clientHeight - cameraPadding.top - cameraPadding.bottom
    );
    // Added: lower the truck in 3D mode so the driver sees more of the route ahead.
    const cameraOffset: [number, number] = is3DPerspective
      ? [0, usableViewportHeight * NAVIGATION_3D_FORWARD_VIEW_RATIO]
      : [0, 0];
    const cameraOptions = {
      center: targetCenter,
      bearing: is3DPerspective ? cameraHeading : 0,
      pitch: is3DPerspective ? NAVIGATION_3D_PITCH : 0,
      zoom: recenterChanged || perspectiveChanged
        ? (is3DPerspective ? NAVIGATION_3D_ZOOM : NAVIGATION_2D_ZOOM)
        : map.getZoom(),
      padding: cameraPadding,
      offset: cameraOffset,
      // GPS positions and bearings are already interpolated at animation-frame
      // cadence. Applying another 350ms transition on every frame creates lag.
      duration: perspectiveChanged || recenterChanged ? 700 : 0,
      easing: (value) => 1 - Math.pow(1 - value, 3),
      essential: true,
    };
    map.easeTo(cameraOptions);
  }, [center, is3DPerspective, navigationViewportInsets, recenterSignal, truck?.lat, truck?.lng, truckHeading]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: className.includes('absolute') ? 'absolute' : 'relative',
        inset: className.includes('inset-0') ? 0 : undefined,
      }}
    />
  );
}
