/**
 * Warehouses on the Live Tracking map. Every trip starts from one, so they are
 * drawn whether or not any trip is active. Kept free of Leaflet so it can be
 * unit tested.
 */
export type MapWarehouse = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
}

// A route's first point within this distance is the warehouse yard itself.
const WAREHOUSE_YARD_METERS = 50

function coordinate(value: unknown) {
  // Number(null) and Number('') are 0, a real place in the ocean.
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Rows from /api/warehouses that can be placed: located, active, each listed once. */
export function toMapWarehouses(rows: readonly any[] | null | undefined): MapWarehouse[] {
  const seen = new Set<string>()
  const warehouses: MapWarehouse[] = []
  for (const row of rows || []) {
    const id = String(row?.id || '').trim()
    const lat = coordinate(row?.latitude ?? row?.lat)
    const lng = coordinate(row?.longitude ?? row?.lng)
    if (!id || seen.has(id) || lat === null || lng === null || row?.isActive === false) continue
    seen.add(id)
    const address = [row?.address, row?.city, row?.province]
      .map((part) => String(part || '').trim())
      .filter((part, index, parts) => part && parts.indexOf(part) === index)
      .join(', ')
    warehouses.push({ id, name: String(row?.name || '').trim() || 'Warehouse', address, lat, lng })
  }
  return warehouses
}

/** Whether a point stands on one of the warehouses, e.g. where a trip's route begins. */
export function isAtWarehouse(point: [number, number] | null | undefined, warehouses: readonly MapWarehouse[]) {
  if (!point) return false
  return warehouses.some((warehouse) => {
    // Flat-earth distance is exact enough over a few dozen metres.
    const northMeters = (point[0] - warehouse.lat) * 110540
    const eastMeters = (point[1] - warehouse.lng) * 111320 * Math.cos((warehouse.lat * Math.PI) / 180)
    return Math.hypot(northMeters, eastMeters) <= WAREHOUSE_YARD_METERS
  })
}

/** Where the map should open when it has nothing else to show: the warehouse trips leave from. */
export function warehouseFocusPoint(otherMarkerCount: number, warehouses: readonly MapWarehouse[]): [number, number] | null {
  if (otherMarkerCount > 0 || warehouses.length === 0) return null
  return [warehouses[0].lat, warehouses[0].lng]
}
