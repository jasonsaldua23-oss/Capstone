import type { CustomerOrder, Product } from "../types";

export const CUSTOMER_ORDER_REASONS = [
  "Ordered by mistake",
  "Need to change the order",
  "Delivery date is no longer suitable",
  "Found another supplier",
  "Other",
] as const;

export const REPLACEMENT_REASONS = [
  "Damaged unit",
  "Wrong product",
  "Missing item",
  "Leaking container",
  "Expired product",
] as const;

export function formatPeso(value: number): string {
  return `₱${Math.max(0, Number(value || 0)).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getAvailableQuantity(product: Product): number {
  const explicit = Number(product.availableQuantity);
  if (Number.isFinite(explicit)) return Math.max(0, Math.floor(explicit));
  return (product.inventory || []).reduce(
    (sum, row) => sum + Math.max(0, Number(row.quantity || 0) - Number(row.reservedQuantity || 0)),
    0
  );
}

export function normalizeOrderStatus(order: CustomerOrder): string {
  const status = String(order.status || "").trim().toUpperCase();
  if (status === "APPROVED") return "PROCESSING";
  if (status === "SHIPPED" || status === "IN_TRANSIT") return "OUT_FOR_DELIVERY";
  return status || "PENDING";
}

export function isPurchaseRequest(order: CustomerOrder): boolean {
  const requestStatus = String(order.requestStatus || "").toUpperCase();
  const orderStatus = normalizeOrderStatus(order);
  return Boolean(order.purchaseRequestNumber) || ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].includes(requestStatus) || orderStatus === "PENDING";
}

export function isOrderCancellable(order: CustomerOrder): boolean {
  return !["PREPARING", "DELIVERED", "CANCELLED", "REJECTED"].includes(normalizeOrderStatus(order));
}

export function isOrderTrackable(order: CustomerOrder): boolean {
  return ["PROCESSING", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"].includes(normalizeOrderStatus(order));
}

export function getOrderStageIndex(order: CustomerOrder): number {
  const status = normalizeOrderStatus(order);
  if (status === "DELIVERED") return 3;
  if (status === "OUT_FOR_DELIVERY") return 2;
  if (["PROCESSING", "PREPARING"].includes(status)) return 1;
  return 0;
}

export function validatePasswordPolicy(password: string): string | null {
  const message = "Password must be at least 8 characters and include uppercase, lowercase, number, and special character, with no spaces.";
  if (password.length < 8 || /\s/.test(password)) return message;
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) return message;
  if (!/[^A-Za-z0-9\s]/.test(password)) return message;
  return null;
}

export function isValidPhilippinePhone(phone: string): boolean {
  const cleaned = String(phone || "").replace(/\D/g, "");
  return /^09\d{9}$/.test(cleaned) || /^63\d{10}$/.test(cleaned);
}

export function localDateInput(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function withinNegrosOccidental(latitude: number, longitude: number): boolean {
  // Same bounding box used by the customer web address picker.
  return latitude >= 10.62 && latitude <= 10.94 && longitude >= 122.86 && longitude <= 123.08;
}
