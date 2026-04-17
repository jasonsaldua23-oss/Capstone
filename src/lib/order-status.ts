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
          WHEN UPPER(CAST("status" AS TEXT)) = 'UNAPPROVED' THEN 'PROCESSING'
          WHEN UPPER(CAST("status" AS TEXT)) = 'CONFIRMED' THEN 'PROCESSING'
          WHEN UPPER(CAST("status" AS TEXT)) = 'READY_FOR_PICKUP' THEN 'PACKED'
          WHEN UPPER(CAST("status" AS TEXT)) = 'IN_TRANSIT' THEN 'DISPATCHED'
          ELSE "status"
        END
        WHERE UPPER(CAST("status" AS TEXT)) IN ('FAILED_DELIVERY', 'UNAPPROVED', 'CONFIRMED', 'READY_FOR_PICKUP', 'IN_TRANSIT')
      `
      hasNormalizedLegacyStatuses = true
    })().finally(() => {
      normalizationInFlight = null
    })
  }

  await normalizationInFlight
}
