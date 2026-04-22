'use client'

import type { Dispatch, SetStateAction } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Loader2, Route, Truck } from 'lucide-react'

type SavedRouteOrder = {
  id: string
  orderNumber?: string
  customerName?: string
  distanceKm: number | null
}

type SavedRouteItem = {
  id: string
  city: string
  totalDistanceKm?: number
  orderIds: string[]
  warehouseName: string
  date: string
  orders: SavedRouteOrder[]
}

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
  savedRoutes: SavedRouteItem[]
  loadingTrips: boolean
  scopedTrips: TripItem[]
  assignedWarehouseName?: string
  tripStatusColors: Record<string, string>
  selectedTrip: TripItem | null
  setSelectedTrip: Dispatch<SetStateAction<TripItem | null>>
  onOpenCreateRoute: () => void
  onOpenCreateTrip: () => void
  onDeleteSavedRoute: (routeId: string) => void
}

export function WarehouseTripsSection({
  savedRoutes,
  loadingTrips,
  scopedTrips,
  assignedWarehouseName,
  tripStatusColors,
  selectedTrip,
  setSelectedTrip,
  onOpenCreateRoute,
  onOpenCreateTrip,
  onDeleteSavedRoute,
}: WarehouseTripsSectionProps) {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onOpenCreateRoute} className="bg-black text-white hover:bg-black/90 rounded-xl px-4">
          <Route className="h-4 w-4 mr-2" />
          Create Route
        </Button>
        <Button
          onClick={onOpenCreateTrip}
          className="bg-black text-white hover:bg-black/90 rounded-xl px-4"
          disabled={savedRoutes.length === 0}
        >
          <Truck className="h-4 w-4 mr-2" />
          New Trip
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">Saved Routes</CardTitle>
          <CardDescription>Routes created ahead of time. Use New Trip to assign driver and dispatch.</CardDescription>
        </CardHeader>
        <CardContent>
          {savedRoutes.length === 0 ? (
            <div className="h-44 rounded-md border bg-gray-50 flex flex-col items-center justify-center text-center px-4">
              <p className="text-gray-600">No saved routes yet</p>
              <p className="text-sm text-gray-500">Click "Create Route" to save routes for later dispatch</p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedRoutes.map((route) => (
                <div key={route.id} className="rounded-md border">
                  <div className="flex items-center justify-between bg-gray-50 px-3 py-2 border-b">
                    <p className="font-medium">{route.city}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-600">{route.orderIds.length} orders • {Number(route.totalDistanceKm || 0).toFixed(2)} km total</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                        onClick={() => onDeleteSavedRoute(route.id)}
                      >
                        Delete Route
                      </Button>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    <p className="text-xs text-gray-500">
                      {route.warehouseName} • {new Date(route.date).toLocaleDateString()}
                    </p>
                    {route.orders.map((order) => (
                      <div key={order.id} className="flex items-center justify-between text-sm">
                        <p>
                          <span className="font-medium">{order.orderNumber}</span> - {order.customerName}
                        </p>
                        <p className="text-gray-600">{order.distanceKm !== null ? `${Number(order.distanceKm).toFixed(2)} km` : 'No geo data'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                        Vehicle: {trip.vehicle?.licensePlate || 'Unassigned'} • Driver: {trip.driver?.user?.name || 'Unassigned'}
                      </p>
                      <p className="text-[13px] text-gray-600">
                        Route: {(assignedWarehouseName || 'Warehouse')} {'->'} {(trip.dropPoints?.[trip.dropPoints.length - 1]?.locationName || 'Destination')}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 h-8 px-3 text-xs"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedTrip(trip)
                      }}
                    >
                      View Details
                    </Button>
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
              return (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-lg font-bold text-gray-900">{selectedTrip.tripNumber}</span>
                <Badge className={tripStatusColors[statusKey] || 'bg-gray-100'}>{statusKey.replace(/_/g, ' ')}</Badge>
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
