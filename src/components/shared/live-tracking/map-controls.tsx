"use client";

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { clampPointToBounds, destinationPoint } from './geometry'
import { NAV_CAMERA_LOOKAHEAD_METERS } from './tuning'

export function MapBoundsGuard({ enabled, bounds }: { enabled: boolean; bounds: L.LatLngBounds | null }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled || !bounds) return;
    const guardedBounds = bounds;
    map.setMaxBounds(guardedBounds);
    const minRestrictedZoom = 11;
    if (map.getZoom() < minRestrictedZoom) {
      map.setZoom(minRestrictedZoom);
    }

    const center = map.getCenter();
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;

    if (!guardedBounds.contains(center)) {
      map.setView(guardedBounds.getCenter(), Math.max(map.getZoom(), 9), { animate: false });
    }
  }, [bounds, enabled, map]);

  return null;
}

export function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();
  useEffect(() => {
    onZoomChange(map.getZoom());
    const onZoom = () => onZoomChange(map.getZoom());
    map.on('zoom', onZoom);
    return () => {
      map.off('zoom', onZoom);
    };
  }, [map, onZoomChange]);
  return null;
}

export function NavigationCamera({
  enabled,
  truckPosition,
  truckHeading,
}: {
  enabled: boolean;
  truckPosition: [number, number] | null;
  truckHeading: number | null;
}) {
  const map = useMap();
  const lastViewRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!enabled || !truckPosition) return;
    const heading = truckHeading ?? 0;
    const lookAhead = destinationPoint(truckPosition[0], truckPosition[1], heading, NAV_CAMERA_LOOKAHEAD_METERS);
    const previous = lastViewRef.current;
    if (previous) {
      const latDiff = Math.abs(previous.lat - lookAhead.lat);
      const lngDiff = Math.abs(previous.lng - lookAhead.lng);
      if (latDiff < 0.00001 && lngDiff < 0.00001) {
        return;
      }
    }
    lastViewRef.current = { lat: lookAhead.lat, lng: lookAhead.lng };
    map.setView([lookAhead.lat, lookAhead.lng], map.getZoom(), { animate: false } as any);
  }, [enabled, map, truckHeading, truckPosition]);

  return null;
}

export function ManualRecenter({
  center,
  recenterSignal,
  bounds,
}: {
  center: [number, number];
  recenterSignal?: number;
  bounds: L.LatLngBounds | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (typeof recenterSignal !== 'number') return;
    if (!Array.isArray(center) || center.length !== 2) return;
    if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
    map.setView(clampPointToBounds(center, bounds), map.getZoom(), { animate: true } as any);
  }, [bounds, center, map, recenterSignal]);

  return null;
}

export function MapResizeSync() {
  const map = useMap();

  useEffect(() => {
    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;

    const invalidate = () => {
      if (cancelled) return;
      map.invalidateSize({ animate: false });
    };

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(invalidate);
    });

    const container = map.getContainer();
    const observer = 'ResizeObserver' in window
      ? new ResizeObserver(() => {
        window.requestAnimationFrame(invalidate);
      })
      : null;

    observer?.observe(container);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      observer?.disconnect();
    };
  }, [map]);

  return null;
}

export function NegrosMaskPane() {
  const map = useMap();

  useEffect(() => {
    const paneName = 'negros-mask-pane';
    if (!map.getPane(paneName)) {
      const pane = map.createPane(paneName);
      pane.style.zIndex = '650';
      pane.style.pointerEvents = 'none';
    }
  }, [map]);

  return null;
}
