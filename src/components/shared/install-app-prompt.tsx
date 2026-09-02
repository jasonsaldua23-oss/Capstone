'use client'

/**
 * The install offer shown once per login in the Driver and Customer portals.
 *
 * It sits at the bottom of the screen rather than over the page: an active delivery
 * or a checkout must stay reachable, and dismissing is always one tap away. Nothing
 * renders when the portal is already installed, already running in the app shell, or
 * when the browser cannot install at all.
 */

import { Download, Share, SquarePlus, X } from 'lucide-react'

import { useInstallPrompt } from '@/lib/native/install-prompt'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type InstallAppPromptProps = {
  portal: 'driver' | 'customer'
  enabled?: boolean
}

const portalCopy = {
  driver: {
    title: 'Install the Driver app',
    description: 'Add it to your home screen for faster access to your trips, camera and live location.',
    accent: 'bg-[#16984e] hover:bg-[#107e41]',
    tint: 'bg-[#e8f5ee] text-[#16984e]',
  },
  customer: {
    title: 'Install the Shop app',
    description: 'Add it to your home screen to order faster and get delivery updates.',
    accent: 'bg-[#3ca232] hover:bg-[#34922c]',
    tint: 'bg-[#edf6ea] text-[#3ca232]',
  },
} as const

export function InstallAppPrompt({ portal, enabled = true }: InstallAppPromptProps) {
  const { isOpen, isIosInstructions, install, dismiss } = useInstallPrompt({ enabled })
  const copy = portalCopy[portal]

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-label={copy.title}
      className="fixed inset-x-0 bottom-0 z-[110] flex justify-center px-3 pb-3 sm:px-4 sm:pb-4"
    >
      <div className="w-full max-w-[30rem] rounded-2xl border border-[#dde3ea] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_16px_32px_-16px_rgba(16,24,40,0.28)]">
        <div className="flex items-start gap-3">
          <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', copy.tint)}>
            <Download className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#2A2A2A]">{copy.title}</p>
            <p className="mt-1 text-[13px] leading-5 text-[#5A6472]">{copy.description}</p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#98A2B3] transition-colors hover:bg-[#F2F4F7] hover:text-[#2A2A2A]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isIosInstructions ? (
          <>
            <ol className="mt-4 space-y-2 rounded-xl bg-[#F7F9FC] p-3 text-[13px] leading-5 text-[#2A2A2A]">
              <li className="flex items-center gap-2">
                <Share className="h-4 w-4 shrink-0 text-[#5A6472]" />
                Tap the Share button in Safari.
              </li>
              <li className="flex items-center gap-2">
                <SquarePlus className="h-4 w-4 shrink-0 text-[#5A6472]" />
                Choose &ldquo;Add to Home Screen&rdquo;.
              </li>
            </ol>
            <Button
              type="button"
              onClick={dismiss}
              className={cn('mt-4 h-11 w-full rounded-xl text-sm font-semibold text-white', copy.accent)}
            >
              Got it
            </Button>
          </>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={dismiss}
              className="h-11 rounded-xl border-[#D7DDE5] bg-white text-sm font-semibold text-[#2A2A2A] hover:bg-[#F7F9FC]"
            >
              Not Now
            </Button>
            <Button
              type="button"
              onClick={() => void install()}
              className={cn('h-11 rounded-xl text-sm font-semibold text-white', copy.accent)}
            >
              Install App
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
