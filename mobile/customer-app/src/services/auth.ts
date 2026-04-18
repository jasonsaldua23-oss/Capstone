import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CustomerOrder, CustomerTrackingItem, CustomerUser } from "../types";
import { apiRequest } from "./api";

const TOKEN_KEY = "customer_auth_token";
const USER_KEY = "customer_auth_user";

interface LoginResponse {
  success: boolean;
  user: CustomerUser;
  token: string;
}

export async function login(email: string, password: string): Promise<CustomerUser> {
  const data = await apiRequest<LoginResponse>("/api/auth/customer/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await AsyncStorage.setItem(TOKEN_KEY, data.token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}

export async function logout(): Promise<void> {
  const token = await getToken();
  try {
    await apiRequest("/api/auth/logout", { method: "POST", token });
  } catch {
    // Ignore logout API failures.
  }
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getStoredUser(): Promise<CustomerUser | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CustomerUser;
  } catch {
    return null;
  }
}

export async function fetchAuthMe(): Promise<CustomerUser> {
  const token = await getToken();
  const data = await apiRequest<{ success: boolean; user: CustomerUser }>("/api/auth/me", {
    method: "GET",
    token,
  });
  if (!data.user || data.user.type !== "customer") {
    throw new Error("Invalid customer token.");
  }
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}

export async function fetchCustomerOrders(): Promise<CustomerOrder[]> {
  const token = await getToken();
  const data = await apiRequest<{ success: boolean; orders: CustomerOrder[] }>("/api/customer/orders", {
    method: "GET",
    token,
  });
  return data.orders || [];
}

export async function fetchCustomerTracking(): Promise<CustomerTrackingItem[]> {
  const token = await getToken();
  const data = await apiRequest<{ success: boolean; tracking: CustomerTrackingItem[] }>("/api/customer/tracking", {
    method: "GET",
    token,
  });
  return data.tracking || [];
}
