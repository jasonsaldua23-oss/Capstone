import type { ComponentType } from 'react'
import type { ChartConfig } from '@/components/ui/chart'

export type WarehouseDashboardViewProps = {
  assignedWarehouse: any
  scopedInventory: any[]
  lowStockCount: number
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

export type WarehouseOrdersViewProps = {
  loadingOrders: boolean
  scopedOrders: any[]
  orderStatusFilter: string
  setOrderStatusFilter: (value: string) => void
  orderStatusOptions: string[]
  orderDatePreset: string
  setOrderDatePreset: (value: string) => void
  orderCustomDateFilter: string
  setOrderCustomDateFilter: (value: string) => void
  orderMinPriceFilter: string
  setOrderMinPriceFilter: (value: string) => void
  orderMaxPriceFilter: string
  setOrderMaxPriceFilter: (value: string) => void
  filteredOrders: any[]
  formatPeso: (value: number) => string
  formatWarehouseOrderStatus: (status: any, paymentStatus?: any, warehouseStage?: any) => string
  openOrderDetail: (order: any) => Promise<void>
  updateWarehouseOrderStatus: (orderId: string, status: string) => void
  updatingOrderId: string | null
}

export type WarehouseReplacementSummary = {
  totalCases: number
  resolvedOnDelivery: number
  needsFollowUp: number
  replacedQty: number
}

export type WarehouseReplacementsViewProps = {
  replacementSummary: WarehouseReplacementSummary
  loadingReplacements: boolean
  scopedReplacements: any[]
  parseIssueMeta: (notes?: string | null) => any
  formatIssueStatus: (ret: any) => string
  updateIssueStatus: (replacementId: string, status: 'COMPLETED' | 'NEEDS_FOLLOW_UP', notes?: string) => Promise<void>
  updatingReplacementId: string | null
  selectedReplacement: any | null
  setSelectedReplacement: (value: any | null) => void
  buildReplacementLines: (replacement: any, meta: any) => Array<{
    originalProductName: string
    replacementProductName: string
    quantityToReplace: string
    quantityReplaced: string
  }>
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
}

