'use client'

export const PORTAL_CACHE_TTL_MS = 5 * 60 * 1000

export const ADMIN_INVENTORY_CACHE_KEY = 'admin_inventory_cache_v1'
export const ADMIN_STOCK_BATCH_CACHE_KEY = 'admin_stock_batch_cache_v1'
export const WAREHOUSE_INVENTORY_STOCK_CACHE_PREFIX = 'warehouse_inventory_stock_cache_v1:'
export const WAREHOUSE_TRIPS_CACHE_PREFIX = 'warehouse_trips_cache_v1:'
export const WAREHOUSE_ROUTE_PLAN_CACHE_PREFIX = 'warehouse_route_plan_cache_v1:'

export type PortalCacheEntry<T> = {
  data: T
  cachedAt: number
  warehouseId?: string
}

export function readPortalCache<T>(key: string): PortalCacheEntry<T> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PortalCacheEntry<T>
    if (!parsed || typeof parsed.cachedAt !== 'number' || parsed.data === undefined) return null
    return parsed
  } catch {
    return null
  }
}

export function writePortalCache<T>(key: string, data: T, warehouseId?: string) {
  if (typeof window === 'undefined') return
  try {
    const entry: PortalCacheEntry<T> = { data, cachedAt: Date.now(), warehouseId }
    window.localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // Cache writes are best-effort; API data remains the source of truth.
  }
}

export function isPortalCacheFresh(entry: PortalCacheEntry<unknown> | null, maxAgeMs = PORTAL_CACHE_TTL_MS) {
  return Boolean(entry && Date.now() - entry.cachedAt < maxAgeMs)
}

export function removePortalCache(key: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore unavailable local storage.
  }
}

export function removePortalCachesByPrefix(prefix: string) {
  if (typeof window === 'undefined') return
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(prefix)) window.localStorage.removeItem(key)
    }
  } catch {
    // Ignore unavailable local storage.
  }
}

// Inventory and stock batches describe the same stock state, so invalidate them as one cache group.
export function invalidateInventoryStockCaches() {
  if (typeof window === 'undefined') return
  removePortalCache(ADMIN_INVENTORY_CACHE_KEY)
  removePortalCache(ADMIN_STOCK_BATCH_CACHE_KEY)
  removePortalCachesByPrefix(WAREHOUSE_INVENTORY_STOCK_CACHE_PREFIX)
}
