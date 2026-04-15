import type { PortalType } from '@/types'

export type AppVariant = 'all' | 'admin' | 'driver' | 'customer'

const VARIANT_PORTAL_MAP: Record<AppVariant, PortalType[]> = {
  all: ['admin', 'warehouse', 'driver', 'customer'],
  admin: ['admin', 'warehouse'],
  driver: ['driver'],
  customer: ['customer'],
}

const VARIANT_DEFAULT_PORTAL: Record<AppVariant, PortalType> = {
  all: 'admin',
  admin: 'admin',
  driver: 'driver',
  customer: 'customer',
}

export function resolveAppVariant(): AppVariant {
  const raw = String(process.env.NEXT_PUBLIC_APP_VARIANT || '').trim().toLowerCase()
  if (raw === 'admin' || raw === 'driver' || raw === 'customer' || raw === 'all') {
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
  return `/login/${getDefaultPortalForVariant(variant)}`
}
