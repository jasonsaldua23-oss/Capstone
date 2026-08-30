import type { CustomerOrder, Product } from "../types";
import {
  getOrderStageIndex as sharedGetOrderStageIndex,
  isOrderCancellable as sharedIsOrderCancellable,
  isOrderTrackable as sharedIsOrderTrackable,
  normalizeDeliveryStatus,
  isPasswordValid,
  PASSWORD_POLICY_MESSAGE,
} from "./shared.ts";

// Re-exported so screens have one import site for shared formatting.
export { formatPeso, formatOrderStatus, isRescheduledOrder } from "./shared.ts";
// The customer cancellation reasons live in shared/customer-logic.
export { CUSTOMER_ORDER_REASONS, OTHER_ORDER_REASON, buildOrderActionReason } from "./shared.ts";

export const REPLACEMENT_REASONS = [
  "Damaged unit",
  "Wrong product",
  "Missing item",
  "Leaking container",
  "Expired product",
] as const;

export function getAvailableQuantity(product: Product): number {
  const explicit = Number(product.availableQuantity);
  if (Number.isFinite(explicit)) return Math.max(0, Math.floor(explicit));
  return (product.inventory || []).reduce(
    (sum, row) => sum + Math.max(0, Number(row.quantity || 0) - Number(row.reservedQuantity || 0)),
    0
  );
}

// Delegates to the web portal's rules so the two clients cannot disagree.
export function normalizeOrderStatus(order: CustomerOrder): string {
  return normalizeDeliveryStatus(String(order.status || ""), order.paymentStatus);
}

export function isPurchaseRequest(order: CustomerOrder): boolean {
  const requestStatus = String(order.requestStatus || "").toUpperCase();
  const orderStatus = normalizeOrderStatus(order);
  return Boolean(order.purchaseRequestNumber) || ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].includes(requestStatus) || orderStatus === "PENDING";
}

export function isOrderCancellable(order: CustomerOrder): boolean {
  return sharedIsOrderCancellable(String(order.status || ""), order.paymentStatus, order);
}

export function isOrderTrackable(order: CustomerOrder): boolean {
  return sharedIsOrderTrackable(String(order.status || ""));
}

export function getOrderStageIndex(order: CustomerOrder): number {
  return sharedGetOrderStageIndex(String(order.status || ""), order.paymentStatus);
}

export function validatePasswordPolicy(password: string): string | null {
  // Same rules the checklist shows, so the two cannot disagree.
  return isPasswordValid(password) ? null : PASSWORD_POLICY_MESSAGE;
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
