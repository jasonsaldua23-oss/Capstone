'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, CheckCircle, Clock, Route, Truck, LocateFixed, CalendarClock, Navigation, Phone, Package, ChevronRight, Trophy, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

type Trip = any
type AssignedOrderRow = {
  trip: Trip
  dropPoint: any
  order: {
    id?: string
    orderNumber?: string
    warehouseStage?: string
    warehouseName?: string
    warehouseCode?: string
    warehouseCity?: string
    warehouseProvince?: string
    loadedAt?: string | null
    checklistQuantityVerified?: boolean
    items?: Array<{
      id?: string
      quantity?: number
      product?: {
        name?: string
      }
      spareProducts?: {
        recommendedQuantity?: number
        totalLoadQuantity?: number
        recommendedPercent?: number
        minPercent?: number
        maxPercent?: number
      } | null
    }>
  }
}

export function HomeView({
  user,
  trips,
  isLoading,
  isTracking,
  locationPermission,
  currentLocation,
  onOpenTrips,
  onOpenActiveTrip,
  onStartTracking,
  loadingOrderId,
  onMarkOrderLoaded,
}: {
  user: any
  trips: Trip[]
  isLoading: boolean
  isTracking: boolean
  locationPermission: 'granted' | 'denied' | 'prompt'
  currentLocation: { lat: number; lng: number } | null
  onOpenTrips: () => void
  onOpenActiveTrip: (trip: Trip) => void
  onStartTracking: () => Promise<boolean>
  loadingOrderId: string | null
  onMarkOrderLoaded: (orderId: string) => Promise<boolean>
}) {
  const [loadChecklistByOrder, setLoadChecklistByOrder] = useState<Record<string, Record<string, boolean>>>({})
  const isCompletedTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'COMPLETED'
  const isInProgressTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'IN_PROGRESS'
  const isPlannedTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'PLANNED'
  const isSameLocalDate = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  const parseIsoDate = (raw: string | null | undefined) => {
    if (!raw) return null
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const getTripDayDate = (trip: Trip) => {
    return (
      parseIsoDate(trip.plannedStartAt) ||
      parseIsoDate(trip.actualStartAt) ||
      parseIsoDate(trip.createdAt) ||
      parseIsoDate(trip.updatedAt)
    )
  }
  const getTripScheduledDeliveryDates = (trip: Trip) =>
    (trip.dropPoints || [])
      .map((point) => parseIsoDate(point.order?.deliveryDate || null))
      .filter((value): value is Date => Boolean(value))
  const isTripForDay = (trip: Trip, day: Date) => {
    const scheduledDeliveryDates = getTripScheduledDeliveryDates(trip)
    if (scheduledDeliveryDates.length > 0) {
      return scheduledDeliveryDates.some((dateValue) => isSameLocalDate(dateValue, day))
    }
    const tripDate = getTripDayDate(trip)
    return tripDate ? isSameLocalDate(tripDate, day) : false
  }
  const formatWarehouseStage = (stage: string | null | undefined) => String(stage || 'READY_TO_LOAD').toUpperCase().replace(/_/g, ' ')
  const getSpareProductInfo = (item: NonNullable<AssignedOrderRow['order']['items']>[number]) => {
    const spareProducts = item.spareProducts
    if (!spareProducts) return null
    const recommendedQuantity = Number(spareProducts.recommendedQuantity || 0)
    if (recommendedQuantity <= 0) return null
    const totalLoadQuantity = Number(spareProducts.totalLoadQuantity ?? (Number(item.quantity || 0) + recommendedQuantity))
    const recommendedPercent = Number(spareProducts.recommendedPercent || 0)
    const minPercent = Number(spareProducts.minPercent || 0)
    const maxPercent = Number(spareProducts.maxPercent || 0)
    return { recommendedQuantity, totalLoadQuantity, recommendedPercent, minPercent, maxPercent }
  }
  const isWarehouseChecklistComplete = (order: AssignedOrderRow['order']) =>
    Boolean(order?.checklistQuantityVerified)
  const stageBadgeStyles: Record<string, string> = {
    READY_TO_LOAD: 'bg-amber-100 text-amber-800 border border-amber-200',
    LOADED: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    DISPATCHED: 'bg-sky-100 text-sky-800 border border-sky-200',
  }
  const getTripRecency = (trip: Trip) => {
    const tripDate = getTripDayDate(trip)
    return tripDate ? tripDate.getTime() : 0
  }
  const sortTripsByPriority = (rows: Trip[]) => [...rows].sort((a, b) => {
    const rank = (status: string | null | undefined) => {
      const normalized = String(status || '').toUpperCase()
      if (normalized === 'IN_PROGRESS') return 0
      if (normalized === 'PLANNED') return 1
      if (normalized === 'COMPLETED') return 2
      return 3
    }
    const rankDiff = rank(a.status) - rank(b.status)
    if (rankDiff !== 0) return rankDiff
    return getTripRecency(b) - getTripRecency(a)
  })

  const today = new Date()
  const prioritizedTrips = sortTripsByPriority(trips)
  const tripsForToday = trips.filter((trip) => isTripForDay(trip, today))
  const activeTrip = prioritizedTrips.find((trip) => isInProgressTrip(trip.status)) || null
  const plannedTrips = tripsForToday.filter((trip) => isPlannedTrip(trip.status)).length
  const completedTrips = tripsForToday.filter((trip) => isCompletedTrip(trip.status)).length
  const driverDisplayName = [
    user?.name,
    user?.fullName,
    activeTrip?.driver?.user?.name,
    activeTrip?.driver?.name,
  ]
    .map((value) => String(value || '').trim())
    .find((value) => value.length > 0) || 'Driver'
  const terminalStopStatuses = new Set(['COMPLETED', 'DELIVERED', 'FAILED', 'SKIPPED', 'CANCELED', 'CANCELLED'])
  const pendingStops = activeTrip
    ? (activeTrip.dropPoints || []).filter((point) => !terminalStopStatuses.has(String(point.status || '').toUpperCase())).length
    : 0
  const assignedOrderRows: AssignedOrderRow[] = []
  const seenAssignedOrderIds = new Set<string>()
  const relevantTrips = prioritizedTrips

  for (const trip of relevantTrips) {
    for (const dropPoint of [...(trip.dropPoints || [])].sort((a, b) => a.sequence - b.sequence)) {
      const order = dropPoint.order
      const orderId = String(order?.id || '').trim()
      if (!order || !orderId || seenAssignedOrderIds.has(orderId)) continue
      seenAssignedOrderIds.add(orderId)
      assignedOrderRows.push({ trip, dropPoint, order })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-[1.6rem] border border-white/70 bg-[#cde4f3]/85 p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] shadow-[0_16px_30px_rgba(14,116,144,0.16)] backdrop-blur-xl md:p-5 md:pb-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1f3558]">DRIVER DASHBOARD</p>
        <h2 className="mt-1 text-[2rem] font-black leading-tight tracking-[-0.02em] text-[#0a1435]">Welcome, {driverDisplayName}</h2>
        <p className="text-[1.12rem] leading-relaxed text-[#223c5d]">Here is your delivery overview for today.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
          <CardContent className="min-h-[106px] pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-[#1f4d79]">Total Trips</p>
                <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{tripsForToday.length}</p>
              </div>
              <Route className="h-10 w-10 text-[#0f4f8f]" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
          <CardContent className="min-h-[106px] pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-[#1f4d79]">Planned</p>
                <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{plannedTrips}</p>
              </div>
              <CalendarClock className="h-10 w-10 text-[#0f4f8f]" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
          <CardContent className="min-h-[106px] pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-[#1f4d79]">Completed</p>
                <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{completedTrips}</p>
              </div>
              <Trophy className="h-10 w-10 text-[#0f4f8f]" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
          <CardContent className="min-h-[106px] pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium leading-tight text-[#1f4d79]">Pending Stops</p>
                <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{pendingStops}</p>
              </div>
              <RotateCcw className="h-10 w-10 text-[#0f4f8f]" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-[1.7rem] font-semibold tracking-[-0.01em] leading-tight">
            <span className="text-[#0f4f8f]">Current</span>{' '}
            <span className="text-[#2f9a34]">Assignment</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeTrip ? (
            <div className="space-y-2">
              <p className="font-semibold tracking-tight text-[#0e2442]">{activeTrip.tripNumber}</p>
              <p className="text-sm leading-relaxed text-[#1f3558]">
                {activeTrip.completedDropPoints}/{activeTrip.totalDropPoints} stops completed
              </p>
              <Button className="h-10 w-full rounded-xl bg-[#0d61ad] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(2,132,199,0.22)] hover:bg-[#0b579c]" onClick={() => onOpenActiveTrip(activeTrip)}>
                Open Active Trip
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[1.05rem] text-[#1f3558]">No active trip right now.</p>
              <Button className="h-10 w-full rounded-xl bg-[#0d61ad] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(2,132,199,0.22)] hover:bg-[#0b579c]" onClick={onOpenTrips}>
                View My Trips
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-[1.5rem] font-semibold tracking-[-0.01em] leading-tight text-[#0e2442]">
            Assigned Orders
          </CardTitle>
          <CardDescription className="text-[#46617f]">
            Drivers complete the checklist and mark orders as loaded here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {assignedOrderRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 px-4 py-8 text-center text-sm text-slate-500">
              No assigned orders available.
            </div>
          ) : (
            assignedOrderRows.map(({ trip, dropPoint, order }) => {
              const orderId = String(order.id || '')
              const warehouseStage = String(order.warehouseStage || 'READY_TO_LOAD').toUpperCase()
              const checklistDone = isWarehouseChecklistComplete(order)
              const pickupWarehouseName =
                String(order.warehouseName || '').trim() ||
                String(trip.warehouse?.name || '').trim() ||
                'N/A'
              const pickupWarehouseCode =
                String(order.warehouseCode || '').trim() ||
                String(trip.warehouse?.code || '').trim()
              const pickupWarehouseCity =
                String(order.warehouseCity || '').trim() ||
                String(trip.warehouse?.city || '').trim() ||
                ''
              const pickupWarehouseProvince =
                String(order.warehouseProvince || '').trim() ||
                String(trip.warehouse?.province || '').trim() ||
                ''
              const pickupWarehouseArea = [pickupWarehouseCity, pickupWarehouseProvince].filter(Boolean).join(', ')
              const defaultChecklist = Object.fromEntries(
                (order.items || []).flatMap((item) => {
                  const itemId = String(item.id)
                  const entries: [string, boolean][] = [[itemId, checklistDone]]
                  if (getSpareProductInfo(item)) entries.push([`${itemId}:spare`, checklistDone])
                  return entries
                })
              )
              const checklistState = loadChecklistByOrder[orderId] || defaultChecklist
              const itemChecklistValues = Object.keys(defaultChecklist).map((key) => Boolean(checklistState[key]))
              const allItemsChecked = itemChecklistValues.length > 0 && itemChecklistValues.every(Boolean)
              const canMarkLoaded = warehouseStage === 'READY_TO_LOAD'

              return (
                <div key={`${trip.id}-${dropPoint.id}-${orderId}`} className="rounded-2xl border border-slate-200 bg-white/92 p-3 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-bold tracking-tight text-slate-900">{order.orderNumber}</p>
                        <Badge className={stageBadgeStyles[warehouseStage] || 'bg-slate-100 text-slate-700 border border-slate-200'}>
                          {formatWarehouseStage(order.warehouseStage)}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-700">Trip {trip.tripNumber}</p>
                      <p className="text-sm text-slate-700">
                        Pickup {pickupWarehouseName}
                        {pickupWarehouseCode ? ` (${pickupWarehouseCode})` : ''}
                      </p>
                      {pickupWarehouseArea ? <p className="text-xs text-slate-500">{pickupWarehouseArea}</p> : null}
                      <p className="text-sm text-slate-600">Drop-off {dropPoint.locationName}, {dropPoint.city}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-2.5 py-1.5 text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Checklist</p>
                      <p className={`text-sm font-semibold ${checklistDone ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {checklistDone ? 'Completed' : 'Pending'}
                      </p>
                    </div>
                  </div>

                  {(order.items || []).length > 0 ? (
                    <div className="mt-2.5 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Assigned Items</p>
                      {(order.items || []).map((item) => {
                        const itemId = String(item.id)
                        const spareItemId = `${itemId}:spare`
                        const checked = Boolean(checklistState[itemId])
                        const spareProductInfo = getSpareProductInfo(item)
                        return (
                          <div key={itemId} className="space-y-2">
                          <label className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-1.5 text-sm ${checked ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-slate-50/80'}`}>
                            <div>
                              <p className="font-medium text-slate-900">{item.product?.name || 'Product'}</p>
                              <p className="text-xs text-slate-500">Qty {Number(item.quantity || 0)}</p>
                            </div>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canMarkLoaded || loadingOrderId === orderId}
                              onChange={(event) => {
                                const nextChecked = event.target.checked
                                setLoadChecklistByOrder((prev) => ({
                                  ...prev,
                                  [orderId]: {
                                    ...(prev[orderId] || defaultChecklist),
                                    [itemId]: nextChecked,
                                  },
                                }))
                              }}
                            />
                          </label>
                          {spareProductInfo ? (
                            <label className={`ml-4 flex items-center justify-between gap-3 rounded-xl border px-3 py-1.5 text-sm ${checklistState[spareItemId] ? 'border-blue-200 bg-blue-50/70' : 'border-slate-200 bg-slate-50/80'}`}>
                              <div>
                                <p className="font-medium text-slate-900">Spare products for {item.product?.name || 'Product'}</p>
                                <p className="text-xs text-slate-500">Qty {spareProductInfo.recommendedQuantity} | Total {spareProductInfo.totalLoadQuantity}</p>
                              </div>
                              <input
                                type="checkbox"
                                checked={Boolean(checklistState[spareItemId])}
                                disabled={!canMarkLoaded || loadingOrderId === orderId}
                                onChange={(event) => {
                                  const nextChecked = event.target.checked
                                  setLoadChecklistByOrder((prev) => ({
                                    ...prev,
                                    [orderId]: {
                                      ...(prev[orderId] || defaultChecklist),
                                      [spareItemId]: nextChecked,
                                    },
                                  }))
                                }}
                              />
                            </label>
                          ) : null}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">
                      No item details available for this order.
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      {warehouseStage === 'LOADED' || warehouseStage === 'DISPATCHED'
                        ? `Loaded status recorded${order.loadedAt ? ` on ${new Date(order.loadedAt).toLocaleString()}` : ''}.`
                        : 'Check all items before marking as loaded.'}
                    </div>
                    <Button
                      className="bg-amber-600 text-white hover:bg-amber-700"
                      disabled={!canMarkLoaded || !allItemsChecked || loadingOrderId === orderId}
                      onClick={async () => {
                        if (!orderId) return
                        if (!allItemsChecked) {
                          toast.error('Complete the checklist first.')
                          return
                        }
                        const done = await onMarkOrderLoaded(orderId)
                        if (done) {
                          setLoadChecklistByOrder((prev) => ({
                            ...prev,
                            [orderId]: Object.fromEntries(Object.keys(defaultChecklist).map((key) => [key, true])),
                          }))
                        }
                      }}
                    >
                      {loadingOrderId === orderId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {warehouseStage === 'LOADED' || warehouseStage === 'DISPATCHED' ? 'Loaded' : 'Mark Loaded'}
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}

