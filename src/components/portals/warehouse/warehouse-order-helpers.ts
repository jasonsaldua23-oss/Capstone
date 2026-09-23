import { toast } from 'sonner'
import { emitDataSync } from '@/lib/data-sync'
import type { ProductOption, WarehouseOrderItem, WarehouseReplacementItem, WarehouseTripItem } from './warehouse-portal-types'
import { formatDayKey } from './warehouse-portal-utils'

/**
 * Order, fulfillment and replacement helpers for the warehouse portal. Functions that need the portal's loaded collections take them as an explicit trailing `deps` argument.
 */

export const isDropPointCompleted = (status: unknown) => {
  const value = String(status || '').toUpperCase()
  return ['COMPLETED', 'DELIVERED', 'FULFILLED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(value)
}

export const isCompletedOrderStatus = (status: unknown) => {
  const value = String(status || '').toUpperCase()
  return ['DELIVERED', 'COMPLETED', 'FULFILLED'].includes(value)
}

export const isCancelledLikeStatus = (status: unknown) => {
  const value = String(status || '').toUpperCase()
  return ['CANCELLED', 'CANCELED', 'FAILED', 'SKIPPED', 'FAILED_DELIVERY', 'REJECTED'].includes(value)
}

export const isDateMatch = (value: unknown, dayKey: string) => {
  if (!value || !dayKey) return false
  const raw = String(value).trim()
  if (!raw) return false
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return false
  return formatDayKey(parsed) === dayKey
}

export const getDaysLeft = (expiryDate: string | null) => {
  if (!expiryDate) return null
  const end = new Date(expiryDate).getTime()
  const start = new Date().getTime()
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24))
}

export const normalizeFulfillmentStatus = (status: unknown) => {
  const value = String(status || '').trim().toUpperCase()
  if (!value) return 'PENDING'
  if (value === 'IN_TRANSIT' || value === 'OUT_FOR_DELIVERY' || value === 'DISPATCHED') return 'IN_TRANSIT'
  if (value === 'DELIVERED' || value === 'COMPLETED' || value === 'FULFILLED' || value === 'ARRIVED') return 'DELIVERED'
  if (value === 'FAILED' || value === 'FAILED_DELIVERY') return 'FAILED'
  return value
}

