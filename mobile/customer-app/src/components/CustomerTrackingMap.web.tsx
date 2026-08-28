import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { CustomerTrackingItem } from "../types";

export function CustomerTrackingMap({ tracking }: { tracking: CustomerTrackingItem }) {
  const hasDriverLocation = Number.isFinite(tracking.latitude) && Number.isFinite(tracking.longitude);
  const latitude = Number(tracking.latitude);
  const longitude = Number(tracking.longitude);
  const hasDestination = Number.isFinite(tracking.destinationLatitude) && Number.isFinite(tracking.destinationLongitude);

  const openStreetMap = () => {
    if (!hasDriverLocation) return;
    // Web preview uses OpenStreetMap directly; native builds keep the interactive MapLibre implementation.
    void Linking.openURL(`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`);
  };

  return (
    <View style={styles.shell}>
      <View style={styles.gridHorizontalOne} />
      <View style={styles.gridHorizontalTwo} />
      <View style={styles.gridVerticalOne} />
      <View style={styles.gridVerticalTwo} />
      {hasDestination ? <View style={styles.destinationMarker}><Text style={styles.markerText}>D</Text></View> : null}
      {hasDriverLocation ? (
        <View style={styles.driverMarker} accessibilityLabel="Live driver location"><Text style={styles.driverText}>TRUCK</Text></View>
      ) : (
        <Text style={styles.emptyText}>No live GPS coordinates available.</Text>
      )}
      <View style={styles.details}>
        <Text style={styles.title}>Live delivery location</Text>
        {hasDriverLocation ? <Text style={styles.coordinates}>{latitude.toFixed(5)}, {longitude.toFixed(5)}</Text> : null}
      </View>
      {hasDriverLocation ? (
        <Pressable style={styles.openButton} onPress={openStreetMap} accessibilityLabel="Open live location in OpenStreetMap">
          <Text style={styles.openButtonText}>OPEN MAP</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const gridLine = { position: "absolute" as const, backgroundColor: "rgba(37, 99, 235, 0.12)" };

const styles = StyleSheet.create({
  shell: { height: 270, overflow: "hidden", borderRadius: 16, backgroundColor: "#dbeafe", borderWidth: 1, borderColor: "#bfdbfe" },
  gridHorizontalOne: { ...gridLine, left: 0, right: 0, top: "34%", height: 2, transform: [{ rotate: "-7deg" }] },
  gridHorizontalTwo: { ...gridLine, left: 0, right: 0, top: "66%", height: 2, transform: [{ rotate: "8deg" }] },
  gridVerticalOne: { ...gridLine, top: 0, bottom: 0, left: "35%", width: 2, transform: [{ rotate: "10deg" }] },
  gridVerticalTwo: { ...gridLine, top: 0, bottom: 0, left: "68%", width: 2, transform: [{ rotate: "-12deg" }] },
  destinationMarker: { position: "absolute", right: "22%", top: "25%", width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#dc2626", borderWidth: 3, borderColor: "#ffffff" },
  markerText: { color: "#ffffff", fontWeight: "900" },
  driverMarker: { position: "absolute", left: "38%", top: "46%", minWidth: 48, paddingHorizontal: 7, paddingVertical: 7, borderRadius: 12, alignItems: "center", backgroundColor: "#123e73", borderWidth: 3, borderColor: "#ffffff" },
  driverText: { color: "#ffffff", fontSize: 8, fontWeight: "900" },
  emptyText: { alignSelf: "center", marginTop: 116, color: "#64748b" },
  details: { position: "absolute", left: 12, top: 12, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: "rgba(255, 255, 255, 0.92)" },
  title: { color: "#123e73", fontSize: 11, fontWeight: "800" },
  coordinates: { color: "#475569", fontSize: 10, marginTop: 2, fontVariant: ["tabular-nums"] },
  openButton: { position: "absolute", right: 12, bottom: 12, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10, backgroundColor: "#ffffff" },
  openButtonText: { color: "#123e73", fontSize: 9, fontWeight: "900" },
});
