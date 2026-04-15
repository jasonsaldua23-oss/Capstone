import { db } from '@/lib/db'
import { apiError, apiResponse, forbiddenError, getCurrentUser, unauthorizedError } from '@/lib/auth'
import { randomUUID } from 'crypto'

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
}

export async function GET(request: Request) {
  try {
    await ensureSpareStockTables()

    const user = await getCurrentUser()
    if (!user) return unauthorizedError()
    if (user.type !== 'staff') return forbiddenError()

    const role = String(user.role || '').toUpperCase()
    const { searchParams } = new URL(request.url)
    const driverIdParam = String(searchParams.get('driverId') || '').trim()

    let driverId = driverIdParam
    if (role === 'DRIVER') {
      const driver = await db.driver.findFirst({
        where: { OR: [{ userId: user.userId }, { id: user.userId }] },
        select: { id: true },
      })
      if (!driver) return apiError('Driver profile not found', 404)
      driverId = driver.id
    } else if (!driverId) {
      return apiError('driverId is required', 400)
    }

    const rows = await db.$queryRaw<Array<{
      id: string
      driverId: string
      productId: string
      quantity: number
      minQuantity: number
      updatedAt: string
      productName: string | null
      productSku: string | null
    }>>`
      SELECT
        s."id",
        s."driverId",
        s."productId",
        s."quantity",
        s."minQuantity",
        s."updatedAt",
        p."name" as "productName",
        p."sku" as "productSku"
      FROM "DriverSpareStock" s
      LEFT JOIN "Product" p ON p."id" = s."productId"
      WHERE s."driverId" = ${driverId}
      ORDER BY p."name" ASC
    `

    return apiResponse({ success: true, spareStock: rows })
  } catch (error) {
    console.error('Get spare stock error:', error)
    return apiError('Failed to load spare stock', 500)
  }
}

export async function POST(request: Request) {
  try {
    await ensureSpareStockTables()

    const user = await getCurrentUser()
    if (!user) return unauthorizedError()
    if (user.type !== 'staff') return forbiddenError()
    const role = String(user.role || '').toUpperCase()
    if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
      return forbiddenError()
    }

    const body = await request.json().catch(() => ({}))
    const driverId = String(body?.driverId || '').trim()
    const productId = String(body?.productId || '').trim()
    const quantity = Number(body?.quantity)
    const minQuantity = Number(body?.minQuantity ?? 0)

    if (!driverId || !productId || !Number.isFinite(quantity)) {
      return apiError('driverId, productId, and quantity are required', 400)
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      return apiError('quantity must be a non-negative whole number', 400)
    }
    if (!Number.isInteger(minQuantity) || minQuantity < 0) {
      return apiError('minQuantity must be a non-negative whole number', 400)
    }

    const [driver, product] = await Promise.all([
      db.driver.findUnique({ where: { id: driverId }, select: { id: true } }),
      db.product.findUnique({ where: { id: productId }, select: { id: true } }),
    ])
    if (!driver) return apiError('Driver not found', 404)
    if (!product) return apiError('Product not found', 404)

    const existing = await db.$queryRaw<Array<{ id: string; quantity: number }>>`
      SELECT "id", "quantity"
      FROM "DriverSpareStock"
      WHERE "driverId" = ${driverId} AND "productId" = ${productId}
      LIMIT 1
    `
    const now = new Date()
    if (existing.length > 0) {
      await db.$executeRaw`
        UPDATE "DriverSpareStock"
        SET "quantity" = ${quantity}, "minQuantity" = ${minQuantity}, "updatedAt" = ${now}
        WHERE "id" = ${existing[0].id}
      `
    } else {
      await db.$executeRaw`
        INSERT INTO "DriverSpareStock" ("id","driverId","productId","quantity","minQuantity","createdAt","updatedAt")
        VALUES (${randomUUID()},${driverId},${productId},${quantity},${minQuantity},${now},${now})
      `
    }

    return apiResponse({ success: true, message: 'Spare stock updated' })
  } catch (error) {
    console.error('Update spare stock error:', error)
    return apiError('Failed to update spare stock', 500)
  }
}

