import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  CustomerNotification,
  CustomerOrder,
  CustomerProfile,
  CustomerReplacement,
  CustomerTrackingItem,
  CustomerUser,
  EligibleEmptyItem,
  Product,
} from "../types";
import { MAIL_REQUEST_TIMEOUT_MS, apiRequest } from "./api";

const TOKEN_KEY = "customer_auth_token";
const USER_KEY = "customer_auth_user";
const REMEMBER_ME_KEY = "customer_auth_remember_me";

interface LoginResponse {
  success: boolean;
  user: CustomerUser;
  token: string;
}

interface EmailVerificationResponse {
  success: boolean;
  verificationToken?: string;
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
    zipCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    firstName?: string | null;
    first_name?: string | null;
    middleName?: string | null;
    middle_name?: string | null;
    lastName?: string | null;
    last_name?: string | null;
    suffix?: string | null;
    country?: string | null;
    discountOption?: string | null;
    discountStatus?: string | null;
    discountPercent?: number | null;
    discountAmountPerCase?: number | null;
    twoFactorEnabled?: boolean;
    loginAlertsEnabled?: boolean;
    bottleBalances?: CustomerProfile["bottleBalances"];
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
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  avatar?: string | null;
}

export interface PlaceOrderInput {
  shippingAddress: string;
  shippingCity: string;
  shippingProvince: string;
  shippingZipCode: string;
  shippingLatitude: number;
  shippingLongitude: number;
  requestId: string;
  shippingName?: string;
  shippingPhone?: string;
  shippingCountry?: string;
  notes?: string;
  deliveryDate?: string;
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
    zipCode: payload.zipCode ?? payload.zip_code ?? null,
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    firstName: payload.firstName ?? payload.first_name ?? null,
    middleName: payload.middleName ?? payload.middle_name ?? null,
    lastName: payload.lastName ?? payload.last_name ?? null,
    suffix: payload.suffix ?? null,
    country: payload.country ?? "Philippines",
    discountOption: payload.discountOption ?? null,
    discountStatus: payload.discountStatus ?? null,
    discountPercent: payload.discountPercent ?? null,
    discountAmountPerCase: payload.discountAmountPerCase ?? null,
    twoFactorEnabled: payload.twoFactorEnabled ?? false,
    loginAlertsEnabled: payload.loginAlertsEnabled ?? true,
    bottleBalances: payload.bottleBalances ?? [],
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

async function persistAuthenticatedSession(data: LoginResponse, rememberMe: boolean): Promise<CustomerUser> {
  await AsyncStorage.setItem(TOKEN_KEY, data.token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
  await AsyncStorage.setItem(REMEMBER_ME_KEY, rememberMe ? "true" : "false");
  return data.user;
}

export async function requestEmailVerification(email: string): Promise<void> {
  await apiRequest("/api/auth/email-verification/request", {
    method: "POST",
    timeoutMs: MAIL_REQUEST_TIMEOUT_MS,
    body: JSON.stringify({ email, accountType: "customer" }),
  });
}

export async function confirmEmailVerification(email: string, otp: string): Promise<string> {
  const data = await apiRequest<EmailVerificationResponse>("/api/auth/email-verification/confirm", {
    method: "POST",
    body: JSON.stringify({ email, otp, accountType: "customer" }),
  });
  if (!data.verificationToken) throw new Error("Email verification token was not returned.");
  return data.verificationToken;
}

export async function registerCustomer(input: {
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  email: string;
  password: string;
  emailVerificationToken: string;
}): Promise<CustomerUser> {
  const data = await apiRequest<LoginResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  // Added: registration mirrors the web flow by opening the authenticated customer session immediately.
  return persistAuthenticatedSession(data, true);
}

export async function loginWithGoogle(idToken: string): Promise<CustomerUser> {
  const data = await apiRequest<LoginResponse>("/api/auth/customer/google", {
    method: "POST",
    body: JSON.stringify({ idToken, rememberMe: true }),
  });
  return persistAuthenticatedSession(data, true);
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

export async function updateSecuritySetting(
  userId: string,
  field: "twoFactorEnabled" | "loginAlertsEnabled",
  value: boolean
): Promise<CustomerProfile> {
  const token = await getToken();
  const data = await apiRequest<{ customer: CustomerProfile }>(`/api/customers/${userId}`, {
    method: "PUT",
    token,
    body: JSON.stringify({ [field]: value }),
  });
  return data.customer;
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
      firstName: input.firstName,
      middleName: input.middleName,
      lastName: input.lastName,
      suffix: input.suffix,
      avatar: input.avatar,
    }),
  });
  const profile = toCustomerProfile(data.customer);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(profile));
  return profile;
}

