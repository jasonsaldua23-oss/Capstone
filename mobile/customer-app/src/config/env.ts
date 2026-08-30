import Constants from "expo-constants";
import { Platform } from "react-native";

// The customer app previously hardcoded a fallback of http://10.0.2.2:8000 — the
// Android *emulator* alias for the host machine. On Expo web or a physical phone
// that address is unreachable, so every request hung until the 15s timeout and
// surfaced as "The request timed out. Check your connection and try again."
//
// This is the host resolution the driver app already uses.

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

// 10.0.2.2 is meaningful ONLY to the Android emulator. app.json used to pin
// extra.apiBaseUrl to it, which silently beat the detection above on every other
// platform — the browser dutifully called an address that cannot exist there and
// failed, first as a hang ("The request timed out") and then as "Failed to fetch".
// A configured value that cannot work on the current platform is a stale config,
// not an override, so drop it and fall back to detection rather than honouring it.
function usableOverride(value: unknown): string | null {
  const url = String(value || "").trim();
  if (!url) return null;
  const emulatorOnly = url.includes("10.0.2.2");
  if (emulatorOnly && Platform.OS !== "android") {
    console.warn(
      `[env] Ignoring configured API base URL "${url}": 10.0.2.2 is an Android-emulator-only ` +
        `address and this is ${Platform.OS}. Falling back to host detection.`,
    );
    return null;
  }
  return url;
}

export const API_BASE_URL = String(
  usableOverride(process.env.EXPO_PUBLIC_API_BASE_URL) ||
    usableOverride(Constants.expoConfig?.extra?.apiBaseUrl) ||
    runtimeApiBaseUrl(),
).replace(/\/$/, "");
