import { NativeModules, Platform } from "react-native";

type SecureStorageModule = {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  deleteItem(key: string): Promise<void>;
};

const nativeSecureStorage = NativeModules.DriverSecureStorage as SecureStorageModule | undefined;
let sessionToken: string | null = null;

export async function storeProtectedToken(key: string, token: string, persistent: boolean): Promise<void> {
  sessionToken = token;
  if (persistent && Platform.OS === "android" && nativeSecureStorage) {
    // Remembered sessions are encrypted by Android Keystore; non-remembered tokens remain memory-only.
    await nativeSecureStorage.setItem(key, token);
  } else if (nativeSecureStorage) {
    await nativeSecureStorage.deleteItem(key);
  }
}

export async function readProtectedToken(key: string, persistent: boolean): Promise<string | null> {
  if (sessionToken) return sessionToken;
  if (!persistent) return null;
  // Unsupported preview platforms never fall back to plaintext token persistence.
  if (Platform.OS !== "android" || !nativeSecureStorage) return null;
  sessionToken = await nativeSecureStorage.getItem(key);
  return sessionToken;
}

export async function deleteProtectedToken(key: string): Promise<void> {
  sessionToken = null;
  if (nativeSecureStorage) await nativeSecureStorage.deleteItem(key);
}
