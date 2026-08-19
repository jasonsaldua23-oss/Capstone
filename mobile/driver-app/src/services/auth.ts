import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "./api";
import type { AuthUser, DriverNotification, DriverProfile, DriverTrip, DriverTripDropPoint } from "../types";

const TOKEN_KEY = "driver_auth_token";
const USER_KEY = "driver_auth_user";
const REMEMBER_ME_KEY = "driver_auth_remember_me";

interface LoginResponse {
  success: boolean;
  user: AuthUser;
  token: string;
}

interface DriverProfileApiResponse {
  success: boolean;
  driver: {
    id: string;
    email: string;
    name: string;
    avatar?: string | null;
    phone?: string | null;
    role?: string;
    emergencyContact?: string | null;
    emergency_contact?: string | null;
    licenseNumber?: string | null;
    license_number?: string | null;
    licenseType?: string | null;
    license_type?: string | null;
    licenseExpiry?: string | null;
    license_expiry?: string | null;
    user?: {
      id?: string;
      email?: string;
      name?: string;
      avatar?: string | null;
      phone?: string | null;
    };
  };
}

interface DriverTripsResponse {
  success: boolean;
  trips: DriverTrip[];
}

interface NotificationsResponse {
  success: boolean;
  notifications: DriverNotification[];
  unreadCount: number;
}

export interface DriverProfileUpdateInput {
  name: string;
  phone: string;
  emergencyContact: string;
  licenseNumber: string;
  licenseType: string;
  licenseExpiry: string;
}

function toDriverProfile(payload: DriverProfileApiResponse["driver"]): DriverProfile {
  const account = payload.user || payload;
  return {
    userId: account.id || payload.id,
    email: account.email || payload.email,
    name: account.name || payload.name,
    avatar: account.avatar ?? payload.avatar ?? null,
    phone: account.phone ?? payload.phone ?? null,
    role: "DRIVER",
    type: "staff",
    emergencyContact: payload.emergencyContact ?? payload.emergency_contact ?? null,
    licenseNumber: payload.licenseNumber ?? payload.license_number ?? null,
    licenseType: payload.licenseType ?? payload.license_type ?? null,
    licenseExpiry: payload.licenseExpiry ?? payload.license_expiry ?? null,
  };
}

export async function login(email: string, password: string, rememberMe = true): Promise<AuthUser> {
  const data = await apiRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, rememberMe, portal: "driver" }),
  });

  if (data.user.role !== "DRIVER") {
    throw new Error("This app is for driver accounts only.");
  }

  await AsyncStorage.setItem(TOKEN_KEY, data.token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
  await AsyncStorage.setItem(REMEMBER_ME_KEY, rememberMe ? "true" : "false");
  return data.user;
}

export async function logout(): Promise<void> {
  const token = await getToken();
  try {
    await apiRequest("/api/auth/logout", { method: "POST", token });
  } catch {
    // ignore logout API failure
  }
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, REMEMBER_ME_KEY]);
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const rememberMe = await AsyncStorage.getItem(REMEMBER_ME_KEY);
  if (rememberMe !== "true") {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, REMEMBER_ME_KEY]);
    return null;
  }
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
  // The mobile history/search must cover the complete assigned trip set, not only the first card page.
  const data = await apiRequest<DriverTripsResponse>("/api/driver/trips?page=1&pageSize=1000", {
    method: "GET",
    token,
  });
  return data.trips || [];
}

export async function fetchDriverProfile(): Promise<DriverProfile> {
  const token = await getToken();
  const data = await apiRequest<DriverProfileApiResponse>("/api/driver/profile", {
    method: "GET",
    token,
  });
  const user = toDriverProfile(data.driver);
  if (!user) throw new Error("Invalid profile response");
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export async function updateDriverProfile(input: DriverProfileUpdateInput): Promise<DriverProfile> {
  const token = await getToken();
  const data = await apiRequest<DriverProfileApiResponse>("/api/driver/profile", {
    method: "PUT",
    token,
    body: JSON.stringify(input),
  });
  const user = toDriverProfile(data.driver);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export async function requestPasswordResetOtp(email: string): Promise<void> {
  await apiRequest("/api/auth/password-reset/request-otp", {
    method: "POST",
    body: JSON.stringify({ email, accountType: "staff" }),
  });
}

export async function verifyPasswordResetOtp(email: string, otp: string): Promise<void> {
  await apiRequest("/api/auth/password-reset/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, accountType: "staff", otp }),
  });
}

export async function resetPasswordWithOtp(email: string, otp: string, newPassword: string): Promise<void> {
  await apiRequest("/api/auth/password-reset/reset", {
    method: "POST",
    body: JSON.stringify({ email, accountType: "staff", otp, newPassword }),
  });
}

export async function startTrip(tripId: string, location?: { latitude: number; longitude: number } | null): Promise<void> {
  const token = await getToken();
  await apiRequest(`/api/trips/${tripId}/start`, {
    method: "POST",
    token,
    body: JSON.stringify({
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
    }),
  });
}

export async function pushDriverLocation(input: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  altitude?: number | null;
  tripId?: string | null;
}): Promise<void> {
  const token = await getToken();
  await apiRequest("/api/driver/location", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export type StopUpdateInput = {
  status: "ARRIVED" | "COMPLETED" | "FAILED" | "SKIPPED" | "CANCELLED";
  notes?: string;
  recipientName?: string;
  deliveryPhoto?: string;
  failureReason?: string;
  failureNotes?: string;
  releaseInventory?: boolean;
  rescheduleRequested?: boolean;
  rescheduleWindow?: "today" | "tomorrow" | "other_date";
  rescheduleDate?: string;
  returnedEmpties?: Array<{ containerTypeId: string; returnedQuantity: number }>;
};

export async function updateTripStop(tripId: string, dropPointId: string, input: StopUpdateInput): Promise<DriverTripDropPoint> {
  const token = await getToken();
  const data = await apiRequest<{ success: boolean; dropPoint: DriverTripDropPoint }>(
    `/api/trips/${tripId}/drop-points/${dropPointId}`,
    { method: "PATCH", token, body: JSON.stringify(input) },
  );
  return data.dropPoint;
}

export async function uploadPodImage(uri: string): Promise<string> {
  const token = await getToken();
  const form = new FormData();
  const extension = uri.split(".").pop()?.toLowerCase() || "jpg";
  const mimeType = extension === "png" ? "image/png" : "image/jpeg";
  // React Native FormData accepts a local file descriptor for native uploads.
  form.append("file", { uri, name: `pod-${Date.now()}.${extension}`, type: mimeType } as any);
  const data = await apiRequest<{ success: boolean; imageUrl?: string }>("/api/uploads/pod-image", {
    method: "POST",
    token,
    body: form,
    timeoutMs: 30_000,
  });
  if (!data.imageUrl) throw new Error("The proof image upload did not return an image URL.");
  return data.imageUrl;
}

export async function fetchNotifications(): Promise<NotificationsResponse> {
  const token = await getToken();
  return apiRequest<NotificationsResponse>("/api/notifications?limit=100", { method: "GET", token });
}

export async function markAllNotificationsRead(): Promise<void> {
  const token = await getToken();
  await apiRequest("/api/notifications", {
    method: "PATCH",
    token,
    body: JSON.stringify({ markAll: true }),
  });
}

export async function clearNotifications(): Promise<void> {
  const token = await getToken();
  await apiRequest("/api/notifications", { method: "DELETE", token });
}
