import { NextRequest } from 'next/server'
import { db, isDatabaseUnavailableError } from '@/lib/db'
import { getCurrentUser, apiResponse, unauthorizedError } from '@/lib/auth'
import { getAssignedWarehouseId, isWarehouseScopedStaff } from '@/lib/warehouse-scope'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const status = searchParams.get('status')

    const where: any = {}
    if (isWarehouseScopedStaff(user)) {
      const assignedWarehouseId = await getAssignedWarehouseId(user.userId)
      if (!assignedWarehouseId) {
        return apiResponse({
          trips: [],
          total: 0,
          page,
          pageSize: limit,
          totalPages: 0,
        })
      }
      where.warehouseId = assignedWarehouseId
    }

    if (status) {
      where.status = status
    }

    const trips = await db.trip.findMany({
      where,
      include: {
        driver: {
          include: {
            user: {
              select: {
                name: true,
                phone: true,
                email: true,
              },
            },
          },
        },
        vehicle: true,
        dropPoints: {
          include: {
            order: {
              include: {
                customer: {
                  select: { name: true },
                },
              },
            },
          },
          orderBy: { sequence: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    })
    const total = await db.trip.count({ where })

    return apiResponse({
      trips,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit)
    })
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.warn('Get trips skipped: database is unavailable')
      return apiResponse({
        success: false,
        dbUnavailable: true,
        error: 'Database is temporarily unavailable',
        trips: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      })
    }

    console.error('Get trips error:', error)
    return apiResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch trips',
      trips: [],
      total: 0,
      page,
      pageSize: limit,
      totalPages: 0,
    }, 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }

    const body = await request.json()
    const { driverId, vehicleId, warehouseId, plannedStartAt, notes, orderIds } = body

    if (isWarehouseScopedStaff(user)) {
      const assignedWarehouseId = await getAssignedWarehouseId(user.userId)
      if (!assignedWarehouseId) {
        return apiResponse({ success: false, error: 'No warehouse assigned to this staff account' }, 403)
      }
      if (!warehouseId || String(warehouseId) !== assignedWarehouseId) {
        return apiResponse({ success: false, error: 'Cannot create trips outside assigned warehouse' }, 403)
      }
    }

    // Generate trip number
    const tripCount = await db.trip.count()
    const tripNumber = `TRP-${new Date().getFullYear()}-${String(tripCount + 1).padStart(4, '0')}`

    // Create trip with drop points
    const trip = await db.trip.create({
      data: {
        tripNumber,
        driverId,
        vehicleId,
        warehouseId,
        plannedStartAt: plannedStartAt ? new Date(plannedStartAt) : null,
        notes,
        totalStops: orderIds?.length || 0,
        stops: orderIds ? {
          create: orderIds.map((orderId: string, index: number) => ({
            orderId,
            sequence: index + 1,
            locationName: 'Delivery Location',
            address: 'Address',
            city: 'City',
            province: 'Province',
            zipCode: '00000',
          }))
        } : undefined
      },
      include: {
        stops: true
      }
    })

    return apiResponse({ success: true, trip })
  } catch (error) {
    console.error('Create trip error:', error)
    return apiResponse({ success: false, error: 'Failed to create trip' }, 500)
  }
}
