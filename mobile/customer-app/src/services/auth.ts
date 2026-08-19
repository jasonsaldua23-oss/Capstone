import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CustomerOrder, CustomerProfile, CustomerTrackingItem, CustomerUser, Product } from "../types";
import { apiRequest } from "./api";

const TOKEN_KEY = "customer_auth_token";
const USER_KEY = "customer_auth_user";
const REMEMBER_ME_KEY = "customer_auth_remember_me";

interface LoginResponse {
  success: boolean;
  user: CustomerUser;
  token: string;
}

interface MeResponse {
  success: boolean;
  user: CustomerUser;
}

interface OrdersResponse {
  success: boolean;
  orders: CustomerOrder[];
}

interface TrackingResponse {
  success: boolean;
  tracking: CustomerTrackingItem[];
}

interface FeedbackItemResponse {
  id: string;
  orderId?: string | null;
  order_id?: string | null;
  subject?: string | null;
  message?: string | null;
  rating?: number | null;
  type?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
}

interface FeedbackResponse {
  success: boolean;
  feedback?: FeedbackItemResponse[];
  feedbacks?: FeedbackItemResponse[];
}

interface ProductsResponse {
  success: boolean;
  products: Product[];
}

interface CustomerApiResponse {
  success: boolean;
  customer: {
    id: string;
    email: string;
    name: string;
    avatar?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    province?: string | null;
    zip_code?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
}

export interface CustomerProfileUpdateInput {
  name: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  zipCode: string;
  latitude: string;
  longitude: string;
}

export interface PlaceOrderInput {
  shippingAddress: string;
  shippingCity: string;
  shippingProvince: string;
  shippingZipCode: string;
  shippingLatitude: number;
  shippingLongitude: number;
  requestId: string;
  items: Array<
    | { itemType: "STANDARD_CASE"; productId: string; quantity: number }
    | { itemType: "MIXED_CASE"; caseCapacity: number; quantity: number; components: Array<{ productId: string; quantity: number }> }
  >;
}

export interface CustomerFeedbackItem {
  id: string;
  orderId: string;
  subject: string;
  message: string;
  rating: number;
  type: string;
  createdAt: string;
}

function toCustomerProfile(payload: CustomerApiResponse["customer"]): CustomerProfile {
  return {
    userId: payload.id,
    email: payload.email,
    name: payload.name,
    avatar: payload.avatar ?? null,
    phone: payload.phone ?? null,
    role: "CUSTOMER",
    type: "customer",
    address: payload.address ?? null,
    city: payload.city ?? null,
    province: payload.province ?? null,
    zipCode: payload.zip_code ?? null,
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
  };
}

function toCustomerFeedbackItem(payload: FeedbackItemResponse): CustomerFeedbackItem {
  return {
    id: String(payload.id || ""),
    orderId: String(payload.orderId || payload.order_id || ""),
    subject: String(payload.subject || ""),
    message: String(payload.message || ""),
    rating: Number(payload.rating || 0),
    type: String(payload.type || ""),
    createdAt: String(payload.createdAt || payload.created_at || ""),
  };
}

export async function login(email: string, password: string, rememberMe = true): Promise<CustomerUser> {
  const data = await apiRequest<LoginResponse>("/api/auth/customer/login", {
    method: "POST",
    body: JSON.stringify({ email, password, rememberMe }),
  });
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
    // Ignore logout API failures.
  }
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, REMEMBER_ME_KEY]);
}

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getStoredUser(): Promise<CustomerUser | null> {
  const rememberMe = await AsyncStorage.getItem(REMEMBER_ME_KEY);
  if (rememberMe !== "true") {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, REMEMBER_ME_KEY]);
    return null;
  }
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
  const data = await apiRequest<MeResponse>("/api/auth/me", {
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
  const data = await apiRequest<OrdersResponse>("/api/customer/orders?page=1&pageSize=50", {
    method: "GET",
    token,
  });
  return data.orders || [];
}

export async function fetchCustomerTracking(): Promise<CustomerTrackingItem[]> {
  const token = await getToken();
  const data = await apiRequest<TrackingResponse>("/api/customer/tracking", {
    method: "GET",
    token,
  });
  return data.tracking || [];
}

export async function fetchCustomerFeedback(): Promise<CustomerFeedbackItem[]> {
  const token = await getToken();
  const data = await apiRequest<FeedbackResponse>("/api/feedback?page=1&limit=500", {
    method: "GET",
    token,
  });
  const rows = Array.isArray(data.feedbacks) ? data.feedbacks : Array.isArray(data.feedback) ? data.feedback : [];
  return rows.map(toCustomerFeedbackItem).filter((item) => item.id);
}

export async function fetchProducts(): Promise<Product[]> {
  const token = await getToken();
  const data = await apiRequest<ProductsResponse>("/api/products?page=1&pageSize=100", {
    method: "GET",
    token,
  });
  return data.products || [];
}

export async function fetchCustomerProfile(userId: string): Promise<CustomerProfile> {
  const token = await getToken();
  const data = await apiRequest<CustomerApiResponse>(`/api/customers/${userId}`, {
    method: "GET",
    token,
  });
  const profile = toCustomerProfile(data.customer);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(profile));
  return profile;
}

