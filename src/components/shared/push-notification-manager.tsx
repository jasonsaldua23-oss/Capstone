'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Loader2, X } from 'lucide-react'

import type { AuthUser, PortalType } from '@/types'
import { enableNotifications, resumeNotificationsIfAllowed } from '@/lib/native/notifications'
import { isNativeApp } from '@/lib/native/platform'


type PushConfig = {
  enabled?: boolean
  publicKey?: string
}

function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const decoded = window.atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

// Added: describe notifications in the context of the portal currently being used.
const portalPromptCopy: Record<PortalType, { title: string; description: string }> = {
  admin: {
    title: 'Stay updated on operations',
    description: 'Receive order, delivery and inventory alerts on this device, even when the admin portal is closed.',
  },
  warehouse: {
    title: 'Stay updated on warehouse activity',
    description: 'Receive order, stock and dispatch updates on this device, even when the warehouse portal is closed.',
  },
  driver: {
    title: 'Stay updated on your trips',
    description: 'Receive trip assignments and delivery updates on this device, even when the driver portal is closed.',
  },
  customer: {
    title: 'Stay updated on your orders',
    description: 'Receive updates about your orders and deliveries on this device, even when the customer portal is closed.',
  },
}

export function PushNotificationManager({ user, portal }: { user: AuthUser; portal: PortalType }) {
  const promptCopy = portalPromptCopy[portal]
  const [publicKey, setPublicKey] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const [isEnabling, setIsEnabling] = useState(false)
  const [error, setError] = useState('')

  const registerSubscription = useCallback(async (vapidPublicKey: string) => {
    await navigator.serviceWorker.register('/push-sw.js')
    // Fix: registration can resolve while the worker is still installing; PushManager
    // requires the active registration exposed by serviceWorker.ready.
    const activeRegistration = await navigator.serviceWorker.ready
    let subscription = await activeRegistration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await activeRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeApplicationServerKey(vapidPublicKey),
      })
    }

    const response = await fetch('/api/push-subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    })
    if (!response.ok) throw new Error('The device subscription could not be saved.')
  }, [])

  useEffect(() => {
    let cancelled = false

    // Inside the Driver and Customer apps the OS owns the permission and the token,
    // so registration goes through the native bridge rather than the service worker.
    // The check is on the runtime, not on the bridge: the shells load the portal
    // over the network, so the bridge can arrive after this effect runs, and the
    // calls below wait for it. Deciding on the bridge alone left the apps in the
    // web branch, where the Android web view has no Notification API and nothing
    // was ever offered.
    if (isNativeApp()) {
      void (async () => {
        const resumed = await resumeNotificationsIfAllowed()
        if (!resumed.registered && !cancelled && sessionStorage.getItem('push-prompt-dismissed') !== '1') {
          setShowPrompt(true)
        }
      })()
      return () => {
        cancelled = true
      }
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return
    }

    async function preparePush() {
      try {
        const response = await fetch('/api/push-subscriptions', { cache: 'no-store' })
        if (!response.ok) return
        const config = await response.json() as PushConfig
        if (!config.enabled || !config.publicKey || cancelled) return
        setPublicKey(config.publicKey)

        if (Notification.permission === 'granted') {
          await registerSubscription(config.publicKey)
          return
        }
        // Permission must be requested from a click, so all portals share this one prompt.
        if (Notification.permission === 'default' && sessionStorage.getItem('push-prompt-dismissed') !== '1') {
          setShowPrompt(true)
        }
      } catch (pushError) {
        // Fix: background push registration is best-effort; avoid promoting a
        // caught failure into Next.js's blocking development error overlay.
        console.warn('Push notification setup failed:', pushError)
      }
    }

    void preparePush()
    return () => {
      cancelled = true
    }
  }, [registerSubscription, user.id, user.type])

  const enablePush = async () => {
    setIsEnabling(true)
    setError('')
    try {
      if (isNativeApp()) {
        const result = await enableNotifications()
        if (!result.registered) {
          setError(result.message || 'Notifications could not be turned on. Tap Turn On Notifications to try again.')
          return
        }
        setShowPrompt(false)
        return
      }

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setShowPrompt(false)
        return
      }
      await registerSubscription(publicKey)
      setShowPrompt(false)
    } catch (pushError) {
      // The prompt already reports this recoverable failure to the user inline.
      console.warn('Push notification enable failed:', pushError)
      setError('Notifications could not be turned on. Tap Turn On Notifications to try again.')
    } finally {
      setIsEnabling(false)
    }
  }

  const dismissPrompt = () => {
    sessionStorage.setItem('push-prompt-dismissed', '1')
    setShowPrompt(false)
  }

  if (!showPrompt) return null

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="push-prompt-title"
      // Changed: anchor to the right edge and clear mobile bottom navigation and safe areas.
      className="fixed right-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] md:right-6 md:bottom-6 z-[140] w-[calc(100%-2rem)] max-w-[26rem] rounded-xl border border-[#DDE3EA] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_20px_40px_-20px_rgba(16,24,40,0.32)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#EAF2FC]">
          <Bell className="h-5 w-5 text-[#0B3B82]" />
        </span>
        <div className="min-w-0 flex-1">
          <p id="push-prompt-title" className="text-[15px] font-semibold leading-6 text-[#2A2A2A]">
            {promptCopy.title}
          </p>
          <p className="mt-1 text-[13px] leading-[18px] text-[#5A6472]">
            {promptCopy.description}
          </p>
        </div>
        <button
          type="button"
          onClick={dismissPrompt}
          aria-label="Close"
          className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#98A2B3] transition-colors hover:bg-[#F2F4F7] hover:text-[#2A2A2A]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-[#F3C6C2] bg-[#FDF3F2] px-3 py-2 text-[13px] leading-[18px] text-[#B42318]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={dismissPrompt}
          disabled={isEnabling}
          className="h-10 rounded-lg border border-[#DDE3EA] bg-white text-[13px] font-semibold text-[#2A2A2A] transition-colors hover:bg-[#F7F9FC] disabled:opacity-60 motion-reduce:transition-none"
        >
          Not Now
        </button>
        <button
          type="button"
          disabled={isEnabling}
          onClick={enablePush}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-[#0B3B82] px-2 text-[12px] font-semibold text-white transition-colors hover:bg-[#093068] disabled:opacity-60 motion-reduce:transition-none"
        >
          {isEnabling ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : null}
          {isEnabling ? 'Turning On' : 'Turn On Notifications'}
        </button>
      </div>
    </div>
  )
}
