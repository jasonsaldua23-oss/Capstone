'use client'

type TripLoadSummaryProps = {
  totalCases: number
  totalWeight: number
  maximumCapacity: number
  compact?: boolean
}

const formatKilograms = (value: number) =>
  `${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 }).format(value)} kg`

export function TripLoadSummary({
  totalCases,
  totalWeight,
  maximumCapacity,
  compact = false,
}: TripLoadSummaryProps) {
  const safeCases = Math.max(0, Number(totalCases) || 0)
  const safeWeight = Math.max(0, Number(totalWeight) || 0)
  const safeCapacity = Math.max(0, Number(maximumCapacity) || 0)
  const remainingWeight = safeCapacity - safeWeight
  const overloadWeight = Math.max(0, -remainingWeight)

  return (
    <div className={`rounded-xl border p-3 ${overloadWeight > 0 ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Vehicle Load</p>
      {/* Added: all four load values share the backend's kilogram/case inputs. */}
      <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
        <div><p className="text-[10px] text-slate-500">Total Cases</p><p className="text-sm font-bold text-slate-900">{safeCases}</p></div>
        <div><p className="text-[10px] text-slate-500">Total Weight</p><p className="text-sm font-bold text-slate-900">{formatKilograms(safeWeight)}</p></div>
        <div><p className="text-[10px] text-slate-500">Truck Maximum Capacity</p><p className="text-sm font-bold text-slate-900">{formatKilograms(safeCapacity)}</p></div>
        <div><p className="text-[10px] text-slate-500">Weight Remaining</p><p className={`text-sm font-bold ${overloadWeight > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatKilograms(remainingWeight)}</p></div>
      </div>
      {overloadWeight > 0 ? (
        <p role="alert" className="mt-2 rounded-lg bg-red-100 px-2 py-1.5 text-xs font-semibold text-red-800">
          Vehicle overloaded by {formatKilograms(overloadWeight)}. Remove deliveries or choose a vehicle with a higher capacity.
        </p>
      ) : null}
    </div>
  )
}

export type SelectedOrderSummaryRow = {
  id: string
  orderNumber: string
  customerName?: string | null
  city?: string | null
  cases: number
  weight: number
  /** YYYY-MM-DD calendar day. */
  deliveryDate?: string | null
}

type SelectedOrdersSummaryProps = {
  orders: SelectedOrderSummaryRow[]
  /** Pass the same totals given to TripLoadSummary so both panels always agree. */
  totalCases: number
  totalWeight: number
  maximumCapacity: number
  compact?: boolean
  emptyMessage?: string
  className?: string
}

const formatDeliveryDay = (value?: string | null) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  if (!match) return value ? String(value) : '—'
  // Parse as a local calendar day; new Date('YYYY-MM-DD') would be UTC midnight.
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(day)
}

// Wide rows line up as columns; below @xl the same cells re-flow into a two-line card.
const WIDE_ROW_COLUMNS = '@xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_7rem_4rem_5.5rem]'

/**
 * Added: the orders a trip will carry, listed before it is created, with the
 * vehicle's capacity and what is left of it.
 */
