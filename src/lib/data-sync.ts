'use client'

import { clearApiResponseCache } from '@/lib/client-auth'

export type DataSyncScope =
  | 'inventory'
  | 'products'
  | 'stock-batches'
  | 'inventory-transactions'
  | 'warehouses'
  | 'orders'
  | 'trips'
  | 'replacements'
  | 'drivers'
  | 'vehicles'
  | 'stocks'
  | 'feedback'
  | 'customers'
  | 'auth'
  | 'user'

interface DataSyncMessage {
  scopes: DataSyncScope[]
  timestamp: number
}

const CHANNEL_NAME = 'logistics-data-sync'
const STORAGE_KEY = 'logistics-data-sync-event'
const WINDOW_EVENT_NAME = 'logistics-data-sync-event'

function normalizeScopes(scopes: DataSyncScope[]): DataSyncScope[] {
  return Array.from(new Set(scopes))
}

export function emitDataSync(scopes: DataSyncScope[]) {
  if (typeof window === 'undefined') return
  // Cross-module mutations invalidate cached reads before listeners refresh their data.
  clearApiResponseCache()
  const message: DataSyncMessage = {
    scopes: normalizeScopes(scopes),
    timestamp: Date.now(),
  }

  // Immediate same-tab delivery so UI updates without waiting on cross-context channels.
  window.dispatchEvent(new CustomEvent<DataSyncMessage>(WINDOW_EVENT_NAME, { detail: message }))

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage(message)
    channel.close()
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(message))
  } catch {
    // Ignore storage errors.
  }
}

export function subscribeDataSync(handler: (message: DataSyncMessage) => void) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  let channel: BroadcastChannel | null = null
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<DataSyncMessage>) => {
      if (!event.data?.scopes?.length) return
      clearApiResponseCache()
      handler(event.data)
    }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const message = JSON.parse(event.newValue) as DataSyncMessage
      if (!message?.scopes?.length) return
      clearApiResponseCache()
      handler(message)
    } catch {
      // Ignore malformed payloads.
    }
  }

  const onWindowEvent = (event: Event) => {
    const customEvent = event as CustomEvent<DataSyncMessage>
    const message = customEvent.detail
    if (!message?.scopes?.length) return
    clearApiResponseCache()
    handler(message)
  }

  window.addEventListener('storage', onStorage)
  window.addEventListener(WINDOW_EVENT_NAME, onWindowEvent as EventListener)

  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(WINDOW_EVENT_NAME, onWindowEvent as EventListener)
    if (channel) {
      channel.close()
    }
  }
}
