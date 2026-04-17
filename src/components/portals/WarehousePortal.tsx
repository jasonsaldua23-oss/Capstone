'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { formatReplacementStatusLabel } from '@/lib/replacement-status'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { clearTabAuthToken } from '@/lib/client-auth'
import {
  Boxes,
  PackageCheck,
  Truck,
  RotateCcw,
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

type WarehouseView =
  | 'dashboard'
  | 'orders'
  | 'trips'
  | 'returns'
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

interface PortalNotification {
  id: string
  title: string
  message: string
  type: string | null
  isRead: boolean
  createdAt: string
}

interface WarehouseOrderItem {
  id: string
  orderNumber: string
  warehouseId?: string
  status: string
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
    latitude?: number | null
    longitude?: number | null
    locationName?: string
  }>
}

interface WarehouseReturnItem {
  id: string
  returnNumber: string
  warehouseId?: string
  status: string
  reason: string
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

const PERCENT_HEIGHT_CLASSES: Record<number, string> = {
  0: 'h-0',
  5: 'h-[5%]',
  10: 'h-[10%]',
  15: 'h-[15%]',
  20: 'h-[20%]',
  25: 'h-1/4',
  30: 'h-[30%]',
  35: 'h-[35%]',
  40: 'h-2/5',
  45: 'h-[45%]',
  50: 'h-1/2',
  55: 'h-[55%]',
  60: 'h-3/5',
  65: 'h-[65%]',
  70: 'h-[70%]',
  75: 'h-3/4',
  80: 'h-4/5',
  85: 'h-[85%]',
  90: 'h-[90%]',
  95: 'h-[95%]',
  100: 'h-full',
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}

function toPercentStep(value: number) {
  return Math.round(clampPercent(value) / 5) * 5
}

function getHeightClass(value: number) {
  return PERCENT_HEIGHT_CLASSES[toPercentStep(value)] ?? 'h-0'
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
  { id: 'returns', label: 'Replacements', icon: RotateCcw },
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
  const [orders, setOrders] = useState<WarehouseOrderItem[]>([])
  const [trips, setTrips] = useState<WarehouseTripItem[]>([])
  const [returns, setReturns] = useState<WarehouseReturnItem[]>([])
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
  const [createRouteOpen, setCreateRouteOpen] = useState(false)
  const [createTripOpen, setCreateTripOpen] = useState(false)
  const [loadingInventory, setLoadingInventory] = useState(true)
  const [loadingWarehouses, setLoadingWarehouses] = useState(true)
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [loadingTrips, setLoadingTrips] = useState(true)
  const [loadingReturns, setLoadingReturns] = useState(true)
  const [loadingRoutePlans, setLoadingRoutePlans] = useState(false)
  const [creatingTripFromRoute, setCreatingTripFromRoute] = useState(false)
  const [routePlanMessage, setRoutePlanMessage] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(null)
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)
  const [updatingReplacementId, setUpdatingReplacementId] = useState<string | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<WarehouseOrderItem | null>(null)
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false)
  const [selectedTrip, setSelectedTrip] = useState<WarehouseTripItem | null>(null)
  const [rejectOrder, setRejectOrder] = useState<WarehouseOrderItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editSku, setEditSku] = useState('')
  const [editUnit, setEditUnit] = useState('piece')
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
  const [newProductUnit, setNewProductUnit] = useState('piece')
  const [newProductImageFile, setNewProductImageFile] = useState<File | null>(null)
  const [notifications, setNotifications] = useState<PortalNotification[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const latestOrderMarkerRef = useRef<string>('')
  const hasAssignedWarehouse = warehouses.length > 0
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

  useEffect(() => {
    if (createRouteOpen && warehouses.length > 0) {
      if (!routeWarehouseId) {
        setRouteWarehouseId(warehouses[0].id)
      }
      if (!routeDate) {
        setRouteDate(getDefaultRouteDate())
      }
      if (routePlans.length === 0) {
        createRoutePlan(true, routeDate, warehouses[0].id)
      }
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

  const scopedTrips = useMemo(() => {
    if (!assignedWarehouse) return trips
    const hasTripWarehouseRefs = trips.some((trip) => trip?.warehouseId)
    return hasTripWarehouseRefs
      ? trips.filter((trip) => trip?.warehouseId === assignedWarehouse.id)
      : trips
  }, [assignedWarehouse, trips])

  const scopedInventory = useMemo(() => {
    if (!assignedWarehouse) return inventory
    const hasInventoryWarehouseRefs = inventory.some((item) => item?.warehouse?.id)
    return hasInventoryWarehouseRefs
      ? inventory.filter((item) => item?.warehouse?.id === assignedWarehouse.id)
      : inventory
  }, [assignedWarehouse, inventory])

  const scopedOrders = useMemo(() => {
    if (!assignedWarehouse) return orders
    const hasOrderWarehouseRefs = orders.some((item) => item?.warehouseId)
    return hasOrderWarehouseRefs
      ? orders.filter((item) => item?.warehouseId === assignedWarehouse.id)
      : orders
  }, [assignedWarehouse, orders])

  const scopedReturns = useMemo(() => {
    if (!assignedWarehouse) return returns
    const hasReturnWarehouseRefs = returns.some((entry) => entry?.warehouseId || entry?.order?.warehouseId)
    return hasReturnWarehouseRefs
      ? returns.filter((entry) => entry?.warehouseId === assignedWarehouse.id || entry?.order?.warehouseId === assignedWarehouse.id)
      : returns
  }, [assignedWarehouse, returns])

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
      ['PENDING', 'CONFIRMED', 'UNAPPROVED', 'PROCESSING'].includes(String(order.status || '').toUpperCase())
    ).length
    const inTransitTrips = scopedTrips.filter((trip) => isActiveTripStatus(trip.status)).length
    const openReplacements = scopedReturns.filter((entry) => !['PROCESSED', 'REJECTED'].includes(entry.status)).length
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
        id: 'returns',
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
  }, [assignedWarehouse, scopedInventory, scopedOrders, scopedTrips, scopedReturns, stockBatches])

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

  const fetchInventoryData = async () => {
    setLoadingInventory(true)
    try {
      const response = await fetch('/api/inventory', { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed inventory fetch')
      const data = await response.json()
      setInventory(getCollection<InventoryItem>(data, ['inventory']))
    } catch (error) {
      console.error(error)
      toast.error('Failed to load inventory')
    } finally {
      setLoadingInventory(false)
    }
  }

  const fetchWarehousesData = async () => {
    setLoadingWarehouses(true)
    try {
      const response = await fetch('/api/warehouses', { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed warehouse fetch')
      const data = await response.json()
      setWarehouses(getCollection<WarehouseItem>(data, ['warehouses']))
      const firstWarehouse = getCollection<WarehouseItem>(data, ['warehouses'])[0]
      if (firstWarehouse?.id && !stockInWarehouseId) {
        setStockInWarehouseId(firstWarehouse.id)
      }
      if (firstWarehouse?.id && !routeWarehouseId) {
        setRouteWarehouseId(firstWarehouse.id)
      }
    } catch (error) {
      console.error(error)
      toast.error('Failed to load warehouses')
    } finally {
      setLoadingWarehouses(false)
    }
  }

  const fetchProductsData = async () => {
    try {
      const response = await fetch('/api/products?page=1&pageSize=500', { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed product fetch')
      const data = await response.json()
      setProducts(getCollection<ProductOption>(data, ['products']))
    } catch (error) {
      console.error(error)
      toast.error('Failed to load products')
    }
  }

  const fetchStockBatchesData = async () => {
    setLoadingBatches(true)
    try {
      const response = await fetch('/api/stock-batches?page=1&pageSize=200', { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed stock batch fetch')
      const data = await response.json()
      setStockBatches(getCollection<StockBatchItem>(data, ['stockBatches']))
    } catch (error) {
      console.error(error)
      toast.error('Failed to load stock-in batches')
    } finally {
      setLoadingBatches(false)
    }
  }

  const fetchOrderMarker = async () => {
    const response = await fetch('/api/orders?limit=1&includeItems=none', { cache: 'no-store', credentials: 'include' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || 'Failed orders fetch')
    }
    const topOrder = getCollection<WarehouseOrderItem>(data, ['orders'])[0]
    return `${Number(data?.total || 0)}::${topOrder?.id || ''}`
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

      const requestOrders = () => fetch('/api/orders?limit=100&includeItems=none', { cache: 'no-store', credentials: 'include' })

      let response = await requestOrders()
      let data = await response.json().catch(() => ({}))

      if (response.status === 401 || response.status === 403) {
        clearTabAuthToken()
        response = await requestOrders()
        data = await response.json().catch(() => ({}))
      }

      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed orders fetch')
      }

      const list = getCollection<WarehouseOrderItem>(data, ['orders'])
      setOrders(list)
      latestOrderMarkerRef.current = `${Number(data?.total || 0)}::${list[0]?.id || ''}`
    } catch (error: any) {
      console.error(error)
      if (!silent) {
        toast.error(error?.message || 'Failed to load orders')
      }
    } finally {
      if (showLoading) setLoadingOrders(false)
    }
  }

  const fetchTripsData = async () => {
    setLoadingTrips(true)
    try {
      const response = await fetch('/api/trips?limit=100', { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed trips fetch')
      const data = await response.json()
      setTrips(getCollection<WarehouseTripItem>(data, ['trips']))
    } catch (error) {
      console.error(error)
      toast.error('Failed to load trips')
    } finally {
      setLoadingTrips(false)
    }
  }

  const fetchReturnsData = async () => {
    setLoadingReturns(true)
    try {
      const response = await fetch('/api/orders?includeReturns=true&includeOrders=false&includeItems=none&limit=100', { cache: 'no-store' })
      if (!response.ok) throw new Error('Failed replacement fetch')
      const data = await response.json()
      setReturns(getCollection<WarehouseReturnItem>(data, ['returns']))
    } catch (error) {
      console.error(error)
      toast.error('Failed to load replacements')
    } finally {
      setLoadingReturns(false)
    }
  }

  const fetchDriversData = async () => {
    try {
      const response = await fetch('/api/drivers')
      if (!response.ok) throw new Error('Failed drivers fetch')
      const data = await response.json()
      const list = getCollection<DriverOption>(data, ['drivers'])
      setDrivers(list)
      const preferredDriver =
        list.find((driver) => driver?.isActive !== false && (driver.vehicles || []).some((entry) => entry?.vehicle?.id)) ||
        list.find((driver) => driver?.isActive !== false) ||
        list[0]

      if (preferredDriver?.id && !selectedRouteDriverId) {
        setSelectedRouteDriverId(preferredDriver.id)
      }
    } catch (error) {
      console.error(error)
      toast.error('Failed to load drivers')
    }
  }

  const fetchVehiclesData = async () => {
    try {
      const response = await fetch('/api/vehicles?status=AVAILABLE')
      if (!response.ok) throw new Error('Failed vehicles fetch')
      const data = await response.json()
      const list = getCollection<VehicleOption>(data, ['vehicles'])
      setVehicles(list)
      if (list[0]?.id && !selectedRouteVehicleId) {
        setSelectedRouteVehicleId(list[0].id)
      }
    } catch (error) {
      console.error(error)
      toast.error('Failed to load vehicles')
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
      const response = await fetch('/api/trips/route-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedSavedRoute.date,
          city: selectedSavedRoute.city,
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
      setSavedRoutes((prev) => prev.filter((route) => route.id !== selectedSavedRoute.id))
      setSelectedSavedRouteId('')
      setCreateTripOpen(false)
      await Promise.all([fetchTripsData(), fetchOrdersData()])
      emitDataSync(['trips', 'orders'])
    } catch (error: any) {
      const message = String(error?.message || 'Failed to create trip')
      const lowerMessage = message.toLowerCase()

      if (lowerMessage.includes('no eligible orders') || lowerMessage.includes('already assigned')) {
        setSavedRoutes((prev) => prev.filter((route) => route.id !== selectedSavedRoute.id))
        setSelectedSavedRouteId('')
        setCreateTripOpen(false)
        await Promise.all([fetchTripsData(), fetchOrdersData()])
        emitDataSync(['trips', 'orders'])
        toast.success('Trip data refreshed. Stale saved route was removed.')
      } else {
        toast.error(message)
      }
    } finally {
      setCreatingTripFromRoute(false)
    }
  }

  const saveRouteDraft = () => {
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

    const routeId = `route-${Date.now()}`
    const nextRoute: SavedRouteDraft = {
      id: routeId,
      date: routeDate,
      warehouseId: routeWarehouseId,
      warehouseName: warehouse?.name || 'Unknown Warehouse',
      city: selectedRouteCity,
      totalDistanceKm: Number(group.totalDistanceKm || 0),
      orderIds: selectedRouteOrderIds,
      orders: selectedOrders,
      createdAt: new Date().toISOString(),
    }

    setSavedRoutes((prev) => [nextRoute, ...prev])
    setSelectedSavedRouteId(routeId)
    setCreateRouteOpen(false)
    toast.success('Route saved. Assign driver later in New Trip.')
  }

  useEffect(() => {
    const refreshAllData = (options?: { initial?: boolean }) => {
      const initial = options?.initial ?? false
      void Promise.all([
        fetchInventoryData(),
        fetchWarehousesData(),
        fetchProductsData(),
        fetchStockBatchesData(),
        initial
          ? fetchOrdersData({ showLoading: true })
          : fetchOrdersData({ showLoading: false, onlyIfNew: true, silent: true }),
        fetchTripsData(),
        fetchReturnsData(),
        fetchDriversData(),
        fetchVehiclesData(),
      ])
    }

    refreshAllData({ initial: true })

    const unsubscribe = subscribeDataSync((message) => {
      const scopes = message.scopes
      if (scopes.some((scope) => ['inventory', 'products', 'stock-batches', 'warehouses'].includes(scope))) {
        void Promise.all([fetchInventoryData(), fetchProductsData(), fetchStockBatchesData(), fetchWarehousesData()])
      }
      if (scopes.includes('orders')) {
        void fetchOrdersData({ showLoading: false, onlyIfNew: true, silent: true })
      }
      if (scopes.includes('trips')) {
        void fetchTripsData()
      }
      if (scopes.includes('returns')) {
        void fetchReturnsData()
      }
      if (scopes.includes('drivers')) {
        void fetchDriversData()
      }
      if (scopes.includes('vehicles')) {
        void fetchVehiclesData()
      }
    })

    const onFocus = () => refreshAllData()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshAllData()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const intervalId = window.setInterval(refreshAllData, 30000)

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
      void fetchOrdersData({ showLoading: false, onlyIfNew: true, silent: true })
    }

    refreshOrdersQuick()
    const intervalId = window.setInterval(refreshOrdersQuick, 5000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activeView])

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
    setEditUnit(item.product?.unit || 'piece')
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
      await Promise.all([fetchInventoryData(), fetchProductsData(), fetchStockBatchesData()])
      emitDataSync(['inventory', 'products', 'stock-batches'])
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
      await Promise.all([fetchInventoryData(), fetchProductsData(), fetchStockBatchesData()])
      emitDataSync(['inventory', 'products', 'stock-batches'])
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
    setNewProductUnit('piece')
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
      await Promise.all([fetchInventoryData(), fetchStockBatchesData(), fetchProductsData()])
      emitDataSync(['inventory', 'products', 'stock-batches'])
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
    if (raw === 'PACKED') return 'LOADED'
    if (raw === 'DISPATCHED') return 'OUT FOR DELIVERY'
    return raw.replace(/_/g, ' ')
  }

  const updateWarehouseOrderStatus = async (
    orderId: string,
    status: 'PROCESSING' | 'PACKED' | 'DISPATCHED' | 'OUT_FOR_DELIVERY' | 'DELIVERED',
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

      setSelectedOrder((prev) => (prev && prev.id === orderId ? { ...prev, status, notes: reason || prev.notes } : prev))
      toast.success('Order status updated')
      await Promise.all([fetchOrdersData(), fetchTripsData()])
      emitDataSync(['orders', 'trips'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update order status')
    } finally {
      setUpdatingOrderId(null)
    }
  }

  const formatReplacementStatus = (status: string) => {
    return formatReplacementStatusLabel(status)
  }

  const updateReplacementStatus = async (
    replacementId: string,
    status: 'APPROVED' | 'PICKED_UP' | 'IN_TRANSIT' | 'RECEIVED' | 'PROCESSED' | 'REJECTED',
    notes?: string,
    createReplacementOrder?: boolean
  ) => {
    setUpdatingReplacementId(replacementId)
    try {
      const response = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'replacement',
          returnId: replacementId,
          status,
          notes,
          createReplacementOrder,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update replacement')
      }

      if (payload?.replacementOrder?.orderNumber) {
        toast.success(`Replacement completed. New order: ${payload.replacementOrder.orderNumber}`)
      } else {
        toast.success('Replacement updated')
      }
      await Promise.all([fetchReturnsData(), fetchOrdersData()])
      emitDataSync(['returns', 'orders'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update replacement')
    } finally {
      setUpdatingReplacementId(null)
    }
  }

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center gap-3">
          <img
            src="/ann-anns-logo.png"
            alt="Ann Ann's Beverages Trading logo"
            className="h-11 w-11 rounded-lg object-cover border"
          />
          <div>
            <h2 className="font-bold text-gray-900">Ann Ann's Beverages Trading</h2>
            <p className="text-xs text-gray-500">Warehouse Portal</p>
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
                activeView === navItem.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'
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

      <div className="p-4 border-t">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-indigo-600 text-white text-sm">
              {user?.name?.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <p className="text-xs text-gray-500 truncate">{user?.role}</p>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="hidden lg:flex w-64 bg-white border-r flex-col">
        <Sidebar />
      </aside>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="p-0 w-64">
          <Sidebar />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-h-screen">
        <header className="bg-white border-b sticky top-0 z-10">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
                <Menu className="h-5 w-5" />
              </Button>
              <div className="relative hidden md:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input placeholder="Search inventory, warehouse..." className="pl-10 w-64" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <DropdownMenu onOpenChange={(open) => { void handleNotificationsOpen(open) }}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative">
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
                  <Button variant="ghost" className="gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-indigo-600 text-white text-sm">
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
                  No assigned warehouse yet. Please contact an administrator to assign your warehouse.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">
                  Once assigned, this section will show data for your warehouse only.
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
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-gray-500">Assigned Warehouse</p>
                    <p className="text-3xl font-bold">{assignedWarehouse ? 1 : 0}</p>
                    <p className="mt-1 text-xs text-gray-500 truncate">
                      {assignedWarehouse ? `${assignedWarehouse.name} (${assignedWarehouse.code})` : 'No warehouse assigned'}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-gray-500">Inventory Items</p>
                    <p className="text-3xl font-bold">{scopedInventory.length}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500">Low Stock</p>
                        <p className="text-3xl font-bold text-red-600">{lowStockCount}</p>
                      </div>
                      <AlertTriangle className="h-8 w-8 text-red-500" />
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
                      {incomeOverviewData.map((item) => {
                        const max = Math.max(...incomeOverviewData.map((d) => d.value), 1)
                        return (
                          <div key={item.day} className="flex-1 flex flex-col items-center gap-2">
                            <div className="h-full w-full rounded-t-md bg-cyan-100/50 relative min-h-[4px] overflow-hidden">
                              <div className={`absolute bottom-0 left-0 right-0 rounded-t-md bg-cyan-400 min-h-[4px] ${getHeightClass((item.value / max) * 100)}`} />
                            </div>
                            <span className="text-[10px] text-gray-500">{item.day}</span>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
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
                            <td className="p-4">{new Date(order.createdAt).toLocaleDateString()}</td>
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
                                  onClick={() => updateWarehouseOrderStatus(order.id, 'PROCESSING')}
                                  disabled={(!['PENDING', 'CONFIRMED', 'UNAPPROVED'].includes(orderStatus) && !isPendingApproval) || updatingOrderId === order.id}
                                  title="Approve Order"
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
            />
          )}

          {activeView === 'returns' && (
            <Card>
              <CardHeader>
                <CardTitle>Replacements</CardTitle>
                <CardDescription>Track customer replacement requests and statuses.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loadingReturns ? (
                  <div className="h-40 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
                  </div>
                ) : returns.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-gray-500">No replacement requests found</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="text-left p-4 font-medium text-gray-600">Replacement #</th>
                          <th className="text-left p-4 font-medium text-gray-600">Order #</th>
                          <th className="text-left p-4 font-medium text-gray-600">Customer</th>
                          <th className="text-left p-4 font-medium text-gray-600">Replacement Reason</th>
                          <th className="text-left p-4 font-medium text-gray-600">Status</th>
                          <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {returns.map((ret) => (
                          <tr key={ret.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="p-4 font-medium">{ret.returnNumber}</td>
                            <td className="p-4">{ret.order?.orderNumber || 'N/A'}</td>
                            <td className="p-4">{ret.order?.customer?.name || 'N/A'}</td>
                            <td className="p-4">{ret.reason}</td>
                            <td className="p-4"><Badge>{formatReplacementStatus(ret.status)}</Badge></td>
                            <td className="p-4">
                              <div className="flex flex-wrap gap-2">
                                {ret.status === 'REQUESTED' && (
                                  <>
                                    <Button size="sm" variant="outline" onClick={() => updateReplacementStatus(ret.id, 'APPROVED')} disabled={updatingReplacementId === ret.id}>
                                      Approve
                                    </Button>
                                    <Button size="sm" variant="destructive" onClick={() => updateReplacementStatus(ret.id, 'REJECTED', 'Rejected by warehouse staff')} disabled={updatingReplacementId === ret.id}>
                                      Reject
                                    </Button>
                                  </>
                                )}
                                {ret.status === 'APPROVED' && (
                                  <Button size="sm" variant="outline" onClick={() => updateReplacementStatus(ret.id, 'PICKED_UP')} disabled={updatingReplacementId === ret.id}>
                                    Mark Processing
                                  </Button>
                                )}
                                {ret.status === 'PICKED_UP' && (
                                  <Button size="sm" variant="outline" onClick={() => updateReplacementStatus(ret.id, 'IN_TRANSIT')} disabled={updatingReplacementId === ret.id}>
                                    Mark as Loaded
                                  </Button>
                                )}
                                {ret.status === 'IN_TRANSIT' && (
                                  <Button size="sm" variant="outline" onClick={() => updateReplacementStatus(ret.id, 'RECEIVED')} disabled={updatingReplacementId === ret.id}>
                                    Mark Out for Delivery
                                  </Button>
                                )}
                                {ret.status === 'RECEIVED' && (
                                  <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => updateReplacementStatus(ret.id, 'PROCESSED', 'Replacement order issued by warehouse staff', true)} disabled={updatingReplacementId === ret.id}>
                                    Mark Delivered
                                  </Button>
                                )}
                                {updatingReplacementId === ret.id && <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />}
                              </div>
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

          {activeView === 'liveTracking' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Live Tracking</h1>
                  <p className="text-gray-500">Monitor active deliveries in real-time</p>
                </div>
                <Button className="gap-2">
                  <MapPin className="h-4 w-4" />
                  Refresh Map
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <Card className="h-[500px]">
                    <CardContent className="h-full p-0">
                      <div className="flex h-full items-center justify-center rounded-lg bg-gradient-to-br from-blue-100 to-blue-200">
                        <div className="text-center">
                          <MapPin className="mx-auto mb-4 h-16 w-16 text-blue-400" />
                          <p className="font-medium text-blue-600">Live Trip Map Area</p>
                          <p className="mt-2 text-sm text-blue-500">
                            Active trip count: {scopedTrips.filter((trip) => isActiveTripStatus(trip.status)).length}
                          </p>
                          <p className="mt-4 text-xs text-blue-400">Map tiles can be integrated here</p>
                        </div>
                      </div>
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
                      ) : scopedTrips.filter((trip) => isActiveTripStatus(trip.status)).length === 0 ? (
                        <p className="text-sm text-gray-500">No active trips right now</p>
                      ) : (
                        <div className="space-y-3">
                          {scopedTrips
                            .filter((trip) => isActiveTripStatus(trip.status))
                            .slice(0, 5)
                            .map((trip) => (
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
                      {scopedTrips
                        .filter((trip) => isActiveTripStatus(trip.status))
                        .flatMap((trip) => trip.dropPoints ?? [])
                        .filter((dropPoint) => typeof dropPoint?.latitude === 'number' && typeof dropPoint?.longitude === 'number')
                        .slice(0, 3).length === 0 ? (
                        <p className="text-sm text-gray-500">No coordinate logs available</p>
                      ) : (
                        <div className="space-y-2 text-sm">
                          {scopedTrips
                            .filter((trip) => isActiveTripStatus(trip.status))
                            .flatMap((trip) => trip.dropPoints ?? [])
                            .filter((dropPoint) => typeof dropPoint?.latitude === 'number' && typeof dropPoint?.longitude === 'number')
                            .slice(0, 3)
                            .map((dropPoint) => {
                              const latitude = Number(dropPoint.latitude ?? 0)
                              const longitude = Number(dropPoint.longitude ?? 0)

                              return (
                                <div key={dropPoint.id} className="flex justify-between gap-2">
                                  <span className="truncate text-gray-500">{dropPoint.locationName || 'Drop Point'}</span>
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
                                  />
                                  <div>
                                    <p className="font-semibold text-gray-900">{item.product?.name ?? 'N/A'}</p>
                                    <p className="text-xs text-gray-500">{item.product?.category?.name || 'General'}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="p-4 font-medium text-gray-900">{item.product?.unit || 'piece'}</td>
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

      <Dialog open={createRouteOpen} onOpenChange={setCreateRouteOpen}>
        <DialogContent className="w-[98vw] min-w-[1400px] h-full max-w-none max-h-[95vh] m-auto rounded-xl shadow-xl overflow-hidden p-0 flex items-stretch justify-center z-[60]">
          <DialogHeader>
            <DialogTitle className="sr-only">Create Delivery Route</DialogTitle>
          </DialogHeader>
          <div className="flex flex-row w-full h-full">
            <div className="flex flex-col bg-white border-r p-8 min-w-[340px] max-w-[400px] w-[360px]">
              <h2 className="text-2xl font-bold mb-6">Create Delivery Route</h2>
              <div className="mb-4">
                <label htmlFor="popup-route-date" className="text-sm font-medium text-gray-700">Delivery Date</label>
                <Input
                  id="popup-route-date"
                  type="date"
                  value={routeDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={e => setRouteDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="mb-4">
                <label htmlFor="warehouse-select" className="text-sm font-medium text-gray-700">Select Warehouse</label>
                <select
                  id="warehouse-select"
                  value={routeWarehouseId}
                  onChange={(e) => setRouteWarehouseId(e.target.value)}
                  title="Select warehouse"
                  className="w-full mt-1 px-3 py-2 border rounded-md bg-white"
                >
                  <option value="">-- Choose Warehouse --</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} ({warehouse.city})
                    </option>
                  ))}
                </select>
              </div>
              <Button className="w-full bg-black text-white hover:bg-black/90 mt-2 mb-4" onClick={() => createRoutePlan(false, routeDate, routeWarehouseId)} disabled={loadingRoutePlans}>
                {loadingRoutePlans ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                Filter Orders
              </Button>

              {routePlanMessage && (
                <div className={`p-3 rounded-lg mb-4 text-sm ${routePlanMessage.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                  {routePlanMessage.text}
                </div>
              )}

              <div className="bg-gray-50 rounded-lg p-4 overflow-y-auto flex-1">
                <h3 className="text-lg font-semibold mb-3">Orders by City</h3>
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
                          className={`w-full text-left p-3 rounded-lg font-semibold mb-2 transition-colors ${
                            selectedRouteCity === cityGroup.city
                              ? 'bg-blue-500 text-white'
                              : 'bg-white border border-gray-200 text-gray-900 hover:border-blue-400'
                          }`}
                        >
                          {cityGroup.city} ({cityGroup.orders.length} orders)
                        </button>
                        {selectedRouteCity === cityGroup.city && (
                          <div className="space-y-1 pl-2 mb-3">
                            {cityGroup.orders.map((order) => (
                              <button
                                key={order.id}
                                onClick={() => handleRouteOrderClick(cityGroup.city, order.id)}
                                className={`w-full text-left text-sm p-2 rounded transition-colors ${
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
                                    {selectedRouteOrderIds.includes(order.id) ? '✓' : ''}
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
              <div className="mt-4 space-y-2">
                <p className="text-xs text-gray-500">
                  Driver assignment is done in New Trip.
                </p>
                <Button
                  className="w-full bg-blue-600 text-white hover:bg-blue-700"
                  onClick={saveRouteDraft}
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
            <div className="flex-1 flex flex-col bg-gray-50 p-10 overflow-y-auto min-w-0">
              <Card>
                <CardHeader>
                  <CardTitle>Delivery Locations Map</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="w-full rounded-xl border bg-gray-50 p-6 flex flex-col items-center">
                    <h2 className="text-xl font-bold mb-2">Delivery Route Map</h2>
                    <p className="mb-6 text-gray-600">{(() => {
                      const wh = warehouses.find((w) => w.id === routeWarehouseId)
                      let count = 0
                      if (wh) count += 1
                      let selectedOrders: RoutePlanOrderItem[] = []
                      if (routePlans && selectedRouteCity) {
                        const group = routePlans.find((g) => g.city === selectedRouteCity)
                        if (group) {
                          selectedOrders = group.orders.filter((order) => selectedRouteOrderIds.includes(order.id))
                          count += selectedOrders.length
                        }
                      }
                      return `${count} delivery location${count === 1 ? '' : 's'} selected`
                    })()}</p>
                    {(() => {
                      const wh = warehouses.find((w) => w.id === routeWarehouseId)
                      if (!wh) return <div className="mb-4 text-gray-400">Select a warehouse to start</div>
                      return (
                        <div className="w-full max-w-xl mb-4">
                          <div className="rounded-lg border-2 border-green-400 bg-green-50 p-4 flex flex-col items-start mb-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-green-500 text-white font-bold mr-2">
                                <svg width="18" height="18" fill="none"><path d="M9 2.25a6.75 6.75 0 1 1 0 13.5a6.75 6.75 0 0 1 0-13.5Zm0 2.25v2.25m0 2.25h.008v.008H9V6.75Z" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              </span>
                              <span className="font-semibold text-green-900">Warehouse - Starting Point</span>
                            </div>
                            <div className="text-sm font-medium text-gray-700">{wh.name}</div>
                            <div className="text-xs text-green-700">{[wh.address, wh.city, wh.province].filter(Boolean).join(', ')}</div>
                            {wh.latitude && wh.longitude && (
                              <div className="text-xs text-gray-500 mt-1">Coordinates: {wh.latitude}, {wh.longitude}</div>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                    <div className="w-full max-w-xl flex flex-col gap-3">
                      {(() => {
                        if (!routePlans || !selectedRouteCity) return null
                        const group = routePlans.find((g) => g.city === selectedRouteCity)
                        if (!group) return null
                        const selectedOrders = group.orders.filter((order) => selectedRouteOrderIds.includes(order.id))
                        return selectedOrders.map((order, idx) => (
                          <div key={order.id} className="rounded-lg border bg-white flex items-start gap-3 p-4">
                            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-500 text-white font-bold text-lg">{idx + 1}</div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-gray-900">{order.customerName || order.orderNumber}</div>
                              <div className="text-xs text-gray-600">{order.address || order.city || ''}</div>
                              {order.products && (
                                <div className="text-xs text-gray-500 mt-1">{order.products}</div>
                              )}
                              {order.latitude && order.longitude && (
                                <div className="text-xs text-gray-500 mt-1">Coordinates: {order.latitude}, {order.longitude}</div>
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
                    {route.city} • {new Date(route.date).toLocaleDateString()} • {route.orderIds.length} orders
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
                <DialogDescription>
                  {loadingOrderDetail ? 'Loading latest order details...' : 'Complete order and client information'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-gray-500">Order Status</p>
                  <p className="font-semibold">{formatWarehouseOrderStatus(selectedOrder.status, (selectedOrder as any).paymentStatus)}</p>
                </div>
                <div className="rounded-md border p-3 space-y-1">
                  <p className="font-medium">Client Information</p>
                  <p className="text-sm text-gray-700">{selectedOrder.customer?.name || selectedOrder.shippingName || 'N/A'}</p>
                  <p className="text-sm text-gray-600">{selectedOrder.customer?.email || 'N/A'}</p>
                  <p className="text-sm text-gray-600">{selectedOrder.shippingPhone || selectedOrder.customer?.phone || 'N/A'}</p>
                  <p className="text-sm text-gray-600">
                    {[selectedOrder.shippingAddress, selectedOrder.shippingCity, selectedOrder.shippingProvince, selectedOrder.shippingZipCode].filter(Boolean).join(', ') || 'N/A'}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="font-medium mb-2">Order Details</p>
                  <div className="space-y-1">
                    {(selectedOrder.items || []).map((item) => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span>{item.product?.name || 'Product'} x{item.quantity}</span>
                        <span>{formatPeso((item.totalPrice ?? item.quantity * item.unitPrice) || 0)}</span>
                      </div>
                    ))}
                    <p className="text-right font-semibold pt-2">Total: {formatPeso(selectedOrder.totalAmount || 0)}</p>
                  </div>
                </div>
                {(() => {
                  const selectedOrderStatus = String(selectedOrder.status || '').toUpperCase()
                  const isPendingApproval = String((selectedOrder as any).paymentStatus || '').toLowerCase() === 'pending_approval'
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {!isPendingApproval && selectedOrderStatus === 'PROCESSING' ? (
                        <Button
                          className="bg-red-600 text-white hover:bg-red-700"
                          onClick={() => void updateWarehouseOrderStatus(selectedOrder.id, 'PACKED')}
                          disabled={updatingOrderId === selectedOrder.id}
                        >
                          Mark as Loaded
                        </Button>
                      ) : isPendingApproval || ['PENDING', 'CONFIRMED', 'UNAPPROVED'].includes(selectedOrderStatus) ? (
                        <Button
                          className="bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => void updateWarehouseOrderStatus(selectedOrder.id, 'PROCESSING')}
                          disabled={updatingOrderId === selectedOrder.id}
                        >
                          Mark as Loaded
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
                <DialogTitle>Mark as Loaded</DialogTitle>
                <DialogDescription>Optionally add notes before marking order {rejectOrder.orderNumber} as loaded.</DialogDescription>
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
                      if (!['PROCESSING'].includes(rejectOrder.status)) {
                        toast.error('Order is not eligible for packing')
                        return
                      }
                      await updateWarehouseOrderStatus(rejectOrder.id, 'PACKED', rejectReason.trim() || undefined)
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
                    <Input id="new-product-unit" value={newProductUnit} onChange={(e) => setNewProductUnit(e.target.value)} />
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
              <Input id="edit-unit" value={editUnit} onChange={(e) => setEditUnit(e.target.value)} />
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