export function SelectedOrdersSummary({
  orders,
  totalCases,
  totalWeight,
  maximumCapacity,
  compact = false,
  emptyMessage = 'No orders selected yet.',
  className = '',
}: SelectedOrdersSummaryProps) {
  const safeCases = Math.max(0, Number(totalCases) || 0)
  const safeWeight = Math.max(0, Number(totalWeight) || 0)
  const safeCapacity = Math.max(0, Number(maximumCapacity) || 0)
  const hasCapacity = safeCapacity > 0
  const remainingWeight = safeCapacity - safeWeight
  const overloadWeight = hasCapacity ? Math.max(0, -remainingWeight) : 0

  return (
    <section
      aria-label="Selected orders"
      className={`@container min-w-0 rounded-xl border bg-white ${compact ? 'p-2.5' : 'p-4 shadow-sm'} ${overloadWeight > 0 ? 'border-red-300' : 'border-slate-200'} ${className}`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className={compact ? 'text-xs font-semibold uppercase tracking-wide text-slate-600' : 'text-base font-semibold text-slate-900'}>
          Selected Orders
        </p>
        <p className="shrink-0 text-[11px] font-medium tabular-nums text-slate-500">
          {orders.length} {orders.length === 1 ? 'order' : 'orders'}
        </p>
      </div>
      {orders.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-2 py-3 text-center text-xs text-slate-500">{emptyMessage}</p>
      ) : (
        // The list scrolls inside its own box so a long selection never grows the dialog.
        <div className={`overflow-y-auto overscroll-contain rounded-lg border border-slate-100 ${compact ? 'max-h-44' : 'max-h-64'}`}>
          <div className={`sticky top-0 z-[1] hidden gap-x-3 border-b border-slate-100 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 @xl:grid ${WIDE_ROW_COLUMNS}`}>
            <span>Order</span>
            <span>Customer / City</span>
            <span>Delivery</span>
            <span className="text-right">Cases</span>
            <span className="text-right">Weight</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {orders.map((order) => {
              const safeOrderCases = Math.max(0, Number(order.cases) || 0)
              const location = [order.customerName, order.city].map((part) => String(part || '').trim()).filter(Boolean).join(' · ')
              return (
                <li key={order.id} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-2 py-1.5 text-xs @xl:items-center ${WIDE_ROW_COLUMNS}`}>
                  <span className="col-start-1 row-start-1 truncate font-semibold text-slate-900" title={order.orderNumber}>{order.orderNumber}</span>
                  <span className="col-start-1 row-start-2 truncate text-slate-600 @xl:col-start-2 @xl:row-start-1" title={location}>{location || '—'}</span>
                  <span className="col-start-1 row-start-3 text-[11px] text-slate-500 @xl:col-start-3 @xl:row-start-1 @xl:text-xs">
                    <span className="@xl:hidden">Delivery </span>{formatDeliveryDay(order.deliveryDate)}
                  </span>
                  <span className="col-start-2 row-start-1 text-right font-semibold tabular-nums text-slate-900 @xl:col-start-4">
                    {safeOrderCases}<span className="font-normal text-slate-500 @xl:hidden"> {safeOrderCases === 1 ? 'case' : 'cases'}</span>
                  </span>
                  <span className="col-start-2 row-start-2 text-right tabular-nums text-slate-600 @xl:col-start-5 @xl:row-start-1">
                    {formatKilograms(Math.max(0, Number(order.weight) || 0))}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <dl className="mt-2 grid grid-cols-3 gap-2 @lg:grid-cols-5">
        <div><dt className="text-[10px] text-slate-500">Orders</dt><dd className="text-sm font-bold tabular-nums text-slate-900">{orders.length}</dd></div>
        <div><dt className="text-[10px] text-slate-500">Total Cases</dt><dd className="text-sm font-bold tabular-nums text-slate-900">{safeCases}</dd></div>
        <div><dt className="text-[10px] text-slate-500">Total Weight</dt><dd className="text-sm font-bold tabular-nums text-slate-900">{formatKilograms(safeWeight)}</dd></div>
        <div>
          <dt className="text-[10px] text-slate-500">Truck Capacity</dt>
          <dd className={`text-sm font-bold tabular-nums ${hasCapacity ? 'text-slate-900' : 'text-slate-400'}`}>{hasCapacity ? formatKilograms(safeCapacity) : 'Not set'}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-slate-500">Weight Remaining</dt>
          <dd className={`text-sm font-bold tabular-nums ${!hasCapacity ? 'text-slate-400' : overloadWeight > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
            {hasCapacity ? formatKilograms(remainingWeight) : '—'}
          </dd>
        </div>
      </dl>
      {overloadWeight > 0 ? (
        <p className="mt-2 text-xs font-semibold text-red-700">Over capacity by {formatKilograms(overloadWeight)}.</p>
      ) : null}
    </section>
  )
}
