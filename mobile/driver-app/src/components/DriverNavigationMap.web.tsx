import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { getAssignedVehicleSymbol, haversineMeters, normalizeStatus } from "../lib/driver-logic";
import {
  bearingDegrees,
  interpolateCoordinate,
  interpolateHeading,
  movementAnimationDurationMs,
  projectCoordinateOnRoute,
  routeBearingAtProjection,
  routeLengthMeters,
  splitRouteAtDistance,
  type RouteCoordinate,
  type RouteProjection,
} from "../lib/route-progress";
import type { DriverTrip, DriverTripLocation } from "../types";

// Match the existing web Driver Portal's MapLibre road style.
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const STATIONARY_DISTANCE_METERS = 3;
const MAX_ROUTE_SNAP_DISTANCE_METERS = 180;
const VEHICLE_ART_HEADING_OFFSET = 90;

type OsrmStep = {
  maneuver: { type: string; modifier?: string; location: RouteCoordinate };
  name: string;
  distance: number;
  duration: number;
};

type RouteState = {
  coordinates: RouteCoordinate[];
  steps: OsrmStep[];
  distance: number;
  duration: number;
};

type DriverNavigationMapProps = {
  trip: DriverTrip;
  currentLocation: DriverTripLocation | null;
  fullScreen?: boolean;
};

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(metres))} m`;
}

function maneuverLabel(step?: OsrmStep): string {
  if (!step) return "Continue on the route";
  const type = step.maneuver.type.toLowerCase();
  const modifier = String(step.maneuver.modifier || "").replace(/_/g, " ");
  if (type === "arrive") return "Arrive at the destination";
  if (type.includes("roundabout")) return `Enter the roundabout${step.name ? ` toward ${step.name}` : ""}`;
  if (["turn", "fork", "merge"].includes(type)) {
    return `${type === "turn" ? "Turn" : type === "fork" ? "Keep" : "Merge"} ${modifier || "ahead"}${step.name ? ` onto ${step.name}` : ""}`;
  }
  return `Continue${step.name ? ` on ${step.name}` : ""}`;
}

function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function routeGeoJson(coordinates: RouteCoordinate[]) {
  return coordinates.length > 1
    ? {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates },
      }
    : { type: "FeatureCollection" as const, features: [] };
}

function markerElement(label: string, background: string): HTMLDivElement {
  const element = document.createElement("div");
  element.textContent = label;
  element.style.cssText = `width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${background};color:#fff;border:3px solid #fff;font:900 12px system-ui;box-shadow:0 4px 12px rgba(15,23,42,.25)`;
  return element;
}

