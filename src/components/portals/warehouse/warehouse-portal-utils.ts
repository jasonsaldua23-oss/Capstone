// Pure warehouse portal helpers are isolated from React state so they can be reused
// and checked independently without mounting the full portal shell.
export function formatFullName(
  firstName?: string | null,
  middleName?: string | null,
  lastName?: string | null,
  suffix?: string | null,
  fallback?: string
): string {
  const first = (firstName || '').trim()
  const middle = (middleName || '').trim()
  const last = (lastName || '').trim()
  const suf = (suffix || '').trim()

  const parts: string[] = []
  if (first) parts.push(first)
  if (middle) {
    const cleanM = middle.replace(/\.+$/, '')
    if (cleanM) parts.push(`${cleanM.charAt(0).toUpperCase()}.`)
  }
  if (last) parts.push(last)

  let result = parts.join(' ')
  if (suf) result = result ? `${result} ${suf}` : suf
  return result || fallback || ''
}

export function getCollection<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[]
  }
  if (Array.isArray(record.data)) return record.data as T[]
  return []
}

export function formatDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getDefaultRouteDate() {
  const now = new Date()
  now.setDate(now.getDate() + 1)
  return formatDayKey(now)
}

export function getLocalTodayDate() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function getLocalTodayDayKey() {
  return formatDayKey(getLocalTodayDate())
}

export function parseDayKey(value: string) {
  const [yearText, monthText, dayText] = String(value || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(year, month - 1, day)
}

export function normalizeToDayKey(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const base = raw.includes('T') ? raw.slice(0, 10) : raw
  const parsed = parseDayKey(base)
  return parsed ? formatDayKey(parsed) : ''
}

export function isBeforeTodayDayKey(value: string | null | undefined) {
  const dayKey = normalizeToDayKey(value)
  if (!dayKey) return false
  const parsed = parseDayKey(dayKey)
  return parsed ? parsed < getLocalTodayDate() : false
}

export function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

export function normalizeTripStatus(status: string | null | undefined) {
  const value = String(status || '').toUpperCase()
  if (value === 'IN_TRANSIT' || value === 'OUT_FOR_DELIVERY') return 'IN_PROGRESS'
  return value
}

export function isActiveTripStatus(status: string | null | undefined) {
  const normalized = normalizeTripStatus(status)
  return normalized === 'PLANNED' || normalized === 'IN_PROGRESS'
}

export function getStockHealthDotClass(name: string) {
  const key = name.toLowerCase()
  if (key === 'healthy') return 'bg-emerald-500'
  if (key === 'low') return 'bg-amber-500'
  if (key === 'critical') return 'bg-red-500'
  if (key === 'overstocked') return 'bg-blue-500'
  return 'bg-gray-400'
}

export function getLocalDateInputValue() {
  // Date inputs use local calendar dates; offset first to avoid a UTC day shift.
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
