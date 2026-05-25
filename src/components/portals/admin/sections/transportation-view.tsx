'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { formatPhilippinePhoneInput, isValidPhilippinePhone } from '@/lib/philippine-phone'
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
  deriveOrderFulfillmentSummary,
} from './shared'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function TransportationView() {
  const [activeTab, setActiveTab] = useState<'vehicles' | 'trips' | 'drivers'>('vehicles')
  const [vehicles, setVehicles] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [trips, setTrips] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [addVehicleOpen, setAddVehicleOpen] = useState(false)
  const [addDriverOpen, setAddDriverOpen] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<any | null>(null)
  const [selectedDriver, setSelectedDriver] = useState<any | null>(null)
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null)
  const [selectedDropPointDetail, setSelectedDropPointDetail] = useState<any | null>(null)
  const [deleteVehicleOpen, setDeleteVehicleOpen] = useState(false)
  const [vehicleToDelete, setVehicleToDelete] = useState<any | null>(null)
  const [isDeletingVehicle, setIsDeletingVehicle] = useState(false)
  const [deleteDriverOpen, setDeleteDriverOpen] = useState(false)
  const [driverToDelete, setDriverToDelete] = useState<any | null>(null)
  const [isDeletingDriver, setIsDeletingDriver] = useState(false)
  const [vehicleForm, setVehicleForm] = useState({
    licensePlate: '',
    type: 'TRUCK',
    capacity: '',
    status: 'AVAILABLE',
    driverId: '',
    isActive: true,
  })
  const [driverForm, setDriverForm] = useState({
    name: '',
    email: '',
    phoneNumber: '',
    licenseNumber: '',
    licenseExpiry: '',
    vehicleId: '',
    status: 'Active',
    isActive: true,
  })

  const fetchData = async () => {
    setIsLoading(true)
    try {
      const [vehiclesRes, driversRes, tripsRes] = await Promise.all([
        safeFetchJson('/api/vehicles?page=1&pageSize=100', { cache: 'no-store' }, { retries: 3, timeoutMs: 15000 }),
        safeFetchJson('/api/drivers?page=1&pageSize=100&includeSample=true', { cache: 'no-store' }, { retries: 3, timeoutMs: 15000 }),
        safeFetchJson('/api/trips?page=1&pageSize=100', { cache: 'no-store' }, { retries: 3, timeoutMs: 15000 }),
      ])

      setVehicles(vehiclesRes.ok ? getCollection<any>(vehiclesRes.data, ['vehicles']) : [])
      setDrivers(driversRes.ok ? getCollection<any>(driversRes.data, ['drivers']) : [])
      setTrips(tripsRes.ok ? getCollection<any>(tripsRes.data, ['trips']) : [])
    } catch (error) {
      console.error('Failed to fetch transportation data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    let focusPayload: any = null
    try {
      const raw = window.sessionStorage.getItem('admin_transport_focus')
      if (!raw) return
      focusPayload = JSON.parse(raw)
    } catch {
      focusPayload = null
    }
    if (!focusPayload?.orderId || trips.length === 0) return

    const targetOrderId = String(focusPayload.orderId)
    const matchedTrip = trips.find((trip) =>
      Array.isArray(trip?.dropPoints) &&
      trip.dropPoints.some((point: any) => String(point?.orderId || point?.order?.id || '') === targetOrderId)
    )

    if (matchedTrip) {
      setActiveTab('trips')
      setSelectedTrip(matchedTrip)
      toast.success(`Opened trip for order ${focusPayload.orderNumber || targetOrderId}`)
      try {
        window.sessionStorage.removeItem('admin_transport_focus')
      } catch {
        // ignore
      }
    }
  }, [trips])

  const activeTripsCount = trips.filter((trip) => ['IN_PROGRESS', 'PLANNED'].includes(normalizeTripStatus(trip?.status))).length
  const driversOnDutyCount = drivers.filter((driver) => driver?.isActive !== false).length
  const maintenanceCount = vehicles.filter((vehicle) => String(vehicle?.status).toUpperCase().includes('MAINTENANCE')).length

  const isDriverAssignable = (driver: any) => {
    const status = String(driver?.status || '').toUpperCase()
    return driver?.isActive !== false && status !== 'INACTIVE'
  }

  const isVehicleAssignable = (vehicle: any) => {
    const status = String(vehicle?.status || '').toUpperCase()
    return vehicle?.isActive !== false && !['INACTIVE', 'OUT_OF_SERVICE', 'MAINTENANCE'].includes(status)
  }

  const saveVehicle = async (mode: 'create' | 'edit') => {
    if (!vehicleForm.licensePlate.trim()) {
      toast.error('License plate is required')
      return
    }

    if (vehicleForm.driverId) {
      const selectedDriverRecord = drivers.find((driver) => driver.id === vehicleForm.driverId)
      if (selectedDriverRecord && !isDriverAssignable(selectedDriverRecord)) {
        toast.error('Selected driver is inactive and cannot be assigned')
        return
      }
    }

    setIsSubmitting(true)
    try {
      const endpoint = '/api/vehicles'
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mode === 'edit' ? selectedVehicle.id : undefined,
          licensePlate: vehicleForm.licensePlate.trim(),
          type: String(vehicleForm.type || '').toUpperCase(),
          capacity: parseInt(vehicleForm.capacity) || 0,
          status: String(vehicleForm.status || '').toUpperCase(),
          driverId: vehicleForm.driverId || null,
          isActive: vehicleForm.isActive,
        }),
      })

      if (response.ok) {
        await fetchData()
        resetVehicleForm()
        setAddVehicleOpen(false)
        toast.success(`Vehicle ${mode === 'create' ? 'created' : 'updated'} successfully`)
      } else {
        toast.error('Failed to save vehicle')
      }
    } catch (error: any) {
      toast.error(error?.message || 'An error occurred while saving')
    } finally {
      setIsSubmitting(false)
    }
  }

  const saveDriver = async () => {
    if (!selectedDriver?.id) {
      toast.error('No driver selected')
      return
    }

    const name = (driverForm.name || '').trim()
    const email = (driverForm.email || '').trim()
    const phoneNumber = (driverForm.phoneNumber || '').trim()

    if (!name || !email || !phoneNumber) {
      toast.error('Name, email, and phone number are required')
      return
    }

    if (driverForm.vehicleId) {
      const selectedVehicleRecord = vehicles.find((vehicle) => vehicle.id === driverForm.vehicleId)
      if (selectedVehicleRecord && !isVehicleAssignable(selectedVehicleRecord)) {
        toast.error('Selected vehicle is inactive and cannot be assigned')
        return
      }
    }

    setIsSubmitting(true)
    try {
      const userId = selectedDriver?.user?.id
      if (userId) {
        const userResponse = await fetch(`/api/users/${userId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            phone: phoneNumber,
            isActive: driverForm.isActive,
          }),
        })
        const userPayload = await userResponse.json().catch(() => ({}))
        if (!userResponse.ok || userPayload?.success === false) {
          throw new Error(userPayload?.error || 'Failed to update driver user profile')
        }
      }

      const response = await fetch('/api/drivers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedDriver.id,
          phone: phoneNumber,
          licenseExpiry: driverForm.licenseExpiry || null,
          vehicleId: driverForm.vehicleId || null,
          isActive: driverForm.isActive,
        }),
      })
      const payload = await response.json().catch(() => ({}))

      if (response.ok && payload?.success !== false) {
        await fetchData()
        resetDriverForm()
        setAddDriverOpen(false)
        toast.success('Driver updated successfully')
      } else {
        toast.error(payload?.error || 'Failed to save driver')
      }
    } catch (error) {
      toast.error('An error occurred while saving')
    } finally {
      setIsSubmitting(false)
    }
  }

  const promptDeleteVehicle = (vehicle: any) => {
    setVehicleToDelete(vehicle)
    setDeleteVehicleOpen(true)
  }

  const deleteVehicle = async () => {
    if (!vehicleToDelete?.id) return
    setIsDeletingVehicle(true)
    try {
      const response = await fetch(`/api/vehicles/${vehicleToDelete.id}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to delete vehicle')
      }
      await fetchData()
      setDeleteVehicleOpen(false)
      setVehicleToDelete(null)
      emitDataSync(['vehicles', 'drivers', 'trips'])
      toast.success(payload?.message || 'Vehicle deleted successfully')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete vehicle')
    } finally {
      setIsDeletingVehicle(false)
    }
  }

  const promptDeleteDriver = (driver: any) => {
    setDriverToDelete(driver)
    setDeleteDriverOpen(true)
  }

  const deleteDriver = async () => {
    if (!driverToDelete?.id) return
    setIsDeletingDriver(true)
    try {
      const response = await fetch('/api/drivers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: driverToDelete.id, isActive: false }),
      })
      if (response.ok) {
        await fetchData()
        setDeleteDriverOpen(false)
        setDriverToDelete(null)
        toast.success('Driver deactivated successfully')
      }
    } catch (error) {
      toast.error('Failed to delete driver')
    } finally {
      setIsDeletingDriver(false)
    }
  }

  const resetVehicleForm = () => {
    setVehicleForm({
      licensePlate: '',
      type: 'TRUCK',
      capacity: '',
      status: 'AVAILABLE',
      driverId: '',
      isActive: true,
    })
    setSelectedVehicle(null)
  }

  const resetDriverForm = () => {
    setDriverForm({
      name: '',
      email: '',
      phoneNumber: '',
      licenseNumber: '',
      licenseExpiry: '',
      vehicleId: '',
      status: 'Active',
      isActive: true,
    })
    setSelectedDriver(null)
  }

  const TransportationSkeleton = () => (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="h-8 w-72 rounded-xl bg-slate-200/80" />
          <div className="h-4 w-56 rounded-lg bg-slate-200/70" />
        </div>
        <div className="h-10 w-32 rounded-xl bg-sky-200/70" />
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={`transport-skeleton-stat-${index}`}>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-slate-200/80" />
                <div className="space-y-2">
                  <div className="h-4 w-24 rounded-lg bg-slate-200/70" />
                  <div className="h-7 w-14 rounded-lg bg-slate-300/80" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-2xl border border-white/40 bg-white/65 p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.12)] backdrop-blur-xl">
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={`transport-skeleton-tab-${index}`} className="h-11 rounded-xl bg-slate-200/80" />
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={`transport-skeleton-row-${index}`}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-3">
                  <div className="h-5 w-40 rounded-lg bg-slate-300/80" />
                  <div className="h-4 w-56 rounded-lg bg-slate-200/70" />
                  <div className="h-4 w-32 rounded-lg bg-slate-200/70" />
                </div>
                <div className="flex gap-2">
                  <div className="h-9 w-20 rounded-lg bg-slate-200/80" />
                  <div className="h-9 w-20 rounded-lg bg-slate-200/80" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )

  const openTripDetails = (trip: any) => {
    setSelectedTrip(trip)
  }

  if (isLoading) return <TransportationSkeleton />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transportation Management</h1>
          <p className="text-gray-600">Fleet, trips, and driver management system</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { resetVehicleForm(); setAddVehicleOpen(true) }} className="bg-blue-600 hover:bg-blue-700">
            + Add Vehicle
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-blue-100 text-blue-600"><Truck className="h-4 w-4" /></div>
              <div>
                <p className="text-sm text-gray-600">Total Vehicles</p>
                <p className="text-2xl font-bold">{vehicles.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-green-100 text-green-600"><CheckCircle className="h-4 w-4" /></div>
              <div>
                <p className="text-sm text-gray-600">Active Trips</p>
                <p className="text-2xl font-bold">{activeTripsCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-purple-100 text-purple-600"><UserCheck className="h-4 w-4" /></div>
              <div>
                <p className="text-sm text-gray-600">Drivers On Duty</p>
                <p className="text-2xl font-bold">{driversOnDutyCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-orange-100 text-orange-600"><AlertTriangle className="h-4 w-4" /></div>
              <div>
                <p className="text-sm text-gray-600">Maintenance</p>
                <p className="text-2xl font-bold">{maintenanceCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={(value: any) => setActiveTab(value)} className="w-full">
        <div className="w-full pb-1">
          <TabsList className="h-auto w-full gap-2 rounded-2xl border border-white/40 bg-white/65 p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.12)] backdrop-blur-xl">
            <TabsTrigger value="vehicles" className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent bg-transparent px-5 py-2.5 text-[15px] font-semibold text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]">Fleet Management</TabsTrigger>
            <TabsTrigger value="trips" className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent bg-transparent px-5 py-2.5 text-[15px] font-semibold text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]">Active Trips</TabsTrigger>
            <TabsTrigger value="drivers" className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent bg-transparent px-5 py-2.5 text-[15px] font-semibold text-slate-700 transition-all duration-300 ease-out hover:border-sky-200/70 hover:bg-sky-50/70 hover:text-sky-900 data-[state=active]:-translate-y-0.5 data-[state=active]:border-sky-200 data-[state=active]:bg-white data-[state=active]:text-[#0f2a4a] data-[state=active]:shadow-[0_8px_18px_rgba(14,116,144,0.18)]">Drivers</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="vehicles" className="space-y-4 mt-4">
          <Dialog open={addVehicleOpen} onOpenChange={setAddVehicleOpen}>
            <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{selectedVehicle ? 'Edit Vehicle' : 'Add New Vehicle'}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <label className="text-sm font-medium text-gray-700">License Plate</label>
                  <Input placeholder="License Plate" value={vehicleForm.licensePlate} onChange={(e) => setVehicleForm({...vehicleForm, licensePlate: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Vehicle Type</label>
                  <select value={vehicleForm.type} onChange={(e) => setVehicleForm({...vehicleForm, type: e.target.value})} title="Vehicle Type" className="w-full px-3 py-2 border rounded-md">
                    <option value="TRUCK">Truck</option>
                    <option value="VAN">Van</option>
                    <option value="CAR">Car</option>
                    <option value="MOTORCYCLE">Motorcycle</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Capacity (kg)</label>
                  <Input type="number" placeholder="Capacity (kg)" value={vehicleForm.capacity} onChange={(e) => setVehicleForm({...vehicleForm, capacity: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Status</label>
                  <select value={vehicleForm.status} onChange={(e) => setVehicleForm({...vehicleForm, status: e.target.value})} title="Status" className="w-full px-3 py-2 border rounded-md">
                    <option value="AVAILABLE">Available</option>
                    <option value="IN_USE">In Use</option>
                    <option value="MAINTENANCE">Maintenance</option>
                    <option value="OUT_OF_SERVICE">Out of Service</option>
                  </select>
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-sm font-medium text-gray-700">Assign Driver</label>
                  <select
                    value={vehicleForm.driverId}
                    onChange={(e) => setVehicleForm({ ...vehicleForm, driverId: e.target.value })}
                    title="Assign Driver"
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="">Unassigned</option>
                    {drivers.map((driver: any) => (
                      <option key={driver.id} value={driver.id} disabled={!isDriverAssignable(driver)}>
                        {(driver.user?.name || driver.name || driver.email || driver.id) + (!isDriverAssignable(driver) ? ' (Inactive)' : '')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" title="Vehicle active" checked={vehicleForm.isActive} onChange={(e) => setVehicleForm({...vehicleForm, isActive: e.target.checked})} />
                  <label>Active</label>
                </div>
                <Button onClick={() => saveVehicle(selectedVehicle ? 'edit' : 'create')} disabled={isSubmitting} className="w-full">
                  {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : null}
                  {selectedVehicle ? 'Update' : 'Add'} Vehicle
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {vehicles.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-gray-500">
                No vehicles found. Click <span className="font-medium text-gray-700">Add Vehicle</span> to create your first fleet record.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {vehicles.map((vehicle: any) => (
                <Card key={vehicle.id}>
                  <CardContent className="pt-6">
                    <div className="flex flex-row items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{vehicle.licensePlate || 'Vehicle'}</h3>
                        <p className="text-sm text-gray-500">Plate: {vehicle.licensePlate}</p>
                        <p className="text-sm text-gray-500">Capacity: {vehicle.capacity} kg</p>
                        <p className="text-sm text-gray-500">Driver: {vehicle?.drivers?.[0]?.driver?.user?.name || vehicle?.drivers?.[0]?.driver?.name || 'Not Assigned'}</p>
                        <Badge className={String(vehicle.status).toUpperCase().includes('MAINTENANCE') ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}>
                          {vehicle.status || 'Active'}
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setSelectedVehicle(vehicle); setVehicleForm({ licensePlate: vehicle.licensePlate || '', type: String(vehicle.type || 'TRUCK').toUpperCase(), capacity: String(vehicle.capacity || ''), status: String(vehicle.status || 'AVAILABLE').toUpperCase(), driverId: vehicle?.drivers?.[0]?.driver?.id || '', isActive: vehicle.isActive !== false }); setAddVehicleOpen(true) }}>Edit</Button>
                        <Button size="sm" variant="destructive" onClick={() => promptDeleteVehicle(vehicle)}>Delete</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <AlertDialog open={deleteVehicleOpen} onOpenChange={setDeleteVehicleOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-red-600">Delete Vehicle Permanently?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete{' '}
                  <span className="font-semibold text-foreground">
                    {vehicleToDelete?.licensePlate || 'this vehicle'}
                  </span>
                  . This cannot be undone. If this vehicle is already used in trips, deletion will be blocked.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeletingVehicle}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={deleteVehicle}
                  disabled={isDeletingVehicle}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {isDeletingVehicle ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Delete Vehicle
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        <TabsContent value="trips" className="space-y-4 mt-4">
          {trips.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-gray-500">No active trips found.</CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {trips.slice(0, 10).map((trip: any) => {
                const status = normalizeTripStatus(trip?.status || 'PLANNED')
                const driverName = trip?.driver?.name || trip?.driver?.user?.name || 'Unassigned'
                const vehicleName = trip?.vehicle?.licensePlate || 'Unassigned'
                const origin = trip?.origin || trip?.warehouse?.city || 'Warehouse'
                const destination = trip?.destination || trip?.destinationCity || 'Destination'
                const points = Array.isArray(trip?.dropPoints) ? trip.dropPoints : []
                const legCount = points.reduce((sum: number, point: any) => {
                  if (!point?.order) return sum
                  return sum + deriveOrderFulfillmentSummary(point.order).legs.length
                }, 0)
                return (
                  <Card key={trip.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-base font-semibold">{trip.tripNumber || trip.id}</p>
                            <Badge className={`${status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'} text-xs px-2 py-0.5`}>{status.replace(/_/g, ' ')}</Badge>
                          </div>
                          <p className="text-[13px] text-gray-600">Vehicle: {vehicleName} | Driver: {driverName}</p>
                          <p className="text-[13px] text-gray-600">Route: {origin} {'->'} {destination}</p>
                          <p className="text-[12px] text-slate-500">Fulfillment legs on trip: {legCount}</p>
                        </div>
                        <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => openTripDetails(trip)}>View Details</Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="drivers" className="space-y-4 mt-4">
          <Card>
            <CardContent className="pt-6 text-sm text-gray-600">
              New drivers are created from Users (Add User). Use this section to review, edit, and remove existing drivers.
            </CardContent>
          </Card>

          <Dialog open={addDriverOpen} onOpenChange={setAddDriverOpen}>
            <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit Driver</DialogTitle>
              </DialogHeader>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">Name</label>
                      <Input placeholder="Name" value={driverForm.name} onChange={(e) => setDriverForm({...driverForm, name: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">Email</label>
                      <Input type="email" placeholder="Email" value={driverForm.email} onChange={(e) => setDriverForm({...driverForm, email: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">Phone Number</label>
                      <Input
                        placeholder="09XX XXX XXXX"
                        maxLength={13}
                        value={driverForm.phoneNumber}
                        onChange={(e) => setDriverForm({...driverForm, phoneNumber: formatPhilippinePhoneInput(e.target.value)})}
                      />
                      {driverForm.phoneNumber && driverForm.phoneNumber.length > 0 && !isValidPhilippinePhone(driverForm.phoneNumber) && (
                        <p className="text-xs text-red-600">Please enter a valid Philippine mobile number (e.g., 09171234567 or 639171234567)</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">License Number</label>
                      <Input placeholder="License Number" value={driverForm.licenseNumber} onChange={(e) => setDriverForm({...driverForm, licenseNumber: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">License Expiry</label>
                      <Input type="date" placeholder="License Expiry" value={driverForm.licenseExpiry} onChange={(e) => setDriverForm({...driverForm, licenseExpiry: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-gray-700">Status</label>
                      <select value={driverForm.status} onChange={(e) => setDriverForm({...driverForm, status: e.target.value})} title="Status" className="w-full px-3 py-2 border rounded-md">
                        <option>Active</option>
                        <option>OnLeave</option>
                        <option>Inactive</option>
                      </select>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <label className="text-sm font-medium text-gray-700">Assign Vehicle</label>
                      <select
                        value={driverForm.vehicleId}
                        onChange={(e) => setDriverForm({ ...driverForm, vehicleId: e.target.value })}
                        title="Assign Vehicle"
                        className="w-full px-3 py-2 border rounded-md"
                      >
                        <option value="">Unassigned</option>
                        {vehicles.map((vehicle: any) => (
                          <option key={vehicle.id} value={vehicle.id} disabled={!isVehicleAssignable(vehicle)}>
                            {vehicle.licensePlate} - {vehicle.type || 'VEHICLE'}{!isVehicleAssignable(vehicle) ? ' (Unavailable)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <input type="checkbox" title="Driver active" checked={driverForm.isActive} onChange={(e) => setDriverForm({...driverForm, isActive: e.target.checked})} />
                      <label>Active</label>
                    </div>
                  </div>
                  <div>
                <Button onClick={saveDriver} disabled={isSubmitting} className="w-full">
                  {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : null}
                  Update Driver
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {drivers.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-gray-500">
                No drivers found. Add users with the Driver role to populate this section.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {drivers.map((driver: any) => (
                <Card key={driver.id}>
                  <CardContent className="pt-6">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold">{driver.user?.name || driver.name || 'N/A'}</h3>
                        <p className="text-sm text-gray-500">{driver.user?.email || driver.email || 'N/A'}</p>
                        <p className="text-sm text-gray-500">{driver.phone || driver.user?.phone || driver.phoneNumber || 'N/A'}</p>
                        <p className="text-sm text-gray-500">License: {driver.licenseNumber}</p>
                        <p className={`text-sm font-medium ${driver.isActive ? 'text-green-600' : 'text-orange-600'}`}>
                          {driver.isActive ? 'Active' : 'Inactive'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setSelectedDriver(driver); setDriverForm({ name: driver.user?.name || driver.name || '', email: driver.user?.email || driver.email || '', phoneNumber: driver.phone || driver.user?.phone || driver.phoneNumber || '', licenseNumber: driver.licenseNumber || '', licenseExpiry: driver.licenseExpiry || '', vehicleId: driver?.vehicles?.[0]?.vehicle?.id || '', status: driver.isActive ? 'Active' : 'Inactive', isActive: driver.isActive !== false }); setAddDriverOpen(true) }}>Edit</Button>
                        <Button size="sm" variant="destructive" onClick={() => promptDeleteDriver(driver)}>Delete</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedTrip} onOpenChange={(open) => !open && setSelectedTrip(null)}>
        <DialogContent className="flex max-h-[88vh] w-[95vw] max-w-[760px] flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white p-0 shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
          {selectedTrip && (
            (() => {
              const statusLabel = normalizeTripStatus(selectedTrip.status || 'PLANNED').replace(/_/g, ' ')
              const completed = Number(selectedTrip?.completedDropPoints ?? 0)
              const total = Number(selectedTrip?.totalDropPoints ?? selectedTrip?.dropPoints?.length ?? 0)
              return (
                <div className="flex-1 overflow-y-auto">
                  <div className="border-b border-slate-200 px-5 pb-4 pt-5">
                    <div className="flex flex-wrap items-center gap-2 pr-8">
                      <h2 className="text-[1.45rem] font-bold leading-tight tracking-tight text-[#0f172f] sm:text-[1.65rem]">{selectedTrip.tripNumber || selectedTrip.id}</h2>
                      <div className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1">
                        <Clock className="h-3.5 w-3.5 text-blue-600" />
                        <span className="text-[10px] font-semibold leading-none text-blue-600">{statusLabel}</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4 px-5 py-5">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/35 p-4">
                      <div className="grid gap-2 grid-cols-4">
                        <div className="flex items-center gap-2 pr-2 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-slate-200">
                          <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-100 text-blue-600">
                            <Truck className="h-5 w-5" />
                          </span>
                          <div>
                            <p className="text-[10px] leading-none text-slate-500">Vehicle</p>
                            <p className="mt-1 text-[12px] font-semibold leading-none text-slate-900">{selectedTrip?.vehicle?.licensePlate || 'Unassigned'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pr-2 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-slate-200">
                          <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-100 text-violet-700">
                            <UserCheck className="h-5 w-5" />
                          </span>
                          <div>
                            <p className="text-[10px] leading-none text-slate-500">Driver</p>
                            <p className="mt-1 text-[12px] font-semibold leading-none text-slate-900">{selectedTrip?.driver?.name || selectedTrip?.driver?.user?.name || 'Unassigned'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pr-2 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-slate-200">
                          <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                            <CircleCheck className="h-5 w-5" />
                          </span>
                          <div>
                            <p className="text-[10px] leading-none text-slate-500">Progress</p>
                            <p className="mt-1 text-[12px] font-semibold leading-none text-slate-900">{completed}/{total}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-500">
                            <MapPin className="h-5 w-5" />
                          </span>
                          <div>
                            <p className="text-[10px] leading-none text-slate-500">Drop points</p>
                            <p className="mt-1 text-[12px] font-semibold leading-none text-slate-900">{selectedTrip?.dropPoints?.length ?? 0}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/35 p-4">
                      <p className="mb-3 flex items-center gap-2 text-[14px] font-bold leading-none text-[#0f172f]">
                        <MapPin className="h-4 w-4 text-blue-600" />
                        Drop Point Details
                      </p>
                      {Array.isArray(selectedTrip.dropPoints) && selectedTrip.dropPoints.length > 0 ? (
                        <div className="space-y-3">
                          {selectedTrip.dropPoints.map((point: any, index: number) => {
                            const statusLabelPoint = String(point.status || 'PENDING').replace(/_/g, ' ')
                            const statusClass =
                              ['COMPLETED', 'DELIVERED', 'ARRIVED'].includes(String(point.status || ''))
                                ? 'bg-blue-100 text-blue-700 border-blue-200'
                                : ['FAILED', 'FAILED_DELIVERY', 'CANCELLED', 'SKIPPED'].includes(String(point.status || ''))
                                  ? 'bg-red-100 text-red-700 border-red-200'
                                  : ['IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(String(point.status || ''))
                                    ? 'bg-blue-100 text-blue-700 border-blue-200'
                                    : 'bg-gray-100 text-gray-700 border-gray-200'

                            const hasCoordinates = typeof point.latitude === 'number' && typeof point.longitude === 'number'
                            return (
                              <div key={point.id || `${selectedTrip.id}-dp-${index}`} className="rounded-xl border border-slate-200 bg-white p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex min-w-0 items-start gap-3">
                                    <span className="mt-1 grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full bg-blue-100 text-blue-600">
                                      <MapPin className="h-5 w-5" />
                                    </span>
                                    <div className="min-w-0">
                                      <p className="text-[12px] font-semibold leading-none text-slate-900">
                                        Drop Point {index + 1}: {point.locationName || 'Unnamed drop point'}
                                      </p>
                                      <p className="mt-1 text-[11px] leading-snug text-slate-500">
                                        {hasCoordinates
                                          ? `Coordinates: ${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}`
                                          : 'Coordinates: Not available'}
                                      </p>
                                      {point?.order ? (
                                        <p className="mt-1 text-[11px] text-slate-500">
                                          Fulfillment legs: {deriveOrderFulfillmentSummary(point.order).deliveredLegs}/{deriveOrderFulfillmentSummary(point.order).totalLegs} delivered
                                        </p>
                                      ) : null}
                                      <div className="mt-4">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          className="h-8 rounded-lg border-slate-300 px-3 text-[11px] font-medium text-slate-900 hover:bg-slate-50"
                                          onClick={() => setSelectedDropPointDetail(point)}
                                        >
                                          <Eye className="mr-2 h-4 w-4" />
                                          View Details
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                  <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold leading-none ${statusClass}`}>
                                    {statusLabelPoint}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">No drop-point records attached to this trip yet.</p>
                      )}
                    </div>
                    <div className="flex justify-end pt-2">
                      <Button variant="outline" className="h-10 min-w-[86px] rounded-lg border-slate-300 px-4 text-sm font-medium text-slate-900 hover:bg-slate-50" onClick={() => setSelectedTrip(null)}>
                        Close
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })()
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedDropPointDetail} onOpenChange={(open) => !open && setSelectedDropPointDetail(null)}>
        <DialogContent className="max-w-xl w-full overflow-hidden rounded-2xl border border-white/40 bg-white/90 p-0 shadow-[0_24px_50px_rgba(15,23,42,0.16)] backdrop-blur-2xl">
          {selectedDropPointDetail ? (
            <div className="space-y-4 p-6">
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-slate-200/70 pb-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-[0_8px_18px_rgba(37,99,235,0.28)]">
                  <MapPin className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Drop Point Details</h3>
              </div>

              {/* Info card */}
              <div className="rounded-2xl border border-white/50 bg-white/65 p-4 backdrop-blur-xl shadow-[0_8px_20px_rgba(15,23,42,0.07)] space-y-2.5 text-sm">
                <div className="flex gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">Customer</span>
                  <span className="text-slate-700">{selectedDropPointDetail.locationName || selectedDropPointDetail.contactName || 'N/A'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">Phone</span>
                  <span className="text-slate-700">{selectedDropPointDetail.contactPhone || 'N/A'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">Address</span>
                  <span className="text-slate-700">{selectedDropPointDetail.address || 'N/A'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">PO Number</span>
                  <span className="font-mono text-slate-800">{selectedDropPointDetail.order?.orderNumber || 'N/A'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">PO Status</span>
                  {(() => {
                    const raw = String(selectedDropPointDetail.order?.status || 'N/A').toUpperCase()
                    const isActive = ['OUT_FOR_DELIVERY', 'IN_TRANSIT', 'DISPATCHED'].includes(raw)
                    const isDone = raw === 'DELIVERED'
                    const isFailed = ['CANCELLED', 'FAILED', 'FAILED_DELIVERY', 'REJECTED'].includes(raw)
                    return (
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        isActive  ? 'border-sky-200 bg-sky-50 text-sky-700' :
                        isDone    ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                        isFailed  ? 'border-red-200 bg-red-50 text-red-700' :
                                    'border-slate-200 bg-slate-50 text-slate-600'
                      }`}>
                        {raw.replace(/_/g, ' ')}
                      </span>
                    )
                  })()}
                </div>
                <div className="flex gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">Total Amount</span>
                  <span className="font-semibold text-indigo-600">
                    {selectedDropPointDetail.order?.totalAmount != null
                      ? formatPeso(Number(selectedDropPointDetail.order.totalAmount || 0))
                      : 'N/A'}
                  </span>
                </div>
              </div>

              {/* Order Items */}
              <div className="rounded-2xl border border-white/50 bg-white/65 p-4 backdrop-blur-xl shadow-[0_8px_20px_rgba(15,23,42,0.07)]">
                <p className="mb-3 text-sm font-semibold text-slate-900">Order Items</p>
                {Array.isArray(selectedDropPointDetail.order?.items) && selectedDropPointDetail.order.items.length > 0 ? (
                  <div className="space-y-2 text-sm">
                    {selectedDropPointDetail.order.items.map((item: any, itemIndex: number) => (
                      <div key={`dp-detail-item-${itemIndex}`} className="rounded-xl border border-white/60 bg-white/80 px-3 py-2.5 shadow-[0_4px_10px_rgba(15,23,42,0.06)]">
                        <p className="font-semibold text-slate-900">{item?.product?.name || 'Item'}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Size: {(() => {
                            const product = item?.product || {}
                            const fromSizes = Array.isArray(product?.sizes) && product.sizes.length > 0
                              ? product.sizes.map((s: any) => String(s || '').trim()).filter(Boolean).join(', ')
                              : ''
                            const fromField = String(product?.size || product?.sizeLabel || item?.size || '').trim()
                            return fromSizes || fromField || 'N/A'
                          })()}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">Quantity: {Number(item?.quantity || 0)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No order items.</p>
                )}
              </div>

              {/* Footer */}
              <div className="flex justify-end pt-1">
                <Button
                  variant="outline"
                  className="h-10 min-w-24 rounded-xl border-white/50 bg-white/65 text-slate-700 backdrop-blur-md hover:bg-white/85 hover:text-slate-950"
                  onClick={() => setSelectedDropPointDetail(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>


      <AlertDialog open={deleteDriverOpen} onOpenChange={setDeleteDriverOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">Deactivate Driver?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate{' '}
              <span className="font-semibold text-foreground">
                {driverToDelete?.user?.name || driverToDelete?.name || 'this driver'}
              </span>
              . They will no longer appear as active. You can reactivate them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingDriver}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteDriver}
              disabled={isDeletingDriver}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeletingDriver ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Deactivate Driver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
