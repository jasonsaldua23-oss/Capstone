/**
 * Which driver GPS fixes are worth drawing.
 *
 * The Android tracking service listens to the network provider as well as GPS so
 * that Wi-Fi and cell positions can fill the gaps when GPS drops out. Between GPS
 * fixes, though, those positions are not news: each lands 15-40 m from the vehicle
 * and carries no Doppler speed. Interleaved with GPS once a second, they walked a
 * parked van's icon tens of metres up and down the road, and a moving one back
 * and forth along it.
 */

export type GpsFixQuality = {
  accuracy?: number | null
  speed?: number | null
  recordedAt?: number | null
}

/** How long a GPS fix keeps a coarser, speedless one from being drawn. After this a
 * network position is the best there is, and freezing the vehicle would be worse. */
export const COARSE_FIX_HOLD_MS = 10_000

const hasReading = (value: number | null | undefined) =>
  value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0

/**
 * A fix that is both less accurate than the last one and missing the speed that
 * one carried, arriving while GPS is still reporting. GPS fixes always carry
 * Doppler speed, so a GPS fix degrading in a street canyon is never dropped here,
 * and a phone that never reports speed is not filtered at all.
 */
export function isCoarseFixAmidGps(next: GpsFixQuality, previous: GpsFixQuality | null): boolean {
  if (!previous || hasReading(next.speed) || !hasReading(previous.speed)) return false
  const nextAccuracy = Number(next.accuracy)
  const previousAccuracy = Number(previous.accuracy)
  if (!Number.isFinite(nextAccuracy) || !Number.isFinite(previousAccuracy)) return false
  const sinceGpsMs = Number(next.recordedAt) - Number(previous.recordedAt)
  if (!Number.isFinite(sinceGpsMs) || sinceGpsMs < 0 || sinceGpsMs >= COARSE_FIX_HOLD_MS) return false
  return nextAccuracy > previousAccuracy
}
