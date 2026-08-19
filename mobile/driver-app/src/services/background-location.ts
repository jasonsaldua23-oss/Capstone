import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { isUsableLocationSample, type LocationSample } from "../lib/driver-logic";
import { pushDriverLocation } from "./auth";
import { ApiError } from "./api";
import { queueOfflineOperation } from "./offline-queue";

export const DRIVER_LOCATION_TASK = "aab-driver-active-trip-location";
const ACTIVE_TRIP_KEY = "driver_active_tracking_trip_id";
const LAST_LOCATION_KEY = "driver_last_accepted_location";

async function getLastAcceptedLocation(): Promise<LocationSample | null> {
  const raw = await AsyncStorage.getItem(LAST_LOCATION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocationSample;
  } catch {
    return null;
  }
}

async function submitBackgroundLocation(location: Location.LocationObject): Promise<void> {
  const tripId = await AsyncStorage.getItem(ACTIVE_TRIP_KEY);
  if (!tripId) return;
  const sample: LocationSample = {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    recordedAt: location.timestamp,
  };
  const previous = await getLastAcceptedLocation();
  if (!isUsableLocationSample(sample, previous)) return;
  await AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(sample));
  const body = {
    latitude: sample.latitude,
    longitude: sample.longitude,
    accuracy: location.coords.accuracy ?? null,
    heading: location.coords.heading ?? null,
    speed: location.coords.speed ?? null,
    altitude: location.coords.altitude ?? null,
    tripId,
  };
  try {
    await pushDriverLocation(body);
  } catch (error) {
    // Network/server failures are durable; invalid or unauthorized samples are not retried.
    if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
      await queueOfflineOperation({ kind: "LOCATION", method: "POST", path: "/api/driver/location", body });
    }
  }
}

// Expo requires background tasks to be registered in module scope.
if (!TaskManager.isTaskDefined(DRIVER_LOCATION_TASK)) {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(DRIVER_LOCATION_TASK, async ({ data, error }: {
    data?: { locations?: Location.LocationObject[] };
    error?: { message?: string } | null;
  }) => {
    if (error || !Array.isArray(data?.locations)) return;
    for (const location of data.locations) await submitBackgroundLocation(location);
  });
}

export async function startBackgroundTripTracking(tripId: string): Promise<"background" | "foreground-only"> {
  await AsyncStorage.setItem(ACTIVE_TRIP_KEY, tripId);
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") throw new Error("Location permission is required to start a trip.");

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted") return "foreground-only";
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  if (!alreadyStarted) {
    await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 5_000,
      distanceInterval: 5,
      deferredUpdatesInterval: 5_000,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "AAB Trading delivery in progress",
        notificationBody: "Sharing your location for the active trip.",
        notificationColor: "#0f766e",
        killServiceOnDestroy: false,
      },
    });
  }
  return "background";
}

export async function stopBackgroundTripTracking(): Promise<void> {
  await AsyncStorage.multiRemove([ACTIVE_TRIP_KEY, LAST_LOCATION_KEY]);
  if (await Location.hasStartedLocationUpdatesAsync(DRIVER_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  }
}

export async function getTrackedTripId(): Promise<string | null> {
  return AsyncStorage.getItem(ACTIVE_TRIP_KEY);
}
