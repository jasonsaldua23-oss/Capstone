import { db } from '@/lib/db'
import { apiResponse, unauthorizedError, getCurrentUser } from '@/lib/auth'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.type !== 'customer') {
      return unauthorizedError()
    }

    const orders = await db.order.findMany({
      where: {
        customerId: user.userId,
        status: {
          in: ['DISPATCHED', 'OUT_FOR_DELIVERY', 'DELIVERED'],
        },
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const tracking = await Promise.all(
      orders.map(async (order) => {
        const tripDropPoint = await db.tripDropPoint.findFirst({
          where: {
            orderId: order.id,
          },
          orderBy: { updatedAt: 'desc' },
          include: {
            trip: {
              include: {
                driver: {
                  include: {
                    user: {
                      select: {
                        name: true,
                        phone: true,
                      },
                    },
                  },
                },
                locationLogs: {
                  orderBy: { recordedAt: 'asc' },
                  take: 500,
                },
              },
            },
          },
        })

        const locationLogs = tripDropPoint?.trip?.locationLogs || []
        const latestLog = locationLogs.length > 0 ? locationLogs[locationLogs.length - 1] : null
        const latitude = latestLog?.latitude ?? null
        const longitude = latestLog?.longitude ?? null
        const source = latestLog
          ? 'driver_gps'
          : 'unavailable'
        const routePoints = locationLogs.map((log) => ({
          latitude: log.latitude,
          longitude: log.longitude,
          recordedAt: log.recordedAt,
        }))

        return {
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          tripNumber: tripDropPoint?.trip?.tripNumber ?? null,
          driverName: tripDropPoint?.trip?.driver?.user?.name ?? null,
          driverPhone: tripDropPoint?.trip?.driver?.user?.phone ?? null,
          latitude,
          longitude,
          source,
          updatedAt: latestLog?.recordedAt ?? tripDropPoint?.updatedAt ?? null,
          recipientName: tripDropPoint?.recipientName ?? null,
          deliveryPhoto: tripDropPoint?.deliveryPhoto ?? null,
          deliveredMessage:
            order.status === 'DELIVERED'
              ? 'Your order has been delivered.'
              : 'Your order is currently in transit.',
          routePoints,
        }
      })
    )

    return apiResponse({ tracking })
  } catch (error) {
    console.error('Get customer tracking error:', error)
    return apiResponse({ tracking: [] })
  }
}
