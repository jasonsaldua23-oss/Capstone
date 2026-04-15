import type { AuthUser, PortalType } from '@/types'

export type LoginPortal = Extract<PortalType, 'admin' | 'driver' | 'warehouse' | 'customer'>

export function resolvePortalFromUser(user: AuthUser): LoginPortal {
  if (user.type === 'customer') {
    return 'customer'
  }

  if (user.role === 'DRIVER') {
    return 'driver'
  }

  if (['WAREHOUSE', 'WAREHOUSE_STAFF', 'INVENTORY_MANAGER'].includes(user.role)) {
    return 'warehouse'
  }

  return 'admin'
}
