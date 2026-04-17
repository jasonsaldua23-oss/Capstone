import { db } from '@/lib/db'

type OrderTimelineInput = {
  confirmedAt?: Date | null
  processedAt?: Date | null
  shippedAt?: Date | null
  deliveryDate?: Date | null
  deliveredAt?: Date | null
  cancelledAt?: Date | null
}

function isTimelineTableMissing(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  return /ordertimeline|relation .*ordertimeline.* does not exist|p2021/i.test(message)
}

export async function upsertOrderTimeline(orderId: string, input: OrderTimelineInput) {
  if (!orderId) return

  const now = new Date()
  try {
    await db.$executeRaw`
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
      VALUES (
        ${`otm_${orderId}`},
        ${orderId},
        ${input.confirmedAt ?? null},
        ${input.processedAt ?? null},
        ${input.shippedAt ?? null},
        ${input.deliveryDate ?? null},
        ${input.deliveredAt ?? null},
        ${input.cancelledAt ?? null},
        ${now},
        ${now}
      )
      ON CONFLICT ("orderId")
      DO UPDATE SET
        "confirmedAt" = COALESCE(EXCLUDED."confirmedAt", "OrderTimeline"."confirmedAt"),
        "processedAt" = COALESCE(EXCLUDED."processedAt", "OrderTimeline"."processedAt"),
        "shippedAt" = COALESCE(EXCLUDED."shippedAt", "OrderTimeline"."shippedAt"),
        "deliveryDate" = COALESCE(EXCLUDED."deliveryDate", "OrderTimeline"."deliveryDate"),
        "deliveredAt" = COALESCE(EXCLUDED."deliveredAt", "OrderTimeline"."deliveredAt"),
        "cancelledAt" = COALESCE(EXCLUDED."cancelledAt", "OrderTimeline"."cancelledAt"),
        "updatedAt" = EXCLUDED."updatedAt"
    `
  } catch (error) {
    if (isTimelineTableMissing(error)) {
      return
    }
    console.error('Upsert order timeline error:', error)
  }
}

export function flattenOrderTimeline(order: any) {
  const timeline = order?.timeline
  if (!timeline) return order

  const flattened = {
    ...order,
    confirmedAt: timeline.confirmedAt,
    processedAt: timeline.processedAt,
    shippedAt: timeline.shippedAt,
    deliveryDate: timeline.deliveryDate,
    deliveredAt: timeline.deliveredAt,
    cancelledAt: timeline.cancelledAt,
  }

  delete flattened.timeline
  return flattened
}
