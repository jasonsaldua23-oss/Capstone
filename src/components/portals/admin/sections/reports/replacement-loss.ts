// Fix: value replaced bottles against their exact original order line, never a name match.
export function getReplacementLineLoss(line: any, orderItems: any[]): number | null {
  const quantity = Number(line?.quantityReplaced ?? 0)
  if (!Number.isFinite(quantity) || quantity < 0) return null
  if (quantity === 0) return 0
  const item = orderItems.find((entry) => entry.id === line?.originalOrderItemId)
  if (!item) return null

  // Mixed-case component prices are per bottle; the parent price is for the whole assortment.
  if (line?.mixedCaseComponentId) {
    const component = item.components?.find((entry: any) => entry.id === line.mixedCaseComponentId)
    const price = component?.unitPrice == null ? NaN : Number(component.unitPrice)
    return Number.isFinite(price) && price >= 0 ? quantity * price : null
  }
  if (String(item.itemType || '').toUpperCase() === 'MIXED_CASE') return null

  const price = item.unitPrice == null ? NaN : Number(item.unitPrice)
  if (!Number.isFinite(price) || price < 0) return null
  const billingUnit = String(item.productUnit || item.product?.unit || '').toLowerCase()
  if (billingUnit.includes('bottle')) return quantity * price
  // Standard case/pack prices apply to a package, while stored replaced quantities are base units.
  const capacity = Number(line.quantityPerCase || line.qtyPerUnit || item.caseCapacity || item.quantityPerCase || item.product?.quantityPerCase || item.product?.quantityPerUnit)
  return Number.isFinite(capacity) && capacity > 0 ? quantity / capacity * price : null
}
