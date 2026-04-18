import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "./api";
import type { AuthUser, DriverTrip } from "../types";

const TOKEN_KEY = "driver_auth_token";
const USER_KEY = "driver_auth_user";

interface LoginResponse {
  success: boolean;
  user: AuthUser;
  token: string;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await apiRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  if (data.user.role !== "DRIVER") {
    throw new Error("This app is for driver accounts only.");
  }

  await AsyncStorage.setItem(TOKEN_KEY, data.token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}

export async function logout(): Promise<void> {
  const token = await getToken();
  try {
    await apiRequest("/api/auth/logout", { method: "POST", token });
  } catch {
    // ignore logout API failure
  }
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export async function fetchDriverTrips(): Promise<DriverTrip[]> {
  const token = await getToken();
  const data = await apiRequest<{ success: boolean; trips: DriverTrip[] }>("/api/driver/trips", {
    method: "GET",
    token,
  });
  return data.trips || [];
}

export async function fetchDriverProfile(): Promise<AuthUser> {
  const token = await getToken();
  const data = await apiRequest<{ success: boolean; driver: { user: AuthUser } }>("/api/driver/profile", {
    method: "GET",
    token,
  });
  const user = data.driver?.user;
  if (!user) throw new Error("Invalid profile response");
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}
