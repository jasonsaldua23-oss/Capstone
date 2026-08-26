'use client'

import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getCollection } from './shared'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PortalCardsSkeleton } from '@/components/portals/shared/loading-skeletons'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Truck, Settings, Lock, Pencil } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import {
  VEHICLE_STATUS_OPTIONS,
  getVehicleTypes,
  getClassificationsForType,
  getPredefinedCapacity,
  formatCapacity,
  formatVehicleType,
  formatVehicleClassification,
  formatVehicleStatus,
} from '@/lib/vehicle-config'

export function VehiclesView() {
  const [vehicles, setVehicles] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<any | null>(null)
  const [historyVehicle, setHistoryVehicle] = useState<any | null>(null)
  const [form, setForm] = useState({
    licensePlate: '',
    brand: '',
    model: '',
    year: new Date().getFullYear().toString(),
    type: 'TRUCK',
    classification: 'LIGHT_DUTY',
    capacity: 2500,
    status: 'AVAILABLE',
    driverId: '',
    isActive: true,
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

  const resetForm = () => {
    setForm({
      licensePlate: '',
      brand: '',
      model: '',
      year: new Date().getFullYear().toString(),
      type: 'TRUCK',
      classification: 'LIGHT_DUTY',
      capacity: 2500,
      status: 'AVAILABLE',
      driverId: '',
      isActive: true,
    })
    setEditingVehicle(null)
  }

  const handleVehicleTypeChange = (newType: string) => {
    const classifications = getClassificationsForType(newType)
    const defaultClass = classifications[0]?.value || 'LIGHT_DUTY'
    const newCap = getPredefinedCapacity(newType, defaultClass)
    setForm((prev) => ({
      ...prev,
      type: newType,
      classification: defaultClass,
      capacity: newCap,
    }))
  }

  const handleClassificationChange = (newClass: string) => {
    const newCap = getPredefinedCapacity(form.type, newClass)
    setForm((prev) => ({
      ...prev,
      classification: newClass,
      capacity: newCap,
    }))
  }

  const openEdit = (vehicle: any) => {
    setEditingVehicle(vehicle)
    const vType = String(vehicle.type || 'TRUCK').toUpperCase()
    const vClass = String(vehicle.classification || 'LIGHT_DUTY').toUpperCase()
    const cap = getPredefinedCapacity(vType, vClass) || Number(vehicle.capacity) || 2500
    setForm({
      licensePlate: vehicle.licensePlate || '',
      brand: vehicle.brand || vehicle.make || '',
      model: vehicle.model || '',
      year: vehicle.year ? String(vehicle.year) : new Date().getFullYear().toString(),
      type: vType,
      classification: vClass,
      capacity: cap,
      status: String(vehicle.status || 'AVAILABLE').toUpperCase(),
      driverId: vehicle?.drivers?.[0]?.driver?.id || vehicle?.driverId || '',
      isActive: vehicle.isActive !== false,
    })
    setDialogOpen(true)
  }

  const isDriverAssignable = (driver: any) => {
    const status = String(driver?.status || '').toUpperCase()
    return driver?.isActive !== false && status !== 'INACTIVE'
  }

  const saveVehicle = async (mode: 'create' | 'edit') => {
    const rawPlate = form.licensePlate.trim()
    const normalizedPlate = rawPlate.toUpperCase()
    const duplicateVehicle = vehicles.find(
      (v) => (v.licensePlate || '').trim().toUpperCase() === normalizedPlate && (mode === 'create' || v.id !== editingVehicle?.id)
    )
    if (duplicateVehicle) {
      toast.error(`A vehicle with plate number ${rawPlate} already exists.`)
      return
    }

    if (!form.brand.trim()) {
      toast.error('Vehicle Brand / Make is required')
      return
    }
    if (!form.model.trim()) {
      toast.error('Model is required')
      return
    }
    const yearNum = parseInt(form.year, 10)
    if (!yearNum || isNaN(yearNum) || yearNum < 1900 || yearNum > 2100) {
      toast.error('Please enter a valid model year (e.g. 2024)')
      return
    }

    if (form.driverId) {
      const selectedDriverRecord = drivers.find((driver) => driver.id === form.driverId)
      if (selectedDriverRecord && !isDriverAssignable(selectedDriverRecord)) {
        toast.error('Selected driver is inactive and cannot be assigned')
        return
      }
      const existingVehicleWithDriver = vehicles.find(
        (v) => (v.driverId === form.driverId || v.driver?.id === form.driverId) && (mode === 'create' || v.id !== editingVehicle?.id)
      )
      if (existingVehicleWithDriver) {
        toast.error(`Driver is already assigned to vehicle ${existingVehicleWithDriver.licensePlate || 'another vehicle'}.`)
        return
      }
    }

    setIsSubmitting(true)
    try {
      const endpoint = '/api/vehicles'
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const calculatedCapacity = getPredefinedCapacity(form.type, form.classification)
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mode === 'edit' ? editingVehicle.id : undefined,
          licensePlate: form.licensePlate.trim().toUpperCase(),
          brand: form.brand.trim(),
          model: form.model.trim(),
          year: yearNum,
          type: String(form.type || '').toUpperCase(),
          classification: String(form.classification || '').toUpperCase(),
          capacity: calculatedCapacity,
          status: String(form.status || '').toUpperCase(),
          driverId: form.driverId || null,
          isActive: form.isActive,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to save vehicle')
      }
      toast.success(mode === 'create' ? 'Vehicle added' : 'Vehicle updated')
      setDialogOpen(false)
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
        <Button
          className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
          onClick={() => {
            resetForm()
            setDialogOpen(true)
          }}
        >
          Add Vehicle
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full">
            <PortalCardsSkeleton cards={6} className="lg:grid-cols-3" />
          </div>
        ) : vehicles.length === 0 ? (
          <div className="col-span-full text-center py-12">
            <p className="text-gray-500">No vehicles found</p>
            <Button
              className="mt-4 bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => {
                resetForm()
                setDialogOpen(true)
              }}
            >
              Add First Vehicle
            </Button>
          </div>
        ) : (
          vehicles.map((vehicle: any) => {
            const isMaint = String(vehicle.status || '').toUpperCase() === 'MAINTENANCE'
            const isInUse = String(vehicle.status || '').toUpperCase() === 'IN_USE'
            const isOutOfService = String(vehicle.status || '').toUpperCase() === 'OUT_OF_SERVICE'
            const statusBadgeClass = isMaint
              ? 'bg-amber-100 text-amber-800'
              : isInUse
              ? 'bg-blue-100 text-blue-800'
              : isOutOfService
              ? 'bg-red-100 text-red-800'
              : 'bg-emerald-100 text-emerald-800'

            return (
              <Card key={vehicle.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900">{vehicle.licensePlate}</h3>
                      <p className="text-sm text-slate-500">{vehicle.brand || vehicle.make ? `${vehicle.brand || vehicle.make} ${vehicle.model || ''}` : formatVehicleType(vehicle.type)}</p>
                    </div>
                    <Badge className={statusBadgeClass}>
                      {formatVehicleStatus(vehicle.status)}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm pt-2 border-t border-slate-100">
                    <div>
                      <span className="text-slate-500">Type:</span>
                      <span className="ml-1 font-medium text-slate-800">{formatVehicleType(vehicle.type)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Classification:</span>
                      <span className="ml-1 font-medium text-slate-800">{formatVehicleClassification(vehicle.classification)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Capacity:</span>
                      <span className="ml-1 font-semibold text-slate-900">{formatCapacity(vehicle.capacity)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Active:</span>
                      <span className="ml-1 font-medium text-slate-800">{vehicle.isActive !== false ? 'Yes' : 'No'}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-500">Driver:</span>
                      <span className="ml-1 font-medium text-slate-800">
                        {vehicle.driver?.name || vehicle.drivers?.[0]?.driver?.user?.name || vehicle.drivers?.[0]?.driver?.name || 'Unassigned'}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(vehicle)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setHistoryVehicle(vehicle)}>
                      History
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (open) fetchDrivers()
          if (!open) resetForm()
        }}
      >
        <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-slate-900">
              {editingVehicle ? 'Edit Vehicle' : 'Add New Vehicle'}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              {editingVehicle
                ? 'Update the vehicle profile and operational status.'
                : 'Enter the vehicle specifications and operational details.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* SECTION 1: VEHICLE INFORMATION */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 text-blue-600" />
                Vehicle Information
              </h4>
              <div className="space-y-3.5">
                {/* 1. License Plate & 2. Vehicle Brand / Make */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      License Plate <span className="text-red-500">*</span>
                    </label>
                    <Input
                      placeholder="Enter license plate"
                      value={form.licensePlate}
                      onChange={(e) => setForm((f) => ({ ...f, licensePlate: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Vehicle Brand / Make <span className="text-red-500">*</span>
                    </label>
                    <Input
                      placeholder="e.g. Isuzu, Hino, Mitsubishi, Toyota"
                      value={form.brand}
                      onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                {/* 3. Model & 4. Model Year */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Model <span className="text-red-500">*</span>
                    </label>
                    <Input
                      placeholder="e.g. N-Series, Elf, Canter"
                      value={form.model}
                      onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Model Year <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      placeholder="e.g. 2024"
                      min={1900}
                      max={2100}
                      value={form.year}
                      onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                {/* 5. Vehicle Type & 6. Vehicle Classification */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Vehicle Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={form.type}
                      onChange={(e) => handleVehicleTypeChange(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {getVehicleTypes().map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">
                      Vehicle Classification <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={form.classification}
                      onChange={(e) => handleClassificationChange(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {getClassificationsForType(form.type).map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label} ({formatCapacity(c.capacityKg)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 7. Weight Capacity (kg) (Read-only, Locked) */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700 flex items-center justify-between">
                    <span>Weight Capacity (kg)</span>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-normal">
                      <Lock className="h-3 w-3 text-slate-400" />
                      Locked
                    </span>
                  </label>
                  <div className="relative">
                    <Input
                      type="text"
                      readOnly
                      disabled
                      value={formatCapacity(form.capacity)}
                      className="bg-slate-50 text-slate-700 font-semibold border-slate-200 cursor-not-allowed pr-9"
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400">
                      <Lock className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Automatically determined based on the selected vehicle type and classification.
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200" />

            {/* SECTION 2: OPERATIONAL INFORMATION */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                <Settings className="h-3.5 w-3.5 text-blue-600" />
                Operational Information
              </h4>
              <div className="space-y-3.5">
                {/* 8. Status & 9. Assign Driver */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Status</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {VEHICLE_STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Assign Driver</label>
                    <select
                      value={form.driverId}
                      onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Unassigned</option>
                      {drivers.map((driver: any) => (
                        <option key={driver.id} value={driver.id} disabled={!isDriverAssignable(driver)}>
                          {(driver.user?.name || driver.name || driver.email || driver.id) + (!isDriverAssignable(driver) ? ' (Inactive)' : '')}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 10. Active / Inactive Toggle Switch */}
                <div className="flex items-center justify-between p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">Active Vehicle</span>
                      <Badge variant={form.isActive ? 'default' : 'secondary'} className={form.isActive ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : 'bg-slate-200 text-slate-600'}>
                        {form.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500">
                      Only active vehicles can be assigned to deliveries.
                    </p>
                  </div>
                  <Switch
                    checked={form.isActive}
                    onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-200">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false)
                resetForm()
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => saveVehicle(editingVehicle ? 'edit' : 'create')}
              disabled={isSubmitting || !form.licensePlate.trim() || !form.brand.trim() || !form.model.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white min-w-[120px]"
            >
              {isSubmitting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
              {editingVehicle ? 'Update Vehicle' : 'Add Vehicle'}
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
                <DialogDescription>Vehicle lifecycle and maintenance details.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="rounded-md border p-3 space-y-1 text-slate-700">
                  <p><span className="text-slate-500">Status:</span> {formatVehicleStatus(historyVehicle.status)}</p>
                  <p><span className="text-slate-500">Type:</span> {formatVehicleType(historyVehicle.type)} ({formatVehicleClassification(historyVehicle.classification)})</p>
                  <p><span className="text-slate-500">Capacity:</span> {formatCapacity(historyVehicle.capacity)}</p>
                  <p><span className="text-slate-500">Active:</span> {historyVehicle.isActive !== false ? 'Yes' : 'No'}</p>
                  <p><span className="text-slate-500">Created:</span> {historyVehicle.createdAt ? new Date(historyVehicle.createdAt).toLocaleString() : 'N/A'}</p>
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
