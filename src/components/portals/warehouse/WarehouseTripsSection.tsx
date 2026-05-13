'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Loader2, MapPin, Trash2, Truck } from 'lucide-react'

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
  assignedWarehouseName?: string
  tripStatusColors: Record<string, string>
  selectedTrip: TripItem | null
  setSelectedTrip: Dispatch<SetStateAction<TripItem | null>>
  onOpenCreateTripFlow: () => void
  onDeleteTrip: (trip: TripItem) => void
  availableOrders: Array<{
    id: string
    orderNumber: string
    shippingName?: string
    shippingCity?: string
    status?: string
  }>
  onEditTripDropPoints: (trip: TripItem, changes: { addOrderIds?: string[]; removeDropPointIds?: string[] }) => void
  editingTripId?: string | null
}

export function WarehouseTripsSection({
  loadingTrips,
  scopedTrips,
  assignedWarehouseName,
  tripStatusColors,
  selectedTrip,
  setSelectedTrip,
  onOpenCreateTripFlow,
  onDeleteTrip,
  availableOrders,
  onEditTripDropPoints,
  editingTripId,
}: WarehouseTripsSectionProps) {
  const [selectedDropPointDetail, setSelectedDropPointDetail] = useState<any | null>(null)
  const [selectedOrderToAdd, setSelectedOrderToAdd] = useState('')
  const formatPeso = (amount: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(amount)

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onOpenCreateTripFlow} className="bg-black text-white hover:bg-black/90 rounded-xl px-4">
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
            <div className="h-40 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
          ) : scopedTrips.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-500">No trips found</div>
          ) : (
            <div className="space-y-3">
              {scopedTrips.map((trip) => (
                (() => {
                  const statusKey = getEffectiveTripStatus(trip)
                  const deleteAllowed = canDeleteTrip(trip)
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
                      </div>
                      <p className="text-[13px] text-gray-700">
                        Vehicle: {trip.vehicle?.licensePlate || 'Unassigned'} | Driver: {trip.driver?.name || trip.driver?.user?.name || 'Unassigned'}
                      </p>
                      <p className="text-[13px] text-gray-600">
                        Route: {(assignedWarehouseName || 'Warehouse')} {'->'} {(trip.dropPoints?.[trip.dropPoints.length - 1]?.locationName || 'Destination')}
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
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedTrip} onOpenChange={(open) => !open && setSelectedTrip(null)}>
        <DialogContent className="max-w-3xl w-full">
          {selectedTrip && (
            (() => {
              const statusKey = getEffectiveTripStatus(selectedTrip)
              const effectiveCompletedDropPoints = getEffectiveCompletedDropPoints(selectedTrip)
              const effectiveTotalDropPoints = getEffectiveTotalDropPoints(selectedTrip)
              const deleteAllowed = canDeleteTrip(selectedTrip)
              const editingAllowed = deleteAllowed
              const existingOrderIds = new Set(
                (selectedTrip.dropPoints || [])
                  .map((point) => {
                    const row: any = point
                    return String(row?.orderId || row?.order?.id || '').trim()
                  })
                  .filter(Boolean)
              )
              const candidateOrders = availableOrders.filter((order) => !existingOrderIds.has(String(order.id || '').trim()))
              const isEditingTrip = editingTripId === selectedTrip.id
              return (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-lg font-bold text-gray-900">{selectedTrip.tripNumber}</span>
                <Badge className={tripStatusColors[statusKey] || 'bg-gray-100'}>{statusKey.replace(/_/g, ' ')}</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-8 text-red-600 hover:text-red-700"
                  disabled={!deleteAllowed}
                  onClick={() => {
                    if (!deleteAllowed) return
                    onDeleteTrip(selectedTrip)
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
                  <span className="font-semibold">Driver:</span> {selectedTrip.driver?.name || selectedTrip.driver?.user?.name || 'Unassigned'}
                </div>
              </div>
              <div className="flex flex-wrap gap-6 mb-2 text-sm">
                <div>
                  <span className="font-semibold">Progress:</span> {effectiveCompletedDropPoints}/{effectiveTotalDropPoints}
                </div>
                <div>
                  <span className="font-semibold">Drop points:</span> {selectedTrip.dropPoints?.length ?? 0}
                </div>
                <div>
                  <span className="font-semibold">Schedule:</span> {formatTripSchedule(selectedTrip.tripSchedule)}
                </div>
              </div>

              <div className="rounded-lg border bg-gray-50 p-3">
                <p className="text-sm font-semibold text-gray-900 mb-2">Drop Point Details</p>
                {Array.isArray(selectedTrip.dropPoints) && selectedTrip.dropPoints.length > 0 ? (
                  <div className="space-y-2 max-h-72 overflow-auto pr-1">
                    {selectedTrip.dropPoints.map((point: any, index) => {
                      const normalizedPointStatus = normalizeDropPointStatus(point.status)
                      const statusLabel = normalizedPointStatus.replace(/_/g, ' ') || 'PENDING'
                      const statusClass =
                        ['DELIVERED', 'COMPLETED', 'FULFILLED'].includes(normalizedPointStatus)
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : ['FAILED', 'CANCELLED', 'CANCELED', 'SKIPPED'].includes(normalizedPointStatus)
                            ? 'bg-red-100 text-red-700 border-red-200'
                            : normalizedPointStatus === 'IN_PROGRESS'
                              ? 'bg-blue-100 text-blue-700 border-blue-200'
                              : 'bg-gray-100 text-gray-700 border-gray-200'

                      const hasCoordinates =
                        typeof point.latitude === 'number' && typeof point.longitude === 'number'

                      return (
                        <div key={point.id} className="rounded-md border bg-white p-3">
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
                          <div className="mt-2">
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => setSelectedDropPointDetail(point)}
                              >
                                View Details
                              </Button>
                              {editingAllowed ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                  disabled={isEditingTrip}
                                  onClick={() => onEditTripDropPoints(selectedTrip, { removeDropPointIds: [point.id] })}
                                >
                                  Remove
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No drop-point records attached to this trip yet.</p>
                )}
              </div>
              {editingAllowed ? (
                <div className="rounded-lg border bg-white p-3">
                  <p className="text-sm font-semibold text-gray-900 mb-2">Add Drop Point</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-8 min-w-[320px] rounded-md border border-input bg-background px-2 text-xs"
                      value={selectedOrderToAdd}
                      onChange={(event) => setSelectedOrderToAdd(event.target.value)}
                      disabled={isEditingTrip}
                    >
                      <option value="">Select order to add</option>
                      {candidateOrders.map((order) => (
                        <option key={order.id} value={order.id}>
                          {order.orderNumber} | {order.shippingName || 'Customer'} | {order.shippingCity || 'City'} | {String(order.status || 'N/A').replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={isEditingTrip || !selectedOrderToAdd}
                      onClick={() => {
                        if (!selectedOrderToAdd) return
                        onEditTripDropPoints(selectedTrip, { addOrderIds: [selectedOrderToAdd] })
                        setSelectedOrderToAdd('')
                      }}
                    >
                      Add Drop Point
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end mt-4">
                <Button variant="outline" onClick={() => setSelectedTrip(null)}>Close</Button>
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
                  <span className="min-w-[108px] font-semibold text-slate-900">PO Number</span>
                  <span className="font-mono text-slate-800">{selectedDropPointDetail.order?.orderNumber || 'N/A'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="min-w-[108px] font-semibold text-slate-900">PO Status</span>
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
                <p className="mb-3 text-sm font-semibold text-slate-900">Order Items</p>
                {Array.isArray(selectedDropPointDetail.order?.items) && selectedDropPointDetail.order.items.length > 0 ? (
                  <div className="space-y-2 text-sm">
                    {selectedDropPointDetail.order.items.map((item: any, itemIndex: number) => (
                      <div key={`warehouse-dp-detail-item-${itemIndex}`} className="rounded-xl border border-white/60 bg-white/80 px-3 py-2.5 shadow-[0_4px_10px_rgba(15,23,42,0.06)]">
                        <p className="font-semibold text-slate-900">{item?.product?.name || 'Item'}</p>
                        <p className="mt-0.5 text-xs text-slate-500">Quantity: {Number(item?.quantity || 0)}</p>
                      </div>
                    ))}
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
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
