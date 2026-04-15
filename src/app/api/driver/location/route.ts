import { db } from '@/lib/db'
import { apiResponse, unauthorizedError, getCurrentUser } from '@/lib/auth'

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    const normalizedRole = String(user?.role || '').toUpperCase()
    if (!user || normalizedRole !== 'DRIVER') {
      return unauthorizedError()
    }

    const body = await request.json()
    const latitude = Number(body?.latitude)
    const longitude = Number(body?.longitude)
    const tripId = body?.tripId ? String(body.tripId) : null

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return apiResponse({ success: false, error: 'Invalid coordinates' }, 400)
    }

    const driver = await db.driver.findFirst({
      where: {
        OR: [
          { userId: user.userId },
          { id: user.userId },
        ],
      },
      select: { id: true },
    })
    if (!driver) {
      return apiResponse({ success: false, error: 'Driver not found' }, 404)
    }

    let resolvedTripId = tripId
    if (!resolvedTripId) {
      const activeTrip = await db.trip.findFirst({
        where: {
          driverId: driver.id,
          status: 'IN_PROGRESS',
        },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
      })
      resolvedTripId = activeTrip?.id ?? null
    }

    const log = await db.locationLog.create({
      data: {
        driverId: driver.id,
        tripId: resolvedTripId,
        latitude,
        longitude,
      },
    })

    return apiResponse({ success: true, locationLogId: log.id })
  } catch (error) {
    console.error('Create driver location log error:', error)
    return apiResponse({ success: false, error: 'Failed to update location' }, 500)
  }
}
