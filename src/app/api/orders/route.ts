import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, apiResponse, unauthorizedError } from '@/lib/auth'
import { getAssignedWarehouseId, isWarehouseScopedStaff } from '@/lib/warehouse-scope'
import { normalizeLegacyOrderStatuses } from '@/lib/order-status'

export async function GET(request: NextRequest) {
  try {
    try {
      await normalizeLegacyOrderStatuses()
    } catch (normalizationError) {
      console.warn('Order status normalization skipped:', normalizationError)
    }

    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const includeReturns = searchParams.get('includeReturns') === 'true'

    const where: any = {}
    let staffWarehouseId: string | null = null

    if (isWarehouseScopedStaff(user)) {
      staffWarehouseId = await getAssignedWarehouseId(user.userId)
      if (!staffWarehouseId) {
        return apiResponse({
          orders: [],
          returns: [],
          total: 0,
          page,
          pageSize: limit,
          totalPages: 0,
        })
      }
      where.warehouseId = staffWarehouseId
    }
    
    if (status) {
      where.status = status
    }
    
    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { customer: { name: { contains: search } } },
      ]
    }

    const [orders, total, returns] = await Promise.all([
      db.order.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            }
          },
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  sku: true,
                  name: true,
                  unit: true,
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.order.count({ where }),
      includeReturns
        ? db.return.findMany({
            where: staffWarehouseId
              ? {
                  order: {
                    warehouseId: staffWarehouseId,
                  },
                }
              : undefined,
            include: {
              order: {
                select: {
                  id: true,
                  orderNumber: true,
                  customer: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
          })
        : Promise.resolve([]),
    ])

    return apiResponse({
      orders,
      returns,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit)
    })
  } catch (error) {
    console.error('Get orders error:', error)
    return apiResponse({
      orders: [],
      returns: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }

    const body = await request.json()
    const { 
      customerId,
      shippingName,
      shippingPhone,
      shippingAddress,
      shippingCity,
      shippingState,
      shippingZipCode,
      deliveryDate,
      items,
      notes
    } = body

    // Generate order number
    const orderCount = await db.order.count()
    const orderNumber = `ORD-${new Date().getFullYear()}-${String(orderCount + 1).padStart(4, '0')}`

    // Calculate totals
    let subtotal = 0
    for (const item of items) {
      const product = await db.product.findUnique({ where: { id: item.productId } })
      if (product) {
        subtotal += product.price * item.quantity
      }
    }

    const tax = subtotal * 0.08
    const totalAmount = subtotal + tax
    const defaultDeliveryDate = new Date()
    defaultDeliveryDate.setDate(defaultDeliveryDate.getDate() + 1)
    const normalizedDeliveryDate = deliveryDate ? new Date(deliveryDate) : defaultDeliveryDate

    const order = await db.order.create({
      data: {
        orderNumber,
        customerId,
        shippingName,
        shippingPhone,
        shippingAddress,
        shippingCity,
        shippingState,
        shippingZipCode,
        shippingCountry: 'USA',
        deliveryDate: normalizedDeliveryDate,
        subtotal,
        tax,
        totalAmount,
        notes,
        items: {
          create: items.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.quantity * item.unitPrice,
          }))
        }
      },
      include: {
        items: true
      }
    })

    return apiResponse({ success: true, order })
  } catch (error) {
    console.error('Create order error:', error)
    return apiResponse({ success: false, error: 'Failed to create order' }, 500)
  }
}

