import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { Asset } from "expo-asset";
import { Ionicons } from "@expo/vector-icons";
import "maplibre-gl/dist/maplibre-gl.css";
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
// Mirrors src/components/shared/MapLibreNavigationMap.tsx, the driver portal's own
// MapLibre navigation map. Two vehicle assets: the rear view reads correctly in the
// tilted 3D chase camera, the isometric one from directly above in 2D. Each has its
// own forward heading, because the artwork points a different way in each.
const VAN_ISO_FORWARD_HEADING = 45;
const VAN_BACK_FORWARD_HEADING = 0;
const NAVIGATION_PITCH_DEGREES = 58;
const NAVIGATION_3D_ZOOM = 19;
const NAVIGATION_2D_ZOOM = 16.2;

function normalizeAngle(value: number): number {
  return ((value % 360) + 360) % 360;
}

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

type DriverNavigationMapProps = {
  trip: DriverTrip;
  currentLocation: DriverTripLocation | null;
  fullScreen?: boolean;
};

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(metres))} m`;
}

// Mirrors getManeuverIcon() in src/components/shared/NavInstructionsPanel.tsx.
function maneuverIconName(step?: OsrmStep): keyof typeof Ionicons.glyphMap {
  const type = String(step?.maneuver?.type || "").toLowerCase();
  const modifier = String(step?.maneuver?.modifier || "").toLowerCase();
  if (type === "arrive" || type === "destination") return "flag";
  if (type === "depart") return "arrow-up";
  if (type === "roundabout" || type === "rotary") return "refresh";
  switch (modifier) {
    case "uturn": return "arrow-down";
    case "sharp right": return "return-up-forward";
    case "right": return "arrow-forward";
    case "slight right": return "arrow-up";
    case "sharp left": return "return-up-back";
    case "left": return "arrow-back";
    case "slight left": return "arrow-up";
    default: return "arrow-up";
  }
}

function maneuverLabel(step?: OsrmStep): string {
  if (!step) return "Continue on the route";
  const type = step.maneuver.type.toLowerCase();
  const modifier = String(step.maneuver.modifier || "").replace(/_/g, " ");
  if (type === "arrive") return "Arrive at the destination";
  if (type.includes("roundabout")) return `Enter the roundabout${step.name ? ` toward ${step.name}` : ""}`;
  if (["turn", "fork", "merge"].includes(type)) {
    return `${type === "turn" ? "Turn" : type === "fork" ? "Keep" : "Merge"} ${modifier || "ahead"}${step.name ? ` onto ${step.name}` : ""}`;
  }
  return `Continue${step.name ? ` on ${step.name}` : ""}`;
}

function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function routeGeoJson(coordinates: RouteCoordinate[]) {
  return coordinates.length > 1
    ? {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates },
      }
    : { type: "FeatureCollection" as const, features: [] };
}

// The same branded van the web driver portal puts on its map (/icons/aab-van-iso.png).
// Asset.fromModule resolves on web and native alike; react-native-web has no
// Image.resolveAssetSource, so that route throws at module load.
const VAN_ISO_URI = Asset.fromModule(require("../../assets/aab-van-iso.png")).uri;
const VAN_BACK_URI = Asset.fromModule(require("../../assets/aab-van-back.png")).uri;

// A teardrop map pin, drawn inline so it is crisp at any density and needs no network
// request — the web portal pulls its pins from a GitHub raw URL, which an app on a
// delivery route cannot rely on.
function pinElement(fill: string, label: string): HTMLDivElement {
  // The element MapLibre is handed must not have its "position" set. MapLibre gives
  // its markers "position: absolute" and moves them with a transform; forcing
  // "relative" put every pin back into the container's normal flow, so they stacked
  // and slid away from their stops as soon as the map was panned or zoomed. The
  // label needs a positioned ancestor, so that lives on an inner wrapper instead.
  const element = document.createElement("div");
  element.style.cssText = "width:30px;height:42px;filter:drop-shadow(0 3px 6px rgba(15,23,42,.35))";
  element.innerHTML = `
    <div style="position:relative;width:30px;height:42px">
      <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 41.2C15 41.2 28.5 24.9 28.5 15A13.5 13.5 0 1 0 1.5 15c0 9.9 13.5 26.2 13.5 26.2z"
              fill="${fill}" stroke="#ffffff" stroke-width="2.4" stroke-linejoin="round"/>
        <circle cx="15" cy="15" r="7.4" fill="#ffffff" fill-opacity="0.96"/>
      </svg>
      <span style="position:absolute;top:7px;left:0;width:30px;text-align:center;color:${fill};font:800 11px system-ui;line-height:16px">${label}</span>
    </div>
  `;
  return element;
}

// The warehouse the route starts from reads as a building rather than a numbered stop.
function warehousePinElement(): HTMLDivElement {
  const element = pinElement("#16a34a", "");
  const glyph = element.querySelector("span");
  if (glyph) {
    glyph.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.4"
           stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px">
        <path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-7h6v7"/>
      </svg>`;
  }
  return element;
}

