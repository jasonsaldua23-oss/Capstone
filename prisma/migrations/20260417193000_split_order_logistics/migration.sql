-- Create table for vertically-partitioned order logistics fields.
CREATE TABLE IF NOT EXISTS "OrderLogistics" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "shippingName" TEXT NOT NULL,
  "shippingPhone" TEXT NOT NULL,
  "shippingAddress" TEXT NOT NULL,
  "shippingCity" TEXT NOT NULL,
  "shippingProvince" TEXT NOT NULL,
  "shippingZipCode" TEXT NOT NULL,
  "shippingCountry" TEXT NOT NULL DEFAULT 'USA',
  "shippingLatitude" DOUBLE PRECISION,
  "shippingLongitude" DOUBLE PRECISION,
  "billingName" TEXT,
  "billingAddress" TEXT,
  "billingCity" TEXT,
  "billingProvince" TEXT,
  "billingZipCode" TEXT,
  "billingCountry" TEXT,
  "notes" TEXT,
  "specialInstructions" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderLogistics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrderLogistics_orderId_key" ON "OrderLogistics"("orderId");

ALTER TABLE "OrderLogistics"
  ADD CONSTRAINT "OrderLogistics_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing orders into the new table.
INSERT INTO "OrderLogistics" (
  "id",
  "orderId",
  "shippingName",
  "shippingPhone",
  "shippingAddress",
  "shippingCity",
  "shippingProvince",
  "shippingZipCode",
  "shippingCountry",
  "shippingLatitude",
  "shippingLongitude",
  "billingName",
  "billingAddress",
  "billingCity",
  "billingProvince",
  "billingZipCode",
  "billingCountry",
  "notes",
  "specialInstructions",
  "createdAt",
  "updatedAt"
)
SELECT
  'olog_' || substr(md5(o."id"), 1, 24) AS "id",
  o."id" AS "orderId",
  o."shippingName",
  o."shippingPhone",
  o."shippingAddress",
  o."shippingCity",
  o."shippingProvince",
  o."shippingZipCode",
  COALESCE(o."shippingCountry", 'USA') AS "shippingCountry",
  o."shippingLatitude",
  o."shippingLongitude",
  o."billingName",
  o."billingAddress",
  o."billingCity",
  o."billingProvince",
  o."billingZipCode",
  o."billingCountry",
  o."notes",
  o."specialInstructions",
  o."createdAt",
  o."updatedAt"
FROM "Order" o
LEFT JOIN "OrderLogistics" ol ON ol."orderId" = o."id"
WHERE ol."orderId" IS NULL;
