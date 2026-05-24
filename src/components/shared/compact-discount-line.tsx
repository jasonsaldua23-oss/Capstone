'use client'

type CompactDiscountLineProps = {
  value: string
  percent?: number
  className?: string
}

const formatDiscountPercent = (percent: number) => {
  const normalized = Number(percent)
  if (!Number.isFinite(normalized) || normalized <= 0) return ''
  return Number.isInteger(normalized) ? `${normalized}%` : `${normalized.toFixed(2).replace(/\.?0+$/, '')}%`
}

export function CompactDiscountLine({ value, percent, className = '' }: CompactDiscountLineProps) {
  const percentLabel = formatDiscountPercent(Number(percent || 0))
  return (
    <p className={`text-sm font-medium text-slate-700 ${className}`.trim()}>
      Discount: {value}{percentLabel ? ` (${percentLabel})` : ''}
    </p>
  )
}

