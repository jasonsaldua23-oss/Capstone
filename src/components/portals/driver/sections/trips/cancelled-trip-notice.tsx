'use client'

import { ArrowRightLeft, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Shown in place of the trip screen once the warehouse cancels the trip
 * (views_trips.trip_cancel). Nothing on it can be delivered any more; any
 * undelivered orders go back to the warehouse.
 */
export function CancelledTripNotice({ trip, onBack }: { trip: any; onBack: () => void }) {
  // The stops the cancellation took off the road (the server marks them this way).
  const cancelledStops = (Array.isArray(trip?.dropPoints) ? trip.dropPoints : []).filter(
    (point: any) => String(point?.status || '').toUpperCase() === 'CANCELLED' && point?.failureReason === 'Trip cancelled'
  ).length
  const wasStarted = Boolean(trip?.actualStartAt)
  // Ended by a load transfer (views_trips.trip_transfer): the undelivered stops went to another truck.
  if (trip?.transferredToNumber) {
    return (
      <div className="w-full min-w-0 pt-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-4">
        <Card className="rounded-2xl border border-sky-200 bg-white/96 shadow-[0_12px_24px_rgba(2,132,199,0.10)]">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700">
                <ArrowRightLeft className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900">Your load moved to trip {trip.transferredToNumber}</h2>
                <p className="text-sm text-slate-600">{trip.transferReason || 'This truck cannot go on.'}</p>
              </div>
            </div>
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              Hand the undelivered orders over to the driver of trip {trip.transferredToNumber}, and stay with the truck until the warehouse says otherwise.
            </p>
            <p className="text-[13px] text-slate-500">This trip is in History. Stops you already delivered keep their proof of delivery.</p>
            <Button className="h-10 w-full bg-emerald-600 font-semibold text-white hover:bg-emerald-700" onClick={onBack}>
              Back to My Deliveries
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }
  return (
    <div className="w-full min-w-0 pt-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-4">
      <Card className="rounded-2xl border border-red-200 bg-white/96 shadow-[0_12px_24px_rgba(2,132,199,0.10)]">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700">
              <Ban className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900">Trip {trip?.tripNumber} was cancelled</h2>
              <p className="text-sm text-slate-600">
                {trip?.cancelledByName ? `${trip.cancelledByName} cancelled it` : 'The warehouse cancelled it'}
                {trip?.cancellationReason ? `: ${trip.cancellationReason}` : '.'}
              </p>
            </div>
          </div>
          {wasStarted && cancelledStops > 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              Bring the {cancelledStops} undelivered {cancelledStops === 1 ? 'order' : 'orders'} back to the warehouse.
            </p>
          ) : null}
          <p className="text-[13px] text-slate-500">It stays in History. Stops you already delivered keep their proof of delivery.</p>
          <Button className="h-10 w-full bg-emerald-600 font-semibold text-white hover:bg-emerald-700" onClick={onBack}>
            Back to My Deliveries
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
