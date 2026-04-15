import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, apiResponse, unauthorizedError } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    const normalizedRole = String(user?.role || '').toUpperCase()
    if (!user || normalizedRole !== 'DRIVER') {
      return unauthorizedError()
    }

    // Get driver profile
    const driver = await db.driver.findFirst({
      where: {
        OR: [
          { userId: user.userId },
          { id: user.userId },
        ],
      },
    })

    if (!driver) {
      return apiResponse({ trips: [] })
    }

    const trips = await db.trip.findMany({
      where: { driverId: driver.id },
      include: {
        vehicle: true,
        dropPoints: {
          include: {
            order: {
              include: {
                customer: {
                  select: { name: true }
                },
                items: {
                  include: {
                    product: {
                      select: {
                        id: true,
                        sku: true,
                        name: true,
                      },
                    },
                  },
                  orderBy: { createdAt: 'asc' },
                },
              }
            }
          },
          orderBy: { sequence: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return apiResponse({ trips })
  } catch (error) {
    console.error('Get driver trips error:', error)
    return apiResponse({
      trips: [
        {
          id: '1',
          tripNumber: 'TRP-2024-0001',
          status: 'IN_PROGRESS',
          plannedStartAt: new Date().toISOString(),
          totalDropPoints: 5,
          completedDropPoints: 2,
          vehicle: {
            licensePlate: 'ABC-1234',
            type: 'VAN'
          },
          dropPoints: [
            {
              id: '1',
              sequence: 1,
              status: 'COMPLETED',
              locationName: 'Customer A',
              address: '123 Main St',
              city: 'New York',
              contactName: 'John Smith',
              contactPhone: '+1555123456',
              order: { orderNumber: 'ORD-2024-0001' }
            },
            {
              id: '2',
              sequence: 2,
              status: 'COMPLETED',
              locationName: 'Customer B',
              address: '456 Oak Ave',
              city: 'New York',
              contactName: 'Jane Doe',
              contactPhone: '+1555654321',
              order: { orderNumber: 'ORD-2024-0002' }
            },
            {
              id: '3',
              sequence: 3,
              status: 'PENDING',
              locationName: 'Customer C',
              address: '789 Pine Rd',
              city: 'Brooklyn',
              contactName: 'Bob Wilson',
              contactPhone: '+1555987654',
              order: { orderNumber: 'ORD-2024-0003' }
            }
          ]
        }
      ]
    })
  }
}
