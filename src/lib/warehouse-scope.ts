import type { AuthPayload } from '@/lib/auth'
import { db } from '@/lib/db'

export function isWarehouseScopedStaff(user: AuthPayload): boolean {
  return user.type === 'staff' && user.role === 'WAREHOUSE_STAFF'
}

export async function getAssignedWarehouseId(userId: string): Promise<string | null> {
  const assignedWarehouse = await db.warehouse.findFirst({
    where: {
      managerId: userId,
      isActive: true,
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })

  return assignedWarehouse?.id ?? null
}