export async function updateCustomerProfile(userId: string, input: CustomerProfileUpdateInput): Promise<CustomerProfile> {
  const token = await getToken();
  const latitude = input.latitude.trim() ? Number(input.latitude) : null;
  const longitude = input.longitude.trim() ? Number(input.longitude) : null;
  const data = await apiRequest<CustomerApiResponse>(`/api/customers/${userId}`, {
    method: "PUT",
    token,
    body: JSON.stringify({
      name: input.name,
      phone: input.phone,
      address: input.address,
      city: input.city,
      province: input.province,
      zipCode: input.zipCode,
      latitude,
      longitude,
    }),
  });
  const profile = toCustomerProfile(data.customer);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(profile));
  return profile;
}

export async function requestPasswordResetOtp(email: string): Promise<void> {
  await apiRequest("/api/auth/password-reset/request-otp", {
    method: "POST",
    body: JSON.stringify({ email, accountType: "customer" }),
  });
}

export async function verifyPasswordResetOtp(email: string, otp: string): Promise<void> {
  await apiRequest("/api/auth/password-reset/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, accountType: "customer", otp }),
  });
}

export async function resetPasswordWithOtp(email: string, otp: string, newPassword: string): Promise<void> {
  await apiRequest("/api/auth/password-reset/reset", {
    method: "POST",
    body: JSON.stringify({ email, accountType: "customer", otp, newPassword }),
  });
}

export async function placeOrder(input: PlaceOrderInput): Promise<CustomerOrder> {
  const token = await getToken();
  const data = await apiRequest<{ success: boolean; order: CustomerOrder }>("/api/customer/orders", {
    method: "POST",
    token,
    body: JSON.stringify({
      shippingAddress: input.shippingAddress,
      shippingCity: input.shippingCity,
      shippingProvince: input.shippingProvince,
      shippingZipCode: input.shippingZipCode,
      shippingLatitude: input.shippingLatitude,
      shippingLongitude: input.shippingLongitude,
      requestId: input.requestId,
      items: input.items,
    }),
  });
  return data.order;
}

export async function quoteMixedCase(input: {
  caseCapacity: number;
  quantity: number;
  components: Array<{ productId: string; quantity: number }>;
}): Promise<any> {
  const token = await getToken();
  const data = await apiRequest<{ success: boolean; quote: any }>("/api/mixed-cases/quote", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
  return data.quote;
}

export async function submitCustomerFeedback(input: {
  orderId: string;
  rating: number;
  type: "COMPLAINT" | "SUGGESTION" | "COMPLIMENT";
  subject: string;
  message: string;
}): Promise<void> {
  const token = await getToken();
  await apiRequest("/api/feedback", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export async function cancelOrder(orderId: string): Promise<void> {
  const token = await getToken();
  await apiRequest(`/api/customer/orders/${orderId}/cancel`, {
    method: "PATCH",
    token,
  });
}
