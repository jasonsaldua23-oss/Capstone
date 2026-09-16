/**
 * The decisions the cross-device sync poller makes, separated from the fetching
 * and event dispatch in `sync-hub.ts`.
 *
 * Keeping these pure is what makes "when do we ask the server again, and what do
 * we tell the portals changed" reviewable and directly testable - the rules have
 * more edge cases (first read, outage, backgrounded tab, recovery) than the I/O
 * around them.
 */

export type StampMap = Record<string, number>

// Fast enough to read as immediate, slow enough that a single indexed row read
// stays negligible next to the collection fetches it replaces.
export const ACTIVE_POLL_MS = 1_500
// A hidden tab cannot show anything; it resyncs in full the moment it is shown.
export const HIDDEN_POLL_MS = 30_000
export const MIN_BACKOFF_MS = 3_000
export const MAX_BACKOFF_MS = 60_000
export const REQUEST_TIMEOUT_MS = 10_000

/**
 * How long to wait before the next stamp read.
 *
 * A failing or unreachable server is backed off rather than hammered, but never
 * so far that a recovered connection takes minutes to be noticed.
 */
export function nextPollDelayMs(options: { failures: number; visible: boolean }): number {
  if (options.failures > 0) {
    return Math.min(MIN_BACKOFF_MS * 2 ** (options.failures - 1), MAX_BACKOFF_MS)
  }
  return options.visible ? ACTIVE_POLL_MS : HIDDEN_POLL_MS
}

/**
 * The scopes to refresh given the previously seen revisions and the current ones.
 *
 * `previous === null` means this is the session's first read: it establishes the
 * baseline and refreshes nothing, because emitting here would make every portal
 * re-fetch everything one tick after it already loaded. A scope that moved by
 * several revisions while the device was offline still yields one refresh, not
 * one per missed write.
 */
export function scopesToRefresh(previous: StampMap | null, next: StampMap): string[] {
  if (previous === null) return []
  const changed: string[] = []
  for (const scope of Object.keys(next)) {
    if (previous[scope] !== next[scope]) changed.push(scope)
  }
  return changed
}

/** Validate a stamp payload before it is allowed to become the new baseline. */
export function readStampMap(body: unknown): StampMap | null {
  const stamps = (body as { stamps?: unknown } | null)?.stamps
  if (!stamps || typeof stamps !== 'object' || Array.isArray(stamps)) return null
  const parsed: StampMap = {}
  for (const [scope, revision] of Object.entries(stamps as Record<string, unknown>)) {
    // A malformed revision must not overwrite a good baseline with NaN, which
    // would then differ from everything and refresh on every single poll.
    if (typeof revision !== 'number' || !Number.isFinite(revision)) return null
    parsed[scope] = revision
  }
  return parsed
}
