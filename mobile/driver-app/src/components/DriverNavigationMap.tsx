import * as MapLibreRN from "@maplibre/maplibre-react-native";
import * as Speech from "expo-speech";
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
// The truck emoji artwork faces west by default; rotate it 90 degrees so 0 degrees points north.
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

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(metres))} m`;
}

function maneuverLabel(step?: OsrmStep): string {
  if (!step) return "Continue on the route";
  const type = step.maneuver.type.toLowerCase();
  const modifier = String(step.maneuver.modifier || "").replace(/_/g, " ");
  if (type === "arrive") return "Arrive at the destination";
  if (type.includes("roundabout")) return `Enter the roundabout${step.name ? ` toward ${step.name}` : ""}`;
  if (type === "turn" || type === "fork" || type === "merge") {
    return `${type === "turn" ? "Turn" : type === "fork" ? "Keep" : "Merge"} ${modifier || "ahead"}${step.name ? ` onto ${step.name}` : ""}`;
  }
  return `Continue${step.name ? ` on ${step.name}` : ""}`;
}

function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export default function DriverNavigationMap({ trip, currentLocation, fullScreen = false }: { trip: DriverTrip; currentLocation: DriverTripLocation | null; fullScreen?: boolean }) {
  const [route, setRoute] = useState<RouteState | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(16.5);
  const [navigation3D, setNavigation3D] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [fallbackOrigin, setFallbackOrigin] = useState<RouteCoordinate | null>(null);
  const [renderedPosition, setRenderedPosition] = useState<RouteCoordinate | null>(null);
  const [renderedHeading, setRenderedHeading] = useState(0);
  const [renderedProgressMeters, setRenderedProgressMeters] = useState(0);
  const cameraRef = useRef<MapLibreRN.CameraRef>(null);
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
    // Freeze the first GPS sample as the origin only when the trip has no warehouse/start coordinate.
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
    // Keep one stable full-trip route so completed geometry never disappears after a stop is delivered.
    return [origin, ...allStops.map((point) => [Number(point.longitude), Number(point.latitude)] as RouteCoordinate)];
  }, [allStops, fallbackOrigin, trip.startLatitude, trip.startLongitude, trip.warehouseLatitude, trip.warehouseLongitude, trip.warehouse?.latitude, trip.warehouse?.longitude]);

  const routeWaypointKey = routeWaypoints.map((point) => point.join(",")).join(";");

  useEffect(() => {
    if (routeWaypoints.length < 2) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    setLoading(true);
    const coordinates = routeWaypoints.map(([longitude, latitude]) => `${longitude},${latitude}`).join(";");
    fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`, { signal: controller.signal })
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
        // Preserve the last successful route during a transient OSRM failure.
        setRouteError("Route could not refresh. Delivery actions are still available.");
      })
      .finally(() => setLoading(false));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [routeWaypointKey]);

  useEffect(() => {
    if (!route || !currentLocation) return;
    const rawCoordinate: RouteCoordinate = [currentLocation.longitude, currentLocation.latitude];
    const previousProjection = acceptedProjectionRef.current;
    const previousRaw = previousRawLocationRef.current;
    const rawMovementMeters = previousRaw
      ? haversineMeters(
        { latitude: previousRaw[1], longitude: previousRaw[0] },
        { latitude: rawCoordinate[1], longitude: rawCoordinate[0] },
      )
      : 0;
    const minimumProgress = previousProjection?.alongRouteMeters ?? 0;
    const maximumProgress = previousProjection
      ? previousProjection.alongRouteMeters + Math.max(80, rawMovementMeters * 2.5 + 40)
      : Number.POSITIVE_INFINITY;

    // Project GPS onto the actual OSRM polyline; the truck and gray route always stay on the road.
    const projection = projectCoordinateOnRoute(rawCoordinate, route.coordinates, minimumProgress, maximumProgress);
    if (!projection || (previousProjection && projection.distanceFromRouteMeters > MAX_ROUTE_SNAP_DISTANCE_METERS)) return;

    const projectedMovementMeters = previousProjection
      ? haversineMeters(
        { latitude: previousProjection.coordinate[1], longitude: previousProjection.coordinate[0] },
        { latitude: projection.coordinate[1], longitude: projection.coordinate[0] },
      )
      : Number.POSITIVE_INFINITY;
    const stationary = Boolean(previousProjection)
      && projectedMovementMeters < STATIONARY_DISTANCE_METERS
      && Number(currentLocation.speed ?? 0) < 1.5;
    const targetProjection = stationary && previousProjection ? previousProjection : projection;

    // Bearing is based on actual accepted movement; route tangent is the initial/fallback heading.
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

    // Interpolate position, heading, and progress together so the truck never teleports between GPS samples.
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

    // Camera receives one eased target per GPS update instead of a sequence of abrupt recenter jumps.
    cameraRef.current?.setCamera({
      centerCoordinate: targetProjection.coordinate,
      heading: targetHeading,
      pitch: navigation3D ? 58 : 0,
      zoomLevel: zoom,
      animationDuration: duration,
      animationMode: "easeTo",
    });

    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [currentLocation, navigation3D, route, zoom]);

  const routeSplit = useMemo(
    () => route ? splitRouteAtDistance(route.coordinates, renderedProgressMeters) : { completed: [], remaining: [] },
    [renderedProgressMeters, route],
  );

  const currentStep = useMemo(() => {
    if (!renderedPosition || !route?.steps.length) return route?.steps[0];
    let nearest = route.steps[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const step of route.steps) {
      const distance = haversineMeters(
        { latitude: renderedPosition[1], longitude: renderedPosition[0] },
        { latitude: step.maneuver.location[1], longitude: step.maneuver.location[0] },
      );
      if (distance < nearestDistance) {
        nearest = step;
        nearestDistance = distance;
      }
    }
    return nearest;
  }, [renderedPosition, route]);

  useEffect(() => {
    if (!voiceEnabled || !currentStep || !renderedPosition) return;
    const distance = haversineMeters(
      { latitude: renderedPosition[1], longitude: renderedPosition[0] },
      { latitude: currentStep.maneuver.location[1], longitude: currentStep.maneuver.location[0] },
    );
    const threshold = distance <= 35 ? "now" : distance <= 150 ? "150" : distance <= 500 ? "500" : "";
    if (!threshold) return;
    const key = `${currentStep.maneuver.location.join(",")}:${threshold}`;
    if (spokenStepRef.current === key) return;
    spokenStepRef.current = key;
    const prompt = threshold === "now" ? maneuverLabel(currentStep) : `In ${formatDistance(distance)}, ${maneuverLabel(currentStep).toLowerCase()}`;
    Speech.stop();
    Speech.speak(prompt, { language: "en-PH", rate: 1 });
  }, [currentStep, renderedPosition, voiceEnabled]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    Speech.stop();
  }, []);

  // Fix: keep MapLibre visible from real trip coordinates while this driver's GPS is unavailable.
  // The truck marker is not given a warehouse or generic fallback position.
  const driverPosition: RouteCoordinate | null = renderedPosition
    || (currentLocation ? [currentLocation.longitude, currentLocation.latitude] : null);
  const center: RouteCoordinate | null = driverPosition
    || routeWaypoints[0]
    || (allStops[0] ? [Number(allStops[0].longitude), Number(allStops[0].latitude)] : null);
  if (!center) return <View style={styles.empty}><Text style={styles.muted}>No map data for this trip yet. Add delivery coordinates to order shipping addresses.</Text></View>;
  const totalRouteMeters = route ? routeLengthMeters(route.coordinates) : 0;
  const remainingMeters = Math.max(0, totalRouteMeters - renderedProgressMeters);
  const remainingDuration = route && totalRouteMeters > 0 ? route.duration * (remainingMeters / totalRouteMeters) : 0;
  const completedRouteShape = routeSplit.completed.length > 1
    ? { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: routeSplit.completed } }
    : null;
  const remainingRouteShape = routeSplit.remaining.length > 1
    ? { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: routeSplit.remaining } }
    : null;

  const recenter = () => cameraRef.current?.setCamera({
    centerCoordinate: center,
    heading: renderedHeading,
    pitch: navigation3D ? 58 : 0,
    zoomLevel: zoom,
    animationDuration: 500,
    animationMode: "easeTo",
  });

  const changeZoom = (nextZoom: number) => {
    setZoom(nextZoom);
    cameraRef.current?.zoomTo(nextZoom, 250);
  };

  return (
    <View style={[styles.shell, fullScreen ? styles.fullScreenShell : null]}>
      <View style={styles.instruction}>
        <Text style={styles.instructionTitle}>{maneuverLabel(currentStep)}</Text>
        <Text style={styles.instructionMeta}>
          {route ? `${formatDistance(remainingMeters)} · ${Math.max(1, Math.round(remainingDuration / 60))} min remaining` : "Calculating route..."}
        </Text>
      </View>
      <MapLibreRN.MapView style={styles.map} mapStyle={MAP_STYLE_URL} compassEnabled logoEnabled={false}>
        <MapLibreRN.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: center, zoomLevel: zoom, pitch: navigation3D ? 58 : 0, heading: renderedHeading }}
        />
        {completedRouteShape ? (
          <MapLibreRN.ShapeSource id="driver-completed-route" shape={completedRouteShape}>
            <MapLibreRN.LineLayer id="driver-completed-route-line" style={{ lineColor: "#64748b", lineWidth: 7, lineOpacity: 0.88, lineCap: "round", lineJoin: "round" }} />
          </MapLibreRN.ShapeSource>
        ) : null}
        {remainingRouteShape ? (
          <MapLibreRN.ShapeSource id="driver-active-route" shape={remainingRouteShape}>
            <MapLibreRN.LineLayer id="driver-active-route-line" style={{ lineColor: "#2563eb", lineWidth: 7, lineCap: "round", lineJoin: "round" }} />
          </MapLibreRN.ShapeSource>
        ) : null}
        {routeWaypoints[0] ? (
          <MapLibreRN.PointAnnotation id="trip-pickup" coordinate={routeWaypoints[0]}>
            <View collapsable={false} style={styles.pickupMarker}><Text style={styles.stopMarkerText}>W</Text></View>
          </MapLibreRN.PointAnnotation>
        ) : null}
        {allStops.map((point) => (
          <MapLibreRN.PointAnnotation key={point.id} id={`stop-${point.id}`} coordinate={[Number(point.longitude), Number(point.latitude)]}>
            <View collapsable={false} style={[styles.stopMarker, point.id === allStops.at(-1)?.id && styles.destinationMarker, ["COMPLETED", "DELIVERED"].includes(normalizeStatus(point.status)) && styles.completedStopMarker]}>
              <Text style={styles.stopMarkerText}>{point.id === allStops.at(-1)?.id ? "D" : point.sequence || "•"}</Text>
            </View>
          </MapLibreRN.PointAnnotation>
        ))}
        {driverPosition ? <MapLibreRN.MarkerView coordinate={driverPosition} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
          <View style={styles.vehicleMarker} accessibilityLabel={`Assigned ${trip.vehicle?.type || "vehicle"}`}>
            {/* Camera and truck share the smoothed world heading, so only the artwork's west-to-north offset is needed on screen. */}
            <Text style={[styles.vehicleSymbol, { transform: [{ rotate: `${VEHICLE_ART_HEADING_OFFSET}deg` }] }]}>
              {getAssignedVehicleSymbol(trip.vehicle)}
            </Text>
            <Text style={styles.vehiclePlate}>{trip.vehicle?.licensePlate || trip.vehicle?.type || "Vehicle"}</Text>
          </View>
        </MapLibreRN.MarkerView> : null}
      </MapLibreRN.MapView>
      {loading ? <ActivityIndicator style={styles.loader} color="#0f172a" /> : null}
      <View style={[styles.controls, fullScreen ? styles.fullScreenControls : null]}>
        <Pressable accessibilityLabel="Zoom in" style={styles.control} onPress={() => changeZoom(Math.min(20, zoom + 1))}><Text style={styles.controlText}>+</Text></Pressable>
        <Pressable accessibilityLabel="Zoom out" style={styles.control} onPress={() => changeZoom(Math.max(4, zoom - 1))}><Text style={styles.controlText}>−</Text></Pressable>
        <Pressable accessibilityLabel="Recenter navigation" style={styles.control} onPress={recenter}><Text style={styles.controlText}>◎</Text></Pressable>
        <Pressable accessibilityLabel={navigation3D ? "Switch to flat map" : "Switch to 3D map"} style={[styles.control, navigation3D && styles.modeControlActive]} onPress={() => setNavigation3D((value) => !value)}><Text style={styles.modeControlText}>{navigation3D ? "3D" : "2D"}</Text></Pressable>
        <Pressable accessibilityLabel={voiceEnabled ? "Turn voice guidance off" : "Turn voice guidance on"} style={[styles.control, voiceEnabled && styles.controlActive]} onPress={() => setVoiceEnabled((value) => !value)}><Text style={styles.controlText}>{voiceEnabled ? "🔊" : "🔇"}</Text></Pressable>
      </View>
      {routeError ? <Text style={styles.error}>{routeError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { height: 470, borderRadius: 22, overflow: "hidden", backgroundColor: "#dbeafe" },
  fullScreenShell: { height: "100%", borderRadius: 0 },
  map: { flex: 1 },
  empty: { minHeight: 120, alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: "#f8fafc", borderRadius: 18 },
  muted: { color: "#64748b", textAlign: "center" },
  instruction: { position: "absolute", zIndex: 5, top: 12, left: 12, right: 12, backgroundColor: "rgba(15,23,42,0.94)", borderRadius: 16, padding: 12 },
  instructionTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  instructionMeta: { color: "#cbd5e1", marginTop: 4 },
  stopMarker: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#f97316", borderWidth: 3, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  pickupMarker: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#16a34a", borderWidth: 3, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  destinationMarker: { backgroundColor: "#dc2626" },
  completedStopMarker: { backgroundColor: "#64748b" },
  stopMarkerText: { color: "#fff", fontWeight: "900" },
  vehicleMarker: { minWidth: 70, alignItems: "center" },
  vehicleSymbol: { fontSize: 34 },
  vehiclePlate: { backgroundColor: "#fff", color: "#0f172a", fontSize: 9, fontWeight: "800", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, overflow: "hidden" },
  controls: { position: "absolute", zIndex: 6, right: 12, bottom: 14, gap: 8 },
  fullScreenControls: { bottom: 132 },
  control: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 3 },
  controlActive: { backgroundColor: "#dcfce7" },
  modeControlActive: { backgroundColor: "#0d82cf" },
  modeControlText: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  controlText: { fontSize: 20, color: "#0f172a", fontWeight: "800" },
  loader: { position: "absolute", left: 16, bottom: 18 },
  error: { position: "absolute", bottom: 8, left: 12, right: 66, color: "#991b1b", backgroundColor: "rgba(254,226,226,0.95)", padding: 6, borderRadius: 8, fontSize: 11 },
});
