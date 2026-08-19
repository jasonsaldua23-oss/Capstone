'use client'

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import { Circle, Clock3, Eye, Loader2, MapPin, Pencil, Trash2, Truck, User, Warehouse } from 'lucide-react'

type TripDropPointItem = {
  id: string
  status: string
  latitude?: number | null
  longitude?: number | null
  locationName?: string
}

type TripItem = {
  id: string
  tripNumber: string
  createdByUserId?: string
  warehouseId?: string
  warehouse?: {
    id?: string
    name?: string
    code?: string
  }
  status: string
  tripSchedule?: string | null
  totalDropPoints?: number
  completedDropPoints?: number
  driver?: {
    name?: string
    user?: {
      name?: string
    }
  }
  vehicle?: {
    licensePlate?: string
  }
  dropPoints?: TripDropPointItem[]
}

type WarehouseTripsSectionProps = {
  loadingTrips: boolean
  scopedTrips: TripItem[]
  assignedWarehouseId?: string
  assignedWarehouseName?: string
  tripStatusColors: Record<string, string>
  selectedTrip: TripItem | null
  setSelectedTrip: Dispatch<SetStateAction<TripItem | null>>
  onOpenCreateTripFlow: () => void
  onEditTrip: (trip: TripItem) => void
  onDeleteTrip: (trip: TripItem) => void
  onUnassignOrderItems?: (tripId: string, orderId: string, warehouseId: string, itemIds: string[]) => void
  availableOrders: Array<{
    id: string
    orderNumber: string
    shippingName?: string
    shippingCity?: string
    status?: string
    allocatedQtyForSelectedWarehouse?: number
    totalOrderQty?: number
  }>
  onEditTripDropPoints: (trip: TripItem, changes: { addOrderIds?: string[]; removeDropPointIds?: string[]; assignWarehouseLegs?: boolean; assignWarehouseId?: string }) => void
  editingTripId?: string | null
}

