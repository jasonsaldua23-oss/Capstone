import type { AuthPayload } from '@/lib/auth'
import { db, isDatabaseUnavailableError } from '@/lib/db'

type WarehouseAssignmentCacheEntry = {
  warehouseId: string | null
  expiresAt: number
}

const globalForWarehouseScope = globalThis as unknown as {
  warehouseAssignmentCache?: Map<string, WarehouseAssignmentCacheEntry>
}

const warehouseAssignmentCache =
  globalForWarehouseScope.warehouseAssignmentCache ?? new Map<string, WarehouseAssignmentCacheEntry>()

if (process.env.NODE_ENV !== 'production') {
  globalForWarehouseScope.warehouseAssignmentCache = warehouseAssignmentCache
}

const ASSIGNMENT_CACHE_TTL_MS = 30_000

export function isWarehouseScopedStaff(user: AuthPayload): boolean {
  return user.type === 'staff' && user.role === 'WAREHOUSE_STAFF'
}

export async function getAssignedWarehouseId(userId: string): Promise<string | null> {
  const now = Date.now()
  const cached = warehouseAssignmentCache.get(userId)
  if (cached && cached.expiresAt > now) {
    return cached.warehouseId
  }

  try {
    const assignedWarehouse = await db.warehouse.findFirst({
      where: {
        managerId: userId,
        isActive: true,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })

    const warehouseId = assignedWarehouse?.id ?? null
    warehouseAssignmentCache.set(userId, {
      warehouseId,
      expiresAt: now + ASSIGNMENT_CACHE_TTL_MS,
    })
    return warehouseId
  } catch (error) {
    if (isDatabaseUnavailableError(error) && cached) {
      return cached.warehouseId
    }
    throw error
  }
}
