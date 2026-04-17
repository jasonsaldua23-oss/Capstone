import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiResponse, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { notifyOrderCancelledByCustomer } from '@/lib/notifications'
import { upsertOrderTimeline } from '@/lib/order-timeline'

const CANCELLABLE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'UNAPPROVED', 'PROCESSING'])

const normalizeOrderStatus = (status: string) => {
  const raw = String(status || '').toUpperCase()
  if (raw === 'READY_FOR_PICKUP') return 'PACKED'
  if (raw === 'IN_TRANSIT') return 'DISPATCHED'
  return raw
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user || user.type !== 'customer') {
      return unauthorizedError()
    }

    const { id } = await params
    if (!id) {
      return apiResponse({ success: false, error: 'Order id is required' }, 400)
    }

    const order = await db.order.findFirst({
      where: {
        id,
        customerId: user.userId,
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
      },
    })

    if (!order) {
      return apiResponse({ success: false, error: 'Order not found' }, 404)
    }

    const currentStatus = normalizeOrderStatus(order.status)
    const paymentStatus = String(order.paymentStatus || '').toLowerCase()
    const cancellable =
      currentStatus === 'PROCESSING'
        ? paymentStatus === 'pending_approval'
        : CANCELLABLE_STATUSES.has(currentStatus)
    if (!cancellable) {
      return apiResponse(
        { success: false, error: 'Only pending or unapproved orders can be cancelled' },
        400
      )
    }

    const cancelledAt = new Date()
    let updated: { id: string; status: string; cancelledAt: Date | null } | null = null

    try {
      updated = await db.order.update({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
          cancelledAt,
        },
        select: {
          id: true,
          status: true,
          cancelledAt: true,
        },
      })
    } catch {
      await db.$executeRaw`
        UPDATE "Order"
        SET "status" = 'CANCELLED', "cancelledAt" = ${cancelledAt}, "updatedAt" = ${cancelledAt}
        WHERE "id" = ${order.id}
      `
      updated = {
        id: order.id,
        status: 'CANCELLED',
        cancelledAt,
      }
    }

    await notifyOrderCancelledByCustomer({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: user.userId,
    })

    await upsertOrderTimeline(order.id, {
      cancelledAt,
    })

    return apiResponse({
      success: true,
      message: 'Order cancelled successfully',
      order: updated,
    })
  } catch (error) {
    console.error('Cancel customer order error:', error)
    return apiResponse({ success: false, error: 'Failed to cancel order' }, 500)
  }
}
