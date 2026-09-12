'use client'

/**
 * Holds the Driver and Shop apps to their own portal for the whole app, including
 * the login routes that live outside the portal shell in page.tsx.
 *
 * It renders nothing; the work is the navigation lock it installs on mount.
 */

import { useEffect } from 'react'

// Fix: load the one-shot PWA install event listener on login pages as well as the
// authenticated portal, so an eligible Driver event is not lost before login.
import '@/lib/native/install-prompt'
import { installPortalLock } from '@/lib/native/portal-lock'
import { isNativeApp, waitForNativeBridge } from '@/lib/native/platform'
import { handleNativeBack, hasNativeBackHandlers } from '@/hooks/use-native-back'

export function NativePortalGuard() {
  useEffect(() => installPortalLock(), [])
  useEffect(() => {
    if (!isNativeApp()) return
    let disposed = false
    let remove: (() => Promise<void>) | undefined
    // Fix: state-based portal navigation is invisible to Android's WebView history.
    void (async () => {
      if (!await waitForNativeBridge() || disposed) return
      const { App } = await import('@capacitor/app')
      const listener = await App.addListener('backButton', ({ canGoBack }) => {
        if (handleNativeBack()) return
        // At the portal root, background the app rather than returning to its login.
        if (hasNativeBackHandlers()) { void App.minimizeApp(); return }
        if (canGoBack) window.history.back()
        else void App.minimizeApp()
      })
      if (disposed) await listener.remove()
      else remove = () => listener.remove()
    })().catch(error => console.warn('Could not attach phone Back navigation:', error))
    return () => { disposed = true; void remove?.() }
  }, [])
  return null
}
