'use client'

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { useAuth } from '@/app/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PortalCardsSkeleton } from '@/components/portals/shared/loading-skeletons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, Clock, CheckCircle, XCircle, MapPin, TrendingUp, UserCheck, MessageSquare, AlertTriangle, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, Database, FileText, Users, Star, Download, Pencil, Trash2 } from 'lucide-react'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, LineChart, Line, Tooltip, PieChart, Pie, Cell, Label, BarChart, Bar, ResponsiveContainer, Legend } from 'recharts'
import {
  toArray,
  getCollection,
  getDefaultRouteDate,
  normalizeTripStatus,
  formatPeso,
  formatDayKey,
  toIsoDateTime,
  formatDateTime,
  formatDayLabel,
  withinRange,
  getWarehouseIdFromRow,
  formatRoleLabel,
  safeFetchJson,
} from './shared'
import {
  buildSkuVelocityData,
  buildUtilizationTrend,
  buildWarehouseCapacitySummary,
  summarizeStockHealth,
} from '@/lib/report-metrics'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

function parseWarehouseCodeSequence(code: string): number {
  const match = /^WH-(\d+)$/i.exec(String(code || '').trim())
  if (!match) return 0
  return Number(match[1] || 0)
}

function formatWarehouseCodeSequence(sequence: number): string {
  return `WH-${String(Math.max(1, sequence)).padStart(4, '0')}`
}

