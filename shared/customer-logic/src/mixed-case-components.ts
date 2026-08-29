// Keep mixed-case product details identical across customer, warehouse, admin, and driver views.
export function getMixedCaseComponentNameWithSize(component: any): string {
  const product = component?.product || {}
  const name = String(component?.productName || product?.name || 'Product').trim()
  const sizes = Array.isArray(product?.sizes)
    ? product.sizes.map((size: unknown) => String(size || '').trim()).filter(Boolean).join(' ')
    : ''
  const size = String(component?.sizeLabel || product?.sizeLabel || product?.size || sizes || '').trim()
  const cleanName = name.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  const cleanSize = size.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  return cleanSize && !cleanName.toLowerCase().includes(cleanSize.toLowerCase())
    ? `${cleanName} ${cleanSize}`
    : cleanName
}

export function getMixedCaseBottleQuantity(component: any): string {
  const perCase = Math.max(0, Number(component?.quantityPerCase ?? component?.quantityBaseUnits ?? component?.quantity ?? 0))
  const caseCount = Math.max(0, Number(component?.caseCount || 0))
  const total = Math.max(0, Number(component?.totalBaseUnits ?? perCase * caseCount))
  const perCaseLabel = `${perCase} ${perCase === 1 ? 'Bottle' : 'Bottles'}`
  return caseCount > 1 ? `${perCaseLabel}/case - ${total} total` : perCaseLabel
}
