import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, apiResponse, unauthorizedError } from '@/lib/auth'
import { normalizeLegacyOrderStatuses } from '@/lib/order-status'
import { notifyOrderCreated } from '@/lib/notifications'
import { upsertOrderTimeline } from '@/lib/order-timeline'

const toNumberOrNull = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

const distanceInKm = (
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
) => {
  const earthRadiusKm = 6371
  const dLat = toRadians(toLat - fromLat)
  const dLng = toRadians(toLng - fromLng)
  const lat1 = toRadians(fromLat)
  const lat2 = toRadians(toLat)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

export async function GET(request: NextRequest) {
  try {
    await normalizeLegacyOrderStatuses()

    const user = await getCurrentUser()
    if (!user || user.type !== 'customer') {
      return unauthorizedError()
    }

    const ordersRaw = await db.order.findMany({
      where: { customerId: user.userId },
      include: {
        logistics: true,
        timeline: true,
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                unit: true,
                imageUrl: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const orders = ordersRaw.map((order) => ({
      ...order,
      shippingName: order.logistics?.shippingName || '',
      shippingPhone: order.logistics?.shippingPhone || '',
      shippingAddress: order.logistics?.shippingAddress || '',
      shippingCity: order.logistics?.shippingCity || '',
      shippingProvince: order.logistics?.shippingProvince || '',
      shippingZipCode: order.logistics?.shippingZipCode || '',
      shippingCountry: order.logistics?.shippingCountry || 'USA',
      shippingLatitude: order.logistics?.shippingLatitude ?? null,
      shippingLongitude: order.logistics?.shippingLongitude ?? null,
      notes: order.logistics?.notes ?? null,
      specialInstructions: order.logistics?.specialInstructions ?? null,
      confirmedAt: order.timeline?.confirmedAt ?? null,
      processedAt: order.timeline?.processedAt ?? null,
      shippedAt: order.timeline?.shippedAt ?? null,
      deliveryDate: order.timeline?.deliveryDate ?? null,
      deliveredAt: order.timeline?.deliveredAt ?? null,
      cancelledAt: order.timeline?.cancelledAt ?? null,
      logistics: undefined,
      timeline: undefined,
    }))

    return apiResponse({ orders })
  } catch (error) {
    console.error('Get customer orders error:', error)
    return apiResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to fetch customer orders', orders: [] }, 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.type !== 'customer') {
      return unauthorizedError()
    }

    const body = await request.json()
    const {
      shippingName,
      shippingPhone,
      shippingAddress,
      shippingCity,
      shippingProvince,
      shippingZipCode,
      shippingCountry,
      shippingLatitude,
      shippingLongitude,
      deliveryDate,
      paymentMethod,
      items,
      notes,
      specialInstructions,
    } = body ?? {}

    if (!shippingName || !shippingPhone || !shippingAddress || !shippingCity || !shippingProvince || !shippingZipCode) {
      return apiResponse({ success: false, error: 'Shipping details are required' }, 400)
    }

    const allowedPaymentMethods = ['COD', 'GCASH', 'MAYA', 'BANK_TRANSFER']
    if (!paymentMethod || !allowedPaymentMethods.includes(paymentMethod)) {
      return apiResponse({ success: false, error: 'Invalid payment method' }, 400)
    }

    if (!Array.isArray(items) || items.length === 0) {
      return apiResponse({ success: false, error: 'Order items are required' }, 400)
    }

    const normalizedShippingLatitude = toNumberOrNull(shippingLatitude)
    const normalizedShippingLongitude = toNumberOrNull(shippingLongitude)

    if (
      (shippingLatitude !== undefined && shippingLatitude !== null && shippingLatitude !== '' && normalizedShippingLatitude === null) ||
      (shippingLongitude !== undefined && shippingLongitude !== null && shippingLongitude !== '' && normalizedShippingLongitude === null)
    ) {
      return apiResponse({ success: false, error: 'Invalid shipping coordinates' }, 400)
    }

    const normalizedItems = items.map((item: any) => ({
      productId: String(item?.productId || ''),
      quantity: Number(item?.quantity || 0),
    }))

    if (normalizedItems.some((item: any) => !item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      return apiResponse({ success: false, error: 'Invalid order items payload' }, 400)
    }

    const itemQuantityByProductId = normalizedItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.productId] = (acc[item.productId] || 0) + item.quantity
      return acc
    }, {})

    const productIds = Object.keys(itemQuantityByProductId)
    const products = await db.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, name: true, price: true },
    })

    if (products.length !== productIds.length) {
      return apiResponse({ success: false, error: 'Some products are unavailable' }, 400)
    }

    const inventoryRows = await db.inventory.findMany({
      where: {
        productId: { in: productIds },
        warehouse: { isActive: true },
      },
      select: {
        warehouseId: true,
        productId: true,
        quantity: true,
        reservedQuantity: true,
        warehouse: {
          select: {
            id: true,
            name: true,
            city: true,
            province: true,
            latitude: true,
            longitude: true,
          },
        },
      },
    })

    const productMap = new Map(products.map((product) => [product.id, product]))

    let subtotal = 0
    const orderItemsData: Array<{ productId: string; quantity: number; unitPrice: number; totalPrice: number }> = []

    for (const [productId, requiredQty] of Object.entries(itemQuantityByProductId)) {
      const product = productMap.get(productId)
      if (!product) {
        return apiResponse({ success: false, error: `Product not found: ${productId}` }, 400)
      }

      const availableQty = inventoryRows
        .filter((inv) => inv.productId === productId)
        .reduce((sum, inv) => sum + Math.max(0, (inv.quantity ?? 0) - (inv.reservedQuantity ?? 0)), 0)

      if (requiredQty > availableQty) {
        return apiResponse({
          success: false,
          error: `Insufficient stock for ${product.name}. Available: ${availableQty}`,
        }, 400)
      }

      const lineTotal = product.price * requiredQty
      subtotal += lineTotal

      orderItemsData.push({
        productId: product.id,
        quantity: requiredQty,
        unitPrice: product.price,
        totalPrice: lineTotal,
      })
    }

    const availabilityByWarehouse = new Map<
      string,
      {
        warehouse: {
          id: string
          name: string
          city: string
          province: string
          latitude: number | null
          longitude: number | null
        }
        byProduct: Map<string, number>
      }
    >()

    for (const row of inventoryRows) {
      if (!availabilityByWarehouse.has(row.warehouseId)) {
        availabilityByWarehouse.set(row.warehouseId, {
          warehouse: row.warehouse,
          byProduct: new Map<string, number>(),
        })
      }
      const entry = availabilityByWarehouse.get(row.warehouseId)!
      entry.byProduct.set(row.productId, Math.max(0, (row.quantity ?? 0) - (row.reservedQuantity ?? 0)))
    }

    const fullyCapableWarehouses = Array.from(availabilityByWarehouse.values()).filter((entry) => {
      return productIds.every((productId) => (entry.byProduct.get(productId) || 0) >= (itemQuantityByProductId[productId] || 0))
    })

    const hasAllCoordinates =
      normalizedShippingLatitude !== null && normalizedShippingLongitude !== null

    let assignedWarehouseId: string | null = null

    if (fullyCapableWarehouses.length === 1) {
      assignedWarehouseId = fullyCapableWarehouses[0].warehouse.id
    } else if (fullyCapableWarehouses.length > 1) {
      const withDistance = hasAllCoordinates
        ? fullyCapableWarehouses
            .filter((entry) => entry.warehouse.latitude !== null && entry.warehouse.longitude !== null)
            .map((entry) => ({
              warehouseId: entry.warehouse.id,
              distance: distanceInKm(
                normalizedShippingLatitude as number,
                normalizedShippingLongitude as number,
                entry.warehouse.latitude as number,
                entry.warehouse.longitude as number
              ),
            }))
            .sort((a, b) => a.distance - b.distance)
        : []

      if (withDistance.length > 0) {
        assignedWarehouseId = withDistance[0].warehouseId
      } else {
        const cityStateMatch = fullyCapableWarehouses.find(
          (entry) =>
            entry.warehouse.city?.toLowerCase() === String(shippingCity || '').toLowerCase() &&
            entry.warehouse.province?.toLowerCase() === String(shippingProvince || '').toLowerCase()
        )
        assignedWarehouseId = cityStateMatch?.warehouse.id || fullyCapableWarehouses[0].warehouse.id
      }
    }

    const splitFulfillmentPossible = productIds.every((productId) => {
      const totalAvailableAcrossWarehouses = Array.from(availabilityByWarehouse.values()).reduce((sum, entry) => {
        return sum + (entry.byProduct.get(productId) || 0)
      }, 0)
      return totalAvailableAcrossWarehouses >= (itemQuantityByProductId[productId] || 0)
    })

    const assignmentFlag = assignedWarehouseId
      ? null
      : splitFulfillmentPossible
        ? 'AUTO_ASSIGNMENT_FLAG: SPLIT_FULFILLMENT_REQUIRED'
        : 'AUTO_ASSIGNMENT_FLAG: MANUAL_REVIEW_REQUIRED'

    const mergedSpecialInstructions = [specialInstructions, assignmentFlag].filter(Boolean).join(' | ') || null
    const mergedNotes = [notes, assignmentFlag].filter(Boolean).join(' | ') || null

    const tax = subtotal * 0.08
    const shippingCost = 0
    const discount = 0
    const totalAmount = subtotal + tax + shippingCost - discount

    const orderCount = await db.order.count()
    const orderNumber = `ORD-${new Date().getFullYear()}-${String(orderCount + 1).padStart(4, '0')}`
    const defaultDeliveryDate = new Date()
    defaultDeliveryDate.setDate(defaultDeliveryDate.getDate() + 1)
    const normalizedDeliveryDate = deliveryDate ? new Date(deliveryDate) : defaultDeliveryDate

    const createdOrder = await db.order.create({
      data: {
        orderNumber,
        customerId: user.userId,
        status: 'PROCESSING',
        paymentStatus: 'pending_approval',
        paymentMethod,
        subtotal,
        tax,
        shippingCost,
        discount,
        totalAmount,
        warehouseId: assignedWarehouseId,
        priority: assignedWarehouseId ? 'normal' : splitFulfillmentPossible ? 'high' : 'urgent',
        logistics: {
          create: {
            shippingName,
            shippingPhone,
            shippingAddress,
            shippingCity,
            shippingProvince,
            shippingZipCode,
            shippingCountry: shippingCountry || 'USA',
            shippingLatitude: normalizedShippingLatitude,
            shippingLongitude: normalizedShippingLongitude,
            notes: mergedNotes,
            specialInstructions: mergedSpecialInstructions,
          },
        },
        items: {
          create: orderItemsData,
        },
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                unit: true,
              },
            },
          },
        },
      },
    })

    await upsertOrderTimeline(createdOrder.id, {
      deliveryDate: normalizedDeliveryDate,
      confirmedAt: null,
      processedAt: null,
      shippedAt: null,
      deliveredAt: null,
      cancelledAt: null,
    })

    await notifyOrderCreated({
      orderId: createdOrder.id,
      orderNumber: createdOrder.orderNumber,
      customerId: createdOrder.customerId,
    })

    return apiResponse({
      success: true,
      message: 'Order placed successfully',
      order: createdOrder,
      assignment: {
        assignedWarehouseId,
        strategy: assignedWarehouseId
          ? fullyCapableWarehouses.length > 1
            ? 'stock_then_nearest'
            : 'stock_only_single_candidate'
          : splitFulfillmentPossible
            ? 'split_fulfillment_required'
            : 'manual_review_required',
      },
    })
  } catch (error) {
    console.error('Create customer order error:', error)
    return apiResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to place order' }, 500)
  }
}
