import { NextRequest } from 'next/server'
import { getCurrentUser, apiResponse, apiError, unauthorizedError, forbiddenError } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/products/[id] - Get product by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const { id } = await params
    const product = await db.product.findUnique({
      where: { id },
      include: {
        category: true,
        inventory: {
          include: {
            warehouse: true,
          },
        },
        orderItems: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            order: {
              select: {
                orderNumber: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
      },
    })

    if (!product) {
      return apiError('Product not found', 404)
    }

    return apiResponse({
      success: true,
      data: product,
    })
  } catch (error) {
    console.error('Get product error:', error)
    return apiError('Failed to fetch product', 500)
  }
}

// PUT /api/products/[id] - Update product
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const { id } = await params
    const body = await request.json()
    const { 
      sku, name, imageUrl, description, categoryId, unit,
      weight, dimensions, price, isActive 
    } = body

    const updateData: Record<string, unknown> = {}
    
    if (sku) updateData.sku = sku
    if (name) updateData.name = name
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl || null
    if (description !== undefined) updateData.description = description || null
    if (categoryId !== undefined) updateData.categoryId = categoryId || null
    if (unit) updateData.unit = unit
    if (weight !== undefined) updateData.weight = weight || null
    if (dimensions !== undefined) updateData.dimensions = dimensions || null
    if (price !== undefined) updateData.price = price
    if (typeof isActive === 'boolean') updateData.isActive = isActive

    const product = await db.product.update({
      where: { id },
      data: updateData,
      include: { category: true },
    })

    return apiResponse({
      success: true,
      data: product,
      message: 'Product updated successfully',
    })
  } catch (error) {
    console.error('Update product error:', error)
    return apiError('Failed to update product', 500)
  }
}

// DELETE /api/products/[id] - Delete product (hard delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    const role = String(currentUser.role || '').toUpperCase()
    const allowedRoles = new Set(['SUPER_ADMIN', 'ADMIN', 'WAREHOUSE', 'WAREHOUSE_STAFF', 'INVENTORY_MANAGER'])
    if (!allowedRoles.has(role)) return forbiddenError()

    const { id } = await params

    await db.$transaction(async (tx) => {
      await tx.inventoryTransaction.deleteMany({
        where: { productId: id },
      })
      await tx.inventory.deleteMany({
        where: { productId: id },
      })
      await tx.product.delete({
        where: { id },
      })
    })

    return apiResponse({
      success: true,
      message: 'Product deleted successfully',
    })
  } catch (error) {
    console.error('Delete product error:', error)
    return apiError('Failed to delete product', 500)
  }
}
