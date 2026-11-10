'use client'

import { useState } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ACTION_INSPECT, ACTION_REFUSE } from '@/components/portals/shared/row-actions'
import { useVehicleIncidents } from '@/components/portals/shared/use-vehicle-incidents'
import { incidentTypeLabel } from '@/lib/vehicle-incidents'

export type CancelTripTarget = {
  id: string
  tripNumber: string
  status?: string
  vehicle?: { licensePlate?: string } | null
  dropPoints?: Array<{ status?: string }>
}

export type CancelTripRequest = { reason: string; sendVehicleForRepair: boolean }

const OPEN_STOP_STATUSES = ['PENDING', 'IN_TRANSIT', 'ARRIVED']
const REASON_MAX_LENGTH = 500

/**
 * Cancels a planned or running trip; the trip stays on record with the reason.
 * The server (views_trips.trip_cancel) decides what happens to each stop; this
 * dialog says the same thing before the warehouse confirms. A running trip's open
 * incident report closes with it, optionally sending the truck for repair.
 */
export function WarehouseCancelTripDialog({
  trip,
  onClose,
  onCancelTrip,
}: {
  trip: CancelTripTarget | null
  onClose: () => void
  onCancelTrip: (request: CancelTripRequest) => Promise<boolean>
}) {
  const [reason, setReason] = useState('')
  // null until the warehouse chooses: then a truck reported unable to continue goes for repair.
  const [repairChoice, setRepairChoice] = useState<boolean | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const isRunning = String(trip?.status || '').toUpperCase() === 'IN_PROGRESS'
  // Only a running trip can have an incident report; it closes with the trip.
  const { incidents } = useVehicleIncidents({ tripId: trip?.id, enabled: Boolean(trip?.id) && isRunning })
  const openIncident = incidents.find((incident) => incident.isOpen) || null
  const sendForRepair = openIncident ? (repairChoice ?? !openIncident.vehicleCanContinue) : false
  const plate = trip?.vehicle?.licensePlate || 'the truck'
  const points = trip?.dropPoints || []
  const openStops = points.filter((point) => OPEN_STOP_STATUSES.includes(String(point?.status || '').toUpperCase())).length
  const doneStops = points.length - openStops
  const trimmedReason = reason.trim()

  const submit = async () => {
    if (!trimmedReason || isSaving) return
    setIsSaving(true)
    const cancelled = await onCancelTrip({ reason: trimmedReason, sendVehicleForRepair: sendForRepair })
    setIsSaving(false)
    if (cancelled) onClose()
  }

  return (
    <Dialog open={Boolean(trip)} onOpenChange={(open) => { if (!open && !isSaving) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel trip {trip?.tripNumber}</DialogTitle>
          <DialogDescription>
            The trip stays on record as Cancelled, with your reason, and the driver is notified.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 rounded-md border border-amber-200 bg-amber-50 py-2 pl-7 pr-3 text-xs leading-relaxed text-amber-900">
          {isRunning ? (
            <>
              {doneStops > 0 ? <li>{doneStops} {doneStops === 1 ? 'stop' : 'stops'} already done {doneStops === 1 ? 'keeps its' : 'keep their'} outcome.</li> : null}
              <li>
                {openStops} undelivered {openStops === 1 ? 'order comes' : 'orders come'} back to the warehouse as Rescheduled, with stock still held, ready for another trip. Each customer is told.
              </li>
              <li>{sendForRepair ? `${plate} goes to Maintenance.` : 'The truck is released for other trips.'}</li>
              {openIncident ? (
                <li>
                  {incidentTypeLabel(openIncident.type)} report {openIncident.incidentNumber} closes with the trip.
                </li>
              ) : null}
            </>
          ) : (
            <li>
              {openStops} {openStops === 1 ? 'order stays' : 'orders stay'} in Processing with the same delivery date, ready to be put on another trip.
            </li>
          )}
        </ul>
        {openIncident ? (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-emerald-600"
              checked={sendForRepair}
              disabled={isSaving}
              onChange={(event) => setRepairChoice(event.target.checked)}
            />
            <span>Send {plate} for repair (Maintenance)</span>
          </label>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="cancel-trip-reason">Reason</Label>
          <Textarea
            id="cancel-trip-reason"
            value={reason}
            maxLength={REASON_MAX_LENGTH}
            disabled={isSaving}
            placeholder="Why is this trip cancelled?"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" className={ACTION_INSPECT} disabled={isSaving} onClick={onClose}>
            Keep trip
          </Button>
          <Button variant="outline" className={ACTION_REFUSE} disabled={!trimmedReason || isSaving} onClick={() => void submit()}>
            {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
            Cancel trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
