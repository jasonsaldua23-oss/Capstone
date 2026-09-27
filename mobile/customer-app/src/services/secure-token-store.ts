// Mirrors mobile/driver-app/src/services/secure-token-store.ts, backed by expo-secure-store
// (Android Keystore / iOS Keychain) instead of the driver app's own native module.
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// The web preview has no encrypted store, and never falls back to plaintext persistence.
const secureStoreAvailable = Platform.OS === "android" || Platform.OS === "ios";
let sessionToken: string | null = null;

export async function storeProtectedToken(key: string, token: string, persistent: boolean): Promise<void> {
  sessionToken = token;
  if (!secureStoreAvailable) return;
  // Remembered sessions are encrypted at rest; other tokens stay in memory and end with the app.
  if (persistent) await SecureStore.setItemAsync(key, token);
  else await SecureStore.deleteItemAsync(key);
}

export async function readProtectedToken(key: string, persistent: boolean): Promise<string | null> {
  if (sessionToken) return sessionToken;
  if (!persistent || !secureStoreAvailable) return null;
  sessionToken = await SecureStore.getItemAsync(key);
  return sessionToken;
}

export async function deleteProtectedToken(key: string): Promise<void> {
  sessionToken = null;
  if (secureStoreAvailable) await SecureStore.deleteItemAsync(key);
}