export async function requestPasswordResetOtp(email: string): Promise<void> {
  await apiRequest("/api/auth/password-reset/request-otp", {
    method: "POST",
    timeoutMs: MAIL_REQUEST_TIMEOUT_MS,
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
      shippingName: input.shippingName,
      shippingPhone: input.shippingPhone,
      shippingCountry: input.shippingCountry || "Philippines",
      notes: input.notes,
      deliveryDate: input.deliveryDate || null,
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

export async function cancelOrder(orderId: string, reason: string): Promise<void> {
  const token = await getToken();
  await apiRequest(`/api/customer/orders/${orderId}/cancel`, {
    method: "PATCH",
    token,
    // Fix: the backend requires the same explicit cancellation reason used by the web portal.
    body: JSON.stringify({ reason }),
  });
}

export async function fetchNotifications(): Promise<{ notifications: CustomerNotification[]; unreadCount: number }> {
  const token = await getToken();
  return apiRequest("/api/notifications?limit=100", { method: "GET", token });
}

export async function markNotificationsRead(ids?: string[]): Promise<number> {
  const token = await getToken();
  const data = await apiRequest<{ unreadCount: number }>("/api/notifications", {
    method: "PATCH",
    token,
    body: JSON.stringify(ids?.length ? { ids } : { markAll: true }),
  });
  return Number(data.unreadCount || 0);
}

export async function clearNotifications(): Promise<void> {
  const token = await getToken();
  await apiRequest("/api/notifications", { method: "DELETE", token });
}

export async function fetchCustomerReplacements(): Promise<CustomerReplacement[]> {
  const token = await getToken();
  const data = await apiRequest<{ replacements?: CustomerReplacement[] }>("/api/customer/replacements?page=1&pageSize=300", {
    method: "GET",
    token,
  });
  return Array.isArray(data.replacements) ? data.replacements : [];
}

export async function uploadReplacementEvidence(file: { uri: string; name: string; type: string }): Promise<string> {
  const token = await getToken();
  const form = new FormData();
  form.append("file", file as unknown as Blob);
  const data = await apiRequest<{ fileUrl?: string }>("/api/uploads/replacement-evidence", {
    method: "POST",
    token,
    body: form,
  });
  if (!data.fileUrl) throw new Error("Evidence upload did not return a file URL.");
  return data.fileUrl;
}

export async function cancelReplacementRequest(replacementId: string): Promise<void> {
  const token = await getToken();
  await apiRequest(`/api/customer/replacements/${encodeURIComponent(replacementId)}/cancel`, {
    method: "POST",
    token,
  });
}

export async function submitReplacementRequest(input: {
  orderId: string;
  numberDamagedItems: number;
  damageType: string;
  description?: string;
  evidence: string[];
  // Built by buildReplacementRequest in shared/customer-logic; the web sends every
  // field it produces, so this stays open rather than narrowing the payload.
  replacementLines: Array<Record<string, unknown>>;
}): Promise<CustomerReplacement> {
  const token = await getToken();
  const data = await apiRequest<{ replacement: CustomerReplacement }>("/api/customer/replacements", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
  return data.replacement;
}

export async function fetchEligibleEmptyItems(): Promise<EligibleEmptyItem[]> {
  const token = await getToken();
  const data = await apiRequest<{ eligibleItems?: EligibleEmptyItem[] }>("/api/customer/empty-bottles/eligible", {
    method: "GET",
    token,
  });
  return Array.isArray(data.eligibleItems) ? data.eligibleItems : [];
}

export async function recordEmptyBottles(productId: string, cases: number): Promise<string> {
  const token = await getToken();
  const data = await apiRequest<{ message?: string }>("/api/customer/empty-bottles/record", {
    method: "POST",
    token,
    body: JSON.stringify({ productId, cases }),
  });
  return data.message || "Empty bottles recorded successfully.";
}

export async function uploadCustomerAvatar(file: { uri: string; name: string; type: string }): Promise<string> {
  const token = await getToken();
  const form = new FormData();
  form.append("file", file as unknown as Blob);
  const data = await apiRequest<{ imageUrl?: string }>("/api/uploads/customer-avatar", {
    method: "POST",
    token,
    body: form,
  });
  if (!data.imageUrl) throw new Error("Avatar upload did not return an image URL.");
  return data.imageUrl;
}
