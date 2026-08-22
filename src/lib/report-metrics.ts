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
  const unitsPerCase = getInventoryUnitsPerCase(item)
  if (unitsPerCase <= 0) return getInventoryAvailableQty(item)
  const looseBaseUnits = Math.max(0, asNumber(
    item?.looseBaseUnits ?? item?.loose_base_units ?? item?.looseBottles ?? item?.loose_bottles
  ))
  const physicalBaseUnits = getInventoryQuantity(item) * unitsPerCase + looseBaseUnits
  return Math.max(0, physicalBaseUnits - getInventoryReservedBaseUnits(item))
}

export function getInventoryAvailableQty(item: any) {
  const availablePhysicalCases = Math.max(0, getInventoryQuantity(item) - getInventoryReservedQty(item))
  const unitsPerCase = getInventoryUnitsPerCase(item)
  if (unitsPerCase <= 0) return availablePhysicalCases
  return Math.min(
    availablePhysicalCases,
    Math.floor(getInventoryAvailableBaseUnits(item) / unitsPerCase)
  )
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
  const scopedOrders = orders.filter(isWarehouseDashboardOrder)
  return {
    totalOrders: scopedOrders.length,
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
  return normalized === 'PLANNED' || normalized === 'IN_PROGRESS'
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
