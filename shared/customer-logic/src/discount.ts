// The checkout and detail views render the discount as one line, e.g.
// "Discount: ₱250.00 (5%)". Shared so the web component and the Expo app agree
// on both the wording and the percent rounding.

export function formatDiscountPercent(percent: number): string {
  const normalized = Number(percent)
  if (!Number.isFinite(normalized) || normalized <= 0) return ''
  return Number.isInteger(normalized) ? `${normalized}%` : `${normalized.toFixed(2).replace(/\.?0+$/, '')}%`
}

/** `value` is the already-formatted money string. */
export function formatDiscountLabel(value: string, percent?: number): string {
  const percentLabel = formatDiscountPercent(Number(percent || 0))
  return `Discount: ${value}${percentLabel ? ` (${percentLabel})` : ''}`
}

/**
 * The share of the subtotal a discount represents, used when the order does not
 * carry an explicit percent.
 */
export function getEffectiveDiscountPercent(subtotal: number, discount: number): number {
  return subtotal > 0 && discount > 0 ? (discount / subtotal) * 100 : 0
}
