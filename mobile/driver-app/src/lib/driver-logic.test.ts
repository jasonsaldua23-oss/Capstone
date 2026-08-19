import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTripSearchText,
  getAssignedVehicleSymbol,
  getStartBlockedOrders,
  haversineMeters,
  isUsableLocationSample,
  normalizeStatus,
  mergeQueuedOperation,
} from "./driver-logic.ts";

test("trip start is blocked by every order that is not loaded or dispatched", () => {
  const trip = {
    dropPoints: [
      { order: { orderNumber: "ORD-1", warehouseStage: "LOADED" } },
      { order: { orderNumber: "ORD-2", warehouseStage: "ready_to_load" } },
      { order: { orderNumber: "ORD-3", warehouseStage: "DISPATCHED" } },
    ],
  };

  assert.deepEqual(getStartBlockedOrders(trip), ["ORD-2"]);
});

test("trip search includes vehicle, customer, address, and order data", () => {
  const searchText = buildTripSearchText({
    tripNumber: "TRP-100",
    status: "IN_PROGRESS",
    vehicle: { licensePlate: "ABC-123", type: "Tricycle" },
    dropPoints: [
      {
        locationName: "Downtown Shop",
        address: "Lacson Street",
        contactName: "Ana Cruz",
        order: { orderNumber: "ORD-77", shippingName: "Ana Cruz" },
      },
    ],
  });

  for (const expected of ["trp-100", "abc-123", "tricycle", "downtown shop", "lacson street", "ana cruz", "ord-77"]) {
    assert.match(searchText, new RegExp(expected));
  }
});

test("GPS samples reject poor accuracy and impossible movement", () => {
  const previous = { latitude: 10, longitude: 122, accuracy: 15, recordedAt: 1_000 };
  assert.equal(isUsableLocationSample({ ...previous, accuracy: 251, recordedAt: 2_000 }, previous), false);
  assert.equal(
    isUsableLocationSample({ latitude: 10.01, longitude: 122.01, accuracy: 10, recordedAt: 2_000 }, previous),
    false,
  );
  assert.equal(
    isUsableLocationSample({ latitude: 10.00005, longitude: 122.00005, accuracy: 10, recordedAt: 6_000 }, previous),
    true,
  );
});

test("distance and status helpers are deterministic", () => {
  assert.ok(haversineMeters({ latitude: 10, longitude: 122 }, { latitude: 10.001, longitude: 122 }) > 100);
  assert.equal(normalizeStatus("in progress"), "IN_PROGRESS");
});

test("assigned tricycles use a tricycle marker instead of an arrow or dot", () => {
  assert.equal(getAssignedVehicleSymbol({ type: "Motorized Tricycle" }), "🛺");
  assert.equal(getAssignedVehicleSymbol({ type: "Van" }), "🚐");
});

test("offline queue coalesces locations but preserves delivery mutation order", () => {
  const queue = [
    { id: "stop-1", kind: "UPDATE_STOP" },
    { id: "location-1", kind: "LOCATION" },
  ];
  const next = mergeQueuedOperation(queue, { id: "location-2", kind: "LOCATION" });
  assert.deepEqual(next.map((item) => item.id), ["stop-1", "location-2"]);

  const final = mergeQueuedOperation(next, { id: "stop-2", kind: "UPDATE_STOP" });
  assert.deepEqual(final.map((item) => item.id), ["stop-1", "location-2", "stop-2"]);
});
