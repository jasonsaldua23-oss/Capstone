import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { notifyOrderStatusChanged } from '@/lib/notifications'
import { upsertOrderTimeline } from '@/lib/order-timeline'

// PATCH /api/trips/[id]/drop-points/[dropPointId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dropPointId: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()
    if (String(currentUser.role || '').toUpperCase() !== 'DRIVER') return forbiddenError()

    const { id, dropPointId } = await params
    const body = await request.json()
    const nextStatus = String(body?.status || '')
    const notes = body?.notes ? String(body.notes) : null
    const recipientName = body?.recipientName ? String(body.recipientName).trim() : 'Customer'
    const recipientSignature = body?.recipientSignature ? String(body.recipientSignature).trim() : null
    const deliveryPhoto = body?.deliveryPhoto ? String(body.deliveryPhoto).trim() : null

    const allowedDropPointStatuses = ['PENDING', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'FAILED', 'SKIPPED']
    if (!allowedDropPointStatuses.includes(nextStatus)) {
      return apiError('Invalid drop point status', 400)
    }

    const driver = await db.driver.findFirst({
      where: {
        OR: [
          { userId: currentUser.userId },
          { id: currentUser.userId },
        ],
      },
      select: { id: true },
    })
    if (!driver) return apiError('Driver profile not found', 404)

    const dropPoint = await db.tripDropPoint.findFirst({
      where: { id: dropPointId, tripId: id },
      select: { id: true, orderId: true, trip: { select: { driverId: true } } },
    })
    if (!dropPoint) {
      return apiError('Trip drop point not found', 404)
    }
    if (dropPoint.trip.driverId !== driver.id) return forbiddenError()
    if (nextStatus === 'COMPLETED' && !deliveryPhoto) {
      return apiError('POD photo is required before marking as delivered', 400)
    }

    const now = new Date()
    const updatedDropPoint = await db.tripDropPoint.update({
      where: { id: dropPoint.id },
      data: {
        status: nextStatus as any,
        notes,
        actualArrival: nextStatus === 'ARRIVED' ? now : undefined,
        actualDeparture: ['COMPLETED', 'FAILED', 'SKIPPED'].includes(nextStatus) ? now : undefined,
        recipientName: nextStatus === 'COMPLETED' ? (recipientName || 'Customer') : undefined,
        recipientSignature: nextStatus === 'COMPLETED' ? recipientSignature : undefined,
        deliveryPhoto: nextStatus === 'COMPLETED' ? deliveryPhoto : undefined,
      },
    })

    if (dropPoint.orderId) {
      if (nextStatus === 'COMPLETED') {
        const updatedOrder = await db.order.update({
          where: { id: dropPoint.orderId },
          data: { status: 'DELIVERED' },
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            status: true,
          },
        })

        await notifyOrderStatusChanged({
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          customerId: updatedOrder.customerId,
          status: updatedOrder.status,
        })

        await upsertOrderTimeline(updatedOrder.id, {
          deliveredAt: now,
        })
      }
    }

    const tripDropPoints = await db.tripDropPoint.findMany({
      where: { tripId: id },
      select: { status: true },
    })
    const completedDropPoints = tripDropPoints.filter((dropPointStatus) => dropPointStatus.status === 'COMPLETED').length
    const allDone = tripDropPoints.every((dropPointStatus) => ['COMPLETED', 'FAILED', 'SKIPPED'].includes(dropPointStatus.status))

    await db.trip.update({
      where: { id },
      data: {
        completedDropPoints,
        status: allDone ? 'COMPLETED' : 'IN_PROGRESS',
        actualEndAt: allDone ? now : undefined,
      },
    })

    return apiResponse({
      success: true,
      dropPoint: updatedDropPoint,
      message: 'Trip drop point updated',
    })
  } catch (error) {
    console.error('Update trip drop point error:', error)
    return apiError('Failed to update trip drop point', 500)
  }
}
