/**
 * The road a trip has actually taken, as the tracking maps hold it.
 *
 * The server keeps a point every several metres of a trip under way (TripPathPoint)
 * and sends the whole road with each trip refresh. Trips are refreshed only when they
 * change, though, while the van moves on; so each position refresh (every few
 * seconds) also carries the last few minutes of road, which is merged on here.
 * A later trip refresh takes over the road it covers and keeps what came after it.
 */

type LatLng = [number, number]

export type TripPath = {
  /** The road as of the last trip refresh. */
  base: LatLng[]
  baseEndsAtMs: number
  /** Timed points merged on from position refreshes since. */
  extra: Array<{ point: LatLng; atMs: number }>
}

export type TripPaths = Record<string, TripPath>

function latLng(value: unknown): LatLng | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const lat = Number(value[0])
  const lng = Number(value[1])
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null
}

function timed(value: unknown): { point: LatLng; atMs: number } | null {
  const point = latLng(value)
  const atMs = Array.isArray(value) ? Number(value[2]) : NaN
  return point && Number.isFinite(atMs) ? { point, atMs } : null
}

function endOf(path: TripPath): number {
  return path.extra.length > 0 ? path.extra[path.extra.length - 1].atMs : path.baseEndsAtMs
}

/** Replace each trip's road with the server's, keeping any newer points already merged on. */
export function tripPathsFromTrips(trips: unknown[], previous: TripPaths): TripPaths {
  const next: TripPaths = {}
  for (const trip of trips as Array<{ id?: unknown; pathPoints?: unknown; pathEndsAt?: unknown }>) {
    const id = String(trip?.id || '')
    if (!id) continue
    const base = (Array.isArray(trip.pathPoints) ? trip.pathPoints : []).map(latLng).filter((point): point is LatLng => point !== null)
    const baseEndsAtMs = trip.pathEndsAt ? Date.parse(String(trip.pathEndsAt)) : NaN
    const known = previous[id]
    if (base.length === 0 || !Number.isFinite(baseEndsAtMs)) {
      if (known) next[id] = known
      continue
    }
    next[id] = { base, baseEndsAtMs, extra: (known?.extra ?? []).filter((entry) => entry.atMs > baseEndsAtMs) }
  }
  return next
}

/** Merge the recent road that came with a position refresh onto each trip's road. */
export function mergeTripPathTails(previous: TripPaths, driverLocations: unknown[]): TripPaths {
  let next = previous
  for (const location of driverLocations as Array<{ tripId?: unknown; pathTail?: unknown }>) {
    const id = String(location?.tripId || '')
    if (!id || !Array.isArray(location.pathTail)) continue
    const known = next[id] ?? { base: [], baseEndsAtMs: -Infinity, extra: [] }
    const after = endOf(known)
    const fresh = location.pathTail.map(timed).filter((entry): entry is { point: LatLng; atMs: number } => entry !== null && entry.atMs > after)
    if (fresh.length === 0) continue
    if (next === previous) next = { ...previous }
    next[id] = { ...known, extra: [...known.extra, ...fresh] }
  }
  return next
}

export function tripPathPoints(path: TripPath | undefined): LatLng[] {
  if (!path) return []
  return [...path.base, ...path.extra.map((entry) => entry.point)]
}
