import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'

// PUT /api/inventory/[id] - Update inventory quantity/settings
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()

    const { id } = await params
    const body = await request.json()

    const existing = await db.inventory.findUnique({
      where: { id },
      select: {
        id: true,
        warehouseId: true,
        productId: true,
        quantity: true,
        minStock: true,
        maxStock: true,
        reorderPoint: true,
      },
    })
    if (!existing) {
      return apiError('Inventory item not found', 404)
    }

    const updateData: Record<string, unknown> = {}
    if (body.quantity !== undefined) {
      const qty = Number(body.quantity)
      if (!Number.isFinite(qty) || qty < 0) {
        return apiError('Quantity must be a non-negative number', 400)
      }
      updateData.quantity = qty
    }
    if (body.minStock !== undefined) updateData.minStock = Number(body.minStock)
    if (body.maxStock !== undefined) updateData.maxStock = Number(body.maxStock)
    if (body.reorderPoint !== undefined) updateData.reorderPoint = Number(body.reorderPoint)
    if (Object.keys(updateData).length === 0) {
      return apiError('No updatable fields provided', 400)
    }

    if (
      (typeof updateData.minStock === 'number' && !Number.isFinite(updateData.minStock)) ||
      (typeof updateData.maxStock === 'number' && !Number.isFinite(updateData.maxStock)) ||
      (typeof updateData.reorderPoint === 'number' && !Number.isFinite(updateData.reorderPoint))
    ) {
      return apiError('Stock thresholds must be valid numbers', 400)
    }

    const updated = await db.inventory.update({
      where: { id },
      data: updateData,
      include: {
        product: true,
        warehouse: true,
      },
    })

    if (typeof updateData.quantity === 'number' && updateData.quantity !== existing.quantity) {
      const delta = updateData.quantity - existing.quantity
      await db.inventoryTransaction.create({
        data: {
          warehouseId: existing.warehouseId,
          productId: existing.productId,
          type: 'ADJUSTMENT',
          quantity: delta,
          performedBy: currentUser.userId,
          notes: `Quantity adjusted from ${existing.quantity} to ${updateData.quantity}`,
          referenceType: 'inventory',
          referenceId: existing.id,
        },
      })
    }

    return apiResponse({
      success: true,
      data: updated,
      message: 'Inventory updated successfully',
    })
  } catch (error) {
    console.error('Update inventory by id error:', error)
    return apiError('Failed to update inventory', 500)
  }
}
