'use client'

import { formatDiscountLabel, formatDiscountPercent } from '@shared/customer-logic/discount'

type CompactDiscountLineProps = {
  value: string
  percent?: number
  className?: string
}

// Wording moved to shared/customer-logic so the Expo customer app renders it identically.
export { formatDiscountPercent }

export function CompactDiscountLine({ value, percent, className = '' }: CompactDiscountLineProps) {
  return (
    <p className={`text-sm font-medium text-slate-700 ${className}`.trim()}>
      {formatDiscountLabel(value, percent)}
    </p>
  )
}
