import type { AuthUser, PortalType } from '@/types'

export type LoginPortal = Extract<PortalType, 'admin' | 'driver' | 'warehouse' | 'customer'>

export function resolvePortalFromUser(user: AuthUser): LoginPortal {
  const userType = String(user?.type || '').trim().toLowerCase()
  const normalizedRole = String((user as any)?.role || '').trim().toUpperCase()

  if (userType === 'customer') {
    return 'customer'
  }

  if (normalizedRole === 'DRIVER') {
    return 'driver'
  }

  if (['WAREHOUSE', 'WAREHOUSE_STAFF', 'INVENTORY_MANAGER'].includes(normalizedRole)) {
    return 'warehouse'
  }

  return 'admin'
}
