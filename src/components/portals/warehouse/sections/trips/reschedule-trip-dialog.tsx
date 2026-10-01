'use client'

import { useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ACTION_ADVANCE, ACTION_INSPECT } from '@/components/portals/shared/row-actions'
import { localDateInputValue } from '@/lib/local-date'

/**
 * Moves an overdue trip, with every order on it, to a new delivery day.
 */
export type RescheduleTripTarget = {
  id: string
  tripNumber: string
  scheduledDate?: string | null
}

// A YYYY-MM-DD key is a calendar day; build it locally so no timezone shifts it.
const formatDayKey = (key: string | null | undefined) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || '').trim())
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function WarehouseRescheduleTripDialog({
  trip,
  onClose,
  onReschedule,
}: {
  trip: RescheduleTripTarget | null
  onClose: () => void
  onReschedule: (scheduledDate: string) => Promise<boolean>
}) {
  const today = localDateInputValue()
  const [scheduledDate, setScheduledDate] = useState(today)
  const [isSaving, setIsSaving] = useState(false)
  const missedDay = formatDayKey(trip?.scheduledDate)
  const isPastDay = Boolean(scheduledDate) && scheduledDate < today

  const submit = async () => {
    if (!scheduledDate || isPastDay || isSaving) return
    setIsSaving(true)
    const saved = await onReschedule(scheduledDate)
    setIsSaving(false)
    if (saved) onClose()
  }

  return (
    <Dialog open={Boolean(trip)} onOpenChange={(open) => { if (!open && !isSaving) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule trip {trip?.tripNumber}</DialogTitle>
          <DialogDescription>
            {missedDay ? `It was scheduled for ${missedDay} and never started. ` : 'Its scheduled day passed before it started. '}
            Every order on this trip moves to the new day, and the driver and each customer are notified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="reschedule-trip-date">New delivery day</Label>
          <Input
            id="reschedule-trip-date"
            type="date"
            min={today}
            value={scheduledDate}
            disabled={isSaving}
            onChange={(event) => setScheduledDate(event.target.value)}
          />
          {isPastDay ? <p className="text-xs text-red-600">Choose today or a later day.</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" className={ACTION_INSPECT} disabled={isSaving} onClick={onClose}>
            Cancel
          </Button>
          <Button className={ACTION_ADVANCE} disabled={!scheduledDate || isPastDay || isSaving} onClick={() => { void submit() }}>
            {isSaving ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
            Reschedule Trip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
