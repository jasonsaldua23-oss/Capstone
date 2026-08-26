'use client'

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '@/app/page'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import { toast } from 'sonner'
import { isValidPhilippineDriverLicense } from '@/lib/driver-license-restrictions'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { WarehouseTripsSection } from './WarehouseTripsSection'
import { WarehouseHeader } from './sections/layout/warehouse-header'
import { useWarehousePortalLayoutState, type WarehouseView } from './sections/layout/portal-state'
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
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { portalFont } from '../portal-font'
import { WarehouseSidebar } from './sections/layout/warehouse-sidebar'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { clearTabAuthToken, getTabAuthToken } from '@/lib/client-auth'
import { validatePasswordPolicy } from '@/lib/password-policy'
import { formatPhilippinePhoneInput, isValidPhilippinePhone } from '@/lib/philippine-phone'
import { OtpVerificationModal } from '@/components/shared/otp-verification-modal'
import { AvatarCropDialog } from '@/components/shared/avatar-crop-dialog'
import { useAvatarCrop } from '@/hooks/use-avatar-crop'
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
  Plus,
  Pencil,
  Eye,
  CircleCheck,
  CheckCircle2,
  ShieldCheck,
  KeyRound,
  Lock,
  EyeOff,
  Trash2,
  ClipboardList,
  User,
  Mail,
  Phone,
  Building2,
  Clock,
  Route,
  Car,
  CalendarClock,
  Camera,
  XCircle,
  Recycle,
  Store,
  ShoppingCart,
} from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Label as RechartsLabel, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts'
import { CompactDiscountLine } from '@/components/shared/compact-discount-line'
import {
  buildInventoryStatusBreakdown,
  buildSkuVelocityData,
  buildUtilizationTrend,
  buildWarehouseCapacitySummary,
  buildWeeklyOrderTrendData,
  countActiveTrips,
  getInventoryAlertLevel,
  getInventoryAvailableQty,
  getInventoryThreshold,
  isInventoryOverstocked,
  summarizeStockHealth,
  summarizeWarehouseDashboardOrders,
} from '@/lib/report-metrics'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

function formatFullName(
  firstName?: string | null,
  middleName?: string | null,
  lastName?: string | null,
  suffix?: string | null,
  fallback?: string
): string {
  const first = (firstName || '').trim()
  const middle = (middleName || '').trim()
  const last = (lastName || '').trim()
  const suf = (suffix || '').trim()

  const parts: string[] = []
  if (first) parts.push(first)
  if (middle) {
    const cleanM = middle.replace(/\.+$/, '')
    if (cleanM) parts.push(`${cleanM.charAt(0).toUpperCase()}.`)
  }
  if (last) parts.push(last)

  let result = parts.join(' ')
  if (suf) result = result ? `${result} ${suf}` : suf
  return result || fallback || ''
}

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
    sizes?: string[]
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
  unit?: string
  sizes?: string[]
  category?: string
  inventoryStatus?: 'healthy' | 'low' | 'critical' | 'out_of_stock' | 'overstocked'
  isOverstocked?: boolean
  overstockInfo?: {
    available: number
    threshold: number
    daysSinceRestock: number
  } | null
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
  stockUnitLabel?: string | null
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

interface WarehouseOrderItem {
  id: string
  orderNumber: string
  updatedAt?: string
  warehouseId?: string
  status: string
  paymentStatus?: string | null
  isDriverAssigned?: boolean
  assignedDriverName?: string | null
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
    // Additional fields from API
    productName?: string
    name?: string
  }>
  progress?: {
    trip?: {
      tripNumber?: string
      tripSchedule?: string | null
      driver?: {
        user?: {
          name?: string
        }
        name?: string
      }
      vehicle?: {
        licensePlate?: string
      }
      dropPoints?: Array<{
        id?: string
        order?: {
          id?: string
          orderNumber?: string
          status?: string
          deliveryDate?: string | null
          timeline?: {
            deliveryDate?: string | null
          } | null
        } | null
      }>
    } | null
    dropPoint?: {
      status?: string | null
    } | null
    pod?: {
      recipientName?: string | null
      deliveryPhoto?: string | null
      actualArrival?: string | null
      actualDeparture?: string | null
    } | null
  } | null
  // Additional API response fields
  warehouse_id?: string
  warehouseIds?: string[]
  warehouseAllocations?: Array<{
    warehouseId?: string
    warehouse_id?: string
    warehouse?: { id?: string; name?: string; code?: string }
    allocatedQty?: number
  }>
  fulfillments?: Array<{
    warehouseId?: string
    warehouse_id?: string
    warehouse?: { id?: string; name?: string }
    status?: string
    tripId?: string
  }>
  isScheduledReplacement?: boolean
  order_number?: string
  assignedTripId?: string
  tripId?: string
}

interface WarehouseTripItem {
  id: string
  tripNumber: string
  tripSchedule?: string | null
  warehouseId?: string
  warehouse?: {
    id?: string
    name?: string
    code?: string
  }
  status: string
  totalDropPoints?: number
  completedDropPoints?: number
  driver?: {
    id?: string
    name?: string
    user?: {
      name?: string
    }
  }
  vehicle?: {
    id?: string
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
  // Additional API response fields for replacement items
  quantityToReplace?: number
  damagedQuantity?: number
  quantityReplaced?: number
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
  currentTripOrder?: boolean
}

interface RoutePlanCityGroup {
  city: string
  orderCount: number
  totalDistanceKm: number
  orders: RoutePlanOrderItem[]
}

interface TripEditorState {
  tripId: string
  tripNumber: string
  originalOrderIds: string[]
  originalDriverId: string
  originalVehicleId: string
  driverName: string
  vehiclePlate: string
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

interface StockRow {
  id: string
  productId: string
  quantity: string
  manufacturedDate: string
  expiryDate: string
  validationErrors: {
    productId?: string
    quantity?: string
    manufacturedDate?: string
    expiryDate?: string
  }
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

function getLocalTodayDate() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function getLocalTodayDayKey() {
  return formatDayKey(getLocalTodayDate())
}

function parseDayKey(value: string) {
  const [yearText, monthText, dayText] = String(value || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(year, month - 1, day)
}

function normalizeToDayKey(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const base = raw.includes('T') ? raw.slice(0, 10) : raw
  const parsed = parseDayKey(base)
  return parsed ? formatDayKey(parsed) : ''
}

function isBeforeTodayDayKey(value: string | null | undefined) {
  const dayKey = normalizeToDayKey(value)
  if (!dayKey) return false
  const parsed = parseDayKey(dayKey)
  if (!parsed) return false
  return parsed < getLocalTodayDate()
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
  if (value === 'IN_TRANSIT' || value === 'OUT_FOR_DELIVERY') return 'IN_PROGRESS'
  return value
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
  { id: 'retailPos', label: 'Retail', icon: Store },
  { id: 'purchaseRequests', label: 'Purchase Requests', icon: ShoppingCart },
  { id: 'orders', label: 'Purchase Orders', icon: PackageCheck },
  { id: 'trips', label: 'Trips & Deliveries', icon: Truck },
  { id: 'replacements', label: 'Replacements', icon: AlertTriangle },
  { id: 'liveTracking', label: 'Live Tracking', icon: MapPin },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'transactions', label: 'Inventory Transactions', icon: ClipboardList },
  { id: 'warehouses', label: 'Warehouse', icon: Warehouse },
  { id: 'settings', label: 'Settings', icon: Settings },
]


export function WarehousePortal() {
  const { user, setUser, logout } = useAuth()
  const {
    activeView,
    setActiveView,
    sidebarOpen,
    setSidebarOpen,
    handleLogout,
  } = useWarehousePortalLayoutState({ logout })
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
  const [trackingDate, setTrackingDate] = useState(() => formatDayKey(new Date()))
  const [createRouteOpen, setCreateRouteOpen] = useState(false)
  const [createTripOpen, setCreateTripOpen] = useState(false)
  const [editingTripState, setEditingTripState] = useState<TripEditorState | null>(null)
  const [inventorySubView, setInventorySubView] = useState<'inventory' | 'stocks' | 'empties'>('inventory')
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
  const [selectedTrip, setSelectedTrip] = useState<WarehouseTripItem | null>(null)
  const [tripToDelete, setTripToDelete] = useState<WarehouseTripItem | null>(null)
  const [rejectOrder, setRejectOrder] = useState<WarehouseOrderItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editImageUrl, setEditImageUrl] = useState('')
  const [editImageFile, setEditImageFile] = useState<File | null>(null)
  const [editingBatch, setEditingBatch] = useState<StockBatchItem | null>(null)
  const [editBatchQuantity, setEditBatchQuantity] = useState('')
  const [editBatchManufacturedDate, setEditBatchManufacturedDate] = useState('')
  const [editBatchExpiryDate, setEditBatchExpiryDate] = useState('')
  const [isSavingBatchQty, setIsSavingBatchQty] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeletingEdit, setIsDeletingEdit] = useState(false)
  const [deleteEditOpen, setDeleteEditOpen] = useState(false)
  const [addStockOpen, setAddStockOpen] = useState(false)
  const [isSubmittingStockIn, setIsSubmittingStockIn] = useState(false)
  const [stockInWarehouseId, setStockInWarehouseId] = useState('')
  const [stockRows, setStockRows] = useState<StockRow[]>([
    { id: `row-${Date.now()}-0`, productId: '', quantity: '', manufacturedDate: '', expiryDate: '', validationErrors: {} }
  ])
  const [profileName, setProfileName] = useState('')
  const [profileFirstName, setProfileFirstName] = useState('')
  const [profileMiddleName, setProfileMiddleName] = useState('')
  const [profileLastName, setProfileLastName] = useState('')
  const [profileSuffix, setProfileSuffix] = useState('')
  const [profileEmail, setProfileEmail] = useState('')
  const [profilePhone, setProfilePhone] = useState('')
  const [profileAvatarFile, setProfileAvatarFile] = useState<File | null>(null)
  const profileAvatarInputRef = useRef<HTMLInputElement | null>(null)
  const profileAvatarCrop = useAvatarCrop()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [otpModalKind, setOtpModalKind] = useState<'profile' | 'password' | null>(null)
  const [profileOtp, setProfileOtp] = useState('')
  const [profileOtpSent, setProfileOtpSent] = useState(false)
  const [profileOtpVerified, setProfileOtpVerified] = useState(false)
  const [profileOtpToken, setProfileOtpToken] = useState('')
  const [isSendingProfileOtp, setIsSendingProfileOtp] = useState(false)
  const [isVerifyingProfileOtp, setIsVerifyingProfileOtp] = useState(false)
  const [passwordOtp, setPasswordOtp] = useState('')
  const [passwordOtpSent, setPasswordOtpSent] = useState(false)
  const [passwordOtpVerified, setPasswordOtpVerified] = useState(false)
  const [passwordOtpToken, setPasswordOtpToken] = useState('')
  const [isSendingPasswordOtp, setIsSendingPasswordOtp] = useState(false)
  const [isVerifyingPasswordOtp, setIsVerifyingPasswordOtp] = useState(false)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [loginAlertsEnabled, setLoginAlertsEnabled] = useState(true)
  const [isSavingSecuritySettings, setIsSavingSecuritySettings] = useState(false)
  const [isEditingProfile, setIsEditingProfile] = useState(false)
  const [isEditingSecurity, setIsEditingSecurity] = useState(false)
  const hasNewPassword = newPassword.length > 0
  const passwordRequirements = [
    { id: 'length', label: 'At least 8 characters', met: newPassword.length >= 8 },
    { id: 'upper', label: 'At least 1 uppercase letter', met: hasNewPassword && /[A-Z]/.test(newPassword) },
    { id: 'lower', label: 'At least 1 lowercase letter', met: hasNewPassword && /[a-z]/.test(newPassword) },
    { id: 'number', label: 'At least 1 number', met: hasNewPassword && /\d/.test(newPassword) },
    { id: 'special', label: 'At least 1 special character', met: hasNewPassword && /[^A-Za-z0-9\s]/.test(newPassword) },
    { id: 'no-spaces', label: 'No spaces', met: hasNewPassword && !/\s/.test(newPassword) },
  ]

  useEffect(() => {
    if (!trackingDate) {
      setTrackingDate(formatDayKey(new Date()))
    }
  }, [trackingDate])

  const getItemThreshold = (item: InventoryItem | null | undefined) => getInventoryThreshold(item)
  const isOverstockedInventoryItem = (item: InventoryItem | null | undefined) => isInventoryOverstocked(item)
  const [warehouseLoadError, setWarehouseLoadError] = useState<string | null>(null)
  const latestOrderMarkerRef = useRef<string>('')
  const latestOrderUpdatedAtRef = useRef<string>('')
  const orderDetailsLoadedRef = useRef(false)
  const isPollingOrderStatusesRef = useRef(false)
  const savedRoutesGetUnsupportedRef = useRef(false)
  const isRefreshingAllRef = useRef(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const openLogoutConfirm = () => setLogoutConfirmOpen(true)
  const hasAssignedWarehouse = warehouses.length > 0
  const hasWarehouseFetchFailure = !hasAssignedWarehouse && Boolean(warehouseLoadError)
  const assignedWarehouse = warehouses[0] || null
  const isWarehouseScopedUser =
    user?.type === 'staff' && ['WAREHOUSE', 'WAREHOUSE_STAFF', 'INVENTORY_MANAGER'].includes(String(user?.role || '').toUpperCase())
  const sidebarNavItems = navItems
  const activeSectionLabel = navItems.find((item) => item.id === activeView)?.label || 'Dashboard'
  const warehouseMatches = (warehouseId?: string | null, warehouseName?: string | null, warehouseCode?: string | null) => {
    if (!assignedWarehouse) return true
    if (warehouseId && warehouseId === assignedWarehouse.id) return true
    if (warehouseCode && assignedWarehouse.code && warehouseCode.toLowerCase() === assignedWarehouse.code.toLowerCase()) return true
    if (warehouseName && assignedWarehouse.name && warehouseName.toLowerCase() === assignedWarehouse.name.toLowerCase()) return true
    return false
  }

  useEffect(() => {
    setProfileName(String((user as any)?.name || ''))
    const nameParts = String((user as any)?.name || '').trim().split(/\s+/).filter(Boolean)
    setProfileFirstName(String((user as any)?.firstName || nameParts[0] || ''))
    setProfileMiddleName(String((user as any)?.middleName || ''))
    setProfileLastName(String((user as any)?.lastName || nameParts.slice(1).join(' ') || ''))
    setProfileSuffix(String((user as any)?.suffix || ''))
    setProfileEmail(String((user as any)?.email || ''))
    setProfilePhone(String((user as any)?.phone || ''))
    setProfileAvatarFile(null)
    setTwoFactorEnabled(Boolean((user as any)?.twoFactorEnabled ?? (user as any)?.two_factor_enabled))
    setLoginAlertsEnabled((user as any)?.loginAlertsEnabled ?? (user as any)?.login_alerts_enabled ?? true)
    setNewPassword('')
    setConfirmPassword('')
  }, [user])

  const accountEmail = String((user as any)?.email || '').trim().toLowerCase()
  const accountRoleId = String((user as any)?.role || '').trim().toUpperCase()
  const normalizedProfileEmail = profileEmail.trim().toLowerCase()
  const isProfileEmailChanged = normalizedProfileEmail !== accountEmail

  const requestOtp = async (targetEmail: string, kind: 'profile' | 'password') => {
    const emailToVerify = targetEmail.trim().toLowerCase()
    if (!emailToVerify) {
      toast.error('Email is required')
      return false
    }
    if (kind === 'profile') setIsSendingProfileOtp(true)
    else setIsSendingPasswordOtp(true)
    try {
      const response = await fetch(kind === 'password' ? '/api/auth/password-reset/request-otp' : '/api/auth/email-verification/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToVerify, accountType: 'staff', roleId: accountRoleId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to send OTP')
      }
      if (kind === 'profile') {
        setProfileOtpSent(true)
        setProfileOtpVerified(false)
        setProfileOtpToken('')
        setProfileOtp('')
      } else {
        setPasswordOtpSent(true)
        setPasswordOtpVerified(false)
        setPasswordOtpToken('')
        setPasswordOtp('')
      }
      setOtpModalKind(kind)
      toast.success('Verification OTP code sent to your email')
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send OTP')
      return false
    } finally {
      if (kind === 'profile') setIsSendingProfileOtp(false)
      else setIsSendingPasswordOtp(false)
    }
  }

