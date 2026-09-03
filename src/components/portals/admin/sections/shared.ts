'use client'

import { getTabAuthToken } from '@/lib/client-auth'

export function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function getCollection<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>

  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[]
  }

  if (Array.isArray(record.data)) return record.data as T[]
  return []
}

export function getDefaultRouteDate() {
  const now = new Date()
  now.setDate(now.getDate() + 1)
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function normalizeTripStatus(status: unknown) {
  const value = String(status || '').toUpperCase()
  if (value === 'IN_TRANSIT' || value === 'OUT_FOR_DELIVERY') return 'IN_PROGRESS'
  return value
}

export function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

export function formatDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function toIsoDateTime(value: unknown) {
  if (!value) return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function formatDateTime(value: unknown) {
  const iso = toIsoDateTime(value)
  if (!iso) return 'N/A'
  return new Date(iso).toLocaleString()
}

export function formatDayLabel(value: unknown) {
  const iso = toIsoDateTime(value)
  if (!iso) return 'Unknown'
  const date = new Date(iso)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function withinRange(value: unknown, startAt: Date) {
  const iso = toIsoDateTime(value)
  if (!iso) return false
  return new Date(iso).getTime() >= startAt.getTime()
}

export function getWarehouseIdFromRow(row: any) {
  const value = row?.warehouseId ?? row?.warehouse_id ?? row?.warehouse?.id ?? row?.warehouse
  return typeof value === 'object' && value !== null ? String(value.id || '') : String(value || '')
}

export function normalizeFulfillmentStatus(status: unknown) {
  const value = String(status || '').trim().toUpperCase()
  if (!value) return 'PENDING'
  if (value === 'IN_TRANSIT' || value === 'OUT_FOR_DELIVERY' || value === 'DISPATCHED') return 'IN_TRANSIT'
  if (value === 'DELIVERED' || value === 'COMPLETED' || value === 'FULFILLED' || value === 'ARRIVED') return 'DELIVERED'
  if (value === 'FAILED' || value === 'FAILED_DELIVERY') return 'FAILED'
  return value
}

export function extractFulfillmentLegs(order: any) {
  const getWarehouseKey = (entry: { warehouseId?: string | null; warehouseName?: string | null }) => {
    const id = String(entry?.warehouseId || '').trim()
    if (id) return `id:${id}`
    const name = String(entry?.warehouseName || '').trim().toLowerCase()
    return name ? `name:${name}` : ''
  }

  const directLegs = Array.isArray(order?.fulfillments)
    ? order.fulfillments
    : Array.isArray(order?.shipments)
      ? order.shipments
      : Array.isArray(order?.fulfillmentLegs)
        ? order.fulfillmentLegs
        : []

  const normalizedDirectLegs = directLegs.map((leg: any, index: number) => {
      const warehouseId = String(
        leg?.warehouseId ?? leg?.warehouse_id ?? leg?.warehouse?.id ?? getWarehouseIdFromRow(order) ?? ''
      ).trim()
      const warehouseName = String(
        leg?.warehouseName ?? leg?.warehouse?.name ?? leg?.warehouseCode ?? order?.warehouseName ?? order?.warehouseCode ?? ''
      ).trim()
      const legItems = Array.isArray(leg?.items) ? leg.items : []
      const allocatedQty = Number(
        leg?.allocatedQty ??
        leg?.allocatedQuantity ??
        legItems.reduce((sum: number, item: any) => sum + Number(item?.allocatedQty ?? item?.quantity ?? 0), 0)
      ) || 0
      return {
        id: String(leg?.id || `${order?.id || 'order'}-leg-${index}`),
        orderId: String(order?.id || ''),
        warehouseId,
        warehouseName: warehouseName || (warehouseId ? `Warehouse ${warehouseId}` : 'Unassigned'),
        status: normalizeFulfillmentStatus(leg?.status ?? order?.status),
        tripId: leg?.tripId ? String(leg.tripId) : null,
        tripNumber: String(leg?.trip?.tripNumber || leg?.tripNumber || '').trim() || null,
        eta: leg?.eta || leg?.estimatedArrival || null,
        allocatedQty,
        items: legItems,
      }
    })

  const topLevelAllocations = [
    ...toArray<any>(order?.warehouseAllocations),
    ...toArray<any>(order?.allocations),
  ]
  const itemLevelAllocations = toArray<any>(order?.items).flatMap((item: any) => [
    ...toArray<any>(item?.warehouseAllocations),
    ...toArray<any>(item?.allocations),
  ])
  // Avoid double counting the same allocations when payload includes both top-level and item-level mirrors.
  const allocationLegs = topLevelAllocations.length > 0 ? topLevelAllocations : itemLevelAllocations
  const normalizedAllocationLegsRaw = allocationLegs.map((allocation: any, index: number) => {
      const warehouseId = String(
        allocation?.warehouseId ?? allocation?.warehouse_id ?? allocation?.warehouse?.id ?? ''
      ).trim()
      const warehouseName = String(
        allocation?.warehouseName ?? allocation?.warehouse?.name ?? allocation?.warehouseCode ?? allocation?.warehouse?.code ?? ''
      ).trim()
      const allocatedQty = Number(
        allocation?.allocatedQty ?? allocation?.allocatedQuantity ?? allocation?.quantity ?? 0
      ) || 0
      return {
        id: String(allocation?.id || `${order?.id || 'order'}-alloc-leg-${index}`),
        orderId: String(order?.id || ''),
        warehouseId,
        warehouseName: warehouseName || (warehouseId ? `Warehouse ${warehouseId}` : 'Unassigned'),
        status: normalizeFulfillmentStatus(order?.status),
        tripId: null,
        tripNumber: null,
        eta: null,
        allocatedQty,
        items: [],
      }
    })
  const allocationByWarehouse = new Map<string, any>()
  normalizedAllocationLegsRaw.forEach((leg: any, index: number) => {
    const key = getWarehouseKey(leg) || `unknown:${index}`
    const existing = allocationByWarehouse.get(key)
    if (!existing) {
      allocationByWarehouse.set(key, { ...leg })
      return
    }
    allocationByWarehouse.set(key, {
      ...existing,
      allocatedQty: Number(existing.allocatedQty || 0) + Number(leg.allocatedQty || 0),
      warehouseId: existing.warehouseId || leg.warehouseId,
      warehouseName: existing.warehouseName !== 'Unassigned' ? existing.warehouseName : leg.warehouseName,
    })
  })
  const normalizedAllocationLegs = Array.from(allocationByWarehouse.values())

  if (normalizedDirectLegs.length > 0) {
    const allocationQtyByWarehouseKey = new Map<string, number>()
    normalizedAllocationLegs.forEach((leg: any) => {
      const key = getWarehouseKey(leg)
      if (!key) return
      allocationQtyByWarehouseKey.set(key, Number(leg?.allocatedQty || 0))
    })
    const hydratedDirectLegs = normalizedDirectLegs.map((leg: any) => {
      const key = getWarehouseKey(leg)
      const fallbackQty = key ? Number(allocationQtyByWarehouseKey.get(key) || 0) : 0
      const currentQty = Number(leg?.allocatedQty || 0)
      if (currentQty > 0 || fallbackQty <= 0) return leg
      return { ...leg, allocatedQty: fallbackQty }
    })

    const directWarehouseKeys = new Set(
      hydratedDirectLegs.map((leg: any) => getWarehouseKey(leg)).filter(Boolean)
    )
    const extras = normalizedAllocationLegs
      .filter((leg: any) => {
        const key = getWarehouseKey(leg)
        return key && !directWarehouseKeys.has(key)
      })
      .map((leg: any) => ({
        ...leg,
        status: 'PENDING',
      }))
    return [...hydratedDirectLegs, ...extras]
  }

  if (normalizedAllocationLegs.length > 0) {
    return normalizedAllocationLegs
  }

  const fallbackWarehouseId = String(getWarehouseIdFromRow(order) || '').trim()
  const fallbackItems = Array.isArray(order?.items) ? order.items : []
  return [{
    id: String(order?.id || '') ? `${String(order?.id)}-leg-0` : 'order-leg-0',
    orderId: String(order?.id || ''),
    warehouseId: fallbackWarehouseId,
    warehouseName: String(order?.warehouseName || order?.warehouseCode || '').trim() || (fallbackWarehouseId ? `Warehouse ${fallbackWarehouseId}` : 'Unassigned'),
    status: normalizeFulfillmentStatus(order?.status),
    tripId: order?.tripId ? String(order.tripId) : null,
    tripNumber: String(order?.tripNumber || order?.progress?.trip?.tripNumber || '').trim() || null,
    eta: order?.eta || order?.estimatedArrival || null,
    allocatedQty: fallbackItems.reduce((sum: number, item: any) => sum + Number(item?.quantity || 0), 0),
    items: fallbackItems,
  }]
}

export function deriveOrderFulfillmentSummary(order: any) {
  let legs = extractFulfillmentLegs(order)
  const getWarehouseLegKey = (leg: any) =>
    String(leg?.warehouseId || '').trim() || String(leg?.warehouseName || '').trim().toLowerCase()
  const legsByWarehouse = new Map<string, any[]>()
  legs.forEach((leg: any) => {
    const key = getWarehouseLegKey(leg)
    if (!key) return
    const current = legsByWarehouse.get(key) || []
    current.push(leg)
    legsByWarehouse.set(key, current)
  })
  if (legsByWarehouse.size > 0) {
    const prioritizedLegs: any[] = []
    const consumedKeys = new Set<string>()
    legs.forEach((leg: any) => {
      const key = getWarehouseLegKey(leg)
      if (!key || consumedKeys.has(key)) return
      consumedKeys.add(key)
      const group = legsByWarehouse.get(key) || []
      const nonTerminalGroup = group.filter(
        (entry: any) => !['FAILED', 'CANCELLED'].includes(String(entry?.status || '').trim().toUpperCase())
      )
      prioritizedLegs.push(...(nonTerminalGroup.length > 0 ? nonTerminalGroup : group))
    })
    legs = prioritizedLegs
  }
  const deliveredCount = legs.filter((leg: any) => leg.status === 'DELIVERED').length
  const failedCount = legs.filter((leg: any) => leg.status === 'FAILED' || leg.status === 'CANCELLED').length
  const unassignedTripCount = legs.filter((leg: any) => !leg.tripId && !leg.tripNumber).length
  const total = legs.length
  const needsSplit = total > 1
  const fulfillmentStatus = total === 0
    ? 'PENDING'
    : deliveredCount === total
      ? 'FULFILLED'
      : deliveredCount > 0
        ? 'PARTIALLY_FULFILLED'
        : failedCount === total
          ? 'FAILED'
          : 'IN_PROGRESS'
  return {
    legs,
    totalLegs: total,
    deliveredLegs: deliveredCount,
    unassignedTripCount,
    needsSplit,
    fulfillmentStatus,
  }
}

export function formatRoleLabel(role: string | null | undefined) {
  const value = String(role || '').trim().toUpperCase()
  if (value === 'SUPER_ADMIN') return 'ADMIN'
  return value || 'N/A'
}

export async function safeFetchJson(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { retries?: number; timeoutMs?: number }
): Promise<{ ok: boolean; status: number; data: any }> {
  const retries = options?.retries ?? 1
  const timeoutMs = options?.timeoutMs ?? 12000

  let attempt = 0
  while (attempt <= retries) {
    const controller = new AbortController()
    let timedOut = false
    const timer = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      const token = getTabAuthToken()
      const headers = new Headers(init?.headers)
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`)
      }

      const response = await fetch(input, {
        cache: 'no-store',
        credentials: 'include',
        ...init,
        headers,
        signal: controller.signal,
      })

      const text = await response.text()
      const contentType = String(response.headers.get('content-type') || '').toLowerCase()
      const isJsonResponse = contentType.includes('application/json')
      const looksLikeHtml = /^\s*</.test(text)

      let data: any = {}
      if (text) {
        if (isJsonResponse) {
          try {
            data = JSON.parse(text)
          } catch {
            // A cut-off response (proxy/gateway closing a slow connection mid-body)
            // parses as a SyntaxError, not a network error, so it lands here instead
            // of the catch block below. Treat it like a timeout: retry, and once
            // exhausted, fail quietly instead of surfacing the raw parser message.
            if (attempt < retries) {
              attempt += 1
              await new Promise((resolve) => window.setTimeout(resolve, 350 * attempt))
              continue
            }
            return {
              ok: false,
              status: response.status,
              data: { error: 'Response was incomplete or malformed', aborted: true, malformed: true },
            }
          }
        } else if (looksLikeHtml) {
          data = {
            error: response.status === 401 || response.status === 403
              ? 'Unauthorized response (HTML received). Please log in again.'
              : `Non-JSON response received (status ${response.status}).`,
          }
        } else {
          data = { error: text }
        }
      }
      const result = { ok: response.ok && data?.success !== false, status: response.status, data }
      if (result.ok) return result

      // Do not retry auth/permission errors or other client-side request errors.
      const nonRetriable =
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404 ||
        response.status === 405 ||
        response.status === 409 ||
        response.status === 410 ||
        response.status === 422
      if (nonRetriable || attempt === retries) {
        return result
      }
      attempt += 1
      await new Promise((resolve) => window.setTimeout(resolve, 350 * attempt))
      continue
    } catch (error) {
      // AbortError means the request was intentionally cancelled (timeout, unmount, navigation).
      // Return immediately without retrying or triggering console.error overlays.
      if (error instanceof DOMException && error.name === 'AbortError') {
        // `aborted` lets callers keep cached data quietly; only the message differs
        // between a slow endpoint (timer fired) and a cancelled request.
        return {
          ok: false,
          status: 0,
          data: { error: timedOut ? 'Request timed out' : 'Request aborted', aborted: true, timedOut },
        }
      }
      if (attempt === retries) {
        const message = error instanceof Error ? error.message : 'Request failed'
        return { ok: false, status: 0, data: { error: message } }
      }
      attempt += 1
      await new Promise((resolve) => window.setTimeout(resolve, 350 * attempt))
    } finally {
      window.clearTimeout(timer)
    }
  }

  return { ok: false, status: 0, data: { error: 'Request failed' } }
}

export async function fetchAllPaginatedCollection<T>(
  endpoint: string,
  collectionKey: string,
  init?: RequestInit,
  options?: { retries?: number; timeoutMs?: number; pageSize?: number; maxPages?: number }
): Promise<{ ok: boolean; status: number; data: any }> {
  const pageSize = Math.max(1, Number(options?.pageSize || 200))
  const maxPages = Math.max(1, Number(options?.maxPages || 100))
  const [path, query = ''] = String(endpoint || '').split('?')
  const baseParams = new URLSearchParams(query)
  const existingLimit = Number(baseParams.get('limit') || '')
  if (!baseParams.get('pageSize')) {
    baseParams.set('pageSize', String(Number.isFinite(existingLimit) && existingLimit > 0 ? existingLimit : pageSize))
  }
  baseParams.delete('limit')

  const fetchPage = async (page: number) => {
    const params = new URLSearchParams(baseParams)
    params.set('page', String(page))
    return safeFetchJson(`${path}?${params.toString()}`, init, options)
  }

  const first = await fetchPage(1)
  if (!first.ok) return first

  const combined = getCollection<T>(first.data, [collectionKey])
  const reportedTotalPages = Math.max(1, Number(first.data?.totalPages || 1))
  const totalPages = Math.min(reportedTotalPages, maxPages)

  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchPage(page)
    if (!next.ok) return next
    combined.push(...getCollection<T>(next.data, [collectionKey]))
  }

  return {
    ...first,
    data: {
      ...first.data,
      [collectionKey]: combined,
      totalPages,
    },
  }
}
