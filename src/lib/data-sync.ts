'use client'

export type DataSyncScope =
  | 'inventory'
  | 'products'
  | 'stock-batches'
  | 'warehouses'
  | 'orders'
  | 'trips'
  | 'returns'
  | 'drivers'
  | 'vehicles'

interface DataSyncMessage {
  scopes: DataSyncScope[]
  timestamp: number
}

const CHANNEL_NAME = 'logistics-data-sync'
const STORAGE_KEY = 'logistics-data-sync-event'

function normalizeScopes(scopes: DataSyncScope[]): DataSyncScope[] {
  return Array.from(new Set(scopes))
}

export function emitDataSync(scopes: DataSyncScope[]) {
  if (typeof window === 'undefined') return
  const message: DataSyncMessage = {
    scopes: normalizeScopes(scopes),
    timestamp: Date.now(),
  }

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
      handler(event.data)
    }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const message = JSON.parse(event.newValue) as DataSyncMessage
      if (!message?.scopes?.length) return
      handler(message)
    } catch {
      // Ignore malformed payloads.
    }
  }

  window.addEventListener('storage', onStorage)

  return () => {
    window.removeEventListener('storage', onStorage)
    if (channel) {
      channel.close()
    }
  }
}
