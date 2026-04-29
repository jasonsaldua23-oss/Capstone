'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Loader2, Search, Truck } from 'lucide-react'

type Trip = any
export function TripsListView({
  trips,
  isLoading,
  onSelectTrip,
}: {
  trips: Trip[]
  isLoading: boolean
  onSelectTrip: (trip: Trip) => void
}) {
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

  const statusColors: Record<string, string> = {
    PLANNED: 'bg-sky-100 text-sky-800 border border-sky-200',
    IN_PROGRESS: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    COMPLETED: 'bg-teal-100 text-teal-800 border border-teal-200',
    CANCELLED: 'bg-rose-100 text-rose-800 border border-rose-200',
  }
  const [deliverySearch, setDeliverySearch] = useState('')
  const activeTrips = (trips || []).filter((trip) => String(trip?.status || '').toUpperCase() !== 'COMPLETED')
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
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="p-4">
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
            <p className="mt-1 text-sm text-slate-500">Completed trips are in History.</p>
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
            <Card key={trip.id} className="cursor-pointer rounded-2xl border border-sky-100 bg-white/96 shadow-[0_12px_24px_rgba(2,132,199,0.10)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(2,132,199,0.14)]" onClick={() => onSelectTrip(trip)}>
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-bold tracking-tight text-slate-900">{trip.tripNumber}</p>
                      <Badge className={`${statusColors[trip.status] || 'bg-gray-100'} text-xs px-2 py-0.5`}>
                        {trip.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="text-[13px] leading-relaxed text-slate-700">Vehicle: {trip.vehicle?.licensePlate} | Driver: {trip.driver?.user?.name || trip.driver?.name || 'Assigned Driver'}</p>
                    <p className="text-[13px] leading-relaxed text-slate-600">Route: Warehouse {'->'} {trip.dropPoints?.[trip.dropPoints.length - 1]?.locationName || 'Destination'}</p>
                    <p className="text-[13px] leading-relaxed text-slate-600">Schedule: {formatTripSchedule(trip.tripSchedule)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 h-8 px-3 text-xs font-medium border-sky-200 text-sky-700 hover:bg-sky-50"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelectTrip(trip)
                    }}
                  >
                    View Details
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