export default function DriverNavigationMap({ trip, currentLocation, fullScreen = false }: DriverNavigationMapProps) {
  const [route, setRoute] = useState<RouteState | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(NAVIGATION_3D_ZOOM);
  const [navigation3D, setNavigation3D] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  // Without this the map fails silently: a style or WebGL failure leaves the shell
  // background showing and nothing explains why.
  const [mapError, setMapError] = useState<string | null>(null);
  const [fallbackOrigin, setFallbackOrigin] = useState<RouteCoordinate | null>(null);
  const [renderedPosition, setRenderedPosition] = useState<RouteCoordinate | null>(null);
  const [renderedHeading, setRenderedHeading] = useState(0);
  const [renderedProgressMeters, setRenderedProgressMeters] = useState(0);
  const containerRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleMarkerRef = useRef<Marker | null>(null);
  const vehicleIsoRef = useRef<HTMLImageElement | null>(null);
  const vehicleBackRef = useRef<HTMLImageElement | null>(null);
  const stopMarkersRef = useRef<Marker[]>([]);
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
    // Added: reset navigation progress only when changing trips, matching the web portal route lifecycle.
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
    return [origin, ...allStops.map((point) => [Number(point.longitude), Number(point.latitude)] as RouteCoordinate)];
  }, [allStops, fallbackOrigin, trip.startLatitude, trip.startLongitude, trip.warehouseLatitude, trip.warehouseLongitude, trip.warehouse?.latitude, trip.warehouse?.longitude]);

  const routeWaypointKey = routeWaypoints.map((point) => point.join(",")).join(";");

  useEffect(() => {
    if (routeWaypoints.length < 2) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    setLoading(true);
    // Added: use the same OSRM driving geometry and turn steps as the native navigation map.
    fetch(`https://router.project-osrm.org/route/v1/driving/${routeWaypointKey}?overview=full&geometries=geojson&steps=true`, { signal: controller.signal })
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
        setRouteError("Route could not refresh. Delivery actions are still available.");
      })
      .finally(() => setLoading(false));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [routeWaypointKey]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initialCenter = currentLocation
      ? [currentLocation.longitude, currentLocation.latitude] as RouteCoordinate
      : routeWaypoints[0];
    if (!initialCenter) {
      setMapError("No route or GPS position yet, so the map has nothing to centre on.");
      return;
    }

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: initialCenter,
        zoom,
        pitch: navigation3D ? NAVIGATION_PITCH_DEGREES : 0,
        attributionControl: false,
      });
    } catch (error) {
      // MapLibre needs WebGL; when it is unavailable the constructor throws.
      setMapError(`Map could not start: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    mapRef.current = map;
    setMapError(null);
    map.on("error", (event: { error?: { message?: string } }) => {
      setMapError(`Map failed to load: ${event?.error?.message || "the map style or tiles could not be fetched"}`);
    });
    map.on("load", () => {
      map.addSource("driver-completed-route", { type: "geojson", data: routeGeoJson([]) });
      map.addLayer({ id: "driver-completed-route-line", type: "line", source: "driver-completed-route", paint: { "line-color": "#64748b", "line-width": 7, "line-opacity": 0.88 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addSource("driver-active-route", { type: "geojson", data: routeGeoJson([]) });
      map.addLayer({ id: "driver-active-route-line", type: "line", source: "driver-active-route", paint: { "line-color": "#2563eb", "line-width": 7 }, layout: { "line-cap": "round", "line-join": "round" } });
      // The container is sized by React Native Web's layout, which can settle after
      // MapLibre has measured it; without this the canvas can stay 0x0 and show
      // nothing but the shell background.
      map.resize();
      setMapReady(true);
    });
    // React Native Web sizes the container through its own layout pass, which can
    // land after MapLibre has measured it. A canvas that measured 0x0 never paints
    // and never recovers on its own, so follow the container's real size.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      observer = new ResizeObserver(() => {
        if (mapRef.current) mapRef.current.resize();
      });
      observer.observe(containerRef.current as unknown as Element);
    }

    return () => {
      observer?.disconnect();
      vehicleMarkerRef.current?.remove();
      vehicleIsoRef.current = null;
      vehicleBackRef.current = null;
      stopMarkersRef.current.forEach((marker) => marker.remove());
      stopMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [routeWaypointKey, trip.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    stopMarkersRef.current.forEach((marker) => marker.remove());
    stopMarkersRef.current = [];
    // Pins stay upright and face the camera, so they stay readable when the map tilts.
    // The pin tip, not the middle of its box, belongs on the coordinate, and the
    // position must not be rounded to whole pixels — otherwise the pins slide away
    // from their stops while the map is panned or zoomed. The portal's own map carries
    // the same note. The SVG tip is at y=41.2 in a 42px box, so with a centre anchor
    // the element is lifted by half the box minus the tip.
    const pinOptions = {
      anchor: "center" as const,
      offset: [0, -20.2] as [number, number],
      rotationAlignment: "viewport" as const,
      pitchAlignment: "viewport" as const,
      subpixelPositioning: true,
    };
    if (routeWaypoints[0]) {
      stopMarkersRef.current.push(
        new maplibregl.Marker({ element: warehousePinElement(), ...pinOptions }).setLngLat(routeWaypoints[0]).addTo(map),
      );
    }
    pendingStops.forEach((point, index) => {
      const last = index === pendingStops.length - 1;
      const element = pinElement(last ? "#dc2626" : "#f97316", String(point.sequence || index + 1));
      stopMarkersRef.current.push(
        new maplibregl.Marker({ element, ...pinOptions })
          .setLngLat([Number(point.longitude), Number(point.latitude)]).addTo(map),
      );
    });
  }, [mapReady, pendingStops, routeWaypointKey]);

  useEffect(() => {
    if (!route || !currentLocation) return;
    const rawCoordinate: RouteCoordinate = [currentLocation.longitude, currentLocation.latitude];
    const previousProjection = acceptedProjectionRef.current;
    const previousRaw = previousRawLocationRef.current;
    const rawMovementMeters = previousRaw
      ? haversineMeters({ latitude: previousRaw[1], longitude: previousRaw[0] }, { latitude: rawCoordinate[1], longitude: rawCoordinate[0] })
      : 0;
    const minimumProgress = previousProjection?.alongRouteMeters ?? 0;
    const maximumProgress = previousProjection
      ? previousProjection.alongRouteMeters + Math.max(80, rawMovementMeters * 2.5 + 40)
      : Number.POSITIVE_INFINITY;

    // Added: project noisy GPS onto the OSRM road and never let accepted route progress move backward.
    const projection = projectCoordinateOnRoute(rawCoordinate, route.coordinates, minimumProgress, maximumProgress);
    if (!projection || (previousProjection && projection.distanceFromRouteMeters > MAX_ROUTE_SNAP_DISTANCE_METERS)) return;
    const projectedMovementMeters = previousProjection
      ? haversineMeters({ latitude: previousProjection.coordinate[1], longitude: previousProjection.coordinate[0] }, { latitude: projection.coordinate[1], longitude: projection.coordinate[0] })
      : Number.POSITIVE_INFINITY;
    const stationary = Boolean(previousProjection) && projectedMovementMeters < STATIONARY_DISTANCE_METERS && Number(currentLocation.speed ?? 0) < 1.5;
    const targetProjection = stationary && previousProjection ? previousProjection : projection;

    // Added: calculate travel bearing from accepted movement and smooth the shortest angle transition.
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

    // Added: position, heading, and traveled-route progress animate together between GPS samples.
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
    mapRef.current?.easeTo({ center: targetProjection.coordinate, bearing: navigation3D ? targetHeading : 0, pitch: navigation3D ? NAVIGATION_PITCH_DEGREES : 0, zoom, duration });
  }, [currentLocation, navigation3D, route, zoom]);

  const routeSplit = useMemo(
    () => route ? splitRouteAtDistance(route.coordinates, renderedProgressMeters) : { completed: [], remaining: [] },
    [renderedProgressMeters, route],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    // Added: the completed route is the exact route geometry through the projected truck position.
    (map.getSource("driver-completed-route") as GeoJSONSource | undefined)?.setData(routeGeoJson(routeSplit.completed));
    (map.getSource("driver-active-route") as GeoJSONSource | undefined)?.setData(routeGeoJson(routeSplit.remaining));
  }, [mapReady, routeSplit]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !renderedPosition) return;
    if (!vehicleMarkerRef.current) {
      const element = document.createElement("div");

      // The web portal stacks a "YOU" badge and a blue position dot with the van; both
      // were missing here, so the driver had no fixed point marking their exact
      // position under the moving artwork.
      const badge = document.createElement("div");
      badge.textContent = "YOU";
      badge.style.cssText = "padding:1px 6px;border-radius:9999px;background:#fff;border:1px solid rgba(15,23,42,.18);color:#0f3d72;font:900 10px/14px system-ui";

      const puck = document.createElement("div");
      puck.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:9999px;background:#1d4ed8;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);pointer-events:none";

      // Both artworks are created up front and swapped with display, exactly as the
      // portal does, so switching perspective never re-creates the marker.
      const shadow = "filter:drop-shadow(0 4px 10px rgba(15,23,42,.38)) contrast(1.08) saturate(1.08)";
      const symbol = document.createElement("img");
      symbol.src = VAN_ISO_URI;
      symbol.alt = getAssignedVehicleSymbol(trip.vehicle);
      symbol.style.cssText = `width:72px;height:72px;object-fit:contain;transform-origin:center;${shadow}`;
      const symbolBack = document.createElement("img");
      symbolBack.src = VAN_BACK_URI;
      symbolBack.alt = "";
      symbolBack.style.cssText = `width:96px;height:96px;object-fit:contain;transform-origin:center;${shadow}`;
      vehicleIsoRef.current = symbol;
      vehicleBackRef.current = symbolBack;
      const plate = document.createElement("div");
      plate.textContent = trip.vehicle?.licensePlate || trip.vehicle?.type || "Vehicle";
      plate.style.cssText = "margin-top:1px;padding:2px 5px;border-radius:5px;background:#fff;color:#0f172a;font:800 9px system-ui;box-shadow:0 2px 6px rgba(15,23,42,.2)";
      // Same rule as the pins: leave "position" to MapLibre.
      element.style.cssText = "display:flex;flex-direction:column;align-items:center";
      const art = document.createElement("div");
      art.style.cssText = "position:relative;width:96px;height:96px;display:flex;align-items:center;justify-content:center";
      symbol.style.position = "absolute";
      symbolBack.style.position = "absolute";
      art.append(puck, symbol, symbolBack);
      element.append(badge, art, plate);
      // The marker itself never rotates: rotating it would turn the plate label with
      // the van and leave it upside down half the route. Only the image is rotated,
      // which is what the web portal does, and viewport alignment keeps the van
      // face-on so it reads the same flat in 2D and tilted in 3D.
      vehicleMarkerRef.current = new maplibregl.Marker({
        element,
        anchor: "center",
        rotationAlignment: "viewport",
        pitchAlignment: "viewport",
        // Without this MapLibre rounds the marker to whole pixels, so it visibly
        // slides against the map while panning and zooming.
        subpixelPositioning: true,
      }).setLngLat(renderedPosition).addTo(map);
    }
    vehicleMarkerRef.current.setLngLat(renderedPosition);
    // In 3D the camera already turns with the heading, so the rear-view art stays
    // pointing up the screen; in 2D the isometric art is rotated to the heading.
    if (vehicleIsoRef.current) {
      vehicleIsoRef.current.style.display = navigation3D ? "none" : "block";
      vehicleIsoRef.current.style.transform = `rotate(${normalizeAngle(renderedHeading - VAN_ISO_FORWARD_HEADING)}deg)`;
    }
    if (vehicleBackRef.current) {
      vehicleBackRef.current.style.display = navigation3D ? "block" : "none";
      vehicleBackRef.current.style.transform = `rotate(${VAN_BACK_FORWARD_HEADING}deg)`;
    }
  }, [navigation3D, renderedHeading, renderedPosition, trip.vehicle]);

  // Fix: pressing 2D/3D updated the label but never moved the camera, because pitch was
  // only ever applied at construction, in recenter(), and on a GPS update. A driver who
  // toggled the mode while stationary saw nothing change at all.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const nextZoom = navigation3D ? NAVIGATION_3D_ZOOM : NAVIGATION_2D_ZOOM;
    setZoom(nextZoom);
    map.easeTo({
      // The 3D zoom is tight enough that zooming without re-centring drops the
      // vehicle out of frame, so the camera follows it the way the portal's does.
      center: renderedPositionRef.current || map.getCenter(),
      pitch: navigation3D ? NAVIGATION_PITCH_DEGREES : 0,
      bearing: navigation3D ? renderedHeadingRef.current : 0,
      zoom: nextZoom,
      duration: 420,
    });
    // renderedHeading is read from the ref so a moving vehicle does not re-run this.
  }, [mapReady, navigation3D]);

  const currentStep = useMemo(() => {
    if (!renderedPosition || !route?.steps.length) return route?.steps[0];
    let nearest = route.steps[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const step of route.steps) {
      const distance = haversineMeters({ latitude: renderedPosition[1], longitude: renderedPosition[0] }, { latitude: step.maneuver.location[1], longitude: step.maneuver.location[0] });
      if (distance < nearestDistance) {
        nearest = step;
        nearestDistance = distance;
      }
    }
    return nearest;
  }, [renderedPosition, route]);

  useEffect(() => {
    if (!voiceEnabled || !currentStep || !renderedPosition || !("speechSynthesis" in window)) return;
    const distance = haversineMeters({ latitude: renderedPosition[1], longitude: renderedPosition[0] }, { latitude: currentStep.maneuver.location[1], longitude: currentStep.maneuver.location[0] });
    const threshold = distance <= 35 ? "now" : distance <= 150 ? "150" : distance <= 500 ? "500" : "";
    if (!threshold) return;
    const key = `${currentStep.maneuver.location.join(",")}:${threshold}`;
    if (spokenStepRef.current === key) return;
    spokenStepRef.current = key;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(threshold === "now" ? maneuverLabel(currentStep) : `In ${formatDistance(distance)}, ${maneuverLabel(currentStep).toLowerCase()}`));
  }, [currentStep, renderedPosition, voiceEnabled]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const center = renderedPosition || (currentLocation ? [currentLocation.longitude, currentLocation.latitude] as RouteCoordinate : routeWaypoints[0]);
  const totalRouteMeters = route ? routeLengthMeters(route.coordinates) : 0;
  const remainingMeters = Math.max(0, totalRouteMeters - renderedProgressMeters);
  const remainingDuration = route && totalRouteMeters > 0 ? route.duration * (remainingMeters / totalRouteMeters) : 0;

  const recenter = () => center && mapRef.current?.easeTo({ center, bearing: navigation3D ? renderedHeading : 0, pitch: navigation3D ? NAVIGATION_PITCH_DEGREES : 0, zoom, duration: 500 });
  const changeZoom = (nextZoom: number) => {
    setZoom(nextZoom);
    mapRef.current?.zoomTo(nextZoom, { duration: 250 });
  };

  if (!center) return <View style={styles.empty}><Text style={styles.muted}>No map data for this trip yet. Add delivery coordinates to order shipping addresses.</Text></View>;

  return (
    <View style={[styles.shell, fullScreen ? styles.fullScreenShell : null]}>
      <View ref={(node) => { containerRef.current = node as unknown as HTMLElement; }} style={styles.map} />
      {/* Laid out like the driver portal's mobile-compact NavInstructionsPanel: a green
          maneuver tile, the instruction, then the KM and ETA readouts. */}
      <View style={styles.instruction} pointerEvents="none">
        <View style={styles.instructionIconTile}>
          <Ionicons name={maneuverIconName(currentStep)} size={20} color="#ffffff" />
        </View>
        <View style={styles.instructionTextWrap}>
          <Text style={styles.instructionTitle} numberOfLines={2}>{maneuverLabel(currentStep)}</Text>
        </View>
        <View style={styles.instructionStats}>
          <Text style={styles.instructionStatLabel}>KM</Text>
          <Text style={styles.instructionStatDistance}>{route ? formatDistance(remainingMeters) : "--"}</Text>
          <Text style={[styles.instructionStatLabel, styles.instructionStatLabelSpaced]}>ETA</Text>
          <Text style={styles.instructionStatEta}>
            {route ? `${Math.max(1, Math.round(remainingDuration / 60))} min` : "--"}
          </Text>
        </View>
      </View>
      {loading ? <ActivityIndicator style={styles.loader} color="#0f172a" /> : null}
      <View style={styles.controls}>
        <View style={styles.zoomGroup}>
          <Pressable accessibilityLabel="Zoom in" style={styles.control} onPress={() => changeZoom(Math.min(20, zoom + 1))}><Text style={styles.controlText}>+</Text></Pressable>
          <View style={styles.controlDivider} />
          <Pressable accessibilityLabel="Zoom out" style={styles.control} onPress={() => changeZoom(Math.max(4, zoom - 1))}><Text style={styles.controlText}>−</Text></Pressable>
        </View>
        <Pressable accessibilityLabel={voiceEnabled ? "Turn voice guidance off" : "Turn voice guidance on"} style={[styles.roundControl, voiceEnabled && styles.voiceControlActive]} onPress={() => setVoiceEnabled((value) => !value)}><Text style={styles.controlText}>{voiceEnabled ? "🔊" : "🔇"}</Text></Pressable>
        <Pressable accessibilityLabel="Toggle 3D view" style={[styles.roundControl, navigation3D && styles.modeControlActive]} onPress={() => setNavigation3D((value) => !value)}><Text style={[styles.modeControlText, !navigation3D && styles.modeControlInactiveText]}>{navigation3D ? "3D" : "2D"}</Text></Pressable>
        <Pressable accessibilityLabel="Recenter navigation" style={styles.roundControl} onPress={recenter}><Text style={styles.controlText}>◎</Text></Pressable>
      </View>
      {mapError || routeError ? <Text style={styles.error}>{mapError || routeError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { height: 470, borderRadius: 22, overflow: "hidden", backgroundColor: "#dbeafe" },
  fullScreenShell: { height: "100%", borderRadius: 0 },
  // MapLibre adds its own .maplibregl-map class, whose "position: relative" beats the
  // atomic class React Native Web generates for "position: absolute". Once the box is
  // relative, "inset: 0" only offsets it instead of stretching it, so the container
  // collapsed to height 0 and clipped the canvas (.maplibregl-map sets overflow:hidden)
  // — the map was drawing correctly into a box nobody could see. An explicit size works
  // regardless of which "position" wins.
  map: { width: "100%", height: "100%" },
  empty: { minHeight: 120, alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: "#f8fafc" },
  muted: { color: "#64748b", textAlign: "center" },
  // The portal's panel spans the full width with a 64 / flexible / 88 layout and a
  // 76px minimum height; the app previously used an inset dark card.
  instruction: { position: "absolute", zIndex: 5, top: 0, left: 0, right: 0, minHeight: 76, flexDirection: "row", alignItems: "stretch", overflow: "hidden", backgroundColor: "rgba(255,255,255,0.96)", shadowColor: "#0f172a", shadowOpacity: 0.14, shadowRadius: 26, shadowOffset: { width: 0, height: 10 } },
  instructionIconTile: { width: 64, alignItems: "center", justifyContent: "center", backgroundColor: "#17cf79" },
  instructionTextWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 8 },
  instructionTitle: { color: "#0f172a", fontSize: 16, lineHeight: 17, letterSpacing: -0.32, fontFamily: "Poppins_900Black" },
  instructionStats: { width: 88, justifyContent: "center", alignItems: "flex-end", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#ffffff" },
  instructionStatLabel: { color: "#64748b", fontSize: 10, letterSpacing: 1.4, fontFamily: "Poppins_700Bold", textTransform: "uppercase" },
  instructionStatLabelSpaced: { marginTop: 8 },
  instructionStatDistance: { color: "#0d61ad", fontSize: 14, lineHeight: 16, fontFamily: "Poppins_900Black" },
  instructionStatEta: { color: "#0f172a", fontSize: 14, lineHeight: 16, fontFamily: "Poppins_900Black" },
  controls: { position: "absolute", zIndex: 6, right: 14, bottom: 132, gap: 9, alignItems: "center" },
  zoomGroup: { overflow: "hidden", borderRadius: 24, backgroundColor: "rgba(255,255,255,0.97)", shadowColor: "#0f172a", shadowOpacity: 0.15, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } },
  control: { width: 44, height: 42, alignItems: "center", justifyContent: "center" },
  controlDivider: { height: 1, marginHorizontal: 9, backgroundColor: "#e2e8f0" },
  roundControl: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.97)", alignItems: "center", justifyContent: "center", shadowColor: "#0f172a", shadowOpacity: 0.15, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } },
  voiceControlActive: { backgroundColor: "#059669" },
  modeControlActive: { backgroundColor: "#0d82cf" },
  modeControlText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  modeControlInactiveText: { color: "#0f172a" },
  controlText: { fontSize: 20, color: "#0f172a", fontWeight: "800" },
  loader: { position: "absolute", left: 16, bottom: 134 },
  error: { position: "absolute", top: 90, left: 14, right: 14, zIndex: 7, color: "#991b1b", backgroundColor: "rgba(254,226,226,0.96)", padding: 8, borderRadius: 10, fontSize: 11 },
});
