'use client'

import { useSyncExternalStore } from 'react'
import { isNativeApp } from '@/lib/native/platform'

let offline = false
const listeners = new Set<() => void>()

function publish(next: boolean) {
  if (offline === next) return
  offline = next
  listeners.forEach((listener) => listener())
}

let stopWatching: (() => void) | undefined

function subscribe(listener: () => void) {
  if (!isNativeApp()) return () => {}
  listeners.add(listener)
  if (listeners.size === 1) {
    let disposed = false
    let request: AbortController | undefined
    // Fix: Wi-Fi can remain connected without internet. Probe an existing static
    // asset without caching, API credentials, or replaying any user action.
    const check = async () => {
      if (!navigator.onLine) {
        request?.abort()
        publish(true)
        return
      }
      if (request || document.hidden) return
      const controller = new AbortController()
      request = controller
      const timeout = window.setTimeout(() => controller.abort(), 8000)
      try {
        await fetch('/ann-anns-logo.png', { method: 'HEAD', cache: 'no-store', signal: controller.signal })
        if (!disposed) publish(!navigator.onLine)
      } catch {
        if (!disposed) publish(true)
      } finally {
        window.clearTimeout(timeout)
        request = undefined
      }
    }
    const refresh = () => { void check() }
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    document.addEventListener('visibilitychange', refresh)
    const interval = window.setInterval(refresh, 30000)
    refresh()
    stopWatching = () => {
      disposed = true
      request?.abort()
      window.clearInterval(interval)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      stopWatching?.()
      stopWatching = undefined
    }
  }
}

// Share one connection watcher across the banner and permission prompts.
export function useNativeOffline() {
  return useSyncExternalStore(subscribe, () => isNativeApp() && (!navigator.onLine || offline), () => false)
}
