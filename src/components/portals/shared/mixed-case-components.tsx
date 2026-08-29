import { Package } from 'lucide-react'

// The two label helpers moved to shared/customer-logic so the Expo customer app
// renders mixed-case contents with identical wording.
export {
  getMixedCaseComponentNameWithSize,
  getMixedCaseBottleQuantity,
} from '@shared/customer-logic/mixed-case-components'

import {
  getMixedCaseComponentNameWithSize,
  getMixedCaseBottleQuantity,
} from '@shared/customer-logic/mixed-case-components'

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
