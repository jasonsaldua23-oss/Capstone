
/**
 * Location helpers for the trip detail screen: coordinate parsing, fix freshness, and age labels.
 */

export const toRecordedAtMs = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
  }
  const parsed = new Date(String(value)).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

// Normalizes unknown inputs to valid numeric coordinates or null.
export const toCoordinate = (value: unknown) => {
  // Fix: Number(null) and Number('') are zero, but missing GPS fields are not
  // real zero values and must not influence route matching or speed display.
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// Shared "done" status predicate for rendering stop progress and route segments.
export const isDropPointDone = (status: unknown) => {
  const normalized = String(status || '').toUpperCase()
  return normalized === 'COMPLETED' || normalized === 'DELIVERED'
}

export const MAX_REAL_CURRENT_LOCATION_AGE_MS = 2 * 60 * 1000

export const isValidDeviceCoordinate = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180

export const isFreshRecordedAt = (value: unknown, maxAgeMs: number) => {
  const ts = toRecordedAtMs(value)
  if (ts === null) return false
  return Date.now() - ts <= maxAgeMs
}

export const formatLocationAge = (ageMs: number) => {
  const minutes = Math.round(ageMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

// Best-effort live location refresh for recenter button.
export const getFreshDriverLocation = () =>
  new Promise<{ lat: number; lng: number } | null>((resolve) => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude)
        const lng = Number(position.coords.longitude)
        const acc = Number(position.coords.accuracy)
        // Reject inaccurate cell-tower fixes (> 150 m) for the recenter action.
        if (Number.isFinite(lat) && Number.isFinite(lng) && (!Number.isFinite(acc) || acc <= 150)) {
          resolve({ lat, lng })
          return
        }
        resolve(null)
      },
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 7000 }
    )
  })
