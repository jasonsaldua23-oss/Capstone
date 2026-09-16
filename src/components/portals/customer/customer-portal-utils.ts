// Pure portal utilities stay independent from CustomerPortal's UI and request state.
export function getLocalDateOnly() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function parseDateOnly(value: string) {
  const [yearText, monthText, dayText] = String(value || '').split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(year, month - 1, day)
}

export function createClientRequestId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export type ManualAddressParts = {
  house?: string
  street?: string
  subdivision?: string
  barangay?: string
  city?: string
  province?: string
  zip?: string
  country?: string
}

// A saved pin and manually typed address use the same canonical geocoding query.
export function buildManualAddressQuery(parts: ManualAddressParts) {
  return [
    parts.house,
    parts.street,
    parts.subdivision,
    parts.barangay,
    parts.city,
    parts.province,
    parts.zip,
    parts.country || 'Philippines',
  ]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ')
}
