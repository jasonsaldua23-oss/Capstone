// Web preview build of the address picker.
//
// `@maplibre/maplibre-react-native` is native-only — importing it on web throws
// `Object.create(NativeModules.MLRNModule)` because the native module is undefined.
// CustomerTrackingMap already handles this with a `.web.tsx` variant; this is the
// same treatment for the address picker.
//
// The service-area rules still apply: coordinates typed here are validated against
// the same Silay/Talisay polygons the native picker uses.
import { MapPin } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import {
  SERVICE_AREA_MESSAGE,
  extractServiceAreaGeometries,
  isWithinServiceArea,
  type PolygonGeometry,
} from "../../lib/shared";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

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
  const [geometries, setGeometries] = useState<PolygonGeometry[]>([]);
  const [latText, setLatText] = useState(latitude === null ? "" : String(latitude));
  const [lngText, setLngText] = useState(longitude === null ? "" : String(longitude));

  useEffect(() => {
    try {
      setGeometries(extractServiceAreaGeometries(SERVICE_AREA_GEOJSON));
    } catch {
      setGeometries([]);
    }
  }, []);

  useEffect(() => {
    setLatText(latitude === null ? "" : String(latitude));
    setLngText(longitude === null ? "" : String(longitude));
  }, [latitude, longitude]);

  const parsed = useMemo(() => {
    const lat = Number(latText);
    const lng = Number(lngText);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }, [latText, lngText]);

  return (
    <View style={styles.addressMapShell}>
      <View style={styles.addressMapWebFallback}>
        <MapPin size={20} color={theme.colors.emerald} />
        <Text style={styles.addressMapWebTitle}>Map picking is available in the mobile app</Text>
        <Text style={styles.addressMapWebHint}>
          Enter coordinates to pin the delivery location in this web preview.
        </Text>
        <View style={styles.addressMapWebRow}>
          <TextInput
            style={[styles.addressInput, styles.flex]}
            value={latText}
            onChangeText={setLatText}
            placeholder="Latitude"
            placeholderTextColor={theme.colors.textFaint}
            keyboardType="decimal-pad"
          />
          <TextInput
            style={[styles.addressInput, styles.flex]}
            value={lngText}
            onChangeText={setLngText}
            placeholder="Longitude"
            placeholderTextColor={theme.colors.textFaint}
            keyboardType="decimal-pad"
          />
        </View>
        <Pressable
          style={[styles.addressLocationButton, !parsed ? styles.disabledButton : null]}
          disabled={!parsed}
          onPress={() => {
            if (!parsed) return;
            if (!isWithinServiceArea(parsed.lat, parsed.lng, geometries)) {
              onOutsideServiceArea();
              return;
            }
            onPick(parsed.lat, parsed.lng);
          }}
          accessibilityRole="button"
        >
          <Text style={styles.addressLocationText}>Pin these coordinates</Text>
        </Pressable>
      </View>
      <Text style={styles.addressMapHint}>{SERVICE_AREA_MESSAGE}</Text>
    </View>
  );
}
