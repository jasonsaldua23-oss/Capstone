// Item display names. Purchase orders and purchase requests deliberately differ:
// an order card spells out what a mixed case contains, a request card does not.
// Both were inline closures in their web views; they live here so the Expo app
// renders identical text.

function getSizeLabel(item: any): string {
  const product = item?.product || {}
  const sizeFromArray =
    Array.isArray(product?.sizes) && product.sizes.length > 0
      ? product.sizes.map((s: any) => String(s).trim()).filter(Boolean).join(', ')
      : ''
  const sizeFromField = String(product?.size || product?.sizeLabel || item?.size || '').trim()
  return sizeFromArray || sizeFromField
}

/** Purchase-order cards: mixed cases list their components. */
export function getOrderItemDisplayName(item: any): string {
  if (item?.itemType === 'MIXED_CASE') {
    const components = (item?.components || [])
      .map((component: any) => `${component.productName} ${component.quantityPerCase}/case`)
      .join(', ')
    return `Mixed Case (${item.caseCapacity || 0} units)${components ? ` — ${components}` : ''}`
  }
  const baseName = String(item?.product?.name || 'Product').trim()
  const sizeLabel = getSizeLabel(item)
  return sizeLabel ? `${baseName} ${sizeLabel}` : baseName
}

/** Purchase-request cards: mixed cases are named only. */
export function getRequestItemDisplayName(item: any): string {
  if (item?.itemType === 'MIXED_CASE') return 'Mixed Case'
  const baseName = String(item?.product?.name || item?.productName || 'Product').trim()
  const sizeLabel = getSizeLabel(item)
  return sizeLabel ? `${baseName} ${sizeLabel}` : baseName
}

// ─── Purchase-request status ─────────────────────────────────────────────────

export type PRStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export function normalizePRStatus(value: any): PRStatus {
  const raw = String(value || '').trim().toUpperCase()
  if (raw === 'APPROVED') return 'APPROVED'
  if (raw === 'REJECTED') return 'REJECTED'
  if (raw === 'CANCELLED' || raw === 'CANCELED') return 'CANCELLED'
  return 'PENDING_APPROVAL'
}

/** Label and message per status; each platform supplies its own icon and styling. */
export function getPRStatusText(status: PRStatus): { label: string; message: string } {
  switch (status) {
    case 'APPROVED':
      return {
        label: 'Approved',
        message: 'Your purchase request has been approved. A purchase order has been created.',
      }
    case 'REJECTED':
      return { label: 'Rejected', message: 'Your purchase request was not approved.' }
    case 'CANCELLED':
      return { label: 'Cancelled', message: 'This purchase request has been cancelled.' }
    default:
      return {
        label: 'Pending Review',
        message: 'Your purchase request is currently being reviewed by warehouse staff.',
      }
  }
}

/** Date/time split used by the request and order cards. */
export function formatCardDateTime(rawDate: any): { date: string; time: string | null } {
  const raw = String(rawDate || '').trim()
  if (!raw) return { date: 'N/A', time: null }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) return { date: raw, time: null }
    return { date: parsed.toLocaleDateString(), time: null }
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return { date: raw, time: null }
  return {
    date: parsed.toLocaleDateString(),
    time: parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }
}

/**
 * Checkout line quantity, e.g. "12 cases" or "12 packs". Mixed cases and any
 * case-unit product read as cases; everything else uses its own unit.
 */
export function getCheckoutQuantityLabel(item: any): string {
  const quantity = Number(item?.quantity ?? 0)
  const isCase =
    item?.itemType === 'MIXED_CASE' || String(item?.unit || '').trim().toLowerCase() === 'case'
  if (isCase) return `${quantity} ${quantity === 1 ? 'case' : 'cases'}`
  const unit = String(item?.unit || 'unit').trim() || 'unit'
  return `${quantity} ${unit}${quantity === 1 ? '' : 's'}`
}
