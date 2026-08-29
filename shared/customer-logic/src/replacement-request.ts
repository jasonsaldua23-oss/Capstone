// Building a replacement request: which order lines can be selected, how much of
// each may be replaced, and how the submitted payload is shaped. Lifted from
// src/components/portals/customer/sections/orders/order-detail-page.tsx so the app
// submits exactly what the web does — the backend parses the combined description
// back out (`By Unit: n unit(s), Qty/Unit m`), so the wording is load-bearing.

export const DAMAGE_REASON_OPTIONS = [
  'Broken seal',
  'Cracked bottle',
  'Leaking',
  'Expired',
  'Crushed case',
  'Other',
]

export const MAX_EVIDENCE_PHOTOS = 2

export type ReplacementInputMode = 'case' | 'bottle'

export type ReplacementLine = {
  key: string
  productId: string
  quantity: string
  inputMode: ReplacementInputMode
  reason: string
  description: string
}

export type SelectableReplacementItem = {
  selectionId: string
  orderItem: any
  component: any | null
}

export function newReplacementLine(key: string): ReplacementLine {
  return { key, productId: '', quantity: '1', inputMode: 'case', reason: DAMAGE_REASON_OPTIONS[0], description: '' }
}

/** Mixed cases contribute one selectable entry per component, not one per case. */
export function getSelectableReplacementItems(order: any): SelectableReplacementItem[] {
  const orderItems = Array.isArray(order?.items) ? order.items : []
  return orderItems.flatMap((orderItem: any) => {
    if (orderItem?.itemType !== 'MIXED_CASE') {
      return [{ selectionId: String(orderItem?.id || ''), orderItem, component: null }]
    }
    return (orderItem?.components || []).map((component: any) => ({
      selectionId: `${orderItem.id}::${component.id || component.productId}`,
      orderItem,
      component,
    }))
  })
}

export function getQuantityPerCaseForItem(item: any): number {
  const value = Number(
    item?.quantityPerCase ??
      item?.quantity_per_case ??
      item?.product?.quantityPerCase ??
      item?.product?.quantity_per_case ??
      item?.product?.quantityPerUnit ??
      item?.product?.quantity_per_unit ??
      1
  )
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
}