export function WarehousesView({ onWarehouseChanged }: { onWarehouseChanged?: (ready: boolean) => void } = {}) {
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [warehouseStaffUsers, setWarehouseStaffUsers] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingInsights, setIsLoadingInsights] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAutofillingLocation, setIsAutofillingLocation] = useState(false)
  const [isMapPickerOpen, setIsMapPickerOpen] = useState(false)
  const [mapPickerLatitude, setMapPickerLatitude] = useState<number | null>(null)
  const [mapPickerLongitude, setMapPickerLongitude] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [selectedWarehouse, setSelectedWarehouse] = useState<any | null>(null)
  const [warehouseInventoryItems, setWarehouseInventoryItems] = useState<any[]>([])
  const [insightStockBatches, setInsightStockBatches] = useState<any[]>([])
  const [insightInventoryTransactions, setInsightInventoryTransactions] = useState<any[]>([])

  const getNextWarehouseCode = () => {
    const maxSequence = warehouses.reduce((max, warehouse) => {
      const sequence = parseWarehouseCodeSequence(String(warehouse?.code || ''))
      return sequence > max ? sequence : max
    }, 0)
    return formatWarehouseCodeSequence(maxSequence + 1)
  }

  const [form, setForm] = useState({
    name: '',
    code: 'WH-0001',
    address: '',
    city: '',
    province: '',
    zipCode: '',
    country: 'Philippines',
    latitude: '',
    longitude: '',
    capacity: '',
    managerId: '',
    isActive: true,
  })

  const loadWarehouseInsights = async (warehouse: any) => {
    if (!warehouse?.id) return
    setIsLoadingInsights(true)
    try {
      const [warehouseResponse, inventoryResponse, stockBatchesResponse, inventoryTransactionsResponse] = await Promise.all([
        fetch(`/api/warehouses/${warehouse.id}`),
        fetch('/api/inventory?limit=1000'),
        fetch('/api/stock-batches?page=1&pageSize=500'),
        fetch('/api/inventory-transactions?limit=1000'),
      ])

      const warehousePayload = await warehouseResponse.json().catch(() => ({}))
      if (!warehouseResponse.ok || warehousePayload?.success === false) {
        throw new Error(warehousePayload?.error || 'Failed to load warehouse insights')
      }

      const warehouseData = warehousePayload?.data || warehousePayload?.warehouse || warehouse
      const inventoryPayload = await inventoryResponse.json().catch(() => ({}))
      const allInventory = inventoryResponse.ok
        ? getCollection<any>(inventoryPayload, ['inventory'])
        : []
      const filteredInventory = allInventory.filter((item: any) => {
        const itemWarehouseId = String(item?.warehouse?.id || item?.warehouseId || item?.warehouse_id || '').trim()
        const itemWarehouseName = String(item?.warehouse?.name || '').toLowerCase()
        const itemWarehouseCode = String(item?.warehouse?.code || '').toLowerCase()
        const warehouseId = String(warehouseData?.id || warehouse?.id || '').trim()
        const warehouseName = String(warehouseData?.name || warehouse?.name || '').toLowerCase()
        const warehouseCode = String(warehouseData?.code || warehouse?.code || '').toLowerCase()
        return (
          (!itemWarehouseId && !itemWarehouseName) ||
          (warehouseId && itemWarehouseId === warehouseId) ||
          (warehouseName && itemWarehouseName === warehouseName) ||
          (warehouseCode && itemWarehouseCode === warehouseCode)
        )
      })

      const stockPayload = await stockBatchesResponse.json().catch(() => ({}))
      const allStockBatches = stockBatchesResponse.ok ? getCollection<any>(stockPayload, ['stockBatches', 'batches']) : []
      const filteredBatches = allStockBatches.filter((batch: any) => {
        const batchWarehouseId = String(batch?.inventory?.warehouse?.id || batch?.warehouseId || '').trim()
        const batchWarehouseName = String(batch?.inventory?.warehouse?.name || '').toLowerCase()
        const batchWarehouseCode = String(batch?.inventory?.warehouse?.code || '').toLowerCase()
        const warehouseId = String(warehouseData?.id || warehouse?.id || '').trim()
        const warehouseName = String(warehouseData?.name || warehouse?.name || '').toLowerCase()
        const warehouseCode = String(warehouseData?.code || warehouse?.code || '').toLowerCase()
        return (
          (!batchWarehouseId && !batchWarehouseName) ||
          (warehouseId && batchWarehouseId === warehouseId) ||
          (warehouseName && batchWarehouseName === warehouseName) ||
          (warehouseCode && batchWarehouseCode === warehouseCode)
        )
      })

      const transactionsPayload = await inventoryTransactionsResponse.json().catch(() => ({}))
      const allInventoryTransactions = inventoryTransactionsResponse.ok
        ? getCollection<any>(transactionsPayload, ['transactions'])
        : []
      const filteredTransactions = allInventoryTransactions.filter((entry: any) => {
        const entryWarehouseId = String(entry?.warehouse?.id || '').trim()
        const entryWarehouseName = String(entry?.warehouse?.name || '').toLowerCase()
        const entryWarehouseCode = String(entry?.warehouse?.code || '').toLowerCase()
        const warehouseId = String(warehouseData?.id || warehouse?.id || '').trim()
        const warehouseName = String(warehouseData?.name || warehouse?.name || '').toLowerCase()
        const warehouseCode = String(warehouseData?.code || warehouse?.code || '').toLowerCase()
        return (
          (!entryWarehouseId && !entryWarehouseName) ||
          (warehouseId && entryWarehouseId === warehouseId) ||
          (warehouseName && entryWarehouseName === warehouseName) ||
          (warehouseCode && entryWarehouseCode === warehouseCode)
        )
      })

      setSelectedWarehouse(warehouseData)
      setWarehouseInventoryItems(filteredInventory.length > 0 ? filteredInventory : allInventory)
      setInsightStockBatches(filteredBatches.length > 0 ? filteredBatches : allStockBatches)
      setInsightInventoryTransactions(filteredTransactions.length > 0 ? filteredTransactions : allInventoryTransactions)
    } catch (error: any) {
      console.warn('Failed to load warehouse insights:', error)
    } finally {
      setIsLoadingInsights(false)
    }
  }

  const fetchWarehouses = async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      const response = await fetch('/api/warehouses?page=1&pageSize=100')
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to load warehouse profile')
      }
      const rows = getCollection<any>(data, ['warehouses'])
      setWarehouses(rows)
      onWarehouseChanged?.(rows.length === 1)

      if (rows.length > 0) {
        const target = selectedWarehouse
          ? (rows.find((w: any) => w.id === selectedWarehouse.id) || rows[0])
          : rows[0]
        void loadWarehouseInsights(target)
      } else {
        setSelectedWarehouse(null)
        setWarehouseInventoryItems([])
        setInsightStockBatches([])
        setInsightInventoryTransactions([])
      }
    } catch (error) {
      console.error('Failed to fetch warehouses:', error)
      setLoadError(error instanceof Error ? error.message : 'Failed to load warehouse profile')
    } finally {
      setIsLoading(false)
    }
  }

  const fetchWarehouseStaffUsers = async () => {
    try {
      const usersResponse = await fetch('/api/users?page=1&pageSize=500')
      if (!usersResponse.ok) return
      const usersPayload = await usersResponse.json()
      const users = toArray<any>(usersPayload?.data ?? usersPayload?.users ?? usersPayload)
      const scopedUsers = users.filter((entry) => {
        if (entry?.isActive === false) return false
        const userRole = String(entry?.role || entry?.roleId || '').toUpperCase()
        return userRole === 'WAREHOUSE_STAFF' || userRole.includes('WAREHOUSE')
      })
      setWarehouseStaffUsers(scopedUsers)
    } catch (error) {
      console.error('Failed to fetch warehouse staff users:', error)
    }
  }

  useEffect(() => {
    fetchWarehouses()
    fetchWarehouseStaffUsers()
  }, [])

  const resetForm = () => {
    const nextCode = getNextWarehouseCode()
    setForm({
      name: '',
      code: nextCode,
      address: '',
      city: '',
      province: '',
      zipCode: '',
      country: 'Philippines',
      latitude: '',
      longitude: '',
      capacity: '',
      managerId: '',
      isActive: true,
    })
  }

  const applyLocationAutofill = (payload: {
    latitude?: number
    longitude?: number
    city?: string
    province?: string
    zipCode?: string
    country?: string
    address?: string
  }) => {
    setForm((prev) => ({
      ...prev,
      latitude:
        typeof payload.latitude === 'number' && Number.isFinite(payload.latitude)
          ? payload.latitude.toFixed(6)
          : prev.latitude,
      longitude:
        typeof payload.longitude === 'number' && Number.isFinite(payload.longitude)
          ? payload.longitude.toFixed(6)
          : prev.longitude,
      city: payload.city || prev.city,
      province: payload.province || prev.province,
      zipCode: payload.zipCode || prev.zipCode,
      country: payload.country || prev.country,
      address: payload.address || prev.address,
    }))
  }

  const autofillFromNominatimResult = (result: any, fallbackAddress?: string) => {
    const address = result?.address || {}
    const city = String(address.city || address.town || address.village || address.municipality || '').trim()
    const province = String(address.state || address.region || address.county || '').trim()
    const zipCode = String(address.postcode || '').trim()
    const country = String(address.country || '').trim()
    const latitude = Number(result?.lat)
    const longitude = Number(result?.lon)
    const fullAddress = String(result?.display_name || '').trim()

    applyLocationAutofill({
      latitude,
      longitude,
      city,
      province,
      zipCode,
      country,
      address: fallbackAddress || fullAddress,
    })
  }

  const openMapPicker = () => {
    const latitudeValue = form.latitude.trim() ? Number(form.latitude) : null
    const longitudeValue = form.longitude.trim() ? Number(form.longitude) : null
    setMapPickerLatitude(typeof latitudeValue === 'number' && Number.isFinite(latitudeValue) ? latitudeValue : null)
    setMapPickerLongitude(typeof longitudeValue === 'number' && Number.isFinite(longitudeValue) ? longitudeValue : null)
    setIsMapPickerOpen(true)
  }

  const pickCurrentLocationInMap = async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported on this browser')
      return
    }

    setIsAutofillingLocation(true)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        })
      })

      setMapPickerLatitude(position.coords.latitude)
      setMapPickerLongitude(position.coords.longitude)
      toast.success('Current location selected on map')
    } catch {
      toast.error('Unable to access current location')
    } finally {
      setIsAutofillingLocation(false)
    }
  }

  const applyPinnedLocationFromMap = async () => {
    if (typeof mapPickerLatitude !== 'number' || typeof mapPickerLongitude !== 'number') {
      toast.error('Pin a location on the map first')
      return
    }

    setIsAutofillingLocation(true)
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(mapPickerLatitude))}&lon=${encodeURIComponent(String(mapPickerLongitude))}&addressdetails=1`
      )
      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error('Failed to reverse-geocode selected location')
      }

      autofillFromNominatimResult(result)
      setIsMapPickerOpen(false)
      toast.success('Pinned location saved and address auto-filled')
    } catch {
      applyLocationAutofill({ latitude: mapPickerLatitude, longitude: mapPickerLongitude })
      setIsMapPickerOpen(false)
      toast.success('Pinned location saved')
    } finally {
      setIsAutofillingLocation(false)
    }
  }

  const saveWarehouse = async (mode: 'create' | 'edit') => {
    if (!form.latitude.trim() || !form.longitude.trim()) {
      toast.error('Pin the warehouse location on the map first')
      return
    }
    if (!form.name.trim() || !form.address.trim() || !form.city.trim() || !form.province.trim() || !form.zipCode.trim()) {
      toast.error('Name, address, city, province and zip code are required')
      return
    }
    if (!form.capacity.trim()) {
      toast.error('Capacity is required')
      return
    }
    const capacityValue = Number(form.capacity)
    if (!Number.isFinite(capacityValue) || capacityValue <= 0) {
      toast.error('Capacity must be a valid number greater than 0')
      return
    }

    const latitudeValue = form.latitude.trim() ? Number(form.latitude) : null
    const longitudeValue = form.longitude.trim() ? Number(form.longitude) : null
    if (form.latitude.trim() && !Number.isFinite(latitudeValue)) {
      toast.error('Latitude is invalid')
      return
    }
    if (form.longitude.trim() && !Number.isFinite(longitudeValue)) {
      toast.error('Longitude is invalid')
      return
    }

    setIsSubmitting(true)
    try {
      const endpoint = mode === 'create' ? '/api/warehouses' : `/api/warehouses/${selectedWarehouse?.id || warehouses[0]?.id}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const finalCode =
        mode === 'create'
          ? getNextWarehouseCode()
          : (form.code || selectedWarehouse?.code || warehouses[0]?.code || '').trim().toUpperCase()
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          code: finalCode,
          address: form.address.trim(),
          city: form.city.trim(),
          province: form.province.trim(),
          zipCode: form.zipCode.trim(),
          country: form.country.trim() || 'Philippines',
          latitude: latitudeValue,
          longitude: longitudeValue,
          capacity: capacityValue,
          // Fix: persist the staff selected while creating or editing a warehouse.
          managerId: form.managerId || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to save warehouse')
      }
      toast.success(mode === 'create' ? 'Warehouse registered' : 'Warehouse profile updated')
      setAddOpen(false)
      setManageOpen(false)
      resetForm()
      await fetchWarehouses()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save warehouse')
    } finally {
      setIsSubmitting(false)
    }
  }

  const openManage = (warehouse: any) => {
    setSelectedWarehouse(warehouse)
    setForm({
      name: warehouse.name || '',
      code: warehouse.code || '',
      address: warehouse.address || '',
      city: warehouse.city || '',
      province: warehouse.province || '',
      zipCode: warehouse.zipCode || '',
      country: warehouse.country || 'Philippines',
      latitude: typeof warehouse.latitude === 'number' ? String(warehouse.latitude) : '',
      longitude: typeof warehouse.longitude === 'number' ? String(warehouse.longitude) : '',
      capacity: warehouse.capacity ? String(warehouse.capacity) : '',
      managerId: warehouse.managerId || '',
      isActive: !!warehouse.isActive,
    })
    setManageOpen(true)
  }

  const getAssignedStaffName = (managerId?: string | null) => {
    if (!managerId) return 'Unassigned'
    const staff = warehouseStaffUsers.find((entry) => entry.id === managerId)
    return staff?.name || 'Assigned'
  }

  const activeWarehouse = selectedWarehouse || warehouses[0] || null

  const capacitySummary = buildWarehouseCapacitySummary(activeWarehouse, warehouseInventoryItems)
  const stockHealthSummary = summarizeStockHealth(warehouseInventoryItems)
  const totalCapacity = capacitySummary.totalCapacity
  const estimatedUsage = capacitySummary.usedUnits
  const usagePercent = capacitySummary.usagePercent
  const freeCapacity = capacitySummary.availableCapacity
  const stockKeepingUnits = warehouseInventoryItems.length
  const lowStockItems = stockHealthSummary.belowThreshold
  const utilizationStatus = capacitySummary.utilizationStatus

  const warehouseActivities = [
    {
      id: 'capacity',
      label: 'Capacity Status',
      detail: `${estimatedUsage.toLocaleString()} units stored out of ${totalCapacity.toLocaleString()} max capacity (${usagePercent}%)`,
    },
    {
      id: 'stock-health',
      label: 'Stock Health Alert',
      detail: lowStockItems > 0 ? `${lowStockItems} SKU(s) currently at or below minimum threshold` : 'All inventory stock levels are healthy & above threshold',
    },
    {
      id: 'staffing',
      label: 'Staff Assignment',
      detail: `Facility manager: ${getAssignedStaffName(activeWarehouse?.managerId)}`,
    },
  ]

  const usageTrend = buildUtilizationTrend(
    estimatedUsage,
    totalCapacity,
    insightStockBatches,
    insightInventoryTransactions,
  )
  const capacityBreakdown = capacitySummary.capacityBreakdown

  const recentActivities = [
    {
      id: 'a1',
      title: 'Capacity snapshot synchronized',
      detail: `${estimatedUsage.toLocaleString()} of ${totalCapacity.toLocaleString()} units occupied`,
      time: '2 mins ago',
    },
    {
      id: 'a2',
      title: lowStockItems > 0 ? 'Low stock threshold alert' : 'Stock levels optimal',
      detail: lowStockItems > 0
        ? `${lowStockItems} SKU(s) require replenishment attention`
        : 'No SKU is currently below minimum safety stock',
      time: '14 mins ago',
    },
    {
      id: 'a3',
      title: 'Active inventory catalog',
      detail: `${stockKeepingUnits} SKU item(s) tracked in this facility`,
      time: '33 mins ago',
    },
    {
      id: 'a4',
      title: 'Warehouse operations active',
      detail: `Assigned manager: ${getAssignedStaffName(activeWarehouse?.managerId)}`,
      time: '1 hr ago',
    },
  ]

  const skuVelocityData = buildSkuVelocityData(warehouseInventoryItems)

  const stockHealthDistribution = [
    { name: 'Healthy', value: stockHealthSummary.healthy, color: '#10b981' },
    { name: 'Low', value: stockHealthSummary.low, color: '#f59e0b' },
    { name: 'Critical', value: stockHealthSummary.critical + stockHealthSummary.outOfStock, color: '#ef4444' },
    { name: 'Overstocked', value: stockHealthSummary.overstocked, color: '#3b82f6' },
  ]

  const getStockHealthDotClass = (name: string) => {
    const key = name.toLowerCase()
    if (key === 'healthy') return 'bg-emerald-500'
    if (key === 'low') return 'bg-amber-500'
    if (key === 'critical') return 'bg-rose-500'
    if (key === 'overstocked') return 'bg-blue-500'
    return 'bg-slate-400'
  }

  const totalWarehouses = warehouses.length
  const totalWarehouseCapacity = warehouses.reduce((sum, warehouse: any) => sum + Number(warehouse?.capacity || 0), 0)
  const avgEfficiency = totalWarehouses > 0
    ? Math.round((warehouses.filter((warehouse: any) => warehouse?.isActive !== false).length / totalWarehouses) * 100)
    : 0

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {totalWarehouses === 0 ? 'Warehouse Setup' : 'Warehouse'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalWarehouses === 0
              ? 'Register the warehouse facility before using operational modules'
              : 'Facility details, live capacity utilization, stock health, and operational metrics'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalWarehouses === 0 && !loadError ? (
            <Button
              className="gap-2 bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              onClick={() => {
                resetForm()
                setAddOpen(true)
              }}
            >
              <Building2 className="h-4 w-4" />
              Register Warehouse
            </Button>
          ) : activeWarehouse ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9 border-slate-200 text-slate-700 hover:bg-slate-50 font-medium"
              onClick={() => openManage(activeWarehouse)}
            >
              <Pencil className="h-3.5 w-3.5 text-slate-500" />
              Edit Warehouse
            </Button>
          ) : null}
        </div>
      </div>

      {/* High-Level Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl p-2.5 bg-blue-50 text-blue-600 border border-blue-100/80">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Registration</p>
                <p className="text-xl font-bold text-slate-900">{totalWarehouses >= 1 ? 'Complete' : 'Required'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl p-2.5 bg-emerald-50 text-emerald-600 border border-emerald-100/80">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Total Facility Capacity</p>
                <p className="text-xl font-bold text-slate-900">{totalWarehouseCapacity.toLocaleString()} Units</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl p-2.5 bg-violet-50 text-violet-600 border border-violet-100/80">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">Operational Health</p>
                <p className="text-xl font-bold text-slate-900">{avgEfficiency}% Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <PortalCardsSkeleton cards={4} className="lg:grid-cols-2" />
      ) : loadError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-6 text-center text-sm text-rose-700">
          {loadError}
        </div>
      ) : warehouses.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200 bg-slate-50/50">
          <CardContent className="pt-12 pb-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </div>
            <h3 className="mt-3 text-base font-semibold text-slate-900">No warehouse is registered yet</h3>
            <p className="mt-1 text-sm text-slate-500">Create the primary warehouse profile to enable tracking & operational metrics.</p>
            <Button
              className="mt-5 bg-blue-600 text-white hover:bg-blue-700 gap-2 shadow-sm"
              onClick={() => {
                resetForm()
                setAddOpen(true)
              }}
            >
              <Building2 className="h-4 w-4" />
              Register Warehouse
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Primary Warehouse Profile Hero Card */}
          <Card className="border-slate-200/80 shadow-xs overflow-hidden bg-white">
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-100">
                <div className="flex items-start sm:items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
                    <Building2 className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl font-bold text-slate-900">{activeWarehouse.name}</h2>
                      <Badge variant="outline" className="font-mono text-xs font-semibold text-slate-700 bg-slate-50 border-slate-200">
                        {activeWarehouse.code}
                      </Badge>
                      <Badge className={activeWarehouse.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50' : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-50'}>
                        {activeWarehouse.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 text-sm text-slate-500">
                      <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span>{[activeWarehouse.address, activeWarehouse.city, activeWarehouse.province, activeWarehouse.zipCode].filter(Boolean).join(', ')}</span>
                      {activeWarehouse.country && <span className="text-slate-400">({activeWarehouse.country})</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openManage(activeWarehouse)}
                    className="gap-1.5 h-9 font-medium border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    <Pencil className="h-3.5 w-3.5 text-slate-500" />
                    Edit Warehouse
                  </Button>
                </div>
              </div>

              {/* Facility Details Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5">
                <div className="rounded-lg bg-slate-50/80 border border-slate-100 p-3">
                  <p className="text-xs font-medium text-slate-500">Assigned Staff</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Users className="h-3.5 w-3.5 text-slate-400" />
                    <p className="text-sm font-semibold text-slate-800 truncate">{getAssignedStaffName(activeWarehouse.managerId)}</p>
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50/80 border border-slate-100 p-3">
                  <p className="text-xs font-medium text-slate-500">Max Capacity</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Database className="h-3.5 w-3.5 text-slate-400" />
                    <p className="text-sm font-semibold text-slate-800">{Number(activeWarehouse.capacity || 0).toLocaleString()} Units</p>
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50/80 border border-slate-100 p-3">
                  <p className="text-xs font-medium text-slate-500">GPS Location</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                    <p className="text-xs font-mono text-slate-700 truncate">
                      {typeof activeWarehouse.latitude === 'number' && typeof activeWarehouse.longitude === 'number'
                        ? `${Number(activeWarehouse.latitude).toFixed(4)}, ${Number(activeWarehouse.longitude).toFixed(4)}`
                        : activeWarehouse.latitude && activeWarehouse.longitude
                        ? `${Number(activeWarehouse.latitude).toFixed(4)}, ${Number(activeWarehouse.longitude).toFixed(4)}`
                        : 'Not pinned'}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50/80 border border-slate-100 p-3">
                  <p className="text-xs font-medium text-slate-500">Tracked SKUs</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Package className="h-3.5 w-3.5 text-slate-400" />
                    <p className="text-sm font-semibold text-slate-800">{stockKeepingUnits} SKU Types</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Inline Insights & Analytics Section */}
          {isLoadingInsights ? (
            <PortalCardsSkeleton cards={4} className="lg:grid-cols-2" />
          ) : (
            <div className="space-y-6">
              {/* Row 1: Capacity Utilization & 7-Day Trend */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Capacity Utilization Donut Chart */}
                <Card className="lg:col-span-5 border border-slate-200/80 shadow-xs">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold text-slate-900">Capacity Utilization</CardTitle>
                      <Badge className={usagePercent >= 90 ? 'bg-rose-50 text-rose-700 border border-rose-200' : usagePercent >= 70 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}>
                        {utilizationStatus}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs text-slate-500">
                      {estimatedUsage.toLocaleString()} / {totalCapacity.toLocaleString()} units utilized
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-2">
                    <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50/60 via-white to-blue-50/30 p-4">
                      <ChartContainer
                        config={{ used: { label: 'Used', color: '#3b82f6' }, free: { label: 'Free', color: '#34d399' } }}
                        className="h-[220px] w-full"
                      >
                        <PieChart>
                          <Pie
                            data={capacityBreakdown}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={68}
                            outerRadius={95}
                            paddingAngle={2}
                            strokeWidth={2}
                          >
                            {capacityBreakdown.map((entry) => (
                              <Cell key={entry.name} fill={entry.color} />
                            ))}
                            <Label
                              content={({ viewBox }) => {
                                if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) return null
                                const cx = typeof viewBox.cx === 'number' ? viewBox.cx : 0
                                const cy = typeof viewBox.cy === 'number' ? viewBox.cy : 0
                                return (
                                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                                    <tspan x={cx} y={cy - 4} className="fill-slate-900 text-2xl font-bold">
                                      {usagePercent}%
                                    </tspan>
                                    <tspan x={cx} y={cy + 16} className="fill-slate-500 text-xs">
                                      Occupied
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
                    <div className="grid grid-cols-3 gap-2.5 text-center">
                      <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                        <p className="text-xs text-slate-500">Occupied</p>
                        <p className="text-base font-bold text-blue-600">{usagePercent}%</p>
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                        <p className="text-xs text-slate-500">Available</p>
                        <p className="text-base font-bold text-emerald-600">{freeCapacity.toLocaleString()}</p>
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                        <p className="text-xs text-slate-500">Max Limit</p>
                        <p className="text-base font-bold text-slate-800">{totalCapacity.toLocaleString()}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Utilization Trend Line Chart */}
                <Card className="lg:col-span-7 border border-slate-200/80 shadow-xs">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-slate-900">Capacity Trend (Last 7 Days)</CardTitle>
                    <CardDescription className="text-xs text-slate-500">7-day historical warehouse utilization trajectory</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <ChartContainer
                      config={{ utilization: { label: 'Utilization', color: '#2563eb' } }}
                      className="h-[300px] w-full"
                    >
                      <LineChart data={usageTrend} margin={{ left: 4, right: 12, top: 12, bottom: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis axisLine={false} tickLine={false} width={36} domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
                        <Tooltip formatter={(value) => [`${value}%`, 'Utilization']} />
                        <Line type="monotone" dataKey="utilization" stroke="#2563eb" strokeWidth={3} dot={{ r: 4, fill: '#2563eb' }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Row 2: SKU Velocity & Stock Health */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* SKU Velocity */}
                <Card className="lg:col-span-7 border border-slate-200/80 shadow-xs">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-slate-900">SKU Velocity & Movement</CardTitle>
                    <CardDescription className="text-xs text-slate-500">Top 10 fastest-moving items for replenishment planning</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-2">
                    {skuVelocityData.length === 0 ? (
                      <div className="flex h-[300px] items-center justify-center text-sm text-slate-400">
                        No SKU velocity data available.
                      </div>
                    ) : (
                      <ChartContainer
                        config={{ velocity: { label: 'Velocity', color: '#2563eb' } }}
                        className="h-[300px] w-full"
                      >
                        <BarChart data={skuVelocityData} margin={{ left: 4, right: 12, top: 12, bottom: 0 }}>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis dataKey="sku" axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={60} tick={{ fill: '#64748b', fontSize: 11 }} />
                          <YAxis axisLine={false} tickLine={false} width={34} tick={{ fill: '#64748b', fontSize: 12 }} />
                          <Tooltip
                            formatter={(value) => [value, 'Velocity Score']}
                            labelFormatter={(label) => {
                              const item = skuVelocityData.find((row) => row.sku === label)
                              return `${label} - ${item?.name || ''}`
                            }}
                          />
                          <Bar dataKey="velocity" radius={[6, 6, 0, 0]} fill="#2563eb" />
                        </BarChart>
                      </ChartContainer>
                    )}
                  </CardContent>
                </Card>

                {/* Stock Health Distribution */}
                <Card className="lg:col-span-5 border border-slate-200/80 shadow-xs">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-slate-900">Stock Health Distribution</CardTitle>
                    <CardDescription className="text-xs text-slate-500">Healthy, low, critical, and overstocked SKU breakdown</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <ChartContainer
                      config={{
                        healthy: { label: 'Healthy', color: '#10b981' },
                        low: { label: 'Low', color: '#f59e0b' },
                        critical: { label: 'Critical', color: '#ef4444' },
                        overstocked: { label: 'Overstocked', color: '#3b82f6' },
                      }}
                      className="h-[200px] w-full"
                    >
                      <PieChart>
                        <Pie
                          data={stockHealthDistribution}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={54}
                          outerRadius={82}
                          paddingAngle={2}
                        >
                          {stockHealthDistribution.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: any, name: any) => [Number(value).toLocaleString(), name]} />
                      </PieChart>
                    </ChartContainer>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {stockHealthDistribution.map((entry) => (
                        <div key={entry.name} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs">
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${getStockHealthDotClass(entry.name)}`} />
                            <span className="font-medium text-slate-600">{entry.name}</span>
                          </div>
                          <span className="font-bold text-slate-900">{entry.value}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Row 3: Operational Status & Recent Activity */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Operational Signals */}
                <Card className="border border-slate-200/80 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-slate-900">Operational Signals</CardTitle>
                    <CardDescription className="text-xs text-slate-500">Live operational status indicators inside this facility</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2.5">
                      {warehouseActivities.map((activity) => (
                        <div key={activity.id} className="rounded-lg border border-slate-100 bg-slate-50/70 px-4 py-3 text-sm">
                          <p className="font-semibold text-slate-800">{activity.label}</p>
                          <p className="mt-0.5 text-xs text-slate-600">{activity.detail}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Recent Activity */}
                <Card className="border border-slate-200/80 shadow-xs">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-slate-900">Recent Activity</CardTitle>
                    <CardDescription className="text-xs text-slate-500">Latest telemetry updates and status log</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2.5">
                      {recentActivities.map((activity) => (
                        <div key={activity.id} className="rounded-lg border border-slate-100 bg-slate-50/70 px-4 py-3 shadow-xs">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-800">{activity.title}</p>
                            <span className="text-[11px] font-medium text-slate-400 shrink-0">{activity.time}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-600">{activity.detail}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Register Warehouse Dialog */}
      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetForm() }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Register Warehouse</DialogTitle>
            <DialogDescription>Create the warehouse profile required by the system.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Name</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Code</label>
              <Input value={form.code} readOnly disabled />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-gray-700">Address</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => {
                      openMapPicker()
                    }}
                    disabled={isAutofillingLocation || isSubmitting}
                  >
                    <MapPin className="mr-1 h-3.5 w-3.5" />
                    Pin Location
                  </Button>
                </div>
              </div>
              <Input value={form.address} readOnly placeholder="Pin a location on the map to fill the address" />
              <p className="text-xs text-gray-500">Address is auto-filled from the pinned map location.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">City</label>
              <Input value={form.city} readOnly placeholder="Auto-filled from map pin" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Province</label>
              <Input value={form.province} readOnly placeholder="Auto-filled from map pin" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Zip Code</label>
              <Input value={form.zipCode} readOnly placeholder="Auto-filled from map pin" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Capacity (Unit)</label>
              <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Assigned Warehouse Staff</label>
              <select
                aria-label="Assigned warehouse staff"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.managerId}
                onChange={(e) => setForm((f) => ({ ...f, managerId: e.target.value }))}
              >
                <option value="">Unassigned</option>
                {warehouseStaffUsers.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name || staff.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Latitude</label>
              <Input value={form.latitude} readOnly placeholder="Auto-filled from map pin" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Longitude</label>
              <Input value={form.longitude} readOnly placeholder="Auto-filled from map pin" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="flex-1 bg-blue-600 text-white hover:bg-blue-700" onClick={() => saveWarehouse('create')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Warehouse
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Warehouse Dialog */}
      <Dialog open={manageOpen} onOpenChange={(open) => !open && setManageOpen(false)}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Warehouse</DialogTitle>
            <DialogDescription>Update the registered warehouse details.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Name</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Code</label>
              <Input value={form.code} readOnly disabled />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-gray-700">Address</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => {
                      openMapPicker()
                    }}
                    disabled={isAutofillingLocation || isSubmitting}
                  >
                    <MapPin className="mr-1 h-3.5 w-3.5" />
                    Pin Location
                  </Button>
                </div>
              </div>
              <Input value={form.address} readOnly placeholder="Pin a location on the map to fill the address" />
              <p className="text-xs text-gray-500">Address is auto-filled from the pinned map location.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">City</label>
              <Input value={form.city} readOnly placeholder="Auto-filled from map pin" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Province</label>
              <Input value={form.province} readOnly placeholder="Auto-filled from map pin" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Zip Code</label>
              <Input value={form.zipCode} readOnly placeholder="Auto-filled from map pin" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Capacity (Unit)</label>
              <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Assigned Warehouse Staff</label>
              <select
                aria-label="Assigned warehouse staff"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.managerId}
                onChange={(e) => setForm((f) => ({ ...f, managerId: e.target.value }))}
              >
                <option value="">Unassigned</option>
                {warehouseStaffUsers.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name || staff.email}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">Selecting another staff member replaces the current assignment.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Latitude</label>
              <Input value={form.latitude} readOnly placeholder="Auto-filled from map pin" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Longitude</label>
              <Input value={form.longitude} readOnly placeholder="Auto-filled from map pin" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setManageOpen(false)}>Cancel</Button>
            <Button className="flex-1 bg-blue-600 text-white hover:bg-blue-700" onClick={() => saveWarehouse('edit')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Address Map Picker Dialog */}
      <Dialog open={isMapPickerOpen} onOpenChange={setIsMapPickerOpen}>
        <DialogContent className="max-w-3xl w-[95vw]">
          <DialogHeader>
            <DialogTitle>Pin Warehouse Location</DialogTitle>
            <DialogDescription>Click on the map to pin manually, or use your current location.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-600">
                {typeof mapPickerLatitude === 'number' && typeof mapPickerLongitude === 'number'
                  ? `Selected: ${mapPickerLatitude.toFixed(6)}, ${mapPickerLongitude.toFixed(6)}`
                  : 'No location selected yet'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void pickCurrentLocationInMap()
                }}
                disabled={isAutofillingLocation}
              >
                {isAutofillingLocation ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <MapPin className="mr-1 h-3.5 w-3.5" />}
                Use My Location
              </Button>
            </div>
            <AddressMapPicker
              latitude={mapPickerLatitude}
              longitude={mapPickerLongitude}
              onChange={(latitude, longitude) => {
                setMapPickerLatitude(latitude)
                setMapPickerLongitude(longitude)
              }}
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setIsMapPickerOpen(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => {
                  void applyPinnedLocationFromMap()
                }}
                disabled={isAutofillingLocation || typeof mapPickerLatitude !== 'number' || typeof mapPickerLongitude !== 'number'}
              >
                {isAutofillingLocation ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Apply Pin
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
