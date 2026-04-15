import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { normalizeLegacyOrderStatuses } from '@/lib/order-status'

const ORDER_FLOW = ['PENDING', 'PROCESSING', 'PACKED', 'DISPATCHED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const
type OrderFlowStatus = (typeof ORDER_FLOW)[number]

function normalizeToOrderFlowStatus(status: string): OrderFlowStatus | null {
  const raw = String(status || '').toUpperCase()
  if ((ORDER_FLOW as readonly string[]).includes(raw)) return raw as OrderFlowStatus
  if (['CONFIRMED', 'UNAPPROVED'].includes(raw)) return 'PENDING'
  if (raw === 'READY_FOR_PICKUP') return 'PACKED'
  if (raw === 'IN_TRANSIT') return 'DISPATCHED'
  return null
}

// PATCH /api/orders/[id]/status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await normalizeLegacyOrderStatuses()
    } catch (normalizationError) {
      console.warn('Order status normalization skipped in status patch:', normalizationError)
    }

    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()

    const { id } = await params
    const body = await request.json()
    const requestedStatusRaw = String(body?.status || '')
    const requestedStatus = normalizeToOrderFlowStatus(requestedStatusRaw)

    if (!requestedStatus) {
      return apiError('Invalid order status', 400)
    }
    if (requestedStatus === 'OUT_FOR_DELIVERY' || requestedStatus === 'DELIVERED') {
      return apiError('This status is driver-managed via trip start and POD completion', 403)
    }

    const order = await db.order.findUnique({
      where: { id },
      select: { id: true, status: true, paymentStatus: true },
    })
    if (!order) {
      return apiError('Order not found', 404)
    }

    const currentStatus = normalizeToOrderFlowStatus(order.status)
    if (!currentStatus) {
      return apiError(`Order status ${order.status} cannot be transitioned in delivery pipeline`, 400)
    }
    if (currentStatus === 'CANCELLED') {
      return apiError('Cancelled orders cannot be transitioned', 400)
    }

    const transitionMap: Record<OrderFlowStatus, OrderFlowStatus[]> = {
      PENDING: ['PROCESSING'],
      PROCESSING: ['PACKED'],
      PACKED: ['DISPATCHED'],
      DISPATCHED: ['OUT_FOR_DELIVERY'],
      OUT_FOR_DELIVERY: ['DELIVERED'],
      DELIVERED: [],
      CANCELLED: [],
    }

    const currentPaymentStatus = String(order.paymentStatus || '').toLowerCase()
    const isPendingApproval = currentStatus === 'PROCESSING' && currentPaymentStatus === 'pending_approval'
    const isApprovalRequest = requestedStatus === 'PROCESSING' && currentPaymentStatus === 'pending_approval'

    if (isApprovalRequest) {
      const now = new Date()
      const approved = await db.order.update({
        where: { id },
        data: {
          status: 'PROCESSING' as any,
          paymentStatus: 'pending',
          confirmedAt: now,
          processedAt: now,
        },
      })

      return apiResponse({
        success: true,
        order: approved,
        message: 'Order approved successfully',
      })
    }

    if (isPendingApproval && requestedStatus !== 'PROCESSING') {
      return apiError('Order must be approved before fulfillment', 400)
    }

    if (requestedStatus !== currentStatus && !transitionMap[currentStatus].includes(requestedStatus)) {
      return apiError(`Invalid transition from ${currentStatus} to ${requestedStatus}`, 400)
    }

    const now = new Date()
    const updated = await db.order.update({
      where: { id },
      data: {
        status: requestedStatus as any,
        paymentStatus:
          requestedStatus === 'PROCESSING' && currentPaymentStatus === 'pending_approval'
            ? 'pending'
            : undefined,
        confirmedAt:
          requestedStatus === 'PROCESSING' && currentPaymentStatus === 'pending_approval'
            ? now
            : undefined,
        processedAt: requestedStatus === 'PROCESSING' ? now : undefined,
        shippedAt: ['DISPATCHED', 'OUT_FOR_DELIVERY'].includes(requestedStatus) ? now : undefined,
        deliveredAt: requestedStatus === 'DELIVERED' ? now : undefined,
      },
    })

    return apiResponse({
      success: true,
      order: updated,
      message: 'Order status updated',
    })
  } catch (error) {
    console.error('Update order status error:', error)
    return apiError('Failed to update order status', 500)
  }
}
