// Order-action reasons. Lifted from
// src/components/portals/shared/order-reason-checkboxes.tsx so the Expo customer
// app offers the same options and submits the same composed string — the app had
// an entirely different list.

export const OTHER_ORDER_REASON = 'Other reason'

// Customers can only cancel a request that is still pending approval, and they
// cannot edit it, so cancelling is how they fix a wrong product, address or date.
// Payment is cash to the driver on delivery; nothing is paid before that.
export const CUSTOMER_ORDER_REASONS = [
  'Changed my mind',
  'Wrong product or quantity ordered',
  'Duplicate order',
  'Unable to receive delivery',
  'Unable to pay on delivery',
  'Incorrect delivery address',
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
