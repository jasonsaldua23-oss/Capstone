'use client'

import type { Dispatch, SetStateAction } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Loader2, Trash2, Truck } from 'lucide-react'

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
}: WarehouseTripsSectionProps) {
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
                        Vehicle: {trip.vehicle?.licensePlate || 'Unassigned'} | Driver: {trip.driver?.user?.name || 'Unassigned'}
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
                  <span className="font-semibold">Driver:</span> {selectedTrip.driver?.user?.name || 'Unassigned'}
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
                    {selectedTrip.dropPoints.map((point, index) => {
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
    </div>
  )
}