// PATCH /api/orders - replacement workflow updates
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return unauthorizedError()
    }
    if (user.type !== 'staff') {
      return apiResponse({ success: false, error: 'Forbidden' }, 403)
    }

    const body = await request.json()
    if (body?.scope !== 'replacement') {
      return apiResponse({ success: false, error: 'Invalid patch scope' }, 400)
    }

    const returnId = String(body?.returnId || '')
    const status = String(body?.status || '')
    const notes = body?.notes ? String(body.notes).trim() : ''
    const createReplacementOrder = Boolean(body?.createReplacementOrder)

    const allowedStatuses = ['REQUESTED', 'APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED', 'PROCESSED', 'REJECTED']
    if (!returnId) {
      return apiResponse({ success: false, error: 'Replacement id is required' }, 400)
    }
    if (!allowedStatuses.includes(status)) {
      return apiResponse({ success: false, error: 'Invalid replacement status' }, 400)
    }

    const replacement = await db.return.findUnique({
      where: { id: returnId },
      include: {
        order: {
          include: {
            items: true,
          },
        },
      },
    })

    if (!replacement) {
      return apiResponse({ success: false, error: 'Replacement record not found' }, 404)
    }

    const transitionMap: Record<string, string[]> = {
      REQUESTED: ['APPROVED', 'REJECTED'],
      APPROVED: ['PICKED_UP', 'REJECTED'],
      PICKED_UP: ['IN_TRANSIT'],
      IN_TRANSIT: ['RECEIVED'],
      RECEIVED: ['PROCESSED'],
      PROCESSED: [],
      REJECTED: [],
    }

    if (status !== replacement.status && !transitionMap[replacement.status]?.includes(status)) {
      return apiResponse({ success: false, error: `Invalid transition from ${replacement.status} to ${status}` }, 400)
    }

    const now = new Date()
    let replacementOrder: any = null
    if (status === 'PROCESSED' && createReplacementOrder) {
      const originalOrder = replacement.order
      if (!originalOrder) {
        return apiResponse({ success: false, error: 'Original order is missing' }, 400)
      }

      const orderCount = await db.order.count()
      const orderNumber = `ORD-${new Date().getFullYear()}-${String(orderCount + 1).padStart(4, '0')}`
      const defaultDeliveryDate = new Date()
      defaultDeliveryDate.setDate(defaultDeliveryDate.getDate() + 2)

      replacementOrder = await db.order.create({
        data: {
          orderNumber,
          customerId: originalOrder.customerId,
          shippingName: originalOrder.shippingName,
          shippingPhone: originalOrder.shippingPhone,
          shippingAddress: originalOrder.shippingAddress,
          shippingCity: originalOrder.shippingCity,
          shippingState: originalOrder.shippingState,
          shippingZipCode: originalOrder.shippingZipCode,
          shippingCountry: originalOrder.shippingCountry,
          shippingLatitude: originalOrder.shippingLatitude,
          shippingLongitude: originalOrder.shippingLongitude,
          status: 'PROCESSING',
          priority: originalOrder.priority,
          subtotal: originalOrder.subtotal,
          tax: originalOrder.tax,
          shippingCost: originalOrder.shippingCost,
          discount: originalOrder.discount,
          totalAmount: originalOrder.totalAmount,
          paymentStatus: 'pending',
          paymentMethod: originalOrder.paymentMethod,
          warehouseId: originalOrder.warehouseId,
          deliveryDate: originalOrder.deliveryDate || defaultDeliveryDate,
          notes: `Replacement order for ${replacement.returnNumber}${originalOrder.notes ? ` | ${originalOrder.notes}` : ''}`,
          processedAt: now,
          items: {
            create: originalOrder.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
              notes: `Replacement item from ${replacement.returnNumber}`,
            })),
          },
        },
      })
    }

    const updated = await db.return.update({
      where: { id: returnId },
      data: {
        status: status as any,
        pickupCompleted: status === 'PICKED_UP' ? now : undefined,
        processedAt: status === 'PROCESSED' ? now : undefined,
        processedBy: status === 'PROCESSED' ? user.userId : undefined,
        notes:
          notes || status !== replacement.status
            ? `${replacement.notes ? `${replacement.notes}\n` : ''}${replacement.status} -> ${status}${notes ? `: ${notes}` : ''}`
            : undefined,
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            customer: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    })

    return apiResponse({
      success: true,
      replacement: updated,
      replacementOrder,
      message:
        status === 'PROCESSED'
          ? replacementOrder
            ? 'Replacement completed and replacement order created'
            : 'Replacement completed'
          : 'Replacement status updated',
    })
  } catch (error) {
    console.error('Update replacement workflow error:', error)
    return apiResponse({ success: false, error: 'Failed to update replacement workflow' }, 500)
  }
}
