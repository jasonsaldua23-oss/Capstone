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
import { Skeleton } from '@/components/ui/skeleton'
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
  fetchAllPaginatedCollection,
  safeFetchJson,
} from './shared'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function TrackingView() {
  const [trips, setTrips] = useState<any[]>([])
  const [driverLocations, setDriverLocations] = useState<any[]>([])
  const [ordersForMap, setOrdersForMap] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [trackingDate, setTrackingDate] = useState(formatDayKey(new Date()))
  const [activeTripsPage, setActiveTripsPage] = useState(1)
  const activeTripsPageSize = 10

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

  const orderMatchesTrackingDay = (order: any) => {
    if (!trackingDate) return true
    // Strict filter: an order belongs to its scheduled delivery day, not its creation day.
    return isDateMatch(order?.deliveryDate, trackingDate)
  }

  const tripMatchesTrackingDay = (trip: any) => {
    if (!trackingDate) return true
    const scheduledDates = [
      trip?.tripSchedule,
      ...toArray<any>(trip?.dropPoints).flatMap((point) => [
        point?.order?.deliveryDate,
        point?.order?.timeline?.deliveryDate,
        point?.deliveryDate,
      ]),
    ].filter(Boolean)
    if (scheduledDates.length > 0) {
      return scheduledDates.some((value) => isDateMatch(value, trackingDate))
    }
    // Legacy trips without order schedules use only their planned start date.
    return isDateMatch(trip?.plannedStartAt, trackingDate)
  }
  const dropPointMatchesTrackingDay = (dropPoint: any) => {
    if (!trackingDate) return true
    return [
      dropPoint?.order?.deliveryDate,
      dropPoint?.order?.timeline?.deliveryDate,
      dropPoint?.deliveryDate,
    ].some((value) => isDateMatch(value, trackingDate))
  }

  const fetchTrackingTrips = async () => {
    setIsLoading(true)
    try {
      const query = new URLSearchParams({
        includeTracking: '1',
        trackingDate,
      })
      const [tripsResponse, ordersResponse] = await Promise.all([
        fetchAllPaginatedCollection<any>(
          `/api/trips?${query.toString()}`,
          'trips',
          { cache: 'no-store' },
          { retries: 3, timeoutMs: 15000, pageSize: 500, maxPages: 100 }
        ),
        fetchAllPaginatedCollection<any>(
          '/api/orders?includeItems=none',
          'orders',
          { cache: 'no-store' },
          { retries: 3, timeoutMs: 15000, pageSize: 200, maxPages: 100 }
        ),
      ])

      setTrips(tripsResponse.ok ? getCollection(tripsResponse.data, ['trips']) : [])
      setDriverLocations(tripsResponse.ok ? toArray<any>(tripsResponse.data?.driverLocations) : [])
      setOrdersForMap(ordersResponse.ok ? getCollection(ordersResponse.data, ['orders']) : [])
    } catch (error) {
      console.error('Failed to fetch live tracking data:', error)
      setTrips([])
      setDriverLocations([])
      setOrdersForMap([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTrackingTrips()
  }, [trackingDate])

  useEffect(() => {
    const refreshLive = () => {
      if (document.visibilityState !== 'visible') return
      void fetchTrackingTrips()
    }

    const unsubscribe = subscribeDataSync((message) => {
      const scopes = message.scopes || []
      if (scopes.includes('trips') || scopes.includes('orders')) {
        refreshLive()
      }
    })

    const onFocus = () => refreshLive()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshLive()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [trackingDate])

  const activeTrips = useMemo(
    () => trips.filter((trip: any) => ['IN_PROGRESS'].includes(normalizeTripStatus(trip?.status)) && tripMatchesTrackingDay(trip)),
    [trackingDate, trips]
  )
  const totalActiveTripsPages = Math.max(1, Math.ceil(activeTrips.length / activeTripsPageSize))
  const paginatedActiveTrips = useMemo(() => {
    const start = (activeTripsPage - 1) * activeTripsPageSize
    return activeTrips.slice(start, start + activeTripsPageSize)
  }, [activeTrips, activeTripsPage])

  useEffect(() => {
    setActiveTripsPage(1)
  }, [activeTrips.length, trackingDate])

  useEffect(() => {
    if (activeTripsPage > totalActiveTripsPages) {
      setActiveTripsPage(totalActiveTripsPages)
    }
  }, [activeTripsPage, totalActiveTripsPages])

  const recentLocations = trips
    .filter((trip: any) => tripMatchesTrackingDay(trip))
    .flatMap((trip: any) => toArray<any>(trip.locationLogs || []))
    .filter((log) => isDateMatch(log?.recordedAt || log?.createdAt, trackingDate))
    .filter((log) => Number.isFinite(Number(log?.latitude)) && Number.isFinite(Number(log?.longitude)))
    .map((log) => ({
      ...log,
      latitude: Number(log.latitude),
      longitude: Number(log.longitude),
    }))
    .sort((a, b) => new Date(b.recordedAt || 0).getTime() - new Date(a.recordedAt || 0).getTime())
    .slice(0, 5)

  const mapData = useMemo(() => {
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
      assignedTripNumber?: string
      destinationCustomer?: string
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

    const tripsForMap = trips.filter((trip: any) =>
      ['IN_PROGRESS'].includes(normalizeTripStatus(trip?.status)) && tripMatchesTrackingDay(trip)
    )
    const cancelledOrderIds = new Set(
      ordersForMap
        .filter((order: any) => isCancelledLikeStatus(order?.status))
        .map((order: any) => String(order?.id || '').trim())
        .filter(Boolean)
    )
    const dayOrders = ordersForMap.filter((order: any) => orderMatchesTrackingDay(order) && !isCancelledLikeStatus(order?.status))
    const dayOrderIds = new Set(
      dayOrders.map((order: any) => String(order?.id || '').trim()).filter(Boolean)
    )
    const tripOrderIds = new Set<string>()
    const shownDriverIds = new Set<string>()

    tripsForMap.forEach((trip: any) => {
      const normalizedTripStatus = normalizeTripStatus(trip?.status)
      const tripMatchesDay = tripMatchesTrackingDay(trip)
      const toCoordinate = (value: unknown) => {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
      }
      const allEligibleDropPoints = toArray<any>(trip.dropPoints)
        .filter((point) => {
          const orderId = String(point?.orderId || '').trim()
          if (orderId && cancelledOrderIds.has(orderId)) return false
          if (isCancelledLikeStatus(point?.status) || isCancelledLikeStatus(point?.orderStatus) || isCancelledLikeStatus(point?.order?.status)) return false
          return true
        })
        .filter((point) => typeof point?.latitude === 'number' && typeof point?.longitude === 'number')
        .sort((a, b) => Number(a?.sequence || 0) - Number(b?.sequence || 0))

      const dropPointsFilteredByDate = allEligibleDropPoints
        .filter((point) => {
          const orderId = String(point?.orderId || '').trim()
          if (dropPointMatchesTrackingDay(point)) return true
          if (tripMatchesDay && !trackingDate) return true
          if (!orderId) return false
          return dayOrderIds.has(orderId)
        })
      const hasScheduledDropPoints = allEligibleDropPoints.some((point) => [
        point?.order?.deliveryDate,
        point?.order?.timeline?.deliveryDate,
        point?.deliveryDate,
      ].some(Boolean))
      // Do not leak orders from another scheduled day; only legacy undated trips fall back.
      const dropPoints = dropPointsFilteredByDate.length > 0
        ? dropPointsFilteredByDate
        : hasScheduledDropPoints
          ? []
          : allEligibleDropPoints
      
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

      const logs = toArray<any>(trip.locationLogs)
        .filter((log) => isDateMatch(log?.recordedAt || log?.createdAt, trackingDate))
        .filter((log) => Number.isFinite(Number(log?.latitude)) && Number.isFinite(Number(log?.longitude)))
        .map((log) => ({
          ...log,
          latitude: Number(log.latitude),
          longitude: Number(log.longitude),
        }))
        .sort((a, b) => new Date(a.recordedAt || 0).getTime() - new Date(b.recordedAt || 0).getTime())

      const latestLog = logs[logs.length - 1]
      const latestLocation = trip.latestLocation
      const driverLat = Number(latestLog?.latitude ?? latestLocation?.latitude)
      const driverLng = Number(latestLog?.longitude ?? latestLocation?.longitude)
      const hasDriverPosition = Number.isFinite(driverLat) && Number.isFinite(driverLng)
      const driverName = String(trip?.driver?.user?.name || trip?.driver?.name || 'Driver')
      const driverId = String(trip?.driver?.id || '').trim()
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

      if (hasDriverPosition && ['IN_PROGRESS'].includes(normalizedTripStatus)) {
        if (driverId) shownDriverIds.add(driverId)
        locations.push({
          id: `driver-${driverId || trip.id}`,
          driverName,
          vehiclePlate,
          lat: driverLat,
          lng: driverLng,
          status: String(trip?.status || 'IN_PROGRESS'),
          markerColor: '#1d4ed8',
          markerLabel: 'Current location',
          markerType: 'truck',
          markerHeading: markerHeading ?? undefined,
          // Added: provide the assignment details rendered by the shared truck popup.
          assignedTripNumber: String(trip?.tripNumber || ''),
          destinationCustomer: String(nextDropPoint?.locationName || 'N/A'),
        })
      }

      dropPoints.forEach((dropPoint: any, index: number) => {
        const dropPointOrderId = String(dropPoint?.orderId || '').trim()
        if (dropPointOrderId) tripOrderIds.add(dropPointOrderId)
        const dpStatus = String(dropPoint?.status || '').toUpperCase()
        const isCancelledOrFailed = ['FAILED', 'CANCELLED', 'SKIPPED'].includes(dpStatus)

        const completed = isDropPointCompleted(dropPoint?.status) || isDropPointCompleted(dropPoint?.orderStatus)
        const isNext = index === nextPendingIndex
        const stopSequence = Number.isFinite(Number(dropPoint?.sequence)) ? Number(dropPoint.sequence) : undefined
        
        locations.push({
          id: `order-${trip.id}-${dropPoint.id || dropPoint.sequence}`,
          driverName: String(dropPoint.orderNumber || dropPoint.locationName || dropPoint.address || 'Order Stop'),
          vehiclePlate: String(dropPoint.locationName || trip?.tripNumber || 'Trip'),
          lat: Number(dropPoint.latitude),
          lng: Number(dropPoint.longitude),
          status: String(dropPoint.orderStatus || dropPoint.status || 'PENDING'),
          markerColor: completed ? '#2563eb' : (isNext ? '#ef4444' : '#16a34a'),
          markerType: 'pin',
          markerLabel: isCancelledOrFailed ? 'Cancelled' : (completed ? 'Completed' : (isNext ? 'Next Stop' : 'Upcoming')),
          markerNumber: stopSequence,
        })
      })

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
          id: `completed-${trip.id}`,
          points: passedPathPoints,
          color: '#93c5fd',
          label: `${trip.tripNumber || 'Trip'} - Completed route`,
          opacity: 0.85,
          weight: 6,
          dashArray: '7 9',
          snapToRoad: true,
        })
      } else if (hasDriverPosition && warehouseStart) {
        // Fallback so "path taken" is still visible even with sparse GPS logs.
        routeLines.push({
          id: `completed-fallback-${trip.id}`,
          points: [warehouseStart, [driverLat, driverLng]],
          color: '#93c5fd',
          label: `${trip.tripNumber || 'Trip'} - Completed route`,
          opacity: 0.85,
          weight: 6,
          dashArray: '7 9',
          snapToRoad: true,
        })
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

    // Fix: show every active driver's latest saved GPS point even when their
    // last location belongs to a completed trip or is not linked to a trip.
    driverLocations.forEach((location: any) => {
      const driverId = String(location?.driverId || location?.driver_id || '').trim()
      const assignedTrip = trips.find((trip: any) => String(trip?.id || '') === String(location?.tripId || location?.trip_id || ''))
      const destinationPoint = toArray<any>(assignedTrip?.dropPoints)
        .slice()
        .sort((a, b) => Number(a?.sequence || 0) - Number(b?.sequence || 0))
        .find((point) => !isDropPointCompleted(point?.status) && !isDropPointCompleted(point?.orderStatus))
      const latitude = Number(location?.latitude ?? location?.lat)
      const longitude = Number(location?.longitude ?? location?.lng)
      if (!driverId || shownDriverIds.has(driverId)) return
      if (!isDateMatch(location?.recordedAt || location?.createdAt, trackingDate)) return
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
      shownDriverIds.add(driverId)
      locations.push({
        id: `driver-${driverId}`,
        driverName: String(location?.driverName || 'Driver'),
        vehiclePlate: String(location?.vehiclePlate || 'N/A'),
        lat: latitude,
        lng: longitude,
        status: String(location?.tripStatus || 'LOCATION_AVAILABLE'),
        markerColor: '#1d4ed8',
        markerLabel: 'Driver last known location',
        markerType: 'truck',
        markerHeading: Number.isFinite(Number(location?.heading)) ? Number(location.heading) : undefined,
        // Added: preserve known assignment data for last-known driver markers.
        assignedTripNumber: String(assignedTrip?.tripNumber || ''),
        destinationCustomer: String(destinationPoint?.locationName || 'N/A'),
      })
    })

    dayOrders.forEach((order: any) => {
      const orderId = String(order?.id || '').trim()
      if (orderId && tripOrderIds.has(orderId)) return

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
        id: `standalone-order-${order.id}`,
        driverName: String(order?.orderNumber || 'Order'),
        vehiclePlate: String(order?.shippingAddress || 'Customer location'),
        lat,
        lng,
        status: String(order?.status || 'PREPARING'),
        markerColor: completed ? '#2563eb' : '#16a34a',
        markerType: 'pin',
        markerLabel: orderAddressLabel,
      })
    })

    return { locations, routeLines }
  }, [driverLocations, ordersForMap, trackingDate, trips])

  const mapLocations = mapData.locations
  const routeLines = mapData.routeLines

  const mapCenter = (mapLocations[0]
    ? [mapLocations[0].lat, mapLocations[0].lng]
    : [10.55, 122.95]) as [number, number]

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Tracking</h1>
          <p className="text-gray-500">Monitor active deliveries in real-time</p>
        </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Input
            type="date"
            value={trackingDate}
            onChange={(event) => setTrackingDate(event.target.value)}
            className="w-full sm:w-[160px]"
          />
          <Button className="gap-2" onClick={fetchTrackingTrips} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            Refresh Map
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card className="h-[500px]">
            <CardContent className="p-0 h-full">
              <LiveTrackingMap
                locations={mapLocations}
                routeLines={routeLines}
                center={mapCenter}
                zoom={mapLocations.length > 0 ? 12 : 10}
                className="w-full h-full rounded-xl overflow-hidden"
                restrictToNegrosOccidental
                showDriverSelfBadge={false}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Active Trips</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                // Fix: mirror the compact trip-row layout so the loader remains
                // inside the narrow tracking sidebar at desktop breakpoints.
                <div className="space-y-3">
                  {Array.from({ length: 2 }).map((_, index) => (
                    <div key={`active-trip-skeleton-${index}`} className="flex min-w-0 items-center gap-3 rounded-lg bg-gray-50 p-2">
                      <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-24 max-w-full" />
                        <Skeleton className="h-3 w-36 max-w-full" />
                      </div>
                      <Skeleton className="h-6 w-10 shrink-0 rounded-md" />
                    </div>
                  ))}
                </div>
              ) : activeTrips.length === 0 ? (
                <p className="text-sm text-gray-500">No active trips right now</p>
              ) : (
                <div className="space-y-3">
                  {paginatedActiveTrips.map((trip: any) => (
                    <div key={trip.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                      <div className="bg-green-500 h-2 w-2 rounded-full animate-pulse"></div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{trip.tripNumber}</p>
                        <p className="text-xs text-gray-500">Driver: {trip.driver?.name || trip.driver?.user?.name || 'Unassigned'}</p>
                      </div>
                      <Badge variant="outline">
                        {trip.completedDropPoints || 0}/{trip.totalDropPoints || 0}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
              {!isLoading && activeTrips.length > 0 ? (
                <div className="mt-3 flex items-center justify-between border-t pt-3">
                  <p className="text-xs text-slate-500">
                    Showing {(activeTripsPage - 1) * activeTripsPageSize + 1}-{Math.min(activeTripsPage * activeTripsPageSize, activeTrips.length)} of {activeTrips.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={activeTripsPage <= 1}
                      onClick={() => setActiveTripsPage((prev) => Math.max(1, prev - 1))}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-slate-600">Page {activeTripsPage} of {totalActiveTripsPages}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={activeTripsPage >= totalActiveTripsPages}
                      onClick={() => setActiveTripsPage((prev) => Math.min(totalActiveTripsPages, prev + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Locations</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                // Fix: this card reads from the same trips fetch as Active Trips, so it
                // must show a loader too instead of claiming there are no logs.
                <div className="space-y-2 text-sm">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={`recent-location-skeleton-${index}`} className="flex min-w-0 items-center justify-between gap-2">
                      <Skeleton className="h-4 w-20 max-w-full" />
                      <Skeleton className="h-4 w-28 max-w-full" />
                    </div>
                  ))}
                </div>
              ) : recentLocations.length === 0 ? (
                <p className="text-sm text-gray-500">No coordinate logs available</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {recentLocations.map((log: any) => (
                    <div key={log.id} className="flex justify-between gap-2">
                      <span className="text-gray-500 truncate">
                        {new Date(log.recordedAt || log.createdAt || Date.now()).toLocaleTimeString()}
                      </span>
                      <span>{Number(log.latitude).toFixed(4)}, {Number(log.longitude).toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
