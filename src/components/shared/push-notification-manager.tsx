'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Loader2, X } from 'lucide-react'

import type { AuthUser } from '@/types'


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
    // Changed: center the permission prompt within the viewport.
    <div className="fixed left-1/2 top-1/2 z-[140] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-blue-200 bg-white p-4 shadow-2xl">
      <button
        type="button"
        onClick={dismissPrompt}
        className="absolute right-3 top-3 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Not now"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex gap-3 pr-7">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-100 text-blue-700">
          <Bell className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">Enable device notifications</p>
          <p className="mt-1 text-sm text-slate-600">Get order and trip updates even when this portal is closed.</p>
          {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
          <button
            type="button"
            disabled={isEnabling}
            onClick={enablePush}
            className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isEnabling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enable notifications
          </button>
        </div>
      </div>
    </div>
  )
}
