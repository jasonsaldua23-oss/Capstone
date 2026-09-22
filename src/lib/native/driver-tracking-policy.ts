/**
 * When the Driver app's foreground service needs to be handed a new session.
 *
 * Restarting the service resets its upload backoff and retries at once. Doing
 * that on every "connection is refreshing" status - with the same credentials
 * the service already holds - turned the intended 2s→30s backoff into a request
 * every ~2.5s and a flickering error toast. Only a changed session is worth a
 * restart; an unchanged one waits out the backoff the service already applies.
 */

export type TrackingConfig = { driverId: string; token: string; tripId: string }

export function trackingCredentialsChanged(previous: TrackingConfig | null, next: TrackingConfig): boolean {
  if (!previous) return true
  return previous.driverId !== next.driverId || previous.token !== next.token || previous.tripId !== next.tripId
}
