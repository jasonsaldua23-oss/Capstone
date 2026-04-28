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

  const isDateMatch = (value: unknown, dayKey: string) => {
    if (!value || !dayKey) return false
    const raw = String(value).trim()
    if (!raw) return false
    if (/^\d{4}-\d{2}-\d{2}/.test(raw) && raw.slice(0, 10) === dayKey) return true
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return false
    return formatDayKey(parsed) === dayKey
  }

  const orderMatchesTrackingDay = (order: any) => {
    if (!trackingDate) return true
    if (order?.deliveryDate) return isDateMatch(order.deliveryDate, trackingDate)
    return isDateMatch(order?.createdAt, trackingDate)
  }

  const tripMatchesTrackingDay = (trip: any) => {
    if (!trackingDate) return true
    const hasMatchingTripDate = [trip?.plannedStartAt, trip?.actualStartAt, trip?.actualEndAt, trip?.createdAt].some((value) =>
      isDateMatch(value, trackingDate)
    )
    if (hasMatchingTripDate) return true
    const logs = toArray<any>(trip?.locationLogs)
    if (logs.some((log) => isDateMatch(log?.recordedAt || log?.createdAt, trackingDate))) return true
    return isDateMatch(trip?.latestLocation?.recordedAt, trackingDate)
  }

  const fetchTrackingTrips = async () => {
    setIsLoading(true)
    try {
      const query = new URLSearchParams({
        limit: '200',
        includeTracking: '1',
      })
      if (trackingDate) query.set('trackingDate', trackingDate)
      const [tripsResponse, ordersResponse] = await Promise.all([
        safeFetchJson(`/api/trips?${query.toString()}`, { cache: 'no-store' }, { retries: 3, timeoutMs: 15000 }),
        fetchAllPaginatedCollection<any>(
          '/api/orders?includeItems=none',
          'orders',
          { cache: 'no-store' },
          { retries: 3, timeoutMs: 15000, pageSize: 200, maxPages: 100 }
        ),
      ])

      setTrips(tripsResponse.ok ? getCollection(tripsResponse.data, ['trips']) : [])
      setOrdersForMap(ordersResponse.ok ? getCollection(ordersResponse.data, ['orders']) : [])
    } catch (error) {
      console.error('Failed to fetch live tracking data:', error)
      setTrips([])
      setOrdersForMap([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTrackingTrips()
  }, [trackingDate])

  const activeTrips = useMemo(
    () => trips.filter((trip: any) => ['IN_PROGRESS'].includes(normalizeTripStatus(trip?.status))),
    [trips]
  )

  const recentLocations = activeTrips
    .flatMap((trip: any) => toArray<any>(trip.locationLogs || []))
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

    const tripsForMap = trips.filter(
      (trip: any) =>
        ['IN_PROGRESS'].includes(normalizeTripStatus(trip?.status)) &&
        tripMatchesTrackingDay(trip)
    )
    const dayOrders = ordersForMap.filter((order: any) => orderMatchesTrackingDay(order))
    const dayOrderIds = new Set(
      dayOrders.map((order: any) => String(order?.id || '').trim()).filter(Boolean)
    )
    const tripOrderIds = new Set<string>()

    tripsForMap.forEach((trip: any) => {
      const normalizedTripStatus = normalizeTripStatus(trip?.status)
      const tripMatchesDay = tripMatchesTrackingDay(trip)
      const toCoordinate = (value: unknown) => {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
      }
      const dropPoints = toArray<any>(trip.dropPoints)
        .filter((point) => {
          if (!trackingDate) return true
          if (tripMatchesDay) return true
          const orderId = String(point?.orderId || '').trim()
          if (!orderId) return false
          return dayOrderIds.has(orderId)
        })
        .filter((point) => typeof point?.latitude === 'number' && typeof point?.longitude === 'number')
        .sort((a, b) => Number(a?.sequence || 0) - Number(b?.sequence || 0))
      
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
        locations.push({
          id: `driver-${trip.id}`,
          driverName,
          vehiclePlate,
          lat: driverLat,
          lng: driverLng,
          status: String(trip?.status || 'IN_PROGRESS'),
          markerColor: '#1d4ed8',
          markerLabel: 'Current location',
          markerType: 'truck',
          markerHeading: markerHeading ?? undefined,
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

      if (logs.length > 1) {
        routeLines.push({
          id: `completed-${trip.id}`,
          points: logs.map((log: any) => [Number(log.latitude), Number(log.longitude)] as [number, number]),
          color: '#93c5fd',
          label: `${trip.tripNumber || 'Trip'} - Completed route`,
          opacity: 0.85,
          weight: 6,
          dashArray: '7 9',
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
  }, [ordersForMap, trackingDate, trips])

  const mapLocations = mapData.locations
  const routeLines = mapData.routeLines

  const mapCenter = (mapLocations[0]
    ? [mapLocations[0].lat, mapLocations[0].lng]
    : [10.55, 122.95]) as [number, number]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Tracking</h1>
          <p className="text-gray-500">Monitor active deliveries in real-time</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={trackingDate}
            onChange={(event) => setTrackingDate(event.target.value)}
            className="w-[160px]"
          />
          <Button className="gap-2" onClick={fetchTrackingTrips} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            Refresh Map
          </Button>
        </div>
      </div>

      <div className="text-sm text-slate-600">
        Route colors: <span className="font-medium text-blue-400">Muted blue dashed = Completed</span> |{' '}
        <span className="font-medium text-blue-700">Bright blue = Upcoming</span>
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
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : activeTrips.length === 0 ? (
                <p className="text-sm text-gray-500">No active trips right now</p>
              ) : (
                <div className="space-y-3">
                  {activeTrips.slice(0, 5).map((trip: any) => (
                    <div key={trip.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                      <div className="bg-green-500 h-2 w-2 rounded-full animate-pulse"></div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{trip.tripNumber}</p>
                        <p className="text-xs text-gray-500">Driver: {trip.driver?.user?.name || 'Unassigned'}</p>
                      </div>
                      <Badge variant="outline">
                        {trip.completedDropPoints || 0}/{trip.totalDropPoints || 0}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Locations</CardTitle>
            </CardHeader>
            <CardContent>
              {recentLocations.length === 0 ? (
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
