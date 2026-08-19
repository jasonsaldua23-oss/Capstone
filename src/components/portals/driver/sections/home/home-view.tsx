'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, CheckCircle, Clock, Route, Truck, LocateFixed, CalendarClock, Navigation, Phone, Package, ChevronRight, Trophy, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { WelcomePopup } from '@/components/portals/shared/welcome-popup'

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
    scheduledReplacement?: {
      replacementId?: string
      replacementNumber?: string
      quantityToReplace?: number
      quantityReplaced?: number
      quantityRemaining?: number
      unitMode?: string
      qtyPerUnit?: number
    } | null
    items?: Array<{
      id?: string
      quantity?: number
      product?: {
        name?: string
      }
    }>
  }
}

export function HomeView({
  user: _user,
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
  const [welcomeState] = useState(() => {
    if (typeof window === 'undefined') return { open: false, message: 'Welcome back!' }
    try {
      const raw = window.sessionStorage.getItem('driver_welcome_state')
      if (!raw) return { open: false, message: 'Welcome back!' }
      const parsed = JSON.parse(raw) as { name?: string }
      const name = String(parsed?.name || '').trim()
      window.sessionStorage.removeItem('driver_welcome_state')
      return {
        open: true,
        message: name ? `Welcome back, ${name}.` : 'Welcome back!',
      }
    } catch {
      return { open: false, message: 'Welcome back!' }
    }
  })
  const [showWelcomePopup, setShowWelcomePopup] = useState(welcomeState.open)
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
  const getItemDisplayNameWithSize = (item: NonNullable<AssignedOrderRow['order']['items']>[number]) => {
    const mixedItem: any = item
    if (mixedItem?.itemType === 'MIXED_CASE') {
      const components = (mixedItem.components || []).map((component: any) => `${component.productName} ${component.quantityPerCase}/case`).join(', ')
      return `Mixed Case (${mixedItem.caseCapacity || 0} units)${components ? ` — ${components}` : ''}`
    }
    const product: any = item?.product || {}
    const baseName = String(product?.name || 'Product').trim()
    const sizeFromArray = Array.isArray(product?.sizes) && product.sizes.length > 0
      ? product.sizes.map((value: any) => String(value).trim()).filter(Boolean).join(', ')
      : ''
    const sizeFromField = String(product?.size || product?.sizeLabel || (item as any)?.size || '').trim()
    const sizeLabel = sizeFromArray || sizeFromField
    return sizeLabel ? `${baseName} ${sizeLabel}` : baseName
  }
  const getItemCategoryLabel = (item: NonNullable<AssignedOrderRow['order']['items']>[number]) => {
    const product: any = item?.product || {}
    return String(
      product?.categoryName ||
      product?.category ||
      product?.productCategory ||
      (item as any)?.category ||
      ''
    ).trim()
  }
  const getItemQtyWithUnitLabel = (
    order: AssignedOrderRow['order'],
    item: NonNullable<AssignedOrderRow['order']['items']>[number],
  ) => {
    if ((item as any)?.itemType === 'MIXED_CASE') {
      const qty = Math.max(Number(item?.quantity || 0), 0)
      return `Qty ${qty} mixed case(s)`
    }
    const replacementMeta: any = (order as any)?.scheduledReplacement || null
    const replacementLines = Array.isArray(replacementMeta?.replacementLines) ? replacementMeta.replacementLines : []
    const productId = String((item as any)?.product?.id || (item as any)?.productId || '').trim()
    const productName = String((item as any)?.product?.name || (item as any)?.productName || '').trim().toLowerCase()
    const matchedReplacementLine = replacementLines.find((line: any) => {
      const replacementProductId = String(line?.replacementProductId || line?.originalProductId || '').trim()
      const replacementProductName = String(line?.replacementProductName || line?.originalProductName || line?.productName || '').trim().toLowerCase()
      return (productId && replacementProductId && productId === replacementProductId) || (productName && replacementProductName && productName === replacementProductName)
    })
    if (matchedReplacementLine && String(order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-')) {
      const lineInputMode = String(matchedReplacementLine?.lineInputMode || matchedReplacementLine?.replacementInputMode || '').trim().toLowerCase()
      const lineQty = Math.max(Number(matchedReplacementLine?.quantityToReplace || 0), 0)
      const lineQtyCases = Math.max(Number(matchedReplacementLine?.quantityToReplaceCases ?? matchedReplacementLine?.quantityToReplaceUnits ?? 0), 0)
      const lineQtyBottles = Math.max(Number(matchedReplacementLine?.quantityToReplaceBottles || 0), 0)
      const rawUnit = String(
        matchedReplacementLine?.replacementProductUnit ||
        matchedReplacementLine?.originalProductUnit ||
        (item as any)?.productUnit ||
        (item as any)?.unit ||
        (item as any)?.product?.unit ||
        ''
      ).trim().toLowerCase()
      const unitLabel =
        rawUnit.includes('pack') ? 'pack(s)'
          : rawUnit.includes('bundle') ? 'bundle(s)'
            : rawUnit.includes('case') ? 'case(s)'
              : 'unit(s)'
      if (lineInputMode === 'bottle') {
        const qty = lineQtyBottles > 0 ? lineQtyBottles : lineQty
        return `Qty ${qty} bottle(s)`
      }
      if (lineQtyCases > 0) {
        return `Qty ${lineQtyCases} ${unitLabel}`
      }
      const qtyPerUnit = Math.max(Number(matchedReplacementLine?.qtyPerUnit || matchedReplacementLine?.quantityPerCase || replacementMeta?.qtyPerUnit || 0), 0)
      if (qtyPerUnit > 0 && lineQty > 0) {
        const unitQty = lineQty / qtyPerUnit
        const unitText = Number.isInteger(unitQty) ? String(unitQty) : unitQty.toFixed(2).replace(/\.00$/, '')
        return `Qty ${unitText} ${unitLabel}`
      }
      if (lineQty > 0) {
        return `Qty ${lineQty} ${unitLabel}`
      }
    }
    const qty = Math.max(Number(item?.quantity || 0), 0)
    const product: any = item?.product || {}
    const unitHint = String(
      (item as any)?.productUnit ||
      (item as any)?.unit ||
      (item as any)?.replacementUnit ||
      product?.unit ||
      ''
    ).trim().toLowerCase()
    if (unitHint.includes('bottle')) {
      return `Qty ${qty} bottle(s)`
    }
    if (unitHint.includes('case')) {
      return `Qty ${qty} case(s)`
    }
    return `Qty ${qty} unit(s)`
  }
  const isWarehouseChecklistComplete = (order: AssignedOrderRow['order']) =>
    ['LOADED', 'DISPATCHED'].includes(String(order?.warehouseStage || '').toUpperCase())
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
  const terminalStopStatuses = new Set(['COMPLETED', 'DELIVERED', 'FAILED', 'SKIPPED', 'CANCELED', 'CANCELLED'])
  const pendingStops = activeTrip
    ? (activeTrip.dropPoints || []).filter((point) => !terminalStopStatuses.has(String(point.status || '').toUpperCase())).length
    : 0
  const assignedOrderRows: AssignedOrderRow[] = []
  const seenAssignedOrderIds = new Set<string>()
  const relevantTrips = prioritizedTrips.filter((trip) => isTripForDay(trip, today))

  for (const trip of relevantTrips) {
    for (const dropPoint of [...(trip.dropPoints || [])].sort((a, b) => a.sequence - b.sequence)) {
      const order = dropPoint.order
      const orderId = String(order?.id || '').trim()
      if (!order || !orderId || seenAssignedOrderIds.has(orderId)) continue
      seenAssignedOrderIds.add(orderId)
      assignedOrderRows.push({ trip, dropPoint, order })
    }
  }

  return (
    <>
      <WelcomePopup
        open={showWelcomePopup}
        message={welcomeState.message}
        subtitle="Check your assigned trips and complete deliveries on time."
        onClose={() => setShowWelcomePopup(false)}
        overlayClassName="bg-black/70"
        panelClassName="border-emerald-200 bg-[#eaf8f1]"
        titleClassName="text-slate-900"
        subtitleClassName="text-slate-600"
        buttonClassName="bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
      />
      {isLoading ? (
        <div className="space-y-4 rounded-[1.6rem] border border-white/70 bg-[#cde4f3]/85 p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] shadow-[0_16px_30px_rgba(14,116,144,0.16)] backdrop-blur-xl md:p-5 md:pb-5">
          <div className="space-y-2">
            <Skeleton className="h-3 w-36 bg-white/70" />
            <Skeleton className="h-10 w-64 max-w-full bg-white/75" />
            <Skeleton className="h-5 w-80 max-w-full bg-white/70" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={`driver-home-stat-skeleton-${index}`} className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
                <CardContent className="min-h-[106px] pt-4">
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-24 bg-slate-200/80" />
                    <Skeleton className="h-8 w-16 bg-slate-200/80" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
            <CardContent className="space-y-4 pt-4">
              <Skeleton className="h-6 w-56 bg-slate-200/80" />
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={`driver-home-row-skeleton-${index}`} className="h-20 w-full rounded-xl bg-slate-200/80" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-4 rounded-[1.6rem] border border-white/70 bg-[#cde4f3]/85 p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] shadow-[0_16px_30px_rgba(14,116,144,0.16)] backdrop-blur-xl md:p-5 md:pb-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1f3558]">DRIVER DASHBOARD</p>
            <h2 className="mt-1 text-[2rem] font-black leading-tight tracking-[-0.02em] text-[#0a1435]">Driver Dashboard</h2>
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
            Drivers complete the item quantity checklist and mark orders as loaded here.
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
              const isReplacementOrder =
                Boolean((order as any)?.isScheduledReplacement) ||
                String(order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-')
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
                (order.items || []).map((item) => [String(item.id), checklistDone])
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
                        {isReplacementOrder ? (
                          <Badge className="border border-blue-200 bg-blue-50 text-blue-700">
                            Replacement
                          </Badge>
                        ) : null}
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
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Quantity Checklist</p>
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
                        const checked = Boolean(checklistState[itemId])
                        return (
                          <div key={itemId}>
                          <label className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-1.5 text-sm ${checked ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-slate-50/80'}`}>
                            <div>
                              <p className="font-medium text-slate-900">{getItemDisplayNameWithSize(item)}</p>
                              {getItemCategoryLabel(item) ? <p className="text-xs text-slate-500">{getItemCategoryLabel(item)}</p> : null}
                              <p className="text-xs text-slate-500">{getItemQtyWithUnitLabel(order, item)}</p>
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
                          toast.error('Complete the item quantity checklist first.')
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
      )}
    </>
  )
}

