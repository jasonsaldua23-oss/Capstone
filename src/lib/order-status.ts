import { db } from '@/lib/db'

let hasNormalizedLegacyStatuses = false
let normalizationInFlight: Promise<void> | null = null

export async function normalizeLegacyOrderStatuses() {
  if (hasNormalizedLegacyStatuses) return

  if (!normalizationInFlight) {
    normalizationInFlight = (async () => {
      await db.$executeRaw`
        UPDATE "Order"
        SET "status" = CASE
          WHEN UPPER(CAST("status" AS TEXT)) = 'FAILED_DELIVERY' THEN 'CANCELLED'
          WHEN UPPER(CAST("status" AS TEXT)) = 'UNAPPROVED' THEN 'PREPARING'
          WHEN UPPER(CAST("status" AS TEXT)) = 'PROCESSING' THEN 'PREPARING'
          WHEN UPPER(CAST("status" AS TEXT)) = 'PACKED' THEN 'PREPARING'
          WHEN UPPER(CAST("status" AS TEXT)) = 'READY_FOR_PICKUP' THEN 'PREPARING'
          WHEN UPPER(CAST("status" AS TEXT)) = 'IN_TRANSIT' THEN 'OUT_FOR_DELIVERY'
          WHEN UPPER(CAST("status" AS TEXT)) = 'DISPATCHED' THEN 'OUT_FOR_DELIVERY'
          ELSE "status"
        END
        WHERE UPPER(CAST("status" AS TEXT)) IN ('FAILED_DELIVERY', 'UNAPPROVED', 'PROCESSING', 'PACKED', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'DISPATCHED')
      `
      hasNormalizedLegacyStatuses = true
    })().finally(() => {
      normalizationInFlight = null
    })
  }

  await normalizationInFlight
}
