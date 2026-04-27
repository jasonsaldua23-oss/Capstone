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
  const [deleteVehicleOpen, setDeleteVehicleOpen] = useState(false)
  const [vehicleToDelete, setVehicleToDelete] = useState<any | null>(null)
  const [isDeletingVehicle, setIsDeletingVehicle] = useState(false)
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

  const deleteDriver = async (id: string) => {
    if (!confirm('Are you sure you want to delete this driver?')) return
    try {
      const response = await fetch('/api/drivers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive: false }),
      })
      if (response.ok) {
        await fetchData()
        toast.success('Driver deactivated successfully')
      }
    } catch (error) {
      toast.error('Failed to delete driver')
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

  const openTripDetails = (trip: any) => {
    setSelectedTrip(trip)
  }

  if (isLoading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Transportation Management</h1>
          <p className="text-gray-600">Fleet, trips, and driver management system</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => { resetVehicleForm(); setAddVehicleOpen(true) }} className="bg-blue-600 hover:bg-blue-700">
            + Add Vehicle
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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
        <TabsList className="w-full justify-start gap-2 overflow-x-auto">
          <TabsTrigger value="vehicles">Fleet Management</TabsTrigger>
          <TabsTrigger value="trips">Active Trips</TabsTrigger>
          <TabsTrigger value="drivers">Drivers</TabsTrigger>
        </TabsList>

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

          <div className="grid gap-4">
            {vehicles.map((vehicle: any) => (
              <Card key={vehicle.id}>
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
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
                      <Input placeholder="Phone Number" value={driverForm.phoneNumber} onChange={(e) => setDriverForm({...driverForm, phoneNumber: e.target.value})} />
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
                      <Button size="sm" variant="destructive" onClick={() => deleteDriver(driver.id)}>Delete</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedTrip} onOpenChange={(open) => !open && setSelectedTrip(null)}>
        <DialogContent className="max-w-3xl w-full">
          {selectedTrip && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-lg font-bold text-gray-900">{selectedTrip.tripNumber || selectedTrip.id}</span>
                <Badge className={['IN_PROGRESS'].includes(normalizeTripStatus(selectedTrip?.status || '')) ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}>
                  {normalizeTripStatus(selectedTrip.status || 'PLANNED').replace(/_/g, ' ')}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-6 mb-2 text-sm">
                <div>
                  <span className="font-semibold">Vehicle:</span> {selectedTrip?.vehicle?.licensePlate || 'Unassigned'}
                </div>
                <div>
                  <span className="font-semibold">Driver:</span> {selectedTrip?.driver?.name || selectedTrip?.driver?.user?.name || 'Unassigned'}
                </div>
              </div>
              <div className="flex flex-wrap gap-6 mb-2 text-sm">
                <div>
                  <span className="font-semibold">Progress:</span> {selectedTrip?.completedDropPoints ?? 0}/{selectedTrip?.totalDropPoints ?? 0}
                </div>
                <div>
                  <span className="font-semibold">Drop points:</span> {selectedTrip?.dropPoints?.length ?? 0}
                </div>
              </div>
              <div className="rounded-lg border bg-gray-50 p-3">
                <p className="text-sm font-semibold text-gray-900 mb-2">Drop Point Details</p>
                {Array.isArray(selectedTrip.dropPoints) && selectedTrip.dropPoints.length > 0 ? (
                  <div className="space-y-2 max-h-72 overflow-auto pr-1">
                    {selectedTrip.dropPoints.map((point: any, index: number) => {
                      const statusLabel = String(point.status || 'PENDING').replace(/_/g, ' ')
                      const statusClass =
                        ['COMPLETED', 'DELIVERED'].includes(String(point.status || ''))
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : ['FAILED', 'FAILED_DELIVERY', 'CANCELLED', 'SKIPPED'].includes(String(point.status || ''))
                            ? 'bg-red-100 text-red-700 border-red-200'
                            : ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ARRIVED'].includes(String(point.status || ''))
                              ? 'bg-blue-100 text-blue-700 border-blue-200'
                              : 'bg-gray-100 text-gray-700 border-gray-200'

                      const hasCoordinates =
                        typeof point.latitude === 'number' && typeof point.longitude === 'number'

                      return (
                        <div key={point.id || `${selectedTrip.id}-dp-${index}`} className="rounded-md border bg-white p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-900">
                              Drop Point {index + 1}: {point.locationName || 'Unnamed drop point'}
                            </p>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-600">
                            {hasCoordinates
                              ? `Coordinates: ${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}`
                              : 'Coordinates: Not available'}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No drop-point records attached to this trip yet.</p>
                )}
              </div>
              <div className="flex justify-end mt-4">
                <Button variant="outline" onClick={() => setSelectedTrip(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
