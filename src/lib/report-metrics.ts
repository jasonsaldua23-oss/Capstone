import {
  FEEDBACK_DIMENSION_LABELS,
  FEEDBACK_SERVICE_DIMENSIONS,
  inferFeedbackDimension,
  inferFeedbackDimensions,
  lookupFeedbackReason,
  normalizeFeedbackReasonText,
  stripOtherReasonPrefix,
  type FeedbackServiceDimension,
} from '../../shared/customer-logic/src/feedback-reasons.ts'

export type InventoryAlertLevel = 'healthy' | 'low' | 'critical' | 'out_of_stock' | 'overstocked'

export type StockHealthSummary = {
  healthy: number
  low: number
  critical: number
  outOfStock: number
  overstocked: number
  total: number
  belowThreshold: number
}

export type InventoryStatusBreakdown = {
  healthy: number
  lowStock: number
  critical: number
  outOfStock: number
}

export type WarehouseCapacitySummary = {
  usedUnits: number
  totalCapacity: number
  availableCapacity: number
  usagePercent: number
  utilizationStatus: 'Healthy' | 'Moderate' | 'High' | 'Critical'
  capacityBreakdown: Array<{ name: 'Used' | 'Free'; value: number; color: string }>
}

export type InventoryMovementRow = {
  createdAt: unknown
  warehouse: string
  product: string
  type: 'IN' | 'OUT'
  sourceType: 'IN' | 'OUT' | 'RETURN'
  quantity: number
  quantityUnit: 'BASE_UNIT'
}

export type InventoryMovementPoint = {
  key: string
  label: string
  sortDate: Date
  inQty: number
  outQty: number
}

export type InventoryMovementSummary = {
  totalMovements: number
  stockIn: number
  stockOut: number
}

export type WarehouseOrderStats = {
  totalOrders: number
  outForDelivery: number
  delivered: number
}

export type OrderReportStatus = 'DELIVERED' | 'PENDING' | 'CANCELLED'

export type OrderReportRow = {
  orderNumber: string
  customer: string
  itemSummary: string
  productNameWithSize: string
  productCategory: string
  totalQuantity: number
  status: string
  normalizedReportStatus: OrderReportStatus
  amount: number
  createdAt: unknown
  deliveredAt: unknown
  orderDateLabel: string
}

export type OrderReportSummary = {
  totalOrders: number
  deliveredOrders: number
  pendingOrders: number
  cancelledOrders: number
  totalRevenue: number
  totalQuantity: number
}

const INVENTORY_MOVEMENT_TYPES = new Set(['IN', 'OUT', 'RETURN'])

