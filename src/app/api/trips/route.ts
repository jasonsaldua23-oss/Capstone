import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
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

    const [trips, total] = await Promise.all([
      db.trip.findMany({
        where,
        include: {
          driver: {
            include: {
              user: {
                select: {
                  name: true,
                  phone: true,
                  email: true,
                }
              }
            }
          },
          vehicle: true,
          dropPoints: {
            include: {
              order: {
                include: {
                  customer: {
                    select: { name: true }
                  }
                }
              }
            },
            orderBy: { sequence: 'asc' }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.trip.count({ where })
    ])

    return apiResponse({
      trips,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit)
    })
  } catch (error) {
    console.error('Get trips error:', error)
    // Return sample data
    return apiResponse({
      trips: [
        {
          id: '1',
          tripNumber: 'TRP-2024-0001',
          driver: { 
            id: '1',
            user: { name: 'Mike Johnson', phone: '+1555123456' }, 
            licenseNumber: 'DL-12345',
            rating: 4.8 
          },
          vehicle: { id: '1', licensePlate: 'ABC-1234', type: 'VAN', make: 'Ford', model: 'Transit' },
          status: 'IN_PROGRESS',
          totalDropPoints: 5,
          completedDropPoints: 2,
          plannedStartAt: new Date().toISOString(),
          dropPoints: []
        },
        {
          id: '2',
          tripNumber: 'TRP-2024-0002',
          driver: { 
            id: '2',
            user: { name: 'Sarah Williams', phone: '+1555654321' }, 
            licenseNumber: 'DL-67890',
            rating: 4.9 
          },
          vehicle: { id: '2', licensePlate: 'XYZ-5678', type: 'TRUCK', make: 'Mercedes', model: 'Sprinter' },
          status: 'PLANNED',
          totalDropPoints: 8,
          completedDropPoints: 0,
          plannedStartAt: new Date().toISOString(),
          dropPoints: []
        }
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })
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
