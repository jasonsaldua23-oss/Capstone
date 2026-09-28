/**
 * When the driver app tracks the phone's position.
 *
 * Opening a trip that had not started yet used to start live tracking straight
 * away, "so current location is visible without extra taps". The van then moved
 * with the phone on the trip map, and the phone's position was uploaded, before the
 * trip had begun - while the phone's notification says location is shared only
 * while a trip is active. A trip is tracked from the moment it starts until none is
 * underway: Start Trip opens the session itself, just before it asks the server to
 * start the trip.
 */

const UNDERWAY_STATUSES = new Set(['IN_PROGRESS', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'])

/** How long a session opened by Start Trip is kept while the trip still reads as not started. */
export const START_TRIP_TRACKING_GRACE_MS = 120_000

export function isTripUnderway(status: unknown): boolean {
  return UNDERWAY_STATUSES.has(String(status || '').toUpperCase())
}

export type TrackingAction = 'ensure-running' | 'leave' | 'stop'

export function tripTrackingAction({
  trips,
  selectedTripId,
  running,
  explicitStartAtMs,
  nowMs,
}: {
  trips: Array<{ id?: string | null; status?: unknown }>
  selectedTripId: string | null
  running: boolean
  /** When Start Trip last opened a tracking session (0 when it has not). */
  explicitStartAtMs: number
  nowMs: number
}): TrackingAction {
  if (trips.some((trip) => isTripUnderway(trip?.status))) return 'ensure-running'
  if (!running) return 'leave'
  // Start Trip opens the session before the server has marked the trip started,
  // so for a moment the open trip still reads as planned. That session must not
  // be torn down under it.
  const selected = trips.find((trip) => String(trip?.id || '') === String(selectedTripId || ''))
  const starting = String(selected?.status || '').toUpperCase() === 'PLANNED' &&
    nowMs - explicitStartAtMs < START_TRIP_TRACKING_GRACE_MS
  return starting ? 'leave' : 'stop'
}
