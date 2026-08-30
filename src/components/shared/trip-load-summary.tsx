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

