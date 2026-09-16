import { useMemo } from 'react'
import { type ChartConfig } from '@/components/ui/chart'
import { formatDayKey } from '../../warehouse-portal-utils'
import {
  buildInventoryStatusBreakdown,
  buildSkuVelocityData,
  buildUtilizationTrend,
  buildWarehouseCapacitySummary,
  buildWeeklyOrderTrendData,
  countActiveTrips,
  summarizeStockHealth,
  summarizeWarehouseDashboardOrders,
} from '@/lib/report-metrics'
import type {
  InventoryItem,
  InventoryTransactionItem,
  StockBatchItem,
  WarehouseItem,
  WarehouseOrderItem,
  WarehouseReplacementItem,
  WarehouseTripItem,
} from '../../warehouse-portal-types'

/**
 * Dashboard KPIs, replacement summary, stock health and weekly trend series derived from the warehouse's scoped collections.
 */
export type WarehouseDashboardStatsInputs = {
  assignedWarehouse: WarehouseItem | null
  replacements: WarehouseReplacementItem[]
  scopedInventory: InventoryItem[]
  scopedInventoryTransactions: InventoryTransactionItem[]
  scopedOrders: WarehouseOrderItem[]
  scopedTrips: WarehouseTripItem[]
  stockBatches: StockBatchItem[]
  warehouseMatches: (warehouseId?: string | null, warehouseName?: string | null, warehouseCode?: string | null) => boolean
}