  const verifyOtp = async (targetEmail: string, kind: 'profile' | 'password', otpValue?: string) => {
    const emailToVerify = targetEmail.trim().toLowerCase()
    const otp = (otpValue || (kind === 'profile' ? profileOtp : passwordOtp)).trim()
    if (!emailToVerify) {
      toast.error('Email is required')
      return false
    }
    if (!otp) {
      toast.error('Enter OTP first')
      return false
    }
    if (kind === 'profile') setIsVerifyingProfileOtp(true)
    else setIsVerifyingPasswordOtp(true)
    try {
      const response = await fetch(kind === 'password' ? '/api/auth/password-reset/verify-otp' : '/api/auth/email-verification/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToVerify, accountType: 'staff', otp }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to verify OTP')
      }
      if (kind === 'profile') {
        const token = String(payload?.verificationToken || '').trim()
        if (!token) throw new Error('Missing verification token')
        setProfileOtpVerified(true)
        setProfileOtpToken(token)
      } else {
        setPasswordOtpVerified(true)
        setPasswordOtpToken(otp)
      }
      toast.success('OTP verified successfully')
      setOtpModalKind(null)
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to verify OTP')
      return false
    } finally {
      if (kind === 'profile') setIsVerifyingProfileOtp(false)
      else setIsVerifyingPasswordOtp(false)
    }
  }

