'use client'

/**
 * The install offer shown once per login in the Driver and Customer portals.
 *
 * It offers the native Capacitor APK, rather than the browser's PWA shortcut. It
 * leaves the page beneath it usable, and a tap anywhere else dismisses it.
 *
 * Nothing renders when the portal is already installed, already running in the app
 * shell, or when the browser cannot install at all.
 */

import { useEffect, useRef, useState } from 'react'
import { useInstallPrompt } from '@/lib/native/install-prompt'

type InstallAppPromptProps = {
  portal: 'driver' | 'customer'
  enabled?: boolean
}

const portalCopy = {
  driver: {
    appName: 'AAB Driver',
    icon: '/aab-trading-driver.png',
    downloadUrl: '/downloads/aab-driver.apk',
  },
  customer: {
    appName: 'AAB SHOP',
    icon: '/aab-trading-shop.png',
    downloadUrl: '/downloads/aab-shop.apk',
  },
} as const

export function InstallAppPrompt({ portal, enabled = true }: InstallAppPromptProps) {
  const copy = portalCopy[portal]
  const { isOpen, isIosInstructions, install, dismiss } = useInstallPrompt({
    enabled,
    portal,
    nativeDownloadUrl: copy.downloadUrl,
  })
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [error, setError] = useState('')
  // Keep the origin visible so the user knows this is the trusted native APK source.
  const [host] = useState(() => (typeof window === 'undefined' ? '' : window.location.host))

  // The browser's banner closes as soon as you touch the page behind it. The
  // listener is passive, so that first tap still reaches whatever it landed on.
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (cardRef.current?.contains(event.target as Node)) return
      // Fix: interacting with the independent Welcome popup must never dismiss
      // the install offer through this document-level outside-click handler.
      if ((event.target as Element | null)?.closest?.('[data-welcome-popup]')) return
      dismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, { passive: true })
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen, dismiss])

  if (!isOpen) return null

  const startInstall = async () => {
    setIsInstalling(true)
    setError('')
    const outcome = await install()
    setIsInstalling(false)
    // The APK download hands installation to Android; only a failed download keeps the card up.
    if (outcome === 'unavailable') {
      setError('The native Android app is not available on this device.')
    } else if (outcome === 'failed') {
      setError('The install did not start. Tap Install to try again.')
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[1100] flex justify-center px-3 pt-3">
      <div
        ref={cardRef}
        role="dialog"
        aria-label={`Install ${copy.appName}`}
        className="pointer-events-auto w-full max-w-[32rem] rounded-xl border border-[#DDE3EA] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_20px_40px_-20px_rgba(16,24,40,0.32)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 motion-safe:duration-200"
      >
        <div className="flex items-center gap-3">
          {/* The logo is a ring around a white centre, so it needs a surface of its
              own to sit on; a neutral one keeps the card to a single accent. */}
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#DDE3EA] bg-[#F7F9FC]">
            <img src={copy.icon} alt="" className="h-7 w-7 object-contain" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-5 text-[#2A2A2A]">
              Install {copy.appName}
            </p>
            <p className="truncate text-[12px] leading-4 text-[#5A6472]">{host}</p>
          </div>
          <button
            type="button"
            onClick={isIosInstructions ? dismiss : () => void startInstall()}
            disabled={isInstalling}
            className="-mr-2 shrink-0 rounded-lg px-2 py-1.5 text-[14px] font-semibold text-[#0B3B82] transition-colors hover:bg-[#EAF2FC] disabled:opacity-60 motion-reduce:transition-none"
          >
            {isIosInstructions ? 'Close' : 'Install'}
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 border-t border-[#DDE3EA] pt-3 text-[12px] leading-4 text-[#B42318]">
            {error}
          </p>
        ) : null}

      </div>
    </div>
  )
}
