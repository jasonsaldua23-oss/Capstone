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
    const isActive = searchParams.get('active')

    const where: any = {}
    if (isActive !== null) {
      where.isActive = isActive === 'true'
    }

    const drivers = await db.driver.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          }
        },
        vehicles: {
          where: { isActive: true },
          include: {
            vehicle: {
              select: {
                id: true,
                licensePlate: true,
                type: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' }
    })

    return apiResponse({ drivers })
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.warn('Get drivers skipped: database is unavailable')
      return apiResponse({
        success: false,
        dbUnavailable: true,
        error: 'Database is temporarily unavailable',
        drivers: [],
      })
    }

    console.error('Get drivers error:', error)
    return apiResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to fetch drivers', drivers: [] }, 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }

    const body = await request.json()
    const { userId, licenseNumber, licenseType, licenseExpiry, phone, address, city, province, zipCode } = body

    const driver = await db.driver.create({
      data: {
        userId,
        licenseNumber,
        licenseType,
        licenseExpiry: licenseExpiry ? new Date(licenseExpiry) : null,
        phone,
        address,
        city,
        province,
        zipCode,
      },
      include: {
        user: true
      }
    })

    return apiResponse({ success: true, driver })
  } catch (error) {
    console.error('Create driver error:', error)
    return apiResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to create driver' }, 500)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }

    const body = await request.json()
    const { id, vehicleId, isActive, phone, city, province, address, zipCode, licenseType, licenseExpiry } = body

    if (!id) {
      return apiResponse({ success: false, error: 'Driver id is required' }, 400)
    }

    if (vehicleId) {
      await db.$transaction(async (tx) => {
        await tx.driverVehicle.updateMany({
          where: { driverId: id, isActive: true },
          data: { isActive: false },
        })

        await tx.driverVehicle.upsert({
          where: {
            driverId_vehicleId: {
              driverId: id,
              vehicleId,
            },
          },
          update: {
            isActive: true,
            assignedAt: new Date(),
          },
          create: {
            driverId: id,
            vehicleId,
            isActive: true,
          },
        })

        await tx.vehicle.update({
          where: { id: vehicleId },
          data: { status: 'IN_USE' },
        })
      })
    }

    const data: Record<string, unknown> = {}
    if (typeof isActive === 'boolean') data.isActive = isActive
    if (phone !== undefined) data.phone = phone || null
    if (city !== undefined) data.city = city || null
    if (province !== undefined) data.province = province || null
    if (address !== undefined) data.address = address || null
    if (zipCode !== undefined) data.zipCode = zipCode || null
    if (licenseType !== undefined) data.licenseType = licenseType
    if (licenseExpiry !== undefined) data.licenseExpiry = licenseExpiry ? new Date(licenseExpiry) : null

    const driver = Object.keys(data).length
      ? await db.driver.update({
          where: { id },
          data,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
            vehicles: {
              where: { isActive: true },
              include: { vehicle: true },
            },
          },
        })
      : await db.driver.findUnique({
          where: { id },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
            vehicles: {
              where: { isActive: true },
              include: { vehicle: true },
            },
          },
        })

    return apiResponse({ success: true, driver, message: 'Driver updated successfully' })
  } catch (error) {
    console.error('Update driver error:', error)
    return apiResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to update driver' }, 500)
  }
}
