import { NextRequest } from 'next/server'
import { getCurrentUser, apiResponse, apiError, unauthorizedError, forbiddenError, isWarehouseStaff } from '@/lib/auth'
import { db, isDatabaseUnavailableError } from '@/lib/db'
import { getAssignedWarehouseId, isWarehouseScopedStaff } from '@/lib/warehouse-scope'

// GET /api/inventory - List all inventory
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const warehouseId = searchParams.get('warehouseId') || ''
    const productId = searchParams.get('productId') || ''
    const lowStock = searchParams.get('lowStock') === 'true'

    const where: Record<string, unknown> = {
      product: {
        isActive: true,
      },
    }
    const isScopedStaff = isWarehouseScopedStaff(currentUser)

    if (isScopedStaff) {
      const assignedWarehouseId = await getAssignedWarehouseId(currentUser.userId)
      if (!assignedWarehouseId) {
        return apiResponse({
          success: true,
          data: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        })
      }

      where.warehouseId = assignedWarehouseId
    } else if (warehouseId) {
      where.warehouseId = warehouseId
    }
    
    if (productId) {
      where.productId = productId
    }

    const [inventory, total] = await Promise.all([
      db.inventory.findMany({
        where,
        include: {
          product: {
            include: { category: true },
          },
          warehouse: true,
        },
        orderBy: { product: { name: 'asc' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.inventory.count({ where }),
    ])

    // Filter for low stock if requested
    let filteredInventory = inventory
    if (lowStock) {
      filteredInventory = inventory.filter(item => item.quantity <= item.minStock)
    }

    return apiResponse({
      success: true,
      data: filteredInventory,
      total: lowStock ? filteredInventory.length : total,
      page,
      pageSize,
      totalPages: Math.ceil((lowStock ? filteredInventory.length : total) / pageSize),
    })
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.warn('Get inventory skipped: database is unavailable')
      return apiResponse({
        success: false,
        dbUnavailable: true,
        error: 'Database is temporarily unavailable',
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      })
    }

    console.error('Get inventory error:', error)
    return apiError(error instanceof Error ? error.message : 'Failed to fetch inventory', 500)
  }
}

// POST /api/inventory - Add stock
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()

    const body = await request.json()
    const { 
      warehouseId, productId,
      quantity, minStock, maxStock, reorderPoint,
      transactionType, notes 
    } = body

    if (!warehouseId || !productId) {
      return apiError('Warehouse and product are required')
    }

    const isScopedStaff = isWarehouseScopedStaff(currentUser)
    if (isScopedStaff) {
      const assignedWarehouseId = await getAssignedWarehouseId(currentUser.userId)
      if (!assignedWarehouseId) {
        return apiError('No warehouse assigned to this staff account', 403)
      }
      if (warehouseId !== assignedWarehouseId) {
        return apiError('Cannot modify inventory outside assigned warehouse', 403)
      }
    }

    // Check if inventory exists
    let inventory = await db.inventory.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId,
          productId,
        },
      },
    })

    if (inventory) {
      // Update existing inventory
      const updateData: Record<string, unknown> = {}
      
      if (transactionType === 'IN') {
        updateData.quantity = inventory.quantity + (quantity || 0)
        updateData.lastRestockedAt = new Date()
      } else if (transactionType === 'OUT') {
        if (inventory.quantity < (quantity || 0)) {
          return apiError('Insufficient stock')
        }
        updateData.quantity = inventory.quantity - (quantity || 0)
      } else if (transactionType === 'ADJUSTMENT') {
        updateData.quantity = quantity
      }
      
      if (minStock !== undefined) updateData.minStock = minStock
      if (maxStock !== undefined) updateData.maxStock = maxStock
      if (reorderPoint !== undefined) updateData.reorderPoint = reorderPoint

      inventory = await db.inventory.update({
        where: { id: inventory.id },
        data: updateData,
        include: {
          product: true,
          warehouse: true,
        },
      })
    } else {
      // Create new inventory
      if (quantity === undefined) {
        return apiError('Quantity is required for new inventory')
      }

      inventory = await db.inventory.create({
        data: {
          warehouseId,
          productId,
          quantity: quantity || 0,
          minStock: minStock || 10,
          maxStock: maxStock || 100,
          reorderPoint: reorderPoint || 20,
        },
        include: {
          product: true,
          warehouse: true,
        },
      })
    }

    // Create inventory transaction
    if (transactionType && quantity) {
      await db.inventoryTransaction.create({
        data: {
          warehouseId,
          productId,
          type: transactionType,
          quantity: transactionType === 'OUT' ? -quantity : quantity,
          notes: notes || null,
          performedBy: currentUser.userId,
        },
      })
    }

    return apiResponse({
      success: true,
      data: inventory,
      message: 'Inventory updated successfully',
    })
  } catch (error) {
    console.error('Update inventory error:', error)
    return apiError(error instanceof Error ? error.message : 'Failed to update inventory', 500)
  }
}
