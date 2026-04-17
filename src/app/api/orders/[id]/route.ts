import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiError, apiResponse, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { getAssignedWarehouseId, isWarehouseScopedStaff } from '@/lib/warehouse-scope'
import { flattenOrderTimeline } from '@/lib/order-timeline'

function flattenOrderLogistics(order: any) {
  const logistics = order?.logistics
  if (!logistics) return order

  const flattened = {
    ...order,
    shippingName: logistics.shippingName,
    shippingPhone: logistics.shippingPhone,
    shippingAddress: logistics.shippingAddress,
    shippingCity: logistics.shippingCity,
    shippingProvince: logistics.shippingProvince,
    shippingZipCode: logistics.shippingZipCode,
    shippingCountry: logistics.shippingCountry,
    shippingLatitude: logistics.shippingLatitude,
    shippingLongitude: logistics.shippingLongitude,
    billingName: logistics.billingName,
    billingAddress: logistics.billingAddress,
    billingCity: logistics.billingCity,
    billingProvince: logistics.billingProvince,
    billingZipCode: logistics.billingZipCode,
    billingCountry: logistics.billingCountry,
    notes: logistics.notes,
    specialInstructions: logistics.specialInstructions,
  }

  delete flattened.logistics
  return flattened
}

function flattenOrderForResponse(order: any) {
  return flattenOrderTimeline(flattenOrderLogistics(order))
}

// GET /api/orders/[id] - full order details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) return unauthorizedError()

    const { id } = await params
    if (!id) return apiError('Order id is required', 400)

    const where: Record<string, unknown> = { id }

    if (user.type === 'customer') {
      where.customerId = user.userId
    } else if (isWarehouseScopedStaff(user)) {
      const assignedWarehouseId = await getAssignedWarehouseId(user.userId)
      if (!assignedWarehouseId) {
        return apiError('No warehouse assigned to this staff account', 403)
      }
      where.warehouseId = assignedWarehouseId
    }

    const order = await db.order.findFirst({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        logistics: {
          select: {
            shippingName: true,
            shippingPhone: true,
            shippingAddress: true,
            shippingCity: true,
            shippingProvince: true,
            shippingZipCode: true,
            shippingCountry: true,
            shippingLatitude: true,
            shippingLongitude: true,
            billingName: true,
            billingAddress: true,
            billingCity: true,
            billingProvince: true,
            billingZipCode: true,
            billingCountry: true,
            notes: true,
            specialInstructions: true,
          },
        },
        timeline: {
          select: {
            confirmedAt: true,
            processedAt: true,
            shippedAt: true,
            deliveryDate: true,
            deliveredAt: true,
            cancelledAt: true,
          },
        },
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
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!order) {
      return apiError('Order not found', 404)
    }

    return apiResponse({ success: true, order: flattenOrderForResponse(order) })
  } catch (error) {
    console.error('Get order detail error:', error)
    return apiError('Failed to fetch order details', 500)
  }
}
