'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Trip } from './trip-detail-helpers'
import { Loader2 } from 'lucide-react'
import { buildOrderActionReason, DRIVER_ORDER_REASONS, OrderReasonCheckboxes } from '@/components/portals/shared/order-reason-checkboxes'

/**
 * The failed-delivery flow: choose reschedule or cancel, confirm the consequence, and pick the new delivery window.
 */
export type FailedDeliveryDialogsProps = {
  closeFailedDeliveryChoice: () => void
  closeFailedDeliveryReschedule: () => void
  deliveryNote: string
  failedDeliveryDropPointId: string | null
  failedDeliveryOtherDate: string
  failedDeliveryPendingAction: 'reschedule' | 'cancel' | null
  failedDeliveryReceiveAgain: 'tomorrow' | 'other_date'
  failedDeliveryRescheduleDropPointId: string | null
  handleUpdateDropPoint: (dropPointId: string, status: string, notes?: string, pod?: { recipientName?: string; deliveryPhoto?: string }, options?: { releaseInventory?: boolean; rescheduleRequested?: boolean; rescheduleWindow?: 'today' | 'tomorrow' | 'other_date'; rescheduleDate?: string; returnedEmpties?: Array<{ containerTypeId: string; returnedQuantity: number }> }) => Promise<boolean>
  isFailedDeliveryActionWarningOpen: boolean
  isFailedDeliveryChoiceOpen: boolean
  isFailedDeliveryRescheduleOpen: boolean
  isFailedDeliverySubmitting: boolean
  isUpdating: boolean
  openFailedDeliveryActionWarning: (action: 'reschedule' | 'cancel') => void
  openFailedDeliveryReschedule: (dropPointId: string) => void
  otherDriverCancelReason: string
  selectedDriverCancelReasons: string[]
  setFailedDeliveryOtherDate: Dispatch<SetStateAction<string>>
  setFailedDeliveryPendingAction: Dispatch<SetStateAction<'reschedule' | 'cancel' | null>>
  setFailedDeliveryReceiveAgain: Dispatch<SetStateAction<'tomorrow' | 'other_date'>>
  setIsFailedDeliveryActionWarningOpen: Dispatch<SetStateAction<boolean>>
  setIsFailedDeliverySubmitting: Dispatch<SetStateAction<boolean>>
  setOtherDriverCancelReason: Dispatch<SetStateAction<string>>
  setSelectedDriverCancelReasons: Dispatch<SetStateAction<string[]>>
  trip: Trip
}

