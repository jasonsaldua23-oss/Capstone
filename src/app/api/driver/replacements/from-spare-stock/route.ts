import { db } from '@/lib/db'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { randomUUID } from 'crypto'

const nextReplacementNumber = async () => {
  const year = new Date().getFullYear()
  const count = await db.return.count()
  return `RPL-${year}-${String(count + 1).padStart(4, '0')}`
}

const ensureSpareStockTables = async () => {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DriverSpareStock" (
      "id" TEXT PRIMARY KEY,
      "driverId" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "quantity" INTEGER NOT NULL DEFAULT 0,
      "minQuantity" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE("driverId","productId")
    )
  `)

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SpareStockTransaction" (
      "id" TEXT PRIMARY KEY,
      "driverId" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "quantity" INTEGER NOT NULL,
      "referenceType" TEXT,
      "referenceId" TEXT,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

export async function POST(request: Request) {
  try {
    await ensureSpareStockTables()

    const currentUser = await getCurrentUser()
    if (!currentUser) return unauthorizedError()
    if (currentUser.type !== 'staff' || String(currentUser.role || '').toUpperCase() !== 'DRIVER') {
      return forbiddenError()
    }

    const body = await request.json().catch(() => ({}))
    const tripId = String(body?.tripId || '').trim()
    const dropPointId = String(body?.dropPointId || '').trim()
    const orderItemId = String(body?.orderItemId || '').trim()
    const reason = String(body?.reason || '').trim()
    const damagePhoto = String(body?.damagePhoto || '').trim()
    const quantity = Number(body?.quantity || 0)

    if (!tripId || !dropPointId || !orderItemId) {
      return apiError('Trip, drop point, and order item are required', 400)
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      return apiError('Replacement quantity must be a positive whole number', 400)
    }
    if (!reason) {
      return apiError('Replacement reason is required', 400)
    }
    if (!damagePhoto) {
      return apiError('Damage photo is required', 400)
    }

    const driver = await db.driver.findFirst({
      where: {
        OR: [{ userId: currentUser.userId }, { id: currentUser.userId }],
      },
      select: { id: true },
    })
    if (!driver) return apiError('Driver profile not found', 404)

    const dropPoint = await db.tripDropPoint.findFirst({
      where: { id: dropPointId, tripId },
      include: {
        trip: { select: { id: true, driverId: true, status: true } },
        order: { select: { id: true, customerId: true, orderNumber: true } },
      },
    })

    if (!dropPoint) return apiError('Trip drop point not found', 404)
    if (dropPoint.trip.driverId !== driver.id) return forbiddenError()
    if (String(dropPoint.status || '').toUpperCase() !== 'ARRIVED') {
      return apiError('Replacement from spare stock is only allowed when stop is ARRIVED', 400)
    }
    if (!dropPoint.orderId || !dropPoint.order) {
      return apiError('Drop point is not linked to an order', 400)
    }

    const orderItem = await db.orderItem.findFirst({
      where: { id: orderItemId, orderId: dropPoint.orderId },
      include: {
        product: { select: { id: true, name: true, sku: true } },
      },
    })
    if (!orderItem) return apiError('Order item not found for this stop', 404)
    if (quantity > Number(orderItem.quantity || 0)) {
      return apiError('Replacement quantity exceeds ordered quantity', 400)
    }

    const replacementNumber = await nextReplacementNumber()
    const now = new Date()

    const result = await db.$transaction(async (tx) => {
      const spareRows = await tx.$queryRaw<Array<{ id: string; quantity: number }>>`
        SELECT "id", "quantity"
        FROM "DriverSpareStock"
        WHERE "driverId" = ${driver.id} AND "productId" = ${orderItem.productId}
        LIMIT 1
      `
      const spareStock = spareRows[0]
      if (!spareStock || Number(spareStock.quantity) < quantity) {
        throw new Error('INSUFFICIENT_SPARE_STOCK')
      }

      const nextQty = Number(spareStock.quantity) - quantity
      await tx.$executeRaw`
        UPDATE "DriverSpareStock"
        SET "quantity" = ${nextQty}, "updatedAt" = ${now}
        WHERE "id" = ${spareStock.id}
      `

      await tx.$executeRaw`
        INSERT INTO "SpareStockTransaction"
          ("id","driverId","productId","type","quantity","referenceType","referenceId","notes","createdAt")
        VALUES
          (${randomUUID()},${driver.id},${orderItem.productId},${'OUT'},${quantity},${'INSTANT_REPLACEMENT'},${dropPoint.id},${`Instant replacement at stop #${dropPoint.sequence}: ${reason}`},${now})
      `

      const replacement = await tx.return.create({
        data: {
          returnNumber: replacementNumber,
          orderId: dropPoint.orderId,
          customerId: dropPoint.order.customerId,
          reason: `Driver spare stock replacement: ${orderItem.product?.name || 'Item'}`,
          description: reason,
          status: 'PROCESSED',
          pickupAddress: dropPoint.address,
          pickupCity: dropPoint.city,
          pickupProvince: dropPoint.province,
          pickupZipCode: dropPoint.zipCode,
          pickupLatitude: dropPoint.latitude,
          pickupLongitude: dropPoint.longitude,
          pickupCompleted: now,
          processedAt: now,
          processedBy: currentUser.userId,
          notes: `Immediate same-stop replacement completed by driver using spare stock. Meta: ${JSON.stringify({
            requestedBy: 'DRIVER',
            replacementMode: 'SPARE_STOCK_IMMEDIATE',
            originalOrderItemId: orderItem.id,
            replacementProductId: orderItem.productId,
            replacementQuantity: quantity,
            damagePhotoUrl: damagePhoto,
            tripId,
            dropPointId: dropPoint.id,
          })}`,
        },
      })

      await tx.tripDropPoint.update({
        where: { id: dropPoint.id },
        data: {
          notes: `${dropPoint.notes ? `${dropPoint.notes}\n` : ''}[${now.toISOString()}] Spare stock replacement completed (${quantity} x ${orderItem.product?.name || orderItem.productId}). Reason: ${reason}`,
        },
      })

      return {
        replacement,
        remainingSpareStock: nextQty,
      }
    })

    return apiResponse({
      success: true,
      message: 'On-delivery damage replacement completed using spare stock',
      replacement: result.replacement,
      remainingSpareStock: result.remainingSpareStock,
    })
  } catch (error: any) {
    if (String(error?.message || '') === 'INSUFFICIENT_SPARE_STOCK') {
      return apiError('Insufficient spare stock for this product', 400)
    }
    console.error('Driver spare stock replacement error:', error)
    return apiError('Failed to process replacement from spare stock', 500)
  }
}
