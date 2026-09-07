'use client'

/**
 * The empties charge-back on an order.
 *
 * A customer who declares empties at checkout pays less for the order. When the
 * driver counts fewer than were declared, the deposit for the difference is added
 * back on, so the amount the customer owes is no longer the order total. The charge
 * is therefore shown as its own line, immediately above a total that includes it,
 * rather than as a footnote underneath.
 */

export type EmptiesAdjustment = {
  amount?: number
  reason?: string
  recordedAt?: string | null
  lines?: Array<{ containerTypeId?: string; containerTypeName?: string; productNames?: string[]; quantityLabel?: string; shortQuantity?: number; amount?: number }>
}

export function getEmptiesAdjustment(order: any): EmptiesAdjustment | null {
  const adjustment = order?.emptiesAdjustment
  if (!adjustment || !(Number(adjustment.amount) > 0)) return null
  // Added: match declared empties to their order products, including mixed-case contents.
  const declaredProducts = (order.items || []).flatMap((item: any) => [
    ...(Number(item.emptyReturnedQuantity || 0) > 0 ? [item] : []),
    ...(item.components || []).filter((component: any) => Number(component.emptyCoveredQuantity || 0) > 0),
  ])
  return {
    ...adjustment,
    lines: (adjustment.lines || []).map((line: NonNullable<EmptiesAdjustment['lines']>[number]) => {
      const matchingProducts = declaredProducts
        .filter((item: any) => line.containerTypeId
          ? item.containerTypeId === line.containerTypeId
          : Boolean(line.containerTypeName) && item.containerTypeName === line.containerTypeName)
      // Added: include each product's stored size directly in the deposit explanation.
      const productNames = matchingProducts
        .map((item: any) => {
          const name = String(item.productName || item.product?.name || '').replace(/[()]/g, '').trim()
          const size = String(item.product?.size || item.product?.sizeLabel || item.product?.sizes?.join(', ') || '').replace(/[()]/g, '').trim()
          return size && name && !name.toLowerCase().includes(size.toLowerCase()) ? `${name} ${size}` : name
        })
        .filter(Boolean)
      // Shortfalls are stored as bottles; convert only when all matched products share a case size.
      const caseSizes = matchingProducts.map((item: any) =>
        String(item.productUnit || item.product?.unit || '').toLowerCase() === 'case'
          ? Number(item.containersPerCase || item.quantityPerCase || item.product?.quantityPerCase || 0)
          : 0
      )
      const caseSize = caseSizes[0] || 0
      const shortQuantity = Number(line.shortQuantity || 0)
      const useCases = caseSize > 0 && caseSizes.every((size: number) => size === caseSize) && shortQuantity % caseSize === 0
      const quantityLabel = useCases ? `${shortQuantity / caseSize} case` : `${shortQuantity} bottle`
      return { ...line, productNames: [...new Set<string>(productNames)], quantityLabel }
    }),
  }
}

/** The order total including any empties deposit charged back on delivery. */
export function getOrderTotalWithEmpties(order: any): number {
  const total = Number(order?.totalAmount || 0)
  const adjustment = getEmptiesAdjustment(order)
  return Number(order?.amountDue ?? total + Number(adjustment?.amount || 0))
}

/** "2 case 7Up 330ml declared but not returned" */
export function describeEmptiesShortfall(adjustment: EmptiesAdjustment | null): string {
  if (!adjustment) return ''
  const lines = (adjustment.lines || []).filter((line) => Number(line?.shortQuantity || 0) > 0)
  if (!lines.length) return 'Declared empties were not handed over on delivery'
  return lines
    // A container charge can cover several products; keep its shared quantity intact.
    .map((line) => `${line.quantityLabel || `${line.shortQuantity} bottle`} ${line.productNames?.length ? line.productNames.join(', ') : line.containerTypeName || 'container'}`)
    .join(', ')
    .concat(' declared but not returned')
}

function formatAmount(value: number): string {
  return `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** One row for a totals column, sitting directly above the total it changes. */
export function EmptiesChargeRow({ order, className = '' }: { order: any; className?: string }) {
  const adjustment = getEmptiesAdjustment(order)
  if (!adjustment) return null
  return (
    <div className={`flex items-start justify-between gap-3 text-[#7a5c15] ${className}`}>
      <span className="min-w-0">
        Empties deposit
        <span className="block text-[10px] leading-4 text-[#8a7135] md:text-[11px]">
          {describeEmptiesShortfall(adjustment)}
        </span>
      </span>
      <span className="shrink-0 font-semibold">+{formatAmount(Number(adjustment.amount || 0))}</span>
    </div>
  )
}

/** The same explanation for cards that have no totals column. */
export function EmptiesChargeNote({ order, className = '' }: { order: any; className?: string }) {
  const adjustment = getEmptiesAdjustment(order)
  if (!adjustment) return null
  const orderTotal = Number(order?.totalAmount || 0)
  return (
    <div className={`rounded-lg border border-[#e4d9b8] bg-[#fdf8ea] px-3 py-2 text-left ${className}`}>
      <p className="text-[12px] font-semibold text-[#7a5c15]">
        Empties deposit charged: +{formatAmount(Number(adjustment.amount || 0))}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-[#8a7135]">{describeEmptiesShortfall(adjustment)}</p>
      <p className="mt-1 text-[12px] font-bold text-[#7a5c15]">
        Total: {formatAmount(getOrderTotalWithEmpties(order))}
        <span className="ml-1 font-medium">(was {formatAmount(orderTotal)})</span>
      </p>
    </div>
  )
}
