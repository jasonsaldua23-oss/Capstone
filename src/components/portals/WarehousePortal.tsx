'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/app/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { toast } from 'sonner'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { WarehouseTripsSection } from '@/components/portals/warehouse/WarehouseTripsSection'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { clearTabAuthToken, getTabAuthToken } from '@/lib/client-auth'
import {
  Boxes,
  PackageCheck,
  Truck,
  MapPin,
  ClipboardList,
  Warehouse,
  PackageOpen,
  AlertTriangle,
  Menu,
  Bell,
  Search,
  ChevronDown,
  LogOut,
  Loader2,
  Plus,
  Pencil,
  Eye,
  CircleCheck
} from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Label as RechartsLabel, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

type WarehouseView =
  | 'dashboard'
  | 'orders'
  | 'trips'
  | 'replacements'
  | 'liveTracking'
  | 'inventory'
  | 'warehouses'
  | 'transactions'

interface WarehouseItem {
  id: string
  name: string
  code: string
  address?: string
  city?: string
  province?: string
  latitude?: number | null
  longitude?: number | null
  capacity?: number
  isActive?: boolean
}

interface InventoryItem {
  id: string
  quantity: number
  reservedQuantity?: number
  minStock?: number
  storageLocation?: {
    id: string
    name: string
    code: string
  } | null
  product?: {
    id: string
    name: string
    sku: string
    unit?: string
    price?: number
    imageUrl?: string
    category?: {
      id: string
      name: string
    } | null
  }
  warehouse?: {
    id: string
    name: string
    code: string
  }
}

interface ProductOption {
  id: string
  name: string
  sku: string
  price?: number
}

interface StockBatchItem {
  id: string
  batchNumber: string
  quantity: number
  receiptDate: string
  expiryDate: string | null
  status: string
  locationLabel: string | null
  inventory: {
    product?: {
      sku?: string
      name?: string
    }
    warehouse?: {
      id?: string
      code?: string
      name?: string
    }
    storageLocation?: {
      code?: string
      name?: string
    } | null
  }
}

interface InventoryTransactionItem {
  id: string
  createdAt: string
  type?: string
  quantity?: number
  referenceType?: string | null
  referenceId?: string | null
  warehouse?: {
    id?: string
    name?: string
    code?: string
  } | null
  product?: {
    id?: string
    name?: string
    sku?: string
  } | null
}

interface PortalNotification {
  id: string
  title: string
  message: string
  type: string | null
  isRead: boolean
  createdAt: string
}

const PRODUCT_UNIT_OPTIONS = [
  { value: 'case', label: 'case' },
  { value: 'pack(bundle)', label: 'pack(bundle)' },
]

interface WarehouseOrderItem {
  id: string
  orderNumber: string
  warehouseId?: string
  status: string
  warehouseStage?: string | null
  isDriverAssigned?: boolean
  assignedDriverName?: string | null
  checklistItemsVerified?: boolean
  checklistQuantityVerified?: boolean
  checklistPackagingVerified?: boolean
  checklistSpareProductsVerified?: boolean
  checklistVehicleAssigned?: boolean
  checklistDriverAssigned?: boolean
  createdAt: string
  totalAmount: number
  notes?: string | null
  customer?: {
    name?: string
    email?: string
    phone?: string
  }
  shippingName?: string
  shippingPhone?: string
  shippingAddress?: string
  shippingCity?: string
  shippingProvince?: string
  shippingZipCode?: string
  shippingCountry?: string
  shippingLatitude?: number | null
  shippingLongitude?: number | null
  deliveryDate?: string | null
  items?: Array<{
    id: string
    quantity: number
    unitPrice: number
    totalPrice?: number
    product?: {
      name?: string
      sku?: string
    }
  }>
}

interface WarehouseTripItem {
  id: string
  tripNumber: string
  warehouseId?: string
  status: string
  totalDropPoints?: number
  completedDropPoints?: number
  driver?: {
    user?: {
      name?: string
    }
  }
  vehicle?: {
    licensePlate?: string
  }
  dropPoints?: Array<{
    id: string
    status: string
    orderId?: string
    orderStatus?: string
    orderNumber?: string
    sequence?: number
    latitude?: number | null
    longitude?: number | null
    locationName?: string
  }>
}

interface WarehouseReplacementItem {
  id: string
  replacementNumber: string
  orderId?: string | null
  orderNumber?: string | null
  customerName?: string | null
  warehouseId?: string
  status: string
  reason: string
  description?: string | null
  replacementMode?: string | null
  originalOrderItemId?: string | null
  replacementProductId?: string | null
  replacementQuantity?: number | null
  damagePhotoUrl?: string | null
  notes?: string | null
  createdAt: string
  order?: {
    warehouseId?: string
    orderNumber?: string
    customer?: {
      name?: string
    }
  }
}

interface DriverOption {
  id: string
  isActive?: boolean
  name?: string
  email?: string
  user?: {
    name?: string
  }
  vehicles?: Array<{
    vehicle?: {
      id?: string
      licensePlate?: string
      type?: string
      status?: string
    } | null
  }>
}

interface VehicleOption {
  id: string
  licensePlate?: string
  type?: string
}

interface RoutePlanOrderItem {
  id: string
  orderNumber: string
  city: string
  customerName: string
  address: string
  products?: string
  latitude?: number | null
  longitude?: number | null
  sequence: number
  distanceKm: number | null
  status: string
}

interface RoutePlanCityGroup {
  city: string
  orderCount: number
  totalDistanceKm: number
  orders: RoutePlanOrderItem[]
}

interface SavedRouteDraft {
  id: string
  date: string
  warehouseId: string
  warehouseName: string
  city: string
  totalDistanceKm: number
  orderIds: string[]
  orders: RoutePlanOrderItem[]
  createdAt: string
}

function getCollection<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>

  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[]
  }

  if (Array.isArray(record.data)) return record.data as T[]
  return []
}

function getDefaultRouteDate() {
  const now = new Date()
  now.setDate(now.getDate() + 1)
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

function normalizeTripStatus(status: string | null | undefined) {
  const value = String(status || '').toUpperCase()
  return value === 'IN_TRANSIT' ? 'IN_PROGRESS' : value
}

function isActiveTripStatus(status: string | null | undefined) {
  const normalized = normalizeTripStatus(status)
  return normalized === 'PLANNED' || normalized === 'IN_PROGRESS'
}

function getStockHealthDotClass(name: string) {
  const key = name.toLowerCase()
  if (key === 'healthy') return 'bg-emerald-500'
  if (key === 'low') return 'bg-amber-500'
  if (key === 'critical') return 'bg-red-500'
  if (key === 'overstocked') return 'bg-blue-500'
  return 'bg-gray-400'
}

const navItems: { id: WarehouseView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Boxes },
  { id: 'orders', label: 'Orders', icon: PackageCheck },
  { id: 'trips', label: 'Trips & Deliveries', icon: Truck },
  { id: 'replacements', label: 'Replacements', icon: AlertTriangle },
  { id: 'liveTracking', label: 'Live Tracking', icon: MapPin },
  { id: 'inventory', label: 'Inventory', icon: PackageOpen },
  { id: 'warehouses', label: 'Warehouse', icon: Warehouse },
  { id: 'transactions', label: 'Stocks', icon: ClipboardList },
]

