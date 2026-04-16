ALTER TABLE "Customer" RENAME COLUMN "state" TO "province";
ALTER TABLE "Warehouse" RENAME COLUMN "state" TO "province";
ALTER TABLE "Order" RENAME COLUMN "shippingState" TO "shippingProvince";
ALTER TABLE "Order" RENAME COLUMN "billingState" TO "billingProvince";
ALTER TABLE "Driver" RENAME COLUMN "state" TO "province";
ALTER TABLE "TripDropPoint" RENAME COLUMN "state" TO "province";
ALTER TABLE "Return" RENAME COLUMN "pickupState" TO "pickupProvince";
