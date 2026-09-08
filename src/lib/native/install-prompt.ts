/**
 * Native APK offer for Driver and Customer portals.
 *
 * A browser cannot install a Capacitor package through `beforeinstallprompt`;
 * that API installs a PWA shortcut. The portal therefore exposes the packaged
 * Android APK directly so Android's package installer owns the installation.
 */

import { useCallback, useEffect, useState } from 'react'

import { isIosBrowser, isNativeApp, isStandalonePwa } from './platform'
import type { ManifestPortal } from '../portal-manifest'

const SESSION_KEY_PREFIX = 'native-install-prompt-shown:'

function sessionKey(portal: ManifestPortal) {
  return `${SESSION_KEY_PREFIX}${portal}`
}

function alreadyOffered(portal: ManifestPortal) {
  try {
    return window.sessionStorage.getItem(sessionKey(portal)) === '1'
  } catch {
    return false
  }
}

function markOffered(portal: ManifestPortal) {
  try {
    window.sessionStorage.setItem(sessionKey(portal), '1')
  } catch {
    // Storage is optional; the native download still works.
  }
}

/** Kept as a no-op for the browser-branding call site; PWA prompts are disabled. */
export function retainCapturedInstallPromptForPortal(_portal: ManifestPortal): void {}

export function resetInstallPromptForNewSession(portal: ManifestPortal): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(sessionKey(portal))
  } catch {
    // Nothing to clear.
  }
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable' | 'failed'

export type InstallPromptState = {
  isOpen: boolean
  /** Kept for the shared component contract; native APKs have no iOS install flow. */
  isIosInstructions: boolean
  install: () => Promise<InstallOutcome>
  dismiss: () => void
}

export function useInstallPrompt(options: {
  enabled: boolean
  portal: ManifestPortal
  nativeDownloadUrl: string
}): InstallPromptState {
  const { enabled, portal, nativeDownloadUrl } = options
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || isNativeApp() || isStandalonePwa()) return
    if (alreadyOffered(portal)) return

    const timer = window.setTimeout(() => {
      setIsOpen(true)
      markOffered(portal)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [enabled, portal])

  const install = useCallback(async (): Promise<InstallOutcome> => {
    if (isIosBrowser()) return 'unavailable'
    try {
      // Android opens its package installer after the APK download completes.
      window.location.assign(nativeDownloadUrl)
      setIsOpen(false)
      return 'accepted'
    } catch {
      return 'failed'
    }
  }, [nativeDownloadUrl])

  return {
    isOpen,
    isIosInstructions: false,
    install,
    dismiss: () => setIsOpen(false),
  }
}
