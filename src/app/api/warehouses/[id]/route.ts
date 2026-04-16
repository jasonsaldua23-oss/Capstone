import { NextRequest } from 'next/server'
import { getCurrentUser, apiResponse, apiError, unauthorizedError, forbiddenError, isAdmin, isWarehouseStaff } from '@/lib/auth'
import { db } from '@/lib/db'
import { getAssignedWarehouseId, isWarehouseScopedStaff } from '@/lib/warehouse-scope'

// GET /api/warehouses/[id] - Get warehouse by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const { id } = await params
    if (isWarehouseScopedStaff(currentUser)) {
      const assignedWarehouseId = await getAssignedWarehouseId(currentUser.userId)
      if (!assignedWarehouseId || assignedWarehouseId !== id) {
        return apiError('Warehouse not found', 404)
      }
    }

    const warehouse = await db.warehouse.findUnique({
      where: { id },
      include: {
        inventory: {
          include: {
            product: {
              include: { category: true },
            },
          },
        },
        _count: {
          select: { 
            inventory: true,
          },
        },
      },
    })

    if (!warehouse) {
      return apiError('Warehouse not found', 404)
    }

    return apiResponse({
      success: true,
      data: warehouse,
    })
  } catch (error) {
    console.error('Get warehouse error:', error)
    return apiError('Failed to fetch warehouse', 500)
  }
}

// PUT /api/warehouses/[id] - Update warehouse
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (!isAdmin(currentUser.role) && !isWarehouseStaff(currentUser.role)) return forbiddenError()

    const { id } = await params
    const body = await request.json()
    const { 
      name, code, address, city, province, zipCode, country,
      latitude, longitude, capacity, managerId, isActive 
    } = body

    const updateData: Record<string, unknown> = {}
    
    if (name) updateData.name = name
    if (code) updateData.code = code
    if (address) updateData.address = address
    if (city) updateData.city = city
    if (province) updateData.province = province
    if (zipCode) updateData.zipCode = zipCode
    if (country) updateData.country = country
    if (latitude !== undefined) updateData.latitude = latitude || null
    if (longitude !== undefined) updateData.longitude = longitude || null
    if (capacity) updateData.capacity = capacity
    if (managerId !== undefined) updateData.managerId = managerId || null
    if (typeof isActive === 'boolean') updateData.isActive = isActive

    const warehouse = await db.warehouse.update({
      where: { id },
      data: updateData,
    })

    return apiResponse({
      success: true,
      data: warehouse,
      message: 'Warehouse updated successfully',
    })
  } catch (error) {
    console.error('Update warehouse error:', error)
    return apiError('Failed to update warehouse', 500)
  }
}

// DELETE /api/warehouses/[id] - Delete warehouse (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (!isAdmin(currentUser.role)) return forbiddenError()

    const { id } = await params

    // Soft delete
    await db.warehouse.update({
      where: { id },
      data: { isActive: false },
    })

    return apiResponse({
      success: true,
      message: 'Warehouse deactivated successfully',
    })
  } catch (error) {
    console.error('Delete warehouse error:', error)
    return apiError('Failed to delete warehouse', 500)
  }
}
