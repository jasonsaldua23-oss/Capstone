import test from "node:test";
import assert from "node:assert/strict";
import { getAvailableQuantity, getOrderStageIndex, isValidPhilippinePhone, validatePasswordPolicy, withinNegrosOccidental } from "./customer-logic.ts";

test("available inventory excludes reserved stock", () => {
  assert.equal(getAvailableQuantity({ id: "p", sku: "p", name: "P", price: 1, inventory: [{ quantity: 20, reservedQuantity: 4 }] }), 16);
});

test("delivery stage normalization matches the web portal", () => {
  assert.equal(getOrderStageIndex({ id: "o", orderNumber: "O", status: "SHIPPED", totalAmount: 1, createdAt: "2026-01-01" }), 2);
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
