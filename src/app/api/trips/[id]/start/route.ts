import { db } from '@/lib/db'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'

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

    const locationReady = await db.locationLog.findFirst({
      where: {
        driverId: driver.id,
        recordedAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000),
        },
      },
      orderBy: { recordedAt: 'desc' },
      select: { id: true },
    })

    if (!locationReady) {
      return apiError('Location must be enabled before starting trip. Turn on location and try again.', 400)
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
          shippedAt: now,
        },
      })
    }

    return apiResponse({
      success: true,
      trip: startedTrip,
      message: 'Trip started successfully',
    })
  } catch (error) {
    console.error('Start trip error:', error)
    return apiError('Failed to start trip', 500)
  }
}
