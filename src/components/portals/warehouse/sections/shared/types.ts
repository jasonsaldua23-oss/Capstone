import type { ComponentType } from 'react'
import type { ChartConfig } from '@/components/ui/chart'
import type { InventoryStatusBreakdown, WarehouseOrderStats } from '@/lib/report-metrics'

export type WarehouseDashboardViewProps = {
  assignedWarehouse: any
  scopedInventory: any[]
  scopedOrders: any[]
  dashboardOrderStats: WarehouseOrderStats
  inventoryStatusBreakdown: InventoryStatusBreakdown
  lowStockCount: number
  activeTripCount: number
  pendingReplacementCases: number
  totalReplacementCases: number
  warehouseOrdersChartConfig: ChartConfig
  weeklyTrendData: any[]
  transactionDateFrom: string
  setTransactionDateFrom: (value: string) => void
  transactionDatePreset: string
  setTransactionDatePreset: (value: string) => void
  transactionTypeFilter: string
  setTransactionTypeFilter: (value: string) => void
  availableInventoryTransactionTypes: string[]
  loadingInventoryTransactions: boolean
  filteredInventoryTransactions: any[]
}

export type WarehouseInventoryViewProps = {
  openAddStockDialog: () => void
  loadingInventory: boolean
  scopedInventory: any[]
  getStockStatus: (item: any) => string
  getAvailableQty: (item: any) => number
  formatPeso: (value: number) => string
  openEditDialog: (item: any) => void
}

export type WarehousePurchaseRequestsViewProps = {
  loadingOrders: boolean
  purchaseRequests: any[]
  formatPeso: (value: number) => string
  openOrderDetail: (order: any) => Promise<void>
  updateWarehouseOrderStatus: (
    orderId: string,
    status: 'CONFIRMED' | 'REJECTED' | 'CANCELLED',
    reason?: string
  ) => Promise<boolean | void>
}

export type WarehouseOrdersViewProps = {
  loadingOrders: boolean
  purchaseOrders: any[]
  formatPeso: (value: number) => string
  openOrderDetail: (order: any) => Promise<void>
  updateWarehouseOrderStatus: (
    orderId: string,
    status: 'PREPARING' | 'FOR_DELIVERY' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED',
    reason?: string
  ) => Promise<void>
  updatingOrderId: string | null
  onOpenTransportation: () => void
}

export type WarehouseReplacementSummary = {
  totalCases: number
  resolvedOnDelivery: number
  needsFollowUp: number
  rejected: number
  replacedQty: number
  replacedBottleQty: number
  replacedCaseQty: number
}

export type WarehouseReplacementsViewProps = {
  replacementSummary: WarehouseReplacementSummary
  loadingReplacements: boolean
  scopedReplacements: any[]
  parseIssueMeta: (notes?: string | null) => any
  formatIssueStatus: (ret: any) => string
  updateIssueStatus: (
    replacementId: string,
    status: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'NEEDS_FOLLOW_UP',
    options?: { notes?: string; createReplacementOrder?: boolean; replacementDeliveryDate?: string; manualScheduleConfirmed?: boolean }
  ) => Promise<void>
  updatingReplacementId: string | null
  selectedReplacement: any | null
  setSelectedReplacement: (value: any | null) => void
  buildReplacementLines: (replacement: any, meta: any) => any[]
  receiveReplacementReturn: (
    replacementId: string,
    returnedLines: Array<{ replacementLineId: string; quantityBaseUnits: number }>
  ) => Promise<void>
}

export type WarehouseLiveTrackingViewProps = {
  trackingDate: string
  setTrackingDate: (value: string) => void
  fetchTripsData: () => Promise<void>
  fetchOrdersData: (options?: any) => Promise<void>
  loadingTrips: boolean
  loadingOrders: boolean
  LiveTrackingMap: ComponentType<any>
  liveTrackingLocations: any[]
  liveTrackingRouteLines: any[]
  liveTrackingCenter: [number, number]
  liveTrackingActiveTrips: any[]
  liveTrackingRecentLocations: any[]
}

export type WarehouseWarehousesViewProps = {
  loadingWarehouses: boolean
  assignedWarehouse: any
  warehouseOverviewStats: any
  getStockHealthDotClass: (name: string) => string
}

export type WarehouseStocksViewProps = {
  loadingBatches: boolean
  stockBatches: any[]
  getDaysLeft: (date: string | null) => number | null
  openBatchQuantityDialog: (batch: any) => void
}
