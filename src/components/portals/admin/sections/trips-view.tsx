'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
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

export function TripsView() {
    const [selectedTrip, setSelectedTrip] = useState<any | null>(null)
  const [tripToDelete, setTripToDelete] = useState<any | null>(null)
  const [deleteTripOpen, setDeleteTripOpen] = useState(false)
  const [isDeletingTrip, setIsDeletingTrip] = useState(false)
  const [trips, setTrips] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [vehicles, setVehicles] = useState<any[]>([])
  const [routePlans, setRoutePlans] = useState<any[]>([])
  const [savedRoutes, setSavedRoutes] = useState<any[]>([])
  const [routeDate, setRouteDate] = useState(getDefaultRouteDate())
  const [routeWarehouseId, setRouteWarehouseId] = useState('')
  const [selectedRouteCity, setSelectedRouteCity] = useState('')
  const [selectedRouteOrderIds, setSelectedRouteOrderIds] = useState<string[]>([])
  const [selectedSavedRouteId, setSelectedSavedRouteId] = useState('')
  const [selectedRouteDriverId, setSelectedRouteDriverId] = useState('')
  const [selectedRouteVehicleId, setSelectedRouteVehicleId] = useState('')
  const [createRouteOpen, setCreateRouteOpen] = useState(false)
  const [createTripOpen, setCreateTripOpen] = useState(false)
  const [loadingRoutePlans, setLoadingRoutePlans] = useState(false)
  const [creatingTripFromRoute, setCreatingTripFromRoute] = useState(false)
  const [routePlanMessage, setRoutePlanMessage] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const savedRoutesGetUnsupportedRef = useRef(false)

  // Auto-fill popup when opened
  useEffect(() => {
    if (createRouteOpen && warehouses.length > 0) {
      const effectiveWarehouseId = routeWarehouseId || warehouses[0].id
      const effectiveDate = routeDate || getDefaultRouteDate()
      if (!routeWarehouseId) setRouteWarehouseId(effectiveWarehouseId)
      if (!routeDate) setRouteDate(effectiveDate)
      // Always refresh whenever the route dialog is opened.
      void createRoutePlan(true, effectiveDate, effectiveWarehouseId)
    }
  }, [createRouteOpen, warehouses])

  // Auto-select all orders for first city group after filtering
  useEffect(() => {
    if (routePlans.length > 0 && selectedRouteCity === '') {
      const firstGroup = routePlans[0]
      if (firstGroup) {
        setSelectedRouteCity(firstGroup.city)
        setSelectedRouteOrderIds([])
      }
    }
  }, [routePlans])

  const selectedRouteGroup = routePlans.find((group) => group.city === selectedRouteCity) || null
  const selectedRouteOrders = toArray<any>(selectedRouteGroup?.orders).filter((order) => selectedRouteOrderIds.includes(order.id))
  const selectedSavedRoute = savedRoutes.find((route) => route.id === selectedSavedRouteId) || null
  const selectedDriverAssignedVehicle = toArray<any>(drivers.find((d) => d.id === selectedRouteDriverId)?.vehicles)
    .map((entry) => entry?.vehicle)
    .find((vehicle) => vehicle?.id)

  const fetchSavedRoutes = async () => {
    if (savedRoutesGetUnsupportedRef.current) return
    const result = await safeFetchJson('/api/trips/saved-routes?limit=200', { cache: 'no-store' }, { retries: 0, timeoutMs: 8000 })
    if (!result.ok) {
      if (Number(result.status || 0) === 405) {
        savedRoutesGetUnsupportedRef.current = true
      }
      console.error('Failed to fetch saved routes:', result.error || 'Request failed')
      setSavedRoutes([])
      return
    }
    setSavedRoutes(getCollection<any>(result.data, ['savedRoutes']))
  }

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

  useEffect(() => {
    async function fetchTripsAndMeta() {
      try {
        const [tripsResult, warehousesResult, driversResult, vehiclesResult, savedRoutesResult] = await Promise.all([
          safeFetchJson('/api/trips?limit=1000', { cache: 'no-store' }, { retries: 3, timeoutMs: 15000 }),
          safeFetchJson('/api/warehouses', { cache: 'no-store' }, { retries: 3, timeoutMs: 15000 }),
          safeFetchJson('/api/drivers', { cache: 'no-store' }, { retries: 3, timeoutMs: 15000 }),
          safeFetchJson('/api/vehicles?status=AVAILABLE', { cache: 'no-store' }, { retries: 3, timeoutMs: 15000 }),
          savedRoutesGetUnsupportedRef.current
            ? Promise.resolve({ ok: false as const, data: null, status: 405, error: 'Method Not Allowed' })
            : safeFetchJson('/api/trips/saved-routes?limit=200', { cache: 'no-store' }, { retries: 0, timeoutMs: 8000 }),
        ])

        setTrips(tripsResult.ok ? getCollection<any>(tripsResult.data, ['trips']) : [])

        if (warehousesResult.ok) {
          const list = getCollection<any>(warehousesResult.data, ['warehouses'])
          setWarehouses(list)
          if (list[0]?.id) {
            setRouteWarehouseId((prev) => prev || list[0].id)
          }
        }

        if (driversResult.ok) {
          const list = getCollection<any>(driversResult.data, ['drivers'])
          setDrivers(list)
          const preferredDriver =
            list.find((driver: any) => driver?.isActive !== false && toArray<any>(driver?.vehicles).some((entry: any) => entry?.vehicle?.id)) ||
            list.find((driver: any) => driver?.isActive !== false) ||
            list[0]

          if (preferredDriver?.id) {
            setSelectedRouteDriverId((prev) => prev || preferredDriver.id)
          }
        }

        if (vehiclesResult.ok) {
          const list = getCollection<any>(vehiclesResult.data, ['vehicles'])
          setVehicles(list)
          if (list[0]?.id) {
            setSelectedRouteVehicleId((prev) => prev || list[0].id)
          }
        }

        if (!savedRoutesResult.ok && Number((savedRoutesResult as any).status || 0) === 405) {
          savedRoutesGetUnsupportedRef.current = true
          setSavedRoutes([])
        } else {
          setSavedRoutes(savedRoutesResult.ok ? getCollection<any>(savedRoutesResult.data, ['savedRoutes']) : [])
        }
      } catch (error) {
        console.error('Failed to fetch trips meta:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchTripsAndMeta()
  }, [])

  const refreshTrips = async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading !== false
    if (showLoading) setIsLoading(true)
    try {
      const result = await safeFetchJson('/api/trips?limit=1000', { cache: 'no-store' }, { retries: 3, timeoutMs: 15000 })
      if (!result.ok) {
        throw new Error(result.error || 'Failed trips fetch')
      }
      setTrips(getCollection<any>(result.data, ['trips']))
    } catch (error) {
      console.error(error)
    } finally {
      if (showLoading) setIsLoading(false)
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const query = new URLSearchParams({
        date: effectiveDate,
        warehouseId: effectiveWarehouseId,
      });
      const response = await fetch(`/api/trips/route-plan?${query.toString()}`, {
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to generate route plan');
      }

      const plans = getCollection<any>(data, ['routePlans']);
      setRoutePlans(plans);
      setSelectedRouteCity(plans[0]?.city || '');
      setSelectedRouteOrderIds([]);
      if (plans.length === 0) {
        setRoutePlanMessage({
          type: 'info',
          text: 'No eligible orders found for that delivery date.',
        });
      } else {
        setRoutePlanMessage({ type: 'success', text: `Found ${plans.length} city group(s) for this delivery date.` });
        if (!silent) toast.success('Filtered scheduled orders by city')
      }
      return plans.length > 0;
    } catch (error: any) {
      const message =
        error?.name === 'AbortError' ? 'Request timed out. Please try again.' : error?.message || 'Failed to generate route plan';
      if (!silent) toast.error(message);
      setRoutePlanMessage({ type: 'error', text: message });
      setRoutePlans([]);
      setSelectedRouteCity('');
      setSelectedRouteOrderIds([]);
      return false;
    } finally {
      clearTimeout(timeout);
      setLoadingRoutePlans(false);
    }
  }

  const deleteTrip = async (trip: any) => {
    if (String(trip.status || '').toUpperCase() !== 'PLANNED') {
      toast.error('Only planned trips can be deleted')
      return
    }
    setIsDeletingTrip(true)
    try {
      const response = await fetch(`/api/trips/${trip.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to delete trip')
      }

      setSelectedTrip((current: any) => (current?.id === trip.id ? null : current))
      setTrips((prev) => prev.filter((entry: any) => entry.id !== trip.id))
      if (routeDate && routeWarehouseId) {
        await createRoutePlan(true, routeDate, routeWarehouseId)
      }
      await refreshTrips()
      await fetchSavedRoutes()
      emitDataSync(['trips', 'orders'])
      toast.success('Trip deleted')
      setDeleteTripOpen(false)
      setTripToDelete(null)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete trip')
    } finally {
      setIsDeletingTrip(false)
    }
  }

  const requestDeleteTrip = (trip: any) => {
    setTripToDelete(trip)
    setDeleteTripOpen(true)
  }

  const handleRouteOrderClick = (city: string, orderId: string) => {
    setSelectedRouteCity(city)
    setSelectedRouteOrderIds((prev) => {
      const belongsToCity = toArray<any>(routePlans.find((group) => group.city === city)?.orders).some((order) => order.id === orderId)
      if (!belongsToCity) return [orderId]
      if (prev.includes(orderId)) {
        const next = prev.filter((id) => id !== orderId)
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
        .map((token: string) => token.trim())
        .filter(Boolean)
      const barangayToken = tokens.find((token: string) => /\b(barangay|brgy\.?)\b/i.test(token))
      if (barangayToken) {
        return barangayToken.replace(/\bbrgy\.?\b/i, 'Barangay').replace(/\s+/g, ' ').trim()
      }
    }
    const fallbackCity = String(city || '').trim()
    return fallbackCity || 'N/A'
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
        setTrips((prev: any[]) => [createdTrip, ...prev.filter((trip: any) => trip.id !== createdTrip.id)])
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
        await refreshTrips({ showLoading: false })
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
        void refreshTrips({ showLoading: false })
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
    if (!selectedDriverAssignedVehicle?.id) {
      toast.error('Selected driver has no assigned vehicle')
      return
    }

    const group = routePlans.find((g) => g.city === selectedRouteCity)
    const selectedOrders = toArray<any>(group?.orders).filter((order) => selectedRouteOrderIds.includes(order.id))
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
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'Failed to create trip')
      }

      const createdTrip = data?.trip
      if (createdTrip) {
        setTrips((prev: any[]) => [createdTrip, ...prev.filter((trip: any) => trip.id !== createdTrip.id)])
      }

      setCreateRouteOpen(false)
      setSelectedRouteCity('')
      setSelectedRouteOrderIds([])
      setRoutePlans([])
      emitDataSync(['trips', 'orders'])
      void refreshTrips({ showLoading: false })
      toast.success('Trip created and assigned successfully')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create trip')
    } finally {
      setCreatingTripFromRoute(false)
    }
  }

  const statusColors: Record<string, string> = {
    PLANNED: 'bg-blue-100 text-blue-800',
    IN_PROGRESS: 'bg-green-100 text-green-800',
    COMPLETED: 'bg-gray-100 text-gray-800',
    CANCELLED: 'bg-red-100 text-red-800',
  }

  const formatTripScheduleDate = (value?: string | null) => {
    const raw = String(value || '').trim()
    if (!raw) return 'Not set'
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return raw
    return parsed.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <>
      <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trips</h1>
          <p className="text-gray-500">All trip records</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setCreateRouteOpen(true)}
            className="bg-black text-white hover:bg-black/90 rounded-xl px-4"
          >
            <Truck className="h-4 w-4 mr-2" />
            Create Trip
          </Button>
        </div>
      </div>

      <Card>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : trips.length === 0 ? (
            <div className="text-center py-12">
              <Truck className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No trips found</p>
              <Button className="mt-4">Create First Trip</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {trips.map((trip: any) => {
                const normalizedTripStatus = normalizeTripStatus(trip.status)
                const deleteAllowed = normalizedTripStatus === 'PLANNED'

                return (
                <div
                  key={trip.id}
                  className="rounded-xl border bg-white shadow-sm p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setSelectedTrip(trip)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xl font-semibold text-gray-900">{trip.tripNumber}</span>
                        <Badge className={`${statusColors[normalizedTripStatus] || 'bg-gray-100'} text-xs px-2 py-0.5`}>
                          {normalizedTripStatus.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <p className="text-[13px] text-gray-700">
                        Vehicle: {trip.vehicle?.licensePlate || 'Unassigned'} | Driver: {trip.driver?.user?.name || 'Unassigned'}
                      </p>
                      <p className="text-[13px] text-gray-600">
                        Route: {(trip.route?.start || trip.origin || 'Warehouse')} {'->'} {(trip.route?.end || trip.destination || trip.destinationCity || 'Destination')}
                      </p>
                      <p className="text-[13px] text-gray-600">
                        Schedule: {formatTripScheduleDate(trip.tripSchedule)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelectedTrip(trip)
                        }}
                      >
                        View Details
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs text-red-600 hover:text-red-700"
                        disabled={!deleteAllowed}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (!deleteAllowed) return
                          void deleteTrip(trip)
                        }}
                        title={deleteAllowed ? 'Delete trip' : 'Only planned trips can be deleted'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
                )
              })}
            </div>
          )}
        {/* Trip Details Dialog (outside conditional block) */}
        <Dialog open={!!selectedTrip} onOpenChange={(open) => !open && setSelectedTrip(null)}>
          <DialogContent className="max-w-3xl w-full">
            {selectedTrip && (
              (() => {
                const normalizedTripStatus = normalizeTripStatus(selectedTrip.status)
                const deleteAllowed = normalizedTripStatus === 'PLANNED'

                return (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-lg font-bold text-gray-900">{selectedTrip.tripNumber}</span>
                  <Badge className={statusColors[normalizedTripStatus] || 'bg-gray-100'}>{normalizedTripStatus.replace(/_/g, ' ')}</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-8 text-red-600 hover:text-red-700"
                    disabled={!deleteAllowed}
                    onClick={() => {
                      if (!deleteAllowed) return
                      void deleteTrip(selectedTrip)
                    }}
                    title={deleteAllowed ? 'Delete trip' : 'Only planned trips can be deleted'}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete Trip
                  </Button>
                </div>
                <div className="flex flex-wrap gap-6 mb-2 text-sm">
                  <div>
                    <span className="font-semibold">Vehicle:</span> {selectedTrip.vehicle?.licensePlate || 'Unassigned'}
                  </div>
                  <div>
                    <span className="font-semibold">Driver:</span> {selectedTrip.driver?.user?.name || 'Unassigned'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-6 mb-2 text-sm">
                  <div>
                    <span className="font-semibold">Progress:</span> {selectedTrip.completedDropPoints ?? 0}/{selectedTrip.totalDropPoints ?? 0}
                  </div>
                  <div>
                    <span className="font-semibold">Drop points:</span> {selectedTrip.dropPoints?.length ?? 0}
                  </div>
                  <div>
                    <span className="font-semibold">Schedule:</span> {formatTripScheduleDate(selectedTrip.tripSchedule)}
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
                )
              })()
            )}
          </DialogContent>
        </Dialog>
        </CardContent>
      </Card>


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
            <DialogTitle className="sr-only">Create Trip</DialogTitle>
          </DialogHeader>
          <div className="flex flex-row w-full h-full">
            {/* Left: Filters and Orders Preview */}
            <div className="flex flex-col bg-white border-r p-2.5 min-w-[260px] max-w-[300px] w-[280px]">
              <h2 className="mb-2 text-lg font-bold">Create Trip</h2>
              <div className="mb-2">
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
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div className="mb-2">
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
                  className="mt-1 h-9 w-full rounded-md border bg-white px-2.5 text-sm"
                >
                  <option value="">-- Choose Warehouse --</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} ({warehouse.city})
                    </option>
                  ))}
                </select>
              </div>
              <Button className="mt-1 mb-2 h-9 w-full bg-black text-sm text-white hover:bg-black/90" onClick={() => createRoutePlan(false, routeDate, routeWarehouseId)} disabled={loadingRoutePlans}>
                {loadingRoutePlans ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                Filter Orders
              </Button>
              
              {routePlanMessage && (
                <div className={`mb-2 rounded-lg p-2 text-[11px] ${routePlanMessage.type === 'error' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                  {routePlanMessage.text}
                </div>
              )}
              
              {/* Orders Preview below the filter button */}
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-gray-50 p-2.5">
                <h3 className="mb-1.5 text-base font-semibold">Orders by City</h3>
                {routePlans.length === 0 ? (
                  <div className="flex items-center justify-center text-sm text-gray-400 min-h-[80px]">
                    {loadingRoutePlans ? 'Loading orders...' : 'Pick a delivery date and warehouse to view orders by city'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {routePlans.map((cityGroup: any) => (
                      <div key={cityGroup.city}>
                        <button 
                          onClick={() => setSelectedRouteCity(cityGroup.city)}
                          className={`mb-1 w-full rounded-lg p-2 text-left text-sm font-semibold transition-colors ${
                            selectedRouteCity === cityGroup.city 
                              ? 'bg-blue-500 text-white' 
                              : 'bg-white border border-gray-200 text-gray-900 hover:border-blue-400'
                          }`}
                        >
                          {cityGroup.city} ({toArray<any>(cityGroup.orders).length} orders)
                        </button>
                        {selectedRouteCity === cityGroup.city && (
                          <div className="mb-2 space-y-1 pl-2">
                            {toArray<any>(cityGroup.orders).map((order: any) => (
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
                                </div>
                                <div className="text-xs text-gray-500 truncate">{getOrderBarangayLabel(order.address, order.city)}</div>
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
                <label className="text-[11px] font-medium text-gray-700">Assign Driver</label>
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  title="Assign Driver"
                  value={selectedRouteDriverId}
                  onChange={(e) => setSelectedRouteDriverId(e.target.value)}
                >
                  <option value="">Select driver</option>
                  {drivers.map((driver: any) => (
                    <option key={driver.id} value={driver.id} disabled={driver?.isActive === false}>
                      {(driver.user?.name || driver.name || driver.email || driver.id) + (driver?.isActive === false ? ' (Inactive)' : '')}
                    </option>
                  ))}
                </select>
                <Input
                  readOnly
                  className="h-8 text-xs"
                  value={selectedDriverAssignedVehicle?.licensePlate || 'No assigned vehicle'}
                />
                {!selectedDriverAssignedVehicle?.id && selectedRouteDriverId ? (
                  <p className="text-[11px] text-amber-600">Selected driver has no assigned vehicle.</p>
                ) : null}
                <Button
                  className="h-8 w-full bg-blue-600 text-sm text-white hover:bg-blue-700"
                  onClick={() => {
                    void createTripFromCurrentRoutePlan()
                  }}
                  disabled={
                    creatingTripFromRoute ||
                    loadingRoutePlans ||
                    !routeDate ||
                    !routeWarehouseId ||
                    !selectedRouteCity ||
                    selectedRouteOrderIds.length === 0 ||
                    !selectedRouteDriverId ||
                    !selectedDriverAssignedVehicle?.id
                  }
                >
                  {creatingTripFromRoute ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Create Trip
                </Button>
              </div>
            </div>
            {/* Right: Delivery Route Map or other content */}
            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-gray-50 p-6">
              {/* Delivery Route Map - styled like Warehouse Portal */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Delivery Locations</CardTitle>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="flex w-full flex-col items-center rounded-xl border bg-gray-50 p-4">
                    {/* Warehouse as starting point */}
                    {(() => {
                      const wh = warehouses.find((w) => w.id === routeWarehouseId);
                      if (!wh) return <div className="mb-4 text-gray-400">Select a warehouse to start</div>;
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
                              <div className="mt-0.5 text-[10px] text-gray-500">?? {wh.latitude}, {wh.longitude}</div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Delivery locations */}
                    <div className="flex w-full max-w-xl flex-col gap-2">
                      {(() => {
                        if (!routePlans || !selectedRouteCity) return null;
                        const group = routePlans.find((g) => g.city === selectedRouteCity);
                        if (!group) return null;
                        const selectedOrders = toArray(group.orders).filter((order: any) => selectedRouteOrderIds.includes(order.id));
                        return selectedOrders.map((order: any, idx: number) => (
                          <div key={order.id} className="flex items-start gap-2 rounded-lg border bg-white p-3">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white">{idx + 1}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-gray-900">{order.customerName || order.orderNumber}</div>
                              <div className="text-[11px] text-gray-600">{order.address || order.city || ''}</div>
                              {order.products && (
                                <div className="mt-0.5 text-[11px] text-gray-500">{order.products}</div>
                              )}
                              {order.latitude && order.longitude && (
                                <div className="mt-0.5 text-[11px] text-gray-500">?? {order.latitude}, {order.longitude}</div>
                              )}
                            </div>
                          </div>
                        ));
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
                {savedRoutes.map((route: any) => (
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
                {drivers.map((driver: any) => (
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
      {/* ...existing code... */}
      {/* End of TripsView */}
      </div>
    </>
  );
}
