import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiError, apiResponse, getCurrentUser, unauthorizedError } from '@/lib/auth'

export async function GET(_request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.type !== 'staff' || String(user.role || '').toUpperCase() !== 'DRIVER') {
      return unauthorizedError()
    }

    const driver = await db.driver.findUnique({
      where: { userId: user.userId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            avatar: true,
          },
        },
      },
    })

    if (!driver) {
      return apiError('Driver profile not found', 404)
    }

    return apiResponse({
      profile: {
        id: driver.id,
        user: driver.user,
        phone: driver.phone || '',
        address: driver.address || '',
        city: driver.city || '',
        province: driver.province || '',
        zipCode: driver.zipCode || '',
        licenseNumber: driver.licenseNumber || '',
        licenseType: driver.licenseType || '',
        licenseExpiry: driver.licenseExpiry,
      },
    })
  } catch (error) {
    console.error('Get driver profile error:', error)
    return apiError('Failed to load driver profile', 500)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.type !== 'staff' || String(user.role || '').toUpperCase() !== 'DRIVER') {
      return unauthorizedError()
    }

    const body = await request.json()
    const name = String(body?.name || '').trim()
    const phone = String(body?.phone || '').trim()
    const address = String(body?.address || '').trim()
    const city = String(body?.city || '').trim()
    const province = String(body?.province || '').trim()
    const zipCode = String(body?.zipCode || '').trim()

    if (!name) {
      return apiError('Name is required', 400)
    }

    const driver = await db.driver.findUnique({
      where: { userId: user.userId },
      select: { id: true },
    })
    if (!driver) {
      return apiError('Driver profile not found', 404)
    }

    const updated = await db.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: user.userId },
        data: {
          name,
          phone: phone || null,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatar: true,
        },
      })

      const updatedDriver = await tx.driver.update({
        where: { id: driver.id },
        data: {
          phone: phone || null,
          address: address || null,
          city: city || null,
          province: province || null,
          zipCode: zipCode || null,
        },
        select: {
          id: true,
          phone: true,
          address: true,
          city: true,
          province: true,
          zipCode: true,
          licenseNumber: true,
          licenseType: true,
          licenseExpiry: true,
        },
      })

      return {
        id: updatedDriver.id,
        user: updatedUser,
        phone: updatedDriver.phone || '',
        address: updatedDriver.address || '',
        city: updatedDriver.city || '',
        province: updatedDriver.province || '',
        zipCode: updatedDriver.zipCode || '',
        licenseNumber: updatedDriver.licenseNumber || '',
        licenseType: updatedDriver.licenseType || '',
        licenseExpiry: updatedDriver.licenseExpiry,
      }
    })

    return apiResponse({ success: true, profile: updated })
  } catch (error) {
    console.error('Update driver profile error:', error)
    return apiError('Failed to update profile', 500)
  }
}

