'use client'

type CompactDiscountLineProps = {
  value: string
  className?: string
}

export function CompactDiscountLine({ value, className = '' }: CompactDiscountLineProps) {
  return (
    <p className={`text-sm font-medium text-slate-700 ${className}`.trim()}>
      Discount: {value}
    </p>
  )
}