export const extractFulfillmentLegs = (order: any) => {
  const toList = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])
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
      const legItems = Array.isArray(leg?.items) ? leg.items : []
      const allocatedQty = Number(
        leg?.allocatedQty ??
        leg?.allocatedQuantity ??
        legItems.reduce((sum: number, item: any) => sum + Number(item?.allocatedQty ?? item?.quantity ?? 0), 0)
      ) || 0
      return {
        id: String(leg?.id || `${order?.id || 'order'}-leg-${index}`),
        warehouseId: String(leg?.warehouseId ?? leg?.warehouse_id ?? leg?.warehouse?.id ?? '').trim(),
        warehouseName: String(leg?.warehouseName ?? leg?.warehouse?.name ?? order?.warehouseName ?? order?.warehouseCode ?? '').trim() || 'Unassigned',
        status: normalizeFulfillmentStatus(leg?.status ?? order?.status),
        tripId: leg?.tripId ? String(leg.tripId) : null,
        tripNumber: String(leg?.trip?.tripNumber || leg?.tripNumber || '').trim() || null,
        allocatedQty,
      }
    })
  
  // Deduplicate direct legs by warehouseName + tripNumber combination
  const seenLegKeys = new Set<string>()
  const deduplicatedDirectLegs = normalizedDirectLegs.filter((leg: any) => {
    const key = `${leg.warehouseName}::${leg.tripNumber || 'no-trip'}`
    if (seenLegKeys.has(key)) {
      return false // Skip duplicate
    }
    seenLegKeys.add(key)
    return true
  })

  const topLevelAllocations = [
    ...toList<any>(order?.warehouseAllocations),
    ...toList<any>(order?.allocations),
  ]
  const itemLevelAllocations = toList<any>(order?.items).flatMap((item: any) => [
    ...toList<any>(item?.warehouseAllocations),
    ...toList<any>(item?.allocations),
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
        warehouseId,
        warehouseName: warehouseName || (warehouseId ? `Warehouse ${warehouseId}` : 'Unassigned'),
        status: normalizeFulfillmentStatus(order?.status),
        tripId: null,
        tripNumber: null,
        allocatedQty,
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

  if (deduplicatedDirectLegs.length > 0) {
    const allocationQtyByWarehouseKey = new Map<string, number>()
    normalizedAllocationLegs.forEach((leg: any) => {
      const key = getWarehouseKey(leg)
      if (!key) return
      allocationQtyByWarehouseKey.set(key, Number(leg?.allocatedQty || 0))
    })
    const hydratedDirectLegs = deduplicatedDirectLegs.map((leg: any) => {
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

  const fallbackItems = Array.isArray(order?.items) ? order.items : []
  return [{
    id: `${String(order?.id || 'order')}-leg-0`,
    warehouseName: String(order?.warehouseName || order?.warehouseCode || '').trim() || 'Unassigned',
    status: normalizeFulfillmentStatus(order?.status),
    tripId: order?.tripId ? String(order.tripId) : null,
    tripNumber: String(order?.tripNumber || order?.progress?.trip?.tripNumber || '').trim() || null,
    allocatedQty: fallbackItems.reduce((sum: number, item: any) => sum + Number(item?.quantity || 0), 0),
  }]
}

export type DeriveOrderFulfillmentSummaryDeps = {
  trips: WarehouseTripItem[]
}

export function deriveOrderFulfillmentSummaryImpl(order: any, deps: DeriveOrderFulfillmentSummaryDeps) {
  const { trips } = deps
  const legs = extractFulfillmentLegs(order)
  // Filter out legs for trips that don't exist (were deleted)
  let validLegs = legs.filter((leg: any) => {
    const legTripId = String(leg?.tripId || '').trim()
    const legTripNumber = String(leg?.tripNumber || '').trim()
    if (!legTripId && !legTripNumber) return true // Keep unassigned legs
    // Check if trip exists in our trips list
    return trips.some((t: any) => 
      String(t?.id || '').trim() === legTripId || 
      String(t?.tripNumber || '').trim() === legTripNumber
    )
  })
  const getWarehouseLegKey = (leg: any) =>
    String(leg?.warehouseId || '').trim() || String(leg?.warehouseName || '').trim().toLowerCase()
  const legsByWarehouse = new Map<string, any[]>()
  validLegs.forEach((leg: any) => {
    const key = getWarehouseLegKey(leg)
    if (!key) return
    const current = legsByWarehouse.get(key) || []
    current.push(leg)
    legsByWarehouse.set(key, current)
  })
  if (legsByWarehouse.size > 0) {
    const prioritizedLegs: any[] = []
    const consumedKeys = new Set<string>()
    validLegs.forEach((leg: any) => {
      const key = getWarehouseLegKey(leg)
      if (!key || consumedKeys.has(key)) return
      consumedKeys.add(key)
      const group = legsByWarehouse.get(key) || []
      const nonTerminalGroup = group.filter(
        (entry: any) => !['FAILED', 'CANCELLED'].includes(String(entry?.status || '').trim().toUpperCase())
      )
      prioritizedLegs.push(...(nonTerminalGroup.length > 0 ? nonTerminalGroup : group))
    })
    validLegs = prioritizedLegs
  }
  const deliveredCount = validLegs.filter((leg: any) => leg.status === 'DELIVERED').length
  const failedCount = validLegs.filter((leg: any) => leg.status === 'FAILED' || leg.status === 'CANCELLED').length
  const unassignedTripCount = validLegs.filter((leg: any) => !leg.tripId && !leg.tripNumber).length
  const total = validLegs.length
  const fulfillmentStatus = total === 0
    ? 'PENDING'
    : deliveredCount === total
      ? 'FULFILLED'
      : failedCount === total
        ? 'FAILED'
        : 'IN_PROGRESS'
  return {
    legs: validLegs,
    totalLegs: total,
    deliveredLegs: deliveredCount,
    unassignedTripCount,
    needsSplit: total > 1,
    fulfillmentStatus,
  }
}

export type FormatAllocatedQtyLabelDeps = {
  trips: WarehouseTripItem[]
}

export function formatAllocatedQtyLabelImpl(order: any, allocatedQty: number, totalQty: number, deps: FormatAllocatedQtyLabelDeps) {
  const { trips } = deps
  const summary = deriveOrderFulfillmentSummaryImpl(order, { trips })
  return summary.totalLegs > 1 ? `${allocatedQty} / ${totalQty}` : `${allocatedQty}`
}

export const formatWarehouseOrderStatus = (status: string, paymentStatus?: string | null, notes?: string | null) => {
  const rawStatus = String(status || '').toUpperCase()
  void notes

  if (['DELIVERED', 'COMPLETED', 'FULFILLED'].includes(rawStatus)) return 'DELIVERED'
  if (rawStatus === 'REJECTED') return 'REJECTED'
  if (['FAILED', 'FAILED_DELIVERY', 'CANCELLED'].includes(rawStatus)) return 'CANCELLED'
  if (String(paymentStatus || '').toLowerCase() === 'pending_approval') {
    return 'PENDING APPROVAL'
  }

  if (['DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(rawStatus)) {
    return 'OUT FOR DELIVERY'
  }

  if (['PREPARING', 'PROCESSING', 'PACKED', 'READY_FOR_PICKUP', 'UNAPPROVED'].includes(rawStatus)) {
    // Keep PREPARING as the API value while every portal displays Processing.
    return 'PROCESSING'
  }
  if (['PENDING', 'CONFIRMED'].includes(rawStatus)) return 'PENDING'

  return rawStatus.replace(/_/g, ' ')
}

export type GetWarehouseDisplayOrderStatusDeps = {
  trips: WarehouseTripItem[]
}

export function getWarehouseDisplayOrderStatusImpl(order: any, deps: GetWarehouseDisplayOrderStatusDeps) {
  const { trips } = deps
  const summary = deriveOrderFulfillmentSummaryImpl(order, { trips })
  if (summary.totalLegs > 1) {
    if (summary.fulfillmentStatus === 'FULFILLED') return 'FULFILLED'
    if (summary.fulfillmentStatus === 'IN_PROGRESS') return 'IN PROGRESS'
  }
  return formatWarehouseOrderStatus(order.status, order.paymentStatus, order.notes)
}

export const getWarehouseOrderStatusTextClass = (status: string) => {
  const value = String(status || '').trim().toUpperCase()
  if (value === 'PENDING') return 'text-yellow-700'
  if (value === 'PROCESSING') return 'text-lime-700'
  if (value === 'CANCELLED') return 'text-red-700'
  if (value === 'DELIVERED') return 'text-emerald-700'
  return 'text-slate-700'
}

export const isWarehouseRescheduledOrder = (order: any) => String(order?.status || '').trim().toUpperCase() === 'RESCHEDULED'

// Added: surface the customer's scheduled delivery date on the purchase order.
export const formatScheduledDeliveryDate = (order: any): string => {
  const raw = String(order?.deliveryDate || order?.timeline?.deliveryDate || '').trim()
  if (!raw) return ''
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const formatWarehouseOrderAddress = (order: WarehouseOrderItem | null) => {
  const address = String(order?.shippingAddress || '').trim()
  const city = String(order?.shippingCity || '').trim()
  const province = String(order?.shippingProvince || '').trim()
  const zipCode = String(order?.shippingZipCode || '').trim()

  const normalize = (value: string) =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim()

  const addressTokens = address
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)

  const existingTokenSet = new Set(addressTokens.map((token) => normalize(token)))
  const extras = [city, province, zipCode].filter((part) => {
    if (!part) return false
    const key = normalize(part)
    if (!key) return false
    if (existingTokenSet.has(key)) return false
    existingTokenSet.add(key)
    return true
  })

  const combined = [address, ...extras].filter(Boolean).join(', ')
  return combined || 'N/A'
}

export const getOrderItemSizeLabel = (item: any): string => {
  const productSizes = Array.isArray(item?.product?.sizes) ? item.product.sizes : []
  const combinedSizes = productSizes
    .map((value: any) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
  if (combinedSizes) return combinedSizes
  return String(item?.product?.size || item?.product?.sizeLabel || item?.product?.unit || item?.productUnit || '').trim()
}

export const getOrderBarangayLabel = (address?: string | null, city?: string | null) => {
  const rawAddress = String(address || '').trim()
  if (rawAddress) {
    const tokens = rawAddress
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
    const barangayToken = tokens.find((token) => /\b(barangay|brgy\.?)\b/i.test(token))
    if (barangayToken) {
      return barangayToken.replace(/\bbrgy\.?\b/i, 'Barangay').replace(/\s+/g, ' ').trim()
    }
  }
  const fallbackCity = String(city || '').trim()
  return fallbackCity || 'N/A'
}

export const getMaxOrderUpdatedAt = (rows: WarehouseOrderItem[]) =>
  rows.reduce((latest, row) => {
    const candidate = String((row as any)?.updatedAt || row?.createdAt || '')
    if (!candidate) return latest
    if (!latest) return candidate
    const candidateMs = new Date(candidate).getTime()
    const latestMs = new Date(latest).getTime()
    if (Number.isNaN(candidateMs)) return latest
    if (Number.isNaN(latestMs) || candidateMs > latestMs) return candidate
    return latest
  }, '')

export const mergeWarehouseOrders = (current: WarehouseOrderItem[], incoming: WarehouseOrderItem[]) => {
  const byId = new Map<string, WarehouseOrderItem>()
  current.forEach((row) => {
    if (!row?.id) return
    byId.set(String(row.id), row)
  })
  incoming.forEach((row) => {
    if (!row?.id) return
    const key = String(row.id)
    byId.set(key, { ...(byId.get(key) || {}), ...row })
  })
  return Array.from(byId.values()).sort((a, b) => {
    const left = new Date(String((a as any)?.createdAt || 0)).getTime()
    const right = new Date(String((b as any)?.createdAt || 0)).getTime()
    return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left)
  })
}

export const parseIssueMeta = (notes: string | null | undefined) => {
  const raw = String(notes || '').trim()
  if (!raw) return {}
  const marker = 'Meta:'
  const markerIndex = raw.lastIndexOf(marker)
  if (markerIndex < 0) return {}
  const jsonText = raw.slice(markerIndex + marker.length).trim()
  if (!jsonText) return {}
  try {
    const parsed = JSON.parse(jsonText)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    try {
      const decoder = (JSON as any)
      if (typeof decoder?.parse !== 'function') return {}
      const firstBrace = jsonText.indexOf('{')
      if (firstBrace < 0) return {}
      let depth = 0
      let endIndex = -1
      for (let i = firstBrace; i < jsonText.length; i += 1) {
        const ch = jsonText[i]
        if (ch === '{') depth += 1
        if (ch === '}') {
          depth -= 1
          if (depth === 0) {
            endIndex = i
            break
          }
        }
      }
      if (endIndex < 0) return {}
      const objectText = jsonText.slice(firstBrace, endIndex + 1)
      const parsed = JSON.parse(objectText)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
}

export type BuildReplacementLinesDeps = {
  orders: WarehouseOrderItem[]
  products: ProductOption[]
}

export function buildReplacementLinesImpl(replacement: any, meta: any, deps: BuildReplacementLinesDeps) {
  const { orders, products } = deps
  const rawStatus = String(replacement?.status || '').trim().toUpperCase()
  const isReplacementCompleted = ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus)
  const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const formatProductNameWithSize = (baseName: any, sizeValue: any) => {
    const normalizedBaseName = String(baseName || 'N/A').trim()
    const normalizedSize = String(sizeValue || '').trim().replace(/^\((.*)\)$/, '$1').trim()
    if (!normalizedSize) return normalizedBaseName
    const trailingSizePattern = new RegExp(`\\s*\\(?${escapeRegex(normalizedSize)}\\)?\\s*$`, 'i')
    const baseWithoutTrailingSize = normalizedBaseName.replace(trailingSizePattern, '').trim()
    // Fix: match admin replacement details by showing sizes without parentheses.
    return `${baseWithoutTrailingSize || normalizedBaseName} ${normalizedSize}`
  }
  const toDisplayQty = (line: any, fallbackNumeric: number, mode: 'toReplace' | 'replaced') => {
    const unitHint = String(
      line?.productUnit ||
      line?.replacementProductUnit ||
      line?.originalProductUnit ||
      line?.unit ||
      ''
    ).trim().toLowerCase()
    const contextText = `${String(replacement?.description || '')} ${String(replacement?.reason || '')} ${String(replacement?.notes || '')}`.toLowerCase()
    const byPackText = /\bby\s*pack\b/.test(contextText)
    const byBundleText = /\bby\s*bundle\b/.test(contextText)
    const byUnitText = /\bby\s*unit\b/.test(contextText)
    const byCaseText = /\bby\s*case\b/.test(contextText)
    const byBottleText = /\bby\s*bottle\b/.test(contextText)
    const qtyPerUnitMatch = contextText.match(/qty\s*\/\s*unit\s*[:\-]?\s*(\d+)/i)
    const qtyPerCaseMatch = contextText.match(/qty\s*\/\s*case\s*[:\-]?\s*(\d+)/i)
    const qtyPerPackMatch = contextText.match(/qty\s*\/\s*pack\s*[:\-]?\s*(\d+)/i)
    const qtyPerBundleMatch = contextText.match(/qty\s*\/\s*bundle\s*[:\-]?\s*(\d+)/i)
    const qtyPerUnit = qtyPerUnitMatch ? Number(qtyPerUnitMatch[1]) : NaN
    const qtyPerCase = qtyPerCaseMatch ? Number(qtyPerCaseMatch[1]) : NaN
    const qtyPerPack = qtyPerPackMatch ? Number(qtyPerPackMatch[1]) : NaN
    const qtyPerBundle = qtyPerBundleMatch ? Number(qtyPerBundleMatch[1]) : NaN
    const unitLabel =
      unitHint.includes('pack') || byPackText ? 'pack(s)'
        : unitHint.includes('bundle') || byBundleText ? 'bundle(s)'
          : unitHint.includes('case') || byCaseText ? 'case(s)'
            : 'unit(s)'

    const caseLikeQty = Number(
      mode === 'toReplace'
        ? (line?.damagedCases ?? line?.quantityToReplaceCases ?? line?.replacementCases)
        : (line?.replacedCases ?? line?.quantityReplacedCases ?? line?.replacementCases)
    )
    const bottleQty = Number(
      mode === 'toReplace'
        ? (line?.damagedBottles ?? line?.quantityToReplaceBottles ?? line?.replacementBottles)
        : (line?.replacedBottles ?? line?.quantityReplacedBottles ?? line?.replacementBottles)
    )

    if (Number.isFinite(caseLikeQty) && caseLikeQty > 0) return `${caseLikeQty} ${unitLabel}`
    if (Number.isFinite(bottleQty) && bottleQty > 0) {
      return `${bottleQty} bottle(s)`
    }

    const fallback = Math.max(0, Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0)
    if (byUnitText && Number.isFinite(qtyPerUnit) && qtyPerUnit > 0 && fallback > 0) return `${fallback / qtyPerUnit} ${unitLabel}`
    if (byCaseText && Number.isFinite(qtyPerCase) && qtyPerCase > 0 && fallback > 0) {
      return `${fallback / qtyPerCase} ${unitLabel}`
    }
    if (byPackText && Number.isFinite(qtyPerPack) && qtyPerPack > 0 && fallback > 0) {
      return `${fallback / qtyPerPack} ${unitLabel}`
    }
    if (byBundleText && Number.isFinite(qtyPerBundle) && qtyPerBundle > 0 && fallback > 0) return `${fallback / qtyPerBundle} ${unitLabel}`
    if (byBottleText) {
      return `${fallback} bottle(s)`
    }
    return String(fallback)
  }

  const sourceLines = Array.isArray(replacement?.replacementLines) && replacement.replacementLines.length
    ? replacement.replacementLines
    : Array.isArray(meta?.replacementLines) && meta.replacementLines.length
      ? meta.replacementLines
      : Array.isArray(replacement?.replacementItems) && replacement.replacementItems.length
        ? replacement.replacementItems
        : Array.isArray(meta?.replacementItems) && meta.replacementItems.length
          ? meta.replacementItems
      : []
  const orderNumberKey = String(replacement?.orderNumber || replacement?.order?.orderNumber || '').trim().toUpperCase()
  const sourceOrder =
    orders.find((order: any) => String(order?.orderNumber || '').trim().toUpperCase() === orderNumberKey) ||
    orders.find((order: any) => String(order?.id || '') === String(replacement?.orderId || replacement?.order?.id || '')) ||
    null
  const sourceOrderItems = Array.isArray(sourceOrder?.items) ? sourceOrder.items : []
  const fallbackProductName =
    String(
      sourceOrderItems[0]?.product?.name ||
      sourceOrderItems[0]?.productName ||
      sourceOrderItems[0]?.name ||
      ''
    ).trim() || 'N/A'
  const fallbackLine = {
    originalProductName:
      replacement?.originalProductName ||
      meta?.originalProductName ||
      replacement?.order?.items?.[0]?.product?.name ||
      replacement?.order?.items?.[0]?.productName ||
      fallbackProductName ||
      'N/A',
    replacementProductName:
      replacement?.replacementProductName ||
      meta?.replacementProductName ||
      replacement?.originalProductName ||
      meta?.originalProductName ||
      replacement?.order?.items?.[0]?.product?.name ||
      replacement?.order?.items?.[0]?.productName ||
      fallbackProductName ||
      'N/A',
    quantityToReplace: replacement?.quantityToReplace ?? meta?.quantityToReplace ?? meta?.damagedQuantity ?? replacement?.replacementQuantity ?? meta?.replacementQuantity ?? 0,
    quantityReplaced: replacement?.quantityReplaced ?? meta?.quantityReplaced ?? replacement?.replacementQuantity ?? meta?.replacementQuantity ?? 0,
  }
  const lines = sourceLines.length ? sourceLines : [fallbackLine]
  return lines.map((line: any) => {
    const originalProductId = String(line?.originalProductId || line?.productId || '').trim()
    const replacementProductId = String(line?.replacementProductId || line?.productId || '').trim()
    const originalCategoryRaw = String(
      line?.originalProductCategory ||
      line?.originalCategory ||
      line?.category ||
      ''
    ).trim()
    const replacementCategoryRaw = String(
      line?.replacementProductCategory ||
      line?.replacementCategory ||
      line?.category ||
      ''
    ).trim()
    const originalSize = String(line?.originalProductSize || replacement?.originalProductSize || meta?.originalProductSize || '').trim()
    const replacementSize = String(line?.replacementProductSize || replacement?.replacementProductSize || meta?.replacementProductSize || originalSize || '').trim()
    const originalBaseName = String(line?.originalProductName || line?.productName || fallbackLine.originalProductName || 'N/A')
    const replacementBaseName = String(line?.replacementProductName || line?.replacementProduct?.name || line?.originalProductName || fallbackLine.replacementProductName || 'N/A')
    const matchedOriginalOrderItem = sourceOrderItems.find((orderItem: any) => {
      const orderItemProductId = String(orderItem?.product?.id || orderItem?.productId || '').trim()
      if (originalProductId && orderItemProductId && originalProductId === orderItemProductId) return true
      const orderItemProductName = String(orderItem?.product?.name || orderItem?.productName || '').trim().toLowerCase()
      return Boolean(orderItemProductName && orderItemProductName === originalBaseName.trim().toLowerCase())
    })
    const matchedReplacementOrderItem = sourceOrderItems.find((orderItem: any) => {
      const orderItemProductId = String(orderItem?.product?.id || orderItem?.productId || '').trim()
      if (replacementProductId && orderItemProductId && replacementProductId === orderItemProductId) return true
      const orderItemProductName = String(orderItem?.product?.name || orderItem?.productName || '').trim().toLowerCase()
      return Boolean(orderItemProductName && orderItemProductName === replacementBaseName.trim().toLowerCase())
    })
    const matchedOriginalCatalogProduct = products.find((product: any) => {
      const catalogId = String(product?.id || '').trim()
      if (originalProductId && catalogId && originalProductId === catalogId) return true
      const catalogName = String(product?.name || '').trim().toLowerCase()
      return Boolean(catalogName && catalogName === originalBaseName.trim().toLowerCase())
    })
    const matchedReplacementCatalogProduct = products.find((product: any) => {
      const catalogId = String(product?.id || '').trim()
      if (replacementProductId && catalogId && replacementProductId === catalogId) return true
      const catalogName = String(product?.name || '').trim().toLowerCase()
      return Boolean(catalogName && catalogName === replacementBaseName.trim().toLowerCase())
    })
    const originalCategory = originalCategoryRaw || String(
      (matchedOriginalOrderItem?.product as any)?.category?.name ||
      (matchedOriginalOrderItem?.product as any)?.category ||
      (matchedOriginalCatalogProduct as any)?.category?.name ||
      (matchedOriginalCatalogProduct as any)?.category ||
      ''
    ).trim()
    const replacementCategory = replacementCategoryRaw || String(
      (matchedReplacementOrderItem?.product as any)?.category?.name ||
      (matchedReplacementOrderItem?.product as any)?.category ||
      (matchedReplacementCatalogProduct as any)?.category?.name ||
      (matchedReplacementCatalogProduct as any)?.category ||
      ''
    ).trim()
    const quantityToReplace = Number(line?.quantityToReplace ?? line?.damagedQuantity ?? fallbackLine.quantityToReplace ?? 0)
    const rawQuantityReplaced = Number(line?.quantityReplaced ?? line?.replacedQuantity ?? fallbackLine.quantityReplaced ?? 0)
    const quantityReplaced = isReplacementCompleted ? rawQuantityReplaced : 0
    return {
      // Preserve the saved unit/count fields for the warehouse detail formatter.
      ...line,
      originalProductName: formatProductNameWithSize(originalBaseName, originalSize),
      replacementProductName: formatProductNameWithSize(replacementBaseName, replacementSize),
      originalProductCategory: originalCategory,
      replacementProductCategory: replacementCategory,
      quantityToReplace,
      quantityReplaced,
      quantityToReplaceDisplay: toDisplayQty(line, quantityToReplace, 'toReplace'),
      quantityReplacedDisplay: isReplacementCompleted ? toDisplayQty(line, quantityReplaced, 'replaced') : '0',
    }
  })
}

// Fix: route previews must use the replacement request, not rounded loading quantities.
export type GetRouteReplacementProductsDeps = {
  orders: WarehouseOrderItem[]
  products: ProductOption[]
  replacements: WarehouseReplacementItem[]
}

export function getRouteReplacementProductsImpl(order: any, deps: GetRouteReplacementProductsDeps): string {
  const { orders, products, replacements } = deps
  const replacement: any = replacements.find((entry: any) => {
    const meta = parseIssueMeta(entry.notes)
    const linkedId = String(entry.replacementOrderId || entry.linkedReplacementOrderId || meta?.replacementOrderId || '')
    const linkedNumber = String(entry.replacementOrderNumber || entry.linkedReplacementOrderNumber || meta?.replacementOrderNumber || '')
    return (linkedId && linkedId === String(order.id)) || (linkedNumber && linkedNumber === String(order.orderNumber))
  })
  if (!replacement) return String(order.products || '')
  const meta = parseIssueMeta(replacement.notes)
  const rawLines = replacement.replacementLines?.length ? replacement.replacementLines : meta?.replacementLines || replacement.replacementItems || meta?.replacementItems || []
  const displayLines = buildReplacementLinesImpl(replacement, meta, { orders, products })
  return displayLines.map((line, index) => {
    const source = rawLines[index] || {}
    const mode = String(source.lineInputMode || source.replacementInputMode || source.inputMode || '').toLowerCase()
    // Bottle requests carry an exact count even when the delivery order reserves a whole pack.
    const bottleQty = Number(source.quantityToReplaceBottles ?? source.damagedBottles ?? source.quantityToReplace)
    const quantity = mode === 'bottle' && Number.isFinite(bottleQty)
      ? `${bottleQty} bottle`
      : String(source.quantityToReplaceDisplay || line.quantityToReplaceDisplay || line.quantityToReplace).replace(/\(s\)/g, '')
    return `${line.replacementProductName} ${quantity}`
  }).join(', ')
}

export type FormatIssueStatusDeps = {
  orders: WarehouseOrderItem[]
  products: ProductOption[]
}

export function formatIssueStatusImpl(entry: WarehouseReplacementItem, deps: FormatIssueStatusDeps) {
  const { orders, products } = deps
  const meta = parseIssueMeta(entry?.notes)
  const hasOutstandingReplacementQty = (() => {
    const lines = buildReplacementLinesImpl(entry, meta, { orders, products })
    const totalQtyToReplace = lines.reduce((sum, line) => sum + Math.max(Number(line.quantityToReplace || 0), 0), 0)
    const totalQtyReplaced = lines.reduce((sum, line) => sum + Math.max(Number(line.quantityReplaced || 0), 0), 0)
    if (totalQtyToReplace > 0) return totalQtyReplaced < totalQtyToReplace
    const qtyToReplace = Number(
      entry?.quantityToReplace ??
      meta?.quantityToReplace ??
      entry?.damagedQuantity ??
      meta?.damagedQuantity ??
      0
    )
    const qtyReplaced = Number(
      entry?.quantityReplaced ??
      meta?.quantityReplaced ??
      0
    )
    return Number.isFinite(qtyToReplace) && Number.isFinite(qtyReplaced) && qtyToReplace > qtyReplaced
  })()
  const rawStatus = String(entry?.status || '').toUpperCase()
  const rawMode = String((entry as any)?.replacementMode || meta?.replacementMode || '').trim().toUpperCase()
  const scheduledDeliveryDate = String((entry as any)?.scheduledDeliveryDate || meta?.scheduledDeliveryDate || '').trim()
  const replacementOrderId = String((entry as any)?.replacementOrderId || meta?.replacementOrderId || '').trim()
  const hasScheduledFollowUp = Boolean(scheduledDeliveryDate || replacementOrderId)
  if (['CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(rawStatus)) {
    return 'Cancelled'
  }
  if (rawMode === 'CUSTOMER_SUBMITTED' && rawStatus === 'IN_PROGRESS' && !hasScheduledFollowUp) {
    return 'Approved'
  }
  if (['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus) && hasOutstandingReplacementQty) {
    return scheduledDeliveryDate || replacementOrderId ? 'Scheduled for Delivery' : 'Needs Follow-up'
  }
  const normalizedStatus =
    rawStatus === 'REQUESTED'
      ? 'REPORTED'
      : ['PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)
        ? 'IN_PROGRESS'
        : rawStatus === 'REJECTED'
          ? 'REJECTED'
          : rawStatus === 'PROCESSED'
            ? 'COMPLETED'
            : rawStatus
  if (normalizedStatus === 'PENDING') return 'Pending'
  if (normalizedStatus === 'UNDER_REVIEW') return 'Under Review'
  if (normalizedStatus === 'APPROVED') return 'Approved'
  if (normalizedStatus === 'REJECTED') return 'Rejected'
  if (normalizedStatus === 'RESOLVED_ON_DELIVERY') return 'Completed'
  if (normalizedStatus === 'NEEDS_FOLLOW_UP') return 'Needs Follow-up'
  if (normalizedStatus === 'COMPLETED') return 'Completed'
  if (normalizedStatus === 'IN_PROGRESS') return 'In Progress'
  return 'Reported'
}
