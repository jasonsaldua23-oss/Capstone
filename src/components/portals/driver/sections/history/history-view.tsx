'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ChevronRight, Clock, Loader2, Search } from 'lucide-react'

type Trip = any

const stripPhilippinesFromAddress = (address: string | null | undefined) => {
  const text = String(address || '').trim()
  if (!text) return ''
  const tokens = text
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  while (tokens.length > 0) {
    const tail = String(tokens[tokens.length - 1] || '').toLowerCase()
    if (tail === 'philippines' || tail === 'republic of the philippines') {
      tokens.pop()
      continue
    }
    break
  }
  return tokens.join(', ')
}
export function HistoryView({
  trips,
  isLoading,
  onOpenTrip,
}: {
  trips: Trip[]
  isLoading: boolean
  onOpenTrip: (trip: Trip) => void
}) {
  const [search, setSearch] = useState('')
  const isCompletedTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'COMPLETED'
  const completedTrips = [...(trips || [])]
    .filter((trip) => isCompletedTrip(trip.status))
    .sort((a, b) => {
      const aDate = new Date(a.actualEndAt || a.updatedAt || a.createdAt || a.plannedStartAt || 0).getTime()
      const bDate = new Date(b.actualEndAt || b.updatedAt || b.createdAt || b.plannedStartAt || 0).getTime()
      return bDate - aDate
    })
  const visibleTrips = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return completedTrips
    return completedTrips.filter((trip) => {
      const tripText = String(trip.tripNumber || '').toLowerCase()
      const vehicleText = `${trip.vehicle?.licensePlate || ''} ${trip.vehicle?.type || ''}`.toLowerCase()
      const stopText = Array.isArray(trip.dropPoints)
        ? trip.dropPoints
            .map((stop: any) =>
              [
                stop?.locationName,
                stop?.address,
                stop?.city,
                stop?.order?.orderNumber,
                stop?.contactName,
              ]
                .filter(Boolean)
                .join(' ')
            )
            .join(' ')
            .toLowerCase()
        : ''
      return tripText.includes(q) || vehicleText.includes(q) || stopText.includes(q)
    })
  }, [completedTrips, search])

  const formatDate = (value?: string | null) => {
    if (!value) return 'N/A'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return 'N/A'
    return d.toLocaleString()
  }

  return (
    <div className="p-4">
      <h2 className="mb-4 text-xl font-semibold text-slate-900">Delivery History</h2>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search trip, order, customer, address, vehicle..."
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600 mx-auto mb-3" />
            <p className="text-sm text-slate-600">Loading delivery history...</p>
          </CardContent>
        </Card>
      ) : visibleTrips.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No matching delivery history</p>
            <p className="text-sm text-gray-400 mt-1">Try a different search keyword</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleTrips.map((trip) => (
            <Card key={trip.id} className="rounded-xl border border-slate-200 shadow-sm">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{trip.tripNumber}</p>
                    <p className="text-xs text-slate-500">Completed: {formatDate(trip.actualEndAt || trip.updatedAt)}</p>
                  </div>
                  <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200">COMPLETED</Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <p className="text-slate-500">Vehicle</p>
                    <p className="font-medium text-slate-900">
                      {trip.vehicle?.licensePlate || 'N/A'} ({trip.vehicle?.type || 'N/A'})
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <p className="text-slate-500">Stops</p>
                    <p className="font-medium text-slate-900">
                      {trip.completedDropPoints}/{trip.totalDropPoints}
                    </p>
                  </div>
                </div>

                {trip.dropPoints?.length ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-700">Stop Details</p>
                    <div className="space-y-1.5">
                      {trip.dropPoints.map((stop) => (
                        <div key={stop.id} className="rounded-md border border-slate-200 p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium text-slate-900">
                              #{stop.sequence} {stop.locationName || 'Drop Point'}
                            </p>
                            <Badge
                              className={
                                stop.status === 'COMPLETED'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : 'bg-slate-100 text-slate-700 border border-slate-200'
                              }
                            >
                              {stop.status}
                            </Badge>
                          </div>
                          <p className="text-slate-500">{[stripPhilippinesFromAddress(stop.address), stop.city].filter(Boolean).join(', ')}</p>
                          <p className="text-slate-500">Order: {stop.order?.orderNumber || 'N/A'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <Button className="w-full" variant="outline" onClick={() => onOpenTrip(trip)}>
                  View Details
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

