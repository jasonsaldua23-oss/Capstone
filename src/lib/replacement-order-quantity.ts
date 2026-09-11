import { getLooseUnitFromRecord } from './beverage-category-specs'

// Scheduled order quantities can be rounded up; the saved request count is the actual replacement quantity.
export function replacementOrderQuantity(item: any): string {
  const notes = String(item?.notes || '')
  const requested = notes.match(/ReplacementRequestedBottles=(\d+)/i)
  const requestedCount = requested ? Number(requested[1]) : 0
  const unit = String(item?.productUnit || item?.product?.unit || '').trim().toLowerCase()
  const packageUnit = unit.includes('bundle') ? 'bundle' : unit.includes('pack') ? 'pack'
    : unit.includes('case') ? 'case' : unit || 'unit'
  const countLabel = (count: number, label: string) => `${count} ${label}${count === 1 || label.endsWith('s') ? '' : 's'}`
  // Old items may lack a category; the saved field identifies bottles but not their material.
  const hasPackaging = item?.containerTypeName || item?.looseUnit || item?.productCategory || item?.product?.category || item?.product?.containerTypeName || item?.product?.looseUnit
  const looseUnit = hasPackaging ? getLooseUnitFromRecord(item).toLowerCase() : 'bottle'
  if (requestedCount > 0) {
    if (/ReplacementUnitMode=BOTTLE/i.test(notes) || !['case', 'pack', 'bundle'].includes(packageUnit)) {
      return countLabel(requestedCount, looseUnit)
    }
    const perPackage = Number(item?.quantityPerCase || item?.product?.quantityPerCase || item?.product?.quantityPerUnit || 0)
    if (perPackage > 0) {
      const packages = Math.floor(requestedCount / perPackage)
      const loose = requestedCount % perPackage
      return [packages > 0 ? countLabel(packages, packageUnit) : '', loose > 0 ? countLabel(loose, looseUnit) : ''].filter(Boolean).join(', ')
    }
    // Without a verified package size, report the exact loose count instead of guessing packages.
    return countLabel(requestedCount, looseUnit)
  }
  return countLabel(Number(item?.quantity || 0), item?.itemType === 'MIXED_CASE' ? 'mixed case' : packageUnit)
}
