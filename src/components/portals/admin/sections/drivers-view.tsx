'use client'

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
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

export function DriversView() {
  const [drivers, setDrivers] = useState<any[]>([])
  const [vehicles, setVehicles] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [profileDriver, setProfileDriver] = useState<any | null>(null)
  const [assignDriver, setAssignDriver] = useState<any | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [assignVehicleId, setAssignVehicleId] = useState('')
  const [driverForm, setDriverForm] = useState({
    mode: 'existing',
    userId: '',
    name: '',
    email: '',
    phone: '',
    password: '',
    roleId: '',
    licenseNumber: '',
    licenseType: 'B',
    licenseExpiry: '',
    city: '',
    province: '',
    address: '',
    zipCode: '',
  })

  const isDriverAssignable = (driver: any) => {
    const status = String(driver?.status || '').toUpperCase()
    return driver?.isActive !== false && status !== 'INACTIVE'
  }

  const isVehicleAssignable = (vehicle: any) => {
    const status = String(vehicle?.status || '').toUpperCase()
    return vehicle?.isActive !== false && !['INACTIVE', 'OUT_OF_SERVICE', 'MAINTENANCE'].includes(status)
  }

  const fetchDrivers = async () => {
    setIsLoading(true)
    try {
      const [driversResponse, vehiclesResponse, usersResponse, rolesResponse] = await Promise.all([
        fetch('/api/drivers'),
        fetch('/api/vehicles?status=AVAILABLE'),
        fetch('/api/users?pageSize=200'),
        fetch('/api/roles'),
      ])

      if (driversResponse.ok) {
        const driversData = await driversResponse.json()
        setDrivers(getCollection<any>(driversData, ['drivers']))
      }
      if (vehiclesResponse.ok) {
        const vehiclesData = await vehiclesResponse.json()
        setVehicles(getCollection<any>(vehiclesData, ['vehicles']))
      }
      if (usersResponse.ok) {
        const usersData = await usersResponse.json()
        setUsers(toArray<any>(usersData?.data ?? usersData?.users ?? usersData))
      }
      if (rolesResponse.ok) {
        const rolesData = await rolesResponse.json()
        const roleList = toArray<any>(rolesData?.data ?? rolesData?.roles ?? rolesData)
        setRoles(roleList)
        const defaultDriverRole = roleList.find((role) => String(role.name).toUpperCase() === 'DRIVER')
        if (defaultDriverRole?.id) {
          setDriverForm((prev) => ({ ...prev, roleId: prev.roleId || defaultDriverRole.id }))
        }
      }
    } catch (error) {
      console.error('Failed to fetch drivers:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchDrivers()
  }, [])

  const resetDriverForm = () => {
    const defaultDriverRole = roles.find((role) => String(role.name).toUpperCase() === 'DRIVER')
    setDriverForm({
      mode: 'existing',
      userId: '',
      name: '',
      email: '',
      phone: '',
      password: '',
      roleId: defaultDriverRole?.id || '',
      licenseNumber: '',
      licenseType: 'B',
      licenseExpiry: '',
      city: '',
      province: '',
      address: '',
      zipCode: '',
    })
  }

  const createDriver = async () => {
    if (!driverForm.licenseNumber.trim()) {
      toast.error('License number is required')
      return
    }

    setIsSubmitting(true)
    try {
      let userId = driverForm.userId

      if (driverForm.mode === 'new') {
        if (!driverForm.name.trim() || !driverForm.email.trim() || !driverForm.password) {
          throw new Error('Name, email, and password are required for new user')
        }
        const passwordError = validatePasswordPolicy(driverForm.password)
        if (passwordError) {
          throw new Error(passwordError)
        }
        if (!driverForm.roleId) {
          throw new Error('Role is required for new user')
        }
        const createUserResponse = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: driverForm.name.trim(),
            email: driverForm.email.trim(),
            password: driverForm.password,
            phone: driverForm.phone.trim() || null,
            roleId: driverForm.roleId,
          }),
        })
        const createUserPayload = await createUserResponse.json().catch(() => ({}))
        if (!createUserResponse.ok || createUserPayload?.success === false) {
          throw new Error(createUserPayload?.error || 'Failed to create user')
        }
        userId = createUserPayload?.user?.id || createUserPayload?.data?.id
      }

      if (!userId) {
        throw new Error('Please select a user')
      }

      const response = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          licenseNumber: driverForm.licenseNumber.trim(),
          licenseType: driverForm.licenseType || 'B',
          licenseExpiry: driverForm.licenseExpiry || null,
          phone: driverForm.phone.trim() || null,
          address: driverForm.address.trim() || null,
          city: driverForm.city.trim() || null,
          province: driverForm.province.trim() || null,
          zipCode: driverForm.zipCode.trim() || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to create driver')
      }

      toast.success('Driver added')
      setAddOpen(false)
      resetDriverForm()
      await fetchDrivers()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add driver')
    } finally {
      setIsSubmitting(false)
    }
  }

  const assignVehicleToDriver = async () => {
    if (!assignDriver?.id || !assignVehicleId) {
      toast.error('Select driver and vehicle')
      return
    }

    if (!isDriverAssignable(assignDriver)) {
      toast.error('Selected driver is inactive and cannot be assigned')
      return
    }

    const selectedVehicle = vehicles.find((vehicle) => vehicle.id === assignVehicleId)
    if (selectedVehicle && !isVehicleAssignable(selectedVehicle)) {
      toast.error('Selected vehicle is unavailable and cannot be assigned')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/drivers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: assignDriver.id, vehicleId: assignVehicleId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to assign vehicle')
      }
      await fetchDrivers()
      toast.success('Vehicle assigned to driver')
      setAssignDriver(null)
      setAssignVehicleId('')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to assign vehicle')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Drivers</h1>
          <p className="text-gray-500">Manage your delivery drivers</p>
        </div>
        <Button className="gap-2" onClick={() => setAddOpen(true)}>
          <UserCheck className="h-4 w-4" />
          Add Driver
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : drivers.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <UserCheck className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No drivers found</p>
            <Button className="mt-4">Add First Driver</Button>
          </div>
        ) : (
          drivers.map((driver: any) => (
            <Card key={driver.id}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-blue-600 text-white">
                      {driver.user?.name?.charAt(0) || 'D'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h3 className="font-semibold">{driver.user?.name || 'Unknown'}</h3>
                    <p className="text-sm text-gray-500">{driver.user?.email}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline">License: {driver.licenseNumber}</Badge>
                      <Badge variant={driver.isActive ? 'default' : 'secondary'}>
                        {driver.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500">Rating:</span>
                    <span className="ml-1 font-medium">{Number(driver.rating || 0).toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Deliveries:</span>
                    <span className="ml-1 font-medium">{driver.totalDeliveries || 0}</span>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setProfileDriver(driver)}>View Profile</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    title={!isDriverAssignable(driver) ? 'Inactive driver cannot be assigned' : 'Assign vehicle'}
                    disabled={!isDriverAssignable(driver)}
                    onClick={() => { setAssignDriver(driver); setAssignVehicleId('') }}
                  >
                    Assign
                  </Button>
                </div>
                {!isDriverAssignable(driver) ? (
                  <p className="mt-2 text-xs text-amber-600">Inactive driver cannot be assigned.</p>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetDriverForm() }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Driver</DialogTitle>
            <DialogDescription>Create a driver profile from existing user or a new user account.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={driverForm.mode === 'existing' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setDriverForm((f) => ({ ...f, mode: 'existing' }))}
              >
                Existing User
              </Button>
              <Button
                type="button"
                variant={driverForm.mode === 'new' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setDriverForm((f) => ({ ...f, mode: 'new' }))}
              >
                New User
              </Button>
            </div>

            {driverForm.mode === 'existing' ? (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Select User</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  title="Select Driver User"
                  value={driverForm.userId}
                  onChange={(e) => setDriverForm((f) => ({ ...f, userId: e.target.value }))}
                >
                  <option value="">Choose user</option>
                  {users
                    .filter((user) => !drivers.some((driver) => driver.userId === user.id))
                    .map((user) => (
                      <option key={user.id} value={user.id}>{user.name} ({user.email})</option>
                    ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Name</label>
                  <Input value={driverForm.name} onChange={(e) => setDriverForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Email</label>
                  <Input type="email" value={driverForm.email} onChange={(e) => setDriverForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Phone</label>
                  <Input value={driverForm.phone} onChange={(e) => setDriverForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Password</label>
                  <Input type="password" value={driverForm.password} onChange={(e) => setDriverForm((f) => ({ ...f, password: e.target.value }))} />
                  <p className="text-xs text-gray-500">{PASSWORD_POLICY_MESSAGE}</p>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Role</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    title="Driver Role"
                    value={driverForm.roleId}
                    onChange={(e) => setDriverForm((f) => ({ ...f, roleId: e.target.value }))}
                  >
                    <option value="">Select role</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>{formatRoleLabel(role.name)}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">License Number</label>
                <Input value={driverForm.licenseNumber} onChange={(e) => setDriverForm((f) => ({ ...f, licenseNumber: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">License Type</label>
                <Input value={driverForm.licenseType} onChange={(e) => setDriverForm((f) => ({ ...f, licenseType: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">License Expiry</label>
                <Input type="date" value={driverForm.licenseExpiry} onChange={(e) => setDriverForm((f) => ({ ...f, licenseExpiry: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">City</label>
                <Input value={driverForm.city} onChange={(e) => setDriverForm((f) => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Province</label>
                <Input value={driverForm.province} onChange={(e) => setDriverForm((f) => ({ ...f, province: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Zip Code</label>
                <Input value={driverForm.zipCode} onChange={(e) => setDriverForm((f) => ({ ...f, zipCode: e.target.value }))} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Address</label>
                <Input value={driverForm.address} onChange={(e) => setDriverForm((f) => ({ ...f, address: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={createDriver} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Driver
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!profileDriver} onOpenChange={(open) => !open && setProfileDriver(null)}>
        <DialogContent>
          {profileDriver && (
            <>
              <DialogHeader>
                <DialogTitle>Driver Profile - {profileDriver.user?.name || 'N/A'}</DialogTitle>
                <DialogDescription>Driver account and performance details.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="rounded-md border p-3 space-y-1">
                  <p><span className="text-gray-500">Email:</span> {profileDriver.user?.email || 'N/A'}</p>
                  <p><span className="text-gray-500">Phone:</span> {profileDriver.phone || profileDriver.user?.phone || 'N/A'}</p>
                  <p><span className="text-gray-500">License:</span> {profileDriver.licenseNumber || 'N/A'} ({profileDriver.licenseType || 'N/A'})</p>
                  <p><span className="text-gray-500">License Expiry:</span> {profileDriver.licenseExpiry ? new Date(profileDriver.licenseExpiry).toLocaleDateString() : 'N/A'}</p>
                  <p><span className="text-gray-500">Rating:</span> {Number(profileDriver.rating || 0).toFixed(1)}</p>
                  <p><span className="text-gray-500">Total Deliveries:</span> {profileDriver.totalDeliveries || 0}</p>
                  <p><span className="text-gray-500">Address:</span> {[profileDriver.address, profileDriver.city, profileDriver.province, profileDriver.zipCode].filter(Boolean).join(', ') || 'N/A'}</p>
                </div>
                <Button variant="outline" className="w-full" onClick={() => setProfileDriver(null)}>Close</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignDriver} onOpenChange={(open) => !open && setAssignDriver(null)}>
        <DialogContent>
          {assignDriver && (
            <>
              <DialogHeader>
                <DialogTitle>Assign Vehicle</DialogTitle>
                <DialogDescription>Assign an available vehicle to {assignDriver.user?.name || 'driver'}.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Available Vehicles</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    title="Select Vehicle"
                    value={assignVehicleId}
                    onChange={(e) => setAssignVehicleId(e.target.value)}
                  >
                    <option value="">Select vehicle</option>
                    {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id} disabled={!isVehicleAssignable(vehicle)}>
                          {vehicle.licensePlate} - {vehicle.type}{!isVehicleAssignable(vehicle) ? ' (Unavailable)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setAssignDriver(null)}>Cancel</Button>
                  <Button className="flex-1" onClick={assignVehicleToDriver} disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Assign
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
