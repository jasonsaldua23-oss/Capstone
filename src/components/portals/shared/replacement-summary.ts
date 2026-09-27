/**
 * Replacement case counts and replaced quantities, shared by the Admin and
 * Warehouse dashboards so both report the same figures.
 */
export function summarizeReplacementCases(replacements: any[]) {
  const parseMeta = (notes: string | null | undefined) => {
    const raw = String(notes || '').trim()
    if (!raw) return {}
    const marker = 'Meta:'
    const markerIndex = raw.lastIndexOf(marker)
    if (markerIndex < 0) return {}
    const jsonText = raw.slice(markerIndex + marker.length).trim()
    if (!jsonText) return {}
    try {
      const parsed = JSON.parse(jsonText)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  let replacedQty = 0
  let replacedBottleQty = 0
  let replacedCaseQty = 0
  let resolvedOnDelivery = 0
  let needsFollowUp = 0
  let rejected = 0

  const getReplacementLinesForKpi = (entry: any, meta: any) =>
    (Array.isArray((entry as any)?.replacementLines) && (entry as any).replacementLines.length ? (entry as any).replacementLines : null) ||
    (Array.isArray((meta as any)?.replacementLines) && (meta as any).replacementLines.length ? (meta as any).replacementLines : null) ||
    (Array.isArray((entry as any)?.replacementItems) && (entry as any).replacementItems.length ? (entry as any).replacementItems : null) ||
    (Array.isArray((meta as any)?.replacementItems) && (meta as any).replacementItems.length ? (meta as any).replacementItems : null) ||
    []

  const getBottleReplacedQtyForKpi = (entry: any, meta: any): number => {
    const replacementLines = getReplacementLinesForKpi(entry, meta)
    const firstLine = replacementLines[0] || {}
    const lineBottleQty = Number(
      firstLine?.replacedBottles ??
      firstLine?.quantityReplacedBottles ??
      firstLine?.replacementBottles
    )
    if (Number.isFinite(lineBottleQty) && lineBottleQty > 0) return lineBottleQty

    const topBottleQty = Number(
      (entry as any)?.replacementBottles ??
      (meta as any)?.replacementBottles ??
      (entry as any)?.replacedBottles ??
      (meta as any)?.replacedBottles ??
      0
    )
    if (Number.isFinite(topBottleQty) && topBottleQty > 0) return topBottleQty

    // Fallback: text-based bottle classification when structural bottle qty is absent.
    const contextText = `${String((entry as any)?.reason || '')} ${String((entry as any)?.description || '')} ${String((entry as any)?.notes || '')}`.toLowerCase()
    const hasBottleText = /\bbottle(?:s)?\b/.test(contextText)
    const hasUnitEvidence = Number(
      firstLine?.replacedCases ??
      firstLine?.quantityReplacedCases ??
      firstLine?.replacementCases ??
      (entry as any)?.replacementCases ??
      (meta as any)?.replacementCases ??
      (entry as any)?.quantityReplacedCases ??
      (meta as any)?.quantityReplacedCases ??
      0
    ) > 0
    if (!hasBottleText || hasUnitEvidence) return 0

    return getCanonicalReplacedQtyForKpi(entry, meta)
  }

  const getCanonicalReplacedQtyForKpi = (entry: any, meta: any): number => {
    const qty = Number(
      (entry as any)?.replacementQuantity ??
      (meta as any)?.replacementQuantity ??
      (entry as any)?.quantityReplaced ??
      (meta as any)?.quantityReplaced ??
      0
    )
    return Number.isFinite(qty) && qty > 0 ? qty : 0
  }

  const getUnitReplacedQtyForKpi = (entry: any, meta: any): number => {
    const replacementLines = getReplacementLinesForKpi(entry, meta)
    const firstLine = replacementLines[0] || {}
    const directUnitQty = Number(
      firstLine?.replacedCases ??
      firstLine?.quantityReplacedCases ??
      firstLine?.replacementCases ??
      (entry as any)?.replacementCases ??
      (meta as any)?.replacementCases ??
      (entry as any)?.quantityReplacedCases ??
      (meta as any)?.quantityReplacedCases ??
      0
    )
    if (Number.isFinite(directUnitQty) && directUnitQty > 0) return directUnitQty

    const qtyPerCase = Number(
      firstLine?.quantityPerCase ??
      firstLine?.qtyPerUnit ??
      firstLine?.quantityPerUnit ??
      (entry as any)?.quantityPerCase ??
      (meta as any)?.quantityPerCase ??
      (entry as any)?.qtyPerUnit ??
      (meta as any)?.qtyPerUnit ??
      0
    )
    const canonicalQty = getCanonicalReplacedQtyForKpi(entry, meta)
    if (Number.isFinite(qtyPerCase) && qtyPerCase > 0 && canonicalQty > 0) {
      const units = canonicalQty / qtyPerCase
      return Number.isFinite(units) && units > 0 ? units : 0
    }
    // Keep unit KPI strict: no raw-quantity fallback, to avoid bottle leakage.
    return 0
  }

  for (const entry of replacements) {
    const meta = parseMeta(entry?.notes)
    const rawStatus = String(entry?.status || '').toUpperCase()
    const mode = String((entry as any)?.replacementMode || meta?.replacementMode || '').toUpperCase()
    const status =
      rawStatus === 'REQUESTED'
        ? 'REPORTED'
        : ['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)
          ? 'IN_PROGRESS'
          : rawStatus === 'REJECTED'
            ? 'REJECTED'
            : rawStatus === 'PROCESSED'
              ? 'COMPLETED'
              : rawStatus
    if (status === 'RESOLVED_ON_DELIVERY' || status === 'COMPLETED') {
      const replacementLines = getReplacementLinesForKpi(entry, meta)
      const firstLine = replacementLines[0] || {}
      const bottleQty = getBottleReplacedQtyForKpi(entry, meta)
      const lineReplacedUnits = Number(
        firstLine?.replacedCases ??
        firstLine?.quantityReplacedCases ??
        firstLine?.replacementCases
      )
      const fallbackQty = Number(
        (entry as any)?.quantityReplaced ??
        (meta as any)?.quantityReplaced ??
        (entry as any)?.replacementQuantity ??
        (meta as any)?.replacementQuantity ??
        0
      )
      const canonicalQty = getCanonicalReplacedQtyForKpi(entry, meta)
      const unitQty = getUnitReplacedQtyForKpi(entry, meta)
      const qty = unitQty > 0
        ? unitQty
        : Number.isFinite(fallbackQty) && fallbackQty > 0
          ? fallbackQty
          : Number.isFinite(lineReplacedUnits) && lineReplacedUnits > 0
            ? lineReplacedUnits
            : 0
      if (bottleQty <= 0 && qty > 0) {
        replacedQty += qty
      }

      if (bottleQty > 0) {
        replacedBottleQty += bottleQty
      } else {
        const caseQty = Number.isFinite(lineReplacedUnits) && lineReplacedUnits > 0
          ? lineReplacedUnits
          : (unitQty > 0 ? unitQty : (canonicalQty > 0 ? canonicalQty : (Number.isFinite(fallbackQty) && fallbackQty > 0 ? fallbackQty : 0)))
        if (caseQty > 0) replacedCaseQty += caseQty
      }
    }
    if (status === 'RESOLVED_ON_DELIVERY') {
      resolvedOnDelivery += 1
    }
    if (status === 'NEEDS_FOLLOW_UP' && mode !== 'CUSTOMER_SUBMITTED') {
      needsFollowUp += 1
    }
    if (status === 'REJECTED') {
      rejected += 1
    }
  }

  return {
    replacedQty,
    replacedBottleQty,
    replacedCaseQty,
    resolvedOnDelivery,
    needsFollowUp,
    rejected,
    totalCases: replacements.length,
  }
}
