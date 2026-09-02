import type { PortalType } from '@/types'
import { loginPathForPortal } from '@/lib/portal-scope'

export type AppVariant = 'all' | 'admin' | 'warehouse' | 'driver' | 'customer'

const VARIANT_PORTAL_MAP: Record<AppVariant, PortalType[]> = {
  all: ['admin', 'warehouse', 'driver', 'customer'],
  admin: ['admin'],
  warehouse: ['warehouse'],
  driver: ['driver'],
  customer: ['customer'],
}

const VARIANT_DEFAULT_PORTAL: Record<AppVariant, PortalType> = {
  all: 'admin',
  admin: 'admin',
  warehouse: 'warehouse',
  driver: 'driver',
  customer: 'customer',
}

export function resolveAppVariant(): AppVariant {
  const raw = String(process.env.NEXT_PUBLIC_APP_VARIANT || '').trim().toLowerCase()
  if (raw === 'admin' || raw === 'warehouse' || raw === 'driver' || raw === 'customer' || raw === 'all') {
    return raw
  }
  return 'all'
}

export function getAllowedPortals(variant: AppVariant): PortalType[] {
  return VARIANT_PORTAL_MAP[variant]
}

export function getDefaultPortalForVariant(variant: AppVariant): PortalType {
  return VARIANT_DEFAULT_PORTAL[variant]
}

export function getDefaultLoginPathForVariant(variant: AppVariant): string {
  return loginPathForPortal(getDefaultPortalForVariant(variant))
}
