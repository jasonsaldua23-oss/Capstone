// Web build of the address picker.
//
// `@maplibre/maplibre-react-native` is native-only — importing it in a browser throws
// on `Object.create(NativeModules.MLRNModule)` because the native module is undefined.
// This variant renders the same map with maplibre-gl, the browser build of the same
// engine, against the same style URL, so the web preview and the device show the same
// map rather than a coordinate form.
//
// The service-area rules are unchanged: a tap outside the Silay/Talisay polygons is
// rejected with the same message the native picker and the web portal use.
//
// maplibre-gl is pinned to v4 deliberately. v6 loads its tile-decoding worker from a
// separate file resolved through `import.meta.url`, which Metro cannot bundle, so the
// worker never starts: the style loads and paints its background, the attribution and
// any marker appear, and no tile ever renders. v4 ships a UMD build with the worker
// inlined as a blob URL, and it is the version the web portal already uses.
import { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
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

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

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
  const containerRef = useRef<View | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [geometries, setGeometries] = useState<PolygonGeometry[]>([]);

  // Kept in a ref so the click handler, registered once, always sees the current
  // polygons and callbacks without tearing the map down and rebuilding it.
  const handlersRef = useRef({ geometries, onPick, onOutsideServiceArea });
  handlersRef.current = { geometries, onPick, onOutsideServiceArea };

  useEffect(() => {
    // Parsing 500KB of GeoJSON is deferred so it never blocks first paint.
    const timer = setTimeout(() => {
      try {
        setGeometries(extractServiceAreaGeometries(SERVICE_AREA_GEOJSON));
      } catch {
        // Falls back to the coarse bounds check, as the web portal does.
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

  useEffect(() => {
    // react-native-web renders View as a div, so the ref is the DOM node maplibre needs.
    const container = containerRef.current as unknown as HTMLDivElement | null;
    if (!container || mapRef.current) return;

    const map = new MapLibreMap({
      container,
      style: MAP_STYLE_URL,
      center: pinned || center,
      zoom: 12,
      attributionControl: { compact: true },
    });
    // A failed style, tile or worker load is otherwise silent — the map just stays
    // blank — so surface it rather than leaving it to be guessed at.
    map.on("error", (event) => {
      if (__DEV__) console.warn("[address-map] maplibre error:", event?.error?.message || event);
    });
    map.on("click", (event) => {
      const { lat, lng } = event.lngLat;
      const current = handlersRef.current;
      if (!isWithinServiceArea(lat, lng, current.geometries)) {
        current.onOutsideServiceArea();
        return;
      }
      current.onPick(lat, lng);
    });
    mapRef.current = map;

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // Built once; the pin and camera are driven by the effects below.
  }, []);

  // Recentre once the polygons resolve, but never fight a pin the customer has set.
  useEffect(() => {
    if (!mapRef.current || pinned) return;
    mapRef.current.setCenter(center);
  }, [center[0], center[1], Boolean(pinned)]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pinned) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (markerRef.current) markerRef.current.setLngLat(pinned);
    else markerRef.current = new Marker({ color: "#14532d" }).setLngLat(pinned).addTo(map);
    map.easeTo({ center: pinned, duration: 300 });
  }, [pinned ? pinned[0] : null, pinned ? pinned[1] : null]);

  return (
    <View style={styles.addressMapShell}>
      <View ref={containerRef} style={styles.addressMap} />
      <Text style={styles.addressMapHint}>{SERVICE_AREA_MESSAGE}</Text>
    </View>
  );
}
