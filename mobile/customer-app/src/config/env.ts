import Constants from "expo-constants";

const fallbackApiBaseUrl = "http://10.0.2.2:8000";

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  Constants.expoConfig?.extra?.apiBaseUrl ||
  fallbackApiBaseUrl;
