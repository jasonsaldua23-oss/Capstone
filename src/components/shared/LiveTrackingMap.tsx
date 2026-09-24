"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, Tooltip, Polygon } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MapLibreNavigationMap, { type NavigationMapHandle, type NavigationTruckPose } from './MapLibreNavigationMap';
import {
  projectPointOntoRoute,
  quantizeRouteSplitMeters,
  splitRouteAtDistance,
  type NavigationViewportInsets,
} from '@/lib/map-navigation';
import type { DriverLocation, LiveRouteLine, SnappedPointOnRoute } from './live-tracking/types'
import {
  type NegrosBoundary,
  SILAY_TALISAY_FALLBACK_BOUNDS,
  type ServiceBoundary,
  WORLD_MASK_RING,
  geometryToExteriorRings,
  isPointInNegrosBoundary,
  loadNegrosBoundary,
  loadSilayTalisayServiceBoundary,
} from './live-tracking/boundaries'
import {
  approximateDistanceMeters,
  bearingAtRouteEnd,
  calculateBearingAlongRoute,
  clampPointToBounds,
  dedupeConsecutivePoints,
  expandBounds,
  fetchRoadSnappedPoints,
  nearestPointOnPolyline,
  normalizeAngle,
  roadSnappedRouteCache,
  shortestAngleDelta,
} from './live-tracking/geometry'
import { DefaultIcon, getStatusPinIcon, getTruckIcon } from './live-tracking/icons'
import {
  TRUCK_LOCAL_TANGENT_LOOKAHEAD_METERS,
  TRUCK_MAX_ROUTE_SNAP_METERS,
  TRUCK_ROUTE_LOOKAHEAD_METERS,
  TRUCK_SNAP_AFTER_SILENCE_MS,
} from './live-tracking/tuning'
import {
  ManualRecenter,
  MapBoundsGuard,
  MapResizeSync,
  NavigationCamera,
  NegrosMaskPane,
  ZoomTracker,
} from './live-tracking/map-controls'
import {
  acceptTruckFix,
  isTruckMotionSettled,
  snapTruckMotion,
  stepTruckMotion,
  truckMotionPose,
  type TruckMotion,
  type TruckMotionContext,
} from './live-tracking/truck-motion'

const MapContainerUnsafe = MapContainer as any;

const TileLayerUnsafe = TileLayer as any;

const MarkerUnsafe = Marker as any;

const PolylineUnsafe = Polyline as any;

const CircleMarkerUnsafe = CircleMarker as any;

const TooltipUnsafe = Tooltip as any;

const PolygonUnsafe = Polygon as any;

interface LiveTrackingMapProps {
  locations: DriverLocation[];
  center?: [number, number];
  zoom?: number;
  routeLines?: LiveRouteLine[];
  restrictToNegrosOccidental?: boolean;
  navigationPerspective?: boolean;
  is3DPerspective?: boolean;
  recenterSignal?: number;
  zoomInSignal?: number;
  zoomOutSignal?: number;
  navigationViewportInsets?: NavigationViewportInsets;
  showZoomControls?: boolean;
  showDriverSelfBadge?: boolean;
  onRouteLineSelect?: (routeLineId: string) => void;
  className?: string;
}