  const saveCroppedAvatar = async (file: File) => {
    const userId = String((user as any)?.userId || (user as any)?.id || '').trim()
    if (!userId) throw new Error('Unable to resolve account ID')
    setIsSavingProfile(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const uploadResponse = await fetch('/api/uploads/customer-avatar', { method: 'POST', body: formData })
      const uploadPayload = await uploadResponse.json().catch(() => ({}))
      if (!uploadResponse.ok || !uploadPayload?.imageUrl) throw new Error(uploadPayload?.error || 'Failed to upload avatar')
      const avatar = String(uploadPayload.imageUrl).trim()
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Failed to save avatar')
      setUser((previous: any) => ({ ...(previous || {}), avatar }))
      setProfileAvatarFile(null)
      toast.success('Profile photo updated')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const saveProfileSettings = async () => {
    const userId = String((user as any)?.userId || (user as any)?.id || '').trim()
    if (!userId) {
      toast.error('Unable to resolve account ID')
      return
    }
    if (!profileFirstName.trim() || !profileLastName.trim() || !profileEmail.trim()) {
      toast.error('Name and email are required')
      return
    }
    if (!isValidPhilippinePhone(profilePhone)) {
      toast.error('Please enter a valid Philippine mobile number')
      return
    }
    if (isProfileEmailChanged && !profileOtpVerified) {
      toast.error('Verify OTP for the new email before saving')
      return
    }

    setIsSavingProfile(true)
    try {
      let avatarToSave = String((user as any)?.avatar || '').trim() || null
      if (profileAvatarFile) {
        const formData = new FormData()
        formData.append('file', profileAvatarFile)
        const uploadResponse = await fetch('/api/uploads/customer-avatar', { method: 'POST', body: formData })
        const uploadPayload = await uploadResponse.json().catch(() => ({}))
        if (!uploadResponse.ok || !uploadPayload?.imageUrl) throw new Error(uploadPayload?.error || 'Failed to upload avatar')
        avatarToSave = String(uploadPayload.imageUrl).trim()
      }
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formatFullName(profileFirstName, profileMiddleName, profileLastName, profileSuffix, profileName),
          firstName: profileFirstName.trim(),
          middleName: profileMiddleName.trim(),
          lastName: profileLastName.trim(),
          suffix: profileSuffix.trim() || null,
          email: profileEmail.trim(),
          phone: profilePhone.trim() || null,
          avatar: avatarToSave,
          emailVerificationToken: isProfileEmailChanged ? profileOtpToken : undefined,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update profile')
      }

      const nextUser = payload?.user || {}
      setUser((prev: any) => ({
        ...(prev || {}),
        name: nextUser.name ?? formatFullName(profileFirstName, profileMiddleName, profileLastName, profileSuffix, profileName.trim()),
        firstName: nextUser.firstName ?? profileFirstName.trim(),
        middleName: nextUser.middleName ?? profileMiddleName.trim(),
        lastName: nextUser.lastName ?? profileLastName.trim(),
        suffix: nextUser.suffix ?? profileSuffix.trim(),
        email: nextUser.email ?? profileEmail.trim(),
        phone: nextUser.phone ?? (profilePhone.trim() || ''),
        avatar: nextUser.avatar ?? avatarToSave,
      }))
      setProfileAvatarFile(null)
      if (isProfileEmailChanged) {
        setProfileOtpSent(false)
        setProfileOtpVerified(false)
        setProfileOtpToken('')
        setProfileOtp('')
      }
      // Added: return the successful profile save to its read-only Edit state.
      setIsEditingProfile(false)
      toast.success('Profile updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const updateProfilePassword = async () => {
    const accountEmailForReset = String((user as any)?.email || '').trim().toLowerCase()
    if (!accountEmailForReset) {
      toast.error('Unable to resolve account email')
      return
    }
    if (!newPassword.trim()) {
      toast.error('New password is required')
      return
    }
    if (!confirmPassword.trim()) {
      toast.error('Confirm your new password')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    const passwordError = validatePasswordPolicy(newPassword)
    if (passwordError) {
      toast.error(passwordError)
      return
    }
    if (!passwordOtpVerified) {
      toast.error('Verify OTP before updating password')
      return
    }

    setIsUpdatingPassword(true)
    try {
      const response = await fetch('/api/auth/password-reset/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: accountEmailForReset,
          accountType: 'staff',
          otp: passwordOtpToken,
          newPassword,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update password')
      }
      setNewPassword('')
      setConfirmPassword('')
      setPasswordOtp('')
      setPasswordOtpSent(false)
      setPasswordOtpVerified(false)
      setPasswordOtpToken('')
      toast.success('Password updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update password')
    } finally {
      setIsUpdatingPassword(false)
    }
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
  const availableVehicleIdSet = useMemo(
    () => new Set(vehicles.map((vehicle) => String(vehicle?.id || '').trim()).filter(Boolean)),
    [vehicles]
  )
  const getDriverAssignedVehicle = (driver: DriverOption | undefined, options?: { allowVehicleId?: string | null }) => {
    const assigned = (driver?.vehicles || []).find((item) => item?.vehicle?.id)?.vehicle
    if (!assigned?.id) return undefined
    const assignedId = String(assigned.id).trim()
    if (options?.allowVehicleId && assignedId === String(options.allowVehicleId).trim()) {
      return assigned
    }
    return availableVehicleIdSet.has(assignedId) ? assigned : undefined
  }
  const getDriverProfileCompletenessIssue = (driver: DriverOption | undefined) => {
    if (!driver) return 'Driver not found'
    const phone = String((driver as any)?.phone || (driver as any)?.user?.phone || '').trim()
    const licenseNumber = String((driver as any)?.licenseNumber || (driver as any)?.license_number || '').trim()
    const licenseType = String((driver as any)?.licenseType || (driver as any)?.license_type || '').trim()
    const licenseExpiry = String((driver as any)?.licenseExpiry || (driver as any)?.license_expiry || '').trim()
    if (!phone || !licenseNumber || !licenseType || !licenseExpiry) {
      return 'Incomplete driver license profile'
    }
    if (!isValidPhilippineDriverLicense(licenseNumber)) {
      return 'Invalid driver license format (LTO: X00-00-000000)'
    }
    if (licenseExpiry && licenseExpiry < new Date().toISOString().slice(0, 10)) {
      return 'Driver license has expired'
    }
    return ''
  }

  const saveSecuritySettings = async () => {
    const userId = String((user as any)?.userId || (user as any)?.id || '').trim()
    if (!userId) {
      toast.error('Unable to resolve account ID')
      return
    }

    setIsSavingSecuritySettings(true)
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          twoFactorEnabled,
          loginAlertsEnabled,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update security settings')
      }

      const nextUser = payload?.user || {}
      setUser((prev: any) => ({
        ...(prev || {}),
        twoFactorEnabled: Boolean(nextUser.twoFactorEnabled ?? nextUser.two_factor_enabled ?? twoFactorEnabled),
        loginAlertsEnabled: Boolean(nextUser.loginAlertsEnabled ?? nextUser.login_alerts_enabled ?? loginAlertsEnabled),
      }))
      toast.success('Security settings updated')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update security settings')
    } finally {
      setIsSavingSecuritySettings(false)
    }
  }
  const isDriverSelectableForTrip = (driver: DriverOption | undefined, options?: { allowDriverId?: string | null; allowVehicleId?: string | null }) => {
    if (!driver || driver?.isActive === false) return false
    if (getDriverProfileCompletenessIssue(driver)) return false
    if (options?.allowDriverId && String(driver.id || '').trim() === String(options.allowDriverId).trim()) {
      return Boolean(getDriverAssignedVehicle(driver, { allowVehicleId: options.allowVehicleId })?.id)
    }
    return Boolean(getDriverAssignedVehicle(driver)?.id)
  }
  const getDriverTripEligibilityLabel = (driver: DriverOption | undefined, options?: { allowDriverId?: string | null; allowVehicleId?: string | null }) => {
    if (driver?.isActive === false) return 'Inactive'
    const profileIssue = getDriverProfileCompletenessIssue(driver)
    if (profileIssue) return profileIssue
    const assignedVehicle = (driver?.vehicles || []).find((item) => item?.vehicle?.id)?.vehicle
    if (!assignedVehicle?.id) return 'No assigned vehicle'
    if (!isDriverSelectableForTrip(driver, options)) return 'Assigned vehicle unavailable'
    return ''
  }
  const selectedDriverAssignedVehicle = useMemo(() => {
    const driver = drivers.find((d) => d.id === selectedRouteDriverId)
    return getDriverAssignedVehicle(driver, {
      allowVehicleId: editingTripState?.originalVehicleId,
    })
  }, [drivers, selectedRouteDriverId, availableVehicleIdSet, editingTripState])
  const selectedDriverEligibilityIssue = useMemo(() => {
    const driver = drivers.find((d) => d.id === selectedRouteDriverId)
    return getDriverTripEligibilityLabel(driver, {
      allowDriverId: editingTripState?.originalDriverId,
      allowVehicleId: editingTripState?.originalVehicleId,
    })
  }, [drivers, selectedRouteDriverId, availableVehicleIdSet, editingTripState])

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
    setTripToDelete(trip)
  }

  const confirmDeleteTrip = async () => {
    if (!tripToDelete) return
    const trip = tripToDelete

    try {
      const response = await fetch(`/api/trips/${trip.id}`, { method: 'DELETE' })
      const raw = await response.text()
      let data: any = {}
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        data = {}
      }
      if (!response.ok || data?.success === false) {
        const fallbackText = String(raw || '').trim()
        throw new Error(data?.error || fallbackText || 'Failed to delete trip')
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
    } finally {
      setTripToDelete(null)
    }
  }

  const unassignOrderItemsFromTrip = async (tripId: string, orderId: string, warehouseId: string, itemIds: string[]) => {
    try {
      const response = await fetch(`/api/trips/${tripId}/unassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, warehouseId, itemIds }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to unassign items')
      }
      await fetchTripsData()
      await fetchOrdersData()
      emitDataSync(['trips', 'orders'])
      toast.success(`Unassigned ${data?.deletedCount || 0} items from trip`)
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to unassign items')
      return false
    }
  }

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

  const isDropPointCompleted = (status: unknown) => {
    const value = String(status || '').toUpperCase()
    return ['COMPLETED', 'DELIVERED', 'FULFILLED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(value)
  }

  const isCompletedOrderStatus = (status: unknown) => {
    const value = String(status || '').toUpperCase()
    return ['DELIVERED', 'COMPLETED', 'FULFILLED'].includes(value)
  }
  const isCancelledLikeStatus = (status: unknown) => {
    const value = String(status || '').toUpperCase()
    return ['CANCELLED', 'CANCELED', 'FAILED', 'SKIPPED', 'FAILED_DELIVERY', 'REJECTED'].includes(value)
  }

  const isDateMatch = (value: unknown, dayKey: string) => {
    if (!value || !dayKey) return false
    const raw = String(value).trim()
    if (!raw) return false
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
    const dropPoints = Array.isArray(tripAny?.dropPoints) ? tripAny.dropPoints : []
    if (
      dropPoints.some((point) =>
        [
          point?.actualArrival,
          point?.actualDeparture,
          point?.order?.deliveryDate,
          point?.order?.timeline?.deliveryDate,
        ].some((value) => isDateMatch(value, trackingDate))
      )
    ) {
      return true
    }
    const logs = Array.isArray(tripAny?.locationLogs) ? tripAny.locationLogs : []
    if (logs.some((log) => isDateMatch(log?.recordedAt || log?.createdAt, trackingDate))) return true
    return isDateMatch(tripAny?.latestLocation?.recordedAt, trackingDate)
  }
  const dropPointMatchesTrackingDay = (dropPoint: any) => {
    if (!trackingDate) return true
    return [
      dropPoint?.actualArrival,
      dropPoint?.actualDeparture,
      dropPoint?.order?.deliveryDate,
      dropPoint?.order?.timeline?.deliveryDate,
      dropPoint?.deliveryDate,
      dropPoint?.createdAt,
    ].some((value) => isDateMatch(value, trackingDate))
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

    const cancelledOrderIds = new Set(
      scopedOrders
        .filter((order: any) => isCancelledLikeStatus(order?.status))
        .map((order: any) => String(order?.id || '').trim())
        .filter(Boolean)
    )
    const dayOrders = scopedOrders.filter((order: any) => orderMatchesTrackingDay(order) && !isCancelledLikeStatus(order?.status))
    const dayOrderIds = new Set(
      dayOrders.map((order: any) => String(order?.id || '').trim()).filter(Boolean)
    )
    const tripOrderIds = new Set<string>()

    scopedTrips
      .filter(
        (trip: any) =>
          ['IN_PROGRESS'].includes(normalizeTripStatus(trip?.status))
      )
      .forEach((trip: any) => {
        const normalizedTripStatus = normalizeTripStatus(trip?.status)
        const tripMatchesDay = tripMatchesTrackingDay(trip)
        const toCoordinate = (value: unknown) => {
          const parsed = Number(value)
          return Number.isFinite(parsed) ? parsed : null
        }
        const allEligibleDropPoints = (trip.dropPoints || [])
          .filter((point: any) => {
            const orderId = String(point?.orderId || '').trim()
            if (orderId && cancelledOrderIds.has(orderId)) return false
            if (isCancelledLikeStatus(point?.status) || isCancelledLikeStatus(point?.orderStatus) || isCancelledLikeStatus(point?.order?.status)) return false
            return true
          })
          .filter((point: any) => typeof point?.latitude === 'number' && typeof point?.longitude === 'number')
          .sort((a: any, b: any) => Number(a?.sequence || 0) - Number(b?.sequence || 0))

        const dropPointsFilteredByDate = allEligibleDropPoints
          .filter((point: any) => {
            const orderId = String(point?.orderId || '').trim()
            if (dropPointMatchesTrackingDay(point)) return true
            if (tripMatchesDay && !trackingDate) return true
            if (!orderId) return false
            return dayOrderIds.has(orderId)
          })
        const dropPoints = dropPointsFilteredByDate.length > 0 ? dropPointsFilteredByDate : allEligibleDropPoints

        const getLogLatitude = (log: any) => Number(log?.latitude ?? log?.lat)
        const getLogLongitude = (log: any) => Number(log?.longitude ?? log?.lng)
        const getLogTripId = (log: any) => String(log?.tripId || log?.trip_id || log?.trip || '').trim()
        const getLogRecordedAt = (log: any) =>
          new Date(log?.recordedAt || log?.recorded_at || log?.createdAt || log?.created_at || 0).getTime()
        const logs = (trip.locationLogs || [])
          .filter((log: any) => {
            const lat = getLogLatitude(log)
            const lng = getLogLongitude(log)
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
            const logTripId = getLogTripId(log)
            return !logTripId || logTripId === String(trip?.id || '')
          })
          .map((log: any) => ({
            ...log,
            latitude: getLogLatitude(log),
            longitude: getLogLongitude(log),
          }))
          .sort((a: any, b: any) => getLogRecordedAt(a) - getLogRecordedAt(b))

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
        const driverLat = Number(latestLog?.latitude ?? latestLocation?.latitude ?? latestLocation?.lat)
        const driverLng = Number(latestLog?.longitude ?? latestLocation?.longitude ?? latestLocation?.lng)
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

        const driverLocationMarker = hasDriverPosition
          ? {
              id: `driver-${trip.id}`,
              driverName,
              vehiclePlate,
              lat: driverLat,
              lng: driverLng,
              status: String(trip?.status || 'IN_PROGRESS'),
              markerColor: '#1d4ed8',
              markerLabel: ['IN_PROGRESS'].includes(normalizedTripStatus) ? 'Driver current location' : 'Driver last known location',
              markerType: 'truck' as const,
              markerHeading: markerHeading ?? undefined,
            }
          : null

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

        if (driverLocationMarker) {
          // Push driver marker last so it stays visually on top of stop pins.
          locations.push(driverLocationMarker)
        }

        if (logs.length > 0) {
          const passedPathPoints: [number, number][] = [
            ...(warehouseStart ? [warehouseStart] : []),
            ...logs.map((log: any) => [Number(log.latitude), Number(log.longitude)] as [number, number]),
          ].filter((point, index, list) => {
            if (index === 0) return true
            const previous = list[index - 1]
            return !(Math.abs(point[0] - previous[0]) < 0.000001 && Math.abs(point[1] - previous[1]) < 0.000001)
          })

          if (passedPathPoints.length > 1) {
          routeLines.push({
            id: `passed-${trip.id}`,
            points: passedPathPoints,
            color: '#6b7280',
            label: `${trip.tripNumber || 'Trip'} - Path taken`,
            opacity: 0.95,
            weight: 7,
            dashArray: '8 8',
            snapToRoad: true,
          })
          }
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
        markerColor: String(order?.status || '').toUpperCase() === 'CANCELLED' ? '#ef4444' : (completed ? '#2563eb' : '#16a34a'),
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
        (trip) => ['IN_PROGRESS'].includes(normalizeTripStatus(trip.status))
      ),
    [scopedTrips]
  )

  const liveTrackingRecentLocations = useMemo(
    () =>
      scopedTrips
        .filter((trip: any) => tripMatchesTrackingDay(trip))
        .flatMap((trip: any) => (Array.isArray(trip?.locationLogs) ? trip.locationLogs : []))
        .filter((log: any) => Number.isFinite(Number(log?.latitude)) && Number.isFinite(Number(log?.longitude)))
        .map((log: any) => ({
          ...log,
          latitude: Number(log.latitude),
          longitude: Number(log.longitude),
        }))
        .sort((a: any, b: any) => new Date(b.recordedAt || 0).getTime() - new Date(a.recordedAt || 0).getTime())
        .slice(0, 5),
    [scopedTrips, trackingDate]
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

  const availableExistingProducts = useMemo(() => {
    const targetWarehouseId = String(stockInWarehouseId || '').trim()
    if (!targetWarehouseId) return []

    const inventoryForWarehouse = inventory.filter((item) => String(item?.warehouse?.id || '') === targetWarehouseId)
    const seen = new Set<string>()
    const fromInventory: ProductOption[] = []

    for (const item of inventoryForWarehouse) {
      const productId = String(item?.product?.id || '').trim()
      if (!productId || seen.has(productId)) continue
      seen.add(productId)
      const threshold = getItemThreshold(item)
      const qty = Number((item as any)?.quantity ?? 0) || 0
      const reserved = Number((item as any)?.reservedQuantity ?? (item as any)?.reserved_quantity ?? 0) || 0
      const available = Math.max(0, qty - reserved)
      const lastRestockedRaw = (item as any)?.lastRestockedAt ?? (item as any)?.last_restocked_at ?? (item as any)?.updatedAt ?? (item as any)?.updated_at
      const lastRestockedAt = lastRestockedRaw ? new Date(lastRestockedRaw) : null
      const daysSinceRestock = lastRestockedAt && !Number.isNaN(lastRestockedAt.getTime())
        ? Math.max(0, Math.floor((Date.now() - lastRestockedAt.getTime()) / (24 * 60 * 60 * 1000)))
        : 0
      const isOverstocked = isOverstockedInventoryItem(item)
      const inventoryStatus = getInventoryAlertLevel(item)
      fromInventory.push({
        id: productId,
        sku: String(item?.product?.sku || '').trim(),
        name: String(item?.product?.name || '').trim(),
        price: Number(item?.product?.price || 0),
        unit: String(item?.product?.unit || 'case').trim(),
        sizes: Array.isArray(item?.product?.sizes) ? item.product.sizes : [],
        category: String((item?.product as any)?.category?.name || (item?.product as any)?.category || '').trim(),
        inventoryStatus,
        isOverstocked,
        overstockInfo: isOverstocked
          ? {
              available,
              threshold,
              daysSinceRestock,
            }
          : null,
      })
    }

    const withFallbackNames = fromInventory.map((entry) => {
      const fallback = products.find((p) => p.id === entry.id)
      return {
        ...entry,
        sku: entry.sku || String(fallback?.sku || '').trim(),
        name: entry.name || String(fallback?.name || '').trim(),
        price: Number(entry.price || fallback?.price || 0),
        unit: entry.unit || String(fallback?.unit || 'case').trim(),
        sizes: (entry.sizes && entry.sizes.length > 0) ? entry.sizes : (Array.isArray(fallback?.sizes) ? fallback.sizes : []),
        category: entry.category || String((fallback as any)?.category?.name || (fallback as any)?.category || '').trim(),
      }
    })

    return withFallbackNames
      .filter((entry) => entry.id && entry.name)
      .sort((a, b) => `${a.sku} ${a.name}`.localeCompare(`${b.sku} ${b.name}`))
  }, [inventory, products, stockInWarehouseId])

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
  }, [activeTripCount, assignedWarehouse, scopedInventory, scopedInventoryTransactions, scopedOrders, scopedReplacements, stockBatches, stockHealthSummary])

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

  const safeFetchJson = async (
    input: RequestInfo | URL,
    init?: RequestInit,
    options?: { retries?: number; timeoutMs?: number }
  ) => {
    const retries = options?.retries ?? 5
    const timeoutMs = options?.timeoutMs ?? 12000
    let lastError = 'Request failed'
    let lastStatus = 0

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
        lastStatus = response.status
        const data = await response.json().catch(() => ({}))
        const dbUnavailable = Boolean(data?.dbUnavailable)
        if (response.ok && data?.success !== false && !dbUnavailable) {
          return { ok: true as const, data, status: response.status }
        }
        lastError = data?.error || `Request failed (${response.status})`
        const nonRetriable =
          response.status === 400 ||
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404 ||
          response.status === 405 ||
          response.status === 409 ||
          response.status === 410 ||
          response.status === 422
        if (nonRetriable) {
          return { ok: false as const, data, status: response.status, error: lastError }
        }
      } catch (error: any) {
        lastError = error?.name === 'AbortError' ? 'Request timed out' : error?.message || 'Request failed'
      } finally {
        window.clearTimeout(timeout)
      }

      if (attempt < retries) {
        await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)))
      }
    }

    return { ok: false as const, data: null, status: lastStatus, error: lastError }
  }

  const fetchInventoryData = async (warehouseId?: string) => {
    setLoadingInventory(true)
    try {
      const normalizedWarehouseId = String(warehouseId || '').trim()
      const query = new URLSearchParams({ pageSize: '1000' })
      if (normalizedWarehouseId) {
        query.set('warehouseId', normalizedWarehouseId)
      }
      const inventoryUrl = `/api/inventory?${query.toString()}`
      const result = await safeFetchJson(inventoryUrl, { cache: 'no-store' })
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

  const fetchWarehousesData = async (): Promise<WarehouseItem[]> => {
    setLoadingWarehouses(true)
    try {
      const result = await safeFetchJson('/api/warehouses', { cache: 'no-store' })
      if (!result.ok) {
        setWarehouseLoadError(result.error || 'Failed to fetch warehouses')
        return []
      }
      if ((result.data as any)?.dbUnavailable) {
        setWarehouseLoadError('Warehouse data is temporarily unavailable')
        return []
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
      return list
    } catch (error) {
      setWarehouseLoadError('Failed to fetch warehouses')
      console.warn('Failed to load warehouses:', error)
      return []
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
    const result = await safeFetchJson('/api/orders?limit=1&pageSize=1&includeItems=none&includeFulfillments=true&includeWarehouseAllocations=true&sort=updated_at', { cache: 'no-store', credentials: 'include' })
    if (!result.ok) {
      throw new Error(result.error || 'Failed orders fetch')
    }
    const topOrder = getCollection<WarehouseOrderItem>(result.data, ['orders'])[0]
    return `${Number((result.data as any)?.total || 0)}::${topOrder?.updatedAt || topOrder?.createdAt || ''}`
  }

  const getMaxOrderUpdatedAt = (rows: WarehouseOrderItem[]) =>
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

  const mergeWarehouseOrders = (current: WarehouseOrderItem[], incoming: WarehouseOrderItem[]) => {
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

  const fetchAllWarehouseOrders = async (options?: { summaryOnly?: boolean; lightweightDetails?: boolean }) => {
    const pageSize = 200
    const maxPages = 100
    const summaryOnly = options?.summaryOnly ?? false
    const lightweightDetails = options?.lightweightDetails ?? false
    const fetchPage = (page: number) =>
      safeFetchJson(
        summaryOnly
          ? `/api/orders?page=${page}&pageSize=${pageSize}&includeItems=none&summaryOnly=true`
          : lightweightDetails
            ? `/api/orders?page=${page}&pageSize=${pageSize}&includeItems=full&includeFulfillments=false&includeWarehouseAllocations=false`
          : `/api/orders?page=${page}&pageSize=${pageSize}&includeItems=full&includeFulfillments=true&includeWarehouseAllocations=true`,
        { cache: 'no-store', credentials: 'include' },
        // The initial loader must remain visible until the real warehouse totals arrive.
        summaryOnly
          ? { retries: 1, timeoutMs: 90000 }
          : lightweightDetails
            ? { retries: 1, timeoutMs: 30000 }
            : undefined
      )

    let first = await fetchPage(1)
    if (first.status === 401 || first.status === 403) {
      clearTabAuthToken()
      first = await fetchPage(1)
    }
    if (!first.ok) {
      throw new Error(first.error || 'Failed orders fetch')
    }

    const merged = getCollection<WarehouseOrderItem>(first.data, ['orders'])
    const totalPages = Math.min(Math.max(1, Number((first.data as any)?.totalPages || 1)), maxPages)

    for (let page = 2; page <= totalPages; page += 1) {
      const next = await fetchPage(page)
      if (!next.ok) {
        throw new Error(next.error || `Failed orders fetch (page ${page})`)
      }
      merged.push(...getCollection<WarehouseOrderItem>(next.data, ['orders']))
    }

    return {
      data: {
        ...(first.data as any),
        orders: merged,
        totalPages,
      },
    }
  }

  const fetchOrdersData = async (options?: { showLoading?: boolean; onlyIfNew?: boolean; silent?: boolean; summaryOnly?: boolean; lightweightDetails?: boolean }) => {
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
        if (latestOrderUpdatedAtRef.current) {
          const deltaParams = new URLSearchParams({
            includeItems: 'full',
            includeFulfillments: 'true',
            includeWarehouseAllocations: 'true',
            sort: 'updated_at',
            page: '1',
            pageSize: '200',
            updatedAfter: latestOrderUpdatedAtRef.current,
          })
          const deltaResult = await safeFetchJson(`/api/orders?${deltaParams.toString()}`, { cache: 'no-store', credentials: 'include' })
          if (deltaResult.ok) {
            const deltaOrders = getCollection<WarehouseOrderItem>(deltaResult.data, ['orders'])
            if (deltaOrders.length > 0) {
              setOrders((prev) => {
                const merged = mergeWarehouseOrders(prev, deltaOrders)
                latestOrderUpdatedAtRef.current = getMaxOrderUpdatedAt(merged)
                return merged
              })
            }
            latestOrderMarkerRef.current = incomingMarker
            return
          }
        }
      }

      const result = await fetchAllWarehouseOrders({
        summaryOnly: options?.summaryOnly,
        lightweightDetails: options?.lightweightDetails,
      })

      // Normalize overlapping paginated results so each order appears only once in PR and PO views.
      const list = mergeWarehouseOrders([], getCollection<WarehouseOrderItem>(result.data, ['orders']))
      setOrders(list)
      if (!options?.summaryOnly) orderDetailsLoadedRef.current = true
      latestOrderUpdatedAtRef.current = getMaxOrderUpdatedAt(list)
      latestOrderMarkerRef.current = `${Number((result.data as any)?.total || 0)}::${latestOrderUpdatedAtRef.current || ''}`
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
      const pageSize = 100
      let page = 1
      let totalPages = 1
      const mergedTrips: WarehouseTripItem[] = []

      while (page <= totalPages) {
        const query = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
          includeTracking: '1',
        })
        const result = await safeFetchJson(`/api/trips?${query.toString()}`, { cache: 'no-store' })
        if (!result.ok) {
          return
        }
        mergedTrips.push(...getCollection<WarehouseTripItem>(result.data, ['trips']))
        const payload = (result.data || {}) as Record<string, any>
        totalPages = Math.max(1, Number(payload.totalPages || 1))
        page += 1
      }

      setTrips(mergedTrips)
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
      const preferredDriver = list.find((driver) => isDriverSelectableForTrip(driver))

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
    setSavedRoutes([])
  }

  useEffect(() => {
    if (!selectedRouteDriverId) return
    const selectedDriver = drivers.find((driver) => String(driver?.id || '') === String(selectedRouteDriverId))
    if (!selectedDriver) return
    const allowDriverId = editingTripState?.originalDriverId || ''
    const allowVehicleId = editingTripState?.originalVehicleId || ''
    if (!isDriverSelectableForTrip(selectedDriver, { allowDriverId, allowVehicleId })) {
      setSelectedRouteDriverId(allowDriverId && drivers.some((driver) => String(driver?.id || '') === String(allowDriverId)) ? allowDriverId : '')
    }
  }, [drivers, selectedRouteDriverId, availableVehicleIdSet, editingTripState])

  useEffect(() => {
    if (selectedRouteDriverId || drivers.length === 0 || editingTripState) return
    const preferredDriver = drivers.find((driver) => isDriverSelectableForTrip(driver))
    if (preferredDriver?.id) {
      setSelectedRouteDriverId(preferredDriver.id)
    }
  }, [drivers, selectedRouteDriverId, availableVehicleIdSet, editingTripState])

  const getEditingTripSnapshot = (tripId?: string | null) => {
    const normalizedTripId = String(tripId || editingTripState?.tripId || '').trim()
    if (!normalizedTripId) return null
    return trips.find((trip) => String(trip?.id || '').trim() === normalizedTripId) || null
  }

  const buildTripEditorOrder = (point: any) => {
    const order = point?.order || {}
    const items = Array.isArray(order?.items) ? order.items : []
    const productSummary = items
      .map((item: any) => String(item?.product?.name || item?.productName || item?.name || '').trim())
      .filter(Boolean)
      .join(', ')

    return {
      id: String(point?.orderId || order?.id || '').trim(),
      orderNumber: String(point?.orderNumber || order?.orderNumber || '').trim() || 'Order',
      city: String(order?.shippingCity || point?.city || '').trim() || 'Unassigned City',
      customerName: String(order?.shippingName || order?.customer?.name || point?.locationName || '').trim() || 'Customer',
      address: String(order?.shippingAddress || point?.address || '').trim(),
      products: productSummary || undefined,
      latitude: point?.latitude ?? order?.shippingLatitude ?? null,
      longitude: point?.longitude ?? order?.shippingLongitude ?? null,
      sequence: Number(point?.sequence || 0),
      distanceKm: null,
      status: String(point?.orderStatus || order?.status || point?.status || 'PENDING').trim() || 'PENDING',
      currentTripOrder: true,
    }
  }

  const mergeRoutePlansWithTripOrders = (
    inputPlans: RoutePlanCityGroup[],
    tripIdOverride?: string | null
  ): RoutePlanCityGroup[] => {
    const editingTrip = getEditingTripSnapshot(tripIdOverride)
    if (!editingTrip) return inputPlans

    const groupedPlans = new Map<string, RoutePlanCityGroup>()
    inputPlans.forEach((group) => {
      groupedPlans.set(group.city, {
        ...group,
        orders: Array.isArray(group.orders) ? [...group.orders] : [],
      })
    })

    ;(Array.isArray(editingTrip?.dropPoints) ? editingTrip.dropPoints : []).forEach((point: any) => {
      const tripOrder = buildTripEditorOrder(point)
      if (!tripOrder.id) return

      const cityKey = String(tripOrder.city || 'Unassigned City').trim() || 'Unassigned City'
      const existingGroup = groupedPlans.get(cityKey) || {
        city: cityKey,
        orderCount: 0,
        totalDistanceKm: 0,
        orders: [],
      }
      const existingOrderIndex = existingGroup.orders.findIndex((order) => String(order?.id || '').trim() === tripOrder.id)
      if (existingOrderIndex >= 0) {
        const existingOrder = existingGroup.orders[existingOrderIndex] as any
        existingGroup.orders[existingOrderIndex] = {
          ...existingOrder,
          ...tripOrder,
          currentTripOrder: true,
          sequence: Number(point?.sequence || tripOrder.sequence || existingOrder?.sequence || 0),
        } as RoutePlanOrderItem
      } else {
        existingGroup.orders = [...existingGroup.orders, tripOrder as RoutePlanOrderItem]
      }

      existingGroup.orders.sort((left: any, right: any) => Number(left?.sequence || 0) - Number(right?.sequence || 0))
      existingGroup.orderCount = existingGroup.orders.length
      groupedPlans.set(cityKey, existingGroup)
    })

    return Array.from(groupedPlans.values()).sort((left, right) => left.city.localeCompare(right.city))
  }

  const createRoutePlan = async (silent = false, inputDate?: string, inputWarehouseId?: string) => {
    const effectiveDate = inputDate ?? routeDate
    const effectiveWarehouseId = inputWarehouseId ?? routeWarehouseId
    const preservedTripOrderIds = editingTripState
      ? Array.from(new Set(
          (selectedRouteOrderIds.length > 0 ? selectedRouteOrderIds : editingTripState.originalOrderIds).filter(Boolean)
        ))
      : []
    if (!effectiveDate || !effectiveWarehouseId) {
      if (!silent) toast.error('Select route date and warehouse')
      setRoutePlanMessage({ type: 'error', text: 'Select route date and warehouse first.' })
      return null
    }
    if (isBeforeTodayDayKey(effectiveDate)) {
      const message = 'Delivery date cannot be before today'
      if (!silent) toast.error(message)
      setRoutePlanMessage({ type: 'error', text: message })
      return null
    }
    setLoadingRoutePlans(true)
    setRoutePlanMessage(null)
    setRoutePlans([])
    setSelectedRouteCity('')
    setSelectedRouteOrderIds(editingTripState ? preservedTripOrderIds : [])
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

      const rawPlans = getCollection<RoutePlanCityGroup>(data, ['routePlans'])
      const eligiblePlans = rawPlans
        .map((group: any) => ({
          ...group,
          orders: (Array.isArray(group?.orders) ? group.orders : []).filter(
            (order: any) =>
              Number(order?.allocatedQtyForSelectedWarehouse || 0) > 0 ||
              Boolean((order as any)?.isScheduledReplacement) ||
              String(order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-')
          ),
        }))
        .filter((group: any) => (Array.isArray(group?.orders) ? group.orders.length : 0) > 0)
      const plans = mergeRoutePlansWithTripOrders(eligiblePlans)
      setRoutePlans(plans)
      setSelectedRouteCity((current) => {
        if (current && plans.some((group) => group.city === current)) return current
        const matchingGroup = plans.find((group) =>
          group.orders.some((order: any) => preservedTripOrderIds.includes(String(order?.id || '').trim()))
        )
        return matchingGroup?.city || plans[0]?.city || ''
      })
      setSelectedRouteOrderIds(editingTripState ? preservedTripOrderIds : [])
      if (eligiblePlans.length === 0 && !editingTripState) {
        setRoutePlanMessage({
          type: 'info',
          text: 'No eligible orders found for that delivery date.',
        })
      } else {
        const baseMessage =
          eligiblePlans.length === 0 && editingTripState
            ? 'Loaded the current trip contents. No additional eligible orders were found for this delivery date.'
            : `Found ${plans.length} city group(s) for this delivery date.`
        setRoutePlanMessage({ type: 'success', text: baseMessage })
        if (!silent) toast.success('Filtered scheduled orders by city')
      }
      return plans
    } catch (error: any) {
      const message =
        error?.name === 'AbortError' ? 'Request timed out. Please try again.' : error?.message || 'Failed to generate route plan'
      if (!silent) toast.error(message)
      setRoutePlanMessage({ type: 'error', text: message })
      setRoutePlans([])
      setSelectedRouteCity('')
      setSelectedRouteOrderIds(editingTripState ? preservedTripOrderIds : [])
      return null
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
        if (editingTripState && prev.length === 1) {
          toast.error('A trip must keep at least one drop point')
          return prev
        }
        return next.length > 0 ? next : [orderId]
      }
      return [...prev, orderId]
    })
  }

  const getOrderBarangayLabel = (address?: string | null, city?: string | null) => {
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

  const editTripDropPoints = async (
    trip: WarehouseTripItem,
    changes: { addOrderIds?: string[]; removeDropPointIds?: string[]; assignWarehouseLegs?: boolean; assignWarehouseId?: string; driverId?: string; vehicleId?: string }
  ) => {
    const addOrderIds = (changes.addOrderIds || []).filter(Boolean)
    const removeDropPointIds = (changes.removeDropPointIds || []).filter(Boolean)
    const assignWarehouseLegs = Boolean(changes.assignWarehouseLegs)
    const assignWarehouseId = String(changes.assignWarehouseId || '').trim()
    const driverId = String(changes.driverId || '').trim()
    const vehicleId = String(changes.vehicleId || '').trim()
    if (addOrderIds.length === 0 && removeDropPointIds.length === 0 && !assignWarehouseLegs && !driverId && !vehicleId) return false
    if (String(trip.status || '').toUpperCase() !== 'PLANNED') {
      toast.error('Only planned trips can be edited')
      return false
    }

    setEditingTripId(trip.id)
    try {
      // Only send assignment fields for an intentional driver change; empty keys trigger backend validation.
      const payload: Record<string, unknown> = {
        addOrderIds,
        removeDropPointIds,
        assignWarehouseLegs,
        assignWarehouseId,
      }
      if (driverId && vehicleId) {
        payload.driverId = driverId
        payload.vehicleId = vehicleId
      }
      const response = await fetch(`/api/trips/${trip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to update trip')
      }
      const updatedTrip = data?.trip
      if (updatedTrip?.id) {
        setTrips((prev) => prev.map((entry) => (entry.id === updatedTrip.id ? updatedTrip : entry)))
        setSelectedTrip((current) => (current?.id === updatedTrip.id ? updatedTrip : current))
      }
      await fetchOrdersData({ showLoading: false, silent: true })
      emitDataSync(['trips', 'orders'])
      toast.success('Trip updated')
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update trip')
      return false
    } finally {
      setEditingTripId(null)
    }
  }

  const parseApiErrorMessage = (response: Response, payload: any, fallback: string) => {
    const fromPayload =
      String(payload?.error || '').trim() ||
      String(payload?.message || '').trim() ||
      String(payload?.detail || '').trim()
    if (fromPayload) return fromPayload
    return `${fallback} (HTTP ${response.status})`
  }

  const createTripFromRoute = async () => {
    if (!selectedSavedRoute || !selectedRouteDriverId) {
      toast.error('Select a saved route and driver first')
      return
    }
    if (selectedDriverEligibilityIssue) {
      toast.error(`Selected driver cannot be assigned: ${selectedDriverEligibilityIssue}`)
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
    if (isBeforeTodayDayKey(selectedSavedRoute.date)) {
      toast.error('Delivery date cannot be before today')
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
      const raw = await response.text()
      const data = (() => {
        try {
          return raw ? JSON.parse(raw) : {}
        } catch {
          return {}
        }
      })()
      if (!response.ok || data?.success === false) {
        throw new Error(parseApiErrorMessage(response, data, 'Failed to create trip'))
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

  const createTripFromCurrentRoutePlan = async () => {
    if (!routeDate || !routeWarehouseId || !selectedRouteCity || selectedRouteOrderIds.length === 0) {
      toast.error('Select date, warehouse, city and at least one order')
      return
    }
    if (!selectedRouteDriverId) {
      toast.error('Select a driver')
      return
    }
    if (selectedDriverEligibilityIssue) {
      toast.error(`Selected driver cannot be assigned: ${selectedDriverEligibilityIssue}`)
      return
    }
    if (!selectedDriverAssignedVehicle?.id) {
      toast.error('Selected driver has no assigned vehicle')
      return
    }
    if (isBeforeTodayDayKey(routeDate)) {
      toast.error('Delivery date cannot be before today')
      return
    }

    const group = routePlans.find((g) => g.city === selectedRouteCity)
    const selectedOrders = (group?.orders || []).filter((order) => selectedRouteOrderIds.includes(order.id))
    if (!group || selectedOrders.length === 0) {
      toast.error('No orders selected for this route')
      return
    }

    setCreatingTripFromRoute(true)
    try {
      const response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plannedStartAt: routeDate,
          status: 'PLANNED',
          warehouseId: routeWarehouseId,
          driverId: selectedRouteDriverId,
          vehicleId: selectedDriverAssignedVehicle.id,
          orderIds: selectedRouteOrderIds,
        }),
      })
      const raw = await response.text()
      const data = (() => {
        try {
          return raw ? JSON.parse(raw) : {}
        } catch {
          return {}
        }
      })()
      if (!response.ok || data?.success === false) {
        throw new Error(parseApiErrorMessage(response, data, 'Failed to create trip'))
      }

      const createdTrip = data?.trip
      if (createdTrip) {
        setTrips((prev) => [createdTrip, ...prev.filter((trip) => trip.id !== createdTrip.id)])
      }

      setCreateRouteOpen(false)
      setSelectedRouteCity('')
      setSelectedRouteOrderIds([])
      setRoutePlans([])
      emitDataSync(['trips', 'orders'])
      void Promise.all([
        fetchTripsData({ showLoading: false }),
        fetchOrdersData({ showLoading: false, silent: true }),
      ])
      toast.success('Trip created and assigned successfully')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create trip')
    } finally {
      setCreatingTripFromRoute(false)
    }
  }

  const saveTripEditsFromCurrentRoutePlan = async () => {
    if (!editingTripState) return

    const editingTrip = getEditingTripSnapshot(editingTripState.tripId)
    if (!editingTrip) {
      toast.error('Trip not found')
      return
    }
    if (String(editingTrip.status || '').toUpperCase() !== 'PLANNED') {
      toast.error('Only planned trips can be edited')
      return
    }

    const desiredOrderIds = Array.from(
      new Set(selectedRouteOrderIds.map((orderId) => String(orderId || '').trim()).filter(Boolean))
    )
    const effectiveSelectedDriverId = String(selectedRouteDriverId || editingTripState.originalDriverId || '').trim()
    const originalOrderIdSet = new Set(
      editingTripState.originalOrderIds.map((orderId) => String(orderId || '').trim()).filter(Boolean)
    )
    const desiredOrderIdSet = new Set(desiredOrderIds)
    const addOrderIds = desiredOrderIds.filter((orderId) => !originalOrderIdSet.has(orderId))
    const removeDropPointIds = (Array.isArray(editingTrip.dropPoints) ? editingTrip.dropPoints : [])
      .filter((point: any) => {
        const orderId = String(point?.orderId || point?.order?.id || '').trim()
        return orderId && !desiredOrderIdSet.has(orderId)
      })
      .map((point: any) => String(point?.id || '').trim())
      .filter(Boolean)
    const driverChanged = Boolean(
      effectiveSelectedDriverId &&
      effectiveSelectedDriverId !== String(editingTripState.originalDriverId || '').trim()
    )

    if (!effectiveSelectedDriverId) {
      toast.error('Select a driver')
      return
    }
    if (selectedDriverEligibilityIssue && driverChanged) {
      toast.error(`Selected driver cannot be assigned: ${selectedDriverEligibilityIssue}`)
      return
    }
    if (driverChanged && !selectedDriverAssignedVehicle?.id) {
      toast.error('Selected driver has no assigned vehicle')
      return
    }

    if (addOrderIds.length === 0 && removeDropPointIds.length === 0 && !driverChanged) {
      setCreateRouteOpen(false)
      setEditingTripState(null)
      toast.success('Trip already matches the selected settings')
      return
    }

    const updated = await editTripDropPoints(editingTrip, {
      addOrderIds,
      removeDropPointIds,
      driverId: driverChanged ? effectiveSelectedDriverId : undefined,
      vehicleId: driverChanged ? String(selectedDriverAssignedVehicle?.id || '').trim() : undefined,
    })
    if (!updated) return
    setCreateRouteOpen(false)
    setEditingTripState(null)
  }

  useEffect(() => {
    const refreshAllData = async (options?: { initial?: boolean }) => {
      if (isRefreshingAllRef.current) return
      isRefreshingAllRef.current = true
      const initial = options?.initial ?? false
      try {
        const warehouseList = await fetchWarehousesData()
        const effectiveWarehouseId = warehouseList[0]?.id
        await fetchInventoryData(effectiveWarehouseId)
        await fetchProductsData()
        await fetchStockBatchesData()
        await fetchInventoryTransactionsData()
        await (initial
          // Load complete table fields once at startup without expensive allocation maps.
          ? fetchOrdersData({ showLoading: true, lightweightDetails: true })
          : fetchOrdersData({ showLoading: false, silent: true }))
        await fetchTripsData()
        await fetchReplacementsData()
        await fetchDriversData()
        await fetchVehiclesData()
        await fetchSavedRoutesData()
      } finally {
        isRefreshingAllRef.current = false
        // Initial portal content is safe to display only after every startup request settles.
        if (initial) setIsInitialPortalLoading(false)
      }
    }

    void refreshAllData({ initial: true })

    const unsubscribe = subscribeDataSync((message) => {
      if (isRefreshingAllRef.current) return
      const scopes = message.scopes
      if (scopes.some((scope) => ['inventory', 'products', 'stock-batches', 'inventory-transactions', 'warehouses'].includes(scope))) {
        void (async () => {
          const warehouseList = await fetchWarehousesData()
          const effectiveWarehouseId = warehouseList[0]?.id
          await fetchInventoryData(effectiveWarehouseId)
          await fetchProductsData()
          await fetchStockBatchesData()
          await fetchInventoryTransactionsData()
        })()
      }
      if (scopes.includes('orders')) {
        void fetchOrdersData({ showLoading: false, silent: true })
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

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (activeView === 'orders' || activeView === 'purchaseRequests') {
      // Retry complete table details only if the startup request did not finish.
      if (!orderDetailsLoadedRef.current) {
        void fetchOrdersData({ showLoading: true, lightweightDetails: true })
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
      void fetchTripsData()
    }
  }, [activeView, trackingDate])

  useEffect(() => {
    if (activeView !== 'orders' && activeView !== 'purchaseRequests') return

    const refreshChangedOrderStatuses = async () => {
      if (document.visibilityState !== 'visible' || isPollingOrderStatusesRef.current) return
      isPollingOrderStatusesRef.current = true
      try {
        // Use the order marker/delta path so PO statuses synchronize without reloading the screen.
        await fetchOrdersData({ showLoading: false, onlyIfNew: true, silent: true, lightweightDetails: true })
      } finally {
        isPollingOrderStatusesRef.current = false
      }
    }

    void refreshChangedOrderStatuses()
    const orderStatusPollInterval = window.setInterval(() => {
      void refreshChangedOrderStatuses()
    }, 4000)

    return () => {
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
      if (!response.ok || payload?.success === false || !payload?.order) return
      setSelectedOrder(payload.order as WarehouseOrderItem)
    } catch (error) {
      console.error('Failed to load order details:', error)
    } finally {
      setLoadingOrderDetail(false)
    }
  }

  const getAvailableQty = (item: InventoryItem) => getInventoryAvailableQty(item)

  const getStockStatus = (item: InventoryItem) => {
    const level = getInventoryAlertLevel(item)
    if (level === 'overstocked') return 'overstocked'
    return level === 'healthy' ? 'healthy' : 'restock'
  }

  const openEditDialog = (item: InventoryItem) => {
    setEditingItem(item)
    setDeleteEditOpen(false)
    setEditName(item.product?.name || '')
    setEditImageUrl(item.product?.imageUrl || '')
    setEditImageFile(null)
  }

  const openBatchQuantityDialog = (batch: StockBatchItem) => {
    setEditingBatch(batch)
    setEditBatchQuantity(String(Math.max(0, Number(batch.quantity || 0))))
    // Added: populate the batch dates so warehouse staff can update them with the quantity.
    setEditBatchManufacturedDate(batch.receiptDate ? new Date(batch.receiptDate).toISOString().slice(0, 10) : '')
    setEditBatchExpiryDate(batch.expiryDate ? new Date(batch.expiryDate).toISOString().slice(0, 10) : '')
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

    if (!editName.trim()) {
      toast.error('Product name is required')
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
          imageUrl: uploadedImageUrl,
        }),
      })
      const productPayload = await productResponse.json().catch(() => ({}))
      if (!productResponse.ok || productPayload?.success === false) {
        throw new Error(productPayload?.error || 'Failed to update product')
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

  const saveStockBatchChanges = async () => {
    if (!editingBatch?.id) return
    const nextQuantity = Number(editBatchQuantity)
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
      toast.error('Quantity must be a non-negative number')
      return
    }
    if (!editBatchManufacturedDate) {
      toast.error('Manufactured date is required')
      return
    }

    setIsSavingBatchQty(true)
    try {
      const response = await fetch('/api/stock-batches', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Added: save the batch dates in the same update as its quantity.
        body: JSON.stringify({
          batchId: editingBatch.id,
          quantity: Math.floor(nextQuantity),
          manufacturedDate: editBatchManufacturedDate,
          expiryDate: editBatchExpiryDate || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update stock batch')
      }

      setEditingBatch(null)
      toast.success('Stock batch updated')
      await fetchInventoryData()
      await fetchStockBatchesData()
      await fetchInventoryTransactionsData()
      emitDataSync(['inventory', 'stock-batches', 'inventory-transactions'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update stock batch')
    } finally {
      setIsSavingBatchQty(false)
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
    setStockRows([
      { id: `row-${Date.now()}-0`, productId: '', quantity: '', manufacturedDate: '', expiryDate: '', validationErrors: {} }
    ])
    if (!isWarehouseScopedUser || !assignedWarehouse?.id) {
      setStockInWarehouseId('')
    }
  }

  // Row management functions
  const addStockRow = () => {
    const newRow: StockRow = {
      id: `row-${Date.now()}-${Math.random()}`,
      productId: '',
      quantity: '',
      manufacturedDate: '',
      expiryDate: '',
      validationErrors: {}
    }
    setStockRows([...stockRows, newRow])
  }

  const removeStockRow = (rowId: string) => {
    if (stockRows.length > 1) {
      setStockRows(stockRows.filter(r => r.id !== rowId))
    }
  }

  const updateStockRow = (rowId: string, field: keyof Omit<StockRow, 'id' | 'validationErrors'>, value: string) => {
    setStockRows((prevRows) => prevRows.map((row) => {
      if (row.id === rowId) {
        const updatedRow = { ...row, [field]: value, validationErrors: {} }
        return updatedRow
      }
      return row
    }))
  }

  const validateStockRow = (row: StockRow) => {
    const errors: StockRow['validationErrors'] = {}
    if (!row.productId.trim()) errors.productId = 'Product is required'
    const selectedProduct = availableExistingProducts.find((p) => p.id === row.productId.trim())
    if (selectedProduct?.isOverstocked) {
      const info = selectedProduct.overstockInfo
      if (info) {
        errors.productId = `Overstocked: available ${info.available}, threshold ${info.threshold}, ${info.daysSinceRestock} days since restock`
      } else {
        errors.productId = 'Product is overstocked and cannot be restocked right now'
      }
    }
    if (!row.quantity.trim()) errors.quantity = 'Quantity is required'
    else if (isNaN(Number(row.quantity)) || Number(row.quantity) <= 0) errors.quantity = 'Quantity must be > 0'
    if (!row.expiryDate.trim()) errors.expiryDate = 'Expiry date is required'
    return errors
  }

  const validateAllStockRows = () => {
    let hasErrors = false
    const selectedCounts = stockRows.reduce<Record<string, number>>((acc, row) => {
      const key = row.productId.trim()
      if (!key) return acc
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    const updatedRows = stockRows.map(row => {
      const errors = validateStockRow(row)
      const key = row.productId.trim()
      if (key && (selectedCounts[key] || 0) > 1) {
        errors.productId = 'Product already selected in another row'
      }
      if (Object.keys(errors).length > 0) hasErrors = true
      return { ...row, validationErrors: errors }
    })
    setStockRows(updatedRows)
    return !hasErrors
  }

  // CSV parsing function
  const parseCSVData = (csvText: string): StockRow[] => {
    const lines = csvText.trim().split('\n').filter(line => line.trim())
    const newRows: StockRow[] = []

    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim())
      if (parts.length < 2) continue

      const productIdentifier = parts[0]
      const quantity = parts[1]
      const manufacturedDate = parts[2] || ''
      const expiryDate = parts[3] || ''

      // Find product by SKU or name
      const matchedProduct = availableExistingProducts.find(
        p => p.sku === productIdentifier || p.name === productIdentifier || p.id === productIdentifier
      )

      if (matchedProduct && quantity) {
        newRows.push({
          id: `row-${Date.now()}-${Math.random()}`,
          productId: matchedProduct.id,
          quantity: quantity,
          manufacturedDate: manufacturedDate,
          expiryDate: expiryDate,
          validationErrors: {}
        })
      }
    }

    return newRows
  }

  // Keyboard navigation
  const handleStockModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isSubmittingStockIn) {
      setAddStockOpen(false)
    }

    // Handle Ctrl+V / Cmd+V for CSV paste
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && e.target instanceof HTMLDivElement) {
      e.preventDefault()
      navigator.clipboard.readText().then(text => {
        const parsedRows = parseCSVData(text)
        if (parsedRows.length > 0) {
          setStockRows(parsedRows)
          toast.success(`${parsedRows.length} rows imported from clipboard`)
        }
      }).catch(() => {
        toast.error('Failed to read clipboard')
      })
    }
  }



  const openAddStockDialog = () => {
    if (isWarehouseScopedUser && assignedWarehouse?.id) {
      setStockInWarehouseId(assignedWarehouse.id)
    } else if (!stockInWarehouseId && warehouses[0]?.id) {
      setStockInWarehouseId(warehouses[0].id)
    }
    setAddStockOpen(true)
  }

  const addStockInBatch = async () => {
    if (!stockInWarehouseId) {
      toast.error('Please select a warehouse')
      return
    }

    // Validate all rows before submitting
    if (!validateAllStockRows()) return

    // Prepare batches
    const batches = stockRows.map(row => ({
      productId: row.productId,
      quantity: Number(row.quantity),
      manufacturedDate: row.manufacturedDate || null,
      expiryDate: row.expiryDate || null
    }))

    setIsSubmittingStockIn(true)
    try {
      const response = await fetch('/api/stock-batches/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: stockInWarehouseId,
          batches: batches
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to add stock')
      }

      const created = payload?.created || 0
      const failed = payload?.failed || 0

      if (created > 0) {
        toast.success(`${created} of ${created + failed} stock entries added successfully`)
      }
      if (failed > 0) {
        toast.error(`${failed} entries failed`)
      }

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

  const normalizeFulfillmentStatus = (status: unknown) => {
    const value = String(status || '').trim().toUpperCase()
    if (!value) return 'PENDING'
    if (value === 'IN_TRANSIT' || value === 'OUT_FOR_DELIVERY' || value === 'DISPATCHED') return 'IN_TRANSIT'
    if (value === 'DELIVERED' || value === 'COMPLETED' || value === 'FULFILLED' || value === 'ARRIVED') return 'DELIVERED'
    if (value === 'FAILED' || value === 'FAILED_DELIVERY') return 'FAILED'
    return value
  }

  const extractFulfillmentLegs = (order: any) => {
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

  const deriveOrderFulfillmentSummary = (order: any) => {
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
        : deliveredCount > 0
          ? 'PARTIALLY_FULFILLED'
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

  const openTripEditorInCreateDialog = async (trip: WarehouseTripItem) => {
    const tripStatus = String(trip?.status || '').toUpperCase()
    if (tripStatus !== 'PLANNED') {
      toast.error('Only planned trips can be edited')
      return
    }
    const dateValue = String(trip?.tripSchedule || routeDate || getDefaultRouteDate()).slice(0, 10)
    const warehouseValue = String(trip?.warehouseId || routeWarehouseId || assignedWarehouse?.id || '').trim()
    if (!dateValue || !warehouseValue) {
      toast.error('Trip is missing schedule date or warehouse')
      return
    }
    const tripOrderIds = Array.from(
      new Set(
        (Array.isArray(trip?.dropPoints) ? trip.dropPoints : [])
          .map((point: any) => String(point?.orderId || point?.order?.id || '').trim())
          .filter(Boolean)
      )
    )

    setEditingTripState({
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      originalOrderIds: tripOrderIds,
      originalDriverId: String(trip?.driver?.id || '').trim(),
      originalVehicleId: String(trip?.vehicle?.id || '').trim(),
      driverName: String(trip?.driver?.user?.name || trip?.driver?.name || 'Unassigned').trim() || 'Unassigned',
      vehiclePlate: String(trip?.vehicle?.licensePlate || 'No assigned vehicle').trim() || 'No assigned vehicle',
    })
    setSelectedRouteDriverId(String(trip?.driver?.id || '').trim())
    setSelectedRouteOrderIds(tripOrderIds)
    setCreateRouteOpen(true)
    setRouteDate(dateValue)
    setRouteWarehouseId(warehouseValue)
    const plans = await createRoutePlan(true, dateValue, warehouseValue)
    const planGroups = mergeRoutePlansWithTripOrders(Array.isArray(plans) ? plans : [], trip.id)
    setRoutePlans(planGroups)
    if (planGroups.length === 0) return

    let bestCity = String(planGroups[0]?.city || '')
    let bestMatchCount = 0
    for (const group of planGroups) {
      const groupOrderIds = (Array.isArray(group?.orders) ? group.orders : [])
        .map((order: any) => String(order?.id || '').trim())
        .filter(Boolean)
      const matched = groupOrderIds.filter((id: string) => tripOrderIds.includes(id))
      if (matched.length > bestMatchCount) {
        bestCity = String(group?.city || bestCity)
        bestMatchCount = matched.length
      }
    }

    setSelectedRouteCity(bestCity)
    setSelectedRouteOrderIds(tripOrderIds)
  }

  const formatAllocatedQtyLabel = (order: any, allocatedQty: number, totalQty: number) => {
    const summary = deriveOrderFulfillmentSummary(order)
    return summary.totalLegs > 1 ? `${allocatedQty} / ${totalQty}` : `${allocatedQty}`
  }

  const formatWarehouseOrderStatus = (status: string, paymentStatus?: string | null, notes?: string | null) => {
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
      return 'PREPARING'
    }
    if (['PENDING', 'CONFIRMED'].includes(rawStatus)) return 'PENDING'

    return rawStatus.replace(/_/g, ' ')
  }

  const getWarehouseDisplayOrderStatus = (order: any) => {
    const summary = deriveOrderFulfillmentSummary(order)
    if (summary.totalLegs > 1) {
      if (summary.fulfillmentStatus === 'PARTIALLY_FULFILLED') return 'PARTIALLY FULFILLED'
      if (summary.fulfillmentStatus === 'FULFILLED') return 'FULFILLED'
      if (summary.fulfillmentStatus === 'IN_PROGRESS') return 'IN PROGRESS'
    }
    return formatWarehouseOrderStatus(order.status, order.paymentStatus, order.notes)
  }
  const getWarehouseOrderStatusTextClass = (status: string) => {
    const value = String(status || '').trim().toUpperCase()
    if (value === 'PENDING') return 'text-yellow-700'
    if (value === 'PREPARING') return 'text-lime-700'
    if (value === 'CANCELLED') return 'text-red-700'
    if (value === 'DELIVERED') return 'text-emerald-700'
    return 'text-slate-700'
  }
  const isWarehouseRescheduledOrder = (order: any) => String(order?.status || '').trim().toUpperCase() === 'RESCHEDULED'

  const orderStatusOptions = useMemo(() => {
    const statuses = new Set<string>()
    statuses.add('PARTIALLY FULFILLED')
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

  const getOrderItemSizeLabel = (item: any): string => {
    const productSizes = Array.isArray(item?.product?.sizes) ? item.product.sizes : []
    const combinedSizes = productSizes
      .map((value: any) => String(value || '').trim())
      .filter(Boolean)
      .join(' ')
    if (combinedSizes) return combinedSizes
    return String(item?.product?.size || item?.product?.sizeLabel || item?.product?.unit || item?.productUnit || '').trim()
  }

  const updateWarehouseOrderStatus = async (
    orderId: string,
    status: 'PREPARING' | 'RESCHEDULED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'REJECTED',
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
        const rawBackendResponse = typeof payload?.raw === 'string' ? payload.raw : ''
        const safeRawError = /<html|<!doctype|body\s*\{|typeerror at \/api/i.test(rawBackendResponse)
          ? ''
          : rawBackendResponse.replace(/<[^>]*>/g, ' ').trim().slice(0, 180)
        const backendError =
          payload?.error ||
          payload?.message ||
          safeRawError
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
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update order status')
      return false
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

  const buildReplacementLines = (replacement: any, meta: any) => {
    const rawStatus = String(replacement?.status || '').trim().toUpperCase()
    const isReplacementCompleted = ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus)
    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const formatProductNameWithSize = (baseName: any, sizeValue: any) => {
      const normalizedBaseName = String(baseName || 'N/A').trim()
      const normalizedSize = String(sizeValue || '').trim().replace(/^\((.*)\)$/, '$1').trim()
      if (!normalizedSize) return normalizedBaseName
      const trailingSizePattern = new RegExp(`\\s*\\(?${escapeRegex(normalizedSize)}\\)?\\s*$`, 'i')
      const baseWithoutTrailingSize = normalizedBaseName.replace(trailingSizePattern, '').trim()
      return `${baseWithoutTrailingSize || normalizedBaseName} (${normalizedSize})`
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

  const formatIssueStatus = (entry: WarehouseReplacementItem) => {
    const meta = parseIssueMeta(entry?.notes)
    const hasOutstandingReplacementQty = (() => {
      const lines = buildReplacementLines(entry, meta)
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

  const updateIssueStatus = async (
    replacementId: string,
    status: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'NEEDS_FOLLOW_UP',
    options?: { notes?: string; createReplacementOrder?: boolean; replacementDeliveryDate?: string; manualScheduleConfirmed?: boolean }
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
      if (schedulingFlow) {
        toast.success('Replacement delivery scheduled')
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

  const receiveReplacementReturn = async (
    replacementId: string,
    returnedLines: Array<{ replacementLineId: string; quantityBaseUnits: number }>
  ) => {
    try {
      const response = await fetch(`/api/replacements/${replacementId}/receive-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          requestId: `ret-${Date.now()}`,
          returnedLines,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || payload?.message || 'Failed to process replacement return')
      }
      toast.success('Replacement return received successfully')
      emitDataSync(['replacements', 'inventory', 'stock-batches'])
      void Promise.all([fetchReplacementsData(), fetchInventoryData()])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to process replacement return')
      throw error
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

  return (
    <div className={`${portalFont.className} relative flex min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(103,232,249,0.28),_transparent_26%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.16),_transparent_32%),linear-gradient(145deg,_#eef9ff_0%,_#eefcf6_46%,_#f6fbff_100%)]`}>
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

      <div className="relative z-[1] flex min-h-screen flex-1 flex-col lg:pl-64">
        <WarehouseHeader
          userName={String(user?.name || '')}
          userEmail={String(user?.email || '')}
          userAvatar={String(user?.avatar || '')}
          onOpenSidebar={() => setSidebarOpen(true)}
          onLogout={handleLogout}
        />

        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6">
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
              purchaseRequests={scopedOrders.filter((o) => {
                const isReplacement = Boolean((o as any)?.isScheduledReplacement) || String((o as any)?.orderNumber || '').toUpperCase().startsWith('RPL-')
                return !isReplacement
              })}
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
            <WarehouseTripsSection
              loadingTrips={loadingTrips}
              scopedTrips={scopedTrips}
              assignedWarehouseId={assignedWarehouse?.id}
              assignedWarehouseName={assignedWarehouse?.name}
              tripStatusColors={tripStatusColors}
              selectedTrip={selectedTrip}
              setSelectedTrip={setSelectedTrip}
              onOpenCreateTripFlow={() => setCreateRouteOpen(true)}
              onEditTrip={(trip) => {
                void openTripEditorInCreateDialog(trip as WarehouseTripItem)
              }}
              onDeleteTrip={(trip) => {
                void deleteTrip(trip)
              }}
              onUnassignOrderItems={(tripId, orderId, warehouseId, itemIds) => {
                void unassignOrderItemsFromTrip(tripId, orderId, warehouseId, itemIds)
              }}
              availableOrders={scopedOrders
                .filter((order) => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(String(order.status || '').toUpperCase()))
                .map((order) => ({
                  id: order.id,
                  orderNumber: order.orderNumber,
                  shippingName: order.shippingName || order.customer?.name || '',
                  shippingCity: order.shippingCity || '',
                  status: order.status,
                  allocatedQtyForSelectedWarehouse: Number((order as any)?.allocatedQtyForSelectedWarehouse || 0),
                  totalOrderQty: Number((order as any)?.totalOrderQty || 0),
                }))}
              onEditTripDropPoints={(trip, changes) => {
                void editTripDropPoints(trip as WarehouseTripItem, changes)
              }}
              editingTripId={editingTripId}
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
              receiveReplacementReturn={receiveReplacementReturn}
            />
          )}

          {activeView === 'liveTracking' && (
            <WarehouseLiveTrackingView
              trackingDate={trackingDate}
              setTrackingDate={setTrackingDate}
              fetchTripsData={fetchTripsData}
              fetchOrdersData={fetchOrdersData}
              loadingTrips={loadingTrips}
              loadingOrders={loadingOrders}
              LiveTrackingMap={LiveTrackingMap}
              liveTrackingLocations={liveTrackingLocations}
              liveTrackingRouteLines={liveTrackingRouteLines}
              liveTrackingCenter={liveTrackingCenter}
              liveTrackingActiveTrips={liveTrackingActiveTrips}
              liveTrackingRecentLocations={liveTrackingRecentLocations}
            />
          )}

          {activeView === 'inventory' && (
            <Tabs value={inventorySubView} onValueChange={(value) => setInventorySubView(value as 'inventory' | 'stocks' | 'empties')} className="space-y-4">
              <TabsList className="h-auto w-full flex-nowrap gap-2 overflow-x-auto rounded-2xl border border-white/40 bg-white/65 p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.12)] backdrop-blur-xl">
                <TabsTrigger
                  value="inventory"
                  className="inline-flex items-center gap-2 rounded-xl border border-transparent bg-transparent px-5 py-2.5 text-[15px] font-semibold text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]"
                >
                  <Package className="h-4 w-4" />
                  Inventory
                </TabsTrigger>
                <TabsTrigger
                  value="stocks"
                  className="inline-flex items-center gap-2 rounded-xl border border-transparent bg-transparent px-5 py-2.5 text-[15px] font-semibold text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]"
                >
                  <Archive className="h-4 w-4" />
                  Stock batches
                </TabsTrigger>
                <TabsTrigger
                  value="empties"
                  className="inline-flex items-center gap-2 rounded-xl border border-transparent bg-transparent px-5 py-2.5 text-[15px] font-semibold text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]"
                >
                  <Recycle className="h-4 w-4" />
                  Empty Bottles
                </TabsTrigger>
              </TabsList>

              <TabsContent value="inventory" className="mt-0">
                <WarehouseInventoryView
                  openAddStockDialog={openAddStockDialog}
                  loadingInventory={loadingInventory}
                  scopedInventory={scopedInventory}
                  getStockStatus={getStockStatus}
                  getAvailableQty={getAvailableQty}
                  formatPeso={formatPeso}
                  openEditDialog={openEditDialog}
                />
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
                <WarehouseEmptyBottlesView
                  orders={orders}
                  formatPeso={formatPeso}
                  openOrderDetail={openOrderDetail}
                  loadingOrders={loadingOrders}
                />
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
            <div className="w-full max-w-5xl space-y-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
                <p className="text-gray-500">Manage your account and preferences</p>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Profile Information</CardTitle>
                    <CardDescription>Update your personal details</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                      <Avatar className="h-16 w-16 border border-slate-200 shadow-sm">
                        {(profileAvatarFile || String((user as any)?.avatar || '').trim()) ? (
                          <AvatarImage src={profileAvatarFile ? URL.createObjectURL(profileAvatarFile) : String((user as any)?.avatar || '').trim()} alt={`${profileName || user?.name || 'User'} avatar`} className="object-cover" />
                        ) : null}
                        <AvatarFallback className="bg-linear-to-br from-cyan-600 to-emerald-600 text-lg font-semibold text-white">
                          {(String(profileName || user?.name || 'U')
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((part) => part.charAt(0).toUpperCase())
                            .join('')) || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <input ref={profileAvatarInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { profileAvatarCrop.open(event.target.files?.[0] || null); event.currentTarget.value = '' }} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">
                          {formatFullName(profileFirstName, profileMiddleName, profileLastName, profileSuffix, profileName || user?.name || 'User')}
                        </p>
                        <p className="text-sm text-slate-500 mt-0.5">{profileEmail || user?.email || 'No email provided'}</p>
                        <Button type="button" variant="outline" size="sm" className="mt-2 h-8 text-xs" onClick={() => profileAvatarInputRef.current?.click()}>
                          {profileAvatarFile ? 'Change Selected Avatar' : 'Change Avatar'}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="warehouse-profile-first-name" className="text-xs font-semibold text-slate-600">First Name</Label>
                          <Input id="warehouse-profile-first-name" value={profileFirstName} onChange={(e) => setProfileFirstName(e.target.value)} disabled={!isEditingProfile} />
                        </div>
                        <div>
                          <Label htmlFor="warehouse-profile-last-name" className="text-xs font-semibold text-slate-600">Last Name</Label>
                          <Input id="warehouse-profile-last-name" value={profileLastName} onChange={(e) => setProfileLastName(e.target.value)} disabled={!isEditingProfile} />
                        </div>
                        <div>
                          <Label htmlFor="warehouse-profile-middle-name" className="text-xs font-semibold text-slate-600">Middle Name</Label>
                          <Input id="warehouse-profile-middle-name" value={profileMiddleName} onChange={(e) => setProfileMiddleName(e.target.value)} disabled={!isEditingProfile} />
                        </div>
                        <div>
                          <Label htmlFor="warehouse-profile-suffix" className="text-xs font-semibold text-slate-600">Suffix <span className="text-xs font-normal text-slate-400">(Optional)</span></Label>
                          <Input id="warehouse-profile-suffix" value={profileSuffix} onChange={(e) => setProfileSuffix(e.target.value)} placeholder="e.g. Jr., Sr., III" disabled={!isEditingProfile} />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="warehouse-profile-email" className="text-xs font-semibold text-slate-700">Email</Label>
                      <Input
                        id="warehouse-profile-email"
                        type="email"
                        value={profileEmail}
                        onChange={(e) => {
                          setProfileEmail(e.target.value)
                          setProfileOtpSent(false)
                          setProfileOtpVerified(false)
                          setProfileOtpToken('')
                          setProfileOtp('')
                        }}
                        disabled={!isEditingProfile}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="warehouse-profile-phone" className="text-xs font-semibold text-slate-700">Phone</Label>
                      <Input id="warehouse-profile-phone" inputMode="numeric" maxLength={12} value={profilePhone} onChange={(e) => setProfilePhone(formatPhilippinePhoneInput(e.target.value))} disabled={!isEditingProfile} />
                      {profilePhone && !isValidPhilippinePhone(profilePhone) ? (
                        <p className="text-xs font-medium text-red-600">Please enter a valid Philippine mobile number</p>
                      ) : null}
                    </div>
                    {isProfileEmailChanged ? (
                      <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="rounded-lg p-2 bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                            <ShieldCheck className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-700">Email Verification</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              A verification code is required to change your email to <span className="font-medium text-slate-700">{normalizedProfileEmail}</span>.
                            </p>
                          </div>
                        </div>

                        {profileOtpVerified ? (
                          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                            <span>New email verified</span>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full gap-2 border-blue-200 text-blue-700 hover:bg-blue-50 font-medium h-9 text-xs"
                            onClick={() => void requestOtp(normalizedProfileEmail, 'profile')}
                            disabled={isSendingProfileOtp || !normalizedProfileEmail}
                          >
                            {isSendingProfileOtp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                            {isSendingProfileOtp ? 'Sending Security Code...' : profileOtpSent ? 'Resend Security Code' : 'Request Security Code'}
                          </Button>
                        )}
                      </div>
                    ) : null}
                    <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={() => {
                      if (isEditingProfile) {
                        void saveProfileSettings()
                      } else {
                        setIsEditingProfile(true)
                      }
                    }} disabled={isSavingProfile}>
                      {isSavingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {isSavingProfile ? 'Saving...' : isEditingProfile ? 'Save Changes' : 'Edit Profile'}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Security Settings</CardTitle>
                    <CardDescription>Manage 2FA verification and login protection</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">2FA Verification</p>
                        <p className="text-xs text-slate-500">Require OTP when signing in to warehouse portal</p>
                      </div>
                      <Button
                        type="button"
                        className={twoFactorEnabled ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white hover:bg-red-700'}
                        onClick={() => setTwoFactorEnabled((prev) => !prev)}
                        disabled={!isEditingSecurity}
                      >
                        {twoFactorEnabled ? 'Enabled' : 'Disabled'}
                      </Button>
                    </div>

                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Login Alerts</p>
                        <p className="text-xs text-slate-500">Send alert when your account signs in from a new device</p>
                      </div>
                      <Button
                        type="button"
                        className={loginAlertsEnabled ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white hover:bg-red-700'}
                        onClick={() => setLoginAlertsEnabled((prev) => !prev)}
                        disabled={!isEditingSecurity}
                      >
                        {loginAlertsEnabled ? 'Enabled' : 'Disabled'}
                      </Button>
                    </div>

                    <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={() => {
                      if (isEditingSecurity) {
                        void saveSecuritySettings()
                      } else {
                        setIsEditingSecurity(true)
                      }
                    }} disabled={isSavingSecuritySettings}>
                      {isSavingSecuritySettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {isSavingSecuritySettings ? 'Saving...' : isEditingSecurity ? 'Save Security Settings' : 'Edit Security Settings'}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Change Password</CardTitle>
                  <CardDescription>Update your account password separately.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1">
                    <Label htmlFor="warehouse-profile-new-password">New Password</Label>
                    <div className="relative">
                      <Input
                        id="warehouse-profile-new-password"
                        type={showNewPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password"
                      />
                      <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500" onClick={() => setShowNewPassword((v) => !v)} aria-label={showNewPassword ? 'Hide password' : 'Show password'}>
                        {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="space-y-1">
                      {passwordRequirements.map((rule) => (
                        <div key={rule.id} className="flex items-start gap-2 text-xs">
                          {rule.met ? (
                            <CircleCheck className="mt-0.5 h-4 w-4 text-emerald-600" aria-hidden="true" />
                          ) : (
                            <XCircle className="mt-0.5 h-4 w-4 text-red-500" aria-hidden="true" />
                          )}
                          <span className={rule.met ? 'text-emerald-600' : 'text-gray-500'}>{rule.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="warehouse-profile-confirm-password">Confirm New Password</Label>
                    <div className="relative">
                      <Input
                        id="warehouse-profile-confirm-password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter new password"
                      />
                      <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500" onClick={() => setShowConfirmPassword((v) => !v)} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}>
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg p-2 bg-blue-50 text-blue-600 border border-blue-100 shrink-0">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-700">Security Verification</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          A verification code will be sent to <span className="font-medium text-slate-700">{accountEmail}</span> to confirm this password change.
                        </p>
                      </div>
                    </div>

                    {passwordOtpVerified ? (
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span>Identity verified for password update</span>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full gap-2 border-blue-200 text-blue-700 hover:bg-blue-50 font-medium h-9 text-xs"
                        onClick={() => void requestOtp(accountEmail, 'password')}
                        disabled={
                          isSendingPasswordOtp ||
                          !newPassword ||
                          !confirmPassword ||
                          newPassword !== confirmPassword ||
                          Boolean(validatePasswordPolicy(newPassword))
                        }
                      >
                        {isSendingPasswordOtp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                        {isSendingPasswordOtp ? 'Sending Security Code...' : passwordOtpSent ? 'Resend Security Code' : 'Request Security Code'}
                      </Button>
                    )}
                  </div>

                  <Button
                    className="w-full bg-blue-600 text-white hover:bg-blue-700"
                    onClick={() => void updateProfilePassword()}
                    disabled={isUpdatingPassword || !passwordOtpVerified}
                  >
                    {isUpdatingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                    Update Password
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

            </>
          )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <Dialog
        open={createRouteOpen}
        onOpenChange={(open) => {
          setCreateRouteOpen(open)
          if (!open) {
            setEditingTripState(null)
            setRoutePlans([])
            setSelectedRouteCity('')
            setSelectedRouteOrderIds([])
            setRoutePlanMessage(null)
          }
        }}
      >
        <DialogContent className="w-[95vw] min-w-[1180px] h-full max-w-none max-h-[95vh] m-auto rounded-xl shadow-xl overflow-hidden p-0 flex items-stretch justify-center z-[60]">
          <DialogHeader>
            <DialogTitle className="sr-only">{editingTripState ? 'Edit Trip' : 'Create Trip'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-row w-full h-full">
            <div className="flex flex-col bg-white border-r p-2.5 min-w-[260px] max-w-[300px] w-[280px]">
              <h2 className="mb-2 text-lg font-bold">{editingTripState ? `Edit ${editingTripState.tripNumber}` : 'Create Trip'}</h2>
              <div className="mb-2">
                <label htmlFor="popup-route-date" className="text-sm font-medium text-gray-700">
                  {editingTripState ? 'Trip Delivery Date' : 'Delivery Date'}
                </label>
                <Input
                  id="popup-route-date"
                  type="date"
                  value={routeDate}
                  min={getLocalTodayDayKey()}
                  disabled={Boolean(editingTripState)}
                  onChange={(e) => setRouteDate(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <Button className="mt-1 mb-2 h-9 w-full bg-blue-600 text-sm text-white hover:bg-blue-700" onClick={() => createRoutePlan(false, routeDate, routeWarehouseId)} disabled={loadingRoutePlans}>
                {loadingRoutePlans ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                {editingTripState ? 'Refresh Orders' : 'Filter Orders'}
              </Button>

              {routePlanMessage && (
                <div className={`mb-2 rounded-lg p-2 text-[11px] ${routePlanMessage.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                  {routePlanMessage.text}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-gray-50 p-2.5">
                <h3 className="mb-1.5 text-base font-semibold">Orders by City</h3>
                {routePlans.length === 0 ? (
                  <div className="flex items-center justify-center text-sm text-gray-400 min-h-[80px]">
                    {loadingRoutePlans ? 'Loading orders...' : editingTripState ? 'No trip orders are available to edit right now' : 'Pick a delivery date and warehouse to view orders by city'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {routePlans.map((cityGroup) => (
                      <div key={cityGroup.city}>
                        <button
                          onClick={() => setSelectedRouteCity(cityGroup.city)}
                          className={`mb-1 w-full rounded-lg p-2 text-left text-sm font-semibold transition-colors ${
                            selectedRouteCity === cityGroup.city
                              ? 'bg-blue-500 text-white'
                              : 'bg-white border border-gray-200 text-gray-900 hover:border-blue-400'
                          }`}
                        >
                          {cityGroup.city} ({cityGroup.orders.length} orders)
                        </button>
                        {selectedRouteCity === cityGroup.city && (
                          <div className="mb-2 space-y-1 pl-2">
                            {cityGroup.orders.map((order) => (
                              <button
                                key={order.id}
                                onClick={() => handleRouteOrderClick(cityGroup.city, order.id)}
                                className={`w-full rounded p-1 text-left text-[11px] transition-colors ${
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
                                    {selectedRouteOrderIds.includes(order.id) ? '\u2713' : ''}
                                  </span>
                                  <span className="truncate">{order.orderNumber || order.id}</span>
                                  {(order as any)?.currentTripOrder ? (
                                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">In Trip</span>
                                  ) : null}
                                  {isWarehouseRescheduledOrder(order) ? (
                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Rescheduled Order</span>
                                  ) : null}
                                  {(Boolean((order as any)?.isScheduledReplacement) || String(order?.orderNumber || '').toUpperCase().startsWith('RPL-')) ? (
                                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Scheduled Replacement</span>
                                  ) : null}
                                </div>
                                <div className="text-xs text-gray-500 truncate">{getOrderBarangayLabel(order.address, order.city)}</div>
                                {(() => {
                                  const summary = deriveOrderFulfillmentSummary(order)
                                  const isMultiWarehouse = summary.totalLegs > 1
                                  if (!isMultiWarehouse) return null
                                  if (!Array.isArray((order as any)?.productAllocations) || (order as any).productAllocations.length === 0) return null
                                  return (
                                    <div className="mt-0.5 space-y-0.5">
                                      {(order as any).productAllocations.map((line: any, index: number) => (
                                        <div
                                          key={`${String(line?.itemId || index)}`}
                                          className={`text-[10px] ${Number(line?.allocatedQtyForSelectedWarehouse || 0) > 0 ? 'text-emerald-700' : 'text-amber-700'}`}
                                        >
                                          {String(line?.productName || 'Product')}
                                          {String(line?.sizeLabel || '').trim() ? ` (${String(line.sizeLabel).trim()})` : ''}: {formatAllocatedQtyLabel(order, Number(line?.allocatedQtyForSelectedWarehouse || 0), Number(line?.totalQty || 0))}
                                        </div>
                                      ))}
                                    </div>
                                  )
                                })()}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-1 space-y-1">
                {editingTripState ? (
                  <>
                    <label className="text-[11px] font-medium text-gray-700">Assign Driver</label>
                    <select
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      title="Assign Driver"
                      value={selectedRouteDriverId}
                      onChange={(e) => setSelectedRouteDriverId(e.target.value)}
                    >
                      <option value="">Select driver</option>
                      {drivers.map((driver) => (
                        <option
                          key={driver.id}
                          value={driver.id}
                          disabled={!isDriverSelectableForTrip(driver, { allowDriverId: editingTripState.originalDriverId, allowVehicleId: editingTripState.originalVehicleId })}
                        >
                          {(driver.user?.name || driver.name || driver.email || driver.id) + (() => {
                            const issue = getDriverTripEligibilityLabel(driver, { allowDriverId: editingTripState.originalDriverId, allowVehicleId: editingTripState.originalVehicleId })
                            return issue ? ` (${issue})` : ''
                          })()}
                        </option>
                      ))}
                    </select>
                    <Input
                      readOnly
                      className="h-8 text-xs"
                      value={selectedDriverAssignedVehicle?.licensePlate || editingTripState.vehiclePlate}
                    />
                    {selectedRouteDriverId && selectedRouteDriverId !== editingTripState.originalDriverId && selectedDriverEligibilityIssue ? (
                      <p className="text-[11px] text-amber-600">Selected driver cannot be assigned: {selectedDriverEligibilityIssue}.</p>
                    ) : null}
                    <p className="text-[11px] text-gray-500">This edit updates the trip orders and driver assignment.</p>
                  </>
                ) : (
                  <>
                    <label className="text-[11px] font-medium text-gray-700">Assign Driver</label>
                    <select
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      title="Assign Driver"
                      value={selectedRouteDriverId}
                      onChange={(e) => setSelectedRouteDriverId(e.target.value)}
                    >
                      <option value="">Select driver</option>
                      {drivers.map((driver) => (
                        <option key={driver.id} value={driver.id} disabled={!isDriverSelectableForTrip(driver)}>
                          {(driver.user?.name || driver.name || driver.email || driver.id) + (() => {
                            const issue = getDriverTripEligibilityLabel(driver)
                            return issue ? ` (${issue})` : ''
                          })()}
                        </option>
                      ))}
                    </select>
                    <Input
                      readOnly
                      className="h-8 text-xs"
                      value={selectedDriverAssignedVehicle?.licensePlate || 'No assigned vehicle'}
                    />
                    {selectedRouteDriverId && selectedDriverEligibilityIssue ? (
                      <p className="text-[11px] text-amber-600">Selected driver cannot be assigned: {selectedDriverEligibilityIssue}.</p>
                    ) : null}
                  </>
                )}
                <Button
                  className="h-8 w-full bg-blue-600 text-sm text-white hover:bg-blue-700"
                  onClick={() => {
                    if (editingTripState) {
                      void saveTripEditsFromCurrentRoutePlan()
                    } else {
                      void createTripFromCurrentRoutePlan()
                    }
                  }}
                  disabled={
                    creatingTripFromRoute ||
                    loadingRoutePlans ||
                    !routeDate ||
                    !routeWarehouseId ||
                    (editingTripState
                      ? (
                          editingTripId === editingTripState.tripId ||
                          !String(selectedRouteDriverId || editingTripState.originalDriverId || '').trim() ||
                          Boolean(selectedDriverEligibilityIssue) ||
                          (
                            String(selectedRouteDriverId || editingTripState.originalDriverId || '').trim() !== String(editingTripState.originalDriverId || '').trim() &&
                            !selectedDriverAssignedVehicle?.id
                          )
                        )
                      : (
                          !selectedRouteCity ||
                          selectedRouteOrderIds.length === 0 ||
                          !selectedRouteDriverId ||
                          Boolean(selectedDriverEligibilityIssue) ||
                          !selectedDriverAssignedVehicle?.id
                        ))
                  }
                >
                  {/* Show immediate progress feedback for both trip creation and trip-detail saves. */}
                  {creatingTripFromRoute || (editingTripState && editingTripId === editingTripState.tripId)
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : null}
                  {editingTripState
                    ? editingTripId === editingTripState.tripId ? 'Saving Trip Changes...' : 'Save Trip Changes'
                    : 'Create Trip'}
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
                        <div className="mb-2 w-full max-w-lg">
                          <div className="mb-1 flex flex-col items-start rounded-lg border-2 border-green-400 bg-green-50 p-2.5">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white font-bold">
                                <svg width="16" height="16" fill="none"><path d="M9 2.25a6.75 6.75 0 1 1 0 13.5a6.75 6.75 0 0 1 0-13.5Zm0 2.25v2.25m0 2.25h.008v.008H9V6.75Z" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              </span>
                              <span className="text-sm font-semibold text-green-900">Warehouse - Starting Point</span>
                            </div>
                            <div className="text-[11px] font-semibold text-gray-700">{wh.name}</div>
                            <div className="text-[10px] text-green-700">{[wh.address, wh.city, wh.province].filter(Boolean).join(', ')}</div>
                            {wh.latitude && wh.longitude && (
                              <div className="mt-0.5 text-[10px] text-gray-500">Coordinates: {wh.latitude}, {wh.longitude}</div>
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
                              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                                <span>{order.customerName || order.orderNumber}</span>
                                {(order as any)?.currentTripOrder ? (
                                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">In Trip</span>
                                ) : null}
                                {isWarehouseRescheduledOrder(order) ? (
                                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Rescheduled Order</span>
                                ) : null}
                                {(Boolean((order as any)?.isScheduledReplacement) || String(order?.orderNumber || '').toUpperCase().startsWith('RPL-')) ? (
                                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Scheduled Replacement</span>
                                ) : null}
                              </div>
                              <div className="text-[11px] text-gray-600">{order.address || order.city || ''}</div>
                              {order.products && (
                                <div className="mt-0.5 text-[11px] text-gray-500">{order.products}</div>
                              )}
                              {(() => {
                                // Check if this is a multi-warehouse order
                                const summary = deriveOrderFulfillmentSummary(order)
                                const isMultiWarehouse = summary.totalLegs > 1
                                if (!isMultiWarehouse) return null
                                
                                if (Array.isArray((order as any)?.productAllocations) && (order as any).productAllocations.length > 0) {
                                  return (
                                    <div className="mt-0.5 space-y-0.5">
                                      {(order as any).productAllocations.map((line: any, index: number) => (
                                        <div
                                          key={`${String(line?.itemId || index)}-map`}
                                        className={`text-[11px] ${Number(line?.allocatedQtyForSelectedWarehouse || 0) > 0 ? 'text-emerald-700' : 'text-amber-700'}`}
                                      >
                                        {String(line?.productName || 'Product')}
                                          {String(line?.sizeLabel || '').trim() ? ` (${String(line.sizeLabel).trim()})` : ''}: {formatAllocatedQtyLabel(order, Number(line?.allocatedQtyForSelectedWarehouse || 0), Number(line?.totalQty || 0))}
                                        </div>
                                      ))}
                                    </div>
                                  )
                                }
                                return (
                                  <div className={`mt-0.5 text-[11px] ${Number((order as any)?.allocatedQtyForSelectedWarehouse || 0) > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                    Allocated for this warehouse: {formatAllocatedQtyLabel(order, Number((order as any)?.allocatedQtyForSelectedWarehouse || 0), Number((order as any)?.totalOrderQty || 0))}
                                  </div>
                                )
                              })()}
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
            <DialogTitle>Create Trip</DialogTitle>
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
                  <option key={driver.id} value={driver.id} disabled={!isDriverSelectableForTrip(driver)}>
                    {(driver.user?.name || driver.name || driver.email || driver.id) + (() => {
                      const issue = getDriverTripEligibilityLabel(driver)
                      return issue ? ` (${issue})` : ''
                    })()}
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
              {selectedRouteDriverId && selectedDriverEligibilityIssue ? (
                <p className="text-xs text-amber-600">Selected driver cannot be assigned: {selectedDriverEligibilityIssue}.</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setCreateTripOpen(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
                onClick={createTripFromRoute}
                disabled={creatingTripFromRoute || !selectedSavedRouteId || !selectedRouteDriverId || Boolean(selectedDriverEligibilityIssue) || !selectedDriverAssignedVehicle?.id}
              >
                {creatingTripFromRoute ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                Create Trip
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="flex max-h-[92vh] w-[95vw] max-w-[980px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
          {selectedOrder && (
            <>
              {(() => {
                const isReplacementOrderInDetails =
                  Boolean((selectedOrder as any)?.isScheduledReplacement) ||
                  String((selectedOrder as any)?.orderNumber || '').trim().toUpperCase().startsWith('RPL-')
                const isRescheduledOrderInDetails = isWarehouseRescheduledOrder(selectedOrder)
                return (
                  <>
              <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-4 sm:px-7">
                <DialogTitle className="flex items-center gap-3 text-[0.98rem] font-bold tracking-tight text-slate-900 sm:text-[1.3rem]">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100 sm:h-11 sm:w-11">
                    <ClipboardList className="h-5 w-5 sm:h-6 sm:w-6" />
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span>Order Details - {selectedOrder.orderNumber}</span>
                    {isRescheduledOrderInDetails ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Rescheduled Order</span>
                    ) : null}
                  </span>
                </DialogTitle>
                <DialogDescription>{loadingOrderDetail ? 'Loading latest order details...' : undefined}</DialogDescription>
              </DialogHeader>
              <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4 sm:space-y-4 sm:px-7 sm:py-5">
                <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/45 p-3.5 sm:p-4.5">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-600">Order Status</p>
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700 sm:h-11 sm:w-11">
                        <Truck className="h-5 w-5" />
                      </div>
                    </div>
                    {(() => {
                      const displayStatus = getWarehouseDisplayOrderStatus(selectedOrder)
                      return (
                        <p className={`text-[0.8rem] font-bold leading-tight sm:text-[0.98rem] ${getWarehouseOrderStatusTextClass(displayStatus)}`}>
                          {displayStatus}
                        </p>
                      )
                    })()}
                  </div>
                  <div className="rounded-2xl border border-blue-200 bg-blue-50/45 p-3.5 sm:p-4.5">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-600">Driver Assignment</p>
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-blue-100 text-blue-700 sm:h-11 sm:w-11">
                        <Building2 className="h-5 w-5" />
                      </div>
                    </div>
                    {selectedOrder.isDriverAssigned ? (
                      <p className="text-[0.8rem] font-bold leading-tight text-blue-700 sm:text-[0.98rem]">{selectedOrder.assignedDriverName || 'Assigned'}</p>
                    ) : (
                      <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                        Not Assigned
                      </div>
                    )}
                  </div>
                </div>
                {(() => {
                  const summary = deriveOrderFulfillmentSummary(selectedOrder)
                  const isMultiWarehouse = summary.totalLegs > 1
                  if (!isMultiWarehouse) return null
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                      <p className="mb-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">Fulfillment Legs</p>
                      <div className="space-y-2">
                        {summary.legs.map((leg: any) => (
                          <div key={leg.id} className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-slate-900">{leg.warehouseName || 'Unassigned Warehouse'}</p>
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                                {String(leg.status || 'PENDING').replace(/_/g, ' ')}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">
                              Trip: {leg.tripNumber || leg.tripId || 'Not assigned'}{` | Allocated Qty: ${Number(leg.allocatedQty || 0)}`}
                            </p>
                            {!leg.tripId && !leg.tripNumber ? (
                              <p className="mt-1 text-xs font-medium text-amber-700">Needs trip assignment.</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <p className="mb-3 flex items-center gap-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-indigo-50 text-indigo-600">
                      <User className="h-5 w-5" />
                    </span>
                    Client Information
                  </p>
                  <div className="space-y-2 text-slate-700">
                    <p className="flex items-center gap-3 text-sm sm:text-base"><User className="h-5 w-5 text-slate-500" />{selectedOrder.customer?.name || selectedOrder.shippingName || 'N/A'}</p>
                    <p className="flex items-center gap-3 text-sm text-blue-700 sm:text-base"><Mail className="h-5 w-5 text-slate-500" />{selectedOrder.customer?.email || 'N/A'}</p>
                    <p className="flex items-center gap-3 text-sm sm:text-base"><Phone className="h-5 w-5 text-slate-500" />{selectedOrder.shippingPhone || selectedOrder.customer?.phone || 'N/A'}</p>
                    <p className="flex items-start gap-3 text-sm sm:text-base"><MapPin className="mt-1 h-5 w-5 shrink-0 text-slate-500" />{formatWarehouseOrderAddress(selectedOrder)}</p>
                  </div>
                </div>
                {(() => {
                  const summary = deriveOrderFulfillmentSummary(selectedOrder)
                  const isMultiWarehouse = summary.totalLegs > 1
                  const assignedWarehouseId = String(assignedWarehouse?.id || '').trim()
                  const orderItems = Array.isArray(selectedOrder.items) ? selectedOrder.items : []
                  const getItemAllocatedForWarehouse = (item: any) => {
                    const allocs = Array.isArray(item?.warehouseAllocations) ? item.warehouseAllocations : []
                    const fromItem = allocs
                      .filter((entry: any) => String(entry?.warehouseId || entry?.warehouse_id || '').trim() === assignedWarehouseId)
                      .reduce((sum: number, entry: any) => sum + Number(entry?.allocatedQty || entry?.quantity || 0), 0)
                    if (fromItem > 0) return fromItem
                    const orderHasAllocationData = Array.isArray(selectedOrder?.warehouseAllocations) && selectedOrder.warehouseAllocations.length > 0
                    if (orderHasAllocationData) return 0
                    return Number(item?.quantity || 0)
                  }
                  const warehouseScopedTotal = orderItems.reduce((sum: number, item: any) => {
                    const allocatedQty = getItemAllocatedForWarehouse(item)
                    const unitPrice = Number(item?.unitPrice ?? item?.unit_price ?? 0)
                    const lineTotal = Number(item?.totalPrice ?? item?.total_price ?? 0)
                    const safeLineTotal = lineTotal > 0 ? lineTotal : unitPrice * Number(item?.quantity || 0)
                    const qty = Number(item?.quantity || 0)
                    const ratio = qty > 0 ? allocatedQty / qty : 0
                    return sum + (ratio > 0 ? safeLineTotal * ratio : 0)
                  }, 0)
                  
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                      <p className="mb-3 flex items-center gap-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                          <PackageCheck className="h-5 w-5" />
                        </span>
                        Order Details
                      </p>
                      <div className="space-y-2">
                        {orderItems.map((item: any) => {
                          const isMixedCase = item?.itemType === 'MIXED_CASE'
                          return (
                          <div key={item.id} className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-2.5">
                              {!isMixedCase ? <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                                {item?.product?.imageUrl ? (
                                  <img
                                    src={String(item.product.imageUrl)}
                                    alt={String(item?.product?.name || 'Product')}
                                    className="h-full w-full object-contain"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                      if (e.currentTarget.parentElement) {
                                        const fallback = document.createElement('div')
                                        fallback.className = 'grid h-full w-full place-items-center text-[10px] text-slate-400'
                                        fallback.textContent = 'No image'
                                        e.currentTarget.parentElement.appendChild(fallback)
                                      }
                                    }}
                                  />
                                ) : (
                                  <div className="grid h-full w-full place-items-center text-[10px] text-slate-400">No image</div>
                                )}
                              </div> : null}
                              <div className="min-w-0 pt-0.5">
                                <p className="text-sm text-slate-800 sm:text-[1.02rem]">
                                  {isMixedCase ? 'Mixed Case' : item.product?.name || 'Product'}
                                  {!isMixedCase && getOrderItemSizeLabel(item) ? ` ${getOrderItemSizeLabel(item)}` : ''}
                                  {' '}x{item.quantity}
                                </p>
                                {/* Mixed-case component photos are intentionally shown only in View Details. */}
                                {isMixedCase ? <MixedCaseComponents item={item} compact /> : null}
                                {String(item?.product?.category?.name || item?.product?.category || '').trim() ? (
                                  <p className="mt-0.5 text-xs text-slate-500">
                                    {String(item?.product?.category?.name || item?.product?.category || '').trim()}
                                  </p>
                                ) : null}
                                {isMultiWarehouse && (
                                  <p className="mt-1 text-sm font-semibold text-slate-900">
                                    Allocated for this warehouse: {getItemAllocatedForWarehouse(item)}
                                  </p>
                                )}
                                <CompactDiscountLine
                                  value={formatPeso(Number((selectedOrder as any)?.discountDetails?.totalDiscount || (selectedOrder as any)?.discount || 0))}
                                  percent={(() => {
                                    const explicitPercent = Number((selectedOrder as any)?.discountDetails?.percent)
                                    if (Number.isFinite(explicitPercent) && explicitPercent > 0) return explicitPercent
                                    const subtotal = Number((selectedOrder as any)?.subtotal || 0)
                                    const discount = Number((selectedOrder as any)?.discountDetails?.totalDiscount || (selectedOrder as any)?.discount || 0)
                                    if (subtotal > 0 && discount > 0) return (discount / subtotal) * 100
                                    return 0
                                  })()}
                                  className="mt-1 text-sm font-semibold text-[#2b4f83]"
                                />
                              </div>
                            </div>
                            <span className="pt-1 text-sm font-semibold text-slate-900 sm:text-[1.05rem]">{formatPeso((item.totalPrice ?? item.quantity * item.unitPrice) || 0)}</span>
                          </div>
                          )
                        })}
                        <div className="h-px bg-slate-200" />
                        {isMultiWarehouse ? (
                          <p className="text-right text-[1.08rem] font-bold leading-tight text-slate-900 sm:text-[1.35rem]">
                            Warehouse scoped total: <span className="text-emerald-700">{formatPeso(warehouseScopedTotal || 0)}</span>
                          </p>
                        ) : (
                          <p className="text-right text-[1.08rem] font-bold leading-tight text-slate-900 sm:text-[1.35rem]">
                            Order total: <span className="text-emerald-700">{formatPeso(selectedOrder.totalAmount || 0)}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })()}
                {(() => {
                  const hasTrip =
                    String(selectedOrder.status || '').trim().toUpperCase() !== 'RESCHEDULED' &&
                    Boolean(selectedOrder.progress?.trip || selectedOrder.assignedTripId || selectedOrder.tripId)
                  if (!hasTrip) return null
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="flex items-center gap-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-violet-50 text-violet-600">
                            <Clock className="h-5 w-5" />
                          </span>
                          Progress
                        </p>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-700">
                          {selectedOrder.progress?.dropPoint?.status
                            ? String(selectedOrder.progress.dropPoint.status).replace(/_/g, ' ')
                            : 'No trip progress yet'}
                          <CircleCheck className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <div className="space-y-1.5 text-sm text-slate-700 sm:text-base">
                        <p className="flex items-center gap-3"><Route className="h-5 w-5 text-slate-500" />Trip: {selectedOrder.progress?.trip?.tripNumber || 'Not assigned yet'}</p>
                        <p className="flex items-center gap-3"><User className="h-5 w-5 text-slate-500" />Driver: {selectedOrder.progress?.trip?.driver?.user?.name || selectedOrder.progress?.trip?.driver?.name || selectedOrder.assignedDriverName || 'Not assigned yet'}</p>
                        <p className="flex items-center gap-3"><Car className="h-5 w-5 text-slate-500" />Vehicle: {selectedOrder.progress?.trip?.vehicle?.licensePlate || 'Not assigned yet'}</p>
                        <p><span className="inline-flex items-center gap-3"><CalendarClock className="h-5 w-5 text-slate-500" />Arrival: {selectedOrder.progress?.pod?.actualArrival ? new Date(selectedOrder.progress.pod.actualArrival).toLocaleString() : 'N/A'}</span></p>
                        <p><span className="inline-flex items-center gap-3"><CalendarClock className="h-5 w-5 text-slate-500" />Departure: {selectedOrder.progress?.pod?.actualDeparture ? new Date(selectedOrder.progress.pod.actualDeparture).toLocaleString() : 'N/A'}</span></p>
                      </div>
                      {(() => {
                        const trip = selectedOrder.progress?.trip
                        const points = Array.isArray(trip?.dropPoints) ? trip.dropPoints : []
                        const selectedSchedule = String(
                          selectedOrder.deliveryDate || trip?.tripSchedule || ''
                        )
                          .trim()
                          .slice(0, 10)
                        const scheduledOrders = points
                          .map((point: any) => point?.order)
                          .filter((order: any) => order && String(order.id || '').trim())
                          .filter((order: any) => {
                            if (!selectedSchedule) return true
                            return String(order.deliveryDate || '').trim().slice(0, 10) === selectedSchedule
                          })
                          .filter(
                            (order: any, index: number, rows: any[]) =>
                              rows.findIndex((candidate: any) => String(candidate.id) === String(order.id)) === index
                          )

                        return (
                          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                            <p className="text-xs font-medium text-slate-500">Scheduled Orders On This Trip</p>
                            {scheduledOrders.length === 0 ? (
                              <p className="mt-1 text-sm text-slate-600">No scheduled orders found for this trip date.</p>
                            ) : (
                              <div className="mt-1 space-y-1">
                                {scheduledOrders.map((order: any) => {
                                  const rawStatus = String(order.status || 'N/A').toUpperCase()
                                  const rawScheduleDate = String(order.deliveryDate || order.timeline?.deliveryDate || '').trim()
                                  const parsedScheduleDate = rawScheduleDate ? new Date(rawScheduleDate) : null
                                  const hasValidScheduleDate = Boolean(parsedScheduleDate && !Number.isNaN(parsedScheduleDate.getTime()))
                                  const scheduleLabel = hasValidScheduleDate
                                    ? parsedScheduleDate!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                    : null

                                  return (
                                    <div key={String(order.id)} className="flex items-center justify-between text-sm text-slate-700">
                                      <span className="inline-flex items-center gap-2">
                                        <span>{String(order.orderNumber || order.id || 'Order')}</span>
                                        {isWarehouseRescheduledOrder(order) ? (
                                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Rescheduled Order</span>
                                        ) : null}
                                        {(Boolean((order as any)?.isScheduledReplacement) || String(order?.orderNumber || '').toUpperCase().startsWith('RPL-')) ? (
                                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Scheduled Replacement</span>
                                        ) : null}
                                      </span>
                                      <span className="text-xs uppercase text-slate-500">
                                        {rawStatus.replace(/_/g, ' ')}
                                        {rawStatus === 'RESCHEDULED' && scheduleLabel ? ` • ${scheduleLabel}` : ''}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })()}
                {(() => {
                  const hasTrip =
                    String(selectedOrder.status || '').trim().toUpperCase() !== 'RESCHEDULED' &&
                    Boolean(selectedOrder.progress?.trip || selectedOrder.assignedTripId || selectedOrder.tripId)
                  if (!hasTrip) return null
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                      <p className="mb-3 flex items-center gap-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-50 text-amber-600">
                          <Camera className="h-5 w-5" />
                        </span>
                        Proof Of Delivery
                      </p>
                      {selectedOrder.progress?.pod?.deliveryPhoto ? (
                        <img
                          src={selectedOrder.progress.pod.deliveryPhoto}
                          alt="Proof of delivery"
                          className="mt-2 h-64 w-full rounded-xl border border-slate-200 object-cover"
                        />
                      ) : (
                        <p className="mt-1 text-base italic text-slate-500">No POD uploaded yet.</p>
                      )}
                    </div>
                  )
                })()}
                {(() => {
                  const selectedOrderStatus = String(selectedOrder.status || '').toUpperCase()
                  const isPendingApproval = String(selectedOrder.paymentStatus || '').toLowerCase() === 'pending_approval'
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {isPendingApproval || ['PENDING', 'CONFIRMED'].includes(selectedOrderStatus) ? (
                        <Button
                          className="bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => void updateWarehouseOrderStatus(selectedOrder.id, 'PREPARING')}
                          disabled={updatingOrderId === selectedOrder.id}
                        >
                          Confirm Order
                        </Button>
                      ) : selectedOrderStatus === 'RESCHEDULED' ? (
                        <Button
                          className="bg-amber-600 text-white hover:bg-amber-700"
                          onClick={() => void updateWarehouseOrderStatus(selectedOrder.id, 'PREPARING')}
                          disabled={updatingOrderId === selectedOrder.id}
                        >
                          Approve Rescheduled Order
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
                )
              })()}
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
                      const orderStatus = String(rejectOrder?.status || '').toUpperCase()
                      const paymentStatus = String(rejectOrder?.paymentStatus || '').toLowerCase()
                      const canReject = paymentStatus === 'pending_approval' || orderStatus === 'PENDING'
                      if (!canReject) {
                        toast.error('Only not-yet-approved orders can be rejected.')
                        return
                      }
                      await updateWarehouseOrderStatus(rejectOrder.id, 'REJECTED', rejectReason.trim() || undefined)
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

      <Dialog
        open={addStockOpen}
        onOpenChange={(open) => {
          setAddStockOpen(open)
          if (open) {
            if (isWarehouseScopedUser && assignedWarehouse?.id) {
              setStockInWarehouseId(assignedWarehouse.id)
            } else if (!stockInWarehouseId && warehouses[0]?.id) {
              setStockInWarehouseId(warehouses[0].id)
            }
            return
          }
          resetStockInForm()
        }}
      >
        <DialogContent className="flex h-[86vh] w-[86vw] max-w-[800px] sm:max-w-[800px] flex-col overflow-hidden p-6">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-3xl font-bold">Add Stock</DialogTitle>
            <DialogDescription className="text-lg mt-2">Add multiple stock entries by batch</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 pr-1">
            {!(isWarehouseScopedUser && assignedWarehouse?.id) ? (
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
            ) : null}

            {/* Stock Rows Table */}
            <div className="overflow-x-auto rounded-md border">
              <div className="min-w-[700px]">
                {/* Sticky Header */}
                <div className="sticky top-0 z-20 grid grid-cols-[minmax(160px,1.7fr)_minmax(72px,0.65fr)_minmax(120px,0.95fr)_minmax(120px,0.95fr)_24px] gap-1.5 border-b bg-gray-100 px-2.5 py-3 text-sm font-semibold text-gray-700">
                  <div className="px-2.5">Product</div>
                  <div className="px-2.5">Quantity</div>
                  <div className="px-2.5">Manufactured Date</div>
                  <div className="px-2.5">Expiry Date</div>
                  <div></div>
                </div>

                {/* Rows */}
                <div className="max-h-[50vh] overflow-y-auto">
                {stockRows.map((row, idx) => (
                  <div key={row.id} className="grid grid-cols-[minmax(160px,1.7fr)_minmax(72px,0.65fr)_minmax(120px,0.95fr)_minmax(120px,0.95fr)_24px] items-start gap-1.5 border-b bg-white px-2.5 py-3 transition hover:bg-gray-50">
                    {/* Product Select */}
                    <div className="min-w-0 space-y-1">
                      {(() => {
                        const selectedProductMeta = availableExistingProducts.find((p) => p.id === row.productId)
                        const statusToneClass =
                          selectedProductMeta?.inventoryStatus === 'overstocked' ? 'text-blue-700' :
                          selectedProductMeta?.inventoryStatus === 'critical' || selectedProductMeta?.inventoryStatus === 'out_of_stock' ? 'text-red-700' :
                          selectedProductMeta?.inventoryStatus === 'low' ? 'text-amber-700' :
                          'text-slate-900'
                        const statusLabel =
                          selectedProductMeta?.inventoryStatus === 'overstocked' ? 'Overstocked' :
                          selectedProductMeta?.inventoryStatus === 'critical' ? 'Critical' :
                          selectedProductMeta?.inventoryStatus === 'out_of_stock' ? 'Out of Stock' :
                          selectedProductMeta?.inventoryStatus === 'low' ? 'Low' :
                          selectedProductMeta?.inventoryStatus === 'healthy' ? 'Healthy' :
                          ''
                        return (
                      <>
                      <select
                        title="Select Product"
                        className={`h-10 min-w-0 w-full rounded-md border px-2 py-1.5 text-sm font-medium ${statusToneClass} ${row.validationErrors.productId ? 'border-red-500 bg-red-50' : 'border-input bg-white'}`}
                        value={row.productId}
                        onChange={(e) => updateStockRow(row.id, 'productId', e.target.value)}
                      >
                        <option value="">Select product</option>
                        {availableExistingProducts.map((product) => {
                          const selectedInAnotherRow = stockRows.some(
                            (r) => r.id !== row.id && r.productId === product.id
                          )
                          const sizeString = product.sizes && product.sizes.length > 0
                            ? ` (${product.sizes.join(', ')})`
                            : ''
                          const categoryLabel = String((product as any)?.category?.name || (product as any)?.category || '').trim()
                          return (
                            <option key={product.id} value={product.id} disabled={selectedInAnotherRow || Boolean(product.isOverstocked)}>
                              {product.name}{sizeString}{categoryLabel ? ` - ${categoryLabel}` : ''}{product.isOverstocked ? ' (Overstocked - blocked)' : ''}
                            </option>
                          )
                        })}
                      </select>
                      {statusLabel ? (
                        <p className={`px-0.5 text-[11px] font-semibold ${statusToneClass}`}>
                          {statusLabel}
                        </p>
                      ) : null}
                      </>
                        )
                      })()}
                      {row.validationErrors.productId && (
                        <p className="text-xs text-red-600">{row.validationErrors.productId}</p>
                      )}
                      {!row.validationErrors.productId && availableExistingProducts.some((p) => p.isOverstocked) && (
                        <p className="text-xs text-amber-700">
                          Some products are blocked: overstocked (latest stock-in reached at least 10x threshold).
                        </p>
                      )}
                    </div>

                    {/* Quantity Input */}
                    <div className="min-w-0 space-y-1">
                      <Input
                        id={`qty-${row.id}`}
                        type="number"
                        placeholder="0"
                        className={`h-10 min-w-0 text-sm px-2 ${row.validationErrors.quantity ? 'border-red-500 bg-red-50' : ''}`}
                        value={row.quantity}
                        onChange={(e) => updateStockRow(row.id, 'quantity', e.target.value)}
                      />
                      {row.validationErrors.quantity && (
                        <p className="text-xs text-red-600">{row.validationErrors.quantity}</p>
                      )}
                    </div>

                    {/* Manufactured Date Input */}
                    <div className="min-w-0 space-y-1">
                      <Input
                        id={`mfg-${row.id}`}
                        type="date"
                        className={`h-10 min-w-0 text-sm px-2 ${row.validationErrors.manufacturedDate ? 'border-red-500 bg-red-50' : ''}`}
                        value={row.manufacturedDate}
                        onChange={(e) => updateStockRow(row.id, 'manufacturedDate', e.target.value)}
                      />
                      {row.validationErrors.manufacturedDate && (
                        <p className="text-xs text-red-600">{row.validationErrors.manufacturedDate}</p>
                      )}
                    </div>

                    {/* Expiry Date Input */}
                    <div className="min-w-0 space-y-1">
                      <Input
                        id={`expiry-${row.id}`}
                        type="date"
                        className={`h-10 min-w-0 text-sm px-2 ${row.validationErrors.expiryDate ? 'border-red-500 bg-red-50' : ''}`}
                        value={row.expiryDate}
                        onChange={(e) => updateStockRow(row.id, 'expiryDate', e.target.value)}
                      />
                      {row.validationErrors.expiryDate && (
                        <p className="text-xs text-red-600">{row.validationErrors.expiryDate}</p>
                      )}
                    </div>

                    {/* Remove Button */}
                    <Button
                      size="icon"
                      variant="ghost"
                      className={`mt-0.5 h-10 w-7 ${stockRows.length === 1 ? 'cursor-not-allowed text-gray-400 opacity-50' : 'text-red-600 hover:bg-red-50 hover:text-red-700'}`}
                      onClick={() => removeStockRow(row.id)}
                      disabled={stockRows.length === 1}
                      title={stockRows.length === 1 ? 'Cannot remove last row' : 'Remove row'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                </div>
              </div>
            </div>

            </div>
            {/* Bottom Actions */}
            <div className="mt-3 shrink-0 space-y-3 border-t bg-white pt-3">
              <Button
                type="button"
                variant="outline"
                className="w-full border-dashed text-xs py-2"
                onClick={addStockRow}
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                Add Row
              </Button>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 text-base py-3"
                  onClick={() => setAddStockOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-blue-600 text-white hover:bg-blue-700 text-base py-3"
                  onClick={addStockInBatch}
                  disabled={isSubmittingStockIn}
                >
                  {isSubmittingStockIn ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : null}
                  Add Stock ({stockRows.length} {stockRows.length === 1 ? 'item' : 'items'})
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Inventory Item</DialogTitle>
            <DialogDescription>Update product name and photo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edit-name">Product Name</Label>
              <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-image-file">Photo</Label>
              <Input id="edit-image-file" type="file" accept="image/*" onChange={(e) => setEditImageFile(e.target.files?.[0] || null)} />
              {editImageUrl && <p className="text-xs text-gray-500">Current photo is set.</p>}
            </div>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1 bg-blue-600 text-white hover:bg-blue-700" onClick={saveInventoryEdit} disabled={isSavingEdit || isDeletingEdit}>
                {isSavingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingBatch} onOpenChange={(open) => !open && setEditingBatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Stock Batch</DialogTitle>
            <DialogDescription>
              Update the quantity and dates for batch {editingBatch?.batchNumber || ''}. Inventory totals will sync automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edit-batch-quantity">Quantity</Label>
              <Input
                id="edit-batch-quantity"
                type="number"
                min="0"
                step="1"
                value={editBatchQuantity}
                onChange={(e) => setEditBatchQuantity(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="edit-batch-manufactured-date">Manufactured Date</Label>
                <Input
                  id="edit-batch-manufactured-date"
                  type="date"
                  value={editBatchManufacturedDate}
                  onChange={(e) => setEditBatchManufacturedDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-batch-expiry-date">Expiry Date</Label>
                <Input
                  id="edit-batch-expiry-date"
                  type="date"
                  value={editBatchExpiryDate}
                  onChange={(e) => setEditBatchExpiryDate(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1 bg-blue-600 text-white hover:bg-blue-700" onClick={saveStockBatchChanges} disabled={isSavingBatchQty}>
                {isSavingBatchQty ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteEditOpen && !isWarehouseScopedUser} onOpenChange={setDeleteEditOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">Delete Product Permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete{' '}
              <span className="font-semibold text-foreground">{editingItem?.product?.name || 'this product'}</span>{' '}
              from the system. This cannot be undone.
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

      <OtpVerificationModal
        open={otpModalKind !== null}
        onOpenChange={(open) => {
          if (!open) setOtpModalKind(null)
        }}
        email={otpModalKind === 'profile' ? normalizedProfileEmail : accountEmail}
        onVerify={(otp) =>
          otpModalKind
            ? verifyOtp(otpModalKind === 'profile' ? normalizedProfileEmail : accountEmail, otpModalKind, otp)
            : Promise.resolve(false)
        }
        onResendCode={() =>
          otpModalKind
            ? requestOtp(otpModalKind === 'profile' ? normalizedProfileEmail : accountEmail, otpModalKind)
            : Promise.resolve(false)
        }
      />
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

