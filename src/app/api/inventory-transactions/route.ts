import { NextRequest } from 'next/server'
import { getCurrentUser, apiResponse, apiError, unauthorizedError } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/inventory-transactions - List all transactions
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const warehouseId = searchParams.get('warehouseId') || ''
    const productId = searchParams.get('productId') || ''
    const type = searchParams.get('type') || ''

    const where: Record<string, unknown> = {}
    
    if (warehouseId) {
      where.warehouseId = warehouseId
    }
    
    if (productId) {
      where.productId = productId
    }
    
    if (type) {
      where.type = type
    }

    const [transactions, total] = await Promise.all([
      db.inventoryTransaction.findMany({
        where,
        include: {
          product: {
            select: { sku: true, name: true },
          },
          warehouse: {
            select: { name: true, code: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.inventoryTransaction.count({ where }),
    ])

    return apiResponse({
      success: true,
      data: transactions,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    console.error('Get inventory transactions error:', error)
    return apiError('Failed to fetch inventory transactions', 500)
  }
}