function asNumber(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function toDate(value: unknown) {
  if (!value) return null
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function dayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getBucketMeta(date: Date, granularity: 'day' | 'week' | 'month') {
  if (granularity === 'day') {
    return {
      key: dayKey(date),
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      sortDate: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    }
  }

  if (granularity === 'week') {
    const weekStart = new Date(date)
    const diff = (weekStart.getDay() + 6) % 7
    weekStart.setDate(weekStart.getDate() - diff)
    weekStart.setHours(0, 0, 0, 0)
    const yearStart = new Date(weekStart.getFullYear(), 0, 1)
    const week = Math.ceil((((weekStart.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
    return {
      key: `${weekStart.getFullYear()}-W${String(week).padStart(2, '0')}`,
      label: `W${week} ${weekStart.getFullYear()}`,
      sortDate: weekStart,
    }
  }

  return {
    key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    sortDate: new Date(date.getFullYear(), date.getMonth(), 1),
  }
}

function getRangeGranularity(rangeDays: string) {
  if (rangeDays === '7') return 'day'
  if (rangeDays === '30') return 'week'
  return 'month'
}

// Product names appear in several report tables and charts, so size formatting is centralized here for consistency.
export function getReportProductSizeLabel(product: any) {
  const sizes = Array.isArray(product?.sizes)
    ? product.sizes.map((entry: any) => String(entry || '').trim()).filter(Boolean)
    : []
  if (sizes.length > 0) return sizes.join(', ')

  const fallback = String(
    product?.sizeLabel ??
    product?.size ??
    product?.productSize ??
    product?.variantSize ??
    ''
  ).trim()
  if (fallback) return fallback

  return String(product?.unit || '').trim()
}

export function formatReportProductName(product: any, fallbackName = 'Product') {
  const name = String(product?.name ?? product?.productName ?? product?.title ?? fallbackName).trim() || fallbackName
  const sizeLabel = getReportProductSizeLabel(product)
  return sizeLabel ? `${name} (${sizeLabel})` : name
}

export function getInventoryQuantity(item: any) {
  return Math.max(0, asNumber(item?.quantity))
}

export function getInventoryReservedQty(item: any) {
  return Math.max(0, asNumber(item?.reservedQuantity ?? item?.reserved_quantity))
}

export function getInventoryUnitsPerCase(item: any) {
  return Math.max(0, asNumber(
    item?.quantityPerCase ??
    item?.quantity_per_case ??
    item?.product?.quantityPerCase ??
    item?.product?.quantity_per_case ??
    item?.product?.quantityPerUnit ??
    item?.product?.quantity_per_unit
  ))
}

export function getInventoryReservedBaseUnits(item: any) {
  const explicit = item?.reservedBaseUnits ?? item?.reserved_base_units
  if (explicit !== undefined && explicit !== null) {
    return Math.max(0, asNumber(explicit))
  }
  return getInventoryReservedQty(item) * getInventoryUnitsPerCase(item)
}

export function getInventoryAvailableBaseUnits(item: any) {
  // Added: server availability excludes expired and quarantined batches.
  if (item?.sellableBaseUnits != null) return Math.max(0, asNumber(item.sellableBaseUnits))
  const unitsPerCase = getInventoryUnitsPerCase(item)
  if (unitsPerCase <= 0) return getInventoryAvailableQty(item)
  const looseBaseUnits = Math.max(0, asNumber(
    item?.looseBaseUnits ?? item?.loose_base_units ?? item?.looseBottles ?? item?.loose_bottles
  ))
  const physicalBaseUnits = getInventoryQuantity(item) * unitsPerCase + looseBaseUnits
  return Math.max(0, physicalBaseUnits - getInventoryReservedBaseUnits(item))
}

export function getInventoryAvailableQty(item: any) {
  // Added: keep physical totals intact while displaying only sellable cases.
  if (item?.sellableCases != null) return Math.max(0, asNumber(item.sellableCases))
  const unitsPerCase = getInventoryUnitsPerCase(item)
  // Fix: include complete loose sets in the displayed case total without
  // modifying stored quantities or counting those bottles twice.
  const loose = Math.max(0, asNumber(item?.looseBaseUnits ?? item?.loose_base_units ?? item?.looseBottles ?? item?.loose_bottles))
  const completeLooseCases = unitsPerCase > 0 ? Math.floor(loose / unitsPerCase) : 0
  const availablePhysicalCases = Math.max(0, getInventoryQuantity(item) + completeLooseCases - getInventoryReservedQty(item))
  if (unitsPerCase <= 0) return availablePhysicalCases
  return Math.min(
    availablePhysicalCases,
    Math.floor(getInventoryAvailableBaseUnits(item) / unitsPerCase)
  )
}

export function getInventoryLooseRemainder(item: any) {
  // Fix: full sets are already included in Available; show only leftover units.
  const capacity = getInventoryUnitsPerCase(item)
  const loose = Math.max(0, asNumber(item?.looseBaseUnits ?? item?.loose_base_units ?? item?.looseBottles ?? item?.loose_bottles))
  return capacity > 0 ? loose % capacity : loose
}

export function getInventoryThreshold(item: any) {
  return Math.max(0, asNumber(item?.minStock ?? item?.threshold ?? item?.min_stock))
}

export function isInventoryOverstocked(item: any, now = Date.now()) {
  if (typeof item?.overstockedFlag === 'boolean') return item.overstockedFlag
  const threshold = getInventoryThreshold(item)
  if (threshold <= 0) return false
  if (getInventoryAvailableQty(item) < threshold * 3) return false

  const lastRestockedRaw =
    item?.lastRestockedAt ??
    item?.last_restocked_at ??
    item?.updatedAt ??
    item?.updated_at
  const lastRestockedAt = toDate(lastRestockedRaw)
  if (!lastRestockedAt) return false

  return (now - lastRestockedAt.getTime()) >= (7 * 24 * 60 * 60 * 1000)
}

export function getInventoryAlertLevel(item: any, now = Date.now()): InventoryAlertLevel {
  const available = getInventoryAvailableQty(item)
  const threshold = getInventoryThreshold(item)

  if (available === 0) return 'out_of_stock'
  if (threshold > 0 && available <= threshold) return 'critical'
  if (threshold > 0 && available <= threshold * 1.2) return 'low'
  if (isInventoryOverstocked(item, now)) return 'overstocked'
  return 'healthy'
}

export function summarizeStockHealth(items: any[], now = Date.now()): StockHealthSummary {
  return items.reduce<StockHealthSummary>((acc, item) => {
    const level = getInventoryAlertLevel(item, now)
    const threshold = getInventoryThreshold(item)
    const available = getInventoryAvailableQty(item)

    if (threshold > 0 && available <= threshold) {
      acc.belowThreshold += 1
    }

    if (level === 'healthy') acc.healthy += 1
    if (level === 'low') acc.low += 1
    if (level === 'critical') acc.critical += 1
    if (level === 'out_of_stock') acc.outOfStock += 1
    if (level === 'overstocked') acc.overstocked += 1
    acc.total += 1
    return acc
  }, {
    healthy: 0,
    low: 0,
    critical: 0,
    outOfStock: 0,
    overstocked: 0,
    total: 0,
    belowThreshold: 0,
  })
}

export function buildInventoryStatusBreakdown(items: any[], now = Date.now()): InventoryStatusBreakdown {
  const summary = summarizeStockHealth(items, now)
  return {
    healthy: summary.healthy,
    lowStock: summary.low,
    critical: summary.critical,
    outOfStock: summary.outOfStock,
  }
}

export function buildWarehouseCapacitySummary(
  warehouse: any,
  items: any[],
): WarehouseCapacitySummary {
  const usedUnits = items.reduce((sum, item) => sum + getInventoryQuantity(item), 0)
  const configuredCapacity = Math.max(0, asNumber(warehouse?.capacity))
  const totalCapacity = configuredCapacity > 0 ? configuredCapacity : Math.max(1000, usedUnits + 250)
  const usagePercent = totalCapacity > 0
    ? Math.min(100, Number(((usedUnits / totalCapacity) * 100).toFixed(1)))
    : 0
  const availableCapacity = Math.max(0, totalCapacity - usedUnits)
  const utilizationStatus =
    usagePercent >= 90 ? 'Critical' :
    usagePercent >= 75 ? 'High' :
    usagePercent >= 55 ? 'Moderate' :
    'Healthy'

  return {
    usedUnits,
    totalCapacity,
    availableCapacity,
    usagePercent,
    utilizationStatus,
    capacityBreakdown: [
      { name: 'Used', value: usedUnits, color: '#3b82f6' },
      { name: 'Free', value: availableCapacity, color: '#34d399' },
    ],
  }
}

export function buildUtilizationTrend(
  usedUnits: number,
  totalCapacity: number,
  batches: any[],
  inventoryTransactions: any[] = [],
  days = 7,
) {
  const relevantTransactions = inventoryTransactions
    .map((transaction) => ({
      quantity: Math.max(0, asNumber(transaction?.quantity)),
      date: toDate(transaction?.createdAt ?? transaction?.created_at),
      type: String(transaction?.type || '').trim().toUpperCase(),
    }))
    .filter(
      (entry): entry is { quantity: number; date: Date; type: string } =>
        Boolean(entry.date) && (entry.type === 'IN' || entry.type === 'OUT')
    )

  const relevantBatches = batches
    .map((batch) => ({
      quantity: Math.max(0, asNumber(batch?.quantity)),
      date: toDate(batch?.receiptDate ?? batch?.createdAt),
    }))
    .filter((entry): entry is { quantity: number; date: Date } => Boolean(entry.date))

  return Array.from({ length: days }).map((_, index) => {
    const pointDate = new Date()
    pointDate.setHours(0, 0, 0, 0)
    pointDate.setDate(pointDate.getDate() - ((days - 1) - index))

    const endOfDay = new Date(pointDate)
    endOfDay.setHours(23, 59, 59, 999)

    const hasTransactionHistory = relevantTransactions.length > 0
    const netChangeAfterDay = hasTransactionHistory
      ? relevantTransactions
          .filter((entry) => entry.date.getTime() > endOfDay.getTime())
          .reduce((sum, entry) => sum + (entry.type === 'IN' ? entry.quantity : -entry.quantity), 0)
      : relevantBatches
          .filter((entry) => entry.date.getTime() > endOfDay.getTime())
          .reduce((sum, entry) => sum + entry.quantity, 0)

    const estimatedUsedAtDay = Math.max(0, usedUnits - netChangeAfterDay)
    const utilization = totalCapacity > 0
      ? Math.min(100, Number(((estimatedUsedAtDay / totalCapacity) * 100).toFixed(1)))
      : 0

    return {
      day: pointDate.toLocaleDateString('en-US', { weekday: 'short' }),
      utilization,
    }
  })
}

export function buildSkuVelocityData(items: any[]) {
  return items
    .map((item, index) => {
      const available = getInventoryAvailableQty(item)
      const reserved = getInventoryReservedQty(item)
      const threshold = getInventoryThreshold(item)
      const pressure = Math.max(0, threshold - available)
      return {
        id: String(item?.id || `${item?.product?.sku || 'sku'}-${index}`),
        name: formatReportProductName(item?.product, String(item?.product?.sku || 'Item')),
        sku: String(item?.product?.sku || 'N/A'),
        velocity: reserved + pressure,
      }
    })
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 10)
}

function isWarehouseDashboardOrder(order: any) {
  const orderNumber = String(order?.orderNumber || order?.order_number || '').trim().toUpperCase()
  const status = String(order?.status || '').trim().toUpperCase()
  return !Boolean(order?.isScheduledReplacement) &&
    !orderNumber.startsWith('RPL-') &&
    status !== 'CANCELLED'
}

export function summarizeWarehouseDashboardOrders(orders: any[]): WarehouseOrderStats {
  // Fix: the total is a historical order count, so cancelled orders still belong in it.
  // Operational delivery counts continue to use active/non-cancelled orders below.
  const historicalOrders = orders.filter((order) => {
    const orderNumber = String(order?.orderNumber || order?.order_number || '').trim().toUpperCase()
    const purchaseOrderStage = String(order?.purchaseOrderStage || order?.purchase_order_stage || '').trim()
    const purchaseOrderNumber = String(order?.purchaseOrderNumber || order?.purchase_order_number || '').trim()
    return !Boolean(order?.isScheduledReplacement) &&
      !orderNumber.startsWith('RPL-') &&
      Boolean(purchaseOrderStage) &&
      Boolean(purchaseOrderNumber)
  })
  const scopedOrders = historicalOrders.filter(isWarehouseDashboardOrder)
  return {
    totalOrders: historicalOrders.length,
    outForDelivery: scopedOrders.filter((order) => {
      const status = String(order?.status || '').toUpperCase()
      return status === 'OUT_FOR_DELIVERY' || status === 'IN_TRANSIT'
    }).length,
    delivered: scopedOrders.filter((order) => String(order?.status || '').toUpperCase() === 'DELIVERED').length,
  }
}

export function buildWeeklyOrderTrendData(orders: any[], now = new Date()) {
  const thisWeekCount = new Map<string, number>()
  const lastWeekCount = new Map<string, number>()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const last7Days = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(today)
    date.setDate(date.getDate() - (6 - index))
    return {
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      key: dayKey(date),
    }
  })

  for (const order of orders.filter(isWarehouseDashboardOrder)) {
    const orderDate = toDate(order?.createdAt)
    if (!orderDate) continue
    orderDate.setHours(0, 0, 0, 0)
    const dayDiff = Math.floor((today.getTime() - orderDate.getTime()) / 86400000)

    if (dayDiff >= 0 && dayDiff <= 6) {
      const key = dayKey(orderDate)
      thisWeekCount.set(key, (thisWeekCount.get(key) || 0) + 1)
    } else if (dayDiff >= 7 && dayDiff <= 13) {
      const mappedDate = new Date(orderDate)
      mappedDate.setDate(mappedDate.getDate() + 7)
      const mappedKey = dayKey(mappedDate)
      lastWeekCount.set(mappedKey, (lastWeekCount.get(mappedKey) || 0) + 1)
    }
  }

  return last7Days.map((day) => ({
    day: day.label,
    thisWeek: thisWeekCount.get(day.key) || 0,
    lastWeek: lastWeekCount.get(day.key) || 0,
  }))
}

// Normalize many backend order states into the three report buckets the UI is built around.
export function normalizeOrderReportStatus(status: unknown): OrderReportStatus {
  const rawStatus = String(status || '').trim().toUpperCase()
  if (!rawStatus) return 'PENDING'

  if ([
    'DELIVERED',
    'COMPLETED',
    'FULFILLED',
    'ARRIVED',
  ].includes(rawStatus)) {
    return 'DELIVERED'
  }

  if ([
    'CANCELLED',
    'CANCELED',
    'REJECTED',
    'FAILED',
    'FAILED_DELIVERY',
    'SKIPPED',
  ].includes(rawStatus)) {
    return 'CANCELLED'
  }

  return 'PENDING'
}

export function formatOrderReportStatus(status: OrderReportStatus) {
  if (status === 'DELIVERED') return 'Delivered'
  if (status === 'CANCELLED') return 'Cancelled'
  return 'Pending'
}

/**
 * The one revenue rule for every report: money counts once the goods reached
 * the customer.
 *
 * The tabs used to disagree. The Orders tab counted delivered orders only,
 * while Top Clients, Transactions and Retail Sales counted everything that was
 * not cancelled - so the same four orders in the same period read as P1,000 on
 * one card and P9,000 on another, both labelled "Revenue". Retail Sales applied
 * no status rule at all, so voided counter sales were counted as income.
 *
 * Reads the status off whichever field the caller's rows carry: plain orders use
 * `status`, purchase-order rows use `stage`, retail rows use `retailStatus`.
 */
export function isRevenueRecognized(row: any): boolean {
  const status = row?.status ?? row?.stage ?? row?.retailStatus
  return normalizeOrderReportStatus(status) === 'DELIVERED'
}

/** Sum of a revenue-bearing amount over rows, applying the shared rule above. */
export function sumRecognizedRevenue(rows: any[], getAmount: (row: any) => unknown): number {
  return (Array.isArray(rows) ? rows : []).reduce(
    (sum, row) => (isRevenueRecognized(row) ? sum + Math.max(0, asNumber(getAmount(row))) : sum),
    0,
  )
}

// ==== New vs returning customers ====

export type CustomerMixSummary = {
  newCustomers: number
  returningCustomers: number
  totalCustomers: number
  newRevenue: number
  returningRevenue: number
  totalRevenue: number
  /** Share of buying customers in the window, 0-100. */
  newCustomerShare: number
  returningCustomerShare: number
  /** Share of window revenue, 0-100. */
  newRevenueShare: number
  returningRevenueShare: number
}

const EMPTY_CUSTOMER_MIX: CustomerMixSummary = {
  newCustomers: 0,
  returningCustomers: 0,
  totalCustomers: 0,
  newRevenue: 0,
  returningRevenue: 0,
  totalRevenue: 0,
  newCustomerShare: 0,
  returningCustomerShare: 0,
  newRevenueShare: 0,
  returningRevenueShare: 0,
}

/**
 * Splits the customers who bought inside a window into first-time and returning,
 * and splits the window's revenue the same way.
 *
 * A customer's cohort is decided by their first delivered order across ALL
 * history, not just the selected window. Deciding it from the window alone would
 * relabel every long-standing client as "new" whenever the range is short, which
 * is the trap that makes retention charts read backwards.
 *
 * `allOrders` must therefore be the unfiltered order list; the window is applied
 * here. Only revenue-recognized orders count, matching `isRevenueRecognized`.
 */
export function summarizeCustomerMix(
  allOrders: any[],
  options: {
    windowStart?: Date | null
    windowEnd?: Date | null
    getCustomerKey?: (order: any) => string
    getAmount?: (order: any) => unknown
  } = {},
): CustomerMixSummary {
  const orders = Array.isArray(allOrders) ? allOrders : []
  const getCustomerKey =
    options.getCustomerKey ||
    ((order: any) =>
      String(
        order?.customer?.id ||
          order?.customerId ||
          order?.customer_id ||
          String(order?.customer?.email || order?.customerEmail || '').toLowerCase() ||
          order?.customer?.name ||
          order?.shippingName ||
          '',
      ).trim())
  const getAmount = options.getAmount || ((order: any) => order?.totalAmount ?? order?.subtotal)

  // The date a purchase actually completed is what places a customer in time.
  const purchaseDate = (order: any) => toDate(order?.deliveredAt) || toDate(order?.timeline?.deliveredAt) || toDate(order?.createdAt)

  const firstPurchaseAt = new Map<string, number>()
  for (const order of orders) {
    if (!isRevenueRecognized(order)) continue
    const key = getCustomerKey(order)
    if (!key) continue
    const when = purchaseDate(order)
    if (!when) continue
    const time = when.getTime()
    const existing = firstPurchaseAt.get(key)
    if (existing === undefined || time < existing) firstPurchaseAt.set(key, time)
  }

  if (firstPurchaseAt.size === 0) return { ...EMPTY_CUSTOMER_MIX }

  const startMs = options.windowStart ? options.windowStart.getTime() : Number.NEGATIVE_INFINITY
  const endMs = options.windowEnd ? options.windowEnd.getTime() : Number.POSITIVE_INFINITY

  const newKeys = new Set<string>()
  const returningKeys = new Set<string>()
  let newRevenue = 0
  let returningRevenue = 0

  for (const order of orders) {
    if (!isRevenueRecognized(order)) continue
    const key = getCustomerKey(order)
    if (!key) continue
    const when = purchaseDate(order)
    if (!when) continue
    const time = when.getTime()
    if (time < startMs || time > endMs) continue

    const amount = Math.max(0, asNumber(getAmount(order)))
    // Their first ever purchase landing inside this window is what makes them new.
    const isNew = (firstPurchaseAt.get(key) ?? time) >= startMs
    if (isNew) {
      newKeys.add(key)
      newRevenue += amount
    } else {
      returningKeys.add(key)
      returningRevenue += amount
    }
  }

  const newCustomers = newKeys.size
  const returningCustomers = returningKeys.size
  const totalCustomers = newCustomers + returningCustomers
  const totalRevenue = newRevenue + returningRevenue
  const share = (part: number, whole: number) => (whole > 0 ? roundRate((part / whole) * 100) : 0)

  return {
    newCustomers,
    returningCustomers,
    totalCustomers,
    newRevenue,
    returningRevenue,
    totalRevenue,
    newCustomerShare: share(newCustomers, totalCustomers),
    returningCustomerShare: share(returningCustomers, totalCustomers),
    newRevenueShare: share(newRevenue, totalRevenue),
    returningRevenueShare: share(returningRevenue, totalRevenue),
  }
}

// Build a short readable item line so the report table can stay dense without hiding order content.
export function summarizeOrderItems(items: any[]) {
  const normalizedItems = Array.isArray(items) ? items : []
  const names = normalizedItems
    .map((item) => {
      if (item?.itemType === 'MIXED_CASE') {
        const components = (item?.components || [])
          .map((component: any) => `${component.productName || 'Product'} ${Math.max(0, asNumber(component.quantityPerCase))}/case`)
          .join(', ')
        return `Mixed Case (${Math.max(0, asNumber(item?.caseCapacity))} units${components ? `: ${components}` : ''})`
      }
      // Order items sometimes carry the size on the line item instead of the nested product object.
      const productSource = item?.product ? { ...item, ...item.product } : item
      return formatReportProductName(
        productSource,
        String(item?.productName ?? item?.name ?? item?.product?.sku ?? '').trim()
      )
    })
    .filter(Boolean)

  if (names.length === 0) return 'No items recorded'
  if (names.length <= 2) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`
}

// Keep replacement orders out of the main order report because the system already has a dedicated replacements report.
function isPrimaryOrderForReporting(order: any) {
  const orderNumber = String(order?.orderNumber || order?.order_number || '').trim().toUpperCase()
  return !Boolean(order?.isScheduledReplacement) && !orderNumber.startsWith('RPL-')
}

export function buildOrderReportRows(
  orders: any[],
  options: {
    rangeStart: Date
    selectedWarehouse?: string
    selectedOrderStatus?: string
    getWarehouseIdFromRow: (row: any) => string
  }
): OrderReportRow[] {
  const selectedWarehouse = options.selectedWarehouse || 'all'
  const selectedOrderStatus = String(options.selectedOrderStatus || 'all').toUpperCase()

  return orders
    .filter((order) => isPrimaryOrderForReporting(order))
    .filter((order) => {
      const createdAt = toDate(order?.createdAt)
      return Boolean(createdAt && createdAt.getTime() >= options.rangeStart.getTime())
    })
    .filter((order) => selectedWarehouse === 'all' || options.getWarehouseIdFromRow(order) === selectedWarehouse)
    .map((order) => {
      const normalizedReportStatus = normalizeOrderReportStatus(order?.status)
      const createdAt = order?.createdAt
      const orderDate = toDate(createdAt)
      const totalQuantity = Array.isArray(order?.items)
        ? order.items.reduce((sum: number, item: any) => sum + Math.max(0, asNumber(item?.quantity)), 0)
        : 0

      return {
        orderNumber: String(order?.orderNumber || order?.order_number || 'N/A'),
        customer: String(order?.customer?.name || order?.shippingName || 'N/A'),
        itemSummary: summarizeOrderItems(order?.items),
        productNameWithSize: formatReportProductName(
          Array.isArray(order?.items) && order.items.length > 0
            ? (order.items[0]?.itemType === 'MIXED_CASE'
                ? { name: `Mixed Case (${Math.max(0, asNumber(order.items[0]?.caseCapacity))} units)` }
                : (order.items[0]?.product ? { ...order.items[0], ...order.items[0].product } : order.items[0]))
            : null,
          'N/A'
        ),
        productCategory: String(
          (Array.isArray(order?.items) && order.items.length > 0
            ? (order.items[0]?.itemType === 'MIXED_CASE' ? 'Mixed Case' : (order.items[0]?.product?.category ?? order.items[0]?.category))
            : '') || ''
        ).trim() || 'Uncategorized',
        totalQuantity,
        status: String(order?.status || ''),
        normalizedReportStatus,
        amount: Math.max(0, asNumber(order?.totalAmount)),
        createdAt,
        deliveredAt: order?.timeline?.deliveredAt || order?.deliveredAt,
        orderDateLabel: orderDate ? orderDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
      }
    })
    .filter((row) => selectedOrderStatus === 'ALL' || row.normalizedReportStatus === selectedOrderStatus)
}

export function buildOrderReportStatusOptions(rows: OrderReportRow[]) {
  return Array.from(new Set(rows.map((row) => row.normalizedReportStatus))).sort()
}

// This summary drives the cards, footer strip, and export totals so they always match.
export function summarizeOrderReportRows(rows: OrderReportRow[]): OrderReportSummary {
  return rows.reduce<OrderReportSummary>((acc, row) => {
    acc.totalOrders += 1
    acc.totalQuantity += Math.max(0, asNumber(row.totalQuantity))
    if (row.normalizedReportStatus === 'DELIVERED') {
      acc.deliveredOrders += 1
      // Revenue is counted only after successful delivery so cancelled/pending orders do not inflate the report.
      acc.totalRevenue += Math.max(0, asNumber(row.amount))
    }
    if (row.normalizedReportStatus === 'PENDING') acc.pendingOrders += 1
    if (row.normalizedReportStatus === 'CANCELLED') acc.cancelledOrders += 1
    return acc
  }, {
    totalOrders: 0,
    deliveredOrders: 0,
    pendingOrders: 0,
    cancelledOrders: 0,
    totalRevenue: 0,
    totalQuantity: 0,
  })
}

export function buildOrderReportStatusBreakdown(rows: OrderReportRow[]) {
  const summary = summarizeOrderReportRows(rows)
  const total = Math.max(1, summary.totalOrders)
  return [
    { key: 'DELIVERED', name: 'Delivered', value: summary.deliveredOrders, percentage: (summary.deliveredOrders / total) * 100, color: '#16a34a' },
    { key: 'PENDING', name: 'Pending', value: summary.pendingOrders, percentage: (summary.pendingOrders / total) * 100, color: '#f59e0b' },
    { key: 'CANCELLED', name: 'Cancelled', value: summary.cancelledOrders, percentage: (summary.cancelledOrders / total) * 100, color: '#ef4444' },
  ]
}

// The order report uses daily bars for short and medium ranges, then weekly bars for 90-day views to avoid unreadable charts.
export function buildOrderReportVolumeChart(
  rows: OrderReportRow[],
  options: {
    rangeDays: string
    rangeStart: Date
    now?: Date
  }
) {
  const grouped = new Map<string, { key: string; label: string; sortDate: Date; orders: number }>()
  const granularity: 'day' | 'week' = options.rangeDays === '90' ? 'week' : 'day'

  rows.forEach((row) => {
    const date = toDate(row.createdAt)
    if (!date) return
    const meta = getBucketMeta(date, granularity)
    const current = grouped.get(meta.key) || { ...meta, orders: 0 }
    current.orders += 1
    grouped.set(meta.key, current)
  })

  const start = new Date(options.rangeStart)
  const end = new Date(options.now || new Date())
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)

  const points: Array<{ key: string; label: string; sortDate: Date; orders: number }> = []

  if (granularity === 'day') {
    const cursor = new Date(start)
    while (cursor.getTime() <= end.getTime()) {
      const meta = getBucketMeta(cursor, granularity)
      points.push(grouped.get(meta.key) || { ...meta, orders: 0 })
      cursor.setDate(cursor.getDate() + 1)
    }
    return points
  }

  const cursor = new Date(start)
  const startDiff = (cursor.getDay() + 6) % 7
  cursor.setDate(cursor.getDate() - startDiff)
  cursor.setHours(0, 0, 0, 0)
  while (cursor.getTime() <= end.getTime()) {
    const meta = getBucketMeta(cursor, granularity)
    points.push(grouped.get(meta.key) || { ...meta, orders: 0 })
    cursor.setDate(cursor.getDate() + 7)
  }
  return points
}

export function normalizeTripStatusForMetrics(status: unknown) {
  const value = String(status || '').toUpperCase()
  if (value === 'IN_TRANSIT' || value === 'OUT_FOR_DELIVERY') return 'IN_PROGRESS'
  return value
}

export function isActiveTripStatusForMetrics(status: unknown) {
  const normalized = normalizeTripStatusForMetrics(status)
  // Fix: planned trips have not started and must not inflate Active Trips.
  return normalized === 'IN_PROGRESS'
}

export function countActiveTrips(trips: any[]) {
  return trips.filter((trip) => isActiveTripStatusForMetrics(trip?.status)).length
}

export function buildInventoryMovementRows(
  inventoryTransactions: any[],
  options: {
    rangeStart: Date
    selectedWarehouse?: string
    selectedMovementType?: string
    getWarehouseIdFromRow: (row: any) => string
  }
): InventoryMovementRow[] {
  const selectedWarehouse = options.selectedWarehouse || 'all'
  const selectedMovementType = String(options.selectedMovementType || 'all').toUpperCase()

  return inventoryTransactions
    .filter((transaction) => {
      const createdAt = toDate(transaction?.createdAt)
      return Boolean(createdAt && createdAt.getTime() >= options.rangeStart.getTime())
    })
    .filter((transaction) => selectedWarehouse === 'all' || options.getWarehouseIdFromRow(transaction) === selectedWarehouse)
    .filter((transaction) => INVENTORY_MOVEMENT_TYPES.has(String(transaction?.type || '').toUpperCase()))
    .filter((transaction) => selectedMovementType === 'ALL' || String(transaction?.type || '').toUpperCase() === selectedMovementType)
    .map((transaction) => ({
      createdAt: transaction?.createdAt,
      warehouse: String(transaction?.warehouse?.name || 'N/A'),
      product: formatReportProductName(transaction?.product, 'N/A'),
      type: (String(transaction?.type || '').toUpperCase() === 'RETURN' ? 'IN' : String(transaction?.type || '').toUpperCase()) as 'IN' | 'OUT',
      sourceType: String(transaction?.type || '').toUpperCase() as 'IN' | 'OUT' | 'RETURN',
      quantity: Math.max(0, asNumber(transaction?.baseUnitQuantity ?? transaction?.quantity)),
      quantityUnit: 'BASE_UNIT' as const,
    }))
}

export function buildInventoryMovementTypeOptions(
  inventoryTransactions: any[],
  options: {
    rangeStart: Date
    selectedWarehouse?: string
    getWarehouseIdFromRow: (row: any) => string
  }
) {
  const selectedWarehouse = options.selectedWarehouse || 'all'
  return Array.from(
    new Set(
      inventoryTransactions
        .filter((transaction) => {
          const createdAt = toDate(transaction?.createdAt)
          return Boolean(createdAt && createdAt.getTime() >= options.rangeStart.getTime())
        })
        .filter((transaction) => selectedWarehouse === 'all' || options.getWarehouseIdFromRow(transaction) === selectedWarehouse)
        .map((transaction) => String(transaction?.type || '').toUpperCase())
        .filter((type) => INVENTORY_MOVEMENT_TYPES.has(type))
    )
  )
    .filter(Boolean)
    .sort()
}

export function summarizeInventoryMovementRows(rows: InventoryMovementRow[]): InventoryMovementSummary {
  return rows.reduce<InventoryMovementSummary>((acc, row) => {
    acc.totalMovements += 1
    if (row.type === 'IN') acc.stockIn += Math.max(0, asNumber(row.quantity))
    if (row.type === 'OUT') acc.stockOut += Math.max(0, asNumber(row.quantity))
    return acc
  }, { totalMovements: 0, stockIn: 0, stockOut: 0 })
}

export function buildInventoryMovementChart(
  rows: InventoryMovementRow[],
  options: {
    rangeDays: string
    rangeStart: Date
    now?: Date
  }
): InventoryMovementPoint[] {
  const grouped = new Map<string, InventoryMovementPoint>()
  const granularity = getRangeGranularity(options.rangeDays)

  rows.forEach((row) => {
    const date = toDate(row.createdAt)
    if (!date) return

    const { key, label, sortDate } = getBucketMeta(date, granularity)
    const current = grouped.get(key) || { key, label, sortDate, inQty: 0, outQty: 0 }
    if (row.type === 'IN') current.inQty += Math.max(0, asNumber(row.quantity))
    if (row.type === 'OUT') current.outQty += Math.max(0, asNumber(row.quantity))
    grouped.set(key, current)
  })

  const start = new Date(options.rangeStart)
  const end = new Date(options.now || new Date())
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)

  const points: InventoryMovementPoint[] = []

  if (granularity === 'day') {
    const cursor = new Date(start)
    while (cursor.getTime() <= end.getTime()) {
      const meta = getBucketMeta(cursor, granularity)
      points.push(grouped.get(meta.key) || { ...meta, inQty: 0, outQty: 0 })
      cursor.setDate(cursor.getDate() + 1)
    }
    return points
  }

  if (granularity === 'week') {
    const cursor = new Date(start)
    const startDiff = (cursor.getDay() + 6) % 7
    cursor.setDate(cursor.getDate() - startDiff)
    cursor.setHours(0, 0, 0, 0)
    while (cursor.getTime() <= end.getTime()) {
      const meta = getBucketMeta(cursor, granularity)
      points.push(grouped.get(meta.key) || { ...meta, inQty: 0, outQty: 0 })
      cursor.setDate(cursor.getDate() + 7)
    }
    return points
  }

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cursor.getTime() <= endMonth.getTime()) {
    const meta = getBucketMeta(cursor, granularity)
    points.push(grouped.get(meta.key) || { ...meta, inQty: 0, outQty: 0 })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return points
}

export function summarizeInventoryMovementTrend(points: InventoryMovementPoint[]) {
  const totalIn = points.reduce((sum, point) => sum + Math.max(0, asNumber(point.inQty)), 0)
  const totalOut = points.reduce((sum, point) => sum + Math.max(0, asNumber(point.outQty)), 0)
  const splitIndex = Math.floor(points.length / 2)
  const previous = points.slice(0, splitIndex)
  const current = points.slice(splitIndex)
  const prevIn = previous.reduce((sum, point) => sum + Math.max(0, asNumber(point.inQty)), 0)
  const currIn = current.reduce((sum, point) => sum + Math.max(0, asNumber(point.inQty)), 0)
  const prevOut = previous.reduce((sum, point) => sum + Math.max(0, asNumber(point.outQty)), 0)
  const currOut = current.reduce((sum, point) => sum + Math.max(0, asNumber(point.outQty)), 0)

  return {
    totalIn,
    totalOut,
    inChangePercent: prevIn > 0 ? ((currIn - prevIn) / prevIn) * 100 : (currIn > 0 ? 100 : 0),
    outChangePercent: prevOut > 0 ? ((currOut - prevOut) / prevOut) * 100 : (currOut > 0 ? 100 : 0),
  }
}

export function buildWarehouseCapacityVsUsedChart(
  warehouses: any[],
  inventory: any[],
  options: {
    selectedWarehouse?: string
    getWarehouseIdFromRow: (row: any) => string
  }
) {
  const selectedWarehouse = options.selectedWarehouse || 'all'
  return warehouses
    .filter((warehouse) => selectedWarehouse === 'all' || String(warehouse?.id || '') === selectedWarehouse)
    .map((warehouse) => {
      const warehouseId = String(warehouse?.id || '')
      const inventoryItems = inventory.filter((item) => options.getWarehouseIdFromRow(item) === warehouseId)
      const capacitySummary = buildWarehouseCapacitySummary(warehouse, inventoryItems)
      return {
        name: String(warehouse?.code || warehouse?.name || warehouseId || 'Warehouse'),
        capacityPercent: 100,
        usedPercent: capacitySummary.usagePercent,
        usedUnits: capacitySummary.usedUnits,
        totalCapacity: capacitySummary.totalCapacity,
      }
    })
}

// ==== Client feedback ====
//
// The admin feedback summary used to report an average rating and little else, which
// cannot say WHY clients scored a delivery the way they did. Every rating also carries
// the checkbox reasons the client ticked, stored as a bullet list in `message`, and
// those reasons map onto fixed service dimensions. These helpers turn that stored text
// back into structure so the summary can name the weak dimension, rank recurring
// complaints, and compare a period against the one before it.

export type FeedbackPolarity = 'positive' | 'neutral' | 'negative' | 'unrated'

/** A date range. `null` on either side means unbounded. */
export type FeedbackDateWindow = {
  start: Date | null
  end: Date | null
}

export type FeedbackReasonHit = {
  reason: string
  canonicalReason: string
  /** The strongest dimension, used wherever a single label is needed. */
  dimension: FeedbackServiceDimension
  /** Every dimension the text covers - free text often spans more than one. */
  dimensions: FeedbackServiceDimension[]
  dimensionLabel: string
  /** True for an exact catalog hit; false when the keyword fallback resolved it. */
  matched: boolean
  polarity: FeedbackPolarity
  rating: number
}

export type FeedbackRow = {
  id: string
  createdAt: unknown
  createdAtDate: Date | null
  customerName: string
  customerAvatar: string
  orderId: string
  orderNumber: string
  isReplacement: boolean
  rating: number
  polarity: FeedbackPolarity
  type: string
  subject: string
  message: string
  reasons: FeedbackReasonHit[]
  dimensions: FeedbackServiceDimension[]
}

export type FeedbackKpiSummary = {
  total: number
  ratedCount: number
  avgRating: number
  positiveCount: number
  neutralCount: number
  negativeCount: number
  positiveRate: number
  neutralRate: number
  negativeRate: number
  /** Reviews the client described in their own words instead of ticking a phrase. */
  describedCount: number
}

export type FeedbackKpiComparison = {
  current: FeedbackKpiSummary
  previous: FeedbackKpiSummary
  hasPreviousPeriod: boolean
  totalDelta: number
  avgRatingDelta: number
  positiveRateDelta: number
  neutralRateDelta: number
  negativeRateDelta: number
}

export type FeedbackDimensionRow = {
  dimension: FeedbackServiceDimension
  label: string
  /** Feedback rows citing this dimension at least once. */
  mentions: number
  /** Raw reason hits, which can exceed `mentions` when one review ticks two phrases. */
  reasonCount: number
  positive: number
  neutral: number
  negative: number
  avgRating: number
  negativeRate: number
  coverage: number
  hasSignal: boolean
}

export type FeedbackTopIssueRow = {
  rank: number
  reason: string
  dimension: FeedbackServiceDimension
  dimensionLabel: string
  count: number
  share: number
  avgRating: number
  lastSeenAt: unknown
}

export type FeedbackTrendPoint = {
  key: string
  label: string
  sortDate: Date
  avgScore: number | null
  responses: number
}

export type FeedbackAttentionRow = {
  id: string
  createdAt: unknown
  ageDays: number
  ageLabel: string
  customerName: string
  customerAvatar: string
  orderNumber: string
  isReplacement: boolean
  rating: number
  reasons: string[]
  dimensions: FeedbackServiceDimension[]
  /** What the client typed, when they described the issue instead of ticking a phrase. */
  describedText: string
}

export type FeedbackDeltaDisplay = {
  text: string
  direction: 'up' | 'down' | 'flat'
  tone: 'good' | 'bad' | 'neutral'
}

const roundRate = (value: number) => Math.round(value * 10) / 10

/** Split a stored bullet list back into individual reasons, preserving order. */
export function parseFeedbackReasons(message: unknown): string[] {
  const raw = String(message ?? '')
  if (!raw.trim()) return []
  const seen = new Set<string>()
  const reasons: string[] = []
  // A legacy free-text message with no newlines yields a single entry rather than
  // being dropped, so no feedback disappears from the counts.
  for (const line of raw.split(/\r?\n/)) {
    const normalized = normalizeFeedbackReasonText(line)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    reasons.push(normalized)
  }
  return reasons
}

/**
 * Polarity comes from the parent star rating rather than the phrase wording. Every
 * catalog phrase sits under exactly one star, so this is lossless for known phrases
 * and still works for legacy text - and it cannot be fooled by "Issue was resolved"
 * against "Issue was not resolved".
 */
export function getFeedbackPolarity(rating: unknown): FeedbackPolarity {
  const value = Math.round(asNumber(rating))
  if (value >= 4 && value <= 5) return 'positive'
  if (value === 3) return 'neutral'
  if (value >= 1 && value <= 2) return 'negative'
  return 'unrated'
}

export function classifyFeedbackReason(reason: unknown, rating?: unknown): FeedbackReasonHit {
  const text = normalizeFeedbackReasonText(reason)
  const entry = lookupFeedbackReason(text)
  // An "Other: ..." reason is the client's own words. Classify the words, not the marker.
  const described = stripOtherReasonPrefix(text)
  const dimensions = entry ? [entry.dimension] : inferFeedbackDimensions(described)
  const dimension = entry ? entry.dimension : (dimensions[0] || inferFeedbackDimension(described))
  const ratingValue = Math.round(asNumber(rating))
  // Fall back to the star the phrase sits under when the caller has no rating.
  const effectiveRating = ratingValue >= 1 && ratingValue <= 5
    ? ratingValue
    : (entry ? entry.catalogRating : 0)
  return {
    reason: text,
    canonicalReason: entry ? entry.reason : text,
    dimension,
    dimensions,
    dimensionLabel: FEEDBACK_DIMENSION_LABELS[dimension],
    matched: Boolean(entry),
    polarity: getFeedbackPolarity(effectiveRating),
    rating: effectiveRating,
  }
}

/**
 * Normalize the raw /api/feedback payload once. Deliberately window-independent so the
 * parse stays out of the filter-dependent memos in the admin view.
 */
export function buildFeedbackRows(feedback: any[], options: { orders?: any[] } = {}): FeedbackRow[] {
  const orders = Array.isArray(options.orders) ? options.orders : []
  const orderNumberById = new Map<string, string>()
  orders.forEach((order) => {
    const id = String(order?.id || '').trim()
    const number = String(order?.orderNumber || '').trim()
    if (id && number) orderNumberById.set(id, number)
  })

  return (Array.isArray(feedback) ? feedback : []).map((item) => {
    const orderId = String(item?.orderId || item?.order_id || item?.order?.id || '').trim()
    const orderNumber = String(
      item?.order?.orderNumber || item?.orderNumber || orderNumberById.get(orderId) || ''
    ).trim()
    const rating = Math.round(asNumber(item?.rating))
    const message = String(item?.message ?? '')
    const reasons = parseFeedbackReasons(message).map((reason) => classifyFeedbackReason(reason, rating))
    const dimensions = FEEDBACK_SERVICE_DIMENSIONS.filter((dimension) =>
      reasons.some((hit) => hit.dimensions.includes(dimension))
    )
    return {
      id: String(item?.id || ''),
      createdAt: item?.createdAt ?? item?.created_at ?? null,
      createdAtDate: toDate(item?.createdAt ?? item?.created_at),
      customerName: String(item?.customer?.name || 'Customer'),
      customerAvatar: String(item?.customer?.avatar || ''),
      orderId,
      orderNumber,
      isReplacement: orderNumber.toUpperCase().startsWith('RPL-'),
      rating: rating >= 1 && rating <= 5 ? rating : 0,
      polarity: getFeedbackPolarity(rating),
      type: String(item?.type || ''),
      subject: String(item?.subject || ''),
      message,
      reasons,
      dimensions: [...dimensions],
    }
  })
}

export function filterFeedbackRowsByWindow(
  rows: FeedbackRow[],
  window?: FeedbackDateWindow | null
): FeedbackRow[] {
  if (!window || (!window.start && !window.end)) return rows
  const startMs = window.start ? window.start.getTime() : Number.NEGATIVE_INFINITY
  const endMs = window.end ? window.end.getTime() : Number.POSITIVE_INFINITY
  return rows.filter((row) => {
    if (!row.createdAtDate) return false
    const time = row.createdAtDate.getTime()
    return time >= startMs && time <= endMs
  })
}

/**
 * The equally long period immediately before `window`. Returns null for an unbounded
 * window, which is what drives `hasPreviousPeriod: false` - the UI then shows
 * "No prior period" rather than a meaningless +0.
 */
export function buildFeedbackComparisonWindow(
  window: FeedbackDateWindow,
  now: Date = new Date()
): FeedbackDateWindow | null {
  if (!window?.start) return null
  const end = window.end || now
  const durationMs = end.getTime() - window.start.getTime()
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null
  return {
    start: new Date(window.start.getTime() - durationMs - 1),
    end: new Date(window.start.getTime() - 1),
  }
}

/**
 * The single definition of every feedback KPI. The admin cards previously mixed two
 * row sets - a total over all feedback beside percentages over delivered-order
 * feedback only - so the numbers contradicted each other.
 */
export function summarizeFeedbackKpis(rows: FeedbackRow[]): FeedbackKpiSummary {
  const total = rows.length
  const rated = rows.filter((row) => row.rating >= 1 && row.rating <= 5)
  const ratedCount = rated.length
  const positiveCount = rated.filter((row) => row.polarity === 'positive').length
  const neutralCount = rated.filter((row) => row.polarity === 'neutral').length
  const negativeCount = rated.filter((row) => row.polarity === 'negative').length
  const describedCount = rows.filter((row) => row.reasons.some((hit) => !hit.matched)).length
  const avgRating = ratedCount > 0
    ? rated.reduce((sum, row) => sum + row.rating, 0) / ratedCount
    : 0
  const rate = (count: number) => (ratedCount > 0 ? roundRate((count / ratedCount) * 100) : 0)
  return {
    total,
    ratedCount,
    avgRating: Math.round(avgRating * 100) / 100,
    positiveCount,
    neutralCount,
    negativeCount,
    positiveRate: rate(positiveCount),
    neutralRate: rate(neutralCount),
    negativeRate: rate(negativeCount),
    describedCount,
  }
}

export function compareFeedbackKpis(
  currentRows: FeedbackRow[],
  previousRows: FeedbackRow[] | null
): FeedbackKpiComparison {
  const current = summarizeFeedbackKpis(currentRows)
  const previous = summarizeFeedbackKpis(previousRows || [])
  const hasPreviousPeriod = Array.isArray(previousRows)
  return {
    current,
    previous,
    hasPreviousPeriod,
    totalDelta: current.total - previous.total,
    avgRatingDelta: Math.round((current.avgRating - previous.avgRating) * 100) / 100,
    positiveRateDelta: roundRate(current.positiveRate - previous.positiveRate),
    neutralRateDelta: roundRate(current.neutralRate - previous.neutralRate),
    negativeRateDelta: roundRate(current.negativeRate - previous.negativeRate),
  }
}

export function describeFeedbackDelta(
  delta: number,
  options: { unit?: 'rating' | 'percent' | 'count'; higherIsBetter?: boolean } = {}
): FeedbackDeltaDisplay {
  const unit = options.unit || 'count'
  const higherIsBetter = options.higherIsBetter !== false
  const value = Number.isFinite(delta) ? delta : 0
  const direction: FeedbackDeltaDisplay['direction'] = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  const magnitude = Math.abs(value)
  const text = unit === 'rating'
    ? `${sign}${magnitude.toFixed(1)}`
    : unit === 'percent'
      ? `${sign}${Math.round(magnitude)} pts`
      : `${sign}${Math.round(magnitude)}`
  // Tone is semantic, not directional: a falling negative rate is good news.
  const tone: FeedbackDeltaDisplay['tone'] = direction === 'flat'
    ? 'neutral'
    : (value > 0) === higherIsBetter ? 'good' : 'bad'
  return { text, direction, tone }
}

export function buildFeedbackRatingDistribution(rows: FeedbackRow[]) {
  const rated = rows.filter((row) => row.rating >= 1 && row.rating <= 5)
  return [5, 4, 3, 2, 1].map((rating) => {
    const value = rated.filter((row) => row.rating === rating).length
    return {
      rating,
      label: `${rating} Star${rating > 1 ? 's' : ''}`,
      value,
      share: rated.length > 0 ? roundRate((value / rated.length) * 100) : 0,
    }
  })
}

/**
 * Always returns every dimension in canonical order, so the chart keeps a stable shape
 * and a dimension nobody mentioned can render as "no data" rather than as a full
 * positive bar - which matters because the Expo delivery catalog offers no timeliness
 * option at all.
 */
export function buildFeedbackDimensionBreakdown(rows: FeedbackRow[]): FeedbackDimensionRow[] {
  const total = rows.length
  return FEEDBACK_SERVICE_DIMENSIONS.map((dimension) => {
    const mentioningRows = rows.filter((row) => row.dimensions.includes(dimension))
    const hits = rows.flatMap((row) => row.reasons.filter((hit) => hit.dimensions.includes(dimension)))
    const positive = mentioningRows.filter((row) => row.polarity === 'positive').length
    const neutral = mentioningRows.filter((row) => row.polarity === 'neutral').length
    const negative = mentioningRows.filter((row) => row.polarity === 'negative').length
    const ratedMentions = mentioningRows.filter((row) => row.rating >= 1 && row.rating <= 5)
    const avgRating = ratedMentions.length > 0
      ? Math.round((ratedMentions.reduce((sum, row) => sum + row.rating, 0) / ratedMentions.length) * 100) / 100
      : 0
    return {
      dimension,
      label: FEEDBACK_DIMENSION_LABELS[dimension],
      mentions: mentioningRows.length,
      reasonCount: hits.length,
      positive,
      neutral,
      negative,
      avgRating,
      negativeRate: mentioningRows.length > 0 ? roundRate((negative / mentioningRows.length) * 100) : 0,
      coverage: total > 0 ? roundRate((mentioningRows.length / total) * 100) : 0,
      hasSignal: mentioningRows.length > 0,
    }
  })
}

export function buildFeedbackTopIssues(
  rows: FeedbackRow[],
  options: { limit?: number } = {}
): FeedbackTopIssueRow[] {
  const limit = options.limit ?? 5
  const grouped = new Map<string, {
    reason: string
    dimension: FeedbackServiceDimension
    count: number
    ratingSum: number
    ratingCount: number
    lastSeenAt: unknown
    lastSeenMs: number
  }>()

  rows.forEach((row) => {
    row.reasons
      .filter((hit) => hit.polarity === 'negative' && hit.matched)
      .forEach((hit) => {
        const key = hit.canonicalReason.toLowerCase()
        const current = grouped.get(key) || {
          reason: hit.canonicalReason,
          dimension: hit.dimension,
          count: 0,
          ratingSum: 0,
          ratingCount: 0,
          lastSeenAt: row.createdAt,
          lastSeenMs: Number.NEGATIVE_INFINITY,
        }
        current.count += 1
        if (row.rating >= 1 && row.rating <= 5) {
          current.ratingSum += row.rating
          current.ratingCount += 1
        }
        const seenMs = row.createdAtDate ? row.createdAtDate.getTime() : Number.NEGATIVE_INFINITY
        if (seenMs > current.lastSeenMs) {
          current.lastSeenMs = seenMs
          current.lastSeenAt = row.createdAt
        }
        grouped.set(key, current)
      })
  })

  const totalHits = Array.from(grouped.values()).reduce((sum, entry) => sum + entry.count, 0)

  return Array.from(grouped.values())
    .map((entry) => ({
      reason: entry.reason,
      dimension: entry.dimension,
      dimensionLabel: FEEDBACK_DIMENSION_LABELS[entry.dimension],
      count: entry.count,
      share: totalHits > 0 ? roundRate((entry.count / totalHits) * 100) : 0,
      avgRating: entry.ratingCount > 0
        ? Math.round((entry.ratingSum / entry.ratingCount) * 100) / 100
        : 0,
      lastSeenAt: entry.lastSeenAt,
    }))
    // Deterministic ordering: most frequent, then worst rated, then alphabetical.
    .sort((a, b) => (b.count - a.count) || (a.avgRating - b.avgRating) || a.reason.localeCompare(b.reason))
    .slice(0, limit)
    .map((entry, index) => ({ rank: index + 1, ...entry }))
}

/**
 * Trailing months only. The previous implementation centred the window on the current
 * month, so half the chart was always-empty future months.
 */
export function buildFeedbackSatisfactionTrend(
  rows: FeedbackRow[],
  options: { months?: number; now?: Date } = {}
): FeedbackTrendPoint[] {
  const months = Math.max(1, options.months ?? 6)
  const now = options.now || new Date()
  const anchor = new Date(now.getFullYear(), now.getMonth(), 1)

  return Array.from({ length: months }).map((_, index) => {
    const date = new Date(anchor.getFullYear(), anchor.getMonth() - (months - 1) + index, 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const monthRatings = rows
      .filter((row) => {
        if (!row.createdAtDate || row.rating < 1 || row.rating > 5) return false
        return row.createdAtDate.getFullYear() === date.getFullYear()
          && row.createdAtDate.getMonth() === date.getMonth()
      })
      .map((row) => row.rating)
    return {
      key,
      label: date.toLocaleString('en-US', { month: 'short' }),
      sortDate: date,
      avgScore: monthRatings.length > 0
        ? Math.round((monthRatings.reduce((sum, value) => sum + value, 0) / monthRatings.length) * 100) / 100
        : null,
      responses: monthRatings.length,
    }
  })
}

export function buildFeedbackAttentionQueue(
  rows: FeedbackRow[],
  options: { limit?: number; maxRating?: number; now?: Date } = {}
): FeedbackAttentionRow[] {
  const limit = options.limit ?? 8
  const maxRating = options.maxRating ?? 2
  const now = options.now || new Date()

  return rows
    .filter((row) => row.rating >= 1 && row.rating <= maxRating)
    .slice()
    .sort((a, b) => {
      const aMs = a.createdAtDate ? a.createdAtDate.getTime() : Number.NEGATIVE_INFINITY
      const bMs = b.createdAtDate ? b.createdAtDate.getTime() : Number.NEGATIVE_INFINITY
      return bMs - aMs
    })
    .slice(0, limit)
    .map((row) => {
      const ageDays = row.createdAtDate
        ? Math.max(0, Math.floor((now.getTime() - row.createdAtDate.getTime()) / 86400000))
        : 0
      const ageLabel = !row.createdAtDate
        ? 'Unknown date'
        : ageDays === 0
          ? 'Today'
          : ageDays === 1
            ? 'Yesterday'
            : ageDays < 7
              ? `${ageDays}d ago`
              : ageDays < 30
                ? `${Math.floor(ageDays / 7)}w ago`
                : `${Math.floor(ageDays / 30)}mo ago`
      return {
        id: row.id,
        createdAt: row.createdAt,
        ageDays,
        ageLabel,
        customerName: row.customerName,
        customerAvatar: row.customerAvatar,
        orderNumber: row.orderNumber,
        isReplacement: row.isReplacement,
        rating: row.rating,
        // Free text appears in the quote block below the chips, so it is not repeated here.
        reasons: row.reasons.filter((hit) => hit.polarity === 'negative' && hit.matched).map((hit) => hit.canonicalReason),
        dimensions: row.dimensions,
        describedText: row.reasons
          .filter((hit) => !hit.matched)
          .map((hit) => stripOtherReasonPrefix(hit.reason))
          .join(' '),
      }
    })
}

/**
 * Participation keeps a delivered-order denominator - it is the only KPI that should
 * have one - and honours the same window so a 30-day view is not divided by every
 * delivered order ever recorded.
 */
export function summarizeFeedbackParticipation(
  rows: FeedbackRow[],
  orders: any[],
  options: { window?: FeedbackDateWindow | null } = {}
) {
  const window = options.window
  const bounded = Boolean(window && (window.start || window.end))
  const startMs = window?.start ? window.start.getTime() : Number.NEGATIVE_INFINITY
  const endMs = window?.end ? window.end.getTime() : Number.POSITIVE_INFINITY

  const deliveredIds = new Set<string>()
  const orderList = Array.isArray(orders) ? orders : []
  orderList.forEach((order) => {
    const status = String(order?.status || '').toUpperCase()
    const deliveryStatus = String(order?.deliveryStatus || '').toUpperCase()
    if (status !== 'DELIVERED' && deliveryStatus !== 'DELIVERED') return
    const id = String(order?.id || '').trim()
    if (!id) return
    if (bounded) {
      const when = toDate(order?.deliveredAt) || toDate(order?.createdAt)
      if (!when) return
      const time = when.getTime()
      if (time < startMs || time > endMs) return
    }
    deliveredIds.add(id)
  })

  const reviewedIds = new Set(
    rows.map((row) => row.orderId).filter((id) => id && deliveredIds.has(id))
  )

  return {
    deliveredOrders: deliveredIds.size,
    reviewedOrders: reviewedIds.size,
    participationRate: deliveredIds.size > 0
      ? Math.round((reviewedIds.size / deliveredIds.size) * 100)
      : 0,
  }
}

// ==== Daily chart series ====

/**
 * Turns a day-keyed bucket map into a left-to-right time series.
 *
 * Two report charts used to `return Object.values(map).slice(-14)`. Object key
 * order is insertion order, and insertion followed the table's sort control, so
 * the Transactions and Logistics trends were drawn newest-to-oldest whenever the
 * table was on "Newest First" - a rising line appeared to climb into the past -
 * and `slice(-14)` then kept the OLDEST fourteen days rather than the latest.
 * The chart's direction must not depend on a sort dropdown.
 *
 * Days with no activity are filled in rather than dropped, so the horizontal
 * spacing represents real elapsed time instead of closing the gaps.
 *
 * `byDay` keys must be `YYYY-MM-DD` (see `formatDayKey`), which sort correctly
 * as plain strings.
 */
export function buildDailyChartSeries<T>(
  byDay: Record<string, T>,
  options: { days?: number; fillEmpty: (dateKey: string) => T },
): T[] {
  const keys = Object.keys(byDay).sort()
  if (keys.length === 0) return []

  const toDayKey = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const parseKey = (key: string) => {
    const [year, month, day] = key.split('-').map(Number)
    return new Date(year, (month || 1) - 1, day || 1)
  }

  const filled: T[] = []
  const cursor = parseKey(keys[0])
  const last = parseKey(keys[keys.length - 1])
  // A runaway range would allocate forever, so cap the walk at four years.
  for (let guard = 0; cursor.getTime() <= last.getTime() && guard < 1500; guard += 1) {
    const key = toDayKey(cursor)
    filled.push(byDay[key] ?? options.fillEmpty(key))
    cursor.setDate(cursor.getDate() + 1)
  }

  const days = options.days
  return days && days > 0 ? filled.slice(-days) : filled
}