export function WarehouseTripsSection({
  loadingTrips,
  scopedTrips,
  assignedWarehouseId,
  assignedWarehouseName,
  tripStatusColors,
  selectedTrip,
  onUnassignOrderItems,
  setSelectedTrip,
  onOpenCreateTripFlow,
  onEditTrip,
  onDeleteTrip,
  availableOrders,
  onEditTripDropPoints,
  editingTripId,
}: WarehouseTripsSectionProps) {
  const [tripsPage, setTripsPage] = useState(1)
  const tripsPageSize = 10
  const [selectedDropPointDetail, setSelectedDropPointDetail] = useState<any | null>(null)
  const [allocatingPoint, setAllocatingPoint] = useState<any | null>(null)
  const [confirmAllocateOpen, setConfirmAllocateOpen] = useState(false)
  const activeWarehouseId = String(assignedWarehouseId || '').trim()
  const activeWarehouseName = String(assignedWarehouseName || '').trim()
  const allocationLegsForPoint = useMemo(() => {
    const legs = Array.isArray(allocatingPoint?.order?.fulfillments)
      ? allocatingPoint.order.fulfillments
      : Array.isArray(allocatingPoint?.order?.shipments)
        ? allocatingPoint.order.shipments
        : Array.isArray(allocatingPoint?.order?.fulfillmentLegs)
          ? allocatingPoint.order.fulfillmentLegs
          : []
    return legs
      .map((leg: any) => {
        const allocatedQty = Number(
          leg?.allocatedQty ?? leg?.allocatedQuantity ?? leg?.quantity ?? 0
        )
        return {
          warehouseId: String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim(),
          warehouseName: String(leg?.warehouseName || leg?.warehouse?.name || leg?.warehouseCode || leg?.warehouse?.code || 'Warehouse').trim(),
          tripId: String(leg?.tripId || leg?.trip?.id || '').trim(),
          tripNumber: String(leg?.tripNumber || leg?.trip?.tripNumber || '').trim(),
          allocatedQty,
        }
      })
      .filter((leg: any) => Number(leg.allocatedQty || 0) > 0)
  }, [allocatingPoint])
  const currentDropPointOrderAllocation = useMemo(() => {
    const currentOrderId = String(allocatingPoint?.order?.id || '').trim()
    if (!currentOrderId) return null
    return availableOrders.find((order) => String(order.id) === currentOrderId) || null
  }, [availableOrders, allocatingPoint])
  const currentWarehouseAllocationFromLegs = useMemo(() => {
    const warehouseId = activeWarehouseId
    const warehouseName = String(activeWarehouseName || '').trim().toLowerCase()
    if (allocationLegsForPoint.length === 0) return { allocated: 0, total: 0 }
    let matchedLegs = allocationLegsForPoint.filter((leg: any) => warehouseId && String(leg?.warehouseId || '').trim() === warehouseId)
    if (matchedLegs.length === 0 && warehouseName) {
      matchedLegs = allocationLegsForPoint.filter((leg: any) => String(leg?.warehouseName || '').trim().toLowerCase() === warehouseName)
    }
    return {
      allocated: matchedLegs.reduce((sum: number, leg: any) => sum + Number(leg?.allocatedQty || 0), 0),
      total: allocationLegsForPoint.reduce((sum: number, leg: any) => sum + Number(leg?.allocatedQty || 0), 0),
    }
  }, [allocationLegsForPoint, activeWarehouseId, activeWarehouseName])
  const getWarehouseAllocatedQtyFromPoint = (point: any): number => {
    const legs = Array.isArray(point?.order?.fulfillments)
      ? point.order.fulfillments
      : Array.isArray(point?.order?.shipments)
        ? point.order.shipments
        : Array.isArray(point?.order?.fulfillmentLegs)
          ? point.order.fulfillmentLegs
          : []
    const warehouseId = activeWarehouseId
    const warehouseName = String(activeWarehouseName || '').trim().toLowerCase()
    const normalized = legs.map((leg: any) => ({
      warehouseId: String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim(),
      warehouseName: String(leg?.warehouseName || leg?.warehouse?.name || leg?.warehouseCode || leg?.warehouse?.code || '').trim().toLowerCase(),
      allocatedQty: Number(leg?.allocatedQty ?? leg?.allocatedQuantity ?? leg?.quantity ?? 0),
    }))
    let matched = normalized.filter((leg: any) => warehouseId && leg.warehouseId === warehouseId)
    if (matched.length === 0 && warehouseName) {
      matched = normalized.filter((leg: any) => leg.warehouseName === warehouseName)
    }
    return matched.reduce((sum: number, leg: any) => sum + Number(leg.allocatedQty || 0), 0)
  }
  const getItemAllocatedQtyForAssignedWarehouse = (item: any): number => {
    const itemAllocs = Array.isArray(item?.warehouseAllocations) ? item.warehouseAllocations : []
    return itemAllocs
      .filter((alloc: any) => String(alloc?.warehouseId || alloc?.warehouse_id || '').trim() === activeWarehouseId)
      .reduce((sum: number, alloc: any) => sum + Number(alloc?.allocatedQty ?? alloc?.allocatedQuantity ?? alloc?.quantity ?? 0), 0)
  }
  const getItemAllocatedQtyForTripWarehouse = (item: any): number => {
    const tripWarehouseId = activeWarehouseId
    const tripId = String((selectedTrip as any)?.id || '').trim()
    const tripNumber = String((selectedTrip as any)?.tripNumber || '').trim()
    if (!tripWarehouseId) return 0
    
    // First check tripAssignments (filtered for current trip) - this is most accurate
    const tripAssignments = Array.isArray(item?.tripAssignments) ? item.tripAssignments : []
    if (tripAssignments.length > 0) {
      const matchedTripAssignments = tripAssignments.filter((alloc: any) => {
        const allocWarehouseId = String(alloc?.warehouseId || alloc?.warehouse_id || '').trim()
        if (allocWarehouseId !== tripWarehouseId) return false
        const allocTripId = String(alloc?.tripId || alloc?.trip_id || alloc?.trip?.id || '').trim()
        const allocTripNumber = String(alloc?.tripNumber || alloc?.trip_number || alloc?.trip?.tripNumber || '').trim()
        if (tripId && allocTripId) return allocTripId === tripId
        if (tripNumber && allocTripNumber) return allocTripNumber === tripNumber
        return false
      })
      if (matchedTripAssignments.length > 0) {
        return matchedTripAssignments.reduce((sum: number, alloc: any) => sum + Number(alloc?.allocatedQty ?? alloc?.allocatedQuantity ?? alloc?.quantity ?? 0), 0)
      }
    }
    
    // Check allTripAssignments for current trip only
    const allTripAssignments = Array.isArray(item?.allTripAssignments) ? item.allTripAssignments : []
    const currentTripAssignments = allTripAssignments.filter((alloc: any) => {
      const allocWarehouseId = String(alloc?.warehouseId || alloc?.warehouse_id || '').trim()
      const allocTripId = String(alloc?.tripId || alloc?.trip_id || '').trim()
      return allocWarehouseId === tripWarehouseId && allocTripId === tripId
    })
    if (currentTripAssignments.length > 0) {
      return currentTripAssignments.reduce((sum: number, alloc: any) => sum + Number(alloc?.allocatedQty ?? alloc?.allocatedQuantity ?? alloc?.quantity ?? 0), 0)
    }
    
    // Fallback to warehouseAllocations
    const itemAllocs = Array.isArray(item?.warehouseAllocations) ? item.warehouseAllocations : []
    const warehouseScopedAllocs = itemAllocs.filter(
      (alloc: any) => String(alloc?.warehouseId || alloc?.warehouse_id || '').trim() === tripWarehouseId
    )
    const tripScopedAllocs = warehouseScopedAllocs.filter((alloc: any) => {
      const allocTripId = String(alloc?.tripId || alloc?.trip_id || alloc?.trip?.id || '').trim()
      const allocTripNumber = String(alloc?.tripNumber || alloc?.trip_number || alloc?.trip?.tripNumber || '').trim()
      if (tripId && allocTripId) return allocTripId === tripId
      if (tripNumber && allocTripNumber) return allocTripNumber === tripNumber
      return false
    })
    return tripScopedAllocs.reduce((sum: number, alloc: any) => sum + Number(alloc?.allocatedQty ?? alloc?.allocatedQuantity ?? alloc?.quantity ?? 0), 0)
  }
  const getUnassignedAllocationQtyForAssignedWarehouse = (point: any): number => {
    const warehouseId = activeWarehouseId
    const warehouseName = String(activeWarehouseName || '').trim().toLowerCase()
    if (!warehouseId && !warehouseName) return 0
    const legs = Array.isArray(point?.order?.fulfillments)
      ? point.order.fulfillments
      : Array.isArray(point?.order?.shipments)
        ? point.order.shipments
        : Array.isArray(point?.order?.fulfillmentLegs)
          ? point.order.fulfillmentLegs
          : []
    return legs.reduce((sum: number, leg: any) => {
      const legWarehouseId = String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim()
      const legWarehouseName = String(leg?.warehouseName || leg?.warehouse?.name || leg?.warehouseCode || leg?.warehouse?.code || '').trim().toLowerCase()
      const legAllocated = Number(leg?.allocatedQty ?? leg?.allocatedQuantity ?? leg?.quantity ?? 0)
      const legTripId = String(leg?.tripId || leg?.trip?.id || '').trim()
      const legTripNumber = String(leg?.tripNumber || leg?.trip?.tripNumber || '').trim()
      const isAssignedToTrip = Boolean(legTripId || legTripNumber)
      const matchesWarehouseById = Boolean(warehouseId) && legWarehouseId === warehouseId
      const matchesWarehouseByName = !matchesWarehouseById && Boolean(warehouseName) && legWarehouseName === warehouseName
      if (!(matchesWarehouseById || matchesWarehouseByName)) return sum
      if (isAssignedToTrip || legAllocated <= 0) return sum
      return sum + legAllocated
    }, 0)
  }
  const getOrderAllocationSummaryForAssignedWarehouse = (point: any): { allocated: number; total: number } => {
    const items = Array.isArray(point?.order?.items) ? point.order.items : []
    const allocated = items.reduce((sum: number, item: any) => sum + Math.max(0, Number(getItemAllocatedQtyForAssignedWarehouse(item) || 0)), 0)
    const total = items.reduce((sum: number, item: any) => sum + Math.max(0, Number(item?.quantity || 0)), 0)
    return { allocated, total }
  }
  const totalTripsPages = Math.max(1, Math.ceil(scopedTrips.length / tripsPageSize))
  const paginatedTrips = useMemo(() => {
    const start = (tripsPage - 1) * tripsPageSize
    return scopedTrips.slice(start, start + tripsPageSize)
  }, [scopedTrips, tripsPage])

  useEffect(() => {
    setTripsPage(1)
  }, [scopedTrips.length])

  useEffect(() => {
    if (tripsPage > totalTripsPages) {
      setTripsPage(totalTripsPages)
    }
  }, [tripsPage, totalTripsPages])
  const getAssignedQtyForCurrentTripAndWarehouseFromLegs = (point: any): number => {
    const tripId = String((selectedTrip as any)?.id || '').trim()
    const tripNumber = String((selectedTrip as any)?.tripNumber || '').trim()
    if (!tripId && !tripNumber) return 0
    const warehouseId = activeWarehouseId
    const warehouseName = String(activeWarehouseName || '').trim().toLowerCase()
    const legs = Array.isArray(point?.order?.fulfillments)
      ? point.order.fulfillments
      : Array.isArray(point?.order?.shipments)
        ? point.order.shipments
        : Array.isArray(point?.order?.fulfillmentLegs)
          ? point.order.fulfillmentLegs
          : []
    return legs.reduce((sum: number, leg: any) => {
      const legWarehouseId = String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim()
      const legWarehouseName = String(leg?.warehouseName || leg?.warehouse?.name || leg?.warehouseCode || leg?.warehouse?.code || '').trim().toLowerCase()
      const matchesWarehouseById = Boolean(warehouseId) && legWarehouseId === warehouseId
      const matchesWarehouseByName = !matchesWarehouseById && Boolean(warehouseName) && legWarehouseName === warehouseName
      if (!(matchesWarehouseById || matchesWarehouseByName)) return sum
      const legTripId = String(leg?.tripId || leg?.trip?.id || '').trim()
      const legTripNumber = String(leg?.tripNumber || leg?.trip?.tripNumber || '').trim()
      const matchesTrip = (tripId && legTripId === tripId) || (tripNumber && legTripNumber === tripNumber)
      if (!matchesTrip) return sum
      const legAllocated = Number(leg?.allocatedQty ?? leg?.allocatedQuantity ?? leg?.quantity ?? 0)
      return sum + Math.max(0, legAllocated)
    }, 0)
  }
  const getPendingAllocationQtyForCurrentTrip = (point: any): number => {
    const fromOrderField = Number(point?.order?.allocatedQtyForSelectedWarehouse || 0)
    const fallbackSummary = getOrderAllocationSummaryForAssignedWarehouse(point)
    const allocatedForWarehouse = fromOrderField > 0 ? fromOrderField : Number(fallbackSummary.allocated || 0)
    const alreadyAssignedToTrip = getAssignedQtyForCurrentTripAndWarehouseFromLegs(point)
    return Math.max(0, allocatedForWarehouse - alreadyAssignedToTrip)
  }
  const getPendingItemAssignmentQtyForCurrentTrip = (point: any): number => {
    const items = Array.isArray(point?.order?.items) ? point.order.items : []
    return items.reduce((sum: number, item: any) => {
      const allocatedForWarehouse = Math.max(0, Number(getItemAllocatedQtyForAssignedWarehouse(item) || 0))
      const assignedToTrip = Math.max(0, Number(getItemAllocatedQtyForTripWarehouse(item) || 0))
      return sum + Math.max(0, allocatedForWarehouse - assignedToTrip)
    }, 0)
  }
  const canAllocateFromPoint = (point: any, tripStatusKey: string): boolean => {
    if (tripStatusKey !== 'PLANNED') return false
    const pendingItemQty = getPendingItemAssignmentQtyForCurrentTrip(point)
    return pendingItemQty > 0
  }
  const pendingQtyForAllocatingPoint = useMemo(() => {
    if (!allocatingPoint) return 0
    return getPendingAllocationQtyForCurrentTrip(allocatingPoint)
  }, [allocatingPoint, selectedTrip, activeWarehouseId, activeWarehouseName])
  const allocatingOrderAlreadyInSelectedTrip = useMemo(() => {
    const orderId = String(allocatingPoint?.order?.id || '').trim()
    if (!orderId || !selectedTrip) return false
    const points = Array.isArray(selectedTrip?.dropPoints) ? selectedTrip.dropPoints : []
    return points.some((point: any) => String(point?.orderId || point?.order?.id || '').trim() === orderId)
  }, [allocatingPoint, selectedTrip])
  const canDirectAssignCurrentDropPoint = pendingQtyForAllocatingPoint > 0
  const pendingItemsForAllocatingPoint = useMemo(() => {
    const items = Array.isArray(allocatingPoint?.order?.items) ? allocatingPoint.order.items : []
    return items
      .map((item: any) => {
        const allocatedQty = Math.max(0, Number(getItemAllocatedQtyForAssignedWarehouse(item) || 0))
        const assignedToTripQty = Math.max(0, Number(getItemAllocatedQtyForTripWarehouse(item) || 0))
        const pendingQty = Math.max(0, allocatedQty - assignedToTripQty)
        const name = item?.itemType === 'MIXED_CASE'
          ? `Mixed Case (${Number(item?.caseCapacity || 0)} units)`
          : String(item?.product?.name || 'Item').trim()
        const size = (() => {
          if (item?.itemType === 'MIXED_CASE') {
            return (item?.components || []).map((component: any) => `${component.productName} ${component.quantityPerCase}/case`).join(', ')
          }
          const product = item?.product || {}
          const fromSizes = Array.isArray(product?.sizes) && product.sizes.length > 0
            ? product.sizes.map((s: any) => String(s || '').trim()).filter(Boolean).join(', ')
            : ''
          const fromField = String(product?.size || product?.sizeLabel || item?.size || '').trim()
          return fromSizes || fromField
        })()
        return { name, size, pendingQty }
      })
      .filter((line) => line.pendingQty > 0)
  }, [allocatingPoint, selectedTrip, activeWarehouseId, activeWarehouseName])
  const formatPeso = (amount: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(amount)
  const getOrderItemName = (item: any) =>
    item?.itemType === 'MIXED_CASE'
      ? `Mixed Case (${Number(item?.caseCapacity || 0)} units)`
      : String(item?.product?.name || 'Item').trim()
  const getOrderItemSize = (item: any) => {
    if (item?.itemType === 'MIXED_CASE') {
      return (item?.components || []).map((component: any) => `${component.productName} ${component.quantityPerCase}/case`).join(', ') || 'Mixed Case'
    }
    const product = item?.product || {}
    const fromSizes = Array.isArray(product?.sizes) && product.sizes.length > 0
      ? product.sizes.map((size: any) => String(size || '').trim()).filter(Boolean).join(', ')
      : ''
    return fromSizes || String(product?.size || product?.sizeLabel || item?.size || '').trim() || 'N/A'
  }
  const formatTripSchedule = (value: string | null | undefined) => {
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

  const normalizeTripStatus = (status: string | null | undefined) => {
    const value = String(status || '').toUpperCase()
    return value === 'IN_TRANSIT' ? 'IN_PROGRESS' : value
  }

  const normalizeDropPointStatus = (status: string | null | undefined) => {
    const value = String(status || '').toUpperCase()
    if (value === 'FAILED_DELIVERY') return 'FAILED'
    if (value === 'IN_TRANSIT' || value === 'OUT_FOR_DELIVERY') return 'IN_PROGRESS'
    return value
  }

  const terminalDropPointStatuses = new Set([
    'COMPLETED',
    'DELIVERED',
    'FULFILLED',
    'FAILED',
    'SKIPPED',
    'CANCELED',
    'CANCELLED',
  ])

  const getEffectiveTripStatus = (trip: TripItem) => {
    const normalizedTripStatus = normalizeTripStatus(trip.status)
    const dropPoints = Array.isArray(trip.dropPoints) ? trip.dropPoints : []

    if (dropPoints.length === 0) {
      return normalizedTripStatus
    }

    const normalizedDropPointStatuses = dropPoints.map((point) => normalizeDropPointStatus(point.status))
    const completedCount = normalizedDropPointStatuses.filter((status) => terminalDropPointStatuses.has(status)).length

    if (completedCount === 0) {
      return normalizedTripStatus
    }

    if (completedCount >= dropPoints.length) {
      return 'COMPLETED'
    }

    return normalizedTripStatus === 'PLANNED' ? 'IN_PROGRESS' : normalizedTripStatus
  }

  const getEffectiveCompletedDropPoints = (trip: TripItem) => {
    const derivedCompleted = Array.isArray(trip.dropPoints)
      ? trip.dropPoints.filter((point) => terminalDropPointStatuses.has(normalizeDropPointStatus(point.status))).length
      : 0

    return Math.max(Number(trip.completedDropPoints || 0), derivedCompleted)
  }

  const getEffectiveTotalDropPoints = (trip: TripItem) => {
    return Math.max(Number(trip.totalDropPoints || 0), Array.isArray(trip.dropPoints) ? trip.dropPoints.length : 0)
  }

  const canDeleteTrip = (trip: TripItem) => getEffectiveTripStatus(trip) === 'PLANNED'
  const hasMultiWarehouseDropPoint = (trip: TripItem): boolean => {
    const points = Array.isArray(trip?.dropPoints) ? trip.dropPoints : []
    return points.some((point: any) => {
      const order = point?.order
      if (!order) return false
      const fromOrderAllocations = Array.isArray(order?.warehouseAllocations)
        ? order.warehouseAllocations
            .map((entry: any) => String(entry?.warehouseId || entry?.warehouse_id || entry?.warehouse?.id || '').trim())
            .filter(Boolean)
        : []
      const fromItems = Array.isArray(order?.items)
        ? order.items.flatMap((item: any) =>
            (Array.isArray(item?.warehouseAllocations) ? item.warehouseAllocations : [])
              .map((entry: any) => String(entry?.warehouseId || entry?.warehouse_id || entry?.warehouse?.id || '').trim())
              .filter(Boolean)
          )
        : []
      const fromLegs = Array.isArray(order?.fulfillments)
        ? order.fulfillments
            .map((leg: any) => String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim())
            .filter(Boolean)
        : Array.isArray(order?.shipments)
          ? order.shipments
              .map((leg: any) => String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim())
              .filter(Boolean)
          : Array.isArray(order?.fulfillmentLegs)
            ? order.fulfillmentLegs
                .map((leg: any) => String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim())
                .filter(Boolean)
            : []
      const uniqueWarehouseIds = new Set<string>([...fromOrderAllocations, ...fromItems, ...fromLegs])
      return uniqueWarehouseIds.size > 1
    })
  }

  const getTripWarehouses = (trip: TripItem): Array<{id: string; name: string; code?: string}> => {
    const warehouses: Array<{id: string; name: string; code?: string}> = []
    const seenIds = new Set<string>()

    // Add the trip's origin warehouse first
    if (trip.warehouse?.id) {
      warehouses.push({
        id: trip.warehouse.id,
        name: trip.warehouse.name || 'Unknown Warehouse',
        code: trip.warehouse.code
      })
      seenIds.add(trip.warehouse.id)
    }

    // Collect all warehouse allocations from drop points
    const points = Array.isArray(trip?.dropPoints) ? trip.dropPoints : []
    points.forEach((point: any) => {
      const order = point?.order
      if (!order) return

      // From order-level warehouseAllocations
      const orderAllocs = Array.isArray(order?.warehouseAllocations)
        ? order.warehouseAllocations
        : []
      orderAllocs.forEach((entry: any) => {
        const id = String(entry?.warehouseId || entry?.warehouse_id || entry?.warehouse?.id || '').trim()
        const name = String(entry?.warehouseName || entry?.warehouse?.name || entry?.warehouseCode || entry?.warehouse?.code || 'Unknown').trim()
        const code = String(entry?.warehouseCode || entry?.warehouse?.code || '').trim() || undefined
        if (id && !seenIds.has(id)) {
          warehouses.push({ id, name, code })
          seenIds.add(id)
        }
      })

      // From item-level warehouseAllocations
      const items = Array.isArray(order?.items) ? order.items : []
      items.forEach((item: any) => {
        const itemAllocs = Array.isArray(item?.warehouseAllocations) ? item.warehouseAllocations : []
        itemAllocs.forEach((entry: any) => {
          const id = String(entry?.warehouseId || entry?.warehouse_id || entry?.warehouse?.id || '').trim()
          const name = String(entry?.warehouseName || entry?.warehouse?.name || entry?.warehouseCode || entry?.warehouse?.code || 'Unknown').trim()
          const code = String(entry?.warehouseCode || entry?.warehouse?.code || '').trim() || undefined
          if (id && !seenIds.has(id)) {
            warehouses.push({ id, name, code })
            seenIds.add(id)
          }
        })
      })

      // From fulfillment legs
      const legs = Array.isArray(order?.fulfillments)
        ? order.fulfillments
        : Array.isArray(order?.shipments)
          ? order.shipments
          : Array.isArray(order?.fulfillmentLegs)
            ? order.fulfillmentLegs
            : []
      legs.forEach((leg: any) => {
        const id = String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim()
        const name = String(leg?.warehouseName || leg?.warehouse?.name || leg?.warehouseCode || leg?.warehouse?.code || 'Unknown').trim()
        const code = String(leg?.warehouseCode || leg?.warehouse?.code || '').trim() || undefined
        if (id && !seenIds.has(id)) {
          warehouses.push({ id, name, code })
          seenIds.add(id)
        }
      })
    })

    return warehouses
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onOpenCreateTripFlow} className="bg-blue-600 text-white hover:bg-blue-700 rounded-xl px-4">
          <Truck className="h-4 w-4 mr-2" />
          Create Trip
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trips & Deliveries</CardTitle>
          <CardDescription>Delivery trip assignments and completion progress from admin dispatch.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingTrips ? (
            <PortalTableSkeleton rows={4} columns={5} className="border-0 shadow-none" />
          ) : scopedTrips.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-500">No trips found</div>
          ) : (
            <>
            <div className="flex items-center justify-between border-b px-1 pb-3">
              <p className="text-xs text-slate-500">
                Showing {(tripsPage - 1) * tripsPageSize + 1}-{Math.min(tripsPage * tripsPageSize, scopedTrips.length)} of {scopedTrips.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={tripsPage <= 1}
                  onClick={() => setTripsPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-slate-600">Page {tripsPage} of {totalTripsPages}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={tripsPage >= totalTripsPages}
                  onClick={() => setTripsPage((prev) => Math.min(totalTripsPages, prev + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              {paginatedTrips.map((trip) => (
                (() => {
                  const statusKey = getEffectiveTripStatus(trip)
                  const editAllowed = canDeleteTrip(trip)
                  const deleteAllowed = editAllowed
                  const isMultiWarehouseTrip = hasMultiWarehouseDropPoint(trip)
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
                        <Badge className={`${tripStatusColors[statusKey] || 'bg-gray-100'} text-xs px-2 py-0.5`}>
                          {statusKey.replace(/_/g, ' ')}
                        </Badge>
                        {isMultiWarehouseTrip ? (
                          <Badge className="bg-violet-100 text-violet-800 text-xs px-2 py-0.5">
                            Multi-Warehouse
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-[13px] text-gray-700">
                        Vehicle: {trip.vehicle?.licensePlate || 'Unassigned'} | Driver: {trip.driver?.name || trip.driver?.user?.name || 'Unassigned'}
                      </p>
                      <p className="text-[13px] text-gray-600">
                        Route: {(trip.warehouse?.name || assignedWarehouseName || 'Warehouse')} {'->'} {(trip.dropPoints?.[trip.dropPoints.length - 1]?.locationName || 'Destination')}
                      </p>
                      <p className="text-[13px] text-gray-600">
                        Schedule: {formatTripSchedule(trip.tripSchedule)}
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
                        className="h-8 px-2 text-xs"
                        disabled={!editAllowed}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (!editAllowed) return
                          onEditTrip(trip)
                        }}
                        title={editAllowed ? 'Edit trip' : 'Only planned trips can be edited'}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs text-red-600 hover:text-red-700"
                        disabled={!deleteAllowed}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (!deleteAllowed) return
                          onDeleteTrip(trip)
                        }}
                        title={deleteAllowed ? 'Delete trip' : 'Only planned trips can be deleted'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
                  )
                })()
              ))}
            </div>
            <div className="flex items-center justify-between border-t px-1 pt-3">
              <p className="text-xs text-slate-500">
                Showing {(tripsPage - 1) * tripsPageSize + 1}-{Math.min(tripsPage * tripsPageSize, scopedTrips.length)} of {scopedTrips.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={tripsPage <= 1}
                  onClick={() => setTripsPage((prev) => Math.max(1, prev - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-slate-600">Page {tripsPage} of {totalTripsPages}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={tripsPage >= totalTripsPages}
                  onClick={() => setTripsPage((prev) => Math.min(totalTripsPages, prev + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedTrip} onOpenChange={(open) => !open && setSelectedTrip(null)}>
        <DialogContent className="flex max-h-[88vh] w-[95vw] max-w-[760px] flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white p-0 shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
          {selectedTrip && (
            (() => {
              const statusKey = getEffectiveTripStatus(selectedTrip)
              const effectiveCompletedDropPoints = getEffectiveCompletedDropPoints(selectedTrip)
              const effectiveTotalDropPoints = getEffectiveTotalDropPoints(selectedTrip)
              const statusLabel = statusKey.replace(/_/g, ' ')
              return (
            <div className="flex-1 overflow-y-auto">
              <div className="border-b border-slate-200 px-5 pb-4 pt-5">
                <div className="flex items-center gap-3 pr-8">
                  <h2 className="whitespace-nowrap text-[2.25rem] font-bold leading-none tracking-tight text-[#0f172f]">{selectedTrip.tripNumber}</h2>
                  <div className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5">
                    <Clock3 className="h-4 w-4 text-blue-600" />
                    <span className="text-xs font-semibold leading-none text-blue-600">{statusLabel}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-4 px-5 py-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/35 p-4">
                  <div className="grid gap-2 grid-cols-4">
                    <div className="flex items-center gap-2 pr-2 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-slate-200">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-100 text-blue-600">
                        <Truck className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-[10px] leading-none text-slate-500">Vehicle</p>
                        <p className="mt-1 text-[12px] font-semibold leading-none text-slate-900">{selectedTrip.vehicle?.licensePlate || 'Unassigned'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pr-2 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-slate-200">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-100 text-violet-700">
                        <User className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-[10px] leading-none text-slate-500">Driver</p>
                        <p className="mt-1 text-[12px] font-semibold leading-none text-slate-900">{selectedTrip.driver?.name || selectedTrip.driver?.user?.name || 'Unassigned'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pr-2 [&:not(:last-child)]:border-r [&:not(:last-child)]:border-slate-200">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                        <Circle className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-[10px] leading-none text-slate-500">Progress</p>
                        <p className="mt-1 text-[12px] font-semibold leading-none text-slate-900">{effectiveCompletedDropPoints}/{effectiveTotalDropPoints}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-500">
                        <MapPin className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-[10px] leading-none text-slate-500">Drop points</p>
                        <p className="mt-1 text-[12px] font-semibold leading-none text-slate-900">{selectedTrip.dropPoints?.length ?? 0}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/35 p-4">
                  <p className="mb-3 flex items-center gap-2 text-[14px] font-bold leading-none text-[#0f172f]">
                    <MapPin className="h-5 w-5 text-blue-600" />
                    Drop Point Details
                  </p>
                  {Array.isArray(selectedTrip.dropPoints) && selectedTrip.dropPoints.length > 0 ? (
                    <div className="space-y-4">
                    {selectedTrip.dropPoints.map((point: any, index) => {
                      const normalizedPointStatus = normalizeDropPointStatus(point.status)
                      const statusLabel = normalizedPointStatus.replace(/_/g, ' ') || 'PENDING'
                      const statusClass = ['DELIVERED', 'COMPLETED', 'FULFILLED', 'ARRIVED'].includes(normalizedPointStatus)
                        ? 'border-blue-200 bg-blue-100 text-blue-700'
                        : ['FAILED', 'CANCELLED', 'CANCELED', 'SKIPPED'].includes(normalizedPointStatus)
                          ? 'border-red-200 bg-red-100 text-red-700'
                          : normalizedPointStatus === 'IN_PROGRESS'
                            ? 'border-blue-200 bg-blue-100 text-blue-700'
                            : 'border-slate-200 bg-slate-100 text-slate-700'

                      const hasCoordinates =
                        typeof point.latitude === 'number' && typeof point.longitude === 'number'

                      // Check if this drop point has multi-warehouse order
                      const order = point?.order
                      const fromOrderAllocations = Array.isArray(order?.warehouseAllocations)
                        ? order.warehouseAllocations.map((e: any) => String(e?.warehouseId || e?.warehouse_id || e?.warehouse?.id || '').trim()).filter(Boolean)
                        : []
                      const fromItems = Array.isArray(order?.items)
                        ? order.items.flatMap((item: any) =>
                            (Array.isArray(item?.warehouseAllocations) ? item.warehouseAllocations : [])
                              .map((e: any) => String(e?.warehouseId || e?.warehouse_id || e?.warehouse?.id || '').trim()).filter(Boolean)
                          )
                        : []
                      const fromLegs = Array.isArray(order?.fulfillments)
                        ? order.fulfillments.map((leg: any) => String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim()).filter(Boolean)
                        : Array.isArray(order?.shipments)
                          ? order.shipments.map((leg: any) => String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim()).filter(Boolean)
                          : Array.isArray(order?.fulfillmentLegs)
                            ? order.fulfillmentLegs.map((leg: any) => String(leg?.warehouseId || leg?.warehouse_id || leg?.warehouse?.id || '').trim()).filter(Boolean)
                            : []
                      const uniqueWarehouseIds = new Set<string>([...fromOrderAllocations, ...fromItems, ...fromLegs])
                      const isDropPointMultiWarehouse = uniqueWarehouseIds.size > 1

                      return (
                        <div key={point.id} className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <span className="mt-1 grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full bg-blue-100 text-blue-600">
                                <MapPin className="h-5 w-5" />
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-[12px] font-semibold leading-none text-slate-900">
                                    Drop Point {index + 1}: {point.locationName || 'Unnamed drop point'}
                                  </p>
                                  {isDropPointMultiWarehouse && (
                                    <Badge className="bg-violet-100 text-violet-800 text-[10px] px-2 py-0">
                                      Multi-Warehouse
                                    </Badge>
                                  )}
                                </div>
                                <p className="mt-1 text-[11px] leading-snug text-slate-500">
                                  {hasCoordinates
                                    ? `Coordinates: ${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}`
                                    : 'Coordinates: Not available'}
                                </p>
                                {Number(point?.order?.allocatedQtyForSelectedWarehouse || 0) > 0 ? (
                                  <p className="mt-1 text-[11px] text-emerald-700">
                                    Allocated: {Number(point.order.allocatedQtyForSelectedWarehouse || 0)} / {Number(point?.order?.totalOrderQty || 0)}
                                  </p>
                                ) : null}
                                {(() => {
                                  const legs = Array.isArray(point?.order?.fulfillments)
                                    ? point.order.fulfillments
                                    : Array.isArray(point?.order?.shipments)
                                      ? point.order.shipments
                                      : Array.isArray(point?.order?.fulfillmentLegs)
                                        ? point.order.fulfillmentLegs
                                        : []
                                  if (legs.length === 0) return null
                                  const delivered = legs.filter((leg: any) => {
                                    const s = String(leg?.status || '').toUpperCase()
                                    return ['DELIVERED', 'COMPLETED', 'FULFILLED', 'ARRIVED'].includes(s)
                                  }).length
                                  return (
                                    <p className="mt-1 text-[11px] text-slate-500">
                                      Fulfillment legs: {delivered}/{legs.length} delivered
                                    </p>
                                  )
                                })()}
                                <div className="mt-4">
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="h-8 rounded-lg border-slate-300 px-3 text-[11px] font-medium text-slate-900 hover:bg-slate-50"
                                      onClick={() => setSelectedDropPointDetail(point)}
                                    >
                                      <Eye className="mr-2 h-4 w-4" />
                                      View Details
                                    </Button>
                                    {canAllocateFromPoint(point, statusKey) ? (
                                      <Button
                                        type="button"
                                        className="h-8 rounded-lg px-3 text-[11px] font-medium"
                                        onClick={() => {
                                          setAllocatingPoint(point)
                                        }}
                                      >
                                        Assign
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold leading-none ${statusClass}`}>
                              {statusLabel}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No drop-point records attached to this trip yet.</p>
                  )}
                </div>
                <div className="flex justify-end pt-2">
                  <Button
                    variant="outline"
                    className="h-10 min-w-[86px] rounded-lg border-slate-300 px-4 text-sm font-medium text-slate-900 hover:bg-slate-50"
                    onClick={() => {
                      setAllocatingPoint(null)
                      setConfirmAllocateOpen(false)
                      setSelectedTrip(null)
                    }}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </div>
              )
            })()
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!selectedDropPointDetail} onOpenChange={(open) => !open && setSelectedDropPointDetail(null)}>
        <DialogContent className="max-w-xl w-full overflow-hidden rounded-2xl border border-white/40 bg-white/90 p-0 shadow-[0_24px_50px_rgba(15,23,42,0.16)] backdrop-blur-2xl">
          {selectedDropPointDetail ? (
            <div className="space-y-4 p-6">
              {(() => {
                const orderNumber = String(selectedDropPointDetail.order?.orderNumber || '').trim().toUpperCase()
                const isReplacementDropPoint = Boolean(selectedDropPointDetail.order?.isScheduledReplacement) || orderNumber.startsWith('RPL-')
                const refLabel = isReplacementDropPoint ? 'Replacement Number' : 'PO Number'
                const refStatusLabel = isReplacementDropPoint ? 'Replacement Status' : 'PO Status'
                const itemsLabel = isReplacementDropPoint ? 'Replacement Items' : 'Order Items'
                return (
                  <>
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-slate-200/70 pb-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-[0_8px_18px_rgba(37,99,235,0.28)]">
                  <MapPin className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Drop Point Details</h3>
              </div>

              {/* Info card */}
              <div className="rounded-2xl border border-white/50 bg-white/65 p-4 backdrop-blur-xl shadow-[0_8px_20px_rgba(15,23,42,0.07)] space-y-2.5 text-sm">
                <div className="flex gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">Customer</span>
                  <span className="text-slate-700">{selectedDropPointDetail.locationName || selectedDropPointDetail.contactName || 'N/A'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">Phone</span>
                  <span className="text-slate-700">{selectedDropPointDetail.contactPhone || 'N/A'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">Address</span>
                  <span className="text-slate-700">{selectedDropPointDetail.address || 'N/A'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">{refLabel}</span>
                  <span className="font-mono text-slate-800">{selectedDropPointDetail.order?.orderNumber || 'N/A'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">{refStatusLabel}</span>
                  {(() => {
                    const raw = String(selectedDropPointDetail.order?.status || 'N/A').toUpperCase()
                    const isActive = ['OUT_FOR_DELIVERY', 'IN_TRANSIT', 'DISPATCHED'].includes(raw)
                    const isDone = raw === 'DELIVERED'
                    const isFailed = ['CANCELLED', 'FAILED', 'FAILED_DELIVERY', 'REJECTED'].includes(raw)
                    return (
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        isActive  ? 'border-sky-200 bg-sky-50 text-sky-700' :
                        isDone    ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                        isFailed  ? 'border-red-200 bg-red-50 text-red-700' :
                                    'border-slate-200 bg-slate-50 text-slate-600'
                      }`}>
                        {raw.replace(/_/g, ' ')}
                      </span>
                    )
                  })()}
                </div>
                <div className="flex gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">Total Amount</span>
                  <span className="font-semibold text-indigo-600">
                    {selectedDropPointDetail.order?.totalAmount != null
                      ? formatPeso(Number(selectedDropPointDetail.order.totalAmount || 0))
                      : 'N/A'}
                  </span>
                </div>
              </div>

              {/* Order Items */}
              <div className="rounded-2xl border border-white/50 bg-white/65 p-4 backdrop-blur-xl shadow-[0_8px_20px_rgba(15,23,42,0.07)]">
                <p className="mb-3 text-sm font-semibold text-slate-900">{itemsLabel}</p>
                {Array.isArray(selectedDropPointDetail.order?.items) && selectedDropPointDetail.order.items.length > 0 ? (
                  <div className="max-h-64 overflow-y-auto space-y-2 text-sm pr-1">
                    {(() => {
                      const items = Array.isArray(selectedDropPointDetail.order?.items) ? selectedDropPointDetail.order.items : []
                      // Check if ORDER is multi-warehouse (items allocated from different warehouses)
                      const allItemsAllocs = items.flatMap((it: any) =>
                        Array.isArray(it?.warehouseAllocations) ? it.warehouseAllocations : []
                      )
                      const orderWarehouseIds = new Set(allItemsAllocs.map((a: any) => String(a?.warehouseId || a?.warehouse_id || a?.warehouse?.id || '').trim()).filter(Boolean))
                      const isMultiWarehouseOrder = orderWarehouseIds.size > 1

                      return items.map((item: any, itemIndex: number) => {
                        const itemQty = Math.max(0, Number(item?.quantity || 0))
                        const allocatedForCurrentWarehouse = Math.max(0, Number(getItemAllocatedQtyForAssignedWarehouse(item) || 0))
                        const assignedToCurrentTrip = Math.max(0, Number(getItemAllocatedQtyForTripWarehouse(item) || 0))
                        const isOtherWarehouseAllocation = allocatedForCurrentWarehouse <= 0
                        // Badge shows allocation status (not trip assignment status)
                        const isFullyAllocated = allocatedForCurrentWarehouse > 0 && allocatedForCurrentWarehouse >= itemQty
                        const isPartiallyAllocated = allocatedForCurrentWarehouse > 0 && allocatedForCurrentWarehouse < itemQty
                        const warehouseBadgeLabel = activeWarehouseName || 'Assigned Warehouse'

                        // For multi-warehouse orders, check if THIS item's warehouse allocation is assigned to THE CURRENT TRIP
                        const allTripAssignments = Array.isArray(item?.allTripAssignments) ? item.allTripAssignments : []
                        const currentTripId = String((selectedTrip as any)?.id || '').trim()
                        // Get the warehouse ID for this item's allocation (from warehouseAllocations or allTripAssignments)
                        const itemWarehouseAllocs = Array.isArray(item?.warehouseAllocations) ? item.warehouseAllocations : []
                        const itemWarehouseIds = new Set(itemWarehouseAllocs.map((wa: any) => String(wa?.warehouseId || wa?.warehouse_id || '').trim()).filter(Boolean))
                        // If no warehouse allocations, check if any trip assignments exist for this item
                        const itemAssignmentWarehouseIds = new Set(allTripAssignments.map((ta: any) => String(ta?.warehouseId || ta?.warehouse_id || '').trim()).filter(Boolean))
                        const relevantWarehouseIds = itemWarehouseIds.size > 0 ? itemWarehouseIds : itemAssignmentWarehouseIds
                        // Find trip assignments for ANY of this item's warehouses AND the current trip
                        const itemTripAssignments = allTripAssignments.filter((ta: any) => {
                          const assignmentWarehouseId = String(ta?.warehouseId || ta?.warehouse_id || '').trim()
                          const assignmentTripId = String(ta?.tripId || ta?.trip_id || '').trim()
                          return relevantWarehouseIds.has(assignmentWarehouseId) && assignmentTripId === currentTripId
                        })
                        // Item is "Assigned" if ANY of its warehouse allocations are assigned to THIS SPECIFIC TRIP
                        const isAssignedToTrip = itemTripAssignments.length > 0

                        return (
                      <div key={`warehouse-dp-detail-item-${itemIndex}`} className="rounded-xl border border-white/60 bg-white/80 px-3 py-2.5 shadow-[0_4px_10px_rgba(15,23,42,0.06)]">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-slate-900">{getOrderItemName(item)}</p>
                          {isMultiWarehouseOrder && (
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              isOtherWarehouseAllocation
                                ? 'border-slate-200 bg-slate-50 text-slate-700'
                                : isFullyAllocated
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : isPartiallyAllocated
                                  ? 'border-blue-200 bg-blue-50 text-blue-700'
                                  : 'border-amber-200 bg-amber-50 text-amber-700'
                            }`}>
                              {isOtherWarehouseAllocation
                                ? 'Other Warehouse Allocation'
                                : isFullyAllocated
                                  ? `Allocated (${warehouseBadgeLabel})`
                                  : isPartiallyAllocated
                                    ? `Partially Allocated (${warehouseBadgeLabel})`
                                    : `Not Allocated (${warehouseBadgeLabel})`}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {item?.itemType === 'MIXED_CASE' ? 'Contents' : 'Size'}: {getOrderItemSize(item)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">Quantity: {Number(item?.quantity || 0)}</p>
                        {isMultiWarehouseOrder && (
                          <p className={`mt-0.5 text-xs font-medium ${isAssignedToTrip ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {isAssignedToTrip ? 'Assigned' : 'Not Assigned'}
                          </p>
                        )}
                      </div>
                        )
                      })
                    })()}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No order items.</p>
                )}
              </div>

              {/* Footer */}
              <div className="flex justify-end pt-1">
                <Button
                  variant="outline"
                  className="h-10 min-w-24 rounded-xl border-white/50 bg-white/65 text-slate-700 backdrop-blur-md hover:bg-white/85 hover:text-slate-950"
                  onClick={() => setSelectedDropPointDetail(null)}
                >
                  Close
                </Button>
              </div>
                  </>
                )
              })()}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={!!allocatingPoint} onOpenChange={(open) => !open && setAllocatingPoint(null)}>
        <DialogContent className="max-w-lg">
          {allocatingPoint ? (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-900">Assign Drop Point</h3>
              <p className="text-sm text-slate-600">
                Drop point: {allocatingPoint?.order?.orderNumber || allocatingPoint?.locationName || 'Drop point'}
              </p>
              {currentDropPointOrderAllocation ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-slate-900">{currentDropPointOrderAllocation.orderNumber}</p>
                  <p className="mt-1 text-emerald-700">
                    {(() => {
                      const summary = getOrderAllocationSummaryForAssignedWarehouse(allocatingPoint)
                      return `Your allocation in this order: ${Number(summary.allocated || 0)} / ${Number(summary.total || 0)}`
                    })()}
                  </p>
                  {allocationLegsForPoint.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs font-semibold text-slate-700">Leg Assignments</p>
                      {allocationLegsForPoint.map((leg: any, idx: number) => (
                        <p key={`${leg.warehouseName}-${leg.tripId || 'no-trip'}-${idx}`} className="text-xs text-slate-600">
                          {leg.warehouseName}: {Number(leg.allocatedQty || 0)} {leg.tripNumber ? `| Trip ${leg.tripNumber}` : '| Not assigned'}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {Array.isArray(allocatingPoint?.order?.items) && allocatingPoint.order.items.length > 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="mb-2 text-sm font-semibold text-slate-900">Items For Assignment</p>
                  <div className="space-y-2">
                    {(() => {
                      const pendingItems = allocatingPoint.order.items.filter((item: any) => {
                        const allocatedQty = Math.max(0, Number(getItemAllocatedQtyForAssignedWarehouse(item) || 0))
                        const assignedToTripQty = Math.max(0, Number(getItemAllocatedQtyForTripWarehouse(item) || 0))
                        return Math.max(0, allocatedQty - assignedToTripQty) > 0
                      })
                      if (pendingItems.length === 0) {
                        return <p className="text-xs text-slate-500">All items for this warehouse are already assigned to this trip.</p>
                      }
                      return pendingItems.map((item: any, idx: number) => (
                        <div key={`alloc-item-${idx}`} className="rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2 text-xs">
                          {(() => {
                            const orderQty = Math.max(0, Number(item?.quantity || 0))
                            const allocatedQty = Math.max(0, Number(getItemAllocatedQtyForAssignedWarehouse(item) || 0))
                            const assignedToTripQty = Math.max(0, Number(getItemAllocatedQtyForTripWarehouse(item) || 0))
                            const needsQty = Math.max(0, allocatedQty - assignedToTripQty)
                            return (
                              <>
                          <p className="font-medium text-slate-900">{getOrderItemName(item)}</p>
                          <p className="text-slate-600">
                            {item?.itemType === 'MIXED_CASE' ? 'Contents' : 'Size'}: {getOrderItemSize(item)}
                          </p>
                          <p className="text-slate-600">Order Qty: {orderQty}</p>
                          <p className="text-slate-700">Already Allocated (this warehouse): {allocatedQty}</p>
                          <p className="text-slate-700">Assigned to this trip: {assignedToTripQty}</p>
                          <p className="font-semibold text-amber-700">Needs Trip Assignment (this warehouse): {needsQty}</p>
                              </>
                            )
                          })()}
                        </div>
                      ))
                    })()}
                  </div>
                </div>
              ) : null}
              {allocatingOrderAlreadyInSelectedTrip ? (
                <p className="text-xs text-slate-500">This order is already attached to this trip. No additional add action is needed.</p>
              ) : canDirectAssignCurrentDropPoint ? (
                <p className="text-xs text-emerald-700">This will assign your warehouse allocation for this order to the current trip.</p>
              ) : (
                <p className="text-xs text-amber-700">Next is disabled because no actionable assignment is available.</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAllocatingPoint(null)}>Cancel</Button>
                <Button
                  disabled={!canDirectAssignCurrentDropPoint || pendingItemsForAllocatingPoint.length === 0}
                  onClick={() => setConfirmAllocateOpen(true)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={confirmAllocateOpen} onOpenChange={setConfirmAllocateOpen}>
        <DialogContent className="max-w-md">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Confirm Assignment</h3>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-slate-600">
                Drop point: <span className="font-medium text-slate-900">{allocatingPoint?.order?.orderNumber || allocatingPoint?.locationName || 'Drop point'}</span>
              </p>
              <p className="mt-1 text-slate-600">
                Action: <span className="font-medium text-slate-900">Assign this order to current trip</span>
              </p>
              <p className="mt-1 text-emerald-700">Pending allocation to assign: {Number(pendingQtyForAllocatingPoint || 0)}</p>
              {pendingItemsForAllocatingPoint.length > 0 ? (
                <div className="mt-2 rounded-md border border-slate-200 bg-white px-2.5 py-2">
                  <p className="text-xs font-semibold text-slate-700">Products to assign</p>
                  <div className="mt-1 space-y-1">
                    {pendingItemsForAllocatingPoint.map((line, idx) => (
                      <p key={`confirm-alloc-item-${idx}`} className="text-xs text-slate-700">
                        {line.name}{line.size ? ` (${line.size})` : ''}: {Number(line.pendingQty || 0)}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmAllocateOpen(false)}>Back</Button>
              <Button
                disabled={!selectedTrip || !allocatingPoint || !canDirectAssignCurrentDropPoint || editingTripId === selectedTrip?.id}
                onClick={() => {
                  if (!selectedTrip || !allocatingPoint) return
                  const targetOrderId = String(allocatingPoint?.order?.id || '').trim()
                  if (!targetOrderId) return
                  onEditTripDropPoints(selectedTrip, {
                    addOrderIds: [targetOrderId],
                    removeDropPointIds: [],
                    assignWarehouseLegs: true,
                    assignWarehouseId: activeWarehouseId || undefined,
                  })
                  setConfirmAllocateOpen(false)
                  setAllocatingPoint(null)
                }}
              >
                {editingTripId === selectedTrip?.id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving
                  </>
                ) : (
                  'Confirm'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
