'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PortalCardsSkeleton } from '@/components/portals/shared/loading-skeletons'
import { FileText, Navigation, Search, Truck } from 'lucide-react'
import { formatTripScheduledDay, getTripScheduledDateKey, isTripOverdue, tripStatusBadgeColors } from './trip-detail-format'

type Trip = any
export function TripsListView({
  trips,
  isLoading,
  onSelectTrip,
  onViewTripDetails,
}: {
  trips: Trip[]
  isLoading: boolean
  // Opens the running trip: map, navigation and proof of delivery.
  onSelectTrip: (trip: Trip) => void
  // Opens the trip's paperwork: its purchase orders and who ordered them.
  onViewTripDetails: (trip: Trip) => void
}) {
  const statusColors = tripStatusBadgeColors
  const [deliverySearch, setDeliverySearch] = useState('')
  // Fix: My Deliveries holds only work the driver can still do - the running trip,
  // then upcoming planned trips soonest first. Cancelled and overdue trips (and
  // completed ones) are in History. The API orders by last update, so sort here.
  const statusRank = (trip: Trip) => (String(trip?.status || '').toUpperCase() === 'IN_PROGRESS' ? 0 : 1)
  const activeTrips = (trips || [])
    .filter((trip) => {
      const status = String(trip?.status || '').toUpperCase()
      return status === 'IN_PROGRESS' || (status === 'PLANNED' && !isTripOverdue(trip))
    })
    .sort((a, b) => {
      const rankDiff = statusRank(a) - statusRank(b)
      if (rankDiff !== 0) return rankDiff
      // Unscheduled trips sort after every dated one.
      const aKey = getTripScheduledDateKey(a) || '9999-12-31'
      const bKey = getTripScheduledDateKey(b) || '9999-12-31'
      if (aKey !== bKey) return aKey < bKey ? -1 : 1
      return String(a?.tripNumber || '').localeCompare(String(b?.tripNumber || ''))
    })
  const filteredDeliveryTrips = activeTrips.filter((trip) => {
    const query = deliverySearch.trim().toLowerCase()
    if (!query) return true

    const searchableText = [
      trip.tripNumber,
      trip.status,
      trip.vehicle?.licensePlate,
      trip.driver?.user?.name,
      trip.driver?.name,
      ...(Array.isArray(trip.dropPoints) ? trip.dropPoints.map((point) => point.locationName) : []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return searchableText.includes(query)
  })

  if (isLoading) {
    return <PortalCardsSkeleton cards={3} />
  }

  return (
    // The portal shell owns horizontal gutters so phone layouts do not receive double padding.
    // The bottom pad is the phone nav's clearance -- its own height plus the home
    // indicator -- matching Home, History and Profile. Without it the list fell back
    // to the shell's flat `pb-24`, which is blind to the safe-area inset, and the
    // last delivery card sat underneath the bar.
    <div className="w-full min-w-0 pt-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Assigned Routes</p>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="mt-0 text-xl font-black tracking-[-0.01em] text-slate-900">My Deliveries</h2>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={deliverySearch}
            onChange={(event) => setDeliverySearch(event.target.value)}
            placeholder="Search deliveries"
            className="h-10 rounded-xl border-sky-100 bg-white/90 pl-9 text-sm shadow-[0_8px_18px_rgba(2,132,199,0.08)]"
          />
        </div>
      </div>

      {activeTrips.length === 0 ? (
        <Card className="rounded-2xl border border-sky-100 bg-white/96 shadow-[0_12px_24px_rgba(2,132,199,0.10)]">
          <CardContent className="py-12 text-center">
            <Truck className="mx-auto mb-4 h-12 w-12 text-sky-300" />
            <p className="font-semibold text-slate-700">No active deliveries</p>
            <p className="mt-1 text-sm text-slate-500">Completed, overdue, and cancelled trips are in History.</p>
          </CardContent>
        </Card>
      ) : filteredDeliveryTrips.length === 0 ? (
        <Card className="rounded-2xl border border-sky-100 bg-white/96 shadow-[0_12px_24px_rgba(2,132,199,0.10)]">
          <CardContent className="py-12 text-center">
            <Search className="mx-auto mb-4 h-10 w-10 text-sky-300" />
            <p className="font-semibold text-slate-700">No deliveries found</p>
            <p className="mt-1 text-sm text-slate-500">Try another trip, vehicle, driver, or location.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredDeliveryTrips.map((trip) => (
            // The card body reads the paperwork; starting the run is its own
            // deliberate button, since that screen turns on location tracking.
            <Card key={trip.id} className="min-w-0 cursor-pointer rounded-2xl border border-sky-100 bg-white/96 shadow-[0_12px_24px_rgba(2,132,199,0.10)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(2,132,199,0.14)]" onClick={() => onViewTripDetails(trip)}>
              <CardContent className="min-w-0 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 break-words text-base font-bold tracking-tight text-slate-900">{trip.tripNumber}</p>
                  <Badge className={`${statusColors[trip.status] || 'bg-gray-100'} shrink-0 px-2 py-0.5 text-xs`}>
                    {trip.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                <div className="mt-3 min-w-0 space-y-1">
                  <p className="break-words text-[13px] leading-relaxed text-slate-700">Vehicle: {trip.vehicle?.licensePlate} | Driver: {trip.driver?.user?.name || trip.driver?.name || 'Assigned Driver'}</p>
                  <p className="break-words text-[13px] leading-relaxed text-slate-600">Route: Warehouse {'->'} {trip.dropPoints?.[trip.dropPoints.length - 1]?.locationName || 'Destination'}</p>
                  <p className="break-words text-[13px] leading-relaxed text-slate-600">Schedule: {formatTripScheduledDay(trip)}</p>
                </div>
                {/* Side by side from 340px up; only the narrowest phones stack. */}
                <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3 min-[340px]:flex-row">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10 border-sky-200 px-3 text-sm font-medium text-sky-700 hover:bg-sky-50 min-[340px]:flex-1"
                    onClick={(event) => {
                      event.stopPropagation()
                      onViewTripDetails(trip)
                    }}
                  >
                    <FileText className="size-4" />
                    View Details
                  </Button>
                  <Button
                    size="sm"
                    className="h-10 bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 min-[340px]:flex-1"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelectTrip(trip)
                    }}
                  >
                    <Navigation className="size-4" />
                    Open Trip
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