export function FailedDeliveryDialogs({
  closeFailedDeliveryChoice,
  closeFailedDeliveryReschedule,
  deliveryNote,
  failedDeliveryDropPointId,
  failedDeliveryOtherDate,
  failedDeliveryPendingAction,
  failedDeliveryReceiveAgain,
  failedDeliveryRescheduleDropPointId,
  handleUpdateDropPoint,
  isFailedDeliveryActionWarningOpen,
  isFailedDeliveryChoiceOpen,
  isFailedDeliveryRescheduleOpen,
  isFailedDeliverySubmitting,
  isUpdating,
  openFailedDeliveryActionWarning,
  openFailedDeliveryReschedule,
  otherDriverCancelReason,
  selectedDriverCancelReasons,
  setFailedDeliveryOtherDate,
  setFailedDeliveryPendingAction,
  setFailedDeliveryReceiveAgain,
  setIsFailedDeliveryActionWarningOpen,
  setIsFailedDeliverySubmitting,
  setOtherDriverCancelReason,
  setSelectedDriverCancelReasons,
  trip,
}: FailedDeliveryDialogsProps) {
  return (
    <>
      <Dialog
        open={isFailedDeliveryChoiceOpen}
        onOpenChange={(open) => {
          if (isFailedDeliverySubmitting) return
          if (!open) closeFailedDeliveryChoice()
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">Failed Delivery</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                Choose whether to reschedule this delivery or cancel it.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                className="h-11 rounded-xl bg-amber-600 font-semibold text-white shadow-[0_12px_24px_rgba(217,119,6,0.24)] hover:bg-amber-700"
                onClick={() => {
                  if (!failedDeliveryDropPointId) return
                  openFailedDeliveryActionWarning('reschedule')
                }}
                disabled={isUpdating || isFailedDeliverySubmitting}
              >
                Reschedule
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-11 rounded-xl font-semibold shadow-[0_12px_24px_rgba(220,38,38,0.22)]"
                onClick={async () => {
                  if (!failedDeliveryDropPointId) return
                  openFailedDeliveryActionWarning('cancel')
                }}
                disabled={isUpdating || isFailedDeliverySubmitting}
              >
                Cancel Delivery
              </Button>
            </div>
            <Button type="button" variant="outline" className="h-11 w-full rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50" onClick={closeFailedDeliveryChoice} disabled={isUpdating || isFailedDeliverySubmitting}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isFailedDeliveryActionWarningOpen}
        onOpenChange={(open) => {
          if (isFailedDeliverySubmitting) return
          setIsFailedDeliveryActionWarningOpen(open)
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.35rem] font-black tracking-[-0.02em] text-amber-700">Confirm Action</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                {failedDeliveryPendingAction === 'reschedule'
                  ? 'You are about to reschedule this failed delivery.'
                  : 'You are about to cancel this failed delivery.'}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {failedDeliveryPendingAction === 'reschedule'
                ? 'Proceed only if customer requested another delivery attempt.'
                : 'Proceed only if delivery must be cancelled and should not be attempted again.'}
            </div>
            {failedDeliveryPendingAction === 'cancel' ? (
              <OrderReasonCheckboxes
                options={DRIVER_ORDER_REASONS}
                selectedReasons={selectedDriverCancelReasons}
                otherReason={otherDriverCancelReason}
                onSelectedReasonsChange={setSelectedDriverCancelReasons}
                onOtherReasonChange={setOtherDriverCancelReason}
                label="Cancellation reason (required)"
              />
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50"
                onClick={() => {
                  setIsFailedDeliveryActionWarningOpen(false)
                  setFailedDeliveryPendingAction(null)
                }}
                disabled={isUpdating || isFailedDeliverySubmitting}
              >
                Back
              </Button>
              <Button
                type="button"
                className={`h-11 rounded-xl font-semibold text-white ${failedDeliveryPendingAction === 'cancel' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                onClick={async () => {
                  if (!failedDeliveryDropPointId || !failedDeliveryPendingAction) return
                  const action = failedDeliveryPendingAction
                  if (action === 'reschedule') {
                    setIsFailedDeliveryActionWarningOpen(false)
                    setFailedDeliveryPendingAction(null)
                    openFailedDeliveryReschedule(failedDeliveryDropPointId)
                    return
                  }
                  setIsFailedDeliverySubmitting(true)
                  try {
                    const cancellationReason = buildOrderActionReason(selectedDriverCancelReasons, otherDriverCancelReason)
                    const completed = await handleUpdateDropPoint(
                      failedDeliveryDropPointId,
                      'CANCELLED',
                      cancellationReason
                    )
                    if (completed) {
                      setIsFailedDeliveryActionWarningOpen(false)
                      setFailedDeliveryPendingAction(null)
                      closeFailedDeliveryChoice()
                    }
                  } finally {
                    setIsFailedDeliverySubmitting(false)
                  }
                }}
                disabled={
                  isUpdating
                  || isFailedDeliverySubmitting
                  || !failedDeliveryPendingAction
                  || (failedDeliveryPendingAction === 'cancel' && !buildOrderActionReason(selectedDriverCancelReasons, otherDriverCancelReason))
                }
              >
                {isFailedDeliverySubmitting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                  : (failedDeliveryPendingAction === 'cancel' ? 'Confirm Cancel' : 'Confirm Reschedule')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isFailedDeliveryRescheduleOpen}
        onOpenChange={(open) => {
          if (isFailedDeliverySubmitting) return
          if (!open) closeFailedDeliveryReschedule()
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white p-0 shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:max-w-md">
          <DialogHeader>
            <div className="border-b border-sky-100/80 bg-white/70 px-5 pb-3.5 pt-5 backdrop-blur">
              <DialogTitle className="text-[1.45rem] font-black tracking-[-0.02em] text-[#123a67]">When should the order be received again?</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-[#4d6785]">
                Choose the next attempt window for this rescheduled delivery.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="max-h-[calc(100dvh-10rem)] space-y-3 overflow-y-auto px-5 pb-5 pt-4">
            <div className="grid grid-cols-1 gap-2">
              <Button
                type="button"
                variant={failedDeliveryReceiveAgain === 'tomorrow' ? 'default' : 'outline'}
                className={failedDeliveryReceiveAgain === 'tomorrow' ? 'h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]' : 'h-11 rounded-xl border border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50'}
                onClick={() => setFailedDeliveryReceiveAgain('tomorrow')}
                disabled={isUpdating || isFailedDeliverySubmitting}
              >
                Tomorrow
              </Button>
              <Button
                type="button"
                variant={failedDeliveryReceiveAgain === 'other_date' ? 'default' : 'outline'}
                className={failedDeliveryReceiveAgain === 'other_date' ? 'h-11 rounded-xl bg-[#0d61ad] font-semibold text-white shadow-[0_12px_24px_rgba(2,132,199,0.28)] hover:bg-[#0b579c]' : 'h-11 rounded-xl border border-sky-200 bg-white/85 font-semibold text-[#17365d] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50'}
                onClick={() => setFailedDeliveryReceiveAgain('other_date')}
                disabled={isUpdating || isFailedDeliverySubmitting}
              >
                Other date
              </Button>
            </div>
            {failedDeliveryReceiveAgain === 'other_date' ? (
              <div className="rounded-xl border border-sky-200/80 bg-white/80 px-3 py-3">
                <Label htmlFor="failed-delivery-other-date" className="text-xs font-semibold text-[#17365d]">
                  Select delivery date
                </Label>
                <Input
                  id="failed-delivery-other-date"
                  type="date"
                  className="mt-2"
                  value={failedDeliveryOtherDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(event) => setFailedDeliveryOtherDate(event.target.value)}
                  disabled={isUpdating || isFailedDeliverySubmitting}
                />
                <p className="mt-2 text-xs text-sky-800">
                  This order will be removed from this trip and returned to route planning.
                </p>
              </div>
            ) : null}
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              Inventory will stay reserved for this rescheduled delivery.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl border-sky-200 bg-white/85 font-semibold text-[#0f3d72] shadow-[0_8px_18px_rgba(15,23,42,0.08)] hover:bg-sky-50 hover:text-[#0f3d72]"
                onClick={closeFailedDeliveryReschedule}
                disabled={isUpdating || isFailedDeliverySubmitting}
              >
                Back
              </Button>
              <Button
                type="button"
                className="h-11 rounded-xl bg-amber-600 font-semibold text-white shadow-[0_12px_24px_rgba(217,119,6,0.24)] hover:bg-amber-700"
                onClick={async () => {
                  if (!failedDeliveryRescheduleDropPointId) return
                  if (failedDeliveryReceiveAgain === 'other_date' && !failedDeliveryOtherDate) {
                    toast.error('Select a date for reschedule')
                    return
                  }
                  const selectedOtherDateIso = failedDeliveryReceiveAgain === 'other_date'
                    ? new Date(`${failedDeliveryOtherDate}T09:00:00`).toISOString()
                    : undefined
                  const label =
                    failedDeliveryReceiveAgain === 'tomorrow'
                      ? 'tomorrow'
                      : `other date (${failedDeliveryOtherDate})`
                  setIsFailedDeliverySubmitting(true)
                  try {
                    const completed = await handleUpdateDropPoint(
                      failedDeliveryRescheduleDropPointId,
                      'FAILED',
                      `${deliveryNote || 'Delivery failed'} - reschedule requested (${label})`,
                      undefined,
                      {
                        releaseInventory: false,
                        rescheduleRequested: true,
                        rescheduleWindow: failedDeliveryReceiveAgain,
                        rescheduleDate:
                          failedDeliveryReceiveAgain === 'other_date'
                            ? selectedOtherDateIso
                            : (() => {
                              const scheduled = new Date()
                              if (failedDeliveryReceiveAgain === 'tomorrow') {
                                scheduled.setDate(scheduled.getDate() + 1)
                              }
                              return scheduled.toISOString()
                            })(),
                      }
                    )
                    if (completed) {
                      closeFailedDeliveryReschedule()
                      closeFailedDeliveryChoice()
                    }
                  } finally {
                    setIsFailedDeliverySubmitting(false)
                  }
                }}
                disabled={isUpdating || isFailedDeliverySubmitting}
              >
                {isFailedDeliverySubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</> : 'Confirm Reschedule'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
