-- Create table for vertically-partitioned order timeline fields.
CREATE TABLE IF NOT EXISTS "OrderTimeline" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "shippedAt" TIMESTAMP(3),
  "deliveryDate" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderTimeline_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrderTimeline_orderId_key" ON "OrderTimeline"("orderId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'OrderTimeline_orderId_fkey'
  ) THEN
    ALTER TABLE "OrderTimeline"
      ADD CONSTRAINT "OrderTimeline_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill existing order timeline values.
INSERT INTO "OrderTimeline" (
  "id",
  "orderId",
  "confirmedAt",
  "processedAt",
  "shippedAt",
  "deliveryDate",
  "deliveredAt",
  "cancelledAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'otm_' || substr(md5(o."id"), 1, 24) AS "id",
  o."id" AS "orderId",
  o."confirmedAt",
  o."processedAt",
  o."shippedAt",
  o."deliveryDate",
  o."deliveredAt",
  o."cancelledAt",
  o."createdAt",
  o."updatedAt"
FROM "Order" o
LEFT JOIN "OrderTimeline" ot ON ot."orderId" = o."id"
WHERE ot."orderId" IS NULL;
