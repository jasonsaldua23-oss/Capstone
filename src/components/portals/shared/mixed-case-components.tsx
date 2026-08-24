import { Package } from 'lucide-react'

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

export function MixedCaseComponents({
  item,
  showImages = true,
  compact = false,
}: {
  item: any
  showImages?: boolean
  compact?: boolean
}) {
  const components = Array.isArray(item?.components) ? item.components : []
  if (components.length === 0) return <p className="text-xs text-slate-500">No mixed-case products available.</p>

  return (
    <div className={compact ? 'mt-1 space-y-1' : 'mt-2 space-y-1.5'}>
      {components.map((component: any, index: number) => {
        const imageUrl = String(component?.product?.imageUrl || component?.imageUrl || '').trim()
        return (
          <div key={component?.id || component?.productId || index} className="flex items-center gap-2">
            {showImages ? (
              <div className={`${compact ? 'h-7 w-7' : 'h-9 w-9'} grid shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50`}>
                {imageUrl ? (
                  <img src={imageUrl} alt={component?.productName || 'Mixed-case product'} className="h-full w-full object-cover" />
                ) : (
                  <Package className="h-4 w-4 text-slate-400" />
                )}
              </div>
            ) : null}
            <div className="min-w-0">
              <p className={`${compact ? 'text-[11px]' : 'text-xs'} break-words font-medium text-slate-800`}>
                {getMixedCaseComponentNameWithSize(component)}
              </p>
              <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-500`}>
                {getMixedCaseBottleQuantity(component)}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
