'use client'

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '@/app/page'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { WarehouseTripsSection } from './WarehouseTripsSection'
import { WarehouseProductForms } from './sections/inventory/product-forms'
import { TransportationView } from '../admin/sections/transportation-view'
import { WarehouseHeader } from './sections/layout/warehouse-header'
import { searchWarehouseRecords, type WarehouseSearchResult } from '@/lib/warehouse-search'
import { useWarehousePortalLayoutState, type PortalNotification, type WarehouseView } from './sections/layout/portal-state'
import { WarehouseDashboardView } from './sections/dashboard/dashboard-view'
import { WarehouseInventoryView } from './sections/inventory/inventory-view'
import { WarehouseLiveTrackingView } from './sections/live-tracking/live-tracking-view'
import { WarehouseOrdersView } from './sections/orders/orders-view'
import { WarehouseReplacementsView } from './sections/replacements/replacements-view'
import { WarehouseStocksView } from './sections/stocks/stocks-view'
import { WarehouseWarehousesView } from './sections/warehouses/warehouses-view'
import { WarehouseEmptyBottlesView } from './sections/inventory/empty-bottles-view'
import { WarehouseRetailPosView } from './sections/retail-pos/retail-pos-view'
import { WarehouseInventoryTransactionsView } from './sections/inventory/transactions-view'
import { WarehousePurchaseRequestsView } from './sections/purchase-requests/purchase-requests-view'
import { portalFont } from '../portal-font'
import { WarehouseSidebar } from './sections/layout/warehouse-sidebar'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { OtpVerificationPanel } from '@/components/shared/otp-verification-modal'
import { AvatarCropDialog } from '@/components/shared/avatar-crop-dialog'
import type {
  DriverLocationItem,
  DriverOption,
  InventoryItem,
  InventoryTransactionItem,
  ProductOption,
  RoutePlanCityGroup,
  SavedRouteDraft,
  StockBatchItem,
  TripEditorState,
  VehicleOption,
  WarehouseItem,
  WarehouseOrderItem,
  WarehouseReplacementItem,
  WarehouseTripItem,
} from './warehouse-portal-types'
import { formatDayKey, formatPeso, getDefaultRouteDate, getStockHealthDotClass } from './warehouse-portal-utils'
import {
  PORTAL_CACHE_TTL_MS,
  WAREHOUSE_INVENTORY_STOCK_CACHE_PREFIX,
  WAREHOUSE_ORDERS_CACHE_PREFIX,
  WAREHOUSE_ROUTE_PLAN_CACHE_PREFIX,
  WAREHOUSE_TRIPS_CACHE_PREFIX,
  invalidateInventoryStockCaches,
  isPortalCacheFresh,
  readPortalCache,
  removePortalCache,
  removePortalCachesByPrefix,
} from '@/lib/portal-data-cache'
import {
  Boxes,
  Archive,
  Package,
  PackageCheck,
  Truck,
  MapPin,
  Warehouse,
  AlertTriangle,
  Settings,
  Loader2,
  ClipboardList,
  Recycle,
  Store,
  ShoppingCart,
} from 'lucide-react'
import {
  getDaysLeft,
  getMaxOrderUpdatedAt,
  parseIssueMeta,
  deriveOrderFulfillmentSummaryImpl,
  formatAllocatedQtyLabelImpl,
  getWarehouseDisplayOrderStatusImpl,
  buildReplacementLinesImpl,
  getRouteReplacementProductsImpl,
  formatIssueStatusImpl,
} from './warehouse-order-helpers'
import { WarehouseEditBatchDialog } from './sections/stocks/edit-batch-dialog'
import { WarehouseRejectOrderDialog } from './sections/orders/reject-order-dialog'
import { WarehouseOrderDetailDialog } from './sections/orders/order-detail-dialog'
import { useWarehouseDashboardStats } from './sections/dashboard/use-warehouse-dashboard-stats'
import { useWarehouseLiveTracking } from './sections/live-tracking/use-warehouse-live-tracking'
import { useWarehouseProfileSettings } from './sections/settings/use-warehouse-profile-settings'
import { WarehouseSettingsView } from './sections/settings/warehouse-settings-view'
import { useWarehouseStockIn } from './sections/stocks/use-warehouse-stock-in'
import { WarehouseAddStockDialog } from './sections/stocks/add-stock-dialog'
import { useWarehouseRoutePlanning } from './sections/trips/use-warehouse-route-planning'
import { WarehouseCreateTripDialog } from './sections/trips/create-trip-dialog'
// Modularized: API response contracts are kept separate from the stateful portal shell.
import { WarehouseCreateRouteDialog } from './sections/trips/create-route-dialog'
import { useWarehousePortalData } from './use-warehouse-portal-data'
import { isPurchaseRequestDocument } from '@/lib/purchase-documents'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const navItems: { id: WarehouseView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Boxes },
  { id: 'retailPos', label: 'Retail', icon: Store },
  { id: 'purchaseRequests', label: 'Purchase Requests', icon: ShoppingCart },
  { id: 'orders', label: 'Purchase Orders', icon: PackageCheck },
  { id: 'trips', label: 'Transportation', icon: Truck },
  { id: 'replacements', label: 'Replacements', icon: AlertTriangle },
  { id: 'liveTracking', label: 'Live Tracking', icon: MapPin },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'transactions', label: 'Inventory Transactions', icon: ClipboardList },
  { id: 'warehouses', label: 'Warehouse', icon: Warehouse },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function WarehousePortal() {
  const { user, setUser, logout } = useAuth()
  const cacheOwnerId = String((user as any)?.userId || (user as any)?.id || 'warehouse-staff')
  const inventoryStockCacheKey = `${WAREHOUSE_INVENTORY_STOCK_CACHE_PREFIX}${cacheOwnerId}`
  const tripsCacheKey = `${WAREHOUSE_TRIPS_CACHE_PREFIX}${cacheOwnerId}`
  const ordersCacheKey = `${WAREHOUSE_ORDERS_CACHE_PREFIX}${cacheOwnerId}`
  const routePlanCachePrefix = `${WAREHOUSE_ROUTE_PLAN_CACHE_PREFIX}${cacheOwnerId}:`
  const {
    activeView,
    setActiveView,
    sidebarOpen,
    setSidebarOpen,
    notifications,
    notificationsLoading,
    unreadNotifications,
    handleNotificationsOpen,
    markAllNotificationsAsRead,
    clearAllNotifications,
    formatNotificationTime,
    handleLogout,
  } = useWarehousePortalLayoutState({ logout })
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [stockBatches, setStockBatches] = useState<StockBatchItem[]>([])
  const [inventoryTransactions, setInventoryTransactions] = useState<InventoryTransactionItem[]>([])
  const [orders, setOrders] = useState<WarehouseOrderItem[]>([])
  const [trips, setTrips] = useState<WarehouseTripItem[]>([])
  const [driverLocations, setDriverLocations] = useState<DriverLocationItem[]>([])
  const [replacements, setReplacements] = useState<WarehouseReplacementItem[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [driversLoadFailed, setDriversLoadFailed] = useState(false)
  const [driversLoading, setDriversLoading] = useState(true)
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [routePlans, setRoutePlans] = useState<RoutePlanCityGroup[]>([])
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteDraft[]>([])
  const [routeDate, setRouteDate] = useState(getDefaultRouteDate())
  const [routeWarehouseId, setRouteWarehouseId] = useState('')
  const [selectedRouteCity, setSelectedRouteCity] = useState('')
  const [selectedRouteOrderIds, setSelectedRouteOrderIds] = useState<string[]>([])
  const [selectedRouteDriverId, setSelectedRouteDriverId] = useState('')
  const [selectedSavedRouteId, setSelectedSavedRouteId] = useState('')
  const [selectedRouteVehicleId, setSelectedRouteVehicleId] = useState('')
  const [trackingDate, setTrackingDate] = useState(() => formatDayKey(new Date()))
  const [createRouteOpen, setCreateRouteOpen] = useState(false)
  const [createTripOpen, setCreateTripOpen] = useState(false)
  const [editingTripState, setEditingTripState] = useState<TripEditorState | null>(null)
  const [inventorySubView, setInventorySubView] = useState<'inventory' | 'stocks' | 'empties'>('inventory')
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [searchInventoryId, setSearchInventoryId] = useState('')
  const [loadingInventory, setLoadingInventory] = useState(true)
  const [loadingWarehouses, setLoadingWarehouses] = useState(true)
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [loadingInventoryTransactions, setLoadingInventoryTransactions] = useState(true)
  const [transactionTypeFilter, setTransactionTypeFilter] = useState('all')
  const [transactionDateFrom, setTransactionDateFrom] = useState('')
  const [transactionDateTo, setTransactionDateTo] = useState('')
  const [transactionDatePreset, setTransactionDatePreset] = useState('custom')
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')
  const [orderDatePreset, setOrderDatePreset] = useState('all')
  const [orderCustomDateFilter, setOrderCustomDateFilter] = useState('')
  const [orderMinPriceFilter, setOrderMinPriceFilter] = useState('')
  const [orderMaxPriceFilter, setOrderMaxPriceFilter] = useState('')
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [loadingTrips, setLoadingTrips] = useState(true)
  const [loadingReplacements, setLoadingReplacements] = useState(true)
  const [isInitialPortalLoading, setIsInitialPortalLoading] = useState(true)
  const [loadingRoutePlans, setLoadingRoutePlans] = useState(false)
  const [creatingTripFromRoute, setCreatingTripFromRoute] = useState(false)
  const [editingTripId, setEditingTripId] = useState<string | null>(null)
  const [routePlanMessage, setRoutePlanMessage] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(null)
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)
  const [updatingReplacementId, setUpdatingReplacementId] = useState<string | null>(null)
  const [selectedReplacement, setSelectedReplacement] = useState<WarehouseReplacementItem | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<WarehouseOrderItem | null>(null)
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false)
  const orderDetailRequestRef = useRef(0)
  const [selectedTrip, setSelectedTrip] = useState<WarehouseTripItem | null>(null)
  const [tripToDelete, setTripToDelete] = useState<WarehouseTripItem | null>(null)
  const [rejectOrder, setRejectOrder] = useState<WarehouseOrderItem | null>(null)
  const [selectedRejectReasons, setSelectedRejectReasons] = useState<string[]>([])
  const [otherRejectReason, setOtherRejectReason] = useState('')
  const [stockInWarehouseId, setStockInWarehouseId] = useState('')
  const {
    accountEmail,
    confirmPassword,
    isEditingProfile,
    isEmailChangeUnlocked,
    isEditingSecurity,
    isProfileEmailChanged,
    isSavingProfile,
    isSavingSecuritySettings,
    isSendingPasswordOtp,
    isSendingProfileOtp,
    isUpdatingPassword,
    loginAlertsEnabled,
    newPassword,
    normalizedProfileEmail,
    otpModalKind,
    passwordOtpSent,
    passwordOtpVerified,
    passwordRequirements,
    profileAvatarCrop,
    profileAvatarFile,
    profileAvatarInputRef,
    profileEmail,
    profileFirstName,
    profileLastName,
    profileMiddleName,
    profileNoMiddleName,
    profileName,
    profileOtpSent,
    profileOtpVerified,
    profilePhone,
    profileSuffix,
    requestOtp,
    saveCroppedAvatar,
    saveProfileSettings,
    saveSecuritySettings,
    setConfirmPassword,
    setIsEditingProfile,
    setIsEditingSecurity,
    setLoginAlertsEnabled,
    setNewPassword,
    setOtpModalKind,
    setProfileEmail,
    setProfileFirstName,
    setProfileLastName,
    setProfileMiddleName,
    setProfileNoMiddleName,
    setProfileOtp,
    setProfileOtpSent,
    setProfileOtpToken,
    setProfileOtpVerified,
    setProfilePhone,
    setProfileSuffix,
    setShowConfirmPassword,
    setShowNewPassword,
    setTwoFactorEnabled,
    showConfirmPassword,
    showNewPassword,
    twoFactorEnabled,
    updateProfilePassword,
    verifyOtp,
  } = useWarehouseProfileSettings({
    setUser,
    user,
  })
  useEffect(() => {
    if (!trackingDate) {
      setTrackingDate(formatDayKey(new Date()))
    }
  }, [trackingDate])

  const [warehouseLoadError, setWarehouseLoadError] = useState<string | null>(null)
  const latestOrderUpdatedAtRef = useRef<string>('')
  const orderDetailsLoadedRef = useRef(false)
  const isPollingOrderStatusesRef = useRef(false)
  const isRefreshingAllRef = useRef(false)
  const inventoryStockRefreshRef = useRef<Promise<void> | null>(null)
  const tripsRefreshRef = useRef<Promise<WarehouseTripItem[] | null> | null>(null)
  const inventoryStockCacheAtRef = useRef(0)
  const tripsCacheAtRef = useRef(0)
  const ordersCacheAtRef = useRef(0)
  const assignedWarehouseIdRef = useRef('')
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const openLogoutConfirm = () => setLogoutConfirmOpen(true)
  const hasAssignedWarehouse = warehouses.length > 0
  const hasWarehouseFetchFailure = !hasAssignedWarehouse && Boolean(warehouseLoadError)
  const assignedWarehouse = warehouses[0] || null
  const isWarehouseScopedUser =
    user?.type === 'staff' && ['WAREHOUSE', 'WAREHOUSE_STAFF', 'INVENTORY_MANAGER'].includes(String(user?.role || '').toUpperCase())
  const sidebarNavItems = navItems
  const activeSectionLabel = navItems.find((item) => item.id === activeView)?.label || 'Dashboard'
  // Stable identity so the derived-data hooks can list it as a dependency without
  // recomputing on every render.
  const warehouseMatches = useCallback((warehouseId?: string | null, warehouseName?: string | null, warehouseCode?: string | null) => {
    if (!assignedWarehouse) return true
    if (warehouseId && warehouseId === assignedWarehouse.id) return true
    if (warehouseCode && assignedWarehouse.code && warehouseCode.toLowerCase() === assignedWarehouse.code.toLowerCase()) return true
    if (warehouseName && assignedWarehouse.name && warehouseName.toLowerCase() === assignedWarehouse.name.toLowerCase()) return true
    return false
  }, [assignedWarehouse])

  useEffect(() => {
    if (createRouteOpen && warehouses.length > 0 && !editingTripState) {
      const effectiveWarehouseId = routeWarehouseId || warehouses[0].id
      const effectiveDate = routeDate || getDefaultRouteDate()
      if (!routeWarehouseId) setRouteWarehouseId(effectiveWarehouseId)
      if (!routeDate) setRouteDate(effectiveDate)
    }
  }, [createRouteOpen, warehouses, editingTripState, routeWarehouseId, routeDate])

  useEffect(() => {
    if (routePlans.length > 0 && selectedRouteCity === '') {
      const firstGroup = routePlans[0]
      if (firstGroup) {
        setSelectedRouteCity(firstGroup.city)
        setSelectedRouteOrderIds(editingTripState ? editingTripState.originalOrderIds : [])
      }
    }
  }, [routePlans, selectedRouteCity, editingTripState])

  const scopedTrips = useMemo(() => trips, [trips])

  useEffect(() => {
    if (!selectedTrip) return

    const refreshedSelectedTrip =
      scopedTrips.find((trip) => trip.id === selectedTrip.id) ||
      trips.find((trip) => trip.id === selectedTrip.id) ||
      null

    if (!refreshedSelectedTrip) {
      setSelectedTrip(null)
      return
    }

    if (refreshedSelectedTrip !== selectedTrip) {
      setSelectedTrip(refreshedSelectedTrip)
    }
  }, [selectedTrip, scopedTrips, trips])

  const scopedOrders = useMemo(() => {
    if (!assignedWarehouse) return orders
    const belongsToAssignedWarehouse = (item: any) => {
      const assignedId = String(assignedWarehouse.id || '').trim()
      if (!assignedId) return true

      const directId = String(item?.warehouseId || item?.warehouse_id || '').trim()
      if (directId && directId === assignedId) return true

      const idsFromArray = Array.isArray(item?.warehouseIds)
        ? item.warehouseIds.map((value: any) => String(value || '').trim()).filter(Boolean)
        : []
      if (idsFromArray.includes(assignedId)) return true

      const allocationIds = Array.isArray(item?.warehouseAllocations)
        ? item.warehouseAllocations
            .map((allocation: any) => String(allocation?.warehouseId || allocation?.warehouse_id || allocation?.warehouse?.id || '').trim())
            .filter(Boolean)
        : []
      if (allocationIds.includes(assignedId)) return true

      const fulfillmentIds = Array.isArray(item?.fulfillments)
        ? item.fulfillments
            .map((leg: any) => String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim())
            .filter(Boolean)
        : []
      if (fulfillmentIds.includes(assignedId)) return true

      // Keep legacy behavior for orders that still have no warehouse references yet.
      return !directId && idsFromArray.length === 0 && allocationIds.length === 0 && fulfillmentIds.length === 0
    }

    const hasOrderWarehouseRefs = orders.some((item) => {
      const directId = String(item?.warehouseId || item?.warehouse_id || '').trim()
      const hasIds = Array.isArray(item?.warehouseIds) && item.warehouseIds.some((value: any) => String(value || '').trim())
      const hasAllocations = Array.isArray(item?.warehouseAllocations) && item.warehouseAllocations.some((allocation: any) => String(allocation?.warehouseId || allocation?.warehouse_id || allocation?.warehouse?.id || '').trim())
      const hasFulfillments = Array.isArray(item?.fulfillments) && item.fulfillments.some((leg: any) => String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim())
      return Boolean(directId || hasIds || hasAllocations || hasFulfillments)
    })

    const warehouseScoped = hasOrderWarehouseRefs ? orders.filter(belongsToAssignedWarehouse) : orders
    return warehouseScoped.filter((item) => {
      const number = String(item?.orderNumber || item?.order_number || '').trim().toUpperCase()
      return !Boolean(item?.isScheduledReplacement) && !number.startsWith('RPL-')
    })
  }, [assignedWarehouse, orders])

  const {
    liveTrackingActiveTrips,
    liveTrackingCenter,
    liveTrackingDeliveredTransactions,
    liveTrackingLocations,
    liveTrackingRecentLocations,
    liveTrackingRouteLines,
  } = useWarehouseLiveTracking({
    driverLocations,
    scopedOrders,
    scopedTrips,
    trackingDate,
  })

  const scopedInventory = useMemo(() => {
    if (!assignedWarehouse) return inventory
    const hasInventoryWarehouseRefs = inventory.some((item) => item?.warehouse?.id)
    return hasInventoryWarehouseRefs
      ? inventory.filter((item) => item?.warehouse?.id === assignedWarehouse.id)
      : inventory
  }, [assignedWarehouse, inventory])
  // Added: reuse warehouse-scoped data so global search cannot expose another facility.
  const globalSearchResults = useMemo(() => hasAssignedWarehouse
    ? searchWarehouseRecords(globalSearchQuery, scopedOrders, scopedInventory)
    : [], [globalSearchQuery, scopedOrders, scopedInventory, hasAssignedWarehouse])
  const openGlobalSearchResult = (result: WarehouseSearchResult) => {
    setGlobalSearchQuery('')
    setActiveView(result.kind)
    if (result.kind === 'inventory') {
      setInventorySubView('inventory')
      setSearchInventoryId(result.id)
      return
    }
    const order = scopedOrders.find((entry) => String(entry.id) === result.id)
    if (order) void openOrderDetail(order)
  }

  const scopedInventoryTransactions = useMemo(() => {
    if (!assignedWarehouse) return inventoryTransactions
    const filtered = inventoryTransactions.filter((entry) =>
      warehouseMatches(entry?.warehouse?.id, entry?.warehouse?.name, entry?.warehouse?.code)
    )
    return filtered.sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime()
      const bTime = new Date(b.createdAt || 0).getTime()
      return bTime - aTime
    })
  }, [assignedWarehouse, inventoryTransactions])

  const availableInventoryTransactionTypes = useMemo(() => {
    return Array.from(
      new Set(
        scopedInventoryTransactions
          .map((entry) => String(entry?.type || '').trim().toUpperCase())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b))
  }, [scopedInventoryTransactions])

  const filteredInventoryTransactions = useMemo(() => {
    return scopedInventoryTransactions.filter((entry) => {
      // Only show inventory transactions: IN, OUT, RESERVE, UNRESERVE
      // Exclude ASSIGN (trip assignments) and other non-inventory types
      const rawType = String(entry?.type || '').trim().toUpperCase()
      const validInventoryTypes = ['IN', 'OUT', 'RESERVE', 'UNRESERVE']
      if (!validInventoryTypes.includes(rawType)) {
        return false
      }

      if (transactionTypeFilter !== 'all' && rawType !== transactionTypeFilter.toUpperCase()) {
        return false
      }

      if (transactionDateFrom || transactionDateTo) {
        const createdAt = entry?.createdAt ? new Date(entry.createdAt) : null
        if (!createdAt || Number.isNaN(createdAt.getTime())) {
          return false
        }
        const dayKey = formatDayKey(createdAt)
        if (transactionDateFrom && dayKey < transactionDateFrom) {
          return false
        }
        if (transactionDateTo && dayKey > transactionDateTo) {
          return false
        }
      }

      return true
    })
  }, [scopedInventoryTransactions, transactionDateFrom, transactionDateTo, transactionTypeFilter])

  useEffect(() => {
    if (transactionDatePreset === 'custom') return

    const end = new Date()
    const start = new Date(end)

    if (transactionDatePreset === 'past_7_days') {
      start.setDate(start.getDate() - 6)
    } else if (transactionDatePreset === 'past_14_days') {
      start.setDate(start.getDate() - 13)
    } else if (transactionDatePreset === 'past_1_month') {
      start.setMonth(start.getMonth() - 1)
    } else if (transactionDatePreset === 'past_3_months') {
      start.setMonth(start.getMonth() - 3)
    } else if (transactionDatePreset === 'past_6_months') {
      start.setMonth(start.getMonth() - 6)
    } else if (transactionDatePreset === 'past_1_year') {
      start.setFullYear(start.getFullYear() - 1)
    }

    setTransactionDateFrom(formatDayKey(start))
    setTransactionDateTo(formatDayKey(end))
  }, [transactionDatePreset])

  const {
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
  } = useWarehouseDashboardStats({
    assignedWarehouse,
    replacements,
    scopedInventory,
    scopedInventoryTransactions,
    scopedOrders,
    scopedTrips,
    stockBatches,
    warehouseMatches,
  })

  const {
    fetchInventoryTransactionsData,
    fetchOrdersData,
    fetchProductsData,
    fetchReplacementsData,
    fetchSavedRoutesData,
    fetchTripsData,
    fetchDriverPositions,
    fetchVehiclesData,
    fetchWarehousesData,
    refreshInventoryAndStockData,
  } = useWarehousePortalData({
    assignedWarehouseIdRef,
    inventory,
    inventoryStockCacheAtRef,
    inventoryStockCacheKey,
    inventoryStockRefreshRef,
    latestOrderUpdatedAtRef,
    orderDetailsLoadedRef,
    orders,
    ordersCacheAtRef,
    ordersCacheKey,
    routeWarehouseId,
    selectedRouteVehicleId,
    setDriverLocations,
    setInventory,
    setInventoryTransactions,
    setLoadingBatches,
    setLoadingInventory,
    setLoadingInventoryTransactions,
    setLoadingOrders,
    setLoadingReplacements,
    setLoadingTrips,
    setLoadingWarehouses,
    setOrders,
    setProducts,
    setReplacements,
    setRouteWarehouseId,
    setSavedRoutes,
    setSelectedOrder,
    setSelectedRouteVehicleId,
    setStockBatches,
    setStockInWarehouseId,
    setTrips,
    setVehicles,
    setWarehouseLoadError,
    setWarehouses,
    stockBatches,
    stockInWarehouseId,
    tripsCacheAtRef,
    tripsCacheKey,
    tripsRefreshRef,
  })
  // The live-tracking subscription below is re-created only when the view changes,
  // so it reads the current fetcher through a ref rather than closing over a stale one.
  const fetchDriverPositionsRef = useRef(fetchDriverPositions)
  useEffect(() => {
    fetchDriverPositionsRef.current = fetchDriverPositions
  })

  const {
    confirmDeleteTrip,
    createRoutePlan,
    createTripFromCurrentRoutePlan,
    createTripFromRoute,
    deleteTrip,
    driverAvailability,
    editTripDropPoints,
    fetchDriversData,
    getDriverTripEligibilityLabel,
    handleRouteOrderClick,
    isDriverSelectableForTrip,
    isSelectedRouteOverloaded,
    isSelectedSavedRouteOverloaded,
    isSelectedVehicleCapacityMissing,
    openTripEditorInCreateDialog,
    saveTripEditsFromCurrentRoutePlan,
    selectedDriverAssignedVehicle,
    selectedDriverEligibilityIssue,
    selectedRouteLoad,
    selectedSavedRoute,
    selectedSavedRouteLoad,
    selectedVehicleCapacity,
    unassignOrderItemsFromTrip,
  } = useWarehouseRoutePlanning({
    assignedWarehouse,
    createTripOpen,
    drivers,
    driversLoadFailed,
    driversLoading,
    editingTripState,
    fetchOrdersData,
    fetchSavedRoutesData,
    fetchTripsData,
    orders,
    products,
    routeDate,
    routePlanCachePrefix,
    routePlans,
    routeWarehouseId,
    savedRoutes,
    selectedRouteCity,
    selectedRouteDriverId,
    selectedRouteOrderIds,
    selectedSavedRouteId,
    setCreateRouteOpen,
    setCreateTripOpen,
    setCreatingTripFromRoute,
    setDrivers,
    setDriversLoadFailed,
    setDriversLoading,
    setEditingTripId,
    setEditingTripState,
    setLoadingRoutePlans,
    setRouteDate,
    setRoutePlanMessage,
    setRoutePlans,
    setRouteWarehouseId,
    setSavedRoutes,
    setSelectedRouteCity,
    setSelectedRouteDriverId,
    setSelectedRouteOrderIds,
    setSelectedSavedRouteId,
    setSelectedTrip,
    setTripToDelete,
    setTrips,
    tripToDelete,
    trips,
    vehicles,
  })

  useEffect(() => {
    const loadCachedOperationalData = (warehouseId?: string) => {
      const normalizedWarehouseId = String(warehouseId || '').trim()
      const inventoryStockEntry = readPortalCache<{
        inventory: InventoryItem[]
        stockBatches: StockBatchItem[]
      }>(inventoryStockCacheKey)
      const inventoryCacheMatches = Boolean(
        inventoryStockEntry &&
        (!normalizedWarehouseId || !inventoryStockEntry.warehouseId || inventoryStockEntry.warehouseId === normalizedWarehouseId)
      )
      if (inventoryCacheMatches && inventoryStockEntry) {
        setInventory(Array.isArray(inventoryStockEntry.data.inventory) ? inventoryStockEntry.data.inventory : [])
        setStockBatches(Array.isArray(inventoryStockEntry.data.stockBatches) ? inventoryStockEntry.data.stockBatches : [])
        setLoadingInventory(false)
        setLoadingBatches(false)
        inventoryStockCacheAtRef.current = inventoryStockEntry.cachedAt
      }

      const tripsEntry = readPortalCache<WarehouseTripItem[]>(tripsCacheKey)
      const tripsCacheMatches = Boolean(
        tripsEntry && (!normalizedWarehouseId || !tripsEntry.warehouseId || tripsEntry.warehouseId === normalizedWarehouseId)
      )
      if (tripsCacheMatches && tripsEntry) {
        setTrips(Array.isArray(tripsEntry.data) ? tripsEntry.data : [])
        setLoadingTrips(false)
        tripsCacheAtRef.current = tripsEntry.cachedAt
      }

      const ordersEntry = readPortalCache<WarehouseOrderItem[]>(ordersCacheKey)
      const ordersCacheMatches = Boolean(
        ordersEntry && (!normalizedWarehouseId || !ordersEntry.warehouseId || ordersEntry.warehouseId === normalizedWarehouseId)
      )
      if (ordersCacheMatches && ordersEntry) {
        const cachedOrders = Array.isArray(ordersEntry.data) ? ordersEntry.data : []
        if (cachedOrders.length > 0) {
          setOrders(cachedOrders)
          setLoadingOrders(false)
          ordersCacheAtRef.current = ordersEntry.cachedAt
          // Seed the delta cursor so the revalidation below can ask only for what
          // changed. The marker is deliberately left unset: it is established by a
          // real response, so a cached start still forces one authoritative fetch.
          latestOrderUpdatedAtRef.current = getMaxOrderUpdatedAt(cachedOrders)
          orderDetailsLoadedRef.current = cachedOrders.some(
            (order) => Array.isArray(order.items) && order.items.length > 0
          )
        }
      }

      return {
        inventoryStockCached: inventoryCacheMatches,
        inventoryStockFresh: inventoryCacheMatches && isPortalCacheFresh(inventoryStockEntry),
        tripsCached: tripsCacheMatches,
        tripsFresh: tripsCacheMatches && isPortalCacheFresh(tripsEntry),
        ordersCached: ordersCacheMatches && ordersCacheAtRef.current > 0,
      }
    }

    const refreshAllData = async (options?: { initial?: boolean }) => {
      if (isRefreshingAllRef.current) return
      isRefreshingAllRef.current = true
      const initial = options?.initial ?? false
      try {
        const warehouseList = await fetchWarehousesData()
        const effectiveWarehouseId = warehouseList[0]?.id
        const cacheState = loadCachedOperationalData(effectiveWarehouseId)
        // Cached sections can render immediately while stale/missing data revalidates in parallel.
        if (initial) setIsInitialPortalLoading(false)
        await Promise.all([
          cacheState.inventoryStockFresh
            ? Promise.resolve()
            : refreshInventoryAndStockData(effectiveWarehouseId, { showLoading: !cacheState.inventoryStockCached }),
          fetchProductsData(),
          fetchInventoryTransactionsData(),
          initial
            // Fix: fully reconcile old snapshots; a delta cannot restore omitted historical POs.
            ? fetchOrdersData({ showLoading: !cacheState.ordersCached, lightweightDetails: true, silent: cacheState.ordersCached })
            : fetchOrdersData({ showLoading: false, silent: true }),
          cacheState.tripsFresh ? Promise.resolve() : fetchTripsData({ showLoading: !cacheState.tripsCached }),
          fetchReplacementsData(),
          fetchDriversData(),
          fetchVehiclesData(),
          fetchSavedRoutesData(),
        ])
      } finally {
        isRefreshingAllRef.current = false
        if (initial) setIsInitialPortalLoading(false)
      }
    }

    void refreshAllData({ initial: true })

    const unsubscribe = subscribeDataSync((message) => {
      const scopes = message.scopes
      if (scopes.some((scope) => ['orders', 'trips', 'warehouses'].includes(scope))) {
        // Eligible trip orders change whenever an order, trip assignment, or warehouse changes.
        removePortalCachesByPrefix(routePlanCachePrefix)
      }
      if (isRefreshingAllRef.current) return
      if (scopes.some((scope) => ['inventory', 'stock-batches'].includes(scope))) {
        invalidateInventoryStockCaches()
        void refreshInventoryAndStockData(assignedWarehouseIdRef.current, { showLoading: false })
      }
      if (scopes.includes('products')) {
        void fetchProductsData()
      }
      if (scopes.includes('inventory-transactions')) {
        void fetchInventoryTransactionsData()
      }
      if (scopes.includes('warehouses')) {
        void fetchWarehousesData().then((warehouseList) => {
          invalidateInventoryStockCaches()
          return refreshInventoryAndStockData(warehouseList[0]?.id, { showLoading: false })
        })
      }
      if (scopes.includes('orders')) {
        // Deleted rows are absent from deltas, so replace the collection on deletion events.
        void fetchOrdersData({ showLoading: false, onlyIfNew: !scopes.includes('deletions'), silent: true })
      }
      if (scopes.includes('trips')) {
        removePortalCache(tripsCacheKey)
        void fetchTripsData({ showLoading: false })
      }
      if (scopes.includes('replacements')) {
        void fetchReplacementsData()
      }
      if (scopes.includes('drivers')) {
        void fetchDriversData()
      }
      if (scopes.includes('vehicles')) {
        void fetchVehiclesData()
      }
    })

    const refreshStaleOperationalCaches = () => {
      const now = Date.now()
      if (now - inventoryStockCacheAtRef.current >= PORTAL_CACHE_TTL_MS) {
        void refreshInventoryAndStockData(assignedWarehouseIdRef.current, { showLoading: false })
      }
      if (now - tripsCacheAtRef.current >= PORTAL_CACHE_TTL_MS) {
        void fetchTripsData({ showLoading: false })
      }
    }
    const onFocus = () => refreshStaleOperationalCaches()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshStaleOperationalCaches()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    // Driver positions advance on their own throttled scope, so the map follows a
    // moving vehicle while it is on screen without re-reading trips and orders.
    if (activeView !== 'liveTracking') return
    const unsubscribe = subscribeDataSync(({ scopes }) => {
      if (scopes.includes('tracking') && document.visibilityState === 'visible') {
        void fetchDriverPositionsRef.current()
      }
    })
    return unsubscribe
  }, [activeView])

  useEffect(() => {
    if (activeView === 'orders' || activeView === 'purchaseRequests') {
      // Retry complete table details only if the startup request did not finish.
      if (!orderDetailsLoadedRef.current) {
        // Snapshot rows are already rendered on a revisit, so only show the
        // blocking loader when there is genuinely nothing to display.
        void fetchOrdersData({ showLoading: orders.length === 0, lightweightDetails: true })
      }
      return
    }
    if (activeView === 'liveTracking') {
      void Promise.all([
        fetchTripsData(),
        fetchOrdersData({ showLoading: false, silent: true }),
      ])
      return
    }
    if (activeView === 'trips') {
      // Reuse the Trips snapshot when it is still fresh instead of fetching on every tab visit.
      if (Date.now() - tripsCacheAtRef.current >= PORTAL_CACHE_TTL_MS) {
        void fetchTripsData()
      }
      return
    }
    if (activeView === 'inventory') {
      // Revalidate once when Inventory is opened so cross-device Admin deletions are reflected.
      void Promise.all([
        fetchProductsData(),
        refreshInventoryAndStockData(assignedWarehouseIdRef.current, { showLoading: false }),
      ])
    }
  }, [activeView, trackingDate])

  useEffect(() => {
    if (!['orders', 'purchaseRequests', 'trips', 'inventory'].includes(activeView)) return

    const refreshChangedOrderStatuses = async () => {
      if (document.visibilityState !== 'visible' || isPollingOrderStatusesRef.current) return
      isPollingOrderStatusesRef.current = true
      try {
        // Other devices' changes now arrive as sync events (see lib/sync-hub.ts),
        // so this runs on an actual change rather than on a 2s timer.
        if (activeView === 'trips') {
          await Promise.all([fetchDriversData(), fetchVehiclesData(), fetchTripsData({ showLoading: false })])
          return
        }
        if (activeView === 'inventory') {
          await Promise.all([fetchProductsData(), refreshInventoryAndStockData(assignedWarehouseIdRef.current, { showLoading: false })])
          return
        }
        // Use the order marker/delta path so PO statuses synchronize without reloading the screen.
        await fetchOrdersData({ showLoading: false, onlyIfNew: true, silent: true, lightweightDetails: true })
      } finally {
        isPollingOrderStatusesRef.current = false
      }
    }

    void refreshChangedOrderStatuses()

    // Refresh the moment the relevant scope moves on any device.
    const watchedScopes = activeView === 'trips'
      ? ['trips', 'drivers', 'vehicles', 'orders']
      : activeView === 'inventory'
        ? ['inventory', 'stocks', 'stock-batches', 'products']
        : ['orders', 'trips']
    const unsubscribe = subscribeDataSync(({ scopes }) => {
      // The portal-wide listener performs the required full collection refresh for deletions.
      if (scopes.includes('deletions')) return
      if (scopes.some((scope) => watchedScopes.includes(scope))) void refreshChangedOrderStatuses()
    })

    // Safety net only, for a stamp endpoint that is unreachable.
    const orderStatusPollInterval = window.setInterval(() => {
      void refreshChangedOrderStatuses()
    }, 60000)

    return () => {
      unsubscribe()
      window.clearInterval(orderStatusPollInterval)
      isPollingOrderStatusesRef.current = false
    }
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'liveTracking') return
    const refreshLiveTracking = () => {
      if (document.visibilityState !== 'visible') return
      void Promise.all([
        fetchTripsData({ showLoading: false }),
        fetchOrdersData({ showLoading: false, silent: true }),
      ])
    }

    const unsubscribe = subscribeDataSync((message) => {
      const scopes = message.scopes || []
      if (scopes.includes('trips') || scopes.includes('orders')) {
        refreshLiveTracking()
      }
    })

    const onFocus = () => refreshLiveTracking()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshLiveTracking()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [activeView, trackingDate])

  const openOrderDetail = async (order: WarehouseOrderItem) => {
    // A slower previous request must not replace the most recently opened PR.
    const requestId = ++orderDetailRequestRef.current
    const normalizedStatus = String(order?.status || '').trim().toUpperCase()
    setSelectedOrder(
      normalizedStatus === 'RESCHEDULED'
        ? ({
            ...order,
            assignedTripId: undefined,
            tripId: undefined,
            progress: {
              trip: null,
              dropPoint: null,
              pod: {
                recipientName: null,
                deliveryPhoto: null,
                actualArrival: null,
                actualDeparture: null,
                failureReason: null,
                failureNotes: null,
                notes: null,
              },
            },
          } as WarehouseOrderItem)
        : order
    )
    const hasItems = Array.isArray(order.items) && order.items.length > 0
    setLoadingOrderDetail(!hasItems)
    try {
      const response = await fetch(`/api/orders/${order.id}`, { cache: 'no-store', credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (requestId !== orderDetailRequestRef.current) return
      if (!response.ok || payload?.success === false || !payload?.order) {
        throw new Error(payload?.error || 'Unable to load request details. Please try again.')
      }
      setSelectedOrder(payload.order as WarehouseOrderItem)
    } catch (error) {
      console.error('Failed to load order details:', error)
      toast.error(error instanceof Error ? error.message : 'Unable to load request details. Please try again.')
    } finally {
      if (requestId === orderDetailRequestRef.current) setLoadingOrderDetail(false)
    }
  }

  const handleNotificationClick = (notification: PortalNotification) => {
    // Fix: acknowledge only the notification explicitly selected by the user.
    if (!notification.isRead) void markAllNotificationsAsRead([notification.id])
    const referenceType = String(notification.referenceType || notification.type || '').trim().toLowerCase()
    const referenceId = String(notification.referenceId || '').trim()

    // Added: route each alert to its matching warehouse workflow and open the record when loaded.
    if (referenceType === 'order') {
      setActiveView('orders')
      if (referenceId) {
        const order = orders.find((item) => item.id === referenceId)
        void openOrderDetail(order || ({ id: referenceId, orderNumber: notification.title } as WarehouseOrderItem))
      }
      return
    }
    if (referenceType === 'replacement') {
      setActiveView('replacements')
      const replacement = replacements.find((item) => item.id === referenceId)
      if (replacement) setSelectedReplacement(replacement)
      return
    }
    if (referenceType === 'trip') {
      setActiveView('trips')
      const trip = trips.find((item) => item.id === referenceId)
      if (trip) setSelectedTrip(trip)
      return
    }
    if (referenceType === 'warehouse') {
      setActiveView('warehouses')
      return
    }
    if (['product', 'inventory', 'stock_batch'].includes(referenceType)) {
      setActiveView('inventory')
      return
    }
    if (['driver', 'vehicle', 'transport'].includes(referenceType)) {
      setActiveView('trips')
    }
  }

  const {
    addStockInBatch,
    addStockOpen,
    addStockRow,
    availableExistingProducts,
    editBatchExpiryDate,
    editBatchManufacturedDate,
    editBatchQuantity,
    editingBatch,
    getAvailableQty,
    getStockStatus,
    isSavingBatchQty,
    isSubmittingStockIn,
    openAddStockDialog,
    openBatchQuantityDialog,
    removeStockRow,
    resetStockInForm,
    saveStockBatchChanges,
    setAddStockOpen,
    setEditBatchExpiryDate,
    setEditBatchManufacturedDate,
    setEditBatchQuantity,
    setEditingBatch,
    stockRows,
    updateStockRow,
  } = useWarehouseStockIn({
    assignedWarehouse,
    inventory,
    isWarehouseScopedUser,
    products,
    setStockInWarehouseId,
    stockInWarehouseId,
    warehouses,
  })

  const deriveOrderFulfillmentSummary = (order: any) =>
    deriveOrderFulfillmentSummaryImpl(order, { trips })

  const formatAllocatedQtyLabel = (order: any, allocatedQty: number, totalQty: number) =>
    formatAllocatedQtyLabelImpl(order, allocatedQty, totalQty, { trips })

  const getWarehouseDisplayOrderStatus = (order: any) =>
    getWarehouseDisplayOrderStatusImpl(order, { trips })

  const orderStatusOptions = useMemo(() => {
    const statuses = new Set<string>()
    scopedOrders.forEach((order) => {
      statuses.add(getWarehouseDisplayOrderStatus(order))
    })
    return Array.from(statuses.values()).sort((a, b) => a.localeCompare(b))
  }, [scopedOrders])

  const filteredOrders = useMemo(() => {
    const minPrice = Number(orderMinPriceFilter)
    const maxPrice = Number(orderMaxPriceFilter)
    const hasMinPrice = orderMinPriceFilter.trim() !== '' && Number.isFinite(minPrice)
    const hasMaxPrice = orderMaxPriceFilter.trim() !== '' && Number.isFinite(maxPrice)
    const dayMs = 24 * 60 * 60 * 1000
    const datePresetDays: Record<string, number> = {
      past_7_days: 7,
      past_14_days: 14,
      past_1_month: 30,
      past_3_months: 90,
      past_6_months: 180,
      past_1_year: 365,
    }

    return scopedOrders.filter((order) => {
      const normalizedStatus = getWarehouseDisplayOrderStatus(order)
      if (orderStatusFilter !== 'all' && normalizedStatus !== orderStatusFilter) return false

      const rawDate = String(order.deliveryDate || order.createdAt || '')
      if (orderDatePreset === 'custom') {
        if (orderCustomDateFilter && !rawDate.startsWith(orderCustomDateFilter)) return false
      } else if (orderDatePreset !== 'all') {
        const thresholdDays = datePresetDays[orderDatePreset]
        const parsedDate = new Date(rawDate)
        if (!Number.isFinite(thresholdDays) || Number.isNaN(parsedDate.getTime())) return false
        if (parsedDate.getTime() < Date.now() - thresholdDays * dayMs) return false
      }

      const amount = Number(order.totalAmount || 0)
      if (hasMinPrice && amount < minPrice) return false
      if (hasMaxPrice && amount > maxPrice) return false
      ;(order as any)._displayStatus = normalizedStatus
      ;(order as any)._fulfillmentSummary = deriveOrderFulfillmentSummary(order)
      return true
    })
  }, [scopedOrders, orderStatusFilter, orderDatePreset, orderCustomDateFilter, orderMinPriceFilter, orderMaxPriceFilter])

  const updateWarehouseOrderStatus = async (
    orderId: string,
    status: 'APPROVED' | 'PREPARING' | 'RESCHEDULED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'REJECTED',
    reason?: string,
    deliveryDate?: string
  ) => {
    setUpdatingOrderId(orderId)
    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reason, deliveryDate }),
      })
      const responseText = await response.text()
      let payload: any = {}
      if (responseText) {
        try {
          payload = JSON.parse(responseText)
        } catch {
          payload = { raw: responseText }
        }
      }
      if (!response.ok || payload?.success === false) {
        const rawBackendResponse = typeof payload?.raw === 'string' ? payload.raw : ''
        const safeRawError = /<html|<!doctype|body\s*\{|typeerror at \/api/i.test(rawBackendResponse)
          ? ''
          : rawBackendResponse.replace(/<[^>]*>/g, ' ').trim().slice(0, 180)
        const backendError =
          payload?.error ||
          payload?.message ||
          safeRawError ||
          'Failed to update order status'
        if (/Delivery date has passed\. Reschedule the order before processing it\./i.test(backendError)) {
          // Fix: reveal rescheduling only after the warehouse explicitly starts processing.
          setOrders((prev) => prev.map((order) => (
            order.id === orderId ? { ...order, showRescheduleAction: true } : order
          )))
          setSelectedOrder((prev) => (
            prev && prev.id === orderId ? { ...prev, showRescheduleAction: true } : prev
          ))
        }
        toast.error(backendError)
        return false
      }

      const updatedOrder = payload?.order || {}
      const clearRescheduleAction = status === 'RESCHEDULED' ? { showRescheduleAction: false } : {}
      setOrders((prev) => prev.map((order) => (
        order.id === orderId ? { ...order, ...updatedOrder, ...clearRescheduleAction, status, notes: reason || order.notes } : order
      )))
      setSelectedOrder((prev) => (
        prev && prev.id === orderId ? { ...prev, ...updatedOrder, ...clearRescheduleAction, status, notes: reason || prev.notes } : prev
      ))
      toast.success('Order status updated')
      emitDataSync(['orders', 'trips', 'customers', 'auth', 'user'])
      void Promise.all([
        fetchOrdersData({ showLoading: false, silent: true }),
        fetchTripsData({ showLoading: false }),
      ])
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update order status')
      return false
    } finally {
      setUpdatingOrderId(null)
    }
  }

  const buildReplacementLines = (replacement: any, meta: any) =>
    buildReplacementLinesImpl(replacement, meta, { orders, products })

  // Fix: route previews must use the replacement request, not rounded loading quantities.
  const getRouteReplacementProducts = (order: any): string =>
    getRouteReplacementProductsImpl(order, { orders, products, replacements })

  const formatIssueStatus = (entry: WarehouseReplacementItem) =>
    formatIssueStatusImpl(entry, { orders, products })

  const updateIssueStatus = async (
    replacementId: string,
    status: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'IN_PROGRESS' | 'COMPLETED' | 'NEEDS_FOLLOW_UP',
    options?: { notes?: string; createReplacementOrder?: boolean; rescheduleReplacementDelivery?: boolean; replacementDeliveryDate?: string; manualScheduleConfirmed?: boolean }
  ) => {
    setUpdatingReplacementId(replacementId)
    try {
      const response = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'replacement',
          replacementId: replacementId,
          status,
          notes: options?.notes,
          createReplacementOrder: options?.createReplacementOrder,
          rescheduleReplacementDelivery: options?.rescheduleReplacementDelivery,
          replacementDeliveryDate: options?.replacementDeliveryDate,
          manualScheduleConfirmed: options?.manualScheduleConfirmed,
        }),
      })
      const rawResponse = await response.text()
      let payload: any = {}
      try {
        payload = rawResponse ? JSON.parse(rawResponse) : {}
      } catch {
        payload = {}
      }
      if (!response.ok || payload?.success === false) {
        throw new Error(
          payload?.error ||
          payload?.message ||
          rawResponse.trim() ||
          'Failed to update replacement'
        )
      }
      const nextReplacement = payload?.replacement || {}
      const nextStatus = String(nextReplacement?.status || status || '').toUpperCase()
      const schedulingFlow = Boolean(options?.createReplacementOrder && options?.replacementDeliveryDate)
      const reschedulingFlow = Boolean(options?.rescheduleReplacementDelivery && options?.replacementDeliveryDate)
      if (reschedulingFlow) {
        toast.success(`Replacement delivery moved to ${options?.replacementDeliveryDate}.`)
      } else if (schedulingFlow) {
        toast.success(`Replacement delivery scheduled for ${options?.replacementDeliveryDate}. It's now ready to be assigned to a trip.`)
      } else if (nextStatus === 'IN_PROGRESS') {
        toast.success('Replacement is now being processed by the warehouse.')
      } else {
        toast.success(`Replacement updated to ${nextStatus.replace(/_/g, ' ')}`)
      }
      emitDataSync(['replacements', 'orders'])
      setReplacements((prev) =>
        prev.map((entry) =>
          entry.id === replacementId
            ? { ...entry, ...nextReplacement, status: nextStatus || entry.status, notes: nextReplacement?.notes || options?.notes || entry.notes }
            : entry
        )
      )
      setSelectedReplacement((current) =>
        current?.id === replacementId
          ? { ...current, ...nextReplacement, status: nextStatus || current.status, notes: nextReplacement?.notes || options?.notes || current.notes }
          : current
      )
      void Promise.all([
        fetchReplacementsData(),
        fetchOrdersData({ showLoading: false, silent: true }),
      ])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update replacement')
    } finally {
      setUpdatingReplacementId(null)
    }
  }

  if (isInitialPortalLoading) {
    return (
      <div className={`${portalFont.className} flex min-h-screen items-center justify-center bg-gradient-to-br from-cyan-50 via-sky-50 to-emerald-50`}>
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-cyan-600" />
          <p className="font-medium text-slate-700">Loading warehouse information...</p>
        </div>
      </div>
    )
  }

  // Verification is a page in this portal too. An early return inside the component
  // keeps all of the portal's state, so nothing in progress is lost behind it.
  if (otpModalKind !== null) {
    const otpEmail = otpModalKind === 'profile' ? normalizedProfileEmail : accountEmail
    return (
      <div className={`${portalFont.className} min-h-screen bg-white px-6 pb-10 pt-4`}>
        <div className="mx-auto flex w-full max-w-md flex-col">
          <OtpVerificationPanel
            open
            variant="page"
            onOpenChange={(open) => {
              if (!open) setOtpModalKind(null)
            }}
            email={otpEmail}
            onVerify={(otp) => verifyOtp(otpEmail, otpModalKind, otp)}
            onResendCode={() => requestOtp(otpEmail, otpModalKind)}
            theme="sky"
          />
        </div>
      </div>
    )
  }

  return (
    <div className={`${portalFont.className} responsive-workspace relative flex h-dvh min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(103,232,249,0.28),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.16),_transparent_32%),linear-gradient(145deg,_#eef9ff_0%,_#eefcf6_46%,_#f6fbff_100%)]`}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-14 top-10 h-64 w-64 rounded-full bg-cyan-200/20 blur-3xl" />
        <div className="absolute right-[-4rem] top-28 h-72 w-72 rounded-full bg-sky-300/15 blur-3xl" />
        <div className="absolute bottom-[-5rem] left-1/3 h-80 w-80 rounded-full bg-emerald-200/20 blur-3xl" />
      </div>
      <aside className="fixed inset-y-0 left-0 z-[20] hidden w-64 flex-col border-r border-white/25 bg-white/38 shadow-[0_24px_50px_rgba(15,23,42,0.12)] backdrop-blur-2xl lg:flex">
        <WarehouseSidebar
          navItems={sidebarNavItems}
          activeView={activeView}
          onSelectView={(viewId) => {
            setActiveView(viewId as WarehouseView)
            setSidebarOpen(false)
          }}
          onLogout={openLogoutConfirm}
        />
      </aside>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-64 border-white/30 bg-white/44 p-0 shadow-[0_24px_60px_rgba(15,23,42,0.2)] backdrop-blur-2xl">
          {/* Names the menu for screen readers; Radix warns when a dialog has neither. */}
          <SheetTitle className="sr-only">Warehouse menu</SheetTitle>
          <SheetDescription className="sr-only">Go to a section of the warehouse portal</SheetDescription>
          <WarehouseSidebar
            navItems={sidebarNavItems}
            activeView={activeView}
            onSelectView={(viewId) => {
              setActiveView(viewId as WarehouseView)
              setSidebarOpen(false)
            }}
            onLogout={handleLogout}
          />
        </SheetContent>
      </Sheet>

      {/* Fix: bound the workspace to the viewport and let the page scroll below the header. */}
      <div className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col lg:pl-64">
        <WarehouseHeader
          searchQuery={globalSearchQuery}
          searchResults={globalSearchResults}
          searchLoading={loadingOrders || loadingInventory || loadingWarehouses}
          onSearchChange={setGlobalSearchQuery}
          onSearchSelect={openGlobalSearchResult}
          userName={String(user?.name || '')}
          userEmail={String(user?.email || '')}
          userAvatar={String(user?.avatar || '')}
          notifications={notifications}
          notificationsLoading={notificationsLoading}
          unreadNotifications={unreadNotifications}
          onOpenSidebar={() => setSidebarOpen(true)}
          onNotificationsOpen={(open) => { void handleNotificationsOpen(open) }}
          onClearNotifications={() => { void clearAllNotifications() }}
          onNotificationClick={handleNotificationClick}
          onMarkAllRead={() => { void markAllNotificationsAsRead() }}
          formatNotificationTime={formatNotificationTime}
          onLogout={handleLogout}
        />

        {/* Keep wide operational content reachable on small screens instead of clipping it. */}
        <main className="portal-content min-h-0 min-w-0 flex-1 overflow-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(2px)' }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="w-full"
            >
          {!hasAssignedWarehouse && (
            <Card>
              <CardHeader>
                <CardTitle>{activeSectionLabel}</CardTitle>
                <CardDescription>
                  {hasWarehouseFetchFailure
                    ? 'Warehouse data is temporarily unavailable. Please try again shortly.'
                    : 'No assigned warehouse yet. Please contact an administrator to assign your warehouse.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  {hasWarehouseFetchFailure
                    ? 'Your account may still be assigned. The current issue is a loading failure, not an assignment change.'
                    : 'Once assigned, this section will show data for your warehouse only.'}
                </p>
              </CardContent>
            </Card>
          )}

          {hasAssignedWarehouse && (
            <>
          {activeView === 'dashboard' && (
            <WarehouseDashboardView
              assignedWarehouse={assignedWarehouse}
              scopedInventory={scopedInventory}
              scopedOrders={scopedOrders}
              dashboardOrderStats={dashboardOrderStats}
              inventoryStatusBreakdown={inventoryStatusBreakdown}
              lowStockCount={lowStockCount}
              activeTripCount={activeTripCount}
              pendingReplacementCases={replacementSummary.needsFollowUp}
              totalReplacementCases={replacementSummary.totalCases}
              warehouseOrdersChartConfig={warehouseOrdersChartConfig}
              weeklyTrendData={weeklyTrendData}
              transactionDateFrom={transactionDateFrom}
              setTransactionDateFrom={setTransactionDateFrom}
              transactionDatePreset={transactionDatePreset}
              setTransactionDatePreset={setTransactionDatePreset}
              transactionTypeFilter={transactionTypeFilter}
              setTransactionTypeFilter={setTransactionTypeFilter}
              availableInventoryTransactionTypes={availableInventoryTransactionTypes}
              loadingInventoryTransactions={loadingInventoryTransactions}
              filteredInventoryTransactions={filteredInventoryTransactions}
            />
          )}

          {activeView === 'retailPos' && (
            <WarehouseRetailPosView warehouseId={assignedWarehouse?.id || warehouses[0]?.id || ''} />
          )}

          {activeView === 'purchaseRequests' && (
            <WarehousePurchaseRequestsView
              loadingOrders={loadingOrders}
              // Deleted PR documents must not be reconstructed from their remaining transaction.
              purchaseRequests={scopedOrders.filter(isPurchaseRequestDocument)}
              formatPeso={formatPeso}
              openOrderDetail={openOrderDetail}
              updateWarehouseOrderStatus={updateWarehouseOrderStatus as any}
            />
          )}

          {activeView === 'orders' && (
            <WarehouseOrdersView
              loadingOrders={loadingOrders}
              purchaseOrders={scopedOrders}
              formatPeso={formatPeso}
              openOrderDetail={openOrderDetail}
              updateWarehouseOrderStatus={updateWarehouseOrderStatus as any}
              updatingOrderId={updatingOrderId}
              onOpenTransportation={() => setActiveView('trips')}
            />
          )}

          {activeView === 'trips' && (
            // Fix: share the admin Fleet Management / Trips / Drivers navigation without nested tabs.
            <TransportationView
              readOnly={false}
              canManageDrivers={false}
              initialTab="trips"
              providedTrips={scopedTrips}
              tripsContent={
                <WarehouseTripsSection
                  loadingTrips={loadingTrips}
                  scopedTrips={scopedTrips}
                  assignedWarehouseId={assignedWarehouse?.id}
                  assignedWarehouseName={assignedWarehouse?.name}
                  tripStatusColors={tripStatusColors}
                  selectedTrip={selectedTrip}
                  setSelectedTrip={setSelectedTrip}
                  onOpenCreateTripFlow={() => setCreateRouteOpen(true)}
                  onEditTrip={(trip) => { void openTripEditorInCreateDialog(trip as WarehouseTripItem) }}
                  onDeleteTrip={(trip) => { void deleteTrip(trip) }}
                  onUnassignOrderItems={(tripId, orderId, warehouseId, itemIds) => { void unassignOrderItemsFromTrip(tripId, orderId, warehouseId, itemIds) }}
                  availableOrders={scopedOrders.filter((order) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(String(order.status || '').toUpperCase())).map((order) => ({ id: order.id, orderNumber: order.orderNumber, shippingName: order.shippingName || order.customer?.name || '', shippingCity: order.shippingCity || '', status: order.status, allocatedQtyForSelectedWarehouse: Number((order as any)?.allocatedQtyForSelectedWarehouse || 0), totalOrderQty: Number((order as any)?.totalOrderQty || 0) }))}
                  onEditTripDropPoints={(trip, changes) => { void editTripDropPoints(trip as WarehouseTripItem, changes) }}
                  editingTripId={editingTripId}
                />
              }
            />
          )}

          {activeView === 'replacements' && (
            <WarehouseReplacementsView
              replacementSummary={replacementSummary}
              loadingReplacements={loadingReplacements}
              scopedReplacements={scopedReplacements}
              parseIssueMeta={parseIssueMeta}
              formatIssueStatus={formatIssueStatus}
              updateIssueStatus={updateIssueStatus}
              updatingReplacementId={updatingReplacementId}
              selectedReplacement={selectedReplacement}
              setSelectedReplacement={setSelectedReplacement}
              buildReplacementLines={buildReplacementLines}
            />
          )}

          {activeView === 'liveTracking' && (
            <WarehouseLiveTrackingView
              trackingDate={trackingDate}
              setTrackingDate={setTrackingDate}
              fetchTripsData={async () => { await fetchTripsData() }}
              fetchOrdersData={fetchOrdersData}
              loadingTrips={loadingTrips}
              loadingOrders={loadingOrders}
              LiveTrackingMap={LiveTrackingMap}
              liveTrackingLocations={liveTrackingLocations}
              liveTrackingRouteLines={liveTrackingRouteLines}
              liveTrackingCenter={liveTrackingCenter}
              liveTrackingActiveTrips={liveTrackingActiveTrips}
              liveTrackingDeliveredTransactions={liveTrackingDeliveredTransactions}
              liveTrackingRecentLocations={liveTrackingRecentLocations}
            />
          )}

          {activeView === 'inventory' && (
            <Tabs value={inventorySubView} onValueChange={(value) => setInventorySubView(value as 'inventory' | 'stocks' | 'empties')} className="space-y-4">
              <TabsList className="h-auto w-full flex-wrap gap-2 rounded-2xl border border-white/40 bg-white/65 p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.12)] backdrop-blur-xl">
                <TabsTrigger
                  value="inventory"
                  className="inline-flex items-center gap-2 rounded-xl border border-transparent bg-transparent px-3 py-2.5 text-sm font-semibold sm:px-5 sm:text-[15px] text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]"
                >
                  <Package className="h-4 w-4" />
                  Inventory
                </TabsTrigger>
                <TabsTrigger
                  value="stocks"
                  className="inline-flex items-center gap-2 rounded-xl border border-transparent bg-transparent px-3 py-2.5 text-sm font-semibold sm:px-5 sm:text-[15px] text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]"
                >
                  <Archive className="h-4 w-4" />
                  Stock batches
                </TabsTrigger>
                <TabsTrigger
                  value="empties"
                  className="inline-flex items-center gap-2 rounded-xl border border-transparent bg-transparent px-3 py-2.5 text-sm font-semibold sm:px-5 sm:text-[15px] text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]"
                >
                  <Recycle className="h-4 w-4" />
                  Empties
                </TabsTrigger>
              </TabsList>

              <TabsContent value="inventory" className="mt-0">
                {/* Added: keep the selected search result visible with an explicit way to restore all stock. */}
                {searchInventoryId && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm text-slate-600">
                    <span>Showing inventory search result</span>
                    <Button variant="outline" size="sm" onClick={() => setSearchInventoryId('')}>Show all inventory</Button>
                  </div>
                )}
                <WarehouseProductForms warehouse={assignedWarehouse} products={products}>
                  {({ openEditDialog, openRegisterProductDialog, openArchivedProductsPage }) => (
                <WarehouseInventoryView
                  openAddStockDialog={openAddStockDialog}
                  loadingInventory={loadingInventory}
                  scopedInventory={searchInventoryId ? scopedInventory.filter((item) => String(item.id) === searchInventoryId) : scopedInventory}
                  getStockStatus={getStockStatus}
                  getAvailableQty={getAvailableQty}
                  formatPeso={formatPeso}
                  openEditDialog={openEditDialog}
                  openRegisterProductDialog={openRegisterProductDialog}
                  openArchivedProductsPage={openArchivedProductsPage}
                />
                  )}
                </WarehouseProductForms>
              </TabsContent>

              <TabsContent value="stocks" className="mt-0">
                <WarehouseStocksView
                  loadingBatches={loadingBatches}
                  stockBatches={stockBatches}
                  getDaysLeft={getDaysLeft}
                  openBatchQuantityDialog={openBatchQuantityDialog}
                />
              </TabsContent>

              <TabsContent value="empties" className="mt-0">
                <WarehouseEmptyBottlesView warehouseId={assignedWarehouse?.id} />
              </TabsContent>
            </Tabs>
          )}

          {/* Use the comprehensive inventory transactions table just like admin */}
          {activeView === 'transactions' && (
            <WarehouseInventoryTransactionsView userRole={user?.role || 'WAREHOUSE_STAFF'} />
          )}

          {activeView === 'warehouses' && (
            <WarehouseWarehousesView
              loadingWarehouses={loadingWarehouses}
              assignedWarehouse={assignedWarehouse}
              warehouseOverviewStats={warehouseOverviewStats}
              getStockHealthDotClass={getStockHealthDotClass}
            />
          )}

          {activeView === 'settings' && (
            <WarehouseSettingsView
              accountEmail={accountEmail}
              confirmPassword={confirmPassword}
              isEditingProfile={isEditingProfile}
              isEmailChangeUnlocked={isEmailChangeUnlocked}
              isEditingSecurity={isEditingSecurity}
              isProfileEmailChanged={isProfileEmailChanged}
              isSavingProfile={isSavingProfile}
              isSavingSecuritySettings={isSavingSecuritySettings}
              isSendingPasswordOtp={isSendingPasswordOtp}
              isSendingProfileOtp={isSendingProfileOtp}
              isUpdatingPassword={isUpdatingPassword}
              loginAlertsEnabled={loginAlertsEnabled}
              newPassword={newPassword}
              normalizedProfileEmail={normalizedProfileEmail}
              passwordOtpSent={passwordOtpSent}
              passwordOtpVerified={passwordOtpVerified}
              passwordRequirements={passwordRequirements}
              profileAvatarCrop={profileAvatarCrop}
              profileAvatarFile={profileAvatarFile}
              profileAvatarInputRef={profileAvatarInputRef}
              profileEmail={profileEmail}
              profileFirstName={profileFirstName}
              profileLastName={profileLastName}
              profileMiddleName={profileMiddleName}
              profileNoMiddleName={profileNoMiddleName}
              profileName={profileName}
              profileOtpSent={profileOtpSent}
              profileOtpVerified={profileOtpVerified}
              profilePhone={profilePhone}
              profileSuffix={profileSuffix}
              requestOtp={requestOtp}
              saveProfileSettings={saveProfileSettings}
              saveSecuritySettings={saveSecuritySettings}
              setConfirmPassword={setConfirmPassword}
              setIsEditingProfile={setIsEditingProfile}
              setIsEditingSecurity={setIsEditingSecurity}
              setLoginAlertsEnabled={setLoginAlertsEnabled}
              setNewPassword={setNewPassword}
              setProfileEmail={setProfileEmail}
              setProfileFirstName={setProfileFirstName}
              setProfileLastName={setProfileLastName}
              setProfileMiddleName={setProfileMiddleName}
              setProfileNoMiddleName={setProfileNoMiddleName}
              setProfileOtp={setProfileOtp}
              setProfileOtpSent={setProfileOtpSent}
              setProfileOtpToken={setProfileOtpToken}
              setProfileOtpVerified={setProfileOtpVerified}
              setProfilePhone={setProfilePhone}
              setProfileSuffix={setProfileSuffix}
              setShowConfirmPassword={setShowConfirmPassword}
              setShowNewPassword={setShowNewPassword}
              setTwoFactorEnabled={setTwoFactorEnabled}
              showConfirmPassword={showConfirmPassword}
              showNewPassword={showNewPassword}
              twoFactorEnabled={twoFactorEnabled}
              updateProfilePassword={updateProfilePassword}
              user={user}
            />
          )}

            </>
          )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <WarehouseCreateRouteDialog
        createRouteOpen={createRouteOpen}
        createRoutePlan={createRoutePlan}
        createTripFromCurrentRoutePlan={createTripFromCurrentRoutePlan}
        creatingTripFromRoute={creatingTripFromRoute}
        deriveOrderFulfillmentSummary={deriveOrderFulfillmentSummary}
        driverAvailability={driverAvailability}
        drivers={drivers}
        editingTripId={editingTripId}
        editingTripState={editingTripState}
        formatAllocatedQtyLabel={formatAllocatedQtyLabel}
        getDriverTripEligibilityLabel={getDriverTripEligibilityLabel}
        getRouteReplacementProducts={getRouteReplacementProducts}
        handleRouteOrderClick={handleRouteOrderClick}
        isDriverSelectableForTrip={isDriverSelectableForTrip}
        isSelectedRouteOverloaded={isSelectedRouteOverloaded}
        isSelectedVehicleCapacityMissing={isSelectedVehicleCapacityMissing}
        loadingRoutePlans={loadingRoutePlans}
        orders={orders}
        routeDate={routeDate}
        routePlanMessage={routePlanMessage}
        routePlans={routePlans}
        routeWarehouseId={routeWarehouseId}
        saveTripEditsFromCurrentRoutePlan={saveTripEditsFromCurrentRoutePlan}
        selectedDriverAssignedVehicle={selectedDriverAssignedVehicle}
        selectedDriverEligibilityIssue={selectedDriverEligibilityIssue}
        selectedRouteCity={selectedRouteCity}
        selectedRouteDriverId={selectedRouteDriverId}
        selectedRouteLoad={selectedRouteLoad}
        selectedRouteOrderIds={selectedRouteOrderIds}
        selectedVehicleCapacity={selectedVehicleCapacity}
        setCreateRouteOpen={setCreateRouteOpen}
        setEditingTripState={setEditingTripState}
        setRouteDate={setRouteDate}
        setRoutePlanMessage={setRoutePlanMessage}
        setRoutePlans={setRoutePlans}
        setSelectedRouteCity={setSelectedRouteCity}
        setSelectedRouteDriverId={setSelectedRouteDriverId}
        setSelectedRouteOrderIds={setSelectedRouteOrderIds}
        warehouses={warehouses}
      />

      <WarehouseCreateTripDialog
        createTripFromRoute={createTripFromRoute}
        createTripOpen={createTripOpen}
        creatingTripFromRoute={creatingTripFromRoute}
        driverAvailability={driverAvailability}
        drivers={drivers}
        getDriverTripEligibilityLabel={getDriverTripEligibilityLabel}
        isDriverSelectableForTrip={isDriverSelectableForTrip}
        isSelectedSavedRouteOverloaded={isSelectedSavedRouteOverloaded}
        isSelectedVehicleCapacityMissing={isSelectedVehicleCapacityMissing}
        orders={orders}
        savedRoutes={savedRoutes}
        selectedDriverAssignedVehicle={selectedDriverAssignedVehicle}
        selectedDriverEligibilityIssue={selectedDriverEligibilityIssue}
        selectedRouteDriverId={selectedRouteDriverId}
        selectedSavedRoute={selectedSavedRoute}
        selectedSavedRouteId={selectedSavedRouteId}
        selectedSavedRouteLoad={selectedSavedRouteLoad}
        selectedVehicleCapacity={selectedVehicleCapacity}
        setCreateTripOpen={setCreateTripOpen}
        setSelectedRouteDriverId={setSelectedRouteDriverId}
        setSelectedSavedRouteId={setSelectedSavedRouteId}
      />

      <WarehouseOrderDetailDialog
        assignedWarehouse={assignedWarehouse}
        deriveOrderFulfillmentSummary={deriveOrderFulfillmentSummary}
        loadingOrderDetail={loadingOrderDetail}
        orderDetailRequestRef={orderDetailRequestRef}
        orders={orders}
        selectedOrder={selectedOrder}
        setSelectedOrder={setSelectedOrder}
        updateWarehouseOrderStatus={updateWarehouseOrderStatus}
        updatingOrderId={updatingOrderId}
      />

      <WarehouseRejectOrderDialog
        otherRejectReason={otherRejectReason}
        rejectOrder={rejectOrder}
        selectedRejectReasons={selectedRejectReasons}
        setOtherRejectReason={setOtherRejectReason}
        setRejectOrder={setRejectOrder}
        setSelectedRejectReasons={setSelectedRejectReasons}
        updateWarehouseOrderStatus={updateWarehouseOrderStatus}
        updatingOrderId={updatingOrderId}
      />

      <WarehouseAddStockDialog
        addStockInBatch={addStockInBatch}
        addStockOpen={addStockOpen}
        addStockRow={addStockRow}
        assignedWarehouse={assignedWarehouse}
        availableExistingProducts={availableExistingProducts}
        isSubmittingStockIn={isSubmittingStockIn}
        isWarehouseScopedUser={isWarehouseScopedUser}
        products={products}
        removeStockRow={removeStockRow}
        resetStockInForm={resetStockInForm}
        setAddStockOpen={setAddStockOpen}
        setStockInWarehouseId={setStockInWarehouseId}
        stockInWarehouseId={stockInWarehouseId}
        stockRows={stockRows}
        updateStockRow={updateStockRow}
        warehouses={warehouses}
      />

      <WarehouseEditBatchDialog
        editBatchExpiryDate={editBatchExpiryDate}
        editBatchManufacturedDate={editBatchManufacturedDate}
        editBatchQuantity={editBatchQuantity}
        editingBatch={editingBatch}
        isSavingBatchQty={isSavingBatchQty}
        saveStockBatchChanges={saveStockBatchChanges}
        setEditBatchExpiryDate={setEditBatchExpiryDate}
        setEditBatchManufacturedDate={setEditBatchManufacturedDate}
        setEditBatchQuantity={setEditBatchQuantity}
        setEditingBatch={setEditingBatch}
      />

      <AlertDialog open={!!tripToDelete} onOpenChange={(open) => !open && setTripToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-amber-600">Delete Trip?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete trip{' '}
              <span className="font-semibold text-foreground">{tripToDelete?.tripNumber}</span>?
              <br /><br />
              Orders from this trip can be routed again after deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setTripToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteTrip}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete Trip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AvatarCropDialog crop={profileAvatarCrop} isSaving={isSavingProfile} onSave={saveCroppedAvatar} />

      <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Logout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to log out of the Warehouse Staff Portal?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleLogout()}
              className="bg-red-600 hover:bg-red-700"
            >
              Logout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