export default function DriverNavigationMap({ trip, currentLocation, fullScreen = false }: DriverNavigationMapProps) {
  const [route, setRoute] = useState<RouteState | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(16.5);
  const [navigation3D, setNavigation3D] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [fallbackOrigin, setFallbackOrigin] = useState<RouteCoordinate | null>(null);
  const [renderedPosition, setRenderedPosition] = useState<RouteCoordinate | null>(null);
  const [renderedHeading, setRenderedHeading] = useState(0);
  const [renderedProgressMeters, setRenderedProgressMeters] = useState(0);
  const containerRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleMarkerRef = useRef<Marker | null>(null);
  const stopMarkersRef = useRef<Marker[]>([]);
  const spokenStepRef = useRef("");
  const animationFrameRef = useRef<number | null>(null);
  const renderedPositionRef = useRef<RouteCoordinate | null>(null);
  const renderedHeadingRef = useRef(0);
  const renderedProgressRef = useRef(0);
  const acceptedProjectionRef = useRef<RouteProjection | null>(null);
  const previousRawLocationRef = useRef<RouteCoordinate | null>(null);
  const previousTimestampRef = useRef<number | null>(null);

  const allStops = useMemo(
    () => [...(trip.dropPoints || [])]
      .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
      .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0)),
    [trip.dropPoints],
  );
  const pendingStops = useMemo(
    () => allStops.filter((point) => !["COMPLETED", "DELIVERED", "FAILED", "SKIPPED", "CANCELLED"].includes(normalizeStatus(point.status))),
    [allStops],
  );

  useEffect(() => {
    // Added: reset navigation progress only when changing trips, matching the web portal route lifecycle.
    setFallbackOrigin(currentLocation ? [currentLocation.longitude, currentLocation.latitude] : null);
    acceptedProjectionRef.current = null;
    previousRawLocationRef.current = null;
    previousTimestampRef.current = null;
    renderedProgressRef.current = 0;
    setRenderedProgressMeters(0);
  }, [trip.id]);

  useEffect(() => {
    if (!fallbackOrigin && currentLocation) setFallbackOrigin([currentLocation.longitude, currentLocation.latitude]);
  }, [currentLocation, fallbackOrigin]);

  const routeWaypoints = useMemo(() => {
    const warehouseLongitude = Number(trip.startLongitude ?? trip.warehouseLongitude ?? trip.warehouse?.longitude);
    const warehouseLatitude = Number(trip.startLatitude ?? trip.warehouseLatitude ?? trip.warehouse?.latitude);
    const origin = Number.isFinite(warehouseLongitude) && Number.isFinite(warehouseLatitude)
      ? [warehouseLongitude, warehouseLatitude] as RouteCoordinate
      : fallbackOrigin;
    if (!origin || allStops.length === 0) return [];
    return [origin, ...allStops.map((point) => [Number(point.longitude), Number(point.latitude)] as RouteCoordinate)];
  }, [allStops, fallbackOrigin, trip.startLatitude, trip.startLongitude, trip.warehouseLatitude, trip.warehouseLongitude, trip.warehouse?.latitude, trip.warehouse?.longitude]);

  const routeWaypointKey = routeWaypoints.map((point) => point.join(",")).join(";");

  useEffect(() => {
    if (routeWaypoints.length < 2) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    setLoading(true);
    // Added: use the same OSRM driving geometry and turn steps as the native navigation map.
    fetch(`https://router.project-osrm.org/route/v1/driving/${routeWaypointKey}?overview=full&geometries=geojson&steps=true`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.routes?.[0]) throw new Error("No driving route is available.");
        const rawRoute = payload.routes[0];
        const steps = (rawRoute.legs || []).flatMap((leg: any) => leg.steps || []).map((step: any) => ({
          maneuver: {
            type: String(step?.maneuver?.type || "continue"),
            modifier: step?.maneuver?.modifier ? String(step.maneuver.modifier) : undefined,
            location: [Number(step?.maneuver?.location?.[0]), Number(step?.maneuver?.location?.[1])] as RouteCoordinate,
          },
          name: String(step?.name || ""),
          distance: Number(step?.distance || 0),
          duration: Number(step?.duration || 0),
        }));
        setRoute({
          coordinates: rawRoute.geometry.coordinates,
          steps,
          distance: Number(rawRoute.distance || 0),
          duration: Number(rawRoute.duration || 0),
        });
        setRouteError(null);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setRouteError("Route could not refresh. Delivery actions are still available.");
      })
      .finally(() => setLoading(false));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [routeWaypointKey]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initialCenter = currentLocation
      ? [currentLocation.longitude, currentLocation.latitude] as RouteCoordinate
      : routeWaypoints[0];
    if (!initialCenter) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: initialCenter,
      zoom,
      pitch: navigation3D ? 58 : 0,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("driver-completed-route", { type: "geojson", data: routeGeoJson([]) });
      map.addLayer({ id: "driver-completed-route-line", type: "line", source: "driver-completed-route", paint: { "line-color": "#64748b", "line-width": 7, "line-opacity": 0.88 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addSource("driver-active-route", { type: "geojson", data: routeGeoJson([]) });
      map.addLayer({ id: "driver-active-route-line", type: "line", source: "driver-active-route", paint: { "line-color": "#2563eb", "line-width": 7 }, layout: { "line-cap": "round", "line-join": "round" } });
      setMapReady(true);
    });
    return () => {
      vehicleMarkerRef.current?.remove();
      stopMarkersRef.current.forEach((marker) => marker.remove());
      stopMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [routeWaypointKey, trip.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    stopMarkersRef.current.forEach((marker) => marker.remove());
    stopMarkersRef.current = [];
    if (routeWaypoints[0]) {
      stopMarkersRef.current.push(new maplibregl.Marker({ element: markerElement("W", "#16a34a") }).setLngLat(routeWaypoints[0]).addTo(map));
    }
    pendingStops.forEach((point, index) => {
      const last = index === pendingStops.length - 1;
      stopMarkersRef.current.push(new maplibregl.Marker({ element: markerElement(last ? "D" : String(point.sequence || "•"), last ? "#dc2626" : "#f97316") })
        .setLngLat([Number(point.longitude), Number(point.latitude)]).addTo(map));
    });
  }, [mapReady, pendingStops, routeWaypointKey]);

  useEffect(() => {
    if (!route || !currentLocation) return;
    const rawCoordinate: RouteCoordinate = [currentLocation.longitude, currentLocation.latitude];
    const previousProjection = acceptedProjectionRef.current;
    const previousRaw = previousRawLocationRef.current;
    const rawMovementMeters = previousRaw
      ? haversineMeters({ latitude: previousRaw[1], longitude: previousRaw[0] }, { latitude: rawCoordinate[1], longitude: rawCoordinate[0] })
      : 0;
    const minimumProgress = previousProjection?.alongRouteMeters ?? 0;
    const maximumProgress = previousProjection
      ? previousProjection.alongRouteMeters + Math.max(80, rawMovementMeters * 2.5 + 40)
      : Number.POSITIVE_INFINITY;

    // Added: project noisy GPS onto the OSRM road and never let accepted route progress move backward.
    const projection = projectCoordinateOnRoute(rawCoordinate, route.coordinates, minimumProgress, maximumProgress);
    if (!projection || (previousProjection && projection.distanceFromRouteMeters > MAX_ROUTE_SNAP_DISTANCE_METERS)) return;
    const projectedMovementMeters = previousProjection
      ? haversineMeters({ latitude: previousProjection.coordinate[1], longitude: previousProjection.coordinate[0] }, { latitude: projection.coordinate[1], longitude: projection.coordinate[0] })
      : Number.POSITIVE_INFINITY;
    const stationary = Boolean(previousProjection) && projectedMovementMeters < STATIONARY_DISTANCE_METERS && Number(currentLocation.speed ?? 0) < 1.5;
    const targetProjection = stationary && previousProjection ? previousProjection : projection;

    // Added: calculate travel bearing from accepted movement and smooth the shortest angle transition.
    const targetHeading = previousProjection && projectedMovementMeters >= STATIONARY_DISTANCE_METERS
      ? bearingDegrees(previousProjection.coordinate, targetProjection.coordinate)
      : routeBearingAtProjection(route.coordinates, targetProjection);
    const startPosition = renderedPositionRef.current || targetProjection.coordinate;
    const startHeading = renderedHeadingRef.current;
    const startProgress = renderedProgressRef.current;
    const nextTimestamp = timestamp(currentLocation.recordedAt) ?? Date.now();
    const duration = movementAnimationDurationMs(previousTimestampRef.current, nextTimestamp);
    const startedAt = Date.now();
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);

    // Added: position, heading, and traveled-route progress animate together between GPS samples.
    const animate = () => {
      const linearProgress = Math.min(1, (Date.now() - startedAt) / duration);
      const easedProgress = linearProgress * linearProgress * (3 - 2 * linearProgress);
      const position = interpolateCoordinate(startPosition, targetProjection.coordinate, easedProgress);
      const heading = interpolateHeading(startHeading, targetHeading, easedProgress);
      const progressMeters = startProgress + (targetProjection.alongRouteMeters - startProgress) * easedProgress;
      renderedPositionRef.current = position;
      renderedHeadingRef.current = heading;
      renderedProgressRef.current = progressMeters;
      setRenderedPosition(position);
      setRenderedHeading(heading);
      setRenderedProgressMeters(progressMeters);
      if (linearProgress < 1) animationFrameRef.current = requestAnimationFrame(animate);
      else animationFrameRef.current = null;
    };
    animationFrameRef.current = requestAnimationFrame(animate);
    acceptedProjectionRef.current = targetProjection;
    previousRawLocationRef.current = rawCoordinate;
    previousTimestampRef.current = nextTimestamp;
    mapRef.current?.easeTo({ center: targetProjection.coordinate, bearing: navigation3D ? targetHeading : 0, pitch: navigation3D ? 58 : 0, zoom, duration });
  }, [currentLocation, navigation3D, route, zoom]);

  const routeSplit = useMemo(
    () => route ? splitRouteAtDistance(route.coordinates, renderedProgressMeters) : { completed: [], remaining: [] },
    [renderedProgressMeters, route],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // Added: the completed route is the exact route geometry through the projected truck position.
    (map.getSource("driver-completed-route") as GeoJSONSource | undefined)?.setData(routeGeoJson(routeSplit.completed));
    (map.getSource("driver-active-route") as GeoJSONSource | undefined)?.setData(routeGeoJson(routeSplit.remaining));
  }, [mapReady, routeSplit]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !renderedPosition) return;
    if (!vehicleMarkerRef.current) {
      const element = document.createElement("div");
      const symbol = document.createElement("div");
      symbol.textContent = getAssignedVehicleSymbol(trip.vehicle);
      symbol.style.cssText = "font-size:34px;line-height:34px;transform-origin:center";
      const plate = document.createElement("div");
      plate.textContent = trip.vehicle?.licensePlate || trip.vehicle?.type || "Vehicle";
      plate.style.cssText = "margin-top:1px;padding:2px 5px;border-radius:5px;background:#fff;color:#0f172a;font:800 9px system-ui;box-shadow:0 2px 6px rgba(15,23,42,.2)";
      element.style.cssText = "display:flex;flex-direction:column;align-items:center";
      element.append(symbol, plate);
      vehicleMarkerRef.current = new maplibregl.Marker({ element, anchor: "center", rotationAlignment: "map" }).setLngLat(renderedPosition).addTo(map);
    }
    vehicleMarkerRef.current.setLngLat(renderedPosition).setRotation(renderedHeading + VEHICLE_ART_HEADING_OFFSET);
  }, [renderedHeading, renderedPosition, trip.vehicle]);

  const currentStep = useMemo(() => {
    if (!renderedPosition || !route?.steps.length) return route?.steps[0];
    let nearest = route.steps[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const step of route.steps) {
      const distance = haversineMeters({ latitude: renderedPosition[1], longitude: renderedPosition[0] }, { latitude: step.maneuver.location[1], longitude: step.maneuver.location[0] });
      if (distance < nearestDistance) {
        nearest = step;
        nearestDistance = distance;
      }
    }
    return nearest;
  }, [renderedPosition, route]);

  useEffect(() => {
    if (!voiceEnabled || !currentStep || !renderedPosition || !("speechSynthesis" in window)) return;
    const distance = haversineMeters({ latitude: renderedPosition[1], longitude: renderedPosition[0] }, { latitude: currentStep.maneuver.location[1], longitude: currentStep.maneuver.location[0] });
    const threshold = distance <= 35 ? "now" : distance <= 150 ? "150" : distance <= 500 ? "500" : "";
    if (!threshold) return;
    const key = `${currentStep.maneuver.location.join(",")}:${threshold}`;
    if (spokenStepRef.current === key) return;
    spokenStepRef.current = key;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(threshold === "now" ? maneuverLabel(currentStep) : `In ${formatDistance(distance)}, ${maneuverLabel(currentStep).toLowerCase()}`));
  }, [currentStep, renderedPosition, voiceEnabled]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const center = renderedPosition || (currentLocation ? [currentLocation.longitude, currentLocation.latitude] as RouteCoordinate : routeWaypoints[0]);
  const totalRouteMeters = route ? routeLengthMeters(route.coordinates) : 0;
  const remainingMeters = Math.max(0, totalRouteMeters - renderedProgressMeters);
  const remainingDuration = route && totalRouteMeters > 0 ? route.duration * (remainingMeters / totalRouteMeters) : 0;

  const recenter = () => center && mapRef.current?.easeTo({ center, bearing: navigation3D ? renderedHeading : 0, pitch: navigation3D ? 58 : 0, zoom, duration: 500 });
  const changeZoom = (nextZoom: number) => {
    setZoom(nextZoom);
    mapRef.current?.zoomTo(nextZoom, { duration: 250 });
  };

  if (!center) return <View style={styles.empty}><Text style={styles.muted}>No map data for this trip yet. Add delivery coordinates to order shipping addresses.</Text></View>;

  return (
    <View style={[styles.shell, fullScreen ? styles.fullScreenShell : null]}>
      <View ref={(node) => { containerRef.current = node as unknown as HTMLElement; }} style={styles.map} />
      <View style={styles.instruction} pointerEvents="none">
        <Text style={styles.instructionTitle}>{maneuverLabel(currentStep)}</Text>
        <Text style={styles.instructionMeta}>{route ? `${formatDistance(remainingMeters)} · ${Math.max(1, Math.round(remainingDuration / 60))} min remaining` : "Calculating route..."}</Text>
      </View>
      {loading ? <ActivityIndicator style={styles.loader} color="#0f172a" /> : null}
      <View style={styles.controls}>
        <View style={styles.zoomGroup}>
          <Pressable accessibilityLabel="Zoom in" style={styles.control} onPress={() => changeZoom(Math.min(20, zoom + 1))}><Text style={styles.controlText}>+</Text></Pressable>
          <View style={styles.controlDivider} />
          <Pressable accessibilityLabel="Zoom out" style={styles.control} onPress={() => changeZoom(Math.max(4, zoom - 1))}><Text style={styles.controlText}>−</Text></Pressable>
        </View>
        <Pressable accessibilityLabel={voiceEnabled ? "Turn voice guidance off" : "Turn voice guidance on"} style={[styles.roundControl, voiceEnabled && styles.voiceControlActive]} onPress={() => setVoiceEnabled((value) => !value)}><Text style={styles.controlText}>{voiceEnabled ? "🔊" : "🔇"}</Text></Pressable>
        <Pressable accessibilityLabel="Toggle 3D view" style={[styles.roundControl, navigation3D && styles.modeControlActive]} onPress={() => setNavigation3D((value) => !value)}><Text style={[styles.modeControlText, !navigation3D && styles.modeControlInactiveText]}>{navigation3D ? "3D" : "2D"}</Text></Pressable>
        <Pressable accessibilityLabel="Recenter navigation" style={styles.roundControl} onPress={recenter}><Text style={styles.controlText}>◎</Text></Pressable>
      </View>
      {routeError ? <Text style={styles.error}>{routeError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { height: 470, borderRadius: 22, overflow: "hidden", backgroundColor: "#dbeafe" },
  fullScreenShell: { height: "100%", borderRadius: 0 },
  map: { position: "absolute", inset: 0 },
  empty: { minHeight: 120, alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: "#f8fafc" },
  muted: { color: "#64748b", textAlign: "center" },
  instruction: { position: "absolute", zIndex: 5, top: 14, left: 14, right: 14, backgroundColor: "rgba(15,23,42,0.94)", borderRadius: 16, padding: 12, shadowColor: "#0f172a", shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  instructionTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  instructionMeta: { color: "#cbd5e1", marginTop: 4 },
  controls: { position: "absolute", zIndex: 6, right: 14, bottom: 132, gap: 9, alignItems: "center" },
  zoomGroup: { overflow: "hidden", borderRadius: 24, backgroundColor: "rgba(255,255,255,0.97)", shadowColor: "#0f172a", shadowOpacity: 0.15, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } },
  control: { width: 44, height: 42, alignItems: "center", justifyContent: "center" },
  controlDivider: { height: 1, marginHorizontal: 9, backgroundColor: "#e2e8f0" },
  roundControl: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.97)", alignItems: "center", justifyContent: "center", shadowColor: "#0f172a", shadowOpacity: 0.15, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } },
  voiceControlActive: { backgroundColor: "#059669" },
  modeControlActive: { backgroundColor: "#0d82cf" },
  modeControlText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  modeControlInactiveText: { color: "#0f172a" },
  controlText: { fontSize: 20, color: "#0f172a", fontWeight: "800" },
  loader: { position: "absolute", left: 16, bottom: 134 },
  error: { position: "absolute", top: 90, left: 14, right: 14, zIndex: 7, color: "#991b1b", backgroundColor: "rgba(254,226,226,0.96)", padding: 8, borderRadius: 10, fontSize: 11 },
});
