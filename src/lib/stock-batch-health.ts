/**
 * Expiry health of a stock batch, shared by the admin and warehouse Stocks tabs.
 *
 * The backend stores a date-only expiry as the very end of that local day and
 * treats the batch as expired once that moment passes. Days left used to be the
 * remaining hours rounded up, so a batch expiring later today read "1 days".
 * Days are now counted between calendar dates: 0 on the expiry date itself.
 */

export type StockBatchHealth = 'HEALTHY' | 'EXPIRING_SOON' | 'CRITICAL' | 'EXPIRED'

/** 0-14 days left. */
export const CRITICAL_MAX_DAYS_LEFT = 14
/** 15-30 days left. */
export const EXPIRING_SOON_MAX_DAYS_LEFT = 30

export const STOCK_BATCH_HEALTH_LABELS: Record<StockBatchHealth, string> = {
  HEALTHY: 'Healthy',
  EXPIRING_SOON: 'Expiring Soon',
  CRITICAL: 'Critical',
  EXPIRED: 'Expired',
}

const DAY_MS = 24 * 60 * 60 * 1000

// A local calendar date as a whole day count, immune to the hour and to DST shifts.
const localDayNumber = (date: Date) => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS)

const parseExpiry = (expiryDate: string | null | undefined) => {
  if (!expiryDate) return null
  const parsed = new Date(expiryDate)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Calendar days from today to the expiry date; null when the batch has none. */
export function stockBatchDaysLeft(expiryDate: string | null | undefined, now: Date = new Date()): number | null {
  const expiry = parseExpiry(expiryDate)
  return expiry ? localDayNumber(expiry) - localDayNumber(now) : null
}

/** Expired exactly when the backend stops selling it: once the expiry moment has passed. */
export function isStockBatchExpired(expiryDate: string | null | undefined, now: Date = new Date()): boolean {
  const expiry = parseExpiry(expiryDate)
  return expiry !== null && expiry.getTime() <= now.getTime()
}

export function stockBatchHealth(expiryDate: string | null | undefined, now: Date = new Date()): StockBatchHealth {
  if (isStockBatchExpired(expiryDate, now)) return 'EXPIRED'
  const daysLeft = stockBatchDaysLeft(expiryDate, now)
  // A batch without an expiry date never goes off.
  if (daysLeft === null) return 'HEALTHY'
  if (daysLeft <= CRITICAL_MAX_DAYS_LEFT) return 'CRITICAL'
  if (daysLeft <= EXPIRING_SOON_MAX_DAYS_LEFT) return 'EXPIRING_SOON'
  return 'HEALTHY'
}

/** "Today", "1 day", "12 days". */
export function formatStockBatchDaysLeft(daysLeft: number): string {
  if (daysLeft <= 0) return 'Today'
  return daysLeft === 1 ? '1 day' : `${daysLeft} days`
}
