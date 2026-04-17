import { NextRequest } from 'next/server'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { db, isDatabaseUnavailableError } from '@/lib/db'
import { getAssignedWarehouseId, isWarehouseScopedStaff } from '@/lib/warehouse-scope'

function makeSkuPrefix(name: string) {
  const cleaned = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'SKU'
  const prefix = parts.map((part) => part.slice(0, 3)).join('').slice(0, 8)
  return prefix || 'SKU'
}

async function generateSku(productName: string) {
  const prefix = makeSkuPrefix(productName)
  const similar = await db.product.count({
    where: { sku: { startsWith: `${prefix}-` } },
  })
  return `${prefix}-${String(similar + 1).padStart(3, '0')}`
}

async function generateBatchNumber(sku: string, receiptDate: Date) {
  const batchPrefix = sku.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 4) || 'BCH'
  const year = receiptDate.getFullYear()
  const yearStart = new Date(year, 0, 1)
  const yearEnd = new Date(year + 1, 0, 1)
  const yearCount = await db.stockBatch.count({
    where: {
      createdAt: {
        gte: yearStart,
        lt: yearEnd,
      },
    },
  })
  return `${batchPrefix}-${year}-${String(yearCount + 1).padStart(3, '0')}`
}

// GET /api/stock-batches - list stock-in batches
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '50')
    const isScopedStaff = isWarehouseScopedStaff(currentUser)

    let assignedWarehouseId: string | null = null
    if (isScopedStaff) {
      assignedWarehouseId = await getAssignedWarehouseId(currentUser.userId)
      if (!assignedWarehouseId) {
        return apiResponse({
          success: true,
          stockBatches: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        })
      }
    }

    const stockBatches = await db.stockBatch.findMany({
      where: assignedWarehouseId
        ? {
            inventory: {
              warehouseId: assignedWarehouseId,
            },
          }
        : undefined,
      include: {
        inventory: {
          include: {
            product: true,
            warehouse: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    const total = await db.stockBatch.count({
      where: assignedWarehouseId
        ? {
            inventory: {
              warehouseId: assignedWarehouseId,
            },
          }
        : undefined,
    })

    return apiResponse({
      success: true,
      stockBatches,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      console.warn('Get stock batches skipped: database is unavailable')
      return apiResponse({
        success: false,
        dbUnavailable: true,
        error: 'Database is temporarily unavailable',
        stockBatches: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      })
    }

    console.error('Get stock batches error:', error)
    return apiError('Failed to fetch stock batches', 500)
  }
}

// POST /api/stock-batches - add stock by batch
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()

    const body = await request.json()
    const {
      warehouseId,
      quantity,
      receiptDate,
      expiryDate,
      threshold,
      isNewProduct,
      productId,
      productName,
      description,
      unit,
      price,
      imageUrl,
    } = body ?? {}

    const qty = Number(quantity)
    if (!warehouseId) return apiError('Warehouse is required', 400)
    if (!Number.isFinite(qty) || qty <= 0) return apiError('Quantity must be greater than 0', 400)

    const isScopedStaff = isWarehouseScopedStaff(currentUser)
    if (isScopedStaff) {
      const assignedWarehouseId = await getAssignedWarehouseId(currentUser.userId)
      if (!assignedWarehouseId) return apiError('No warehouse assigned to this staff account', 403)
      if (String(warehouseId) !== assignedWarehouseId) {
        return apiError('Cannot add stock outside assigned warehouse', 403)
      }
    }

    let resolvedProductId = String(productId || '')
    let resolvedSku = ''

    if (isNewProduct) {
      if (!productName) return apiError('Product name is required for new product', 400)
      const newSku = await generateSku(String(productName))
      const createdProduct = await db.product.create({
        data: {
          sku: newSku,
          name: String(productName),
          description: description ? String(description) : null,
          unit: String(unit || 'piece'),
          price: Number(price || 0),
          imageUrl: imageUrl || null,
          isActive: true,
        },
      })
      resolvedProductId = createdProduct.id
      resolvedSku = createdProduct.sku
    } else {
      if (!resolvedProductId) return apiError('Existing product is required', 400)
      const existingProduct = await db.product.findUnique({
        where: { id: resolvedProductId },
        select: { sku: true },
      })
      if (!existingProduct) return apiError('Product not found', 404)
      resolvedSku = existingProduct.sku
    }

    const existingInventory = await db.inventory.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: String(warehouseId),
          productId: resolvedProductId,
        },
      },
    })

    const minStockValue = threshold !== undefined ? Math.max(0, Number(threshold) || 0) : undefined

    const inventory = existingInventory
      ? await db.inventory.update({
          where: { id: existingInventory.id },
          data: {
            quantity: existingInventory.quantity + qty,
            minStock: minStockValue ?? existingInventory.minStock,
            lastRestockedAt: new Date(),
          },
          include: {
            product: true,
            warehouse: true,
          },
        })
      : await db.inventory.create({
          data: {
            warehouseId: String(warehouseId),
            productId: resolvedProductId,
            quantity: qty,
            minStock: minStockValue ?? 10,
            maxStock: 100,
            reorderPoint: 20,
            lastRestockedAt: new Date(),
          },
          include: {
            product: true,
            warehouse: true,
          },
        })

    await db.inventoryTransaction.create({
      data: {
        warehouseId: inventory.warehouseId,
        productId: inventory.productId,
        type: 'IN',
        quantity: qty,
        performedBy: currentUser.userId,
        referenceType: 'stock_batch',
        notes: 'Stock-in batch received',
      },
    })

    const parsedReceiptDate = receiptDate ? new Date(receiptDate) : new Date()
    const parsedExpiryDate = expiryDate ? new Date(expiryDate) : null
    const batchNumber = await generateBatchNumber(resolvedSku, parsedReceiptDate)

    const resolvedLocationLabel =
      inventory.warehouse?.code || inventory.warehouse?.name || null

    const stockBatch = await db.stockBatch.create({
      data: {
        batchNumber,
        inventoryId: inventory.id,
        quantity: qty,
        receiptDate: parsedReceiptDate,
        expiryDate: parsedExpiryDate,
        locationLabel: resolvedLocationLabel,
        status: 'ACTIVE',
        createdBy: currentUser.userId,
      },
      include: {
        inventory: {
          include: {
            product: true,
            warehouse: true,
          },
        },
      },
    })

    return apiResponse({
      success: true,
      stockBatch,
      message: 'Stock added successfully',
    })
  } catch (error) {
    console.error('Create stock batch error:', error)
    return apiError('Failed to add stock', 500)
  }
}