export function useWarehouseDashboardStats(inputs: WarehouseDashboardStatsInputs) {
  const {
    assignedWarehouse,
    replacements,
    scopedInventory,
    scopedInventoryTransactions,
    scopedOrders,
    scopedTrips,
    stockBatches,
    warehouseMatches,
  } = inputs

  const scopedReplacements = useMemo(() => replacements, [replacements])

  const replacementSummary = useMemo(() => {
    const parseMeta = (notes: string | null | undefined) => {
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
        return {}
      }
    }

    let replacedQty = 0
    let replacedBottleQty = 0
    let replacedCaseQty = 0
    let resolvedOnDelivery = 0
    let needsFollowUp = 0
    let rejected = 0

    const getReplacementLinesForKpi = (entry: any, meta: any) =>
      (Array.isArray((entry as any)?.replacementLines) && (entry as any).replacementLines.length ? (entry as any).replacementLines : null) ||
      (Array.isArray((meta as any)?.replacementLines) && (meta as any).replacementLines.length ? (meta as any).replacementLines : null) ||
      (Array.isArray((entry as any)?.replacementItems) && (entry as any).replacementItems.length ? (entry as any).replacementItems : null) ||
      (Array.isArray((meta as any)?.replacementItems) && (meta as any).replacementItems.length ? (meta as any).replacementItems : null) ||
      []

    const getBottleReplacedQtyForKpi = (entry: any, meta: any): number => {
      const replacementLines = getReplacementLinesForKpi(entry, meta)
      const firstLine = replacementLines[0] || {}
      const lineBottleQty = Number(
        firstLine?.replacedBottles ??
        firstLine?.quantityReplacedBottles ??
        firstLine?.replacementBottles
      )
      if (Number.isFinite(lineBottleQty) && lineBottleQty > 0) return lineBottleQty

      const topBottleQty = Number(
        (entry as any)?.replacementBottles ??
        (meta as any)?.replacementBottles ??
        (entry as any)?.replacedBottles ??
        (meta as any)?.replacedBottles ??
        0
      )
      if (Number.isFinite(topBottleQty) && topBottleQty > 0) return topBottleQty

      // Fallback: text-based bottle classification when structural bottle qty is absent.
      const contextText = `${String((entry as any)?.reason || '')} ${String((entry as any)?.description || '')} ${String((entry as any)?.notes || '')}`.toLowerCase()
      const hasBottleText = /\bbottle(?:s)?\b/.test(contextText)
      const hasUnitEvidence = Number(
        firstLine?.replacedCases ??
        firstLine?.quantityReplacedCases ??
        firstLine?.replacementCases ??
        (entry as any)?.replacementCases ??
        (meta as any)?.replacementCases ??
        (entry as any)?.quantityReplacedCases ??
        (meta as any)?.quantityReplacedCases ??
        0
      ) > 0
      if (!hasBottleText || hasUnitEvidence) return 0

      return getCanonicalReplacedQtyForKpi(entry, meta)
    }

    const getCanonicalReplacedQtyForKpi = (entry: any, meta: any): number => {
      const qty = Number(
        (entry as any)?.replacementQuantity ??
        (meta as any)?.replacementQuantity ??
        (entry as any)?.quantityReplaced ??
        (meta as any)?.quantityReplaced ??
        0
      )
      return Number.isFinite(qty) && qty > 0 ? qty : 0
    }

    const getUnitReplacedQtyForKpi = (entry: any, meta: any): number => {
      const replacementLines = getReplacementLinesForKpi(entry, meta)
      const firstLine = replacementLines[0] || {}
      const directUnitQty = Number(
        firstLine?.replacedCases ??
        firstLine?.quantityReplacedCases ??
        firstLine?.replacementCases ??
        (entry as any)?.replacementCases ??
        (meta as any)?.replacementCases ??
        (entry as any)?.quantityReplacedCases ??
        (meta as any)?.quantityReplacedCases ??
        0
      )
      if (Number.isFinite(directUnitQty) && directUnitQty > 0) return directUnitQty

      const qtyPerCase = Number(
        firstLine?.quantityPerCase ??
        firstLine?.qtyPerUnit ??
        firstLine?.quantityPerUnit ??
        (entry as any)?.quantityPerCase ??
        (meta as any)?.quantityPerCase ??
        (entry as any)?.qtyPerUnit ??
        (meta as any)?.qtyPerUnit ??
        0
      )
      const canonicalQty = getCanonicalReplacedQtyForKpi(entry, meta)
      if (Number.isFinite(qtyPerCase) && qtyPerCase > 0 && canonicalQty > 0) {
        const units = canonicalQty / qtyPerCase
        return Number.isFinite(units) && units > 0 ? units : 0
      }
      // Keep unit KPI strict: no raw-quantity fallback, to avoid bottle leakage.
      return 0
    }

    for (const entry of scopedReplacements) {
      const meta = parseMeta(entry?.notes)
      const rawStatus = String(entry?.status || '').toUpperCase()
      const mode = String((entry as any)?.replacementMode || meta?.replacementMode || '').toUpperCase()
      const status =
        rawStatus === 'REQUESTED'
          ? 'REPORTED'
          : ['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)
            ? 'IN_PROGRESS'
            : rawStatus === 'REJECTED'
              ? 'REJECTED'
              : rawStatus === 'PROCESSED'
                ? 'COMPLETED'
                : rawStatus
      if (status === 'RESOLVED_ON_DELIVERY' || status === 'COMPLETED') {
        const replacementLines = getReplacementLinesForKpi(entry, meta)
        const firstLine = replacementLines[0] || {}
        const bottleQty = getBottleReplacedQtyForKpi(entry, meta)
        const lineReplacedUnits = Number(
          firstLine?.replacedCases ??
          firstLine?.quantityReplacedCases ??
          firstLine?.replacementCases
        )
        const fallbackQty = Number(
          (entry as any)?.quantityReplaced ??
          (meta as any)?.quantityReplaced ??
          (entry as any)?.replacementQuantity ??
          (meta as any)?.replacementQuantity ??
          0
        )
        const canonicalQty = getCanonicalReplacedQtyForKpi(entry, meta)
        const unitQty = getUnitReplacedQtyForKpi(entry, meta)
        const qty = unitQty > 0
          ? unitQty
          : Number.isFinite(fallbackQty) && fallbackQty > 0
            ? fallbackQty
            : Number.isFinite(lineReplacedUnits) && lineReplacedUnits > 0
              ? lineReplacedUnits
              : 0
        if (bottleQty <= 0 && qty > 0) {
          replacedQty += qty
        }

        if (bottleQty > 0) {
          replacedBottleQty += bottleQty
        } else {
          const caseQty = Number.isFinite(lineReplacedUnits) && lineReplacedUnits > 0
            ? lineReplacedUnits
            : (unitQty > 0 ? unitQty : (canonicalQty > 0 ? canonicalQty : (Number.isFinite(fallbackQty) && fallbackQty > 0 ? fallbackQty : 0)))
          if (caseQty > 0) replacedCaseQty += caseQty
        }
      }
      if (status === 'RESOLVED_ON_DELIVERY') {
        resolvedOnDelivery += 1
      }
      if (status === 'NEEDS_FOLLOW_UP' && mode !== 'CUSTOMER_SUBMITTED') {
        needsFollowUp += 1
      }
      if (status === 'REJECTED') {
        rejected += 1
      }
    }

    return {
      replacedQty,
      replacedBottleQty,
      replacedCaseQty,
      resolvedOnDelivery,
      needsFollowUp,
      rejected,
      totalCases: scopedReplacements.length,
    }
  }, [scopedReplacements])

  const stockHealthSummary = useMemo(() => summarizeStockHealth(scopedInventory), [scopedInventory])

  const lowStockCount = useMemo(() => stockHealthSummary.belowThreshold, [stockHealthSummary])

  const activeTripCount = useMemo(() => countActiveTrips(scopedTrips), [scopedTrips])

  const dashboardOrderStats = useMemo(() => summarizeWarehouseDashboardOrders(scopedOrders), [scopedOrders])

  const inventoryStatusBreakdown = useMemo(() => buildInventoryStatusBreakdown(scopedInventory), [scopedInventory])

  const last7Days = useMemo(() => {
    return Array.from({ length: 7 }).map((_, index) => {
      const date = new Date()
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - (6 - index))
      return {
        label: date.toLocaleDateString('en-US', { weekday: 'short' }),
        key: formatDayKey(date),
        date,
      }
    })
  }, [])

  const weeklyTrendData = useMemo(() => buildWeeklyOrderTrendData(scopedOrders), [scopedOrders])

  const warehouseOverviewStats = useMemo(() => {
    if (!assignedWarehouse) return null

    const scopedBatches = stockBatches.filter((batch) =>
      warehouseMatches(batch?.inventory?.warehouse?.id, batch?.inventory?.warehouse?.name, batch?.inventory?.warehouse?.code)
    )
    const capacitySummary = buildWarehouseCapacitySummary(assignedWarehouse, scopedInventory)
    const lowStockItems = stockHealthSummary.belowThreshold
    const pendingOrders = scopedOrders.filter((order) =>
      ['PENDING', 'CONFIRMED', 'PREPARING', 'RESCHEDULED'].includes(String(order.status || '').toUpperCase())
    ).length
    const inTransitTrips = activeTripCount
    const openReplacements = scopedReplacements.filter((entry) => {
      const raw = String(entry.status || '').toUpperCase()
      const normalized = raw === 'PROCESSED' ? 'COMPLETED' : raw
      return !['RESOLVED_ON_DELIVERY', 'COMPLETED', 'REJECTED'].includes(normalized)
    }).length
    const skuVelocityData = buildSkuVelocityData(scopedInventory)
    const stockHealthDistribution = [
      { name: 'Healthy', value: stockHealthSummary.healthy, color: '#10b981' },
      { name: 'Low', value: stockHealthSummary.low, color: '#f59e0b' },
      { name: 'Critical', value: stockHealthSummary.critical + stockHealthSummary.outOfStock, color: '#ef4444' },
      { name: 'Overstocked', value: stockHealthSummary.overstocked, color: '#3b82f6' },
    ]
    const utilizationTrend = buildUtilizationTrend(
      capacitySummary.usedUnits,
      capacitySummary.totalCapacity,
      scopedBatches,
      scopedInventoryTransactions,
    )

    const latestBatch = scopedBatches
      .sort((a, b) => new Date(b.receiptDate).getTime() - new Date(a.receiptDate).getTime())[0]

    const activities = [
      {
        id: 'capacity',
        label: 'Capacity update',
        detail: `${capacitySummary.usedUnits.toLocaleString()} units stored out of ${capacitySummary.totalCapacity.toLocaleString()} (${capacitySummary.usagePercent}% total usage)`,
      },
      {
        id: 'stock',
        label: 'Stock health',
        detail: lowStockItems > 0 ? `${lowStockItems} item(s) need restocking` : 'All inventory is above threshold',
      },
      {
        id: 'orders',
        label: 'Order workload',
        detail: pendingOrders > 0 ? `${pendingOrders} pending order(s) waiting for handling` : 'No pending orders right now',
      },
      {
        id: 'trips',
        label: 'Dispatch activity',
        detail: inTransitTrips > 0 ? `${inTransitTrips} trip(s) currently active` : 'No active outbound trips',
      },
      {
        id: 'replacements',
        label: 'Replacement desk',
        detail: openReplacements > 0 ? `${openReplacements} replacement case(s) in progress` : 'No open replacement cases',
      },
      {
        id: 'latest-batch',
        label: 'Latest stock-in',
        detail: latestBatch
          ? `${latestBatch.batchNumber} manufactured (${new Date(latestBatch.receiptDate).toLocaleDateString()})`
          : 'No recent stock-in record found',
      },
    ]

    const recentActivities = [
      {
        id: 'r1',
        title: 'Capacity updated',
        detail: `${capacitySummary.usagePercent}% utilization (${capacitySummary.usedUnits.toLocaleString()} units stored).`,
        time: '2 mins ago',
      },
      {
        id: 'r2',
        title: pendingOrders > 0 ? 'Order queue increased' : 'Order queue stable',
        detail: pendingOrders > 0 ? `${pendingOrders} pending order(s) awaiting processing` : 'No pending orders in queue',
        time: '18 mins ago',
      },
      {
        id: 'r3',
        title: inTransitTrips > 0 ? 'Outbound dispatch running' : 'No active dispatch',
        detail: inTransitTrips > 0 ? `${inTransitTrips} active trip(s) in progress` : 'Dispatch board is currently idle',
        time: '42 mins ago',
      },
      {
        id: 'r4',
        title: lowStockItems > 0 ? 'Low stock alert' : 'Stock level healthy',
        detail: lowStockItems > 0 ? `${lowStockItems} SKU(s) are at or below threshold` : 'All tracked SKUs are above threshold',
        time: '1 hr ago',
      },
    ]

    return {
      totalCapacity: capacitySummary.totalCapacity,
      usedCapacity: capacitySummary.usedUnits,
      availableCapacity: capacitySummary.availableCapacity,
      usagePercent: capacitySummary.usagePercent,
      utilizationStatus: capacitySummary.utilizationStatus,
      stockItemsCount: scopedInventory.length,
      lowStockItems,
      pendingOrders,
      inTransitTrips,
      openReplacements,
      capacityBreakdown: capacitySummary.capacityBreakdown,
      skuVelocityData,
      stockHealthDistribution,
      activities,
      utilizationTrend,
      recentActivities,
    }
  }, [activeTripCount, assignedWarehouse, scopedInventory, scopedInventoryTransactions, scopedOrders, scopedReplacements, stockBatches, stockHealthSummary, warehouseMatches])

  const tripStatusColors: Record<string, string> = {
    PLANNED: 'bg-blue-100 text-blue-800',
    IN_PROGRESS: 'bg-green-100 text-green-800',
    COMPLETED: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-800',
  }

  const warehouseOrdersChartConfig = {
    thisWeek: { label: 'This Week', color: '#3b82f6' },
    lastWeek: { label: 'Last Week', color: '#1d4ed8' },
  } satisfies ChartConfig

  return {
    activeTripCount,
    dashboardOrderStats,
    inventoryStatusBreakdown,
    lowStockCount,
    replacementSummary,
    scopedReplacements,
    tripStatusColors,
    warehouseOrdersChartConfig,
    warehouseOverviewStats,
    weeklyTrendData,
  }
}
