// Fix: only an explicit collection can establish warehouse registration status.
// Malformed successful responses must never become an empty warehouse list.
export function parseWarehouseSetup(payload: unknown): any[] {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    if (record.success === false) throw new Error(String(record.error || 'Failed to load warehouse profile'))
    const rows = Array.isArray(record.warehouses) ? record.warehouses : record.data
    if (Array.isArray(rows)) return rows
  }
  if (Array.isArray(payload)) return payload
  throw new Error('Unable to verify warehouse registration. Please try again.')
}
