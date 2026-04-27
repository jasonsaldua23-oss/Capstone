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

export function VehiclesView() {
  const [vehicles, setVehicles] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [historyVehicle, setHistoryVehicle] = useState<any | null>(null)
  const [editingVehicle, setEditingVehicle] = useState<any | null>(null)
  const [form, setForm] = useState({
    licensePlate: '',
    type: 'VAN',
    capacity: '',
    status: 'AVAILABLE',
    driverId: '',
  })

  const fetchVehicles = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/vehicles')
      if (response.ok) {
        const data = await response.json()
        setVehicles(getCollection<any>(data, ['vehicles']))
      }
    } catch (error) {
      console.error('Failed to fetch vehicles:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchDrivers = async () => {
    try {
      const response = await fetch('/api/drivers?active=true')
      if (response.ok) {
        const data = await response.json()
        const list = getCollection<any>(data, ['drivers'])
        if (list.length > 0) {
          setDrivers(list)
          return
        }
      }

      const fallbackResponse = await fetch('/api/drivers')
      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json()
        setDrivers(getCollection<any>(fallbackData, ['drivers']))
      }
    } catch (error) {
      console.error('Failed to fetch drivers:', error)
    }
  }

  useEffect(() => {
    fetchVehicles()
    fetchDrivers()
  }, [])

  const statusColors: Record<string, string> = {
    AVAILABLE: 'bg-green-100 text-green-800',
    IN_USE: 'bg-blue-100 text-blue-800',
    MAINTENANCE: 'bg-yellow-100 text-yellow-800',
    OUT_OF_SERVICE: 'bg-red-100 text-red-800',
  }

  const resetForm = () => {
    setForm({
      licensePlate: '',
      type: 'VAN',
      capacity: '',
      status: 'AVAILABLE',
      driverId: '',
    })
    setEditingVehicle(null)
  }

  const openEdit = (vehicle: any) => {
    setEditingVehicle(vehicle)
    setForm({
      licensePlate: vehicle.licensePlate || '',
      type: vehicle.type || 'VAN',
      capacity: vehicle.capacity ? String(vehicle.capacity) : '',
      status: vehicle.status || 'AVAILABLE',
      driverId: vehicle.drivers?.[0]?.driver?.id || '',
    })
    setEditOpen(true)
  }

  const driverSelectOptions = (() => {
    const list = [...drivers]
    if (form.driverId && !list.some((driver) => driver.id === form.driverId)) {
      const assignedName = editingVehicle?.drivers?.[0]?.driver?.user?.name || `Assigned Driver (${form.driverId})`
      list.unshift({ id: form.driverId, user: { name: assignedName } })
    }
    return list
  })()

  const saveVehicle = async (mode: 'create' | 'edit') => {
    if (!form.licensePlate.trim()) {
      toast.error('License plate is required')
      return
    }
    if (!form.type) {
      toast.error('Vehicle type is required')
      return
    }

    setIsSubmitting(true)
    try {
      const endpoint = '/api/vehicles'
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mode === 'edit' ? editingVehicle.id : undefined,
          licensePlate: form.licensePlate.trim().toUpperCase(),
          type: form.type,
          capacity: form.capacity ? Number(form.capacity) : null,
          status: form.status,
          driverId: form.driverId || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to save vehicle')
      }
      toast.success(mode === 'create' ? 'Vehicle added' : 'Vehicle updated')
      setAddOpen(false)
      setEditOpen(false)
      resetForm()
      await fetchVehicles()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save vehicle')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vehicles</h1>
          <p className="text-gray-500">Manage your delivery fleet</p>
        </div>
        <Button className="gap-2" onClick={() => setAddOpen(true)}>
          Add Vehicle
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : vehicles.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <p className="text-gray-500">No vehicles found</p>
            <Button className="mt-4">Add First Vehicle</Button>
          </div>
        ) : (
          vehicles.map((vehicle: any) => (
            <Card key={vehicle.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{vehicle.licensePlate}</h3>
                    <p className="text-sm text-gray-500">{vehicle.type || 'Vehicle'}</p>
                  </div>
                  <Badge className={statusColors[vehicle.status] || 'bg-gray-100'}>
                    {vehicle.status?.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500">Type:</span>
                    <span className="ml-1 font-medium">{vehicle.type}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Capacity:</span>
                    <span className="ml-1 font-medium">{vehicle.capacity || 'N/A'} kg</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">Assigned Driver:</span>
                    <span className="ml-1 font-medium">{vehicle.drivers?.[0]?.driver?.user?.name || 'Unassigned'}</span>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(vehicle)}>Edit</Button>
                  <Button variant="outline" size="sm" onClick={() => setHistoryVehicle(vehicle)}>History</Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (open) fetchDrivers(); if (!open) resetForm() }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Vehicle</DialogTitle>
            <DialogDescription>Create a new delivery vehicle.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-medium text-gray-700">License Plate</label>
              <Input value={form.licensePlate} onChange={(e) => setForm((f) => ({ ...f, licensePlate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Vehicle Type</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Vehicle Type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                <option value="VAN">VAN</option>
                <option value="TRUCK">TRUCK</option>
                <option value="MOTORCYCLE">MOTORCYCLE</option>
                <option value="CAR">CAR</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Vehicle Status</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Vehicle Status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="AVAILABLE">AVAILABLE</option>
                <option value="IN_USE">IN USE</option>
                <option value="MAINTENANCE">MAINTENANCE</option>
                <option value="OUT_OF_SERVICE">OUT OF SERVICE</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Capacity (kg)</label>
              <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              {/* Assign Driver Label and Select removed */}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveVehicle('create')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Vehicle
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (open) fetchDrivers(); if (!open) resetForm() }}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Vehicle</DialogTitle>
            <DialogDescription>Update vehicle details and status.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-medium text-gray-700">License Plate</label>
              <Input value={form.licensePlate} onChange={(e) => setForm((f) => ({ ...f, licensePlate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Vehicle Type</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Vehicle Type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                <option value="VAN">VAN</option>
                <option value="TRUCK">TRUCK</option>
                <option value="MOTORCYCLE">MOTORCYCLE</option>
                <option value="CAR">CAR</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Vehicle Status</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Vehicle Status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="AVAILABLE">AVAILABLE</option>
                <option value="IN_USE">IN USE</option>
                <option value="MAINTENANCE">MAINTENANCE</option>
                <option value="OUT_OF_SERVICE">OUT OF SERVICE</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Capacity (kg)</label>
              <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              {/* Assign Driver Label and Select removed */}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => saveVehicle('edit')} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyVehicle} onOpenChange={(open) => !open && setHistoryVehicle(null)}>
        <DialogContent>
          {historyVehicle && (
            <>
              <DialogHeader>
                <DialogTitle>Vehicle History - {historyVehicle.licensePlate}</DialogTitle>
                <DialogDescription>Vehicle lifecycle and maintenance fields.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="rounded-md border p-3">
                  <p><span className="text-gray-500">Status:</span> {historyVehicle.status?.replace(/_/g, ' ') || 'N/A'}</p>
                  <p><span className="text-gray-500">Mileage:</span> {historyVehicle.mileage ?? 0} km</p>
                  <p><span className="text-gray-500">Last Maintenance:</span> {historyVehicle.lastMaintenance ? new Date(historyVehicle.lastMaintenance).toLocaleDateString() : 'N/A'}</p>
                  <p><span className="text-gray-500">Next Maintenance:</span> {historyVehicle.nextMaintenance ? new Date(historyVehicle.nextMaintenance).toLocaleDateString() : 'N/A'}</p>
                  <p><span className="text-gray-500">Created:</span> {historyVehicle.createdAt ? new Date(historyVehicle.createdAt).toLocaleString() : 'N/A'}</p>
                </div>
                <Button variant="outline" className="w-full" onClick={() => setHistoryVehicle(null)}>Close</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
