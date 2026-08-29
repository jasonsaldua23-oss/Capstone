import test from "node:test";
import assert from "node:assert/strict";
import { getAvailableQuantity, getOrderStageIndex, isOrderCancellable, isOrderTrackable, isValidPhilippinePhone, normalizeOrderStatus, validatePasswordPolicy, withinNegrosOccidental } from "./customer-logic.ts";

const order = (status: string, extra: Record<string, unknown> = {}) => ({
  id: "o",
  orderNumber: "O",
  status,
  totalAmount: 1,
  createdAt: "2026-01-01",
  ...extra,
});

test("available inventory excludes reserved stock", () => {
  assert.equal(getAvailableQuantity({ id: "p", sku: "p", name: "P", price: 1, inventory: [{ quantity: 20, reservedQuantity: 4 }] }), 16);
});

test("status normalization matches the web portal for every backend OrderStatus", () => {
  assert.equal(normalizeOrderStatus(order("PENDING")), "PENDING");
  assert.equal(normalizeOrderStatus(order("CONFIRMED")), "PREPARING");
  assert.equal(normalizeOrderStatus(order("PREPARING")), "PREPARING");
  assert.equal(normalizeOrderStatus(order("RESCHEDULED")), "PENDING");
  assert.equal(normalizeOrderStatus(order("OUT_FOR_DELIVERY")), "OUT_FOR_DELIVERY");
  assert.equal(normalizeOrderStatus(order("DELIVERED")), "DELIVERED");
  assert.equal(normalizeOrderStatus(order("CANCELLED")), "CANCELLED");
});

test("a purchase request awaiting approval reads as pending regardless of order status", () => {
  assert.equal(normalizeOrderStatus(order("PREPARING", { paymentStatus: "pending_approval" })), "PENDING");
});

test("delivery stage index matches the web portal", () => {
  assert.equal(getOrderStageIndex(order("PENDING")), 0);
  assert.equal(getOrderStageIndex(order("CONFIRMED")), 1);
  assert.equal(getOrderStageIndex(order("OUT_FOR_DELIVERY")), 2);
  assert.equal(getOrderStageIndex(order("DELIVERED")), 3);
});

test("an order assigned to a delivery trip can no longer be cancelled", () => {
  assert.equal(isOrderCancellable(order("PENDING")), true);
  assert.equal(isOrderCancellable(order("PENDING", { assignedTripId: "t1" })), false);
  assert.equal(isOrderCancellable(order("OUT_FOR_DELIVERY")), false);
  assert.equal(isOrderCancellable(order("DELIVERED")), false);
});

test("tracking opens once the warehouse starts preparing", () => {
  assert.equal(isOrderTrackable(order("PENDING")), false);
  assert.equal(isOrderTrackable(order("CONFIRMED")), true);
  assert.equal(isOrderTrackable(order("OUT_FOR_DELIVERY")), true);
  assert.equal(isOrderTrackable(order("DELIVERED")), true);
});

test("password policy requires every configured character class", () => {
  assert.equal(validatePasswordPolicy("Valid123!"), null);
  assert.ok(validatePasswordPolicy("password"));
});

test("address coordinates are restricted to Negros Occidental", () => {
  assert.equal(withinNegrosOccidental(10.67, 122.95), true);
  assert.equal(withinNegrosOccidental(14.6, 120.98), false);
});

test("checkout accepts only supported Philippine mobile formats", () => {
  assert.equal(isValidPhilippinePhone("09171234567"), true);
  assert.equal(isValidPhilippinePhone("+63 917 123 4567"), true);
  assert.equal(isValidPhilippinePhone("12345"), false);
});
