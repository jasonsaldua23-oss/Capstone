'use client'

export const OTHER_ORDER_REASON = 'Other reason'

export const CUSTOMER_ORDER_REASONS = [
  'Changed mind',
  'Wrong product or quantity ordered',
  'Duplicate order',
  'Unable to receive delivery',
  'Unable to complete payment',
  'Incorrect delivery address',
  OTHER_ORDER_REASON,
] as const

export const DRIVER_ORDER_REASONS = [
  'Customer unavailable',
  'Customer refused the order',
  'Customer cannot be contacted',
  'Incorrect or inaccessible delivery location',
  'Vehicle breakdown or accident',
  'Product damaged during delivery',
  'Unable to complete payment/deposit',
  OTHER_ORDER_REASON,
] as const

export const WAREHOUSE_ORDER_REASONS = [
  'Product out of stock',
  'Insufficient stock',
  'Product damaged or expired',
  'Incorrect product/quantity prepared',
  'Order cannot be fulfilled',
  'Order cannot be fulfilled today',
  'Inventory discrepancy',
  'Vehicle unavailable or insufficient capacity',
  OTHER_ORDER_REASON,
] as const

export function buildOrderActionReason(selectedReasons: string[], otherReason: string): string {
  const reasons = selectedReasons
    .filter((reason) => reason !== OTHER_ORDER_REASON)
    .map((reason) => reason.trim())
    .filter(Boolean)

  // Preserve the custom explanation only when the explicit Other option is selected.
  if (selectedReasons.includes(OTHER_ORDER_REASON) && otherReason.trim()) {
    reasons.push(`Other reason: ${otherReason.trim()}`)
  }
  return reasons.join('; ')
}

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