export default function LiveTrackingMap({
  locations,
  center = [39.8283, -98.5795],
  zoom = 4,
  routeLines = [],
  restrictToNegrosOccidental = false,
  navigationPerspective = false,
  is3DPerspective = false,
  recenterSignal,
  zoomInSignal,
  zoomOutSignal,
  navigationViewportInsets,
  showZoomControls = true,
  showDriverSelfBadge = false,
  onRouteLineSelect,
  className = "w-full h-[350px] rounded-xl overflow-hidden border shadow-sm",
}: LiveTrackingMapProps) {
  const rawSafeLocations = useMemo(
    () =>
      (locations || []).filter(
        (loc): loc is DriverLocation =>
          loc !== null &&
          loc !== undefined &&
          Number.isFinite(Number(loc.lat)) &&
          Number.isFinite(Number(loc.lng))
      ),
    [locations]
  );

  const rawSafeRouteLines = useMemo(
    () =>
      (routeLines || [])
        .map((line) => ({
          ...line,
          points: (line.points || []).filter(
            (point): point is [number, number] =>
              Array.isArray(point) &&
              point.length === 2 &&
              Number.isFinite(Number(point[0])) &&
              Number.isFinite(Number(point[1]))
          ),
        }))
        .filter((line) => line.points.length > 1),
    [routeLines]
  );

  const [smoothedLocations, setSmoothedLocations] = useState<DriverLocation[]>(
    // Navigation trucks are shown only after verified road geometry is available;
    // briefly hiding the icon is safer than ever presenting a raw off-road fix.
    navigationPerspective ? rawSafeLocations.filter((location) => location.markerType !== 'truck') : rawSafeLocations
  );
  const smoothedLocationsRef = useRef(smoothedLocations);
  const [snappedRoutePointsById, setSnappedRoutePointsById] = useState<Record<string, [number, number][]>>(
    () => Object.fromEntries(roadSnappedRouteCache.entries())
  );
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const [negrosBoundary, setNegrosBoundary] = useState<NegrosBoundary | null>(null);
  const [serviceBoundary, setServiceBoundary] = useState<ServiceBoundary | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTruckTargetAtRef = useRef<number | null>(null);
  // Motion model per truck. It outlives fixes and effects so the icon's velocity
  // and heading stay continuous from one fix to the next.
  const truckMotionRef = useRef<Map<string, TruckMotion>>(new Map());
  const navigationMapRef = useRef<NavigationMapHandle | null>(null);

  useEffect(() => {
    if (!restrictToNegrosOccidental) {
      window.queueMicrotask(() => {
        setNegrosBoundary(null);
        setServiceBoundary(null);
      });
      return;
    }

    let cancelled = false;

    const run = async () => {
      const boundary = await loadNegrosBoundary();
      const service = await loadSilayTalisayServiceBoundary();
      if (!cancelled) {
        setNegrosBoundary(boundary);
        setServiceBoundary(service);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [restrictToNegrosOccidental]);

  const safeLocations = useMemo(
    () =>
      restrictToNegrosOccidental
        ? serviceBoundary
          ? rawSafeLocations.filter((loc) => isPointInNegrosBoundary([loc.lat, loc.lng], serviceBoundary.geometries))
          : rawSafeLocations
        : rawSafeLocations,
    [rawSafeLocations, restrictToNegrosOccidental, serviceBoundary]
  );

  const safeRouteLines = useMemo(
    () =>
      restrictToNegrosOccidental
        ? serviceBoundary
          ? rawSafeRouteLines
            .map((line) => ({
              ...line,
              points: line.points.filter((point) => isPointInNegrosBoundary(point, serviceBoundary.geometries)),
            }))
            .filter((line) => line.points.length > 1)
          : rawSafeRouteLines
        : rawSafeRouteLines,
    [rawSafeRouteLines, restrictToNegrosOccidental, serviceBoundary]
  );

  const roadSnapSignature = useMemo(
    () =>
      safeRouteLines
        .filter((line) => line.snapToRoad)
        .map(
          (line) =>
            // Fix: ignore sub-road-scale GPS jitter so an in-flight OSRM request
            // can finish instead of being aborted for every tiny coordinate change.
            `${line.id}:${line.points.map((point) => `${point[0].toFixed(4)},${point[1].toFixed(4)}`).join('|')}`
        )
        .join('||'),
    [safeRouteLines]
  );

  useEffect(() => {
    const linesNeedingRoadSnap = safeRouteLines
      .filter((line) => line.snapToRoad && line.points.length > 1)
      // Fix: snap the taken route first so its arrival tangent can constrain the
      // upcoming route to leave from the front of the truck instead of its rear.
      .sort((a, b) => Number(b.id.endsWith('-route-completed')) - Number(a.id.endsWith('-route-completed')));
    if (linesNeedingRoadSnap.length === 0) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      const nextSnappedLines: Record<string, [number, number][]> = {};
      let sharedDriverRoadPoint: [number, number] | null = null;
      let sharedDriverBearing: number | null = null;
      for (const line of linesNeedingRoadSnap) {
        try {
          const isCompletedPath = line.id.endsWith('-route-completed');
          const isUpcomingPath = line.id.endsWith('-route-upcoming');
          const routeInputPoints = isUpcomingPath && sharedDriverRoadPoint
            ? [sharedDriverRoadPoint, ...line.points.slice(1)]
            : line.points;
          const snappedPoints = await fetchRoadSnappedPoints(
            routeInputPoints,
            controller.signal,
            isUpcomingPath ? sharedDriverBearing : null
          );

          const anchoredSnappedPoints = [...snappedPoints];
          if (line.preserveExactEndpoints) {
            // Driver Portal only: keep the path attached to the live/raw GPS endpoint.
            const startPoint = routeInputPoints[0];
            const endPoint = routeInputPoints[routeInputPoints.length - 1];
            const samePoint = (left: [number, number], right: [number, number]) =>
              Math.abs(left[0] - right[0]) < 0.000001 && Math.abs(left[1] - right[1]) < 0.000001;
            if (startPoint && anchoredSnappedPoints[0] && !samePoint(startPoint, anchoredSnappedPoints[0])) {
              anchoredSnappedPoints.unshift(startPoint);
            }
            if (
              endPoint &&
              anchoredSnappedPoints[anchoredSnappedPoints.length - 1] &&
              !samePoint(endPoint, anchoredSnappedPoints[anchoredSnappedPoints.length - 1])
            ) {
              anchoredSnappedPoints.push(endPoint);
            }
          }

          if (isCompletedPath && anchoredSnappedPoints.length > 1) {
            // The completed route defines both the truck junction and the
            // direction of travel through that junction.
            sharedDriverRoadPoint = anchoredSnappedPoints[anchoredSnappedPoints.length - 1];
            sharedDriverBearing = bearingAtRouteEnd(anchoredSnappedPoints);
          }
          if (anchoredSnappedPoints.length > 1) {
            nextSnappedLines[line.id] = anchoredSnappedPoints;
          }
        } catch {
          // Keep the line hidden rather than drawing a shortcut across buildings.
        }
        if (cancelled) return;
      }

      // Preserve the last successful road geometry during transient OSRM errors.
      Object.entries(nextSnappedLines).forEach(([lineId, points]) => {
        roadSnappedRouteCache.set(lineId, points);
      });
      setSnappedRoutePointsById((previous) => ({ ...previous, ...nextSnappedLines }));
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roadSnapSignature]);

  const renderedRouteLines = useMemo(
    () =>
      safeRouteLines.flatMap((line) => {
        if (!line.snapToRoad) return [line];
        const snappedPoints = snappedRoutePointsById[line.id];
        // Only render verified road geometry; never draw a shortcut across buildings.
        if (!snappedPoints || snappedPoints.length < 2) return [];
        return [{ ...line, points: snappedPoints }];
      }),
    [safeRouteLines, snappedRoutePointsById]
  );

  const completedRouteHeading = useMemo(() => {
    const completedRoute = renderedRouteLines.find((line) => line.id.endsWith('-route-completed'));
    return completedRoute && completedRoute.points.length > 1
      ? bearingAtRouteEnd(completedRoute.points)
      : null;
  }, [renderedRouteLines]);

  const navigationRouteGeometry = useMemo(() => {
    const completed = renderedRouteLines.find((line) => line.id.endsWith('-route-completed'));
    const upcoming = renderedRouteLines.find((line) => line.id.endsWith('-route-upcoming'));
    if (!completed && !upcoming) return [] as [number, number][];

    // The completed and upcoming lines share the truck junction. Joining them
    // produces one authoritative road geometry for projection and animation.
    return dedupeConsecutivePoints([
      ...(completed?.points || []),
      ...(upcoming?.points || []),
    ]);
  }, [renderedRouteLines]);
  const navigationRouteKey = useMemo(
    () => renderedRouteLines
      .filter((line) => line.id.endsWith('-route-completed') || line.id.endsWith('-route-upcoming'))
      // Route-relative distances are valid only for the exact geometry on which
      // they were measured. Include its coordinates so reroutes reset progress.
      .map((line) => `${line.id}:${line.points.map((point) => `${point[0].toFixed(6)},${point[1].toFixed(6)}`).join('|')}`)
      .join('|'),
    [renderedRouteLines]
  );

  const routeOriginPoint = useMemo<[number, number] | null>(() => {
    const warehouseOrigin = renderedRouteLines.find((line) => line.id.endsWith('-route-origin'))?.points[0];
    if (warehouseOrigin) return warehouseOrigin;
    const routePolylines = renderedRouteLines
      .map((line) => ({
        points: line.points,
        priority: line.color === '#2563eb' && !line.dashArray ? 0 : 1,
      }))
      .filter(
        (line): line is { points: [number, number][]; priority: number } =>
          Array.isArray(line.points) && line.points.length > 1
      )
      .sort((a, b) => a.priority - b.priority);
    if (routePolylines.length === 0) return null;
    const first = routePolylines[0]?.points?.[0];
    return Array.isArray(first) && Number.isFinite(first[0]) && Number.isFinite(first[1]) ? first : null;
  }, [renderedRouteLines]);

  useEffect(() => {
    L.Marker.prototype.options.icon = DefaultIcon;
  }, []);

  const snappedLocations = useMemo(() => {
    const routePolylines = renderedRouteLines
      .map((line) => ({
        points: line.points,
        priority: line.color === '#2563eb' && !line.dashArray ? 0 : 1,
      }))
      .filter(
        (line): line is { points: [number, number][]; priority: number } =>
          Array.isArray(line.points) && line.points.length > 1
      )
      .sort((a, b) => a.priority - b.priority);
    const preferredPolylines = routePolylines.filter((line) => line.priority === 0);
    const snapTargetPolylines = preferredPolylines.length > 0 ? preferredPolylines : routePolylines;

    return safeLocations.flatMap((loc) => {
      if (loc.markerType !== 'truck') return [loc];
      // Fix: never hide the truck while route geometry is briefly unavailable
      // (initial load, reroute in flight, OSRM hiccup) — that read as the
      // vehicle "jumping" when it reappeared moments later at a new spot.
      if (snapTargetPolylines.length === 0) return [loc];

      // Fix: every GPS fix is independently map-matched. Using the prior route
      // junction here made the marker lag behind instead of following the driver.
      const authoritativeRoadPoint: [number, number] = [loc.lat, loc.lng];

      let bestSnap: SnappedPointOnRoute | null = null;
      let bestPolyline: [number, number][] | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      const expectedHeading =
        typeof loc.markerHeading === 'number' && Number.isFinite(loc.markerHeading)
          ? normalizeAngle(loc.markerHeading)
          : null;

      for (const polyline of snapTargetPolylines) {
        const candidate = nearestPointOnPolyline(authoritativeRoadPoint, polyline.points);
        if (!candidate) continue;

        const distanceMeters = approximateDistanceMeters(authoritativeRoadPoint, candidate.point);
        const candidateForwardHeading =
          calculateBearingAlongRoute(candidate, polyline.points, TRUCK_LOCAL_TANGENT_LOOKAHEAD_METERS) ??
          (Number.isFinite(candidate.heading) ? normalizeAngle(candidate.heading) : null);
        const headingPenaltyMeters =
          expectedHeading !== null && typeof candidateForwardHeading === 'number'
            ? Math.min(
              Math.abs(shortestAngleDelta(expectedHeading, candidateForwardHeading)),
              Math.abs(shortestAngleDelta(expectedHeading, normalizeAngle(candidateForwardHeading + 180)))
            ) * 0.2
            : 0;
        const score = distanceMeters + headingPenaltyMeters;

        if (score < bestScore) {
          bestScore = score;
          bestSnap = candidate;
          bestPolyline = polyline.points;
        }
      }

      if (!bestSnap || !bestPolyline) {
        return [loc];
      }

      // Fix: do not pin a detouring driver to the old road before the off-route
      // check can see the actual deviation. GPS remains live while rerouting.
      if (navigationPerspective && approximateDistanceMeters(authoritativeRoadPoint, bestSnap.point) > TRUCK_MAX_ROUTE_SNAP_METERS) {
        return [loc];
      }

      // Prefer a short local lookahead so orientation follows each turn on the active route.
      const localForwardHeading = calculateBearingAlongRoute(
        bestSnap,
        bestPolyline,
        TRUCK_LOCAL_TANGENT_LOOKAHEAD_METERS
      );
      const segmentHeading =
        typeof bestSnap.heading === 'number' && Number.isFinite(bestSnap.heading)
          ? normalizeAngle(bestSnap.heading)
          : null;
      const routeHeading = calculateBearingAlongRoute(bestSnap, bestPolyline, TRUCK_ROUTE_LOOKAHEAD_METERS);
      // Fix: navigation follows the segment beneath the vehicle; looking ahead
      // across a bend would tilt its body before it reaches the turn.
      const headingCandidate =
        navigationPerspective && typeof segmentHeading === 'number'
          ? segmentHeading
          : typeof localForwardHeading === 'number' && Number.isFinite(localForwardHeading)
          ? normalizeAngle(localForwardHeading)
          : typeof routeHeading === 'number' && Number.isFinite(routeHeading)
            ? normalizeAngle(routeHeading)
            : typeof completedRouteHeading === 'number' && Number.isFinite(completedRouteHeading)
              ? normalizeAngle(completedRouteHeading)
              : typeof segmentHeading === 'number'
                ? segmentHeading
                : typeof loc.markerHeading === 'number' && Number.isFinite(loc.markerHeading)
                  ? normalizeAngle(loc.markerHeading)
                  : undefined;
      // Fix: when the driver's actual GPS heading disagrees with the route
      // tangent by more than 90°, reverse the navigation icon along the road
      // so its body stays aligned even when the GPS heading is noisy.
      const gpsHeading =
        typeof loc.markerHeading === 'number' && Number.isFinite(loc.markerHeading) && loc.markerHeading >= 0
          ? normalizeAngle(loc.markerHeading)
          : null;
      const routeDerivedHeading =
        typeof headingCandidate === 'number' ? headingCandidate : null;
      const snappedHeading = (() => {
        if (gpsHeading !== null && routeDerivedHeading !== null) {
          const delta = Math.abs(shortestAngleDelta(gpsHeading, routeDerivedHeading));
          // A delta > 90° means the driver is heading roughly opposite to the
          // route tangent; navigation still keeps the body parallel to the road.
          if (delta > 90) return navigationPerspective ? normalizeAngle(routeDerivedHeading + 180) : gpsHeading;
        }
        return headingCandidate;
      })();

      return [{
        ...loc,
        // Preserve raw GPS separately while the visible truck stays on the road.
        actualLat: loc.lat,
        actualLng: loc.lng,
        lat: bestSnap.point[0],
        lng: bestSnap.point[1],
        markerHeading: snappedHeading,
      }];
    });
  }, [completedRouteHeading, navigationPerspective, safeLocations, renderedRouteLines]);

  // Fix: unrelated portal renders must not restart the interpolation clock.
  const truckTargetSignature = useMemo(() => JSON.stringify(snappedLocations), [snappedLocations]);
  const [mapVisibilityEpoch, setMapVisibilityEpoch] = useState(0);
  useEffect(() => {
    const refresh = () => setMapVisibilityEpoch((value) => value + 1);
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);
  useEffect(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const receivedAt = performance.now();
    const observedUpdateInterval = lastTruckTargetAtRef.current === null ? 0 : receivedAt - lastTruckTargetAtRef.current;
    lastTruckTargetAtRef.current = receivedAt;
    const stabilizedTargets = snappedLocations.map((location) => {
      if (location.markerType !== 'truck' || navigationRouteGeometry.length < 2) {
        return location;
      }

      const projected = projectPointOntoRoute(
        [location.actualLat ?? location.lat, location.actualLng ?? location.lng], navigationRouteGeometry
      );
      if (!projected) return location;

      // Off-route: the icon tracks the live position until the replacement route loads.
      if (projected.distanceFromRouteMeters > TRUCK_MAX_ROUTE_SNAP_METERS) return location;

      // Each fix goes to the motion model where it actually lies on the road. The
      // model holds a parked icon and never backs a moving one up for GPS noise.
      // A progress clamp here used to keep the furthest point reached instead: it
      // latched onto any fix that landed ahead, held that while the vehicle stood,
      // and the icon drove to where the van had never been, then reversed.
      return {
        ...location,
        lat: projected.point[0],
        lng: projected.point[1],
        routeProgressMeters: projected.distanceAlongMeters,
      };
    });

    // One effect owns one animation loop; React state updaters must not schedule side effects.
    const motionById = truckMotionRef.current;
    const contextAt = (nowMs: number): TruckMotionContext => ({
      route: navigationRouteGeometry,
      routeKey: navigationRouteKey,
      predict: navigationPerspective,
      nowMs,
    });
    const liveTruckIds = new Set(
      stabilizedTargets.filter((location) => location.markerType === 'truck').map((location) => location.id)
    );
    for (const id of Array.from(motionById.keys())) {
      if (!liveTruckIds.has(id)) motionById.delete(id);
    }

    // Browsers suspend painting in the background, and a fix that is a minute
    // late describes a journey worth no replay. Snap to the fix in either case;
    // otherwise fold it into the motion model, which moves the icon over the
    // following frames without ever jumping it.
    const snapToFix = document.hidden || observedUpdateInterval > TRUCK_SNAP_AFTER_SILENCE_MS;
    const arrival = contextAt(receivedAt);
    for (const target of stabilizedTargets) {
      if (target.markerType !== 'truck') continue;
      const previous = motionById.get(target.id);
      motionById.set(
        target.id,
        snapToFix ? snapTruckMotion(previous, target, arrival) : acceptTruckFix(previous, target, arrival)
      );
    }

    // Re-render only when a truck has actually moved or turned; the loop also
    // runs frames in which nothing changes by a visible amount.
    let lastPublishedKey = '';
    let lastRenderedKey = '';
    const publish = () => {
      const poses: string[] = [];
      const renderKeys: string[] = [];
      const truckPoses: NavigationTruckPose[] = [];
      const nextLocations = stabilizedTargets.map((target) => {
        if (target.markerType !== 'truck') return target;
        const motion = motionById.get(target.id);
        if (!motion) return target;
        const pose = truckMotionPose(motion, navigationRouteGeometry);
        poses.push(`${target.id}:${pose.point[0].toFixed(7)},${pose.point[1].toFixed(7)},${pose.heading?.toFixed(2) ?? ''}`);
        renderKeys.push(`${target.id}:${typeof pose.routeProgressMeters === 'number'
          ? quantizeRouteSplitMeters(pose.routeProgressMeters)
          : `${pose.point[0].toFixed(5)},${pose.point[1].toFixed(5)}`}`);
        truckPoses.push({ id: target.id, lat: pose.point[0], lng: pose.point[1], heading: pose.heading ?? target.markerHeading });
        return {
          ...target,
          lat: pose.point[0],
          lng: pose.point[1],
          routeProgressMeters: pose.routeProgressMeters ?? target.routeProgressMeters,
          markerHeading: pose.heading ?? target.markerHeading,
        };
      });
      const key = poses.join('|');
      if (key === lastPublishedKey) return;
      lastPublishedKey = key;
      if (navigationPerspective) {
        // The navigation map draws the truck and moves its camera right here, in
        // this animation frame. A React render every frame committed later, in a
        // task of its own, so the map drew some frames before the truck had moved
        // and the next ones twice as far: the stutter. React now redraws only
        // what follows the truck coarsely, the grey/blue split every 2 m.
        navigationMapRef.current?.moveTrucks(truckPoses);
        const renderKey = renderKeys.join('|');
        if (renderKey === lastRenderedKey) return;
        lastRenderedKey = renderKey;
      }
      // Keep reroute continuity synchronized with the exact interpolated
      // frame that also drives the grey/active route split.
      smoothedLocationsRef.current = nextLocations;
      setSmoothedLocations(nextLocations);
    };

    publish();
    if (snapToFix) return;

    const animate = (now: number) => {
      const frame = contextAt(now);
      let settled = true;
      for (const [id, motion] of motionById) {
        const next = stepTruckMotion(motion, frame);
        motionById.set(id, next);
        if (!isTruckMotionSettled(next, frame)) settled = false;
      }
      publish();
      // The loop ends when every icon has stopped moving and turning, and the
      // next fix starts it again.
      animationFrameRef.current = settled ? null : window.requestAnimationFrame(animate);
    };
    animationFrameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [navigationPerspective, navigationRouteKey, truckTargetSignature, mapVisibilityEpoch]);

  const singleTruck = smoothedLocations.filter((loc) => loc.markerType === 'truck');
  const navTruck = singleTruck.length === 1 ? singleTruck[0] : null;
  // The truck's position changes every animation frame, but the grey/blue
  // junction only has to follow it to within a couple of metres. Quantizing the
  // split distance keeps this memo — and therefore the entire route payload
  // handed to the navigation map — stable across most frames, instead of
  // rebuilding every source and layer 60 times a second.
  const navTruckSplitDistance = useMemo(() => {
    if (navigationRouteGeometry.length < 2 || !navTruck) return null;
    const projected = typeof navTruck.routeProgressMeters === 'number'
      ? navTruck.routeProgressMeters
      : projectPointOntoRoute([navTruck.lat, navTruck.lng], navigationRouteGeometry)?.distanceAlongMeters;
    if (typeof projected !== 'number') return null;
    return quantizeRouteSplitMeters(projected);
  }, [navTruck, navigationRouteGeometry]);
  const [traveledRouteSections, setTraveledRouteSections] = useState<LiveRouteLine[]>([]);
  const lastTraveledSectionRef = useRef<{ routeKey: string; routeId: string; line: LiveRouteLine } | null>(null);
  const upcomingRouteId = renderedRouteLines.find((line) => line.id.endsWith('-route-upcoming'))?.id;
  useEffect(() => {
    // Capture history with the displayed map frame, after the new route is committed.
    const frame = window.requestAnimationFrame(() => {
      const previous = lastTraveledSectionRef.current;
      if (previous && previous.routeId !== upcomingRouteId) {
        // Fix: history belongs to this trip only, never to the next selected trip.
        setTraveledRouteSections([]);
        lastTraveledSectionRef.current = null;
      } else if (previous && previous.routeKey !== navigationRouteKey) {
        // Fix: retain only the portion actually traveled before replacing the route.
        if (previous.line.points.length > 1) {
          setTraveledRouteSections((sections) => [...sections, {
            ...previous.line, id: `${previous.routeId}-history-${sections.length}`,
          }]);
        }
        lastTraveledSectionRef.current = null;
      }
      const template = renderedRouteLines.find((line) => line.id === upcomingRouteId);
      if (!template || navTruckSplitDistance === null || !navTruck) return;
      const projection = projectPointOntoRoute(
        [navTruck.actualLat ?? navTruck.lat, navTruck.actualLng ?? navTruck.lng], navigationRouteGeometry
      );
      // A detour must not mark an untraveled part of the old route as completed.
      if (!projection || projection.distanceFromRouteMeters > TRUCK_MAX_ROUTE_SNAP_METERS) return;
      lastTraveledSectionRef.current = {
        routeKey: navigationRouteKey, routeId: template.id,
        line: { ...template, points: splitRouteAtDistance(navigationRouteGeometry, navTruckSplitDistance).completed,
          color: '#6b7280', selectable: false, snapToRoad: false },
      };
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigationRouteKey, upcomingRouteId, navTruckSplitDistance, navigationRouteGeometry, renderedRouteLines, navTruck]);
  const navigationDisplayRouteLines = useMemo(() => {
    if (navigationRouteGeometry.length < 2 || navTruckSplitDistance === null) return renderedRouteLines;

    // Gray and active route sections are split at the same road position the
    // truck is travelling along, so progress grows continuously with it.
    const split = splitRouteAtDistance(navigationRouteGeometry, navTruckSplitDistance);
    const completedTemplate = renderedRouteLines.find((line) => line.id.endsWith('-route-completed'));
    const upcomingTemplate = renderedRouteLines.find((line) => line.id.endsWith('-route-upcoming'));
    const unrelatedLines = renderedRouteLines.filter(
      (line) => !line.id.endsWith('-route-completed') && !line.id.endsWith('-route-upcoming')
    );
    const completedLine: LiveRouteLine = {
      ...(completedTemplate || upcomingTemplate!),
      id: completedTemplate?.id || `${upcomingTemplate?.id || 'navigation-route'}-completed`,
      points: split.completed,
      color: '#6b7280',
    };
    const upcomingLine: LiveRouteLine = {
      ...(upcomingTemplate || completedTemplate!),
      id: upcomingTemplate?.id || `${completedTemplate?.id || 'navigation-route'}-upcoming`,
      points: split.remaining,
      color: '#2563eb',
    };
    return [
      ...unrelatedLines,
      // Traveled grey stays above overlapping alternative routes; the active blue segment stays on top.
      ...traveledRouteSections,
      ...(completedLine.points.length > 1 ? [completedLine] : []),
      ...(upcomingLine.points.length > 1 ? [upcomingLine] : []),
    ];
  }, [navTruckSplitDistance, navigationRouteGeometry, renderedRouteLines, traveledRouteSections]);

  const strictBounds = restrictToNegrosOccidental
    ? serviceBoundary
      ? L.latLngBounds([serviceBoundary.bbox[1], serviceBoundary.bbox[0]], [serviceBoundary.bbox[3], serviceBoundary.bbox[2]])
      : L.latLngBounds(SILAY_TALISAY_FALLBACK_BOUNDS[0], SILAY_TALISAY_FALLBACK_BOUNDS[1])
    : null;
  const activeBounds = useMemo(() => {
    if (!strictBounds) return null;
    // Add map-only panning space so mountain-side and edge territories are easy to explore.
    return expandBounds(strictBounds, 0.05, 0.10);
  }, [strictBounds]);
  const serviceMaskRings = useMemo(
    () => (serviceBoundary?.geometries || []).flatMap((geometry) => geometryToExteriorRings(geometry)),
    [serviceBoundary]
  );
  const resolvedCenter =
    useMemo(() => (
      restrictToNegrosOccidental && Array.isArray(center) && center.length === 2
        ? clampPointToBounds(center, activeBounds)
        : center
    ), [restrictToNegrosOccidental, center, activeBounds]);

  if (navigationPerspective) {
    return (
      <MapLibreNavigationMap
        ref={navigationMapRef}
        locations={smoothedLocations}
        center={resolvedCenter}
        zoom={zoom}
        routeLines={navigationDisplayRouteLines}
        is3DPerspective={is3DPerspective}
        recenterSignal={recenterSignal}
        zoomInSignal={zoomInSignal}
        zoomOutSignal={zoomOutSignal}
        navigationViewportInsets={navigationViewportInsets}
        showDriverSelfBadge={showDriverSelfBadge}
        onRouteLineSelect={onRouteLineSelect}
        className={className}
      />
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <MapContainerUnsafe
        center={resolvedCenter}
        zoom={zoom}
        scrollWheelZoom={true}
        inertia={false}
        bounceAtZoomLimits={false}
        className="absolute inset-0 h-full w-full z-0"
        zoomControl={showZoomControls}
        zoomAnimation={false}
        markerZoomAnimation={false}
        preferCanvas
        minZoom={restrictToNegrosOccidental ? 11 : undefined}
        maxZoom={22}
        bounds={activeBounds ?? undefined}
        maxBounds={activeBounds ?? undefined}
        maxBoundsViscosity={restrictToNegrosOccidental ? 0.2 : undefined}
      >
        <MapResizeSync />
        <NegrosMaskPane />
        <ZoomTracker onZoomChange={setCurrentZoom} />
        <MapBoundsGuard enabled={restrictToNegrosOccidental} bounds={activeBounds} />
        <ManualRecenter center={center} recenterSignal={recenterSignal} bounds={activeBounds} />
        <NavigationCamera
          enabled={Boolean(navTruck)}
          truckPosition={navTruck ? [navTruck.lat, navTruck.lng] : null}
          truckHeading={
            navTruck && typeof navTruck.markerHeading === 'number' && Number.isFinite(navTruck.markerHeading)
              ? navTruck.markerHeading
              : null
          }
        />
        <TileLayerUnsafe
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxNativeZoom={19}
          maxZoom={22}
          noWrap={restrictToNegrosOccidental}
        />
        {restrictToNegrosOccidental && serviceMaskRings.length > 0 ? (
          <PolygonUnsafe
            positions={[WORLD_MASK_RING, ...serviceMaskRings]}
            pane="negros-mask-pane"
            interactive={false}
            pathOptions={{
              stroke: false,
              fillColor: '#7fb3c4',
              fillOpacity: 0.72,
              fillRule: 'evenodd',
              opacity: 1,
            }}
          />
        ) : null}
        {restrictToNegrosOccidental && serviceMaskRings.length > 0
          ? serviceMaskRings.map((ring, index) => (
            <PolygonUnsafe
              key={`service-outline-${index}`}
              positions={ring}
              pane="negros-mask-pane"
              interactive={false}
              pathOptions={{
                color: '#1d4ed8',
                weight: 2,
                fillOpacity: 0,
                opacity: 0.95,
              }}
            />
          ))
          : null}
        {navigationDisplayRouteLines.map((line) =>
          Array.isArray(line.points) && line.points.length > 1 ? (
            <Fragment key={line.id}>
              {(() => {
                const rawColor = String(line.color || '').toLowerCase();
                const isUpcoming = rawColor === '#2563eb' && !line.dashArray;
                const isFuture = rawColor === '#93c5fd' && !line.dashArray;
                const isCompletedLike = Boolean(line.dashArray) || (!isUpcoming && !isFuture);
                // Future routes are light blue; only traveled routes use gray.
                const outerColor = isUpcoming ? '#7ddfff' : isFuture ? '#bfdbfe' : '#2f3743';
                const innerColor = isUpcoming ? '#2ecbff' : isFuture ? '#93c5fd' : '#4b5563';
                const outerOpacity = isUpcoming ? 0.42 : 0.32;
                const innerOpacity = typeof line.opacity === 'number' ? line.opacity : isUpcoming ? 0.99 : 0.93;
                const zoomScale = currentZoom <= 10 ? 0.58 : currentZoom <= 11 ? 0.68 : currentZoom <= 12 ? 0.8 : currentZoom <= 13 ? 0.9 : currentZoom <= 14 ? 0.96 : 1;
                const baseInnerWeight = isUpcoming ? 7.2 : 6.8;
                const baseOuterWeight = isUpcoming ? 9.4 : 8.8;
                const outerWeight = Math.max(5.9, Math.round(baseOuterWeight * zoomScale * 10) / 10);
                const innerWeight = Math.max(4.8, Math.round(baseInnerWeight * zoomScale * 10) / 10);
                const centerWeight = Math.max(1.6, Math.round((isUpcoming ? 1.9 : 1.75) * zoomScale * 10) / 10);
                const centerDash = isCompletedLike ? '1 12' : '2 10';
                const centerOffset = isCompletedLike ? '0.5' : '0';

                return (
                  <>
                    <PolylineUnsafe
                      key={`${line.id}-outer`}
                      positions={line.points}
                      pathOptions={{
                        color: outerColor,
                        weight: outerWeight,
                        opacity: outerOpacity,
                        lineCap: 'round',
                        lineJoin: 'round',
                      }}
                    />
                    <PolylineUnsafe
                      key={`${line.id}-base`}
                      positions={line.points}
                      pathOptions={{
                        color: innerColor,
                        weight: innerWeight,
                        opacity: innerOpacity,
                        lineCap: 'round',
                        lineJoin: 'round',
                      }}
                    >
                      {line.label ? <Popup>{line.label}</Popup> : null}
                    </PolylineUnsafe>
                    <PolylineUnsafe
                      key={`${line.id}-center`}
                      positions={line.points}
                      pathOptions={{
                        color: '#f8fafc',
                        weight: centerWeight,
                        opacity: isUpcoming ? 0.55 : 0.9,
                        dashArray: centerDash,
                        dashOffset: centerOffset,
                        lineCap: 'round',
                        lineJoin: 'round',
                      }}
                    />
                  </>
                );
              })()}
            </Fragment>
          ) : null
        )}

        {routeOriginPoint ? (
          <CircleMarkerUnsafe
            center={routeOriginPoint}
            radius={7}
            pathOptions={{ color: '#111827', fillColor: '#9ca3af', fillOpacity: 0.95 }}
          />
        ) : null}

        {smoothedLocations.map((loc) =>
          loc.markerType === 'pin' ? (
            (() => {
              const normalizedStatus = String(loc.status || '').toUpperCase();
              const markerColor = String(loc.markerColor || '').toLowerCase();
              const pinColor: 'green' | 'blue' | 'red' | 'orange' =
                markerColor === '#ef4444'
                  ? 'red'
                  : markerColor === '#f59e0b'
                    ? 'orange'
                    : (
                      loc.markerEtaPhase === 'completed' ||
                      normalizedStatus === 'COMPLETED' ||
                      normalizedStatus === 'DELIVERED'
                    )
                      ? 'blue'
                      : 'green';
              return (
                <MarkerUnsafe
                  key={loc.id}
                  position={[loc.lat, loc.lng]}
                  icon={getStatusPinIcon(pinColor, loc.markerNumber)}
                >
                  {loc.markerEta ? (
                    <TooltipUnsafe
                      permanent
                      direction="top"
                      offset={[0, -34]}
                      opacity={1}
                      interactive={false}
                      className={`map-eta-tooltip map-eta-${loc.markerEtaPhase || 'upcoming'}`}
                    >
                      {loc.markerEta}
                    </TooltipUnsafe>
                  ) : null}
                  <Popup>
                    <div className="text-sm" style={{ minWidth: 180, maxWidth: 260 }}>
                      <p className="font-bold text-base mb-1">{loc.popupCustomerName || loc.driverName}</p>
                      <p className="text-gray-600">{loc.popupAddress || loc.markerLabel || `Vehicle: ${loc.vehiclePlate}`}</p>
                      <p className="text-gray-600">
                        Status: <span className="capitalize">{loc.status.replace(/_/g, ' ').toLowerCase()}</span>
                      </p>
                      {Array.isArray(loc.popupOrderItems) && loc.popupOrderItems.length > 0 ? (
                        <div style={{ marginTop: 8, borderTop: '1px solid #e5e7eb', paddingTop: 6 }}>
                          <p style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Ordered Items</p>
                          {loc.popupOrderItems.slice(0, 8).map((item, idx) => (
                            <p key={idx} style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.4, margin: 0 }}>{item.name} — {item.qty}</p>
                          ))}
                          {loc.popupOrderItems.length > 8 ? (
                            <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>+{loc.popupOrderItems.length - 8} more item(s)</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </Popup>
                </MarkerUnsafe>
              )
            })()
          ) : loc.markerType === 'truck' ? (
            <Fragment key={loc.id}>
              <CircleMarkerUnsafe
                center={[loc.lat, loc.lng]}
                radius={11}
                pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#1d4ed8', fillOpacity: 0.9 }}
              />
              <MarkerUnsafe
                position={[loc.lat, loc.lng]}
                icon={getTruckIcon({ direction: loc.markerDirection || 'right', heading: loc.markerHeading, showSelfBadge: showDriverSelfBadge })}
                zIndexOffset={10000}
              >
                <Popup>
                  <div className="text-sm" style={{ minWidth: 220 }}>
                    {/* Added: expose the active assignment details without changing map behavior. */}
                    <p className="font-bold text-base mb-1">Driver: {loc.driverName}</p>
                    <p className="text-gray-600">Plate Number: {loc.vehiclePlate || 'N/A'}</p>
                    <p className="text-gray-600">Assigned Trip #: {loc.assignedTripNumber || 'N/A'}</p>
                    <p className="text-gray-600">Destination Customer: {loc.destinationCustomer || 'N/A'}</p>
                    {loc.markerLabel ? <p className="text-gray-600">{loc.markerLabel}</p> : null}
                    <p className="text-gray-600">
                      Status: <span className="capitalize">{loc.status.toLowerCase()}</span>
                    </p>
                  </div>
                </Popup>
              </MarkerUnsafe>
            </Fragment>
          ) : loc.markerType === 'dot' || loc.markerColor ? (
            <CircleMarkerUnsafe
              key={loc.id}
              center={[loc.lat, loc.lng]}
              radius={8}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: loc.markerColor, fillOpacity: 1 }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-base mb-1">{loc.driverName}</p>
                  <p className="text-gray-600">{loc.markerLabel || `Vehicle: ${loc.vehiclePlate}`}</p>
                  <p className="text-gray-600">
                    Status: <span className="capitalize">{loc.status.toLowerCase()}</span>
                  </p>
                </div>
              </Popup>
            </CircleMarkerUnsafe>
          ) : (
            <MarkerUnsafe key={loc.id} position={[loc.lat, loc.lng]}>
              <Popup>
                <div className="text-sm">
                  <p className="font-bold text-base mb-1">{loc.driverName}</p>
                  <p className="text-gray-600">Vehicle: {loc.vehiclePlate}</p>
                  <p className="text-gray-600">
                    Status: <span className="capitalize">{loc.status.toLowerCase()}</span>
                  </p>
                </div>
              </Popup>
            </MarkerUnsafe>
          )
        )}
      </MapContainerUnsafe>
      <style>{`
        .map-eta-tooltip {
          background: transparent;
          border: 0;
          box-shadow: none;
          padding: 0;
        }
        .map-eta-tooltip:before {
          display: none;
        }
        .map-eta-tooltip .leaflet-tooltip-content {
          margin: 0;
          padding: 2px 7px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.2;
          color: #ffffff;
          white-space: nowrap;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
          background: #22c55e;
        }
        .map-eta-tooltip.map-eta-completed .leaflet-tooltip-content {
          background: #2563eb !important;
          color: #ffffff !important;
        }
        .map-eta-tooltip.map-eta-next .leaflet-tooltip-content {
          background: #16a34a !important;
          color: #ffffff !important;
        }
        .map-eta-tooltip.map-eta-upcoming .leaflet-tooltip-content {
          background: #22c55e !important;
          color: #ffffff !important;
        }
      `}</style>
    </div>
  );
}
