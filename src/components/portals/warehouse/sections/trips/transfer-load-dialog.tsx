'use client'

import { useMemo, useState } from 'react'
import { ArrowRightLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ACTION_ADVANCE, ACTION_INSPECT } from '@/components/portals/shared/row-actions'
import type { DriverOption } from '../../warehouse-portal-types'

export type TransferLoadTarget = {
  id: string
  tripNumber: string
  driver?: { id?: string; name?: string; user?: { name?: string } } | null
  vehicle?: { licensePlate?: string } | null
  dropPoints?: Array<{ status?: string }>
}

export type TransferLoadRequest = {
  driverId: string
  vehicleId: string
  reason: string
  sendVehicleForRepair: boolean
}

const OPEN_STOP_STATUSES = ['PENDING', 'IN_TRANSIT', 'ARRIVED']
const USABLE_VEHICLE_STATUSES = ['AVAILABLE', 'IN_USE']
const REASON_MAX_LENGTH = 500

const driverName = (driver: DriverOption) => driver.user?.name || driver.name || driver.email || 'Driver'
const assignedVehicle = (driver: DriverOption) => (driver.vehicles || []).find((entry) => entry?.vehicle?.id)?.vehicle || null

/**
 * Hands a running trip's undelivered stops to another driver and truck after an
 * accident or breakdown (views_trips.trip_transfer, which repeats every check).
 */
export function WarehouseTransferLoadDialog({
  trip,
  drivers,
  busyDriverIds,
  onClose,
  onTransfer,
}: {
  trip: TransferLoadTarget | null
  drivers: DriverOption[]
  /** Drivers already on the road; one driver runs one trip at a time. */
  busyDriverIds: Set<string>
  onClose: () => void
  onTransfer: (request: TransferLoadRequest) => Promise<boolean>
}) {
  const [driverId, setDriverId] = useState('')
  const [reason, setReason] = useState('')
  const [sendForRepair, setSendForRepair] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const openStops = (trip?.dropPoints || []).filter((point) => OPEN_STOP_STATUSES.includes(String(point?.status || '').toUpperCase())).length
  const brokenPlate = trip?.vehicle?.licensePlate || 'the truck'
  const options = useMemo(() => (
    drivers
      .filter((driver) => driver.id !== trip?.driver?.id && driver.isActive !== false)
      .map((driver) => {
        const vehicle = assignedVehicle(driver)
        const issue = !vehicle
          ? 'no truck'
          : !USABLE_VEHICLE_STATUSES.includes(String(vehicle.status || 'AVAILABLE').toUpperCase())
            ? 'truck unavailable'
            : busyDriverIds.has(driver.id)
              ? 'on the road'
              : ''
        return { driver, vehicle, issue }
      })
      .sort((a, b) => Number(Boolean(a.issue)) - Number(Boolean(b.issue)) || driverName(a.driver).localeCompare(driverName(b.driver)))
  ), [drivers, trip?.driver?.id, busyDriverIds])
  const selected = options.find((option) => option.driver.id === driverId && !option.issue) || null
  const trimmedReason = reason.trim()

  const submit = async () => {
    if (!selected?.vehicle?.id || !trimmedReason || isSaving) return
    setIsSaving(true)
    const done = await onTransfer({
      driverId: selected.driver.id,
      vehicleId: selected.vehicle.id,
      reason: trimmedReason,
      sendVehicleForRepair: sendForRepair,
    })
    setIsSaving(false)
    if (done) onClose()
  }

  return (
    <Dialog open={Boolean(trip)} onOpenChange={(open) => { if (!open && !isSaving) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer the load of {trip?.tripNumber}</DialogTitle>
          <DialogDescription>
            For a truck that cannot go on. Its {openStops} undelivered {openStops === 1 ? 'stop goes' : 'stops go'} to another driver on a new trip; stops already done stay on this one.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-1 rounded-md border border-sky-200 bg-sky-50 py-2 pl-7 pr-3 text-xs leading-relaxed text-sky-900">
          <li>The new driver goes to where {brokenPlate} stopped and takes the load.</li>
          <li>They confirm the load and start the new trip, then deliver the remaining stops.</li>
          <li>The orders stay Out for Delivery; each customer is told another vehicle is coming.</li>
        </ol>
        <div className="space-y-1">
          <Label htmlFor="transfer-driver">Driver taking over</Label>
          <select
            id="transfer-driver"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={driverId}
            disabled={isSaving}
            onChange={(event) => setDriverId(event.target.value)}
          >
            <option value="">Select a driver</option>
            {options.map(({ driver, vehicle, issue }) => (
              <option key={driver.id} value={driver.id} disabled={Boolean(issue)}>
                {driverName(driver)}{vehicle?.licensePlate ? ` · ${vehicle.licensePlate}` : ''}{issue ? ` (${issue})` : ''}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-emerald-600"
            checked={sendForRepair}
            disabled={isSaving}
            onChange={(event) => setSendForRepair(event.target.checked)}
          />
          <span>Send {brokenPlate} for repair (Maintenance). Its incident report closes with the trip either way.</span>
        </label>
        <div className="space-y-1">
          <Label htmlFor="transfer-reason">Reason</Label>
          <Textarea
            id="transfer-reason"
            value={reason}
            maxLength={REASON_MAX_LENGTH}
            disabled={isSaving}
            placeholder="What happened to the truck?"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" className={ACTION_INSPECT} disabled={isSaving} onClick={onClose}>
            Cancel
          </Button>
          <Button className={ACTION_ADVANCE} disabled={!selected || !trimmedReason || isSaving || openStops === 0} onClick={() => void submit()}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}
            Transfer load
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
