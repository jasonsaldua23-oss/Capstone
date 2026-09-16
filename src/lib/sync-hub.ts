'use client'

/**
 * Turns the server's change stamps into the refresh events the portals already
 * listen for, so a change made on one device reaches every other device.
 *
 * The existing bus in `data-sync.ts` is BroadcastChannel/localStorage based: it
 * is instant between tabs of one browser and silent between devices. Screens that
 * needed cross-device freshness each grew their own timer re-fetching a whole
 * collection every 2-4 seconds, and the screens nobody hand-tuned only updated
 * when the user happened to switch tabs.
 *
 * This hub replaces all of that with one cheap poll. `/api/sync/stamps` returns a
 * revision per scope; when a revision moves, the hub emits that scope on the same
 * bus, and every `subscribeDataSync` listener already wired into the four portals
 * refreshes itself. Screens keep their own refresh logic - they just stop having
 * to guess when to run it.
 *
 * The polling rules live in `sync-hub-policy.ts`; this module is the I/O around them.
 */

import { emitDataSync, type DataSyncScope } from '@/lib/data-sync'
import {
  nextPollDelayMs,
  readStampMap,
  scopesToRefresh,
  REQUEST_TIMEOUT_MS,
  type StampMap,
} from '@/lib/sync-hub-policy'

const STAMPS_ENDPOINT = '/api/sync/stamps'

let started = false
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight = false
let consecutiveFailures = 0
let lastStamps: StampMap | null = null
let disposers: Array<() => void> = []

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function schedule(delayMs = nextPollDelayMs({ failures: consecutiveFailures, visible: isVisible() })) {
  if (!started) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void poll()
  }, delayMs)
}

async function readStamps(): Promise<StampMap | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(STAMPS_ENDPOINT, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) return null
    return readStampMap(await response.json().catch(() => null))
  } catch {
    // An offline device or a dropped request is normal, not an error worth logging
    // on every tick. The backoff handles it and the next success resyncs in full.
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

async function poll() {
  if (!started || inFlight) return
  inFlight = true
  try {
    const stamps = await readStamps()
    if (!stamps) {
      consecutiveFailures += 1
      return
    }
    consecutiveFailures = 0

    const changed = scopesToRefresh(lastStamps, stamps)
    lastStamps = stamps
    if (changed.length > 0) {
      // Same bus the portals' own writes use, so every existing subscriber and
      // every other tab of this browser reacts without any new wiring.
      emitDataSync(changed as DataSyncScope[])
    }
  } finally {
    inFlight = false
    schedule()
  }
}

/** Poll now rather than waiting out the current interval. */
function pollNow() {
  if (!started) return
  schedule(0)
}

/**
 * Begin cross-device sync for the signed-in session. Idempotent: mounting a
 * second portal in the same tab reuses the running hub.
 */
export function startSyncHub(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (started) return stopSyncHub

  started = true
  consecutiveFailures = 0
  lastStamps = null

  const onVisibilityChange = () => {
    if (!isVisible()) {
      schedule()
      return
    }
    // A tab returning to the foreground may have missed many changes, so check at
    // once instead of after a hidden-length interval.
    pollNow()
  }
  const onFocus = () => pollNow()
  const onOnline = () => {
    consecutiveFailures = 0
    pollNow()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('focus', onFocus)
  window.addEventListener('online', onOnline)
  disposers = [
    () => document.removeEventListener('visibilitychange', onVisibilityChange),
    () => window.removeEventListener('focus', onFocus),
    () => window.removeEventListener('online', onOnline),
  ]

  schedule(0)
  return stopSyncHub
}

/** Stop polling and forget the baseline, so a new session starts clean. */
export function stopSyncHub() {
  started = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  for (const dispose of disposers) dispose()
  disposers = []
  lastStamps = null
  consecutiveFailures = 0
}