export function getOrderedCaseQtyForItem(item: any): number {
  const value = Number(item?.quantity ?? item?.orderedQuantity ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function getSelectedReplacementItem(
  items: SelectableReplacementItem[],
  selectionId: string
): SelectableReplacementItem | undefined {
  return items.find((entry) => entry.selectionId === String(selectionId || ''))
}

export function getMaxReplacementQtyForLine(
  items: SelectableReplacementItem[],
  line: { productId: string; inputMode: ReplacementInputMode }
): number {
  const selected = getSelectedReplacementItem(items, line.productId)
  if (!selected) return 0
  if (selected.component) return Math.max(0, Number(selected.component.totalBaseUnits || 0))
  const orderedCases = getOrderedCaseQtyForItem(selected.orderItem)
  if (line.inputMode === 'case') return orderedCases
  return orderedCases * getQuantityPerCaseForItem(selected.orderItem)
}

/** A product already chosen on another line cannot be chosen again. */
export function getSelectableItemsForLine(
  items: SelectableReplacementItem[],
  lines: ReplacementLine[],
  lineKey: string
): SelectableReplacementItem[] {
  const takenByOtherLines = new Set(
    lines.filter((l) => l.key !== lineKey).map((l) => l.productId).filter(Boolean)
  )
  return items.filter((entry) => !takenByOtherLines.has(entry.selectionId))
}

export function getReplacementOptionLabel(entry: SelectableReplacementItem): string {
  if (entry.component) {
    return `${entry.component.productName || 'Mixed Case component'} - ${entry.component.totalBaseUnits || 0} ${entry.component.baseUnitLabel || 'unit'}(s)`
  }
  const item = entry.orderItem
  const productName = String(item?.product?.name || item?.productName || 'Item').trim()
  const sizeText =
    Array.isArray(item?.product?.sizes) && item.product.sizes.length
      ? item.product.sizes.map((size: any) => String(size).trim()).filter(Boolean).join(', ')
      : String(item?.product?.sizeLabel || item?.product?.size || item?.product?.unit || '').trim()
  const categoryText = String(item?.product?.category?.name || item?.product?.category || '').trim()
  return [productName, sizeText, categoryText].filter(Boolean).join(' - ')
}

export type BuiltReplacementRequest = {
  lines: any[]
  totalDamagedItems: number
  combinedReason: string
  combinedDescription: string
}

/**
 * Turns the form state into the submitted payload, throwing the web's own message
 * when a line exceeds what was ordered.
 */
export function buildReplacementRequest(
  items: SelectableReplacementItem[],
  lines: ReplacementLine[]
): BuiltReplacementRequest {
  const validLines = lines.filter((l) => l.productId && Number(l.quantity) > 0)
  if (validLines.length === 0) throw new Error('Add at least one valid damaged product line')

  const submittedLines = validLines.map((line) => {
    const selected = getSelectedReplacementItem(items, line.productId)
    const selectedItem = selected?.orderItem
    const component = selected?.component
    const product = component?.product || selectedItem?.product || {}
    const productName = component?.productName || product?.name || selectedItem?.productName || 'Product'
    const quantityPerCase = component ? 1 : getQuantityPerCaseForItem(selectedItem)
    const inputQty = Math.max(Number(line.quantity || 0), 0)
    const orderedCases = getOrderedCaseQtyForItem(selectedItem)
    const effectiveInputMode: ReplacementInputMode = component ? 'bottle' : line.inputMode
    const maxInputQty = component
      ? Number(component.totalBaseUnits || 0)
      : effectiveInputMode === 'case'
        ? orderedCases
        : orderedCases * quantityPerCase
    if (inputQty > maxInputQty) {
      throw new Error(
        `${productName}: replacement quantity cannot be higher than ordered quantity (${maxInputQty} ${effectiveInputMode === 'case' ? 'unit(s)' : 'base unit(s)'})`
      )
    }
    const quantityToReplace = effectiveInputMode === 'case' ? inputQty * quantityPerCase : inputQty
    const sizeLabel =
      Array.isArray(product?.sizes) && product.sizes.length
        ? product.sizes.map((size: any) => String(size).trim()).filter(Boolean).join(', ')
        : String(product?.size || '').trim()
    const productId = String(component?.productId || product?.id || selectedItem?.productId || '').trim() || undefined
    const productSku = String(component?.productSku || product?.sku || selectedItem?.productSku || '').trim() || undefined
    return {
      originalOrderItemId: String(selectedItem?.id || line.productId),
      mixedCaseComponentId: component?.id ? String(component.id) : undefined,
      originalProductId: productId,
      replacementProductId: productId,
      originalProductName: productName,
      originalProductSku: productSku,
      originalProductSize: sizeLabel || undefined,
      replacementProductName: productName,
      replacementProductSku: productSku,
      replacementProductSize: sizeLabel || undefined,
      inputMode: effectiveInputMode,
      lineInputMode: effectiveInputMode,
      quantityPerCase,
      qtyPerUnit: quantityPerCase,
      quantityToReplace,
      quantityToReplaceCases: effectiveInputMode === 'case' ? inputQty : undefined,
      quantityToReplaceUnits: effectiveInputMode === 'case' ? inputQty : undefined,
      quantityToReplaceBottles: effectiveInputMode === 'bottle' ? inputQty : undefined,
      reason: line.reason,
      description: line.description || undefined,
    }
  })

  const totalDamagedItems = submittedLines.reduce(
    (sum, l) => sum + Math.max(Number(l.quantityToReplace || 0), 0),
    0
  )
  const distinctReasons = Array.from(
    new Set(submittedLines.map((l) => String(l.reason || '').trim()).filter(Boolean))
  )
  const combinedReason = distinctReasons.length === 1 ? distinctReasons[0] : 'Multiple issues'
  const combinedDescription = submittedLines
    .map((l) => {
      const modeText =
        l.lineInputMode === 'case'
          ? `By Unit: ${l.quantityToReplaceCases || 0} unit(s), Qty/Unit ${l.quantityPerCase || 1}`
          : `By Bottle: ${l.quantityToReplaceBottles || 0} bottle(s), Qty/Unit ${l.quantityPerCase || 1}`
      const lineDetail = l.description ? `. ${l.description}` : ''
      return `[${l.originalProductName || 'Product'}] ${modeText}. Reason: ${l.reason}${lineDetail}`
    })
    .join('; ')

  return { lines: submittedLines, totalDamagedItems, combinedReason, combinedDescription }
}
