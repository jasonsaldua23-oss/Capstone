export function normalizeMapAngle(value: number) {
  return ((value % 360) + 360) % 360;
}

export function shortestMapAngleDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

export function bearingBetweenMapPoints(from: [number, number], to: [number, number]) {
  const refLat = (from[0] + to[0]) / 2;
  const dx = (to[1] - from[1]) * Math.cos((refLat * Math.PI) / 180);
  const dy = to[0] - from[0];
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return null;
  return normalizeMapAngle((Math.atan2(dx, dy) * 180) / Math.PI);
}

export function resolveNavigationHeading(routeHeading: number | null | undefined, gpsHeading: number | null | undefined) {
  if (typeof routeHeading === 'number' && Number.isFinite(routeHeading)) return normalizeMapAngle(routeHeading);
  if (typeof gpsHeading === 'number' && Number.isFinite(gpsHeading) && gpsHeading >= 0) return normalizeMapAngle(gpsHeading);
  return null;
}

export function calculateTruckScreenRotation(routeHeading: number, cameraBearing: number, assetForwardHeading = 0) {
  return shortestMapAngleDelta(0, normalizeMapAngle(routeHeading - cameraBearing - assetForwardHeading));
}

export type NavigationViewportInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

type VerticalRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export function calculateNavigationViewportInsets(
  mapRect: VerticalRect,
  topOverlayRect?: VerticalRect | null,
  bottomOverlayRect?: VerticalRect | null
): NavigationViewportInsets {
  const height = Math.max(0, mapRect.bottom - mapRect.top);
  const top = topOverlayRect
    ? Math.max(0, Math.min(height, topOverlayRect.bottom - mapRect.top))
    : 0;
  const bottom = bottomOverlayRect
    ? Math.max(0, Math.min(height, mapRect.bottom - bottomOverlayRect.top))
    : 0;

  // Keep a usable camera viewport even while the drawer is nearly full-screen.
  // MapLibre centers the tracked coordinate in the area left by these insets.
  if (top + bottom >= height) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  // Equal horizontal insets keep the coordinate at the map's true width center.
  return { top, bottom, left: 0, right: 0 };
}
