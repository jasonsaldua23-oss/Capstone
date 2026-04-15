import { db } from '@/lib/db'

export async function normalizeLegacyOrderStatuses() {
  await db.$executeRaw`
    UPDATE "Order"
    SET "status" = CASE
      WHEN UPPER("status") = 'FAILED_DELIVERY' THEN 'CANCELLED'
      WHEN UPPER("status") = 'UNAPPROVED' THEN 'PROCESSING'
      WHEN UPPER("status") = 'CONFIRMED' THEN 'PROCESSING'
      WHEN UPPER("status") = 'READY_FOR_PICKUP' THEN 'PACKED'
      WHEN UPPER("status") = 'IN_TRANSIT' THEN 'DISPATCHED'
      ELSE "status"
    END
    WHERE UPPER("status") IN ('FAILED_DELIVERY', 'UNAPPROVED', 'CONFIRMED', 'READY_FOR_PICKUP', 'IN_TRANSIT')
  `
}
