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
import { summarizeReplacementCases } from '@/components/portals/shared/replacement-summary'
import { isTripOverdue } from '@/lib/trip-schedule'
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

  const replacementSummary = useMemo(() => summarizeReplacementCases(scopedReplacements), [scopedReplacements])

  const stockHealthSummary = useMemo(() => summarizeStockHealth(scopedInventory), [scopedInventory])

  const lowStockCount = useMemo(() => stockHealthSummary.belowThreshold, [stockHealthSummary])

  const activeTripCount = useMemo(() => countActiveTrips(scopedTrips), [scopedTrips])
  // Planned trips whose day passed; they cannot start until the warehouse reschedules them.
  const overdueTripCount = useMemo(() => scopedTrips.filter((trip) => isTripOverdue(trip)).length, [scopedTrips])

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
      ['PENDING', 'APPROVED', 'PREPARING', 'RESCHEDULED'].includes(String(order.status || '').toUpperCase())
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
      capacitySummary.stockUnits,
      capacitySummary.totalCapacity,
      scopedBatches,
      scopedInventoryTransactions,
      { inventoryItems: scopedInventory },
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
      emptyCapacity: capacitySummary.emptyUnits,
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
    overdueTripCount,
    replacementSummary,
    scopedReplacements,
    tripStatusColors,
    warehouseOrdersChartConfig,
    warehouseOverviewStats,
    weeklyTrendData,
  }
}
