/**
 * The "arriving in / km away" line on the customer's tracking page, worded once for
 * the web portal and the Expo app. Both numbers come from the server, measured from
 * the driver's latest position, so the line falls as the van closes in and rises if
 * it heads away.
 */

/** Closer than this the driver is at the door, whatever the minutes say. */
export const DRIVER_ALMOST_THERE_METERS = 100

function formatDistanceAway(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} hr ${rest} min` : `${hours} hr`
}

export function formatDeliveryEta(
  etaMinutes: number | null | undefined,
  distanceMeters: number | null | undefined
): string | null {
  if (typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters) || distanceMeters < 0) return null
  if (distanceMeters <= DRIVER_ALMOST_THERE_METERS) return 'Your driver is almost there'
  const away = `${formatDistanceAway(distanceMeters)} away`
  if (typeof etaMinutes !== 'number' || !Number.isFinite(etaMinutes) || etaMinutes <= 0) return away
  return `Arriving in about ${formatMinutes(Math.round(etaMinutes))} · ${away}`
}
