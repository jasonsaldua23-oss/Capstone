import Constants from "expo-constants";
import { Platform } from "react-native";

function extractHostname(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    return url.hostname || null;
  } catch {
    return null;
  }
}

function runtimeApiBaseUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    // Web preview must call the backend on the browser's machine/LAN host, never 10.0.2.2.
    return `http://${window.location.hostname || "localhost"}:8000`;
  }

  const developmentHost = extractHostname(Constants.expoConfig?.hostUri || Constants.linkingUri);
  if (developmentHost && !["localhost", "127.0.0.1", "::1"].includes(developmentHost)) {
    // Expo exposes the Metro host, which is also the reachable PC address for a physical phone.
    return `http://${developmentHost}:8000`;
  }

  return Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://localhost:8000";
}

export const API_BASE_URL =
  String(process.env.EXPO_PUBLIC_API_BASE_URL || Constants.expoConfig?.extra?.apiBaseUrl || runtimeApiBaseUrl()).replace(/\/$/, "");
