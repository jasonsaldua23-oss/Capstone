/** Convert one replacement line from base quantity to its actual reporting unit. */
export function getReplacementLineQuantity(line: any, mode: 'toReplace' | 'replaced') {
  const positive = (value: any) => Number.isFinite(Number(value)) ? Math.max(Number(value), 0) : 0
  const inputMode = String(line?.lineInputMode || line?.replacementInputMode || '').toLowerCase()
  const productUnit = String(line?.productUnit || line?.replacementProductUnit || line?.originalProductUnit || line?.unit || '').toLowerCase()
  const bottleQty = mode === 'replaced'
    ? (line?.quantityReplacedBottles ?? line?.replacedBottles ?? line?.replacementBottles)
    : (line?.quantityToReplaceBottles ?? line?.damagedBottles ?? line?.replacementBottles)
  const unitQty = mode === 'replaced'
    ? (line?.quantityReplacedCases ?? line?.replacedCases ?? line?.quantityReplacedUnits ?? line?.unitsReplaced ?? line?.replacementCases)
    : (line?.quantityToReplaceCases ?? line?.damagedCases ?? line?.quantityToReplaceUnits ?? line?.unitsToReplace ?? line?.replacementCases)
  const rawQty = mode === 'replaced' ? line?.quantityReplaced : (line?.quantityToReplace ?? line?.quantity ?? line?.quantityReplaced)
  const capacity = positive(line?.quantityPerCase ?? line?.qtyPerUnit ?? line?.quantityPerUnit ?? line?.unitsPerCase ?? line?.bottlesPerCase ?? line?.bottlesPerUnit)
  // Fix: bottle input overrides the product's packaging; case input can represent a pack or bundle.
  const isBottle = inputMode === 'bottle' || (!inputMode && (positive(bottleQty) > 0 || productUnit.includes('bottle')))
  let unit = isBottle ? 'bottle'
    : productUnit.includes('pack') ? 'pack'
      : productUnit.includes('bundle') ? 'bundle'
        : productUnit.includes('case') ? 'case'
          : ['case', 'pack', 'bundle'].includes(inputMode) ? inputMode : 'unit'
  let quantity = isBottle ? positive(bottleQty ?? rawQty)
    : unitQty != null ? positive(unitQty) : capacity > 0 ? positive(rawQty) / capacity : positive(rawQty)
  // Fix: explicit zero fulfillment must never fall back to the requested quantity.
  if (mode === 'replaced' && rawQty != null && positive(rawQty) === 0) quantity = 0
  // Retain legacy display hints only when structured unit information is absent.
  if (!inputMode && !productUnit && bottleQty == null && unitQty == null && capacity === 0) {
    const display = String(mode === 'replaced' ? line?.quantityReplacedDisplay || '' : line?.quantityToReplaceDisplay || '')
    const match = display.match(/^(\d+(?:\.\d+)?)\s*(bottles?|cases?|packs?|bundles?|units?)$/i)
    if (match && !(mode === 'replaced' && rawQty != null && positive(rawQty) === 0)) {
      quantity = positive(match[1])
      unit = match[2].toLowerCase().replace(/s$/, '')
    }
  }
  return { quantity, unit, unitLabel: quantity === 1 ? unit : unit + 's' }
}

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
      // Fix: mixed requests can contain both packaged units and bottles on later lines.
      if (replacementLines.length > 0) {
        for (const line of replacementLines) {
          const { quantity, unit } = getReplacementLineQuantity(line, 'replaced')
          if (unit === 'bottle') replacedBottleQty += quantity
          else {
            replacedQty += quantity
            replacedCaseQty += quantity
          }
        }
      } else {
        // Preserve the existing fallback for legacy records without product lines.
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
