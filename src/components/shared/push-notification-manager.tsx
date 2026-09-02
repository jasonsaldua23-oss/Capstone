'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Loader2, X } from 'lucide-react'

import type { AuthUser } from '@/types'
import { canUseNativePush } from '@/lib/native/notifications'
import { enableNotifications, resumeNotificationsIfAllowed } from '@/lib/native/notifications'


type PushConfig = {
  enabled?: boolean
  publicKey?: string
}

function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const decoded = window.atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

export function PushNotificationManager({ user }: { user: AuthUser }) {
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
    if (canUseNativePush()) {
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
      if (canUseNativePush()) {
        const result = await enableNotifications()
        if (!result.registered) {
          setError(result.message || 'Could not enable device notifications. Please try again.')
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
      setError('Could not enable device notifications. Please try again.')
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
      className="fixed left-1/2 top-1/2 z-[140] w-[calc(100%-2rem)] max-w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#DDE3EA] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_20px_40px_-20px_rgba(16,24,40,0.32)]"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#EAF2FC]">
          <Bell className="h-5 w-5 text-[#0B3B82]" />
        </span>
        <div className="min-w-0 flex-1">
          <p id="push-prompt-title" className="text-[15px] font-semibold leading-6 text-[#2A2A2A]">
            Enable device notifications
          </p>
          <p className="mt-1 text-[13px] leading-5 text-[#5A6472]">
            Receive order, delivery and trip updates on this device, even while the portal is closed.
          </p>
        </div>
        <button
          type="button"
          onClick={dismissPrompt}
          aria-label="Close"
          className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[#98A2B3] transition-colors hover:bg-[#F2F4F7] hover:text-[#2A2A2A]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-[#F3C6C2] bg-[#FDF3F2] px-3 py-2 text-[13px] leading-5 text-[#B42318]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={dismissPrompt}
          disabled={isEnabling}
          className="h-11 rounded-xl border border-[#D7DDE5] bg-white text-[13px] font-semibold text-[#2A2A2A] transition-colors hover:bg-[#F7F9FC] disabled:opacity-60 motion-reduce:transition-none"
        >
          Not Now
        </button>
        <button
          type="button"
          disabled={isEnabling}
          onClick={enablePush}
          className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#0B3B82] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[#093068] disabled:opacity-60 motion-reduce:transition-none"
        >
          {isEnabling ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
          {isEnabling ? 'Enabling' : 'Enable Notifications'}
        </button>
      </div>
    </div>
  )
}