export function WarehousePortal() {
  const { user, logout } = useAuth()
  const [activeView, setActiveView] = useState<WarehouseView>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [stockBatches, setStockBatches] = useState<StockBatchItem[]>([])
  const [inventoryTransactions, setInventoryTransactions] = useState<InventoryTransactionItem[]>([])
  const [orders, setOrders] = useState<WarehouseOrderItem[]>([])
  const [trips, setTrips] = useState<WarehouseTripItem[]>([])
  const [replacements, setReplacements] = useState<WarehouseReplacementItem[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
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
  const [trackingDate, setTrackingDate] = useState('')
  const [createRouteOpen, setCreateRouteOpen] = useState(false)
  const [createTripOpen, setCreateTripOpen] = useState(false)
  const [loadingInventory, setLoadingInventory] = useState(true)
  const [loadingWarehouses, setLoadingWarehouses] = useState(true)
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [loadingInventoryTransactions, setLoadingInventoryTransactions] = useState(true)
  const [transactionTypeFilter, setTransactionTypeFilter] = useState('all')
  const [transactionDateFrom, setTransactionDateFrom] = useState('')
  const [transactionDateTo, setTransactionDateTo] = useState('')
  const [transactionDatePreset, setTransactionDatePreset] = useState('custom')
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [loadingTrips, setLoadingTrips] = useState(true)
  const [loadingReplacements, setLoadingReplacements] = useState(true)
  const [loadingRoutePlans, setLoadingRoutePlans] = useState(false)
  const [creatingTripFromRoute, setCreatingTripFromRoute] = useState(false)
  const [routePlanMessage, setRoutePlanMessage] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(null)
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)
  const [updatingReplacementId, setUpdatingReplacementId] = useState<string | null>(null)
  const [selectedReplacement, setSelectedReplacement] = useState<WarehouseReplacementItem | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<WarehouseOrderItem | null>(null)
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false)
  const [selectedTrip, setSelectedTrip] = useState<WarehouseTripItem | null>(null)
  const [rejectOrder, setRejectOrder] = useState<WarehouseOrderItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editSku, setEditSku] = useState('')
  const [editUnit, setEditUnit] = useState('case')
  const [editImageUrl, setEditImageUrl] = useState('')
  const [editImageFile, setEditImageFile] = useState<File | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [editThreshold, setEditThreshold] = useState('')
  const [editQuantity, setEditQuantity] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeletingEdit, setIsDeletingEdit] = useState(false)
  const [deleteEditOpen, setDeleteEditOpen] = useState(false)
  const [addStockOpen, setAddStockOpen] = useState(false)
  const [isSubmittingStockIn, setIsSubmittingStockIn] = useState(false)
  const [isNewProduct, setIsNewProduct] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState('')
  const [stockInWarehouseId, setStockInWarehouseId] = useState('')
  const [stockInQty, setStockInQty] = useState('')
  const [stockInExpiryDate, setStockInExpiryDate] = useState('')
  const [stockInThreshold, setStockInThreshold] = useState('')
  const [newProductName, setNewProductName] = useState('')
  const [newProductDescription, setNewProductDescription] = useState('')
  const [newProductPrice, setNewProductPrice] = useState('')
  const [newProductUnit, setNewProductUnit] = useState('case')
  const [newProductImageFile, setNewProductImageFile] = useState<File | null>(null)
  const [notifications, setNotifications] = useState<PortalNotification[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [warehouseLoadError, setWarehouseLoadError] = useState<string | null>(null)
  const latestOrderMarkerRef = useRef<string>('')
  const isRefreshingAllRef = useRef(false)
  const hasAssignedWarehouse = warehouses.length > 0
  const hasWarehouseFetchFailure = !hasAssignedWarehouse && Boolean(warehouseLoadError)
  const assignedWarehouse = warehouses[0] || null
  const sidebarNavItems = navItems
  const activeSectionLabel = navItems.find((item) => item.id === activeView)?.label || 'Dashboard'
  const warehouseMatches = (warehouseId?: string | null, warehouseName?: string | null, warehouseCode?: string | null) => {
    if (!assignedWarehouse) return true
    if (warehouseId && warehouseId === assignedWarehouse.id) return true
    if (warehouseCode && assignedWarehouse.code && warehouseCode.toLowerCase() === assignedWarehouse.code.toLowerCase()) return true
    if (warehouseName && assignedWarehouse.name && warehouseName.toLowerCase() === assignedWarehouse.name.toLowerCase()) return true
    return false
  }

  const selectedRouteGroup = useMemo(
    () => routePlans.find((group) => group.city === selectedRouteCity) || null,
    [routePlans, selectedRouteCity]
  )
  const selectedRouteOrders = useMemo(
    () => (selectedRouteGroup?.orders || []).filter((order) => selectedRouteOrderIds.includes(order.id)),
    [selectedRouteGroup, selectedRouteOrderIds]
  )
  const selectedSavedRoute = useMemo(
    () => savedRoutes.find((route) => route.id === selectedSavedRouteId) || null,
    [savedRoutes, selectedSavedRouteId]
  )
  const selectedDriverAssignedVehicle = useMemo(() => {
    const driver = drivers.find((d) => d.id === selectedRouteDriverId)
    const assigned = (driver?.vehicles || []).find((item) => item?.vehicle?.id)?.vehicle
    return assigned
  }, [drivers, selectedRouteDriverId])

  const deleteSavedRouteDraft = async (routeId: string) => {
    const response = await fetch('/api/trips/saved-routes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: routeId }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error || 'Failed to delete saved route')
    }
  }

  const removeSavedRoute = async (routeId: string) => {
    try {
      await deleteSavedRouteDraft(routeId)
      setSavedRoutes((prev) => prev.filter((route) => route.id !== routeId))
      setSelectedSavedRouteId((prev) => (prev === routeId ? '' : prev))
      toast.success('Route deleted')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete route')
    }
  }

  const deleteTrip = async (trip: WarehouseTripItem) => {
    if (String(trip.status || '').toUpperCase() !== 'PLANNED') {
      toast.error('Only planned trips can be deleted')
      return
    }

    const confirmed = window.confirm(`Delete trip ${trip.tripNumber}? Orders from this trip can be routed again after deletion.`)
    if (!confirmed) return

    try {
      const response = await fetch(`/api/trips/${trip.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to delete trip')
      }

      setSelectedTrip((current) => (current?.id === trip.id ? null : current))
      setTrips((prev) => prev.filter((entry) => entry.id !== trip.id))
      if (routeDate && routeWarehouseId) {
        await createRoutePlan(true, routeDate, routeWarehouseId)
      }
      await fetchTripsData()
      await fetchOrdersData()
      await fetchSavedRoutesData()
      emitDataSync(['trips', 'orders'])
      toast.success('Trip deleted')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete trip')
    }
  }

  useEffect(() => {
    if (createRouteOpen && warehouses.length > 0) {
      const effectiveWarehouseId = routeWarehouseId || warehouses[0].id
      const effectiveDate = routeDate || getDefaultRouteDate()
      if (!routeWarehouseId) setRouteWarehouseId(effectiveWarehouseId)
      if (!routeDate) setRouteDate(effectiveDate)
      void createRoutePlan(true, effectiveDate, effectiveWarehouseId)
    }
  }, [createRouteOpen, warehouses])

  useEffect(() => {
    if (routePlans.length > 0 && selectedRouteCity === '') {
      const firstGroup = routePlans[0]
      if (firstGroup) {
        setSelectedRouteCity(firstGroup.city)
        setSelectedRouteOrderIds((firstGroup.orders || []).map((order) => order.id))
      }
    }
  }, [routePlans])

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
    const hasOrderWarehouseRefs = orders.some((item) => item?.warehouseId)
    if (!hasOrderWarehouseRefs) return orders
    const filtered = orders.filter((item) => !item?.warehouseId || item?.warehouseId === assignedWarehouse.id)
    return filtered.length > 0 ? filtered : orders
  }, [assignedWarehouse, orders])

  const isDropPointCompleted = (status: unknown) => {
    const value = String(status || '').toUpperCase()
    return ['COMPLETED', 'DELIVERED', 'FULFILLED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(value)
  }

  const isCompletedOrderStatus = (status: unknown) => {
    const value = String(status || '').toUpperCase()
    return ['DELIVERED', 'COMPLETED', 'FULFILLED'].includes(value)
  }

  const isDateMatch = (value: unknown, dayKey: string) => {
    if (!value || !dayKey) return false
    const raw = String(value).trim()
    if (!raw) return false
    if (/^\d{4}-\d{2}-\d{2}/.test(raw) && raw.slice(0, 10) === dayKey) return true
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return false
    return formatDayKey(parsed) === dayKey
  }

  const orderMatchesTrackingDay = (order: WarehouseOrderItem) => {
    if (!trackingDate) return true
    if (order?.deliveryDate) return isDateMatch(order.deliveryDate, trackingDate)
    return isDateMatch(order?.createdAt, trackingDate)
  }

  const tripMatchesTrackingDay = (trip: WarehouseTripItem) => {
    if (!trackingDate) return true
    const tripAny = trip as any
    const hasMatchingTripDate = [tripAny?.plannedStartAt, tripAny?.actualStartAt, tripAny?.actualEndAt, tripAny?.createdAt].some((value) =>
      isDateMatch(value, trackingDate)
    )
    if (hasMatchingTripDate) return true
    const logs = toArray<any>(tripAny?.locationLogs)
    if (logs.some((log) => isDateMatch(log?.recordedAt || log?.createdAt, trackingDate))) return true
    return isDateMatch(tripAny?.latestLocation?.recordedAt, trackingDate)
  }

  const liveMapData = useMemo(() => {
    const locations: Array<{
      id: string
      driverName: string
      vehiclePlate: string
      lat: number
      lng: number
      status: string
      markerColor?: string
      markerLabel?: string
      markerType?: 'pin' | 'dot' | 'truck' | 'default'
      markerDirection?: 'left' | 'right'
      markerHeading?: number
      markerNumber?: number | string
    }> = []
    const routeLines: Array<{
      id: string
      points: [number, number][]
      color: string
      label?: string
      opacity?: number
      weight?: number
      dashArray?: string
      snapToRoad?: boolean
    }> = []

    const dayOrders = scopedOrders.filter((order: any) => orderMatchesTrackingDay(order))
    const dayOrderIds = new Set(
      dayOrders.map((order: any) => String(order?.id || '').trim()).filter(Boolean)
    )
    const tripOrderIds = new Set<string>()

    scopedTrips
      .filter(
        (trip: any) =>
          ['IN_PROGRESS'].includes(normalizeTripStatus(trip.status)) &&
          tripMatchesTrackingDay(trip)
      )
      .forEach((trip: any) => {
        const normalizedTripStatus = normalizeTripStatus(trip?.status)
        const tripMatchesDay = tripMatchesTrackingDay(trip)
        const toCoordinate = (value: unknown) => {
          const parsed = Number(value)
          return Number.isFinite(parsed) ? parsed : null
        }
        const dropPoints = (trip.dropPoints || [])
          .filter((point: any) => {
            if (!trackingDate) return true
            if (tripMatchesDay) return true
            const orderId = String(point?.orderId || '').trim()
            if (!orderId) return false
            return dayOrderIds.has(orderId)
          })
          .filter((point: any) => typeof point?.latitude === 'number' && typeof point?.longitude === 'number')
          .sort((a: any, b: any) => Number(a?.sequence || 0) - Number(b?.sequence || 0))

        const logs = (trip.locationLogs || [])
          .filter((log: any) => Number.isFinite(Number(log?.latitude)) && Number.isFinite(Number(log?.longitude)))
          .map((log: any) => ({
            ...log,
            latitude: Number(log.latitude),
            longitude: Number(log.longitude),
          }))
          .sort((a: any, b: any) => new Date(a.recordedAt || 0).getTime() - new Date(b.recordedAt || 0).getTime())

        const terminalStatuses = ['COMPLETED', 'DELIVERED', 'FULFILLED', 'FAILED', 'CANCELLED', 'SKIPPED']
        const nextPendingIndex = dropPoints.findIndex((point: any) => {
          const status = String(point?.status || point?.orderStatus || '').toUpperCase()
          return !terminalStatuses.includes(status)
        })
        const nextDropPoint = nextPendingIndex !== -1 ? dropPoints[nextPendingIndex] : null
        const warehouseStartLat =
          toCoordinate(trip?.warehouseLatitude) ??
          toCoordinate(trip?.warehouse?.latitude) ??
          toCoordinate(trip?.startLatitude)
        const warehouseStartLng =
          toCoordinate(trip?.warehouseLongitude) ??
          toCoordinate(trip?.warehouse?.longitude) ??
          toCoordinate(trip?.startLongitude)
        const warehouseStart =
          warehouseStartLat !== null && warehouseStartLng !== null
            ? ([warehouseStartLat, warehouseStartLng] as [number, number])
            : null

        const latestLog = logs[logs.length - 1]
        const latestLocation = trip.latestLocation
        const driverLat = Number(latestLog?.latitude ?? latestLocation?.latitude)
        const driverLng = Number(latestLog?.longitude ?? latestLocation?.longitude)
        const hasDriverPosition = Number.isFinite(driverLat) && Number.isFinite(driverLng)
        const driverName = String(trip?.driver?.user?.name || trip?.driver?.name || 'Driver')
        const vehiclePlate = String(trip?.vehicle?.licensePlate || 'N/A')
        
        const markerHeading =
          nextDropPoint &&
          Number.isFinite(Number(nextDropPoint?.latitude)) &&
          Number.isFinite(Number(nextDropPoint?.longitude)) &&
          hasDriverPosition
            ? (() => {
                const fromLat = driverLat
                const fromLng = driverLng
                const toLat = Number(nextDropPoint.latitude)
                const toLng = Number(nextDropPoint.longitude)
                const toRad = (value: number) => (value * Math.PI) / 180
                const toDeg = (value: number) => (value * 180) / Math.PI
                const phi1 = toRad(fromLat)
                const phi2 = toRad(toLat)
                const deltaLng = toRad(toLng - fromLng)
                const y = Math.sin(deltaLng) * Math.cos(phi2)
                const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLng)
                return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360
              })()
            : null

        if (hasDriverPosition && ['IN_PROGRESS'].includes(normalizedTripStatus)) {
          locations.push({
            id: `driver-${trip.id}`,
            driverName,
            vehiclePlate,
            lat: driverLat,
            lng: driverLng,
            status: String(trip?.status || 'IN_PROGRESS'),
            markerColor: '#1d4ed8',
            markerLabel: 'Current location',
            markerType: 'truck',
            markerHeading: markerHeading ?? undefined,
          })
        }

        dropPoints.forEach((dropPoint: any, index: number) => {
          const dropPointOrderId = String(dropPoint?.orderId || '').trim()
          if (dropPointOrderId) tripOrderIds.add(dropPointOrderId)

          const dpStatus = String(dropPoint?.status || '').toUpperCase()
          const isCancelledOrFailed = ['FAILED', 'CANCELLED', 'SKIPPED'].includes(dpStatus)
          const completed = isDropPointCompleted(dropPoint?.status) || isDropPointCompleted(dropPoint?.orderStatus)
          const isNext = index === nextPendingIndex
          const markerColor = completed ? '#2563eb' : (isNext ? '#ef4444' : '#16a34a')
          const markerLabel = isCancelledOrFailed ? 'Cancelled' : (completed ? 'Completed' : (isNext ? 'Next Stop' : 'Upcoming'))

          locations.push({
            id: `trip-order-${trip.id}-${dropPoint.id}`,
            driverName: String(dropPoint.orderNumber || dropPoint.locationName || 'Order Stop'),
            vehiclePlate: String(dropPoint.locationName || trip?.tripNumber || 'Trip'),
            lat: Number(dropPoint.latitude),
            lng: Number(dropPoint.longitude),
            status: String(dropPoint.orderStatus || dropPoint.status || 'PENDING'),
            markerColor,
            markerType: 'pin',
            markerLabel,
            markerNumber: Number.isFinite(Number(dropPoint?.sequence)) ? Number(dropPoint.sequence) : undefined,
          })
        })

        if (logs.length > 1) {
          routeLines.push({
            id: `completed-${trip.id}`,
            points: logs.map((log: any) => [Number(log.latitude), Number(log.longitude)] as [number, number]),
            color: '#93c5fd',
            label: `${trip.tripNumber || 'Trip'} - Completed route`,
            opacity: 0.85,
            weight: 6,
            dashArray: '7 9',
          })
        }

        const pendingPoints = dropPoints.filter(
          (point: any) => !isDropPointCompleted(point?.status) && !isDropPointCompleted(point?.orderStatus)
        )
        if (hasDriverPosition && pendingPoints.length > 0) {
          routeLines.push({
            id: `remaining-${trip.id}`,
            points: [
              [driverLat, driverLng],
              ...pendingPoints.map((point: any) => [Number(point.latitude), Number(point.longitude)] as [number, number]),
            ],
            color: '#2563eb',
            label: `${trip.tripNumber || 'Trip'} - Remaining route`,
            opacity: 1,
            weight: 8,
            snapToRoad: true,
          })
        } else if (logs.length <= 1 && dropPoints.length > 0) {
          const plannedWaypoints: [number, number][] = [
            ...(warehouseStart ? [warehouseStart] : []),
            ...dropPoints.map((point: any) => [Number(point.latitude), Number(point.longitude)] as [number, number]),
          ]
          for (let index = 0; index < plannedWaypoints.length - 1; index += 1) {
            const nextPoint = dropPoints[Math.max(0, index - (warehouseStart ? 1 : 0))]
            const completed = isDropPointCompleted(nextPoint?.status) || isDropPointCompleted(nextPoint?.orderStatus)
            routeLines.push({
              id: `planned-${trip.id}-${index}`,
              points: [
                plannedWaypoints[index],
                plannedWaypoints[index + 1],
              ],
              color: completed ? '#93c5fd' : '#2563eb',
              label: `${trip.tripNumber || 'Trip'} route segment`,
              opacity: completed ? 0.85 : 1,
              weight: completed ? 6 : 8,
              dashArray: completed ? '7 9' : undefined,
              snapToRoad: true,
            })
          }
        }
      })

    dayOrders.forEach((order: any) => {
      if (order?.id && tripOrderIds.has(order.id)) return
      const lat = Number(order?.shippingLatitude)
      const lng = Number(order?.shippingLongitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

      const shippingAddress = String(order?.shippingAddress || '').trim()
      const orderAddressLabel = shippingAddress || [
        String(order?.shippingCity || '').trim(),
        String(order?.shippingProvince || '').trim(),
        String(order?.shippingZipCode || '').trim(),
      ]
        .filter(Boolean)
        .join(', ') || 'Address unavailable'
      const completed = isCompletedOrderStatus(order?.status)
      locations.push({
        id: `warehouse-standalone-order-${order.id}`,
        driverName: String(order?.orderNumber || 'Order'),
        vehiclePlate: String(order?.shippingAddress || 'Customer location'),
        lat,
        lng,
        status: String(order?.status || 'PREPARING'),
        markerColor: completed ? '#2563eb' : '#16a34a',
        markerType: 'pin',
        markerLabel: orderAddressLabel,
      })
    })

    return { locations, routeLines }
  }, [scopedOrders, scopedTrips, trackingDate])

  const liveTrackingLocations = liveMapData.locations
  const liveTrackingRouteLines = liveMapData.routeLines
  const liveTrackingCenter = (liveTrackingLocations[0]
    ? [liveTrackingLocations[0].lat, liveTrackingLocations[0].lng]
    : [10.55, 122.95]) as [number, number]

  const liveTrackingActiveTrips = useMemo(
    () =>
      scopedTrips.filter(
        (trip) =>
          ['IN_PROGRESS'].includes(normalizeTripStatus(trip.status)) &&
          tripMatchesTrackingDay(trip)
      ),
    [scopedTrips, trackingDate]
  )

  const liveTrackingRecentLocations = useMemo(
    () =>
      liveTrackingActiveTrips
        .flatMap((trip: any) => (Array.isArray(trip?.locationLogs) ? trip.locationLogs : []))
        .filter((log: any) => Number.isFinite(Number(log?.latitude)) && Number.isFinite(Number(log?.longitude)))
        .map((log: any) => ({
          ...log,
          latitude: Number(log.latitude),
          longitude: Number(log.longitude),
        }))
        .sort((a: any, b: any) => new Date(b.recordedAt || 0).getTime() - new Date(a.recordedAt || 0).getTime())
        .slice(0, 5),
    [liveTrackingActiveTrips]
  )

  const scopedInventory = useMemo(() => {
    if (!assignedWarehouse) return inventory
    const hasInventoryWarehouseRefs = inventory.some((item) => item?.warehouse?.id)
    return hasInventoryWarehouseRefs
      ? inventory.filter((item) => item?.warehouse?.id === assignedWarehouse.id)
      : inventory
  }, [assignedWarehouse, inventory])
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
      const rawType = String(entry?.type || '').trim().toUpperCase()
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
    let resolvedOnDelivery = 0
    let needsFollowUp = 0

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
              ? 'NEEDS_FOLLOW_UP'
              : rawStatus === 'PROCESSED'
                ? 'COMPLETED'
                : rawStatus
      const qty = Number(entry?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
      if (qty > 0) {
        replacedQty += qty
      }
      if (status === 'RESOLVED_ON_DELIVERY') {
        resolvedOnDelivery += 1
      }
      if (status === 'NEEDS_FOLLOW_UP') {
        needsFollowUp += 1
      }
    }

    return {
      replacedQty,
      resolvedOnDelivery,
      needsFollowUp,
      totalCases: scopedReplacements.length,
    }
  }, [scopedReplacements])

  const lowStockCount = useMemo(
    () => scopedInventory.filter((item) => (item.quantity ?? 0) <= (item.minStock ?? 0)).length,
    [scopedInventory]
  )

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

  const weeklyTrendData = useMemo(() => {
    const thisWeekCount = new Map<string, number>()
    const lastWeekCount = new Map<string, number>()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (const order of scopedOrders) {
      if (!order?.createdAt) continue
      const orderDate = new Date(order.createdAt)
      if (Number.isNaN(orderDate.getTime())) continue
      orderDate.setHours(0, 0, 0, 0)
      const dayDiff = Math.floor((today.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24))
      if (dayDiff >= 0 && dayDiff <= 6) {
        const key = formatDayKey(orderDate)
        thisWeekCount.set(key, (thisWeekCount.get(key) || 0) + 1)
      } else if (dayDiff >= 7 && dayDiff <= 13) {
        const mappedDate = new Date(orderDate)
        mappedDate.setDate(mappedDate.getDate() + 7)
        const mappedKey = formatDayKey(mappedDate)
        lastWeekCount.set(mappedKey, (lastWeekCount.get(mappedKey) || 0) + 1)
      }
    }

    return last7Days.map((day) => ({
      day: day.label,
      thisWeek: thisWeekCount.get(day.key) || 0,
      lastWeek: lastWeekCount.get(day.key) || 0,
    }))
  }, [scopedOrders, last7Days])

  const incomeOverviewData = useMemo(() => {
    const dailyRevenue = new Map<string, number>()
    for (const order of scopedOrders) {
      if (!order?.createdAt) continue
      const orderDate = new Date(order.createdAt)
      if (Number.isNaN(orderDate.getTime())) continue
      const key = formatDayKey(orderDate)
      dailyRevenue.set(key, (dailyRevenue.get(key) || 0) + Number(order.totalAmount || 0))
    }
    return last7Days.map((day) => ({
      day: day.label,
      value: Math.round(dailyRevenue.get(day.key) || 0),
    }))
  }, [scopedOrders, last7Days])

  const weekIncome = useMemo(
    () => incomeOverviewData.reduce((sum, item) => sum + item.value, 0),
    [incomeOverviewData]
  )

  const warehouseOverviewStats = useMemo(() => {
    if (!assignedWarehouse) return null

    const warehouseId = assignedWarehouse.id
    const scopedBatches = stockBatches.filter((batch) =>
      warehouseMatches(batch?.inventory?.warehouse?.id, batch?.inventory?.warehouse?.name, batch?.inventory?.warehouse?.code)
    )

    const usedCapacity = scopedInventory.reduce((sum, item) => sum + Math.max(Number(item.quantity || 0), 0), 0)
    const configuredCapacity = Math.max(Number(assignedWarehouse.capacity || 0), 0)
    const totalCapacity = configuredCapacity > 0 ? configuredCapacity : Math.max(1000, usedCapacity + 250)
    const usagePercent = Math.min(100, Math.round((usedCapacity / totalCapacity) * 100))
    const availableCapacity = Math.max(totalCapacity - usedCapacity, 0)
    const lowStockItems = scopedInventory.filter((item) => (item.quantity ?? 0) <= (item.minStock ?? 0)).length
    const pendingOrders = scopedOrders.filter((order) =>
      ['PENDING', 'CONFIRMED', 'PREPARING'].includes(String(order.status || '').toUpperCase())
    ).length
    const inTransitTrips = scopedTrips.filter((trip) => isActiveTripStatus(trip.status)).length
    const openReplacements = scopedReplacements.filter((entry) => {
      const raw = String(entry.status || '').toUpperCase()
      const normalized = raw === 'PROCESSED' ? 'COMPLETED' : raw === 'REJECTED' ? 'NEEDS_FOLLOW_UP' : raw
      return !['RESOLVED_ON_DELIVERY', 'COMPLETED'].includes(normalized)
    }).length
    const utilizationStatus = usagePercent >= 90 ? 'Critical' : usagePercent >= 75 ? 'High' : usagePercent >= 55 ? 'Moderate' : 'Healthy'
    const skuVelocityData = scopedInventory
      .map((item) => {
        const qty = Number(item.quantity || 0)
        const reserved = Number(item.reservedQuantity || 0)
        const minStock = Number(item.minStock || 0)
        const available = Math.max(0, qty - reserved)
        const pressure = Math.max(0, minStock - available)
        const velocity = reserved + pressure
        return {
          id: item.id,
          name: item.product?.name || item.product?.sku || 'Item',
          sku: item.product?.sku || 'N/A',
          velocity,
        }
      })
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 10)

    const stockHealthCounts = scopedInventory.reduce(
      (acc, item) => {
        const qty = Number(item.quantity || 0)
        const reserved = Number(item.reservedQuantity || 0)
        const minStock = Math.max(0, Number(item.minStock || 0))
        const available = Math.max(0, qty - reserved)

        if (minStock > 0 && available <= Math.max(1, Math.floor(minStock * 0.5))) {
          acc.critical += 1
        } else if (minStock > 0 && available <= minStock) {
          acc.low += 1
        } else if (minStock > 0 && available >= minStock * 2) {
          acc.overstocked += 1
        } else {
          acc.healthy += 1
        }
        return acc
      },
      { healthy: 0, low: 0, critical: 0, overstocked: 0 }
    )
    const stockHealthDistribution = [
      { name: 'Healthy', value: stockHealthCounts.healthy, color: '#10b981' },
      { name: 'Low', value: stockHealthCounts.low, color: '#f59e0b' },
      { name: 'Critical', value: stockHealthCounts.critical, color: '#ef4444' },
      { name: 'Overstocked', value: stockHealthCounts.overstocked, color: '#3b82f6' },
    ]
    const relevantBatches = scopedBatches
      .map((batch) => ({
        quantity: Math.max(0, Number(batch.quantity || 0)),
        date: new Date(batch.receiptDate),
      }))
      .filter((entry) => !Number.isNaN(entry.date.getTime()))

    const utilizationTrend = Array.from({ length: 7 }).map((_, index) => {
      const pointDate = new Date()
      pointDate.setHours(0, 0, 0, 0)
      pointDate.setDate(pointDate.getDate() - (6 - index))

      const endOfDay = new Date(pointDate)
      endOfDay.setHours(23, 59, 59, 999)

      const additionsAfterDay = relevantBatches
        .filter((entry) => entry.date.getTime() > endOfDay.getTime())
        .reduce((sum, entry) => sum + entry.quantity, 0)

      const estimatedUsedAtDay = Math.max(0, usedCapacity - additionsAfterDay)
      const dayUtilization = totalCapacity > 0
        ? Math.min(100, Number(((estimatedUsedAtDay / totalCapacity) * 100).toFixed(1)))
        : 0

      return {
        day: pointDate.toLocaleDateString('en-US', { weekday: 'short' }),
        utilization: dayUtilization,
      }
    })

    const latestBatch = scopedBatches
      .sort((a, b) => new Date(b.receiptDate).getTime() - new Date(a.receiptDate).getTime())[0]

    const activities = [
      {
        id: 'capacity',
        label: 'Capacity update',
        detail: `${usedCapacity.toLocaleString()} units stored out of ${totalCapacity.toLocaleString()} (${usagePercent}% total usage)`,
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
          ? `${latestBatch.batchNumber} received (${new Date(latestBatch.receiptDate).toLocaleDateString()})`
          : 'No recent stock-in record found',
      },
    ]

    const recentActivities = [
      {
        id: 'r1',
        title: 'Capacity updated',
        detail: `${usagePercent}% utilization (${usedCapacity.toLocaleString()} units stored).`,
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
      totalCapacity,
      usedCapacity,
      availableCapacity,
      usagePercent,
      utilizationStatus,
      stockItemsCount: scopedInventory.length,
      lowStockItems,
      pendingOrders,
      inTransitTrips,
      openReplacements,
      capacityBreakdown: [
        { name: 'Used', value: Math.max(0, usedCapacity), color: '#3b82f6' },
        { name: 'Free', value: Math.max(0, availableCapacity), color: '#34d399' },
      ],
      skuVelocityData,
      stockHealthDistribution,
      activities,
      utilizationTrend,
      recentActivities,
    }
  }, [assignedWarehouse, scopedInventory, scopedOrders, scopedTrips, scopedReplacements, stockBatches])

  const tripStatusColors: Record<string, string> = {
    PLANNED: 'bg-blue-100 text-blue-800',
    IN_PROGRESS: 'bg-green-100 text-green-800',
    COMPLETED: 'bg-gray-100 text-gray-800',
    CANCELLED: 'bg-red-100 text-red-800',
  }

  const warehouseOrdersChartConfig = {
    thisWeek: { label: 'This Week', color: '#3b82f6' },
    lastWeek: { label: 'Last Week', color: '#1d4ed8' },
  } satisfies ChartConfig

  const safeFetchJson = async (
    input: RequestInfo | URL,
    init?: RequestInit,
    options?: { retries?: number; timeoutMs?: number }
  ) => {
    const retries = options?.retries ?? 5
    const timeoutMs = options?.timeoutMs ?? 12000
    let lastError = 'Request failed'

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
      try {
        const token = getTabAuthToken()
        const headers = new Headers(init?.headers)
        if (token && !headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`)
        }
        const response = await fetch(input, {
          ...(init || {}),
          headers,
          credentials: init?.credentials ?? 'include',
          signal: controller.signal,
        })
        const data = await response.json().catch(() => ({}))
        const dbUnavailable = Boolean(data?.dbUnavailable)
        if (response.ok && data?.success !== false && !dbUnavailable) {
          return { ok: true as const, data, status: response.status }
        }
        lastError = data?.error || `Request failed (${response.status})`
      } catch (error: any) {
        lastError = error?.name === 'AbortError' ? 'Request timed out' : error?.message || 'Request failed'
      } finally {
        window.clearTimeout(timeout)
      }

      if (attempt < retries) {
        await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)))
      }
    }

    return { ok: false as const, data: null, status: 0, error: lastError }
  }

  const fetchInventoryData = async () => {
    setLoadingInventory(true)
    try {
      const result = await safeFetchJson('/api/inventory', { cache: 'no-store' })
      if (!result.ok) {
        return
      }
      setInventory(getCollection<InventoryItem>(result.data, ['inventory']))
    } catch (error) {
      console.warn('Failed to load inventory:', error)
    } finally {
      setLoadingInventory(false)
    }
  }

  const fetchWarehousesData = async () => {
    setLoadingWarehouses(true)
    try {
      const result = await safeFetchJson('/api/warehouses', { cache: 'no-store' })
      if (!result.ok) {
        setWarehouseLoadError(result.error || 'Failed to fetch warehouses')
        return
      }
      if ((result.data as any)?.dbUnavailable) {
        setWarehouseLoadError('Warehouse data is temporarily unavailable')
        return
      }
      const list = getCollection<WarehouseItem>(result.data, ['warehouses'])
      setWarehouseLoadError(null)
      setWarehouses(list)
      const firstWarehouse = list[0]
      if (firstWarehouse?.id && !stockInWarehouseId) {
        setStockInWarehouseId(firstWarehouse.id)
      }
      if (firstWarehouse?.id && !routeWarehouseId) {
        setRouteWarehouseId(firstWarehouse.id)
      }
    } catch (error) {
      setWarehouseLoadError('Failed to fetch warehouses')
      console.warn('Failed to load warehouses:', error)
    } finally {
      setLoadingWarehouses(false)
    }
  }

  const fetchProductsData = async () => {
    try {
      const result = await safeFetchJson('/api/products?page=1&pageSize=500', { cache: 'no-store' })
      if (!result.ok) {
        return
      }
      setProducts(getCollection<ProductOption>(result.data, ['products']))
    } catch (error) {
      console.warn('Failed to load products:', error)
    }
  }

  const fetchStockBatchesData = async () => {
    setLoadingBatches(true)
    try {
      const result = await safeFetchJson('/api/stock-batches?page=1&pageSize=200', { cache: 'no-store' })
      if (!result.ok) {
        return
      }
      setStockBatches(getCollection<StockBatchItem>(result.data, ['stockBatches']))
    } catch (error) {
      console.warn('Failed to load stock-in batches:', error)
    } finally {
      setLoadingBatches(false)
    }
  }

  const fetchOrderMarker = async () => {
    const result = await safeFetchJson('/api/orders?limit=1&includeItems=none', { cache: 'no-store', credentials: 'include' })
    if (!result.ok) {
      throw new Error(result.error || 'Failed orders fetch')
    }
    const topOrder = getCollection<WarehouseOrderItem>(result.data, ['orders'])[0]
    return `${Number((result.data as any)?.total || 0)}::${topOrder?.id || ''}`
  }

  const fetchOrdersData = async (options?: { showLoading?: boolean; onlyIfNew?: boolean; silent?: boolean }) => {
    const showLoading = options?.showLoading ?? true
    const onlyIfNew = options?.onlyIfNew ?? false
    const silent = options?.silent ?? false
    if (showLoading) setLoadingOrders(true)
    try {
      if (onlyIfNew && latestOrderMarkerRef.current) {
        const incomingMarker = await fetchOrderMarker()
        if (incomingMarker === latestOrderMarkerRef.current) {
          return
        }
      }

      const requestOrders = () =>
        safeFetchJson('/api/orders?limit=300&includeItems=none', { cache: 'no-store', credentials: 'include' })

      let result = await requestOrders()

      if (result.status === 401 || result.status === 403) {
        clearTabAuthToken()
        result = await requestOrders()
      }

      if (!result.ok) {
        throw new Error(result.error || 'Failed orders fetch')
      }

      const list = getCollection<WarehouseOrderItem>(result.data, ['orders'])
      setOrders(list)
      latestOrderMarkerRef.current = `${Number((result.data as any)?.total || 0)}::${list[0]?.id || ''}`
    } catch (error: any) {
      console.warn('Failed to load orders:', error)
    } finally {
      if (showLoading) setLoadingOrders(false)
    }
  }

  const fetchTripsData = async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading !== false
    if (showLoading) setLoadingTrips(true)
    try {
      const normalizedTrackingDate =
        /^\d{4}-\d{2}-\d{2}$/.test(String(trackingDate || '').trim())
          ? String(trackingDate).trim()
          : ''
      const query = new URLSearchParams({
        limit: '200',
        includeTracking: '1',
      })
      if (normalizedTrackingDate) {
        query.set('trackingDate', normalizedTrackingDate)
      }
      const result = await safeFetchJson(`/api/trips?${query.toString()}`, { cache: 'no-store' })
      if (!result.ok) {
        return
      }
      setTrips(getCollection<WarehouseTripItem>(result.data, ['trips']))
    } catch (error: any) {
      console.warn('Failed to load trips:', error)
    } finally {
      if (showLoading) setLoadingTrips(false)
    }
  }

  const fetchInventoryTransactionsData = async () => {
    setLoadingInventoryTransactions(true)
    try {
      const result = await safeFetchJson('/api/inventory-transactions?limit=1000', { cache: 'no-store' })
      if (!result.ok) {
        return
      }
      setInventoryTransactions(getCollection<InventoryTransactionItem>(result.data, ['transactions']))
    } catch (error) {
      console.warn('Failed to load inventory transactions:', error)
    } finally {
      setLoadingInventoryTransactions(false)
    }
  }

  const fetchReplacementsData = async () => {
    setLoadingReplacements(true)
    try {
      let result = await safeFetchJson('/api/replacements?limit=300', { cache: 'no-store' })
      if (!result.ok) {
        result = await safeFetchJson('/api/orders?includeReplacements=true&includeOrders=false&includeItems=none&limit=300', { cache: 'no-store' })
      }
      if (!result.ok) return
      setReplacements(getCollection<WarehouseReplacementItem>(result.data, ['replacements']))
    } catch (error) {
      console.warn('Failed to load replacements:', error)
    } finally {
      setLoadingReplacements(false)
    }
  }

  const fetchDriversData = async () => {
    try {
      const result = await safeFetchJson('/api/drivers?includeSample=true')
      if (!result.ok) {
        return
      }
      const list = getCollection<DriverOption>(result.data, ['drivers'])
      setDrivers(list)
      const preferredDriver =
        list.find((driver) => driver?.isActive !== false && (driver.vehicles || []).some((entry) => entry?.vehicle?.id)) ||
        list.find((driver) => driver?.isActive !== false) ||
        list[0]

      if (preferredDriver?.id && !selectedRouteDriverId) {
        setSelectedRouteDriverId(preferredDriver.id)
      }
    } catch (error) {
      console.warn('Failed to load drivers:', error)
    }
  }

  const fetchVehiclesData = async () => {
    try {
      const result = await safeFetchJson('/api/vehicles?status=AVAILABLE')
      if (!result.ok) {
        return
      }
      const list = getCollection<VehicleOption>(result.data, ['vehicles'])
      setVehicles(list)
      if (list[0]?.id && !selectedRouteVehicleId) {
        setSelectedRouteVehicleId(list[0].id)
      }
    } catch (error) {
      console.warn('Failed to load vehicles:', error)
    }
  }

  const fetchSavedRoutesData = async () => {
    try {
      const result = await safeFetchJson('/api/trips/saved-routes?limit=200', { cache: 'no-store' })
      if (!result.ok) {
        return
      }
      if ((result.data as any)?.success === false) {
        return
      }
      setSavedRoutes(getCollection<SavedRouteDraft>(result.data, ['savedRoutes']))
    } catch (error) {
      console.warn('Failed to load saved routes:', error)
    }
  }

  const createRoutePlan = async (silent = false, inputDate?: string, inputWarehouseId?: string) => {
    const effectiveDate = inputDate ?? routeDate
    const effectiveWarehouseId = inputWarehouseId ?? routeWarehouseId
    if (!effectiveDate || !effectiveWarehouseId) {
      if (!silent) toast.error('Select route date and warehouse')
      setRoutePlanMessage({ type: 'error', text: 'Select route date and warehouse first.' })
      return false
    }
    setLoadingRoutePlans(true)
    setRoutePlanMessage(null)
    setRoutePlans([])
    setSelectedRouteCity('')
    setSelectedRouteOrderIds([])
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    try {
      const query = new URLSearchParams({
        date: effectiveDate,
        warehouseId: effectiveWarehouseId,
      })
      const response = await fetch(`/api/trips/route-plan?${query.toString()}`, {
        signal: controller.signal,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to generate route plan')
      }

      const plans = getCollection<RoutePlanCityGroup>(data, ['routePlans'])
      setRoutePlans(plans)
      setSelectedRouteCity(plans[0]?.city || '')
      setSelectedRouteOrderIds(plans[0]?.orders?.map((order) => order.id) || [])
      if (plans.length === 0) {
        setRoutePlanMessage({
          type: 'info',
          text: 'No eligible orders found for that delivery date.',
        })
      } else {
        setRoutePlanMessage({ type: 'success', text: `Found ${plans.length} city group(s) for this delivery date.` })
        if (!silent) toast.success('Filtered scheduled orders by city')
      }
      return plans.length > 0
    } catch (error: any) {
      const message =
        error?.name === 'AbortError' ? 'Request timed out. Please try again.' : error?.message || 'Failed to generate route plan'
      if (!silent) toast.error(message)
      setRoutePlanMessage({ type: 'error', text: message })
      setRoutePlans([])
      setSelectedRouteCity('')
      setSelectedRouteOrderIds([])
      return false
    } finally {
      clearTimeout(timeout)
      setLoadingRoutePlans(false)
    }
  }

  const handleRouteOrderClick = (city: string, orderId: string) => {
    setSelectedRouteCity(city)
    setSelectedRouteOrderIds((prev) => {
      const belongsToCity = routePlans.find((group) => group.city === city)?.orders?.some((order) => order.id === orderId)
      if (!belongsToCity) return [orderId]
      if (prev.includes(orderId)) {
        const next = prev.filter((id) => id !== orderId)
        return next.length > 0 ? next : [orderId]
      }
      return [...prev, orderId]
    })
  }

  const createTripFromRoute = async () => {
    if (!selectedSavedRoute || !selectedRouteDriverId) {
      toast.error('Select a saved route and driver first')
      return
    }
    if (selectedSavedRoute.orderIds.length === 0) {
      toast.error('Selected saved route has no orders')
      return
    }
    if (!selectedDriverAssignedVehicle?.id) {
      toast.error('Selected driver has no assigned vehicle')
      return
    }
    setCreatingTripFromRoute(true)
    try {
      const response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plannedStartAt: selectedSavedRoute.date,
          status: 'PLANNED',
          warehouseId: selectedSavedRoute.warehouseId,
          driverId: selectedRouteDriverId,
          vehicleId: selectedDriverAssignedVehicle.id,
          orderIds: selectedSavedRoute.orderIds,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to create trip')
      }
      toast.success('Trip created from route')
      const createdTrip = data?.trip
      if (createdTrip) {
        setTrips((prev) => [createdTrip, ...prev.filter((trip) => trip.id !== createdTrip.id)])
      }
      setSavedRoutes((prev) => prev.filter((route) => route.id !== selectedSavedRoute.id))
      setSelectedSavedRouteId('')
      setCreateTripOpen(false)
      emitDataSync(['trips', 'orders'])
      void (async () => {
        try {
          await deleteSavedRouteDraft(selectedSavedRoute.id)
        } catch (deleteError) {
          console.error('Failed to delete saved route:', deleteError)
        }
        await Promise.all([
          fetchTripsData({ showLoading: false }),
          fetchOrdersData({ showLoading: false, silent: true }),
        ])
      })()
    } catch (error: any) {
      const message = String(error?.message || 'Failed to create trip')
      const lowerMessage = message.toLowerCase()

      if (lowerMessage.includes('no eligible orders') || lowerMessage.includes('already assigned')) {
        try {
          await deleteSavedRouteDraft(selectedSavedRoute.id)
        } catch (deleteError) {
          console.error('Failed to delete stale saved route:', deleteError)
        }
        setSavedRoutes((prev) => prev.filter((route) => route.id !== selectedSavedRoute.id))
        setSelectedSavedRouteId('')
        setCreateTripOpen(false)
        emitDataSync(['trips', 'orders'])
        void Promise.all([
          fetchTripsData({ showLoading: false }),
          fetchOrdersData({ showLoading: false, silent: true }),
        ])
        toast.success('Trip data refreshed. Stale saved route was removed.')
      } else {
        toast.error(message)
      }
    } finally {
      setCreatingTripFromRoute(false)
    }
  }

  const saveRouteDraft = async () => {
    if (!routeDate || !routeWarehouseId || !selectedRouteCity || selectedRouteOrderIds.length === 0) {
      toast.error('Select date, warehouse, city and at least one order')
      return
    }

    const warehouse = warehouses.find((w) => w.id === routeWarehouseId)
    const group = routePlans.find((g) => g.city === selectedRouteCity)
    const selectedOrders = (group?.orders || []).filter((order) => selectedRouteOrderIds.includes(order.id))

    if (!group || selectedOrders.length === 0) {
      toast.error('No orders selected for this route')
      return
    }

    try {
      const response = await fetch('/api/trips/saved-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: routeDate,
          warehouseId: routeWarehouseId,
          warehouseName: warehouse?.name || 'Unknown Warehouse',
          city: selectedRouteCity,
          totalDistanceKm: Number(group.totalDistanceKm || 0),
          orderIds: selectedRouteOrderIds,
          orders: selectedOrders,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to save route')
      }

      const savedRoute = data?.savedRoute
      if (savedRoute?.id) {
        setSavedRoutes((prev) => [savedRoute, ...prev.filter((route) => route.id !== savedRoute.id)])
        setSelectedSavedRouteId(savedRoute.id)
      } else {
        await fetchSavedRoutesData()
      }

      setCreateRouteOpen(false)
      toast.success('Route saved. Assign driver later in New Trip.')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save route')
    }
  }

  useEffect(() => {
    const refreshAllData = async (options?: { initial?: boolean }) => {
      if (isRefreshingAllRef.current) return
      isRefreshingAllRef.current = true
      const initial = options?.initial ?? false
      try {
        await fetchInventoryData()
        await fetchWarehousesData()
        await fetchProductsData()
        await fetchStockBatchesData()
        await fetchInventoryTransactionsData()
        await (initial
          ? fetchOrdersData({ showLoading: true })
          : fetchOrdersData({ showLoading: false, onlyIfNew: true, silent: true }))
        await fetchTripsData()
        await fetchReplacementsData()
        await fetchDriversData()
        await fetchVehiclesData()
        await fetchSavedRoutesData()
      } finally {
        isRefreshingAllRef.current = false
      }
    }

    void refreshAllData({ initial: true })

    const unsubscribe = subscribeDataSync((message) => {
      if (isRefreshingAllRef.current) return
      const scopes = message.scopes
      if (scopes.some((scope) => ['inventory', 'products', 'stock-batches', 'inventory-transactions', 'warehouses'].includes(scope))) {
        void (async () => {
          await fetchInventoryData()
          await fetchProductsData()
          await fetchStockBatchesData()
          await fetchInventoryTransactionsData()
          await fetchWarehousesData()
        })()
      }
      if (scopes.includes('orders')) {
        void fetchOrdersData({ showLoading: false, onlyIfNew: true, silent: true })
      }
      if (scopes.includes('trips')) {
        void fetchTripsData()
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

    const onFocus = () => { void refreshAllData() }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshAllData()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const intervalId = window.setInterval(() => { void refreshAllData() }, 30000)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    const refreshOrdersQuick = () => {
      const shouldRefresh =
        activeView === 'orders' || activeView === 'dashboard' || activeView === 'trips'
      if (!shouldRefresh) return
      if (document.visibilityState !== 'visible') return
      if (isRefreshingAllRef.current) return
      void fetchOrdersData({ showLoading: false, onlyIfNew: true, silent: true })
    }

    refreshOrdersQuick()
    const intervalId = window.setInterval(refreshOrdersQuick, 5000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'liveTracking') return
    void Promise.all([
      fetchTripsData(),
      fetchOrdersData({ showLoading: false, silent: true }),
    ])
  }, [activeView, trackingDate])

  const handleLogout = async () => {
    await logout()
    toast.success('Logged out')
  }

  const openOrderDetail = async (order: WarehouseOrderItem) => {
    setSelectedOrder(order)
    const hasItems = Array.isArray(order.items) && order.items.length > 0
    setLoadingOrderDetail(!hasItems)
    try {
      const response = await fetch(`/api/orders/${order.id}`, { cache: 'no-store', credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false || !payload?.order) return
      setSelectedOrder(payload.order as WarehouseOrderItem)
    } catch (error) {
      console.error('Failed to load order details:', error)
    } finally {
      setLoadingOrderDetail(false)
    }
  }

  const fetchNotifications = async () => {
    setNotificationsLoading(true)
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' })
      if (!response.ok) return

      const payload = await response.json()
      const list = Array.isArray(payload?.notifications) ? payload.notifications : []
      setNotifications(list)
      setUnreadNotifications(Number(payload?.unreadCount || 0))
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
    } finally {
      setNotificationsLoading(false)
    }
  }

  const markAllNotificationsAsRead = async () => {
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
      })
      if (!response.ok) return
      setUnreadNotifications(0)
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })))
    } catch (error) {
      console.error('Failed to mark notifications as read:', error)
    }
  }

  const handleNotificationsOpen = async (open: boolean) => {
    if (!open) return
    await fetchNotifications()
    if (unreadNotifications > 0) {
      await markAllNotificationsAsRead()
    }
  }

  const formatNotificationTime = (createdAt: string) => {
    const date = new Date(createdAt)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString()
  }

  useEffect(() => {
    fetchNotifications()
    const interval = window.setInterval(() => {
      fetchNotifications()
    }, 60000)

    return () => window.clearInterval(interval)
  }, [])

  const getAvailableQty = (item: InventoryItem) => Math.max(0, (item.quantity ?? 0) - (item.reservedQuantity ?? 0))

  const getStockStatus = (item: InventoryItem) => {
    const qty = item.quantity ?? 0
    const min = item.minStock ?? 0
    return qty <= min ? 'restock' : 'healthy'
  }

  const openEditDialog = (item: InventoryItem) => {
    setEditingItem(item)
    setDeleteEditOpen(false)
    setEditName(item.product?.name || '')
    setEditSku(item.product?.sku || '')
    setEditUnit(item.product?.unit || 'case')
    setEditImageUrl(item.product?.imageUrl || '')
    setEditImageFile(null)
    setEditPrice(String(item.product?.price ?? 0))
    setEditThreshold(String(item.minStock ?? 0))
    setEditQuantity(String(item.quantity ?? 0))
  }

  const uploadProductImage = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/uploads/product-image', {
      method: 'POST',
      body: formData,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.success === false || !payload?.imageUrl) {
      throw new Error(payload?.error || 'Failed to upload image')
    }
    return String(payload.imageUrl)
  }

  const saveInventoryEdit = async () => {
    if (!editingItem) return
    if (!editingItem.product?.id) {
      toast.error('Missing product reference')
      return
    }

    const nextPrice = Number(editPrice)
    const nextThreshold = Number(editThreshold)
    const nextQuantity = Number(editQuantity)

    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      toast.error('Price must be a non-negative number')
      return
    }
    if (!Number.isFinite(nextThreshold) || nextThreshold < 0) {
      toast.error('Threshold must be a non-negative number')
      return
    }
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
      toast.error('Quantity must be a non-negative number')
      return
    }
    if (!editName.trim() || !editSku.trim() || !editUnit.trim()) {
      toast.error('Name, SKU, and unit are required')
      return
    }

    setIsSavingEdit(true)
    try {
      const uploadedImageUrl = editImageFile ? await uploadProductImage(editImageFile) : editImageUrl || null

      const productResponse = await fetch(`/api/products/${editingItem.product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          sku: editSku.trim(),
          unit: editUnit.trim(),
          imageUrl: uploadedImageUrl,
          price: nextPrice,
        }),
      })
      const productPayload = await productResponse.json().catch(() => ({}))
      if (!productResponse.ok || productPayload?.success === false) {
        throw new Error(productPayload?.error || 'Failed to update product')
      }

      const inventoryResponse = await fetch(`/api/inventory/${editingItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: nextQuantity,
          minStock: nextThreshold,
        }),
      })
      const inventoryPayload = await inventoryResponse.json().catch(() => ({}))
      if (!inventoryResponse.ok || inventoryPayload?.success === false) {
        throw new Error(inventoryPayload?.error || 'Failed to update inventory')
      }

      toast.success('Inventory item updated')
      setEditingItem(null)
      await fetchInventoryData()
      await fetchProductsData()
      await fetchStockBatchesData()
      await fetchInventoryTransactionsData()
      emitDataSync(['inventory', 'products', 'stock-batches', 'inventory-transactions'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save changes')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const deleteInventoryProduct = async () => {
    if (!editingItem?.product?.id) {
      toast.error('Missing product reference')
      return
    }

    setIsDeletingEdit(true)
    try {
      const response = await fetch(`/api/products/${editingItem.product.id}`, {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to delete product')
      }

      setEditingItem(null)
      setDeleteEditOpen(false)
      toast.success('Product deleted')
      await fetchInventoryData()
      await fetchProductsData()
      await fetchStockBatchesData()
      await fetchInventoryTransactionsData()
      emitDataSync(['inventory', 'products', 'stock-batches', 'inventory-transactions'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete product')
    } finally {
      setIsDeletingEdit(false)
    }
  }

  const resetStockInForm = () => {
    setIsNewProduct(false)
    setSelectedProductId('')
    setStockInQty('')
    setStockInExpiryDate('')
    setStockInThreshold('')
    setNewProductName('')
    setNewProductDescription('')
    setNewProductPrice('')
    setNewProductUnit('case')
    setNewProductImageFile(null)
  }

  const addStockInBatch = async () => {
    const qty = Number(stockInQty)
    if (!stockInWarehouseId) {
      toast.error('Please select a warehouse')
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Quantity should be greater than 0')
      return
    }
    if (isNewProduct && !newProductName.trim()) {
      toast.error('New product name is required')
      return
    }
    if (!isNewProduct && !selectedProductId) {
      toast.error('Please select an existing product')
      return
    }

    setIsSubmittingStockIn(true)
    try {
      const uploadedImageUrl = isNewProduct && newProductImageFile ? await uploadProductImage(newProductImageFile) : null

      const response = await fetch('/api/stock-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: stockInWarehouseId,
          quantity: qty,
          expiryDate: stockInExpiryDate || null,
          threshold: isNewProduct && stockInThreshold ? Number(stockInThreshold) : undefined,
          isNewProduct,
          productId: isNewProduct ? undefined : selectedProductId,
          productName: isNewProduct ? newProductName.trim() : undefined,
          description: isNewProduct ? newProductDescription.trim() || null : undefined,
          unit: isNewProduct ? newProductUnit : undefined,
          price: isNewProduct ? Number(newProductPrice || 0) : undefined,
          imageUrl: isNewProduct ? uploadedImageUrl : undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to add stock')
      }

      toast.success('Stock added successfully')
      setAddStockOpen(false)
      resetStockInForm()
      await fetchInventoryData()
      await fetchStockBatchesData()
      await fetchProductsData()
      await fetchInventoryTransactionsData()
      emitDataSync(['inventory', 'products', 'stock-batches', 'inventory-transactions'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add stock')
    } finally {
      setIsSubmittingStockIn(false)
    }
  }

  const getDaysLeft = (expiryDate: string | null) => {
    if (!expiryDate) return null
    const end = new Date(expiryDate).getTime()
    const start = new Date().getTime()
    return Math.ceil((end - start) / (1000 * 60 * 60 * 24))
  }

  const formatWarehouseOrderStatus = (status: string, paymentStatus?: string) => {
    if (String(paymentStatus || '').toLowerCase() === 'pending_approval') {
      return 'PENDING'
    }
    const raw = String(status || '').toUpperCase()
    if (['PROCESSING', 'PACKED', 'READY_FOR_PICKUP', 'UNAPPROVED'].includes(raw)) return 'PREPARING'
    if (['DISPATCHED', 'IN_TRANSIT'].includes(raw)) return 'OUT FOR DELIVERY'
    if (raw === 'FAILED_DELIVERY') return 'CANCELLED'
    return raw.replace(/_/g, ' ')
  }

  const formatWarehouseStage = (stage: string | null | undefined) => {
    const value = String(stage || 'READY_TO_LOAD').toUpperCase()
    return value.replace(/_/g, ' ')
  }

  const formatWarehouseOrderAddress = (order: WarehouseOrderItem | null) => {
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

  const updateWarehouseOrderStatus = async (
    orderId: string,
    status: 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED',
    reason?: string
  ) => {
    setUpdatingOrderId(orderId)
    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reason }),
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
        const backendError =
          payload?.error ||
          payload?.message ||
          (typeof payload?.raw === 'string' ? payload.raw.replace(/<[^>]*>/g, ' ').trim().slice(0, 180) : '')
        throw new Error(
          backendError
            ? `Failed to update status (HTTP ${response.status}): ${backendError}`
            : `Failed to update status (HTTP ${response.status})`
        )
      }

      const updatedOrder = payload?.order || {}
      setOrders((prev) => prev.map((order) => (order.id === orderId ? { ...order, ...updatedOrder, status, notes: reason || order.notes } : order)))
      setSelectedOrder((prev) => (prev && prev.id === orderId ? { ...prev, ...updatedOrder, status, notes: reason || prev.notes } : prev))
      toast.success('Order status updated')
      emitDataSync(['orders', 'trips'])
      void Promise.all([
        fetchOrdersData({ showLoading: false, silent: true }),
        fetchTripsData({ showLoading: false }),
      ])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update order status')
    } finally {
      setUpdatingOrderId(null)
    }
  }

  const parseIssueMeta = (notes: string | null | undefined) => {
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

  const buildReplacementLines = (replacement: any, meta: any) => {
    const sourceLines = Array.isArray(replacement?.replacementLines) && replacement.replacementLines.length
      ? replacement.replacementLines
      : Array.isArray(meta?.replacementLines) && meta.replacementLines.length
        ? meta.replacementLines
        : Array.isArray(replacement?.replacementItems) && replacement.replacementItems.length
          ? replacement.replacementItems
          : Array.isArray(meta?.replacementItems) && meta.replacementItems.length
            ? meta.replacementItems
        : []
    const fallbackLine = {
      originalProductName: replacement?.originalProductName || meta?.originalProductName || 'N/A',
      replacementProductName: replacement?.replacementProductName || meta?.replacementProductName || replacement?.originalProductName || meta?.originalProductName || 'N/A',
      quantityToReplace: replacement?.quantityToReplace ?? meta?.quantityToReplace ?? meta?.damagedQuantity ?? replacement?.replacementQuantity ?? meta?.replacementQuantity ?? 0,
      quantityReplaced: replacement?.quantityReplaced ?? meta?.quantityReplaced ?? replacement?.replacementQuantity ?? meta?.replacementQuantity ?? 0,
    }
    const lines = sourceLines.length ? sourceLines : [fallbackLine]
    return lines.map((line: any) => ({
      originalProductName: String(line?.originalProductName || line?.productName || fallbackLine.originalProductName || 'N/A'),
      replacementProductName: String(line?.replacementProductName || line?.replacementProduct?.name || line?.originalProductName || fallbackLine.replacementProductName || 'N/A'),
      quantityToReplace: Number(line?.quantityToReplace ?? line?.damagedQuantity ?? fallbackLine.quantityToReplace ?? 0),
      quantityReplaced: Number(line?.quantityReplaced ?? line?.replacedQuantity ?? fallbackLine.quantityReplaced ?? 0),
    }))
  }

  const formatIssueStatus = (entry: WarehouseReplacementItem) => {
    const rawStatus = String(entry?.status || '').toUpperCase()
    const normalizedStatus =
      rawStatus === 'REQUESTED'
        ? 'REPORTED'
        : ['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)
          ? 'IN_PROGRESS'
          : rawStatus === 'REJECTED'
            ? 'NEEDS_FOLLOW_UP'
            : rawStatus === 'PROCESSED'
              ? 'COMPLETED'
              : rawStatus
    if (normalizedStatus === 'RESOLVED_ON_DELIVERY') return 'Resolved on Delivery'
    if (normalizedStatus === 'NEEDS_FOLLOW_UP') return 'Needs Follow-up'
    if (normalizedStatus === 'COMPLETED') return 'Completed'
    if (normalizedStatus === 'IN_PROGRESS') return 'In Progress'
    return 'Reported'
  }

  const updateIssueStatus = async (
    replacementId: string,
    status: 'COMPLETED' | 'NEEDS_FOLLOW_UP',
    notes?: string
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
          notes,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update replacement')
      }

      toast.success(status === 'COMPLETED' ? 'Replacement marked as completed' : 'Replacement marked for follow-up')
      emitDataSync(['replacements', 'orders'])
      setReplacements((prev) => prev.map((entry) => (entry.id === replacementId ? { ...entry, status, notes: notes || entry.notes } : entry)))
      setSelectedReplacement((current) => (current?.id === replacementId ? { ...current, status, notes: notes || current.notes } : current))
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

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      <div className="border-b border-white/20 bg-white/10 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <img
            src="/ann-anns-logo.png"
            alt="Ann Ann's Beverages Trading logo"
            className="h-11 w-11 rounded-xl border border-white/40 object-cover shadow-[0_10px_24px_rgba(15,23,42,0.14)]"
          />
          <div>
            <h2 className="font-bold text-slate-950">Ann Ann's Beverages Trading</h2>
            <p className="text-xs text-slate-600">Warehouse Portal</p>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 p-2">
        <nav className="space-y-1">
          {sidebarNavItems.map((navItem) => (
            <Button
              key={navItem.id}
              variant={activeView === navItem.id ? 'secondary' : 'ghost'}
              className={`w-full justify-start gap-3 ${
                activeView === navItem.id
                  ? 'border border-white/50 bg-linear-to-r from-cyan-600/95 via-sky-600/95 to-emerald-500/90 text-white shadow-[0_14px_30px_rgba(8,145,178,0.26)]'
                  : 'text-slate-700 hover:bg-white/45 hover:text-slate-950'
              }`}
              onClick={() => {
                setActiveView(navItem.id)
                setSidebarOpen(false)
              }}
            >
              <navItem.icon className="h-4 w-4" />
              {navItem.label}
            </Button>
          ))}
        </nav>
      </ScrollArea>

    </div>
  )

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(103,232,249,0.28),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.16),_transparent_32%),linear-gradient(145deg,_#eef9ff_0%,_#eefcf6_46%,_#f6fbff_100%)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-14 top-10 h-64 w-64 rounded-full bg-cyan-200/20 blur-3xl" />
        <div className="absolute right-[-4rem] top-28 h-72 w-72 rounded-full bg-sky-300/15 blur-3xl" />
        <div className="absolute bottom-[-5rem] left-1/3 h-80 w-80 rounded-full bg-emerald-200/20 blur-3xl" />
      </div>
      <aside className="relative z-[1] hidden w-64 flex-col border-r border-white/25 bg-white/38 shadow-[0_24px_50px_rgba(15,23,42,0.12)] backdrop-blur-2xl lg:flex">
        <Sidebar />
      </aside>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-64 border-white/30 bg-white/44 p-0 shadow-[0_24px_60px_rgba(15,23,42,0.2)] backdrop-blur-2xl">
          <Sidebar />
        </SheetContent>
      </Sheet>

      <div className="relative z-[1] flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-white/25 bg-white/42 backdrop-blur-2xl">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" className="text-slate-700 hover:bg-white/45 hover:text-slate-950 lg:hidden" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-5 w-5" />
              </Button>
              <div className="relative hidden md:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input placeholder="Search inventory, warehouse..." className="w-64 border-white/40 bg-white/50 pl-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-md" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <DropdownMenu onOpenChange={(open) => { void handleNotificationsOpen(open) }}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative text-slate-700 hover:bg-white/45 hover:text-slate-950">
                    <Bell className="h-5 w-5" />
                    {unreadNotifications > 0 && <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <div className="px-2 py-1.5 text-sm font-medium">Notifications</div>
                  <DropdownMenuSeparator />
                  {notificationsLoading ? (
                    <div className="px-2 py-3 text-sm text-gray-500">Loading notifications...</div>
                  ) : notifications.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-gray-500">No notifications yet.</div>
                  ) : (
                    notifications.slice(0, 8).map((item) => (
                      <div key={item.id} className="px-2 py-2 border-b last:border-b-0">
                        <p className="text-sm font-medium text-gray-900">{item.title}</p>
                        <p className="text-xs text-gray-600">{item.message}</p>
                        <p className="text-[11px] text-gray-500 mt-1">{formatNotificationTime(item.createdAt)}</p>
                      </div>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 text-slate-700 hover:bg-white/45 hover:text-slate-950">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-linear-to-br from-cyan-600 to-emerald-600 text-sm text-white shadow-[0_8px_18px_rgba(8,145,178,0.28)]">
                        {user?.name?.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden md:inline">{user?.name}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <p className="font-medium">{user?.name}</p>
                    <p className="text-xs text-gray-500">{user?.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">
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
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Warehouse Dashboard</h1>
                <p className="text-gray-500">Warehouse operations and stock health overview</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
                  <CardContent className="flex h-full items-start gap-3 p-5">
                    <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
                      <Warehouse className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-500">Assigned Warehouse</p>
                      <p className="mt-1 text-3xl font-bold leading-none">{assignedWarehouse ? 1 : 0}</p>
                      <p className="mt-1 text-xs text-gray-500 truncate">
                        {assignedWarehouse ? `${assignedWarehouse.name} (${assignedWarehouse.code})` : 'No warehouse assigned'}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
                  <CardContent className="flex h-full items-start gap-3 p-5">
                    <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
                      <Boxes className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-500">Inventory Items</p>
                      <p className="mt-1 text-3xl font-bold leading-none">{scopedInventory.length}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
                  <CardContent className="flex h-full items-start gap-3 p-5">
                    <div className="rounded-xl bg-rose-50 p-2.5 text-rose-600">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-500">Low Stock</p>
                      <p className="mt-1 text-3xl font-bold leading-none text-red-600">{lowStockCount}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <Card className="xl:col-span-2">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Orders This Week vs Last Week</CardTitle>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">Month</span>
                        <span className="rounded-md border border-blue-400 px-2 py-0.5 text-blue-600">Week</span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ChartContainer config={warehouseOrdersChartConfig} className="h-[320px] w-full">
                      <AreaChart data={weeklyTrendData} margin={{ left: 8, right: 8, top: 12, bottom: 0 }}>
                        <defs>
                          <linearGradient id="fillThisWeekWh" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.45} />
                            <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.08} />
                          </linearGradient>
                          <linearGradient id="fillLastWeekWh" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#1d4ed8" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#1d4ed8" stopOpacity={0.04} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <YAxis axisLine={false} tickLine={false} width={28} domain={[0, 'auto']} />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} />
                        <Area type="monotone" dataKey="thisWeek" stroke="#3b82f6" strokeWidth={2.5} fill="url(#fillThisWeekWh)" dot={false} />
                        <Area type="monotone" dataKey="lastWeek" stroke="#1d4ed8" strokeWidth={2} fill="url(#fillLastWeekWh)" dot={false} />
                      </AreaChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>This Week Statistics</CardDescription>
                    <CardTitle className="text-3xl">{formatPeso(weekIncome)}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[250px] flex items-end gap-3">
                      {(() => {
                        const max = Math.max(...incomeOverviewData.map((d) => Number(d.value) || 0), 1)
                        return incomeOverviewData.map((item) => {
                          const percent = Math.max(0, Math.min(100, ((Number(item.value) || 0) / max) * 100))
                          return (
                            <div key={item.day} className="flex-1 flex flex-col items-center gap-2">
                              <div className="flex-1 w-full rounded-t-md bg-cyan-100/50 relative min-h-[4px] overflow-hidden">
                                <div
                                  className="absolute bottom-0 left-0 right-0 rounded-t-md bg-cyan-400 min-h-[4px]"
                                  style={{ height: `${percent}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-gray-500">{item.day}</span>
                            </div>
                          )
                        })
                      })()}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <CardTitle>Inventory Transactions</CardTitle>
                      <CardDescription>All inventory movement records for this warehouse.</CardDescription>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Input
                        type="date"
                        value={transactionDateFrom}
                        onChange={(event) => {
                          setTransactionDateFrom(event.target.value)
                          setTransactionDatePreset('custom')
                        }}
                        className="h-9"
                      />
                      <select
                        value={transactionDatePreset}
                        onChange={(event) => setTransactionDatePreset(event.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="custom">Custom range</option>
                        <option value="past_7_days">Past 7 days</option>
                        <option value="past_14_days">Past 14 days</option>
                        <option value="past_1_month">Past 1 month</option>
                        <option value="past_3_months">Past 3 months</option>
                        <option value="past_6_months">Past 6 months</option>
                        <option value="past_1_year">Past 1 year</option>
                      </select>
                      <select
                        value={transactionTypeFilter}
                        onChange={(event) => setTransactionTypeFilter(event.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="all">All types</option>
                        {availableInventoryTransactionTypes.map((type) => (
                          <option key={type} value={type}>
                            {type.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {loadingInventoryTransactions ? (
                    <div className="h-40 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                    </div>
                  ) : filteredInventoryTransactions.length === 0 ? (
                    <div className="h-40 flex items-center justify-center text-gray-500">No inventory transactions found</div>
                  ) : (
                    <div className="max-h-[380px] overflow-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b sticky top-0 z-10">
                          <tr>
                            <th className="text-left p-4 font-medium text-gray-600">Date</th>
                            <th className="text-left p-4 font-medium text-gray-600">Type</th>
                            <th className="text-left p-4 font-medium text-gray-600">Product</th>
                            <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                            <th className="text-left p-4 font-medium text-gray-600">Qty</th>
                            <th className="text-left p-4 font-medium text-gray-600">Reference</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredInventoryTransactions.map((entry) => (
                            <tr key={entry.id} className="border-b last:border-0 hover:bg-gray-50">
                              <td className="p-4">{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'N/A'}</td>
                              <td className="p-4">
                                <Badge variant="outline">{String(entry.type || 'N/A').replace(/_/g, ' ')}</Badge>
                              </td>
                              <td className="p-4">{entry.product?.name || 'N/A'}</td>
                              <td className="p-4">{entry.product?.sku || 'N/A'}</td>
                              <td className="p-4 font-semibold">{Number(entry.quantity || 0).toLocaleString()}</td>
                              <td className="p-4 text-gray-600">
                                {entry.referenceType || 'N/A'}
                                {entry.referenceId ? ` #${entry.referenceId}` : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {activeView === 'orders' && (
            <Card>
              <CardHeader>
                <CardTitle>Orders</CardTitle>
                <CardDescription>Order records relevant to warehouse operations.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loadingOrders ? (
                  <div className="h-40 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                  </div>
                ) : orders.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-gray-500">No orders found</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left p-4 font-medium text-gray-600">Order #</th>
                          <th className="text-left p-4 font-medium text-gray-600">Customer</th>
                          <th className="text-left p-4 font-medium text-gray-600">Date</th>
                          <th className="text-left p-4 font-medium text-gray-600">Total</th>
                          <th className="text-left p-4 font-medium text-gray-600">Status</th>
                          <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((order) => (
                          <tr key={order.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="p-4 font-medium">{order.orderNumber}</td>
                            <td className="p-4">{order.customer?.name || 'N/A'}</td>
                            <td className="p-4">
                              {new Date(order.deliveryDate || order.createdAt).toLocaleDateString()}
                            </td>
                            <td className="p-4 font-semibold">{formatPeso(order.totalAmount || 0)}</td>
                            <td className="p-4">
                              <Badge>{formatWarehouseOrderStatus(order.status, (order as any).paymentStatus)}</Badge>
                            </td>
                            <td className="p-4">
                              {(() => {
                                const orderStatus = String(order.status || '').toUpperCase()
                                const isPendingApproval = String((order as any).paymentStatus || '').toLowerCase() === 'pending_approval'
                                return (
                              <div className="flex items-center gap-3">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  onClick={() => void openOrderDetail(order)}
                                  title="View details"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                  onClick={() => updateWarehouseOrderStatus(order.id, 'PREPARING')}
                                  disabled={(!['PENDING', 'CONFIRMED'].includes(orderStatus) && !isPendingApproval) || updatingOrderId === order.id}
                                  title="Confirm Order"
                                >
                                  {updatingOrderId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleCheck className="h-4 w-4" />}
                                </Button>
                              </div>
                                )
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeView === 'trips' && (
            <WarehouseTripsSection
              savedRoutes={savedRoutes}
              loadingTrips={loadingTrips}
              scopedTrips={scopedTrips}
              assignedWarehouseName={assignedWarehouse?.name}
              tripStatusColors={tripStatusColors}
              selectedTrip={selectedTrip}
              setSelectedTrip={setSelectedTrip}
              onOpenCreateRoute={() => setCreateRouteOpen(true)}
              onOpenCreateTrip={() => setCreateTripOpen(true)}
              onDeleteSavedRoute={(routeId) => {
                void removeSavedRoute(routeId)
              }}
              onDeleteTrip={(trip) => {
                void deleteTrip(trip)
              }}
            />
          )}

          {activeView === 'replacements' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Replacements</h1>
                  <p className="text-gray-500">Reverse logistics monitoring for replacement cases, evidence, and resolution status</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
                  <CardContent className="flex h-full items-start gap-3 p-5">
                    <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
                      <ClipboardList className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-500">Total Cases</p>
                      <p className="mt-1 text-2xl font-bold leading-none">{replacementSummary.totalCases}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
                  <CardContent className="flex h-full items-start gap-3 p-5">
                    <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
                      <PackageCheck className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-500">Resolved on Delivery</p>
                      <p className="mt-1 text-2xl font-bold leading-none">{replacementSummary.resolvedOnDelivery}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
                  <CardContent className="flex h-full items-start gap-3 p-5">
                    <div className="rounded-xl bg-amber-50 p-2.5 text-amber-600">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-500">Needs Follow-up</p>
                      <p className="mt-1 text-2xl font-bold leading-none">{replacementSummary.needsFollowUp}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
                  <CardContent className="flex h-full items-start gap-3 p-5">
                    <div className="rounded-xl bg-violet-50 p-2.5 text-violet-600">
                      <Boxes className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-500">Total Replaced Qty</p>
                      <p className="mt-1 text-2xl font-bold leading-none">{replacementSummary.replacedQty}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardContent className="p-0">
                  {loadingReplacements ? (
                    <div className="flex items-center justify-center h-64">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                    </div>
                  ) : scopedReplacements.length === 0 ? (
                    <div className="py-12 text-center">
                      <p className="text-gray-500">No replacement cases found</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            <th className="text-left p-4 font-medium text-gray-600">Replacement #</th>
                            <th className="text-left p-4 font-medium text-gray-600">Order #</th>
                            <th className="text-left p-4 font-medium text-gray-600">Customer</th>
                            <th className="text-left p-4 font-medium text-gray-600">Replacement Details</th>
                            <th className="text-left p-4 font-medium text-gray-600">Evidence</th>
                            <th className="text-left p-4 font-medium text-gray-600">Status</th>
                            <th className="text-left p-4 font-medium text-gray-600">Reported</th>
                            <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scopedReplacements.map((ret) => {
                            const meta = parseIssueMeta(ret?.notes)
                            const issueReason = String(ret?.description || ret?.reason || 'No details provided')
                            const replacementQty = Number(ret?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
                            const replacementMode = String(ret?.replacementMode || meta?.replacementMode || '').toUpperCase()
                            const hasEvidence = Boolean(String(ret?.damagePhotoUrl || meta?.damagePhotoUrl || '').trim())
                            const statusLabel = formatIssueStatus(ret)
                            return (
                              <tr key={ret.id} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="p-4 font-medium">{ret.replacementNumber}</td>
                                <td className="p-4">{ret.orderNumber || ret.order?.orderNumber || 'N/A'}</td>
                                <td className="p-4">{ret.customerName || ret.order?.customer?.name || 'N/A'}</td>
                                <td className="p-4">
                                  <p className="text-sm text-gray-900">{issueReason}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                    {replacementQty > 0 ? <span>Qty replaced: {replacementQty}</span> : null}
                                  </div>
                                </td>
                                <td className="p-4">
                                  <Badge variant={hasEvidence ? 'default' : 'secondary'}>
                                    {hasEvidence ? 'Photo Attached' : 'No Photo'}
                                  </Badge>
                                </td>
                                <td className="p-4">
                                  <Badge
                                    className={
                                      statusLabel === 'Needs Follow-up'
                                        ? 'bg-red-100 text-red-700 hover:bg-red-100'
                                        : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                                    }
                                  >
                                    {statusLabel}
                                  </Badge>
                                </td>
                                <td className="p-4 text-gray-500">
                                  {ret.createdAt ? new Date(ret.createdAt).toLocaleDateString() : 'N/A'}
                                </td>
                                <td className="p-4">
                                  <div className="flex flex-wrap gap-2">
                                    {String(ret?.status || '').toUpperCase() !== 'COMPLETED' && String(ret?.status || '').toUpperCase() !== 'RESOLVED_ON_DELIVERY' ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => updateIssueStatus(ret.id, 'COMPLETED', 'Marked completed by warehouse staff')}
                                        disabled={updatingReplacementId === ret.id}
                                      >
                                        Mark Completed
                                      </Button>
                                    ) : null}
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setSelectedReplacement(ret)}
                                    >
                                      View Details
                                    </Button>
                                    {updatingReplacementId === ret.id ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> : null}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Dialog open={!!selectedReplacement} onOpenChange={(open) => !open && setSelectedReplacement(null)}>
                <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                  {selectedReplacement ? (() => {
                    const meta = parseIssueMeta(selectedReplacement.notes)
                    const evidenceUrl = String(selectedReplacement.damagePhotoUrl || meta?.damagePhotoUrl || '').trim()
                    const replacementLines = buildReplacementLines(selectedReplacement, meta)
                    const details = [
                      ['Replacement #', selectedReplacement.replacementNumber],
                      ['Order #', selectedReplacement.orderNumber || selectedReplacement.order?.orderNumber || 'N/A'],
                      ['Customer', selectedReplacement.customerName || selectedReplacement.order?.customer?.name || 'N/A'],
                      ['Status', formatIssueStatus(selectedReplacement)],
                      ['Reported', selectedReplacement.createdAt ? new Date(selectedReplacement.createdAt).toLocaleString() : 'N/A'],
                      ['Reason', selectedReplacement.reason || 'N/A'],
                      ['Resolution', selectedReplacement.description || 'N/A'],
                      ['Replacement Mode', String(selectedReplacement.replacementMode || meta?.replacementMode || 'N/A').replace(/_/g, ' ')],
                    ] as Array<[string, string]>
                    return (
                      <>
                        <DialogHeader>
                          <DialogTitle>Replacement Details</DialogTitle>
                          <DialogDescription>Complete information for {selectedReplacement.replacementNumber}</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {details.map(([label, value]) => (
                            <div key={label} className="rounded-md border bg-slate-50 px-3 py-2">
                              <p className="text-xs font-medium text-slate-500">{label}</p>
                              <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-md border bg-white">
                          <div className="border-b px-3 py-2">
                            <p className="text-xs font-medium text-slate-500">Replacement Items</p>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-50 text-xs text-slate-500">
                                <tr>
                                  <th className="px-3 py-2 text-left font-medium">Original Product</th>
                                  <th className="px-3 py-2 text-left font-medium">Replacement Product</th>
                                  <th className="px-3 py-2 text-left font-medium">Quantity to Replace</th>
                                  <th className="px-3 py-2 text-left font-medium">Quantity Replaced</th>
                                </tr>
                              </thead>
                              <tbody>
                                {replacementLines.map((line, index) => (
                                  <tr key={`${line.originalProductName}-${index}`} className="border-t first:border-t-0">
                                    <td className="px-3 py-2 font-semibold text-slate-900">{line.originalProductName}</td>
                                    <td className="px-3 py-2 font-semibold text-slate-900">{line.replacementProductName}</td>
                                    <td className="px-3 py-2 font-semibold text-slate-900">{line.quantityToReplace}</td>
                                    <td className="px-3 py-2 font-semibold text-slate-900">{line.quantityReplaced}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        {evidenceUrl ? (
                          <div className="rounded-md border bg-white px-3 py-2">
                            <p className="text-xs font-medium text-slate-500">Evidence</p>
                            <img src={evidenceUrl} alt="Replacement evidence" className="mt-2 max-h-[360px] w-full rounded-md border object-contain" />
                          </div>
                        ) : null}
                      </>
                    )
                  })() : null}
                </DialogContent>
              </Dialog>
            </div>
          )}

          {activeView === 'liveTracking' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Live Tracking</h1>
                  <p className="text-gray-500">Monitor active deliveries in real-time</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={trackingDate}
                    onChange={(event) => setTrackingDate(event.target.value)}
                    className="w-[160px]"
                  />
                  <Button
                    className="gap-2"
                    onClick={async () => {
                      await Promise.all([
                        fetchTripsData(),
                        fetchOrdersData({ showLoading: false, silent: true }),
                      ])
                    }}
                    disabled={loadingTrips || loadingOrders}
                  >
                    {(loadingTrips || loadingOrders) ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                    Refresh Map
                  </Button>
                </div>
              </div>

              <div className="text-sm text-slate-600">
                Route colors: <span className="font-medium text-blue-400">Muted blue dashed = Completed</span> |{' '}
                <span className="font-medium text-blue-700">Bright blue = Upcoming</span>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <Card className="h-[500px]">
                    <CardContent className="h-full p-0">
                      <LiveTrackingMap
                        locations={liveTrackingLocations}
                        routeLines={liveTrackingRouteLines}
                        center={liveTrackingCenter}
                        zoom={liveTrackingLocations.length > 0 ? 12 : 10}
                        restrictToNegrosOccidental
                        showDriverSelfBadge={false}
                        className="w-full h-full rounded-xl overflow-hidden"
                      />
                    </CardContent>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Active Trips</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {loadingTrips ? (
                        <div className="flex h-24 items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                        </div>
                      ) : liveTrackingActiveTrips.length === 0 ? (
                        <p className="text-sm text-gray-500">No active trips right now</p>
                      ) : (
                        <div className="space-y-3">
                          {liveTrackingActiveTrips.slice(0, 5).map((trip) => (
                              <div key={trip.id} className="flex items-center gap-3 rounded-lg bg-gray-50 p-2">
                                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
                                <div className="flex-1">
                                  <p className="text-sm font-medium">{trip.tripNumber}</p>
                                  <p className="text-xs text-gray-500">
                                    Driver: {trip.driver?.user?.name || 'Unassigned'}
                                  </p>
                                </div>
                                <Badge variant="outline">
                                  {trip.completedDropPoints || 0}/{trip.totalDropPoints || 0}
                                </Badge>
                              </div>
                            ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Recent Locations</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {liveTrackingRecentLocations.length === 0 ? (
                        <p className="text-sm text-gray-500">No coordinate logs available</p>
                      ) : (
                        <div className="space-y-2 text-sm">
                          {liveTrackingRecentLocations.map((log: any) => {
                            const latitude = Number(log.latitude)
                            const longitude = Number(log.longitude)

                            return (
                              <div key={log.id} className="flex justify-between gap-2">
                                <span className="truncate text-gray-500">
                                  {new Date(log.recordedAt || log.createdAt || Date.now()).toLocaleTimeString()}
                                </span>
                                <span>{latitude.toFixed(4)}, {longitude.toFixed(4)}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}

          {activeView === 'inventory' && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle>Inventory</CardTitle>
                      <CardDescription>Warehouse staff can edit product details and add stock by batch.</CardDescription>
                    </div>
                    <Button onClick={() => setAddStockOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Stock
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {loadingInventory ? (
                    <div className="h-64 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                    </div>
                  ) : inventory.length === 0 ? (
                    <div className="h-40 flex items-center justify-center text-gray-500">No inventory records found</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                            <th className="text-left p-4 font-medium text-gray-600">Product</th>
                            <th className="text-left p-4 font-medium text-gray-600">Unit</th>
                            <th className="text-left p-4 font-medium text-gray-600">Price</th>
                            <th className="text-left p-4 font-medium text-gray-600">Threshold</th>
                            <th className="text-left p-4 font-medium text-gray-600">Available</th>
                            <th className="text-left p-4 font-medium text-gray-600">Location</th>
                            <th className="text-left p-4 font-medium text-gray-600">Status</th>
                            <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inventory.map((item) => {
                            const status = getStockStatus(item)
                            const availableQty = getAvailableQty(item)
                            return (
                              <tr key={item.id} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="p-4 font-medium text-gray-900">{item.product?.sku ?? 'N/A'}</td>
                                <td className="p-4">
                                  <div className="flex items-center gap-3">
                                    <img
                                      src={item.product?.imageUrl || '/logo.svg'}
                                      alt={item.product?.name || 'Product'}
                                      className="h-10 w-10 rounded-md object-cover border bg-white"
                                      onError={(event) => {
                                        const target = event.currentTarget
                                        if (target.src.endsWith('/logo.svg')) return
                                        target.src = '/logo.svg'
                                      }}
                                    />
                                    <div>
                                      <p className="font-semibold text-gray-900">{item.product?.name ?? 'N/A'}</p>
                                      <p className="text-xs text-gray-500">{item.product?.category?.name || 'General'}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="p-4 font-medium text-gray-900">{item.product?.unit || 'case'}</td>
                                <td className="p-4 font-medium text-indigo-600">{formatPeso(item.product?.price ?? 0)}</td>
                                <td className="p-4 font-semibold text-gray-900">{item.minStock ?? 0}</td>
                                <td className="p-4 font-semibold text-gray-900">{availableQty}</td>
                                <td className="p-4 text-gray-600">
                                  {item.warehouse?.name || item.warehouse?.code || 'N/A'}
                                </td>
                                <td className="p-4">
                                  {status === 'healthy' && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Healthy</Badge>}
                                  {status === 'restock' && <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Needs Restocking</Badge>}
                                </td>
                                <td className="p-4">
                                  <Button size="icon" variant="ghost" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => openEditDialog(item)}>
                                    <Pencil className="h-5 w-5" />
                                  </Button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <CardTitle>Inventory Transactions</CardTitle>
                      <CardDescription>All inventory movement records for this warehouse.</CardDescription>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Input
                        type="date"
                        value={transactionDateFrom}
                        onChange={(event) => {
                          setTransactionDateFrom(event.target.value)
                          setTransactionDatePreset('custom')
                        }}
                        className="h-9"
                      />
                      <select
                        value={transactionDatePreset}
                        onChange={(event) => setTransactionDatePreset(event.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="custom">Custom range</option>
                        <option value="past_7_days">Past 7 days</option>
                        <option value="past_14_days">Past 14 days</option>
                        <option value="past_1_month">Past 1 month</option>
                        <option value="past_3_months">Past 3 months</option>
                        <option value="past_6_months">Past 6 months</option>
                        <option value="past_1_year">Past 1 year</option>
                      </select>
                      <select
                        value={transactionTypeFilter}
                        onChange={(event) => setTransactionTypeFilter(event.target.value)}
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="all">All types</option>
                        {availableInventoryTransactionTypes.map((type) => (
                          <option key={type} value={type}>
                            {type.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {loadingInventoryTransactions ? (
                    <div className="h-40 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                    </div>
                  ) : filteredInventoryTransactions.length === 0 ? (
                    <div className="h-40 flex items-center justify-center text-gray-500">No inventory transactions found</div>
                  ) : (
                    <div className="max-h-[420px] overflow-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b sticky top-0 z-10">
                          <tr>
                            <th className="text-left p-4 font-medium text-gray-600">Date</th>
                            <th className="text-left p-4 font-medium text-gray-600">Type</th>
                            <th className="text-left p-4 font-medium text-gray-600">Product</th>
                            <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                            <th className="text-left p-4 font-medium text-gray-600">Qty</th>
                            <th className="text-left p-4 font-medium text-gray-600">Reference</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredInventoryTransactions.map((entry) => (
                            <tr key={entry.id} className="border-b last:border-0 hover:bg-gray-50">
                              <td className="p-4">{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'N/A'}</td>
                              <td className="p-4">
                                <Badge variant="outline">{String(entry.type || 'N/A').replace(/_/g, ' ')}</Badge>
                              </td>
                              <td className="p-4">{entry.product?.name || 'N/A'}</td>
                              <td className="p-4">{entry.product?.sku || 'N/A'}</td>
                              <td className="p-4 font-semibold">{Number(entry.quantity || 0).toLocaleString()}</td>
                              <td className="p-4 text-gray-600">
                                {entry.referenceType || 'N/A'}
                                {entry.referenceId ? ` #${entry.referenceId}` : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {activeView === 'warehouses' && (
            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle>Assigned Warehouse</CardTitle>
                  <CardDescription>Operational details for your assigned warehouse.</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingWarehouses ? (
                    <div className="h-40 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                    </div>
                  ) : !assignedWarehouse ? (
                    <div className="h-40 flex items-center justify-center text-gray-500">No assigned warehouse found</div>
                  ) : (
                    <div className="rounded-lg border bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-lg">{assignedWarehouse.name}</h3>
                          <p className="text-sm text-gray-500">{assignedWarehouse.code}</p>
                          <p className="text-sm text-gray-500">{[assignedWarehouse.city, assignedWarehouse.province].filter(Boolean).join(', ')}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            Capacity: {Number(assignedWarehouse.capacity || 0).toLocaleString()} units
                          </p>
                        </div>
                        <Badge variant={assignedWarehouse.isActive ? 'default' : 'secondary'}>
                          {assignedWarehouse.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {assignedWarehouse && warehouseOverviewStats && (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">Capacity Utilization</CardTitle>
                        <Badge className={warehouseOverviewStats.usagePercent >= 90 ? 'bg-red-100 text-red-800 hover:bg-red-100' : warehouseOverviewStats.usagePercent >= 70 ? 'bg-amber-100 text-amber-800 hover:bg-amber-100' : 'bg-green-100 text-green-800 hover:bg-green-100'}>
                          {warehouseOverviewStats.utilizationStatus}
                        </Badge>
                      </div>
                      <CardDescription>
                        {warehouseOverviewStats.usedCapacity.toLocaleString()} / {warehouseOverviewStats.totalCapacity.toLocaleString()} units used
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div className="rounded-xl border bg-gradient-to-br from-slate-50 via-white to-blue-50/40 p-4 shadow-sm">
                          <p className="mb-2 text-sm font-medium text-gray-600">Used vs Free Capacity</p>
                          <ChartContainer
                            config={{ used: { label: 'Used', color: '#3b82f6' }, free: { label: 'Free', color: '#34d399' } }}
                            className="h-[260px] w-full"
                          >
                            <PieChart>
                              <Pie
                                data={warehouseOverviewStats.capacityBreakdown}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={68}
                                outerRadius={100}
                                paddingAngle={2}
                                strokeWidth={3}
                              >
                                {warehouseOverviewStats.capacityBreakdown.map((entry) => (
                                  <Cell key={entry.name} fill={entry.color} />
                                ))}
                                <RechartsLabel
                                  content={({ viewBox }) => {
                                    if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) return null
                                    const cx = typeof viewBox.cx === 'number' ? viewBox.cx : 0
                                    const cy = typeof viewBox.cy === 'number' ? viewBox.cy : 0
                                    return (
                                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                                        <tspan x={cx} y={cy - 4} className="fill-slate-900 text-2xl font-bold">
                                          {warehouseOverviewStats.usagePercent}%
                                        </tspan>
                                        <tspan x={cx} y={cy + 16} className="fill-slate-500 text-xs">
                                          Used
                                        </tspan>
                                      </text>
                                    )
                                  }}
                                />
                              </Pie>
                              <Tooltip formatter={(value: any, name: any) => [Number(value).toLocaleString(), name]} />
                            </PieChart>
                          </ChartContainer>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm items-start content-start auto-rows-min self-start">
                          <div className="rounded-xl border bg-white p-3 shadow-sm h-fit self-start">
                            <p className="text-gray-500">Used</p>
                            <p className="text-lg font-semibold text-blue-700">{warehouseOverviewStats.usagePercent}%</p>
                          </div>
                          <div className="rounded-xl border bg-white p-3 shadow-sm h-fit self-start">
                            <p className="text-gray-500">Free Capacity</p>
                            <p className="text-lg font-semibold text-green-700">{warehouseOverviewStats.availableCapacity.toLocaleString()}</p>
                          </div>
                          <div className="rounded-xl border bg-white p-3 shadow-sm h-fit self-start">
                            <p className="text-gray-500">Max Capacity</p>
                            <p className="text-lg font-semibold">{warehouseOverviewStats.totalCapacity.toLocaleString()}</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <Card className="lg:col-span-2">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Capacity Trend (Last 7 Days)</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ChartContainer
                          config={{ utilization: { label: 'Utilization', color: '#2563eb' } }}
                          className="h-[300px] w-full"
                        >
                          <LineChart data={warehouseOverviewStats.utilizationTrend} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                            <CartesianGrid vertical={false} strokeDasharray="3 3" />
                            <XAxis dataKey="day" axisLine={false} tickLine={false} />
                            <YAxis axisLine={false} tickLine={false} width={34} domain={[0, 100]} />
                            <Tooltip formatter={(value) => [`${value}%`, 'Utilization']} />
                            <Line type="monotone" dataKey="utilization" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                          </LineChart>
                        </ChartContainer>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Recent Activities</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {warehouseOverviewStats.recentActivities.map((activity) => (
                            <div key={activity.id} className="rounded-lg border bg-gradient-to-br from-white to-gray-50 px-3 py-3 shadow-sm">
                              <p className="text-sm font-semibold text-gray-900">{activity.title}</p>
                              <p className="text-sm text-gray-600">{activity.detail}</p>
                              <p className="mt-1 text-xs text-gray-500">{activity.time}</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <Card className="lg:col-span-2">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">SKU Velocity Chart</CardTitle>
                        <CardDescription>Top 10 fastest-moving items for replenishment planning.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {warehouseOverviewStats.skuVelocityData.length === 0 ? (
                          <p className="text-sm text-gray-500">No SKU velocity data available.</p>
                        ) : (
                          <ChartContainer
                            config={{ velocity: { label: 'Velocity', color: '#2563eb' } }}
                            className="h-[320px] w-full"
                          >
                            <BarChart data={warehouseOverviewStats.skuVelocityData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                              <CartesianGrid vertical={false} strokeDasharray="3 3" />
                              <XAxis dataKey="sku" axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={65} />
                              <YAxis axisLine={false} tickLine={false} width={34} />
                              <Tooltip
                                formatter={(value) => [value, 'Velocity Score']}
                                labelFormatter={(label) => {
                                  const item = warehouseOverviewStats.skuVelocityData.find((row) => row.sku === label)
                                  return `${label} - ${item?.name || ''}`
                                }}
                              />
                              <Bar dataKey="velocity" radius={[6, 6, 0, 0]} fill="#2563eb" />
                            </BarChart>
                          </ChartContainer>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Stock Health Distribution</CardTitle>
                        <CardDescription>Healthy, low, critical, and overstocked SKU split.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ChartContainer
                          config={{
                            healthy: { label: 'Healthy', color: '#10b981' },
                            low: { label: 'Low', color: '#f59e0b' },
                            critical: { label: 'Critical', color: '#ef4444' },
                            overstocked: { label: 'Overstocked', color: '#3b82f6' },
                          }}
                          className="h-[260px] w-full"
                        >
                          <PieChart>
                            <Pie
                              data={warehouseOverviewStats.stockHealthDistribution}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={56}
                              outerRadius={92}
                              paddingAngle={2}
                            >
                              {warehouseOverviewStats.stockHealthDistribution.map((entry) => (
                                <Cell key={entry.name} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value: any, name: any) => [Number(value).toLocaleString(), name]} />
                          </PieChart>
                        </ChartContainer>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {warehouseOverviewStats.stockHealthDistribution.map((entry) => (
                            <div key={entry.name} className="rounded-md border bg-gray-50 px-2 py-1.5 text-xs">
                              <span className={`inline-block h-2 w-2 rounded-full mr-2 ${getStockHealthDotClass(entry.name)}`} />
                              <span className="text-gray-600">{entry.name}</span>
                              <span className="float-right font-semibold text-gray-900">{entry.value}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Warehouse Happenings</CardTitle>
                      <CardDescription>Quick operational signals inside this warehouse.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {warehouseOverviewStats.activities.map((activity) => (
                          <div key={activity.id} className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            <p className="text-sm font-medium text-gray-900">{activity.label}</p>
                            <p className="text-sm text-gray-600">{activity.detail}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          )}

          {activeView === 'transactions' && (
            <Card>
              <CardHeader>
                <CardTitle>Stocks</CardTitle>
                <CardDescription>Batch-based stock-in records with receipt date, expiry date, and days left.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loadingBatches ? (
                  <div className="h-40 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                  </div>
                ) : stockBatches.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-gray-500">No stock-in batches found</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left p-4 font-medium text-gray-600">Batch #</th>
                          <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                          <th className="text-left p-4 font-medium text-gray-600">Product</th>
                          <th className="text-left p-4 font-medium text-gray-600">Qty</th>
                          <th className="text-left p-4 font-medium text-gray-600">Receipt Date</th>
                          <th className="text-left p-4 font-medium text-gray-600">Expiry Date</th>
                          <th className="text-left p-4 font-medium text-gray-600">Days Left</th>
                          <th className="text-left p-4 font-medium text-gray-600">Status</th>
                          <th className="text-left p-4 font-medium text-gray-600">Location</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockBatches.map((batch) => {
                          const daysLeft = getDaysLeft(batch.expiryDate)
                          const expiringSoon = typeof daysLeft === 'number' && daysLeft >= 0 && daysLeft <= 14
                          const expired = typeof daysLeft === 'number' && daysLeft < 0
                          return (
                            <tr key={batch.id} className="border-b last:border-0 hover:bg-gray-50">
                              <td className="p-4 font-medium text-gray-900">{batch.batchNumber}</td>
                              <td className="p-4">{batch.inventory?.product?.sku || 'N/A'}</td>
                              <td className="p-4">{batch.inventory?.product?.name || 'N/A'}</td>
                              <td className="p-4 font-semibold">{batch.quantity}</td>
                              <td className="p-4">{new Date(batch.receiptDate).toLocaleDateString()}</td>
                              <td className="p-4">{batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : 'N/A'}</td>
                              <td className={`p-4 font-semibold ${expired ? 'text-red-600' : expiringSoon ? 'text-orange-600' : 'text-green-600'}`}>
                                {typeof daysLeft === 'number' ? `${Math.max(daysLeft, 0)} days` : 'N/A'}
                              </td>
                              <td className="p-4">
                                {expired && <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Expired</Badge>}
                                {!expired && expiringSoon && <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Expiring Soon</Badge>}
                                {!expired && !expiringSoon && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>}
                              </td>
                              <td className="p-4 text-gray-600">
                                {batch.inventory?.warehouse?.code || batch.inventory?.warehouse?.name || batch.locationLabel || 'N/A'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

            </>
          )}
        </main>
      </div>

      <Dialog
        open={createRouteOpen}
        onOpenChange={(open) => {
          setCreateRouteOpen(open)
          if (!open) {
            setRoutePlans([])
            setSelectedRouteCity('')
            setSelectedRouteOrderIds([])
            setRoutePlanMessage(null)
          }
        }}
      >
        <DialogContent className="w-[95vw] min-w-[1180px] h-full max-w-none max-h-[95vh] m-auto rounded-xl shadow-xl overflow-hidden p-0 flex items-stretch justify-center z-[60]">
          <DialogHeader>
            <DialogTitle className="sr-only">Create Delivery Route</DialogTitle>
          </DialogHeader>
          <div className="flex flex-row w-full h-full">
            <div className="flex flex-col bg-white border-r p-4 min-w-[280px] max-w-[330px] w-[300px]">
              <h2 className="mb-4 text-xl font-bold">Create Delivery Route</h2>
              <div className="mb-3">
                <label htmlFor="popup-route-date" className="text-sm font-medium text-gray-700">Delivery Date</label>
                <Input
                  id="popup-route-date"
                  type="date"
                  value={routeDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => {
                    const nextDate = e.target.value
                    setRouteDate(nextDate)
                    if (createRouteOpen && nextDate && routeWarehouseId) {
                      void createRoutePlan(true, nextDate, routeWarehouseId)
                    }
                  }}
                  className="mt-1 h-10 text-sm"
                />
              </div>
              <div className="mb-3">
                <label htmlFor="warehouse-select" className="text-sm font-medium text-gray-700">Select Warehouse</label>
                <select
                  id="warehouse-select"
                  value={routeWarehouseId}
                  onChange={(e) => {
                    const nextWarehouseId = e.target.value
                    setRouteWarehouseId(nextWarehouseId)
                    if (createRouteOpen && routeDate && nextWarehouseId) {
                      void createRoutePlan(true, routeDate, nextWarehouseId)
                    }
                  }}
                  title="Select warehouse"
                  className="mt-1 h-10 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="">-- Choose Warehouse --</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} ({warehouse.city})
                    </option>
                  ))}
                </select>
              </div>
              <Button className="mt-1 mb-3 h-10 w-full bg-black text-sm text-white hover:bg-black/90" onClick={() => createRoutePlan(false, routeDate, routeWarehouseId)} disabled={loadingRoutePlans}>
                {loadingRoutePlans ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                Filter Orders
              </Button>

              {routePlanMessage && (
                <div className={`mb-3 rounded-lg p-2.5 text-xs ${routePlanMessage.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                  {routePlanMessage.text}
                </div>
              )}

              <div className="flex-1 overflow-y-auto rounded-lg bg-gray-50 p-3">
                <h3 className="mb-2 text-base font-semibold">Orders by City</h3>
                {routePlans.length === 0 ? (
                  <div className="flex items-center justify-center text-sm text-gray-400 min-h-[80px]">
                    {loadingRoutePlans ? 'Loading orders...' : 'Pick a delivery date and warehouse to view orders by city'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {routePlans.map((cityGroup) => (
                      <div key={cityGroup.city}>
                        <button
                          onClick={() => setSelectedRouteCity(cityGroup.city)}
                          className={`mb-1.5 w-full rounded-lg p-2.5 text-left text-sm font-semibold transition-colors ${
                            selectedRouteCity === cityGroup.city
                              ? 'bg-blue-500 text-white'
                              : 'bg-white border border-gray-200 text-gray-900 hover:border-blue-400'
                          }`}
                        >
                          {cityGroup.city} ({cityGroup.orders.length} orders)
                        </button>
                        {selectedRouteCity === cityGroup.city && (
                          <div className="mb-2.5 space-y-1 pl-2">
                            {cityGroup.orders.map((order) => (
                              <button
                                key={order.id}
                                onClick={() => handleRouteOrderClick(cityGroup.city, order.id)}
                                className={`w-full rounded p-1.5 text-left text-xs transition-colors ${
                                  selectedRouteOrderIds.includes(order.id)
                                    ? 'bg-blue-100 text-blue-900 font-medium'
                                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    aria-hidden="true"
                                    className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                                      selectedRouteOrderIds.includes(order.id)
                                        ? 'border-blue-600 bg-blue-600 text-white'
                                        : 'border-gray-300 bg-white'
                                    }`}
                                  >
                                    {selectedRouteOrderIds.includes(order.id) ? 'âœ“' : ''}
                                  </span>
                                  <span className="truncate">{order.orderNumber || order.id}</span>
                                </div>
                                <div className="text-xs text-gray-500 truncate">{order.customerName}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-2 space-y-1.5">
                <p className="text-xs text-gray-500">
                  Driver assignment is done in New Trip.
                </p>
                <Button
                  className="h-9 w-full bg-blue-600 text-sm text-white hover:bg-blue-700"
                  onClick={() => {
                    void saveRouteDraft()
                  }}
                  disabled={
                    loadingRoutePlans ||
                    !routeDate ||
                    !routeWarehouseId ||
                    !selectedRouteCity ||
                    selectedRouteOrderIds.length === 0
                  }
                >
                  Save Route
                </Button>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-gray-50 p-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Delivery Locations</CardTitle>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="flex w-full flex-col items-center rounded-xl border bg-gray-50 p-4">
                    {(() => {
                      const wh = warehouses.find((w) => w.id === routeWarehouseId)
                      if (!wh) return <div className="mb-4 text-gray-400">Select a warehouse to start</div>
                      return (
                        <div className="mb-3 w-full max-w-xl">
                          <div className="mb-1.5 flex flex-col items-start rounded-lg border-2 border-green-400 bg-green-50 p-3">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-green-500 text-white font-bold mr-2">
                                <svg width="18" height="18" fill="none"><path d="M9 2.25a6.75 6.75 0 1 1 0 13.5a6.75 6.75 0 0 1 0-13.5Zm0 2.25v2.25m0 2.25h.008v.008H9V6.75Z" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              </span>
                              <span className="font-semibold text-green-900">Warehouse - Starting Point</span>
                            </div>
                            <div className="text-xs font-semibold text-gray-700">{wh.name}</div>
                            <div className="text-[11px] text-green-700">{[wh.address, wh.city, wh.province].filter(Boolean).join(', ')}</div>
                            {wh.latitude && wh.longitude && (
                              <div className="mt-1 text-[11px] text-gray-500">Coordinates: {wh.latitude}, {wh.longitude}</div>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                    <div className="flex w-full max-w-xl flex-col gap-2">
                      {(() => {
                        if (!routePlans || !selectedRouteCity) return null
                        const group = routePlans.find((g) => g.city === selectedRouteCity)
                        if (!group) return null
                        const selectedOrders = group.orders.filter((order) => selectedRouteOrderIds.includes(order.id))
                        return selectedOrders.map((order, idx) => (
                          <div key={order.id} className="flex items-start gap-2 rounded-lg border bg-white p-3">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white">{idx + 1}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-gray-900">{order.customerName || order.orderNumber}</div>
                              <div className="text-[11px] text-gray-600">{order.address || order.city || ''}</div>
                              {order.products && (
                                <div className="mt-0.5 text-[11px] text-gray-500">{order.products}</div>
                              )}
                              {order.latitude && order.longitude && (
                                <div className="mt-0.5 text-[11px] text-gray-500">Coordinates: {order.latitude}, {order.longitude}</div>
                              )}
                            </div>
                          </div>
                        ))
                      })()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createTripOpen} onOpenChange={setCreateTripOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Trip</DialogTitle>
            <DialogDescription>Select a saved route and assign an available driver.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Saved Route</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                title="Select Saved Route"
                value={selectedSavedRouteId}
                onChange={(e) => setSelectedSavedRouteId(e.target.value)}
              >
                <option value="">Select route</option>
                {savedRoutes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.city} | {new Date(route.date).toLocaleDateString()} | {route.orderIds.length} orders
                  </option>
                ))}
              </select>
            </div>
            {selectedSavedRoute ? (
              <div className="rounded-md border bg-gray-50 p-3 text-sm">
                <p className="font-medium text-gray-900">{selectedSavedRoute.city}</p>
                <p className="text-gray-600">Warehouse: {selectedSavedRoute.warehouseName}</p>
                <p className="text-gray-600">Date: {new Date(selectedSavedRoute.date).toLocaleDateString()}</p>
                <p className="text-gray-600">Orders: {selectedSavedRoute.orderIds.length}</p>
              </div>
            ) : null}
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Assign Driver</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                title="Assign Driver"
                value={selectedRouteDriverId}
                onChange={(e) => setSelectedRouteDriverId(e.target.value)}
              >
                <option value="">Select driver</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id} disabled={driver?.isActive === false}>
                    {(driver.user?.name || driver.name || driver.email || driver.id) + (driver?.isActive === false ? ' (Inactive)' : '')}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Assigned Vehicle</label>
              <Input
                readOnly
                value={selectedDriverAssignedVehicle?.licensePlate || 'No assigned vehicle'}
              />
              {!selectedDriverAssignedVehicle?.id && selectedRouteDriverId ? (
                <p className="text-xs text-amber-600">Selected driver has no assigned vehicle.</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setCreateTripOpen(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-black text-white hover:bg-black/90"
                onClick={createTripFromRoute}
                disabled={creatingTripFromRoute || !selectedSavedRouteId || !selectedRouteDriverId || !selectedDriverAssignedVehicle?.id}
              >
                {creatingTripFromRoute ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                Create Trip
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-4xl w-full">
          {selectedOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Order Details - {selectedOrder.orderNumber}</DialogTitle>
                <DialogDescription>{loadingOrderDetail ? 'Loading latest order details...' : undefined}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-gray-500">Order Status</p>
                  <p className="font-semibold">{formatWarehouseOrderStatus(selectedOrder.status, (selectedOrder as any).paymentStatus)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-gray-500">Warehouse Stage</p>
                  <p className="font-semibold">{formatWarehouseStage(selectedOrder.warehouseStage)}</p>
                  {selectedOrder.isDriverAssigned ? (
                    <p className="text-xs text-gray-600">
                      Driver: {selectedOrder.assignedDriverName || 'Assigned'}
                    </p>
                  ) : (
                    <div className="mt-2 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 shadow-[0_6px_14px_rgba(239,68,68,0.14)]">
                      Driver not assigned
                    </div>
                  )}
                </div>
                <div className="rounded-md border p-3 space-y-1">
                  <p className="font-medium">Client Information</p>
                  <p className="text-sm text-gray-700">{selectedOrder.customer?.name || selectedOrder.shippingName || 'N/A'}</p>
                  <p className="text-sm text-gray-600">{selectedOrder.customer?.email || 'N/A'}</p>
                  <p className="text-sm text-gray-600">{selectedOrder.shippingPhone || selectedOrder.customer?.phone || 'N/A'}</p>
                  <p className="text-sm text-gray-600">
                    {formatWarehouseOrderAddress(selectedOrder)}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="font-medium mb-2">Order Details</p>
                  <div className="space-y-1">
                    {(selectedOrder.items || []).map((item) => (
                      <div key={item.id} className="flex justify-between gap-3 text-sm">
                        <div>
                          <p>{item.product?.name || 'Product'} x{item.quantity}</p>
                          {(item as any).spareProducts ? (
                            <div className="mt-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                              <p>Spare products: {Number((item as any).spareProducts.recommendedQuantity || 0)}</p>
                              <p>Total load {Number((item as any).spareProducts.totalLoadQuantity || item.quantity || 0)} | Policy {Number((item as any).spareProducts.minPercent || 0)}-{Number((item as any).spareProducts.maxPercent || 0)}%</p>
                            </div>
                          ) : null}
                        </div>
                        <span>{formatPeso((item.totalPrice ?? item.quantity * item.unitPrice) || 0)}</span>
                      </div>
                    ))}
                    <p className="text-right font-semibold pt-2">Total: {formatPeso(selectedOrder.totalAmount || 0)}</p>
                  </div>
                </div>
                <div className="hidden">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-medium">Checklist</p>
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700">
                      Pending
                    </span>
                  </div>
                  <div className="space-y-2">
                    {(selectedOrder.items || []).map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                        <div>
                          <p>{item.product?.name || 'Product'} x{item.quantity}</p>
                          {(item as any).spareProducts ? (
                            <div className="mt-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                              <p>Spare products: {Number((item as any).spareProducts.recommendedQuantity || 0)}</p>
                              <p>Total load {Number((item as any).spareProducts.totalLoadQuantity || item.quantity || 0)}</p>
                            </div>
                          ) : null}
                        </div>
                        <span className="font-medium text-gray-500">
                          Pending
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {(() => {
                  const selectedOrderStatus = String(selectedOrder.status || '').toUpperCase()
                  const selectedWarehouseStage = String(selectedOrder.warehouseStage || 'READY_TO_LOAD').toUpperCase()
                  const isPendingApproval = String((selectedOrder as any).paymentStatus || '').toLowerCase() === 'pending_approval'
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {!isPendingApproval && selectedOrderStatus === 'PREPARING' && selectedWarehouseStage === 'READY_TO_LOAD' ? (
                        <Button variant="outline" disabled>
                          Waiting for Driver Load
                        </Button>
                      ) : selectedWarehouseStage === 'LOADED' ? (
                        <Button variant="outline" disabled>
                          Loaded by Driver
                        </Button>
                      ) : selectedWarehouseStage === 'DISPATCHED' ? (
                        <Button variant="outline" disabled>
                          Dispatched
                        </Button>
                      ) : isPendingApproval || ['PENDING', 'CONFIRMED'].includes(selectedOrderStatus) ? (
                        <Button
                          className="bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => void updateWarehouseOrderStatus(selectedOrder.id, 'PREPARING')}
                          disabled={updatingOrderId === selectedOrder.id}
                        >
                          Confirm Order
                        </Button>
                      ) : (
                        <Button variant="outline" disabled>
                          No Action
                        </Button>
                      )}
                      <Button variant="outline" onClick={() => setSelectedOrder(null)}>
                        Close
                      </Button>
                    </div>
                  )
                })()}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectOrder} onOpenChange={(open) => !open && setRejectOrder(null)}>
        <DialogContent>
          {rejectOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Reject Order</DialogTitle>
                <DialogDescription>Please provide a reason for rejecting order {rejectOrder.orderNumber}.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <textarea
                  className="w-full min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Enter rejection reason..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setRejectOrder(null)}>
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 bg-red-600 hover:bg-red-700"
                    onClick={async () => {
                      if (!['PREPARING'].includes(rejectOrder.status)) {
                        toast.error('Order is not eligible for packing')
                        return
                      }
                      await updateWarehouseOrderStatus(rejectOrder.id, 'PREPARING', rejectReason.trim() || undefined)
                      setRejectOrder(null)
                    }}
                    disabled={updatingOrderId === rejectOrder.id}
                  >
                    Confirm
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={addStockOpen} onOpenChange={(open) => { setAddStockOpen(open); if (!open) resetStockInForm() }}>
        <DialogContent className="max-w-4xl w-full">
          <DialogHeader>
            <DialogTitle>Add Stock</DialogTitle>
            <DialogDescription>Add stock by batch. Existing product requires expiry date only.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button type="button" variant={!isNewProduct ? 'default' : 'outline'} className="flex-1" onClick={() => setIsNewProduct(false)}>
                Existing Product
              </Button>
              <Button type="button" variant={isNewProduct ? 'default' : 'outline'} className="flex-1" onClick={() => setIsNewProduct(true)}>
                New Product
              </Button>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse</label>
              <select
                id="stock-warehouse"
                title="Select Warehouse"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={stockInWarehouseId}
                onChange={(e) => setStockInWarehouseId(e.target.value)}
              >
                <option value="">Select warehouse</option>
                {warehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>{wh.name} ({wh.code})</option>
                ))}
              </select>
            </div>

            {!isNewProduct ? (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Product</label>
                <select
                  id="stock-product"
                  title="Select Product"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                >
                  <option value="">Select product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.sku} - {product.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Product Image</label>
                  <Input id="new-product-image" type="file" accept="image/*" onChange={(e) => setNewProductImageFile(e.target.files?.[0] || null)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Product Name</label>
                  <Input id="new-product-name" value={newProductName} onChange={(e) => setNewProductName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Description</label>
                  <Input
                    id="new-product-description"
                    value={newProductDescription}
                    onChange={(e) => setNewProductDescription(e.target.value)}
                    placeholder="Product description"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Price</label>
                    <Input id="new-product-price" type="number" step="0.01" value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Unit</label>
                    <select
                      id="new-product-unit"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={newProductUnit}
                      onChange={(e) => setNewProductUnit(e.target.value)}
                    >
                      {PRODUCT_UNIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Threshold</label>
                    <Input id="stock-threshold" type="number" value={stockInThreshold} onChange={(e) => setStockInThreshold(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Quantity</label>
                <Input id="stock-qty" type="number" value={stockInQty} onChange={(e) => setStockInQty(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Expiry Date</label>
                <Input id="stock-expiry" type="date" value={stockInExpiryDate} onChange={(e) => setStockInExpiryDate(e.target.value)} />
              </div>
            </div>

            <Button className="w-full" onClick={addStockInBatch} disabled={isSubmittingStockIn}>
              {isSubmittingStockIn ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Add Stock Batch
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Inventory Item</DialogTitle>
            <DialogDescription>Update product details and stock threshold.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edit-name">Product Name</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-sku">SKU</Label>
              <Input id="edit-sku" value={editSku} onChange={(e) => setEditSku(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-image-file">Photo</Label>
              <Input id="edit-image-file" type="file" accept="image/*" onChange={(e) => setEditImageFile(e.target.files?.[0] || null)} />
              {editImageUrl && <p className="text-xs text-gray-500">Current photo is set.</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-unit">Unit</Label>
              <select
                id="edit-unit"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={editUnit}
                onChange={(e) => setEditUnit(e.target.value)}
              >
                {PRODUCT_UNIT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-price">Price</Label>
              <Input id="edit-price" type="number" min="0" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-threshold">Threshold</Label>
              <Input id="edit-threshold" type="number" min="0" step="1" value={editThreshold} onChange={(e) => setEditThreshold(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-quantity">In Stock Quantity</Label>
              <Input id="edit-quantity" type="number" min="0" step="1" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="destructive"
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                onClick={() => setDeleteEditOpen(true)}
                disabled={isSavingEdit || isDeletingEdit}
              >
                {isDeletingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Delete Product
              </Button>
              <Button className="flex-1 bg-black text-white hover:bg-black/90" onClick={saveInventoryEdit} disabled={isSavingEdit || isDeletingEdit}>
                {isSavingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteEditOpen} onOpenChange={setDeleteEditOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">Delete Product Permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete{' '}
              <span className="font-semibold text-foreground">{editingItem?.product?.name || 'this product'}</span>{' '}
              from the database. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingEdit}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteInventoryProduct}
              disabled={isDeletingEdit}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeletingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete Product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}

