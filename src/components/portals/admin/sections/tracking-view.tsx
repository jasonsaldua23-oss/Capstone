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
import { buildDeliveredTransactions, deliveredTransactionPin } from '@/lib/delivered-transactions'
import { LiveTrackingPage } from '@/components/portals/shared/live-tracking-page'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

const recordedAtMs = (point: any) =>
  new Date(point?.recordedAt || point?.recorded_at || point?.createdAt || point?.created_at || 0).getTime()

// The phone's own ground speed in m/s, forwarded to the map so its motion model
// can tell a parked vehicle from GPS noise: without it the icon reads the wander
// of a standing vehicle as movement and drifts around the stop. A missing or
// negative reading (iOS reports -1 for "unknown") is no reading, not a standstill.
const reportedSpeedMps = (point: any) => {
  const speed = Number(point?.speed)
  return Number.isFinite(speed) && speed >= 0 ? speed : undefined
}

export function TrackingView() {
  const [trips, setTrips] = useState<any[]>([])
  const [driverLocations, setDriverLocations] = useState<any[]>([])
  const [ordersForMap, setOrdersForMap] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [trackingDate, setTrackingDate] = useState(formatDayKey(new Date()))

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

  // Just the driver dots, not the trips and orders around them. Positions change
  // every few seconds while the whole tracking payload does not, so movement is
  // refreshed on its own instead of re-reading every trip and order to get it.
  const fetchDriverPositions = async () => {
    const response = await safeFetchJson('/api/trips?page=1&pageSize=1&includeTracking=1', { cache: 'no-store' })
    if (response.ok) setDriverLocations(toArray<any>(response.data?.driverLocations))
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
      } else if (scopes.includes('tracking') && document.visibilityState === 'visible') {
        void fetchDriverPositions()
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
  // Deliveries belong to the day they happened; completed trips are no longer drawn,
  // so without this the day's deliveries disappeared once their trip finished.
  const deliveredTransactions = useMemo(
    () => buildDeliveredTransactions({ trips, orders: ordersForMap, dayKey: trackingDate || formatDayKey(new Date()) }),
    [ordersForMap, trackingDate, trips]
  )

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
      speedMps?: number
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
    // A driver can hold several IN_PROGRESS trips at once but is only ever in one
    // place, so the trip loop below must emit a single marker for them. Without
    // this, every extra trip pushed another marker with the same `driver-<id>`
    // key and React discarded all but one of them.
    const driverMarkerSlots = new Map<string, { index: number; recordedAt: number }>()
    const latestDriverPointById = new Map<string, any>(
      driverLocations
        .map((location: any) => [String(location?.driverId || location?.driver_id || '').trim(), location] as const)
        .filter(([driverId]) => Boolean(driverId))
    )

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
        toCoordinate(trip?.warehouse?.latitude)
      const warehouseStartLng =
        toCoordinate(trip?.warehouseLongitude) ??
        toCoordinate(trip?.warehouse?.longitude)
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
      const driverName = String(trip?.driver?.user?.name || trip?.driver?.name || 'Driver')
      const driverId = String(trip?.driver?.id || '').trim()
      // The trip payload is re-read only when a trip changes; the driver's own
      // position is refreshed on its own scope every few seconds. Whichever of
      // them was recorded last is where the vehicle actually is.
      const livePoint = latestDriverPointById.get(driverId)
      const freshestPoint = [latestLog, latestLocation, livePoint]
        .filter((point) => Number.isFinite(Number(point?.latitude ?? point?.lat)))
        .sort((a, b) => recordedAtMs(a) - recordedAtMs(b))
        .pop()
      const driverLat = Number(freshestPoint?.latitude ?? freshestPoint?.lat)
      const driverLng = Number(freshestPoint?.longitude ?? freshestPoint?.lng)
      const hasDriverPosition = Number.isFinite(driverLat) && Number.isFinite(driverLng)
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
        const driverMarkerId = `driver-${driverId || trip.id}`
        const driverMarker = {
          id: driverMarkerId,
          driverName,
          vehiclePlate,
          lat: driverLat,
          lng: driverLng,
          status: String(trip?.status || 'IN_PROGRESS'),
          markerColor: '#1d4ed8',
          markerLabel: 'Current location',
          markerType: 'truck' as const,
          markerHeading: markerHeading ?? undefined,
          speedMps: reportedSpeedMps(freshestPoint),
          // Drawn along its remaining route between reports, not in straight lines.
          roadLineId: `remaining-${trip.id}`,
          // Added: provide the assignment details rendered by the shared truck popup.
          assignedTripNumber: String(trip?.tripNumber || ''),
          destinationCustomer: String(nextDropPoint?.locationName || 'N/A'),
        }
        // Keep whichever of this driver's trips carries their most recent fix, so
        // the marker shows where they actually are rather than whichever trip the
        // API happened to return first.
        const markerRecordedAt = recordedAtMs(freshestPoint)
        const existingSlot = driverMarkerSlots.get(driverMarkerId)
        if (!existingSlot) {
          driverMarkerSlots.set(driverMarkerId, { index: locations.length, recordedAt: markerRecordedAt })
          locations.push(driverMarker)
        } else if (markerRecordedAt > existingSlot.recordedAt) {
          locations[existingSlot.index] = driverMarker
          existingSlot.recordedAt = markerRecordedAt
        }
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

    deliveredTransactions.forEach((delivery) => {
      // Stops of a trip still in progress are already drawn above as Completed.
      if (tripOrderIds.has(delivery.orderId)) return
      tripOrderIds.add(delivery.orderId)
      const pin = deliveredTransactionPin(delivery)
      if (pin) locations.push(pin)
    })

    // Fix: trucks exist only for the trips in the loop above, i.e. the ones
    // IN_PROGRESS on the tracking day. The old "last known location" pass put a
    // truck on the map for every driver with a fix that day, so drivers whose
    // trip had already been completed (or who had no trip at all) kept showing
    // as if they were still out delivering. `driverLocations` now only feeds the
    // live position of a driver who is on an active trip.

    dayOrders.forEach((order: any) => {
      const orderId = String(order?.id || '').trim()
      if (orderId && tripOrderIds.has(orderId)) return
      // A delivered order is shown on the day it was delivered (above), not its scheduled day.
      if (isCompletedOrderStatus(order?.status)) return

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
  }, [deliveredTransactions, driverLocations, ordersForMap, trackingDate, trips])

  const mapLocations = mapData.locations
  const routeLines = mapData.routeLines

  const mapCenter = (mapLocations[0]
    ? [mapLocations[0].lat, mapLocations[0].lng]
    : [10.55, 122.95]) as [number, number]

  return (
    <LiveTrackingPage
      trackingDate={trackingDate}
      onTrackingDateChange={setTrackingDate}
      onRefresh={() => void fetchTrackingTrips()}
      isRefreshing={isLoading}
      activeTrips={activeTrips}
      deliveries={deliveredTransactions}
      recentLocations={recentLocations}
      isLoadingTrips={isLoading}
      map={
        <LiveTrackingMap
          locations={mapLocations}
          routeLines={routeLines}
          center={mapCenter}
          zoom={mapLocations.length > 0 ? 12 : 10}
          className="h-full w-full"
          restrictToNegrosOccidental
          showDriverSelfBadge={false}
        />
      }
    />
  )
}
