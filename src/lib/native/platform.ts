/**
 * Where the portal is running, and how to reach the device from there.
 *
 * The same build serves four runtimes - a browser tab, an installed PWA, and the
 * Android and iOS Capacitor shells - so every device feature has to ask this module
 * which set of APIs it may use. Detection is deliberately defensive: `Capacitor` is
 * injected by the native bridge and is simply absent on the web.
 */

import { parseNativePortalFromUserAgent, type ScopedPortal } from '@/lib/portal-scope'

export type RuntimePlatform = 'web' | 'pwa' | 'android' | 'ios'

type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  isPluginAvailable?: (name: string) => boolean
}

function capacitor(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null
  return ((window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor) || null
}

/**
 * The apps load the deployed portal over the network rather than a bundled copy, so
 * this page can be reached both from a browser and from inside the shell. The
 * Capacitor bridge is the primary signal; the user-agent token stamped by
 * `appendUserAgent` in capacitor.config.ts is the fallback, so a page whose bridge
 * script has not run yet is still recognised as the app and is never offered an
 * install it cannot perform.
 */
const NATIVE_USER_AGENT_TOKEN = 'AABTradingApp'

function hasNativeUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = String(navigator.userAgent || '')
  return ua.includes(NATIVE_USER_AGENT_TOKEN) || /\bCapacitor\b/i.test(ua)
}

/**
 * The portal this shell was built for, or null anywhere else.
 *
 * Every shell loads the same origin, so the portal cannot be read from the URL;
 * capacitor.config.ts stamps it into the user agent instead. Taking it from the
 * user agent rather than the bridge means it is known on the very first paint,
 * before any plugin has registered.
 */
export function getNativePortal(): ScopedPortal | null {
  if (typeof navigator === 'undefined') return null
  if (!isNativeApp()) return null
  return parseNativePortalFromUserAgent(navigator.userAgent)
}

/** True inside the Android or iOS Capacitor shell. */
export function isNativeApp(): boolean {
  const cap = capacitor()
  if (!cap) return hasNativeUserAgent()
  if (typeof cap.isNativePlatform === 'function') return Boolean(cap.isNativePlatform())
  const platform = String(cap.getPlatform?.() || '').toLowerCase()
  if (platform && platform !== 'web') return true
  return hasNativeUserAgent()
}

/**
 * Waits for the native bridge to appear, then reports whether it did.
 *
 * The shells load the deployed portal over the network, so the page can be parsed
 * and running before Capacitor has injected `window.Capacitor` into it. Code that
 * asks `isPluginAvailable` too early - device notifications, most of all - would
 * otherwise conclude it is an ordinary browser tab and fall back to web APIs the
 * Android web view does not have. Anywhere that is not a shell this resolves
 * immediately.
 */
export function waitForNativeBridge(timeoutMs = 3000): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (capacitor()) return Promise.resolve(true)
  if (!isNativeApp()) return Promise.resolve(false)

  return new Promise((resolve) => {
    const startedAt = Date.now()
    const poll = window.setInterval(() => {
      if (capacitor()) {
        window.clearInterval(poll)
        resolve(true)
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(poll)
        resolve(false)
      }
    }, 100)
  })
}

/** True when the browser is running the portal as an installed app window. */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  const displayModes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']
  const matchesDisplayMode = displayModes.some(
    (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches
  )
  // iOS Safari predates the display-mode media query and reports this instead.
  const iosStandalone = Boolean((window.navigator as unknown as { standalone?: boolean }).standalone)
  return matchesDisplayMode || iosStandalone
}

export function getPlatform(): RuntimePlatform {
  const cap = capacitor()
  if (isNativeApp()) {
    const name = String(cap?.getPlatform?.() || '').toLowerCase()
    if (name === 'ios' || name === 'android') return name
    // Without the bridge, fall back to what the user agent says.
    return isIosBrowser() || /iPhone|iPad|iPod/i.test(String(navigator?.userAgent || '')) ? 'ios' : 'android'
  }
  if (isStandalonePwa()) return 'pwa'
  return 'web'
}

export function isIosBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isIosDevice = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  const isIpadOs = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1
  return (isIosDevice || isIpadOs) && !isNativeApp()
}

/** A Capacitor plugin is only callable when the native bridge registered it. */
export function isPluginAvailable(name: string): boolean {
  const cap = capacitor()
  if (!cap || !isNativeApp()) return false
  if (typeof cap.isPluginAvailable === 'function') return cap.isPluginAvailable(name)
  return true
}

/**
 * Browser device APIs (camera, geolocation, service workers) require a secure
 * context. The native shell is trusted, and localhost counts as secure.
 */
export function isSecureContextForDeviceApis(): boolean {
  if (typeof window === 'undefined') return false
  if (isNativeApp()) return true
  if (window.isSecureContext) return true
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1'
}

/** Opens the OS settings page for the app so a blocked permission can be granted. */
export async function openAppSettings(): Promise<boolean> {
  if (typeof window === 'undefined' || !isNativeApp()) return false
  try {
    const { App } = await import('@capacitor/app')
    const openable = App as unknown as { openAppSettings?: () => Promise<void> }
    if (typeof openable.openAppSettings === 'function') {
      await openable.openAppSettings()
      return true
    }
  } catch {
    // Fall through to the platform-specific attempt below.
  }

  try {
    if (getPlatform() === 'android') {
      window.location.href = 'intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;end'
      return true
    }
    window.location.href = 'app-settings:'
    return true
  } catch {
    return false
  }
}
