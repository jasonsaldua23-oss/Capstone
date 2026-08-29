// Order-action reasons. Lifted from
// src/components/portals/shared/order-reason-checkboxes.tsx so the Expo customer
// app offers the same options and submits the same composed string — the app had
// an entirely different list.

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
