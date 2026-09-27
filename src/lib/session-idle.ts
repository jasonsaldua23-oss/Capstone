/**
 * Idle logout for web sessions without "Keep me logged in".
 *
 * The server owns the clock: every tab reports its user's activity to
 * /api/auth/activity, and a tab whose own user has gone quiet asks the server
 * before logging out. A session in use in another tab therefore stays alive,
 * and a tab reopened after the limit finds the session already ended.
 */

export const SESSION_ACTIVITY_URL = '/api/auth/activity'
// Activity is reported at most this often per tab; the limit itself is 5+ minutes.
export const ACTIVITY_REPORT_INTERVAL_MS = 60_000
// While the server cannot be reached, ask again this often.
export const IDLE_STATUS_RETRY_MS = 60_000

export type SessionIdleStatus =
  | { kind: 'expired' }
  /** The token predates the server rule, so the tab's own timer decides. */
  | { kind: 'unlimited' }
  | { kind: 'active'; remainingMs: number }
  | { kind: 'unknown' }

export function parseSessionIdleStatus(httpStatus: number, body: unknown): SessionIdleStatus {
  if (httpStatus === 401) return { kind: 'expired' }
  if (httpStatus < 200 || httpStatus >= 300 || !body || typeof body !== 'object') return { kind: 'unknown' }
  const data = body as { idleLogout?: unknown; remainingSeconds?: unknown }
  if (data.idleLogout !== true) return { kind: 'unlimited' }
  const remainingSeconds = Number(data.remainingSeconds)
  if (!Number.isFinite(remainingSeconds)) return { kind: 'unknown' }
  return { kind: 'active', remainingMs: Math.max(0, remainingSeconds) * 1000 }
}

export type IdleCheckOutcome = { action: 'logout' } | { action: 'recheck'; delayMs: number }

/** What a tab does once its own user has been quiet for the whole limit. */
export function idleCheckOutcome(status: SessionIdleStatus): IdleCheckOutcome {
  switch (status.kind) {
    case 'expired':
    case 'unlimited':
      return { action: 'logout' }
    case 'active':
      // Someone is still working in another tab; wait until the shared limit, just past it.
      return { action: 'recheck', delayMs: status.remainingMs + 1000 }
    default:
      // Offline or a server error: the server rejects the session anyway once it is idle.
      return { action: 'recheck', delayMs: IDLE_STATUS_RETRY_MS }
  }
}
