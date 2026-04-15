import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { apiResponse, unauthorizedError, getCurrentUser } from '@/lib/auth'

// DELETE /api/vehicles/[id] - Permanently delete vehicle if not used by trips
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) return unauthorizedError()

    const { id } = await params
    if (!id) {
      return apiResponse({ success: false, error: 'Vehicle id is required' }, 400)
    }

    const vehicle = await db.vehicle.findUnique({
      where: { id },
      select: {
        id: true,
        licensePlate: true,
      },
    })

    if (!vehicle) {
      return apiResponse({ success: false, error: 'Vehicle not found' }, 404)
    }

    const tripCount = await db.trip.count({
      where: { vehicleId: id },
    })

    if (tripCount > 0) {
      return apiResponse(
        {
          success: false,
          error: 'Cannot delete vehicle because it is linked to trip records. Set it inactive instead.',
        },
        409
      )
    }

    await db.$transaction(async (tx) => {
      await tx.driverVehicle.deleteMany({
        where: { vehicleId: id },
      })
      await tx.vehicle.delete({
        where: { id },
      })
    })

    return apiResponse({
      success: true,
      message: `Vehicle ${vehicle.licensePlate} deleted successfully`,
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return apiResponse(
        {
          success: false,
          error: 'Cannot delete vehicle because it is still referenced by other records.',
        },
        409
      )
    }
    console.error('Delete vehicle error:', error)
    return apiResponse({ success: false, error: 'Failed to delete vehicle' }, 500)
  }
}
