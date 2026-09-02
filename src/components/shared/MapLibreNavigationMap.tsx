"use client";

import { useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  bearingBetweenMapPoints,
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
// Past this distance from the route the driver is off-route: the marker follows
// the live GPS instead of being snapped onto a stale road, so it never appears
// frozen on the route after the driver takes a different road.
const NAVIGATION_OFF_ROUTE_SNAP_METERS = 60;

function geoDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const refLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dx = (lng2 - lng1) * Math.cos(refLat) * 111320;
  const dy = (lat2 - lat1) * 110540;
  return Math.hypot(dx, dy);
}

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
    <img data-truck-image data-mode="3d" data-asset-forward-heading="${TRUCK_BACK_ASSET_FORWARD_HEADING}" src="${TRUCK_BACK_ICON_URL}" alt="truck" style="position:absolute;left:.5px;top:2.5px;z-index:2;width:96px;max-width:none;height:96px;display:${is3DPerspective ? 'block' : 'none'};object-fit:contain;transform:translate(-50%,-50%);transform-origin:center center;transition:transform 0.35s cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 4px 10px rgba(15,23,42,.38)) contrast(1.08) saturate(1.08)" />
    <img data-truck-image data-mode="2d" data-asset-forward-heading="${TRUCK_ISO_ASSET_FORWARD_HEADING}" src="${TRUCK_ISO_ICON_URL}" alt="truck" style="position:absolute;left:-1.5px;top:2.5px;z-index:2;width:72px;max-width:none;height:72px;display:${is3DPerspective ? 'none' : 'block'};object-fit:contain;transform:translate(-50%,-50%);transform-origin:center center;will-change:transform;transition:transform 0.35s cubic-bezier(.4,0,.2,1);filter:drop-shadow(0 4px 10px rgba(15,23,42,.38)) contrast(1.08) saturate(1.08)" />`;
  return element;
}

function rotateTruckElement(element: HTMLElement, heading: number, cameraBearing: number) {
  applyTruckScreenHeading(element, calculateTruckScreenRotation(heading, cameraBearing));
}

function applyTruckScreenHeading(element: HTMLElement, screenHeading: number) {
  element.querySelectorAll<HTMLElement>('[data-truck-image]').forEach((image) => {
    const assetForwardHeading = Number(image.dataset.assetForwardHeading);
    const rotation = image.dataset.mode === '3d'
      ? 0
      : screenHeading - (
          Number.isFinite(assetForwardHeading) ? assetForwardHeading : TRUCK_ISO_ASSET_FORWARD_HEADING
        );
    image.style.transform = `translate(-50%,-50%) rotate(${rotation}deg)`;
  });
}

function projectedRoutePlacement(
  map: maplibregl.Map,
  location: { lat: number; lng: number },
  routeLines: LiveRouteLine[]
) {
  const upcomingLines = routeLines.filter((line) => line.color === '#2563eb' && !line.dashArray && line.points.length > 1);
  const candidates = upcomingLines.length > 0 ? upcomingLines : routeLines.filter((line) => line.points.length > 1);
  const truckPoint = map.project([location.lng, location.lat]);
  let best: { points: [number, number][]; segmentIndex: number; t: number; distance2: number } | null = null;

  candidates.forEach((line) => {
    for (let index = 0; index < line.points.length - 1; index += 1) {
      const start = map.project([line.points[index][1], line.points[index][0]]);
      const end = map.project([line.points[index + 1][1], line.points[index + 1][0]]);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length2 = dx * dx + dy * dy;
      if (length2 < 0.0001) continue;
      const rawT = ((truckPoint.x - start.x) * dx + (truckPoint.y - start.y) * dy) / length2;
      const t = Math.max(0, Math.min(1, rawT));
      const nearestX = start.x + dx * t;
      const nearestY = start.y + dy * t;
      const distance2 = (truckPoint.x - nearestX) ** 2 + (truckPoint.y - nearestY) ** 2;
      if (!best || distance2 < best.distance2) best = { points: line.points, segmentIndex: index, t, distance2 };
    }
  });
  if (!best) return null;

  const matched = best as { points: [number, number][]; segmentIndex: number; t: number; distance2: number };
  const start = map.project([matched.points[matched.segmentIndex][1], matched.points[matched.segmentIndex][0]]);
  const end = map.project([matched.points[matched.segmentIndex + 1][1], matched.points[matched.segmentIndex + 1][0]]);
  const originX = start.x + (end.x - start.x) * matched.t;
  const originY = start.y + (end.y - start.y) * matched.t;
  let forward = end;
  let nextIndex = matched.segmentIndex + 2;
  while (Math.hypot(forward.x - originX, forward.y - originY) < 10 && nextIndex < matched.points.length) {
    forward = map.project([matched.points[nextIndex][1], matched.points[nextIndex][0]]);
    nextIndex += 1;
  }
  const dx = forward.x - originX;
  const dy = forward.y - originY;
  if (Math.hypot(dx, dy) < 1) return null;
  const snappedCoordinate = map.unproject([originX, originY]);
  const geographicBearing = bearingBetweenMapPoints(
    matched.points[matched.segmentIndex],
    matched.points[Math.min(nextIndex - 1, matched.points.length - 1)]
  );
  return {
    heading: (Math.atan2(dx, -dy) * 180) / Math.PI,
    bearing: geographicBearing,
    lng: snappedCoordinate.lng,
    lat: snappedCoordinate.lat,
    // How far the live position sat from the route, so callers can decline the
    // snap when the driver has clearly left it.
    distanceMeters: geoDistanceMeters(location.lat, location.lng, snappedCoordinate.lat, snappedCoordinate.lng),
  };
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
  const routeLinesRef = useRef(routeLines);
  const truckMarkersRef = useRef(new Map<string, TruckMarkerEntry>());
  const dropPinMarkersRef = useRef(new Map<string, DropPinMarkerEntry>());
  const routeLayerIdsRef = useRef<string[]>([]);
  const routeSourceIdsRef = useRef<string[]>([]);
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

  useEffect(() => {
    routeLinesRef.current = routeLines;
  }, [routeLines]);

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

    const syncTruckRotations = () => {
      const bearing = map.getBearing();
      truckMarkersRef.current.forEach(({ element }) => {
        const heading = Number(element.dataset.routeHeading);
        const lat = Number(element.dataset.markerLat);
        const lng = Number(element.dataset.markerLng);
        const projectedPlacement = Number.isFinite(lat) && Number.isFinite(lng)
          ? projectedRoutePlacement(map, { lat, lng }, routeLinesRef.current)
          : null;
        // The route-derived geographic heading keeps the completed path behind
        // the truck; projected upcoming geometry is only a fallback.
        if (Number.isFinite(heading)) {
          rotateTruckElement(element, heading, bearing);
        } else if (projectedPlacement && Number.isFinite(projectedPlacement.heading)) {
          applyTruckScreenHeading(element, projectedPlacement.heading);
        }
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
      const projectedPlacement = projectedRoutePlacement(map, location, routeLinesRef.current);
      // Only snap the marker onto the route while the driver is actually near it;
      // once off-route the marker follows the live position so it never freezes.
      const onRoutePlacement =
        projectedPlacement && projectedPlacement.distanceMeters <= NAVIGATION_OFF_ROUTE_SNAP_METERS
          ? projectedPlacement
          : null;
      const markerLat = onRoutePlacement?.lat ?? location.lat;
      const markerLng = onRoutePlacement?.lng ?? location.lng;
      entry.marker.setLngLat([markerLng, markerLat]);
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
      entry.element.dataset.markerLat = String(markerLat);
      entry.element.dataset.markerLng = String(markerLng);
      entry.element.querySelectorAll<HTMLElement>('[data-truck-image]').forEach((image) => {
        image.style.display = image.dataset.mode === (is3DPerspective ? '3d' : '2d') ? 'block' : 'none';
      });
      if (hasRouteHeading) {
        rotateTruckElement(entry.element, heading, map.getBearing());
      } else if (projectedPlacement && Number.isFinite(projectedPlacement.heading)) {
        applyTruckScreenHeading(entry.element, projectedPlacement.heading);
      }
    });
    truckMarkersRef.current.forEach((entry, id) => {
      if (!activeTruckIds.has(id)) {
        entry.marker.remove();
        truckMarkersRef.current.delete(id);
      }
    });

  // Fix: road snapping completes after the GPS update. Resync the truck when
  // that geometry changes so the completed path always ends behind the icon.
  }, [is3DPerspective, locations, routeSignature, showDriverSelfBadge]);

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
    const features: GeoJSON.Feature[] = [];

    locations.filter((location) => location.markerType === 'pin').forEach((location) => {
      const roadCoordinate = nearestCoordinateOnRoutes(location, routeLines);
      if (!roadCoordinate) return;
      // Added: every drop point gets its own dotted bridge from the nearest
      // routed road coordinate to the order's exact stored coordinate.
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

    locations.filter((location) => location.markerType === 'truck').forEach((location) => {
      const actualLat = Number(location.actualLat);
      const actualLng = Number(location.actualLng);
      if (!Number.isFinite(actualLat) || !Number.isFinite(actualLng)) return;
      if (Math.abs(location.lat - actualLat) < 0.000001 && Math.abs(location.lng - actualLng) < 0.000001) return;

      // Added: keep the truck on the routed road and show its off-road GPS fix
      // as a small gray dotted bridge, matching standard navigation behavior.
      features.push({
        type: 'Feature',
        properties: { id: String(location.id) },
        geometry: {
          type: 'LineString',
          coordinates: [
            [location.lng, location.lat],
            [actualLng, actualLat],
          ],
        },
      });
      features.push({
        type: 'Feature',
        properties: { id: String(location.id) },
        geometry: { type: 'Point', coordinates: [actualLng, actualLat] },
      });
    });
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
  }, [locations, routeLines, routeSignature]);

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
    const routeInteractionCleanups: Array<() => void> = [];
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
              'line-gradient': isUpcoming
                ? ['interpolate', ['linear'], ['line-progress'], 0, '#38bdf8', 0.48, '#2563eb', 1, '#1d4ed8']
                : isAlternative
                  ? ['interpolate', ['linear'], ['line-progress'], 0, '#bfdbfe', 0.5, '#93c5fd', 1, '#60a5fa']
                : ['interpolate', ['linear'], ['line-progress'], 0, '#94a3b8', 0.55, '#64748b', 1, '#475569'],
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
        if (line.selectable && onRouteLineSelect) {
          const selectRoute = (event: maplibregl.MapLayerMouseEvent) => {
            const hitLayerIds = routeLayerIdsRef.current.filter((layerId) => layerId.endsWith('-hit') && map.getLayer(layerId));
            const topRoute = hitLayerIds.length > 0
              ? map.queryRenderedFeatures(event.point, { layers: hitLayerIds })[0]
              : null;
            // Only the visually top route receives the tap where routes overlap.
            if (String(topRoute?.properties?.routeLineId || '') !== String(line.id)) return;
            onRouteLineSelect(line.id);
          };
          const showPointer = () => { map.getCanvas().style.cursor = 'pointer'; };
          const clearPointer = () => { map.getCanvas().style.cursor = ''; };
          map.on('click', hitLayerId, selectRoute);
          map.on('mouseenter', hitLayerId, showPointer);
          map.on('mouseleave', hitLayerId, clearPointer);
          routeInteractionCleanups.push(() => {
            map.off('click', hitLayerId, selectRoute);
            map.off('mouseenter', hitLayerId, showPointer);
            map.off('mouseleave', hitLayerId, clearPointer);
          });
        }
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
    if (map.loaded()) updateRoutes();
    else map.once('load', updateRoutes);
    return () => {
      map.off('load', updateRoutes);
      routeInteractionCleanups.forEach((cleanup) => cleanup());
      map.getCanvas().style.cursor = '';
    };
  }, [onRouteLineSelect, routeLines, routeSignature]);

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

    // Center the camera on the same route-snapped coordinate used by the truck
    // marker. This changes only the camera target, never GPS or route geometry.
    const candidatePlacement = truck
      ? projectedRoutePlacement(map, truck, routeLinesRef.current)
      : null;
    // Off-route, follow the live position instead of a stale point on the route.
    const routePlacement =
      candidatePlacement && candidatePlacement.distanceMeters <= NAVIGATION_OFF_ROUTE_SNAP_METERS
        ? candidatePlacement
        : null;
    const targetCenter = routePlacement
      ? [routePlacement.lng, routePlacement.lat] as [number, number]
      : truck
        ? [truck.lng, truck.lat] as [number, number]
        : [center[1], center[0]] as [number, number];
    const cameraHeading = routePlacement && typeof routePlacement.bearing === 'number' && Number.isFinite(routePlacement.bearing)
      ? normalizeMapAngle(routePlacement.bearing)
      : truckHeading;
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
  }, [center, is3DPerspective, navigationViewportInsets, recenterSignal, routeSignature, truck?.lat, truck?.lng, truckHeading]);

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
