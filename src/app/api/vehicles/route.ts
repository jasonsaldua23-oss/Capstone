import { NextRequest } from 'next/server'
import { db, isDatabaseUnavailableError } from '@/lib/db'
import { getCurrentUser, apiResponse, unauthorizedError } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const type = searchParams.get('type')

    const where: any = { isActive: true }
    if (status) {
      where.status = status
    }
    if (type) {
      where.type = type
    }

    const vehicles = await db.vehicle.findMany({
      where,
      include: {
        drivers: {
          where: { isActive: true },
          include: {
            driver: {
              select: {
                id: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' }
    })

    return apiResponse({ vehicles })
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.warn('Get vehicles skipped: database is unavailable')
      return apiResponse({
        success: false,
        dbUnavailable: true,
        error: 'Database is temporarily unavailable',
        vehicles: [],
      })
    }

    console.error('Get vehicles error:', error)
    return apiResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to fetch vehicles', vehicles: [] }, 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }

    const body = await request.json()
    const { licensePlate, type, make, model, year, capacity, volume, fuelType, driverId } = body
    const normalizedDriverId = driverId ? String(driverId) : null

    const vehicle = await db.$transaction(async (tx) => {
      const createdVehicle = await tx.vehicle.create({
        data: {
          licensePlate,
          type,
          make,
          model,
          year,
          capacity,
          volume,
          fuelType,
          status: normalizedDriverId ? 'IN_USE' : 'AVAILABLE',
        }
      })

      if (normalizedDriverId) {
        await tx.driverVehicle.updateMany({
          where: { driverId: normalizedDriverId, isActive: true },
          data: { isActive: false },
        })
        await tx.driverVehicle.updateMany({
          where: { vehicleId: createdVehicle.id, isActive: true },
          data: { isActive: false },
        })
        await tx.driverVehicle.upsert({
          where: {
            driverId_vehicleId: {
              driverId: normalizedDriverId,
              vehicleId: createdVehicle.id,
            },
          },
          update: {
            isActive: true,
            assignedAt: new Date(),
          },
          create: {
            driverId: normalizedDriverId,
            vehicleId: createdVehicle.id,
            isActive: true,
          },
        })
      }

      return tx.vehicle.findUnique({
        where: { id: createdVehicle.id },
        include: {
          drivers: {
            where: { isActive: true },
            include: {
              driver: {
                select: {
                  id: true,
                  user: {
                    select: { id: true, name: true, email: true },
                  },
                },
              },
            },
          },
        },
      })
    })

    return apiResponse({ success: true, vehicle })
  } catch (error) {
    console.error('Create vehicle error:', error)
    return apiResponse({ success: false, error: 'Failed to create vehicle' }, 500)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }

    const body = await request.json()
    const { id, licensePlate, type, make, model, year, capacity, volume, fuelType, status, mileage, isActive, driverId } = body

    if (!id) {
      return apiResponse({ success: false, error: 'Vehicle id is required' }, 400)
    }

    const data: Record<string, unknown> = {}
    if (licensePlate) data.licensePlate = String(licensePlate).toUpperCase()
    if (type) data.type = type
    if (make !== undefined) data.make = make || null
    if (model !== undefined) data.model = model || null
    if (year !== undefined) data.year = year === null ? null : Number(year)
    if (capacity !== undefined) data.capacity = capacity === null ? null : Number(capacity)
    if (volume !== undefined) data.volume = volume === null ? null : Number(volume)
    if (fuelType !== undefined) data.fuelType = fuelType || null
    if (status) data.status = status
    if (mileage !== undefined) data.mileage = Number(mileage) || 0
    if (typeof isActive === 'boolean') data.isActive = isActive

    const normalizedDriverId = driverId === undefined ? undefined : (driverId ? String(driverId) : null)
    const vehicle = await db.$transaction(async (tx) => {
      const updatedVehicle = await tx.vehicle.update({
        where: { id },
        data,
      })

      if (normalizedDriverId !== undefined) {
        await tx.driverVehicle.updateMany({
          where: { vehicleId: id, isActive: true },
          data: { isActive: false },
        })

        if (normalizedDriverId) {
          await tx.driverVehicle.updateMany({
            where: { driverId: normalizedDriverId, isActive: true },
            data: { isActive: false },
          })
          await tx.driverVehicle.upsert({
            where: {
              driverId_vehicleId: {
                driverId: normalizedDriverId,
                vehicleId: id,
              },
            },
            update: {
              isActive: true,
              assignedAt: new Date(),
            },
            create: {
              driverId: normalizedDriverId,
              vehicleId: id,
              isActive: true,
            },
          })

          await tx.vehicle.update({
            where: { id },
            data: { status: 'IN_USE' },
          })
        }
      }

      return tx.vehicle.findUnique({
        where: { id: updatedVehicle.id },
        include: {
          drivers: {
            where: { isActive: true },
            include: {
              driver: {
                select: {
                  id: true,
                  user: {
                    select: { id: true, name: true, email: true },
                  },
                },
              },
            },
          },
        },
      })
    })

    return apiResponse({ success: true, vehicle, message: 'Vehicle updated successfully' })
  } catch (error) {
    console.error('Update vehicle error:', error)
    return apiResponse({ success: false, error: 'Failed to update vehicle' }, 500)
  }
}
