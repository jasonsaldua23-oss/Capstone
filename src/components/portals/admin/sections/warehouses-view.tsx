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

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function WarehousesView() {
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [warehouseStaffUsers, setWarehouseStaffUsers] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAutofillingLocation, setIsAutofillingLocation] = useState(false)
  const [isMapPickerOpen, setIsMapPickerOpen] = useState(false)
  const [mapPickerLatitude, setMapPickerLatitude] = useState<number | null>(null)
  const [mapPickerLongitude, setMapPickerLongitude] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [selectedWarehouse, setSelectedWarehouse] = useState<any | null>(null)
  const [warehouseInventoryItems, setWarehouseInventoryItems] = useState<any[]>([])
  const [insightStockBatches, setInsightStockBatches] = useState<any[]>([])
  const [form, setForm] = useState({
    name: '',
    code: '',
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

  const fetchWarehouses = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/warehouses?page=1&pageSize=100')
      if (response.ok) {
        const data = await response.json()
        setWarehouses(getCollection<any>(data, ['warehouses']))
      }
    } catch (error) {
      console.error('Failed to fetch warehouses:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchWarehouses()
    fetchWarehouseStaffUsers()
  }, [])

  const fetchWarehouseStaffUsers = async () => {
    try {
      const usersResponse = await fetch('/api/users?page=1&pageSize=500')

      if (!usersResponse.ok) {
        throw new Error('Failed to fetch warehouse staff users')
      }

      const usersPayload = await usersResponse.json()
      const users = toArray<any>(usersPayload?.data ?? usersPayload?.users ?? usersPayload)

      const scopedUsers = users.filter((entry) => {
        if (entry?.isActive === false) return false

        const userRole = String(entry?.role || entry?.roleId || '').toUpperCase()

        // Check for WAREHOUSE_STAFF role
        return userRole === 'WAREHOUSE_STAFF' || userRole.includes('WAREHOUSE')
      })

      setWarehouseStaffUsers(scopedUsers)
    } catch (error) {
      console.error('Failed to fetch warehouse staff users:', error)
    }
  }

  const resetForm = () => {
    setForm({
      name: '',
      code: '',
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
    setSelectedWarehouse(null)
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
    if (!form.name.trim() || !form.code.trim() || !form.address.trim() || !form.city.trim() || !form.province.trim() || !form.zipCode.trim()) {
      toast.error('Name, code, address, city, province and zip code are required')
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
      const endpoint = mode === 'create' ? '/api/warehouses' : `/api/warehouses/${selectedWarehouse.id}`
      const method = mode === 'create' ? 'POST' : 'PUT'
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          address: form.address.trim(),
          city: form.city.trim(),
          province: form.province.trim(),
          zipCode: form.zipCode.trim(),
          country: form.country.trim() || 'Philippines',
          latitude: latitudeValue,
          longitude: longitudeValue,
          capacity: form.capacity ? Number(form.capacity) : 1000,
          managerId: form.managerId || null,
          isActive: form.isActive,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to save warehouse')
      }
      toast.success(mode === 'create' ? 'Warehouse added' : 'Warehouse updated')
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

  const openInsights = async (warehouse: any) => {
    try {
      const [warehouseResponse, stockBatchesResponse] = await Promise.all([
        fetch(`/api/warehouses/${warehouse.id}`),
        fetch('/api/stock-batches?page=1&pageSize=500'),
      ])

      const warehousePayload = await warehouseResponse.json().catch(() => ({}))
      if (!warehouseResponse.ok || warehousePayload?.success === false) {
        throw new Error(warehousePayload?.error || 'Failed to load warehouse insights')
      }

      const warehouseData = warehousePayload?.data || warehouse
      const stockPayload = await stockBatchesResponse.json().catch(() => ({}))
      const allStockBatches = stockBatchesResponse.ok ? getCollection<any>(stockPayload, ['stockBatches']) : []
      const filteredBatches = allStockBatches.filter((batch: any) => {
        const batchWarehouseName = String(batch?.inventory?.warehouse?.name || '').toLowerCase()
        const batchWarehouseCode = String(batch?.inventory?.warehouse?.code || '').toLowerCase()
        const name = String(warehouseData?.name || warehouse?.name || '').toLowerCase()
        const code = String(warehouseData?.code || warehouse?.code || '').toLowerCase()
        return batchWarehouseName === name || batchWarehouseCode === code
      })

      setSelectedWarehouse(warehouseData)
      setWarehouseInventoryItems(toArray<any>(warehouseData?.inventory ?? []))
      setInsightStockBatches(filteredBatches)
      setInsightsOpen(true)
    } catch (error: any) {
      console.warn('Failed to load warehouse insights:', error)
    }
  }

  const totalCapacity = Number(selectedWarehouse?.capacity || 0)
  const estimatedUsage = warehouseInventoryItems.reduce((sum, item) => sum + Number(item?.quantity || 0), 0)
  const usagePercent = totalCapacity > 0 ? Math.min(100, Math.round((estimatedUsage / totalCapacity) * 100)) : 0
  const freeCapacity = Math.max(0, totalCapacity - estimatedUsage)
  const stockKeepingUnits = warehouseInventoryItems.length
  const lowStockItems = warehouseInventoryItems.filter((item) => Number(item?.quantity || 0) <= Number(item?.minStock || 0)).length
  const warehouseActivities = [
    {
      id: 'capacity',
      label: 'Capacity update',
      detail: `${estimatedUsage.toLocaleString()} units stored out of ${totalCapacity.toLocaleString()}`,
    },
    {
      id: 'stock-health',
      label: 'Stock health',
      detail: lowStockItems > 0 ? `${lowStockItems} SKU(s) below threshold` : 'All inventory is above threshold',
    },
    {
      id: 'staffing',
      label: 'Assigned staff',
      detail: getAssignedStaffName(selectedWarehouse?.managerId),
    },
  ]
  const utilizationStatus = usagePercent >= 90 ? 'Critical' : usagePercent >= 75 ? 'High' : usagePercent >= 55 ? 'Moderate' : 'Healthy'
  const usageTrend = Array.from({ length: 7 }).map((_, index) => {
    const pointDate = new Date()
    pointDate.setHours(0, 0, 0, 0)
    pointDate.setDate(pointDate.getDate() - (6 - index))

    const endOfDay = new Date(pointDate)
    endOfDay.setHours(23, 59, 59, 999)

    const additionsAfterDay = insightStockBatches
      .filter((entry: any) => {
        const receiptDate = new Date(entry?.receiptDate || entry?.createdAt || 0)
        return !Number.isNaN(receiptDate.getTime()) && receiptDate.getTime() > endOfDay.getTime()
      })
      .reduce((sum: number, entry: any) => sum + Math.max(0, Number(entry?.quantity || 0)), 0)

    const estimatedUsedAtDay = Math.max(0, estimatedUsage - additionsAfterDay)
    const dayUtilization = totalCapacity > 0
      ? Math.min(100, Number(((estimatedUsedAtDay / totalCapacity) * 100).toFixed(1)))
      : 0

    return {
      day: pointDate.toLocaleDateString('en-US', { weekday: 'short' }),
      utilization: dayUtilization,
    }
  })
  const capacityBreakdown = [
    { name: 'Used', value: Math.max(0, estimatedUsage), color: '#3b82f6' },
    { name: 'Free', value: Math.max(0, freeCapacity), color: '#34d399' },
  ]
  const recentActivities = [
    {
      id: 'a1',
      title: 'Capacity snapshot updated',
      detail: `${estimatedUsage.toLocaleString()} of ${totalCapacity.toLocaleString()} units occupied`,
      time: '2 mins ago',
    },
    {
      id: 'a2',
      title: lowStockItems > 0 ? 'Low stock alert detected' : 'Stock levels stable',
      detail: lowStockItems > 0
        ? `${lowStockItems} SKU(s) are at or below threshold`
        : 'No SKU is currently below minimum stock',
      time: '14 mins ago',
    },
    {
      id: 'a3',
      title: 'Inventory coverage',
      detail: `${stockKeepingUnits} SKU(s) tracked in this warehouse`,
      time: '33 mins ago',
    },
    {
      id: 'a4',
      title: 'Warehouse staffing',
      detail: `Assigned staff: ${getAssignedStaffName(selectedWarehouse?.managerId)}`,
      time: '1 hr ago',
    },
  ]
  const skuVelocityData = warehouseInventoryItems
    .map((item: any, index: number) => {
      const qty = Number(item?.quantity || 0)
      const reserved = Number(item?.reservedQuantity || 0)
      const minStock = Number(item?.minStock || 0)
      const available = Math.max(0, qty - reserved)
      const pressure = Math.max(0, minStock - available)
      const velocity = reserved + pressure
      return {
        id: item?.id || `${item?.product?.sku || 'sku'}-${index}`,
        name: item?.product?.name || item?.product?.sku || 'Item',
        sku: item?.product?.sku || 'N/A',
        velocity,
      }
    })
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 10)

  const stockHealthCounts = warehouseInventoryItems.reduce(
    (acc: { healthy: number; low: number; critical: number; overstocked: number }, item: any) => {
      const qty = Number(item?.quantity || 0)
      const reserved = Number(item?.reservedQuantity || 0)
      const minStock = Math.max(0, Number(item?.minStock || 0))
      const maxStock = Math.max(0, Number(item?.maxStock || 0))
      const available = Math.max(0, qty - reserved)

      if (available <= minStock) acc.critical += 1
      else if (available <= Math.ceil(minStock * 1.2)) acc.low += 1
      else if (maxStock > 0 && available >= Math.floor(maxStock * 0.9)) acc.overstocked += 1
      else acc.healthy += 1

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

  const getStockHealthDotClass = (name: string) => {
    const key = name.toLowerCase()
    if (key === 'healthy') return 'bg-emerald-500'
    if (key === 'low') return 'bg-amber-500'
    if (key === 'critical') return 'bg-red-500'
    if (key === 'overstocked') return 'bg-blue-500'
    return 'bg-gray-400'
  }
  const totalWarehouses = warehouses.length
  const totalWarehouseCapacity = warehouses.reduce((sum, warehouse: any) => sum + Number(warehouse?.capacity || 0), 0)
  const avgEfficiency = totalWarehouses > 0
    ? Math.round((warehouses.filter((warehouse: any) => warehouse?.isActive !== false).length / totalWarehouses) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Warehouses</h1>
          <p className="text-gray-500">Manage storage facilities and locations</p>
        </div>
        <Button className="gap-2" onClick={() => setAddOpen(true)}>
          {/* Warehouse icon removed */}
          Add Warehouse
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-blue-50 p-1.5">
                <Building2 className="h-3.5 w-3.5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Warehouses</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{totalWarehouses}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-emerald-50 p-1.5">
                <Database className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Capacity</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{totalWarehouseCapacity.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-violet-50 p-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-violet-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Avg Efficiency</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{avgEfficiency}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full flex items-center justify-center h-64">
            {/* Loader2 icon removed */}
          </div>
        ) : warehouses.length === 0 ? (
          <div className="col-span-full text-center py-12">
            {/* Warehouse icon removed */}
            <p className="text-gray-500">No warehouses found</p>
            <Button className="mt-4">Add First Warehouse</Button>
          </div>
        ) : (
          warehouses.map((warehouse: any) => (
            <Card key={warehouse.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{warehouse.name}</h3>
                    <p className="text-sm text-gray-500">{warehouse.code}</p>
                  </div>
                  <Badge variant={warehouse.isActive ? 'default' : 'secondary'}>
                    {warehouse.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="mt-4 text-sm">
                  <p className="text-gray-600">{warehouse.address}</p>
                  <p className="text-gray-500">{warehouse.city}, {warehouse.province} {warehouse.zipCode}</p>
                  <p className="text-gray-500">Assigned Staff: {getAssignedStaffName(warehouse.managerId)}</p>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openManage(warehouse)}>Edit</Button>
                  <Button variant="outline" size="sm" onClick={() => openInsights(warehouse)}>Insights</Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetForm() }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Warehouse</DialogTitle>
            <DialogDescription>Create a new storage facility.</DialogDescription>
          </DialogHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Name</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Code</label>
              <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
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
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">City</label>
              <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Province</label>
              <Input value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Zip Code</label>
              <Input value={form.zipCode} onChange={(e) => setForm((f) => ({ ...f, zipCode: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Capacity</label>
              <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Latitude</label>
              <Input value={form.latitude} onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))} placeholder="e.g. 10.315699" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Longitude</label>
              <Input value={form.longitude} onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))} placeholder="e.g. 123.885437" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Assign Warehouse Staff</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.managerId}
                onChange={(e) => setForm((f) => ({ ...f, managerId: e.target.value }))}
                title="Assign Warehouse Staff"
              >
                <option value="">Unassigned</option>
                {warehouseStaffUsers.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveWarehouse('create')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Warehouse
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manageOpen} onOpenChange={(open) => !open && setManageOpen(false)}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Warehouse</DialogTitle>
            <DialogDescription>Update warehouse details and status.</DialogDescription>
          </DialogHeader>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Name</label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse Code</label>
              <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
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
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">City</label>
              <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Province</label>
              <Input value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Zip Code</label>
              <Input value={form.zipCode} onChange={(e) => setForm((f) => ({ ...f, zipCode: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Capacity</label>
              <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Latitude</label>
              <Input value={form.latitude} onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))} placeholder="e.g. 10.315699" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Longitude</label>
              <Input value={form.longitude} onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))} placeholder="e.g. 123.885437" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Assign Warehouse Staff</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.managerId}
                onChange={(e) => setForm((f) => ({ ...f, managerId: e.target.value }))}
                title="Assign Warehouse Staff"
              >
                <option value="">Unassigned</option>
                {warehouseStaffUsers.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Warehouse Status</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Warehouse Status" value={form.isActive ? 'ACTIVE' : 'INACTIVE'} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value === 'ACTIVE' }))}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setManageOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveWarehouse('edit')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
                className="flex-1"
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

      <Dialog open={insightsOpen} onOpenChange={setInsightsOpen}>
        <DialogContent className="w-[99vw] max-w-[1700px] sm:max-w-[1700px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedWarehouse?.name || 'Warehouse'} Insights</DialogTitle>
            <DialogDescription>Capacity utilization, warehouse health, and recent happenings.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Capacity Utilization</CardTitle>
                  <Badge className={usagePercent >= 90 ? 'bg-red-100 text-red-800 hover:bg-red-100' : usagePercent >= 70 ? 'bg-amber-100 text-amber-800 hover:bg-amber-100' : 'bg-green-100 text-green-800 hover:bg-green-100'}>
                    {utilizationStatus}
                  </Badge>
                </div>
                <CardDescription>
                  {estimatedUsage.toLocaleString()} / {totalCapacity.toLocaleString()} units used
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
                          data={capacityBreakdown}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={68}
                          outerRadius={100}
                          paddingAngle={2}
                          strokeWidth={3}
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
                      <p className="text-lg font-semibold text-blue-700">{usagePercent}%</p>
                    </div>
                    <div className="rounded-xl border bg-white p-3 shadow-sm h-fit self-start">
                      <p className="text-gray-500">Free Capacity</p>
                      <p className="text-lg font-semibold text-green-700">{freeCapacity.toLocaleString()}</p>
                    </div>
                    <div className="rounded-xl border bg-white p-3 shadow-sm h-fit self-start">
                      <p className="text-gray-500">Max Capacity</p>
                      <p className="text-lg font-semibold">{totalCapacity.toLocaleString()}</p>
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
                    <LineChart data={usageTrend} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
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
                    {recentActivities.map((activity) => (
                      <div key={activity.id} className="rounded-lg border bg-gradient-to-br from-white to-gray-50 px-3 py-3 shadow-sm">
                        <p className="text-sm font-medium text-gray-900">{activity.title}</p>
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
                  {skuVelocityData.length === 0 ? (
                    <p className="text-sm text-gray-500">No SKU velocity data available.</p>
                  ) : (
                    <ChartContainer
                      config={{ velocity: { label: 'Velocity', color: '#2563eb' } }}
                      className="h-[320px] w-full"
                    >
                      <BarChart data={skuVelocityData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="sku" axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={65} />
                        <YAxis axisLine={false} tickLine={false} width={34} />
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
                        data={stockHealthDistribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={92}
                        paddingAngle={2}
                      >
                        {stockHealthDistribution.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: any, name: any) => [Number(value).toLocaleString(), name]} />
                    </PieChart>
                  </ChartContainer>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {stockHealthDistribution.map((entry) => (
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
                  {warehouseActivities.map((activity) => (
                    <div key={activity.id} className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-700">
                      <p className="text-sm font-medium text-gray-900">{activity.label}</p>
                      <p className="text-sm text-gray-600">{activity.detail}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Button variant="outline" onClick={() => setInsightsOpen(false)}>Close</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
