'use client'

// Customer reasons and the composer moved to shared/customer-logic so the Expo
// customer app offers the same list.
export {
  OTHER_ORDER_REASON,
  CUSTOMER_ORDER_REASONS,
  buildOrderActionReason,
} from '@shared/customer-logic/order-reasons'

import { OTHER_ORDER_REASON } from '@shared/customer-logic/order-reasons'

// Driver cancellation is intentionally limited to customer refusal or the customer
// being unable to pay the driver in cash. Anything else is a reschedule.
export const DRIVER_ORDER_REASONS = [
  'Customer refused the order',
  'Customer unable to pay',
] as const

// Rejection only happens while a purchase request is pending approval: no stock
// is reserved, nothing is picked and no vehicle is assigned yet. Expired or
// quarantined batches are already excluded from sellable stock, so they surface
// as out of stock or insufficient stock. The chosen text is shown to the customer.
export const PURCHASE_REQUEST_REJECTION_REASONS = [
  'Product out of stock',
  'Insufficient stock',
  'Unable to deliver on the requested date',
  'No delivery vehicle or truck capacity available',
  'Duplicate purchase request',
  'Incomplete or incorrect delivery details',
  OTHER_ORDER_REASON,
] as const

// Cancellation reasons are limited to issues that permanently stop the order.
// Staff cancel approved orders that are not on a trip yet. Their stock is already
// reserved, so a shortfall means that reserved stock went bad or is not on the shelf.
export const WAREHOUSE_CANCELLATION_REASONS = [
  'Customer requested cancellation',
  'Duplicate order',
  'Incorrect products or quantities ordered',
  'Stock found damaged, expired or missing',
  'Order no longer needed after rescheduling',
  OTHER_ORDER_REASON,
] as const


export function OrderReasonCheckboxes({
  options,
  selectedReasons,
  otherReason,
  onSelectedReasonsChange,
  onOtherReasonChange,
  label = 'Select reason(s)',
}: {
  options: readonly string[]
  selectedReasons: string[]
  otherReason: string
  onSelectedReasonsChange: (reasons: string[]) => void
  onOtherReasonChange: (reason: string) => void
  label?: string
}) {
  const toggleReason = (reason: string, checked: boolean) => {
    const nextReasons = checked
      ? Array.from(new Set([...selectedReasons, reason]))
      : selectedReasons.filter((item) => item !== reason)
    onSelectedReasonsChange(nextReasons)
    if (reason === OTHER_ORDER_REASON && !checked) onOtherReasonChange('')
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">{label}</legend>
      <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        {options.map((reason) => (
          <label key={reason} className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
              checked={selectedReasons.includes(reason)}
              onChange={(event) => toggleReason(reason, event.target.checked)}
            />
            <span>{reason}</span>
          </label>
        ))}
      </div>
      {selectedReasons.includes(OTHER_ORDER_REASON) ? (
        <textarea
          required
          aria-label="Other reason"
          className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Type your reason"
          value={otherReason}
          onChange={(event) => onOtherReasonChange(event.target.value)}
        />
      ) : null}
    </fieldset>
  )
}
