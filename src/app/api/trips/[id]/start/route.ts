import { db } from '@/lib/db'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { notifyOrderStatusChanged } from '@/lib/notifications'
import { upsertOrderTimeline } from '@/lib/order-timeline'

// POST /api/trips/[id]/start
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()
    if (String(currentUser.role || '').toUpperCase() !== 'DRIVER') {
      return forbiddenError()
    }

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const requestLatitude = Number((body as any)?.latitude)
    const requestLongitude = Number((body as any)?.longitude)

    const driver = await db.driver.findFirst({
      where: {
        OR: [
          { userId: currentUser.userId },
          { id: currentUser.userId },
        ],
      },
      select: { id: true },
    })
    if (!driver) {
      return apiError('Driver profile not found', 404)
    }

    const trip = await db.trip.findUnique({
      where: { id },
      include: {
        dropPoints: {
          where: { orderId: { not: null } },
          select: { orderId: true },
        },
      },
    })
    if (!trip) {
      return apiError('Trip not found', 404)
    }
    if (trip.driverId !== driver.id) {
      return forbiddenError()
    }

    if (trip.status === 'IN_PROGRESS') {
      return apiResponse({
        success: true,
        trip,
        message: 'Trip already started',
      })
    }

    if (trip.status !== 'PLANNED') {
      return apiResponse(
        {
          success: false,
          error: `Trip cannot be started because status is ${String(trip.status).replace(/_/g, ' ')}`,
          status: trip.status,
        },
        400
      )
    }

    let locationReady = await db.locationLog.findFirst({
      where: {
        driverId: driver.id,
        recordedAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000),
        },
      },
      orderBy: { recordedAt: 'desc' },
      select: { id: true },
    })

    if (!locationReady && Number.isFinite(requestLatitude) && Number.isFinite(requestLongitude)) {
      try {
        const fallbackLog = await db.locationLog.create({
          data: {
            driverId: driver.id,
            tripId: id,
            latitude: requestLatitude,
            longitude: requestLongitude,
          },
          select: { id: true },
        })
        locationReady = fallbackLog
      } catch (locationError) {
        console.warn('Start trip fallback location log failed:', locationError)
      }
    }

    const now = new Date()
    const startedTrip = await db.trip.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        actualStartAt: trip.actualStartAt || now,
      },
    })

    const orderIds = [...new Set(trip.dropPoints.map((dropPoint) => dropPoint.orderId).filter(Boolean) as string[])]
    if (orderIds.length > 0) {
      await db.order.updateMany({
        where: {
          id: { in: orderIds },
          status: { in: ['PROCESSING', 'PACKED', 'DISPATCHED'] as any },
        },
        data: {
          status: 'OUT_FOR_DELIVERY',
        },
      })

      const outForDeliveryOrders = await db.order.findMany({
        where: {
          id: { in: orderIds },
          status: 'OUT_FOR_DELIVERY' as any,
        },
        select: {
          id: true,
          orderNumber: true,
          customerId: true,
          status: true,
        },
      })

      await Promise.all(
        outForDeliveryOrders.map((order) =>
          Promise.all([
            notifyOrderStatusChanged({
              orderId: order.id,
              orderNumber: order.orderNumber,
              customerId: order.customerId,
              status: order.status,
            }),
            upsertOrderTimeline(order.id, {
              shippedAt: now,
            }),
          ])
        )
      )
    }

    return apiResponse({
      success: true,
      trip: startedTrip,
      message: locationReady
        ? 'Trip started successfully'
        : 'Trip started successfully. Enable location to keep live tracking accurate.',
    })
  } catch (error) {
    console.error('Start trip error:', error)
    return apiError('Failed to start trip', 500)
  }
}
