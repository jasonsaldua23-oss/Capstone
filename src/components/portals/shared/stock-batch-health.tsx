import { Badge } from '@/components/ui/badge'
import {
  CRITICAL_MAX_DAYS_LEFT,
  EXPIRING_SOON_MAX_DAYS_LEFT,
  STOCK_BATCH_HEALTH_LABELS,
  formatStockBatchDaysLeft,
  type StockBatchHealth,
} from '@/lib/stock-batch-health'

// Severity climbs green, amber, orange, red, so Critical never reads as Expired.
const BADGE_CLASSES: Record<StockBatchHealth, string> = {
  HEALTHY: 'bg-green-100 text-green-800 hover:bg-green-100',
  EXPIRING_SOON: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  CRITICAL: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
  EXPIRED: 'bg-red-100 text-red-800 hover:bg-red-100',
}

export const STOCK_BATCH_DAYS_LEFT_CLASSES: Record<StockBatchHealth, string> = {
  HEALTHY: 'text-green-600',
  EXPIRING_SOON: 'text-amber-600',
  CRITICAL: 'text-orange-600',
  EXPIRED: 'text-red-600',
}

export function StockBatchHealthBadge({ health }: { health: StockBatchHealth }) {
  return <Badge className={BADGE_CLASSES[health]}>{STOCK_BATCH_HEALTH_LABELS[health]}</Badge>
}

/** The Days Left cell: "Expired", "Today", "1 day", "12 days", or N/A without an expiry date. */
export function stockBatchDaysLeftText(health: StockBatchHealth, daysLeft: number | null) {
  if (health === 'EXPIRED') return 'Expired'
  return daysLeft === null ? 'N/A' : formatStockBatchDaysLeft(daysLeft)
}

export type StockBatchHealthFilter = 'all' | StockBatchHealth

export function StockBatchHealthFilterSelect({
  value,
  onChange,
  className = '',
}: {
  value: StockBatchHealthFilter
  onChange: (value: StockBatchHealthFilter) => void
  className?: string
}) {
  return (
    <select
      aria-label="Filter batches by status"
      className={`h-10 rounded-md border border-input bg-background px-3 text-sm ${className}`.trim()}
      value={value}
      onChange={(event) => onChange(event.target.value as StockBatchHealthFilter)}
    >
      <option value="all">All statuses</option>
      <option value="HEALTHY">{STOCK_BATCH_HEALTH_LABELS.HEALTHY}</option>
      <option value="EXPIRING_SOON">
        {`${STOCK_BATCH_HEALTH_LABELS.EXPIRING_SOON} (${CRITICAL_MAX_DAYS_LEFT + 1}–${EXPIRING_SOON_MAX_DAYS_LEFT} days)`}
      </option>
      <option value="CRITICAL">{`${STOCK_BATCH_HEALTH_LABELS.CRITICAL} (0–${CRITICAL_MAX_DAYS_LEFT} days)`}</option>
      <option value="EXPIRED">{`${STOCK_BATCH_HEALTH_LABELS.EXPIRED} - awaiting action`}</option>
    </select>
  )
}
