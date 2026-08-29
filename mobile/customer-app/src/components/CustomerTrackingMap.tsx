// Mirrors the marker set in src/components/maps/DriverRouteMap.tsx: the van
// artwork for the driver, a pin for the destination, and a small dark circle for
// the warehouse. The previous "TRUCK" / "D" text placeholders are gone.
import * as MapLibreRN from "@maplibre/maplibre-react-native";
import React, { useMemo, useRef } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { CustomerTrackingItem } from "../types";

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_CENTER: [number, number] = [122.95, 10.7];

export function CustomerTrackingMap({
  tracking,
  warehouseLatitude = null,
  warehouseLongitude = null,
}: {
  tracking: CustomerTrackingItem;
  warehouseLatitude?: number | null;
  warehouseLongitude?: number | null;
}) {
  const cameraRef = useRef<MapLibreRN.CameraRef>(null);
  const driver =
    Number.isFinite(tracking.latitude) && Number.isFinite(tracking.longitude)
      ? ([Number(tracking.longitude), Number(tracking.latitude)] as [number, number])
      : null;
  const destination =
    Number.isFinite(tracking.destinationLatitude) && Number.isFinite(tracking.destinationLongitude)
      ? ([Number(tracking.destinationLongitude), Number(tracking.destinationLatitude)] as [number, number])
      : null;
  const warehouse =
    Number.isFinite(warehouseLatitude) && Number.isFinite(warehouseLongitude)
      ? ([Number(warehouseLongitude), Number(warehouseLatitude)] as [number, number])
      : null;

  const route = useMemo(
    () =>
      (tracking.routePoints || [])
        .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
        .map((point) => [Number(point.longitude), Number(point.latitude)] as [number, number]),
    [tracking.routePoints]
  );
  const center = driver || route.at(-1) || destination || warehouse || DEFAULT_CENTER;
  const routeShape =
    route.length > 1
      ? { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: route } }
      : null;

  return (
    <View style={styles.shell}>
      <MapLibreRN.MapView style={styles.map} mapStyle={MAP_STYLE_URL} logoEnabled={false} compassEnabled>
        <MapLibreRN.Camera ref={cameraRef} defaultSettings={{ centerCoordinate: center, zoomLevel: 14 }} />
        {routeShape ? (
          <MapLibreRN.ShapeSource id="customer-live-route" shape={routeShape}>
            <MapLibreRN.LineLayer
              id="customer-live-route-line"
              style={{ lineColor: "#2563eb", lineWidth: 6, lineCap: "round", lineJoin: "round" }}
            />
          </MapLibreRN.ShapeSource>
        ) : null}
        {warehouse ? (
          <MapLibreRN.MarkerView coordinate={warehouse} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
            <View style={styles.warehouseMarker} accessibilityLabel="Warehouse" />
          </MapLibreRN.MarkerView>
        ) : null}
        {destination ? (
          <MapLibreRN.MarkerView coordinate={destination} anchor={{ x: 0.5, y: 1 }} allowOverlap>
            <View style={styles.destinationMarker} accessibilityLabel="Delivery address">
              <View style={styles.destinationMarkerInner} />
            </View>
          </MapLibreRN.MarkerView>
        ) : null}
        {driver ? (
          <MapLibreRN.MarkerView coordinate={driver} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
            <Image
              source={require("../../../../public/icons/aab-van-iso.png")}
              style={styles.driverMarker}
              resizeMode="contain"
              accessibilityLabel="Live driver location"
            />
          </MapLibreRN.MarkerView>
        ) : null}
      </MapLibreRN.MapView>
      <Pressable
        style={styles.recenter}
        accessibilityRole="button"
        accessibilityLabel="Recenter delivery map"
        onPress={() => cameraRef.current?.setCamera({ centerCoordinate: center, zoomLevel: 14, animationDuration: 350 })}
      >
        <Text style={styles.recenterText}>Recenter</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { height: 280, overflow: "hidden", borderRadius: 12, backgroundColor: "#dbeafe" },
  map: { flex: 1 },
  // CircleMarker radius 7, #111827 stroke over #9ca3af fill.
  warehouseMarker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#9ca3af",
    borderWidth: 2,
    borderColor: "#111827",
  },
  destinationMarker: {
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
  driverMarker: { width: 72, height: 72 },
  recenter: {
    position: "absolute",
    right: 12,
    bottom: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#ffffff",
  },
  recenterText: { color: "#123e73", fontSize: 11, fontWeight: "700" },
});
