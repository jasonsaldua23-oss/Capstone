import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { getAssignedWarehouseId, isWarehouseScopedStaff } from '@/lib/warehouse-scope'

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toNumberCoord(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function compareDistanceNearestFirst(
  a: { distanceKm: number; orderNumber: string },
  b: { distanceKm: number; orderNumber: string }
) {
  const aFinite = Number.isFinite(a.distanceKm)
  const bFinite = Number.isFinite(b.distanceKm)
  if (aFinite && bFinite) {
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm
    return a.orderNumber.localeCompare(b.orderNumber)
  }
  if (aFinite) return -1
  if (bFinite) return 1
  return a.orderNumber.localeCompare(b.orderNumber)
}

function getDateRange(dateString: string) {
  const [yearStr, monthStr, dayStr] = String(dateString).split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error('Invalid date format, expected YYYY-MM-DD')
  }
  const start = new Date(year, month - 1, day)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

// GET /api/trips/route-plan?date=YYYY-MM-DD&warehouseId=...
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const warehouseId = searchParams.get('warehouseId') || ''
    const isScopedStaff = isWarehouseScopedStaff(currentUser)
    const assignedWarehouseId = isScopedStaff ? await getAssignedWarehouseId(currentUser.userId) : null

    if (isScopedStaff && !assignedWarehouseId) {
      return apiResponse({ success: true, warehouse: null, routePlans: [] })
    }

    if (isScopedStaff && warehouseId && warehouseId !== assignedWarehouseId) {
      return forbiddenError()
    }

    if (!date) {
      return apiError('date is required (YYYY-MM-DD)', 400)
    }

    const resolvedWarehouseId = assignedWarehouseId || warehouseId

    const warehouse = resolvedWarehouseId
      ? await db.warehouse.findUnique({ where: { id: resolvedWarehouseId } })
      : await db.warehouse.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })

    if (!warehouse) {
      return apiError('Warehouse not found', 404)
    }

    const { start, end } = getDateRange(date)
    const candidateOrders = await db.order.findMany({
      where: {
        ...(resolvedWarehouseId ? { warehouseId: warehouse.id } : {}),
        OR: [
          { timeline: { is: { deliveryDate: { gte: start, lt: end } } } },
          {
            AND: [
              { timeline: { is: { deliveryDate: null } } },
              { createdAt: { gte: start, lt: end } },
            ],
          },
        ],
        status: { in: ['PROCESSING', 'PACKED'] as any },
        dropPoints: {
          none: {
            trip: { status: { in: ['PLANNED', 'IN_PROGRESS'] as any } },
          },
        },
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customer: { select: { name: true } },
        logistics: {
          select: {
            shippingName: true,
            shippingAddress: true,
            shippingCity: true,
            shippingProvince: true,
            shippingZipCode: true,
            shippingLatitude: true,
            shippingLongitude: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    const whLat = toNumberCoord(warehouse.latitude)
    const whLng = toNumberCoord(warehouse.longitude)

    const eligibleOrders = candidateOrders.map((order) => {
        const orderLat = toNumberCoord(order.logistics?.shippingLatitude)
        const orderLng = toNumberCoord(order.logistics?.shippingLongitude)
        const hasGeo = orderLat !== null && orderLng !== null
        const distanceKm =
          hasGeo && whLat !== null && whLng !== null
            ? haversineKm(whLat, whLng, orderLat as number, orderLng as number)
            : Number.POSITIVE_INFINITY
        return {
          id: order.id,
          orderNumber: order.orderNumber,
          city: order.logistics?.shippingCity || '',
          customerName: order.customer?.name || order.logistics?.shippingName || '',
          address: order.logistics?.shippingAddress || '',
          latitude: orderLat,
          longitude: orderLng,
          distanceKm,
          status: order.status,
        }
      })

    const groups = new Map<string, typeof eligibleOrders>()
    for (const order of eligibleOrders) {
      const cityKey = order.city || 'Unknown City'
      const existing = groups.get(cityKey) || []
      existing.push(order)
      groups.set(cityKey, existing)
    }

    const routePlans = Array.from(groups.entries()).map(([city, orders]) => {
      const sortedOrders = [...orders].sort(compareDistanceNearestFirst)
      return {
        city,
        orderCount: sortedOrders.length,
        totalDistanceKm: sortedOrders
          .filter((o) => Number.isFinite(o.distanceKm))
          .reduce((sum, o) => sum + o.distanceKm, 0),
        orders: sortedOrders.map((o, idx) => ({
          ...o,
          sequence: idx + 1,
          distanceKm: Number.isFinite(o.distanceKm) ? Number(o.distanceKm.toFixed(2)) : null,
        })),
      }
    })

    routePlans.sort((a, b) => b.orderCount - a.orderCount)

    return apiResponse({
      success: true,
      warehouse: {
        id: warehouse.id,
        name: warehouse.name,
        code: warehouse.code,
        latitude: warehouse.latitude,
        longitude: warehouse.longitude,
      },
      routePlans,
    })
  } catch (error) {
    console.error('Get route plan error:', error)
    return apiError('Failed to generate route plan', 500)
  }
}

// POST /api/trips/route-plan
export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff') return forbiddenError()

    const body = await request.json()
    const { date, city, warehouseId, driverId, vehicleId, orderIds } = body ?? {}
    const isScopedStaff = isWarehouseScopedStaff(currentUser)
    const assignedWarehouseId = isScopedStaff ? await getAssignedWarehouseId(currentUser.userId) : null

    if (isScopedStaff && !assignedWarehouseId) {
      return apiError('No warehouse assigned to this staff account', 403)
    }

    if (!date || !city || !warehouseId || !driverId) {
      return apiError('date, city, warehouseId, and driverId are required', 400)
    }

    if (assignedWarehouseId && String(warehouseId) !== assignedWarehouseId) {
      return apiError('Cannot create route outside assigned warehouse', 403)
    }
    const normalizedOrderIds = Array.isArray(orderIds)
      ? orderIds.map((id: unknown) => String(id || '')).filter(Boolean)
      : []

    const warehouse = await db.warehouse.findUnique({ where: { id: String(warehouseId) } })
    if (!warehouse) return apiError('Warehouse not found', 404)

    const driver = await db.driver.findUnique({ where: { id: String(driverId) } })
    if (!driver) return apiError('Driver not found', 404)

    const resolvedVehicleId =
      (vehicleId ? String(vehicleId) : '') ||
      (
        await db.driverVehicle.findFirst({
          where: { driverId: String(driverId), isActive: true },
          orderBy: { assignedAt: 'desc' },
          select: { vehicleId: true },
        })
      )?.vehicleId ||
      ''

    if (!resolvedVehicleId) {
      return apiError('Selected driver has no assigned active vehicle', 400)
    }

    const vehicle = await db.vehicle.findUnique({ where: { id: resolvedVehicleId } })
    if (!vehicle) return apiError('Vehicle not found', 404)

    const orderWhere: any = {
      status: { in: ['PROCESSING', 'PACKED', 'DISPATCHED'] as any },
    }

    if (normalizedOrderIds.length > 0) {
      orderWhere.id = { in: normalizedOrderIds }
    } else {
      const { start, end } = getDateRange(String(date))
      orderWhere.OR = [
        { timeline: { is: { deliveryDate: { gte: start, lt: end } } } },
        {
          AND: [
            { timeline: { is: { deliveryDate: null } } },
            { createdAt: { gte: start, lt: end } },
          ],
        },
      ]
      orderWhere.logistics = { is: { shippingCity: String(city) } }
    }
    orderWhere.warehouseId = String(warehouseId)

    const orders = await db.order.findMany({
      where: orderWhere,
      include: {
        logistics: true,
        timeline: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    if (orders.length === 0) {
      return apiError('No eligible orders found for this city/date', 400)
    }
    if (normalizedOrderIds.length > 0) {
      const foundOrderIds = new Set(orders.map((o) => o.id))
      const missingOrderIds = normalizedOrderIds.filter((id) => !foundOrderIds.has(id))
      if (missingOrderIds.length > 0) {
        return apiError('Some selected orders are not eligible for this city/date', 400)
      }
    }

    const activeTripStops = await db.tripDropPoint.findMany({
      where: {
        orderId: { in: orders.map((o) => o.id) },
        trip: { status: { in: ['PLANNED', 'IN_PROGRESS'] } },
      },
      select: { orderId: true },
    })
    const assignedOrderIds = new Set(activeTripStops.map((s) => s.orderId).filter(Boolean) as string[])

    const whLat = toNumberCoord(warehouse.latitude)
    const whLng = toNumberCoord(warehouse.longitude)
    const sortedOrders = orders
      .filter((o) => !assignedOrderIds.has(o.id))
      .map((o) => {
        const orderLat = toNumberCoord(o.logistics?.shippingLatitude)
        const orderLng = toNumberCoord(o.logistics?.shippingLongitude)
        const hasGeo = orderLat !== null && orderLng !== null
        const distanceKm =
          hasGeo && whLat !== null && whLng !== null
            ? haversineKm(whLat, whLng, orderLat as number, orderLng as number)
            : Number.POSITIVE_INFINITY
        return { order: o, distanceKm, orderNumber: o.orderNumber }
      })
      .sort(compareDistanceNearestFirst)

    if (sortedOrders.length === 0) {
      return apiError('All orders in this city/date are already assigned to active trips', 400)
    }

    const tripCount = await db.trip.count()
    const tripNumber = `TRP-${new Date().getFullYear()}-${String(tripCount + 1).padStart(4, '0')}`
    const now = new Date()

    const createdTrip = await db.$transaction(async (tx) => {
      const trip = await tx.trip.create({
        data: {
          tripNumber,
          driverId: String(driverId),
          vehicleId: resolvedVehicleId,
          warehouseId: String(warehouseId),
          status: 'PLANNED',
          startLocation: warehouse.name,
          startLatitude: warehouse.latitude,
          startLongitude: warehouse.longitude,
          plannedStartAt: now,
          totalDropPoints: sortedOrders.length,
          completedDropPoints: 0,
          notes: `Auto-routed by city (${city}) for ${date}. Sequence nearest-to-farthest from warehouse.`,
          dropPoints: {
            create: sortedOrders.map((entry, index) => ({
              orderId: entry.order.id,
              sequence: index + 1,
              dropPointType: 'DELIVERY',
              status: 'PENDING',
              locationName: entry.order.logistics?.shippingName || '',
              address: entry.order.logistics?.shippingAddress || '',
              city: entry.order.logistics?.shippingCity || '',
              province: entry.order.logistics?.shippingProvince || '',
              zipCode: entry.order.logistics?.shippingZipCode || '',
              latitude: entry.order.logistics?.shippingLatitude ?? null,
              longitude: entry.order.logistics?.shippingLongitude ?? null,
              contactName: entry.order.logistics?.shippingName || '',
              contactPhone: entry.order.logistics?.shippingPhone || '',
            })),
          },
        },
        include: {
          dropPoints: {
            orderBy: { sequence: 'asc' },
          },
        },
      })

      await tx.order.updateMany({
        where: { id: { in: sortedOrders.map((entry) => entry.order.id) } },
        data: {
          // Trip creation means orders are loaded and assigned, but not yet out for delivery.
          status: 'PACKED',
        },
      })

      return trip
    })

    return apiResponse({
      success: true,
      trip: createdTrip,
      message: `Trip created for ${city} with ${sortedOrders.length} orders`,
    })
  } catch (error) {
    console.error('Create trip from route plan error:', error)
    return apiError('Failed to create trip from route plan', 500)
  }
}
