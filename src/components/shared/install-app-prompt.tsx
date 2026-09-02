'use client'

/**
 * The install offer shown once per login in the Driver and Customer portals.
 *
 * It is shaped like the browser's own install banner - a card under the address bar
 * carrying the app icon, "Install <app>", the site it comes from, and a single
 * action - because people recognise that card and know what it does. It leaves the
 * page beneath it usable, and a tap anywhere else dismisses it.
 *
 * Nothing renders when the portal is already installed, already running in the app
 * shell, or when the browser cannot install at all.
 */

import { useEffect, useRef, useState } from 'react'
import { Share, SquarePlus } from 'lucide-react'

import { useInstallPrompt } from '@/lib/native/install-prompt'
import { cn } from '@/lib/utils'

type InstallAppPromptProps = {
  portal: 'driver' | 'customer'
  enabled?: boolean
}

const portalCopy = {
  driver: {
    appName: 'AAB Trading Driver',
    icon: '/aab-trading-driver.png',
  },
  customer: {
    appName: 'AAB Trading Shop',
    icon: '/aab-trading-shop.png',
  },
} as const

export function InstallAppPrompt({ portal, enabled = true }: InstallAppPromptProps) {
  const { isOpen, isIosInstructions, install, dismiss } = useInstallPrompt({ enabled, portal })
  const copy = portalCopy[portal]
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [error, setError] = useState('')
  // The card names the site it installs from, exactly as the browser's banner does.
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
    // Accepting or declining the browser's dialog both close the offer; only a
    // failure keeps the card up, and then it has to say what to do about it.
    if (outcome === 'unavailable') {
      setError('This browser cannot install the app. Open the portal in Chrome or Edge to install it.')
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

        {isIosInstructions ? (
          <ol className="mt-3 space-y-2 border-t border-[#DDE3EA] pt-3 text-[13px] leading-[18px] text-[#5A6472]">
            <li className="flex items-center gap-2">
              <Share className="h-4 w-4 shrink-0" />
              Tap the Share button in Safari.
            </li>
            <li className="flex items-center gap-2">
              <SquarePlus className="h-4 w-4 shrink-0" />
              Choose &ldquo;Add to Home Screen&rdquo;.
            </li>
          </ol>
        ) : null}
      </div>
    </div>
  )
}
