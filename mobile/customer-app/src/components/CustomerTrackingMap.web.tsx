// Web preview build of the tracking map.
//
// `@maplibre/maplibre-react-native` is native-only, so the web bundle gets this
// static stand-in instead. Marker shapes mirror the native version (a van pin, a
// destination pin, a warehouse dot) rather than the old "TRUCK" / "D" text labels.
import React from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { CustomerTrackingItem } from "../types";

export function CustomerTrackingMap({
  tracking,
  warehouseLatitude = null,
  warehouseLongitude = null,
}: {
  tracking: CustomerTrackingItem;
  warehouseLatitude?: number | null;
  warehouseLongitude?: number | null;
}) {
  const hasDriverLocation = Number.isFinite(tracking.latitude) && Number.isFinite(tracking.longitude);
  const latitude = Number(tracking.latitude);
  const longitude = Number(tracking.longitude);
  const hasDestination =
    Number.isFinite(tracking.destinationLatitude) && Number.isFinite(tracking.destinationLongitude);
  const hasWarehouse = Number.isFinite(warehouseLatitude) && Number.isFinite(warehouseLongitude);

  const openStreetMap = () => {
    if (!hasDriverLocation) return;
    void Linking.openURL(
      `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
    );
  };

  return (
    <View style={styles.shell}>
      <View style={styles.gridHorizontalOne} />
      <View style={styles.gridHorizontalTwo} />
      <View style={styles.gridVerticalOne} />
      <View style={styles.gridVerticalTwo} />

      {hasWarehouse ? <View style={styles.warehouseMarker} accessibilityLabel="Warehouse" /> : null}
      {hasDestination ? (
        <View style={styles.destinationMarker} accessibilityLabel="Delivery address">
          <View style={styles.destinationMarkerInner} />
        </View>
      ) : null}
      {hasDriverLocation ? (
        <Image
          source={require("../../../../public/icons/aab-van-iso.png")}
          style={styles.driverMarker}
          resizeMode="contain"
          accessibilityLabel="Live driver location"
        />
      ) : (
        <Text style={styles.emptyText}>Waiting for live driver GPS for this order.</Text>
      )}

      {hasDriverLocation ? (
        <Pressable style={styles.openButton} onPress={openStreetMap} accessibilityLabel="Open in OpenStreetMap">
          <Text style={styles.openButtonText}>Open in OpenStreetMap</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const gridLine = { position: "absolute" as const, backgroundColor: "rgba(37, 99, 235, 0.12)" };

const styles = StyleSheet.create({
  shell: { height: 280, overflow: "hidden", borderRadius: 12, backgroundColor: "#dbeafe", borderWidth: 1, borderColor: "#bfdbfe" },
  gridHorizontalOne: { ...gridLine, left: 0, right: 0, top: "34%", height: 2, transform: [{ rotate: "-7deg" }] },
  gridHorizontalTwo: { ...gridLine, left: 0, right: 0, top: "66%", height: 2, transform: [{ rotate: "8deg" }] },
  gridVerticalOne: { ...gridLine, top: 0, bottom: 0, left: "35%", width: 2, transform: [{ rotate: "10deg" }] },
  gridVerticalTwo: { ...gridLine, top: 0, bottom: 0, left: "68%", width: 2, transform: [{ rotate: "-12deg" }] },
  warehouseMarker: {
    position: "absolute",
    left: "20%",
    top: "68%",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#9ca3af",
    borderWidth: 2,
    borderColor: "#111827",
  },
  destinationMarker: {
    position: "absolute",
    right: "22%",
    top: "25%",
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dc2626",
    borderWidth: 3,
    borderColor: "#ffffff",
  },
  destinationMarkerInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ffffff" },
  driverMarker: { position: "absolute", left: "38%", top: "42%", width: 72, height: 72 },
  emptyText: { alignSelf: "center", marginTop: 124, color: "#64748b" },
  openButton: {
    position: "absolute",
    right: 12,
    bottom: 12,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  openButtonText: { color: "#123e73", fontSize: 11, fontWeight: "700" },
});
