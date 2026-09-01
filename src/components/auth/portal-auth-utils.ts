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

/**
 * Link to a portal's forgot-password page, carrying over whatever address is
 * already typed in the login form so the reset does not start from an empty field.
 */
export function forgotPasswordHref(portal: LoginPortal, email?: string): string {
  const trimmed = String(email || '').trim()
  const query = trimmed ? `?email=${encodeURIComponent(trimmed)}` : ''
  return `/login/${portal}/forgot-password${query}`
}
