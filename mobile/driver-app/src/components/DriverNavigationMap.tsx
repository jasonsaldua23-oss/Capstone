import * as MapLibreRN from "@maplibre/maplibre-react-native";
import * as Speech from "expo-speech";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { getAssignedVehicleSymbol, haversineMeters } from "../lib/driver-logic";
import type { DriverTrip, DriverTripLocation } from "../types";

const MAP_STYLE_URL = "https://demotiles.maplibre.org/style.json";

type Coordinate = [number, number];
type OsrmStep = {
  maneuver: { type: string; modifier?: string; location: Coordinate };
  name: string;
  distance: number;
  duration: number;
};

type RouteState = {
  coordinates: Coordinate[];
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

export default function DriverNavigationMap({ trip, currentLocation }: { trip: DriverTrip; currentLocation: DriverTripLocation | null }) {
  const [route, setRoute] = useState<RouteState | null>(null);
  const [completedRouteCoordinates, setCompletedRouteCoordinates] = useState<Coordinate[]>([]);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(16.5);
  const [recenterKey, setRecenterKey] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const spokenStepRef = useRef<string>("");

  const pendingStops = useMemo(
    () => (trip.dropPoints || []).filter((point) => !["COMPLETED", "DELIVERED", "FAILED", "SKIPPED", "CANCELLED"].includes(String(point.status || "").toUpperCase()) && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)),
    [trip.dropPoints],
  );

  const waypoints = useMemo(() => {
    if (!currentLocation || pendingStops.length === 0) return [] as Coordinate[];
    return [
      [currentLocation.longitude, currentLocation.latitude] as Coordinate,
      ...pendingStops.map((point) => [Number(point.longitude), Number(point.latitude)] as Coordinate),
    ];
  }, [currentLocation, pendingStops]);

  const completedWaypoints = useMemo(() => {
    if (!currentLocation) return [] as Coordinate[];
    const warehouseLongitude = Number(trip.warehouseLongitude ?? trip.warehouse?.longitude);
    const warehouseLatitude = Number(trip.warehouseLatitude ?? trip.warehouse?.latitude);
    const completedStops = (trip.dropPoints || [])
      .filter((point) => ["COMPLETED", "DELIVERED"].includes(String(point.status || "").toUpperCase()))
      .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
      .map((point) => [Number(point.longitude), Number(point.latitude)] as Coordinate);
    const start = Number.isFinite(warehouseLatitude) && Number.isFinite(warehouseLongitude)
      ? [[warehouseLongitude, warehouseLatitude] as Coordinate]
      : [];
    return [...start, ...completedStops, [currentLocation.longitude, currentLocation.latitude] as Coordinate];
  }, [currentLocation, trip.dropPoints, trip.warehouseLatitude, trip.warehouseLongitude]);

  useEffect(() => {
    if (waypoints.length < 2) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    setLoading(true);
    const coordinates = waypoints.map(([longitude, latitude]) => `${longitude},${latitude}`).join(";");
    fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.routes?.[0]) throw new Error("No driving route is available.");
        const rawRoute = payload.routes[0];
        const steps = (rawRoute.legs || []).flatMap((leg: any) => leg.steps || []).map((step: any) => ({
          maneuver: {
            type: String(step?.maneuver?.type || "continue"),
            modifier: step?.maneuver?.modifier ? String(step.maneuver.modifier) : undefined,
            location: [Number(step?.maneuver?.location?.[0]), Number(step?.maneuver?.location?.[1])] as Coordinate,
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
      .catch(() => {
        // Preserve the last successful route during transient routing failures.
        setRouteError("Route could not refresh. Delivery actions are still available.");
      })
      .finally(() => setLoading(false));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [waypoints.map((point) => point.join(",")).join(";")]);

  useEffect(() => {
    if (completedWaypoints.length < 2) {
      setCompletedRouteCoordinates([]);
      return;
    }
    const controller = new AbortController();
    const coordinates = completedWaypoints.map(([longitude, latitude]) => `${longitude},${latitude}`).join(";");
    fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, { signal: controller.signal })
      .then((response) => response.json())
      .then((payload) => {
        if (Array.isArray(payload?.routes?.[0]?.geometry?.coordinates)) setCompletedRouteCoordinates(payload.routes[0].geometry.coordinates);
      })
      .catch(() => {
        // Keep the previous completed path when the routing service is unavailable.
      });
    return () => controller.abort();
  }, [completedWaypoints.map((point) => point.join(",")).join(";")]);

  const currentStep = useMemo(() => {
    if (!currentLocation || !route?.steps.length) return route?.steps[0];
    let nearest = route.steps[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const step of route.steps) {
      const distance = haversineMeters(
        { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
        { latitude: step.maneuver.location[1], longitude: step.maneuver.location[0] },
      );
      if (distance < nearestDistance) {
        nearest = step;
        nearestDistance = distance;
      }
    }
    return nearest;
  }, [currentLocation, route]);

  useEffect(() => {
    if (!voiceEnabled || !currentStep || !currentLocation) return;
    const distance = haversineMeters(
      { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
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
  }, [currentLocation, currentStep, voiceEnabled]);

  if (!currentLocation) return <View style={styles.empty}><Text style={styles.muted}>Waiting for a usable GPS position…</Text></View>;
  if (pendingStops.length === 0) return <View style={styles.empty}><Text style={styles.muted}>No pending stop has usable coordinates.</Text></View>;

  const center: Coordinate = [currentLocation.longitude, currentLocation.latitude];
  const routeShape = route ? { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: route.coordinates } } : null;
  const completedRouteShape = completedRouteCoordinates.length > 1
    ? { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: completedRouteCoordinates } }
    : null;

  return (
    <View style={styles.shell}>
      <View style={styles.instruction}>
        <Text style={styles.instructionTitle}>{maneuverLabel(currentStep)}</Text>
        <Text style={styles.instructionMeta}>
          {route ? `${formatDistance(route.distance)} · ${Math.max(1, Math.round(route.duration / 60))} min remaining` : "Calculating route…"}
        </Text>
      </View>
      <MapLibreRN.MapView style={styles.map} mapStyle={MAP_STYLE_URL} compassEnabled logoEnabled={false}>
        <MapLibreRN.Camera
          key={recenterKey}
          centerCoordinate={center}
          zoomLevel={zoom}
          pitch={58}
          heading={currentLocation.heading ?? 0}
          animationDuration={500}
        />
        {completedRouteShape ? (
          <MapLibreRN.ShapeSource id="driver-completed-route" shape={completedRouteShape}>
            <MapLibreRN.LineLayer id="driver-completed-route-line" style={{ lineColor: "#64748b", lineWidth: 6, lineOpacity: 0.8, lineCap: "round", lineJoin: "round" }} />
          </MapLibreRN.ShapeSource>
        ) : null}
        {routeShape ? (
          <MapLibreRN.ShapeSource id="driver-route" shape={routeShape}>
            <MapLibreRN.LineLayer id="driver-route-line" style={{ lineColor: "#2563eb", lineWidth: 7, lineCap: "round", lineJoin: "round" }} />
          </MapLibreRN.ShapeSource>
        ) : null}
        {pendingStops.map((point) => (
          <MapLibreRN.PointAnnotation key={point.id} id={`stop-${point.id}`} coordinate={[Number(point.longitude), Number(point.latitude)]}>
            <View collapsable={false} style={styles.stopMarker}><Text style={styles.stopMarkerText}>{point.sequence || "•"}</Text></View>
          </MapLibreRN.PointAnnotation>
        ))}
        <MapLibreRN.PointAnnotation id="assigned-vehicle" coordinate={center}>
          <View collapsable={false} style={styles.vehicleMarker} accessibilityLabel={`Assigned ${trip.vehicle?.type || "vehicle"}`}>
            <Text style={styles.vehicleSymbol}>{getAssignedVehicleSymbol(trip.vehicle)}</Text>
            <Text style={styles.vehiclePlate}>{trip.vehicle?.licensePlate || trip.vehicle?.type || "Vehicle"}</Text>
          </View>
        </MapLibreRN.PointAnnotation>
      </MapLibreRN.MapView>
      {loading ? <ActivityIndicator style={styles.loader} color="#0f172a" /> : null}
      <View style={styles.controls}>
        <Pressable accessibilityLabel="Zoom in" style={styles.control} onPress={() => setZoom((value) => Math.min(20, value + 1))}><Text style={styles.controlText}>+</Text></Pressable>
        <Pressable accessibilityLabel="Zoom out" style={styles.control} onPress={() => setZoom((value) => Math.max(4, value - 1))}><Text style={styles.controlText}>−</Text></Pressable>
        <Pressable accessibilityLabel="Recenter navigation" style={styles.control} onPress={() => setRecenterKey((value) => value + 1)}><Text style={styles.controlText}>◎</Text></Pressable>
        <Pressable accessibilityLabel={voiceEnabled ? "Turn voice guidance off" : "Turn voice guidance on"} style={[styles.control, voiceEnabled && styles.controlActive]} onPress={() => setVoiceEnabled((value) => !value)}><Text style={styles.controlText}>{voiceEnabled ? "🔊" : "🔇"}</Text></Pressable>
      </View>
      {routeError ? <Text style={styles.error}>{routeError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { height: 470, borderRadius: 22, overflow: "hidden", backgroundColor: "#dbeafe" },
  map: { flex: 1 },
  empty: { minHeight: 120, alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: "#f8fafc", borderRadius: 18 },
  muted: { color: "#64748b", textAlign: "center" },
  instruction: { position: "absolute", zIndex: 5, top: 12, left: 12, right: 12, backgroundColor: "rgba(15,23,42,0.94)", borderRadius: 16, padding: 12 },
  instructionTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  instructionMeta: { color: "#cbd5e1", marginTop: 4 },
  stopMarker: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#f97316", borderWidth: 3, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  stopMarkerText: { color: "#fff", fontWeight: "900" },
  vehicleMarker: { minWidth: 70, alignItems: "center" },
  vehicleSymbol: { fontSize: 34 },
  vehiclePlate: { backgroundColor: "#fff", color: "#0f172a", fontSize: 9, fontWeight: "800", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, overflow: "hidden" },
  controls: { position: "absolute", zIndex: 6, right: 12, bottom: 14, gap: 8 },
  control: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 3 },
  controlActive: { backgroundColor: "#dcfce7" },
  controlText: { fontSize: 20, color: "#0f172a", fontWeight: "800" },
  loader: { position: "absolute", left: 16, bottom: 18 },
  error: { position: "absolute", bottom: 8, left: 12, right: 66, color: "#991b1b", backgroundColor: "rgba(254,226,226,0.95)", padding: 6, borderRadius: 8, fontSize: 11 },
});
