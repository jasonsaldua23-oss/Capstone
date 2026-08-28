import * as MapLibreRN from "@maplibre/maplibre-react-native";
import React, { useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { CustomerTrackingItem } from "../types";

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_CENTER: [number, number] = [122.95, 10.7];

export function CustomerTrackingMap({ tracking }: { tracking: CustomerTrackingItem }) {
  const cameraRef = useRef<MapLibreRN.CameraRef>(null);
  const driver = Number.isFinite(tracking.latitude) && Number.isFinite(tracking.longitude)
    ? [Number(tracking.longitude), Number(tracking.latitude)] as [number, number]
    : null;
  const destination = Number.isFinite(tracking.destinationLatitude) && Number.isFinite(tracking.destinationLongitude)
    ? [Number(tracking.destinationLongitude), Number(tracking.destinationLatitude)] as [number, number]
    : null;
  const route = useMemo(
    () => (tracking.routePoints || [])
      .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
      .map((point) => [Number(point.longitude), Number(point.latitude)] as [number, number]),
    [tracking.routePoints],
  );
  const center = driver || route.at(-1) || destination || DEFAULT_CENTER;
  const routeShape = route.length > 1
    ? { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: route } }
    : null;

  return (
    <View style={styles.shell}>
      <MapLibreRN.MapView style={styles.map} mapStyle={MAP_STYLE_URL} logoEnabled={false} compassEnabled>
        <MapLibreRN.Camera ref={cameraRef} defaultSettings={{ centerCoordinate: center, zoomLevel: 14 }} />
        {routeShape ? (
          <MapLibreRN.ShapeSource id="customer-live-route" shape={routeShape}>
            <MapLibreRN.LineLayer id="customer-live-route-line" style={{ lineColor: "#2563eb", lineWidth: 6, lineCap: "round", lineJoin: "round" }} />
          </MapLibreRN.ShapeSource>
        ) : null}
        {destination ? (
          <MapLibreRN.PointAnnotation id="customer-destination" coordinate={destination}>
            <View collapsable={false} style={styles.destinationMarker}><Text style={styles.markerText}>D</Text></View>
          </MapLibreRN.PointAnnotation>
        ) : null}
        {driver ? (
          <MapLibreRN.MarkerView coordinate={driver} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
            <View style={styles.driverMarker} accessibilityLabel="Live driver location"><Text style={styles.driverText}>TRUCK</Text></View>
          </MapLibreRN.MarkerView>
        ) : null}
      </MapLibreRN.MapView>
      <Pressable
        style={styles.recenter}
        accessibilityLabel="Recenter delivery map"
        onPress={() => cameraRef.current?.setCamera({ centerCoordinate: center, zoomLevel: 14, animationDuration: 350 })}
      >
        <Text style={styles.recenterText}>CENTER</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { height: 270, overflow: "hidden", borderRadius: 16, backgroundColor: "#dbeafe" },
  map: { flex: 1 },
  destinationMarker: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#dc2626", borderWidth: 3, borderColor: "#ffffff" },
  markerText: { color: "#ffffff", fontWeight: "900" },
  driverMarker: { minWidth: 48, paddingHorizontal: 7, paddingVertical: 7, borderRadius: 12, alignItems: "center", backgroundColor: "#123e73", borderWidth: 3, borderColor: "#ffffff" },
  driverText: { color: "#ffffff", fontSize: 8, fontWeight: "900" },
  recenter: { position: "absolute", right: 12, bottom: 12, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 10, backgroundColor: "#ffffff" },
  recenterText: { color: "#123e73", fontSize: 9, fontWeight: "900" },
});
