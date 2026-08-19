import React, { useMemo } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getAssignedVehicleSymbol, haversineMeters } from "../lib/driver-logic";
import type { DriverTrip, DriverTripDropPoint, DriverTripLocation } from "../types";

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(metres))} m`;
}

function stopLabel(point: DriverTripDropPoint): string {
  return point.locationName || point.address || `Stop ${point.sequence || ""}`.trim();
}

export default function DriverNavigationMap({ trip, currentLocation }: { trip: DriverTrip; currentLocation: DriverTripLocation | null }) {
  const pendingStops = useMemo(
    () => (trip.dropPoints || []).filter((point) => !["COMPLETED", "DELIVERED", "FAILED", "SKIPPED", "CANCELLED"].includes(String(point.status || "").toUpperCase()) && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)),
    [trip.dropPoints],
  );

  const nextStop = pendingStops[0] || null;
  const distanceToNextStop = currentLocation && nextStop
    ? haversineMeters(
      { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
      { latitude: Number(nextStop.latitude), longitude: Number(nextStop.longitude) },
    )
    : null;

  const routeUrl = currentLocation && nextStop
    ? `https://www.google.com/maps/dir/?api=1&origin=${currentLocation.latitude},${currentLocation.longitude}&destination=${nextStop.latitude},${nextStop.longitude}&travelmode=driving`
    : null;

  const openRoute = () => {
    if (!routeUrl) return;
    // Added: the web build opens browser navigation instead of loading the native MapLibre module.
    void Linking.openURL(routeUrl);
  };

  if (!currentLocation) return <View style={styles.empty}><Text style={styles.muted}>Waiting for a usable GPS position...</Text></View>;
  if (!nextStop) return <View style={styles.empty}><Text style={styles.muted}>No pending stop has usable coordinates.</Text></View>;

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Next stop</Text>
          <Text style={styles.destination}>{stopLabel(nextStop)}</Text>
          <Text style={styles.meta}>
            {distanceToNextStop !== null ? `${formatDistance(distanceToNextStop)} away` : "Distance unavailable"}
          </Text>
        </View>
        <View style={styles.vehicleBadge}>
          <Text style={styles.vehicleSymbol}>{getAssignedVehicleSymbol(trip.vehicle)}</Text>
          <Text style={styles.vehiclePlate}>{trip.vehicle?.licensePlate || trip.vehicle?.type || "Vehicle"}</Text>
        </View>
      </View>

      <View style={styles.locationPanel}>
        <Text style={styles.locationLabel}>Current position</Text>
        <Text style={styles.coordinates}>
          {currentLocation.latitude.toFixed(6)}, {currentLocation.longitude.toFixed(6)}
        </Text>
      </View>

      <Pressable accessibilityRole="button" disabled={!routeUrl} style={({ pressed }) => [styles.routeButton, pressed && styles.routeButtonPressed]} onPress={openRoute}>
        <Text style={styles.routeButtonText}>Open route in Maps</Text>
      </Pressable>

      <ScrollView style={styles.stops} contentContainerStyle={styles.stopsContent}>
        {pendingStops.slice(0, 5).map((point) => (
          <View key={point.id} style={styles.stopRow}>
            <Text style={styles.stopSequence}>{point.sequence || "-"}</Text>
            <View style={styles.stopCopy}>
              <Text style={styles.stopName}>{stopLabel(point)}</Text>
              <Text style={styles.stopAddress}>{[point.address, point.city, point.province].filter(Boolean).join(", ") || "No address provided"}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { minHeight: 470, borderRadius: 22, overflow: "hidden", backgroundColor: "#e0f2fe", padding: 16, gap: 14 },
  empty: { minHeight: 120, alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: "#f8fafc", borderRadius: 18 },
  muted: { color: "#64748b", textAlign: "center" },
  header: { backgroundColor: "#0f172a", borderRadius: 18, padding: 16, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  title: { color: "#93c5fd", fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
  destination: { color: "#fff", fontSize: 20, fontWeight: "900", marginTop: 5 },
  meta: { color: "#cbd5e1", marginTop: 5 },
  vehicleBadge: { minWidth: 92, alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: 10 },
  vehicleSymbol: { fontSize: 30 },
  vehiclePlate: { color: "#0f172a", fontSize: 11, fontWeight: "800", marginTop: 4, textAlign: "center" },
  locationPanel: { backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#bfdbfe" },
  locationLabel: { color: "#64748b", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  coordinates: { color: "#0f172a", fontSize: 17, fontWeight: "800", marginTop: 5 },
  routeButton: { backgroundColor: "#2563eb", borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  routeButtonPressed: { opacity: 0.85 },
  routeButtonText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  stops: { flex: 1, minHeight: 160 },
  stopsContent: { gap: 10 },
  stopRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#dbeafe" },
  stopSequence: { width: 32, height: 32, borderRadius: 16, overflow: "hidden", backgroundColor: "#f97316", color: "#fff", textAlign: "center", textAlignVertical: "center", fontWeight: "900", paddingTop: 7 },
  stopCopy: { flex: 1 },
  stopName: { color: "#0f172a", fontWeight: "900" },
  stopAddress: { color: "#64748b", marginTop: 2 },
});
