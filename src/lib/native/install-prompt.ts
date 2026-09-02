/**
 * The "Install App" offer, shown once per login session.
 *
 * Chromium fires `beforeinstallprompt` when a site meets the install criteria; the
 * event has to be captured and replayed later from a user gesture. iOS Safari has no
 * such event and installs only through Share -> Add to Home Screen, so there the
 * portal shows instructions instead. Inside the Capacitor shells, or when the portal
 * is already running as an installed app, nothing is offered at all.
 */

import { useCallback, useEffect, useState } from 'react'

import { isIosBrowser, isNativeApp, isStandalonePwa } from './platform'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// One offer per login: the key is cleared on logout, and sessionStorage already
// scopes it to this tab so a second tab does not re-ask either.
const SESSION_KEY = 'install-prompt-shown'

let deferredPrompt: BeforeInstallPromptEvent | null = null
let listenerAttached = false

function captureInstallEvent(): void {
  if (listenerAttached || typeof window === 'undefined') return
  listenerAttached = true
  window.addEventListener('beforeinstallprompt', (event) => {
    // Chrome shows its own mini-infobar unless the event is taken over.
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    try {
      window.sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      // A blocked storage API only means the offer may appear again next login.
    }
  })
}

// Capture as early as the module loads: the event fires once, often before any
// component that cares has mounted.
captureInstallEvent()

function alreadyOfferedThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function markOffered(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    // Ignore: the worst case is one extra offer on the next login.
  }
}

/**
 * Registering a service worker is one of the conditions a browser checks before it
 * offers an install, and the portal's worker was only registered when push
 * notifications were switched on. Registering here keeps installability from
 * depending on whether someone accepted notifications.
 */
function ensureServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  if (!window.isSecureContext) return
  void navigator.serviceWorker.getRegistration().then((existing) => {
    if (existing) return
    return navigator.serviceWorker.register('/push-sw.js').then(() => undefined)
  }).catch(() => {
    // Installability is a nice-to-have; the portal works without a worker.
  })
}

/**
 * Throws away an offer captured under a different manifest.
 *
 * `beforeinstallprompt` fires during page load, against whichever manifest the
 * document was served with. The portal shell then swaps that manifest for its own,
 * so replaying the captured event would offer to install the wrong portal's app.
 * Dropping it leaves the hook waiting for the fresh event the browser raises once
 * it has re-read the new manifest.
 */
export function discardCapturedInstallPrompt(): void {
  deferredPrompt = null
}

/** Clears the once-per-session marker. Called when a session ends. */
export function resetInstallPromptForNewSession(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing to clear.
  }
}

/**
 * How an install attempt ended.
 *
 * `dismissed` is the person declining the browser's own dialog, which is a normal
 * answer and closes the offer. The last two are failures the person can act on, so
 * the card stays up and says what happened instead of vanishing.
 */
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable' | 'failed'

export type InstallPromptState = {
  /** The offer should be on screen right now. */
  isOpen: boolean
  /** iOS cannot install programmatically; show the Share-sheet instructions. */
  isIosInstructions: boolean
  install: () => Promise<InstallOutcome>
  dismiss: () => void
}

export function useInstallPrompt(options: { enabled: boolean }): InstallPromptState {
  const { enabled } = options
  const [isOpen, setIsOpen] = useState(false)
  const [isIosInstructions, setIsIosInstructions] = useState(false)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    // Already an app, or running inside one: there is nothing to install.
    if (isNativeApp() || isStandalonePwa()) return
    ensureServiceWorker()
    if (alreadyOfferedThisSession()) return

    let cancelled = false

    const offer = (iosStyle: boolean) => {
      if (cancelled) return
      setIsIosInstructions(iosStyle)
      setIsOpen(true)
      markOffered()
    }

    if (isIosBrowser()) {
      // Safari has no install event, so the instructions are offered directly.
      const timer = window.setTimeout(() => offer(true), 1200)
      return () => {
        cancelled = true
        window.clearTimeout(timer)
      }
    }

    if (deferredPrompt) {
      const timer = window.setTimeout(() => offer(false), 1200)
      return () => {
        cancelled = true
        window.clearTimeout(timer)
      }
    }

    // The event may still be on its way; wait for it rather than deciding now.
    const onAvailable = (event: Event) => {
      event.preventDefault()
      deferredPrompt = event as BeforeInstallPromptEvent
      offer(false)
    }
    window.addEventListener('beforeinstallprompt', onAvailable)
    return () => {
      cancelled = true
      window.removeEventListener('beforeinstallprompt', onAvailable)
    }
  }, [enabled])

  const install = useCallback(async (): Promise<InstallOutcome> => {
    const prompt = deferredPrompt
    if (!prompt) return 'unavailable'
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      deferredPrompt = null
      // Both answers are the person's own, so the offer has served its purpose.
      setIsOpen(false)
      return choice.outcome === 'accepted' ? 'accepted' : 'dismissed'
    } catch {
      // A prompt that cannot be shown leaves the portal working as it was; the
      // card stays open so the failure can be reported where it was triggered.
      deferredPrompt = null
      return 'failed'
    }
  }, [])

  const dismiss = useCallback(() => {
    setIsOpen(false)
  }, [])

  return { isOpen, isIosInstructions, install, dismiss }
}
