// Native equivalent of src/components/maps/AddressMapPicker.tsx: tap the map to
// drop the delivery pin. Rejects points outside the Silay/Talisay service area
// using the same polygons and message as the web.
import * as MapLibreRN from "@maplibre/maplibre-react-native";
import { MapPin } from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";

import {
  SERVICE_AREA_BOUNDS,
  SERVICE_AREA_MESSAGE,
  computeBounds,
  extractServiceAreaGeometries,
  isWithinServiceArea,
  type PolygonGeometry,
} from "../../lib/shared";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Bundled through Metro's watchFolders, so the app checks the same municipal
// boundaries the web fetches from /geo.
const SERVICE_AREA_GEOJSON = require("../../../../../public/geo/negros-occidental-municipal-maritime.json");

export function AddressMapPicker({
  latitude,
  longitude,
  onPick,
  onOutsideServiceArea,
}: {
  latitude: number | null;
  longitude: number | null;
  onPick: (lat: number, lng: number) => void;
  onOutsideServiceArea: () => void;
}) {
  const cameraRef = useRef<MapLibreRN.CameraRef>(null);
  const [geometries, setGeometries] = useState<PolygonGeometry[]>([]);

  useEffect(() => {
    // Parsing 500KB of GeoJSON is deferred so it never blocks first paint.
    const timer = setTimeout(() => {
      try {
        setGeometries(extractServiceAreaGeometries(SERVICE_AREA_GEOJSON));
      } catch {
        // Falls back to the coarse bounds check, as the web does.
        setGeometries([]);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const bounds = useMemo(() => computeBounds(geometries) || SERVICE_AREA_BOUNDS, [geometries]);
  const center = useMemo<[number, number]>(
    () => [(bounds[0][1] + bounds[1][1]) / 2, (bounds[0][0] + bounds[1][0]) / 2],
    [bounds]
  );

  const pinned =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? ([Number(longitude), Number(latitude)] as [number, number])
      : null;

  return (
    <View style={styles.addressMapShell}>
      <MapLibreRN.MapView
        style={styles.addressMap}
        mapStyle={MAP_STYLE_URL}
        logoEnabled={false}
        onPress={(feature: any) => {
          const coords = feature?.geometry?.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) return;
          const lng = Number(coords[0]);
          const lat = Number(coords[1]);
          if (!isWithinServiceArea(lat, lng, geometries)) {
            onOutsideServiceArea();
            return;
          }
          onPick(lat, lng);
        }}
      >
        <MapLibreRN.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: pinned || center, zoomLevel: 12 }}
        />
        {pinned ? (
          <MapLibreRN.MarkerView coordinate={pinned} anchor={{ x: 0.5, y: 1 }} allowOverlap>
            <View style={styles.addressMapPin}>
              <MapPin size={18} color={theme.colors.white} />
            </View>
          </MapLibreRN.MarkerView>
        ) : null}
      </MapLibreRN.MapView>
      <Text style={styles.addressMapHint}>{SERVICE_AREA_MESSAGE}</Text>
    </View>
  );
}
