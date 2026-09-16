'use client'

/**
 * Runs the cross-device sync hub for the whole authenticated shell.
 *
 * It renders nothing; the work is the change-stamp poll it keeps alive. Mounted
 * once per session rather than per screen, so every portal view gets cross-device
 * freshness from the listeners it already registers with `subscribeDataSync`.
 */

import { useEffect } from 'react'

import { startSyncHub } from '@/lib/sync-hub'

export function DataSyncBridge({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    // No session means no authorized stamp read, so there is nothing to poll for.
    if (!enabled) return
    return startSyncHub()
  }, [enabled])
  return null
}
