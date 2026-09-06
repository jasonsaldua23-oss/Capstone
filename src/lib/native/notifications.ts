/**
 * Device notification registration for both runtimes.
 *
 * A browser subscribes with Web Push (VAPID) through the existing service worker;
 * the native shells register with the OS and hand back an FCM token. Both end up in
 * the same `/api/push-subscriptions` collection so the server can reach an account
 * without caring which kind of device answered.
 */

import { getPlatform, isNativeApp, isPluginAvailable, waitForNativeBridge } from './platform'
import { ensureNotificationPermission, type PermissionOutcome } from './permissions'

export type PushRegistration = {
  registered: boolean
  transport: 'web-push' | 'fcm' | 'none'
  message?: string
}

/** Tracks listener setup and the one OS registration currently in flight. */
let nativeListenersPromise: Promise<void> | null = null
let pendingNativeRegistration: {
  resolve: () => void
  reject: (error: Error) => void
} | null = null

function decodeApplicationServerKey(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const decoded = window.atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

export async function requestNotificationAccess(): Promise<PermissionOutcome> {
  return ensureNotificationPermission()
}

export function canUseNativePush(): boolean {
  return isNativeApp() && isPluginAvailable('PushNotifications')
}

/**
 * The same question, asked at a moment when it can be answered.
 *
 * A shell loads the portal over the network, so the bridge that registers the push
 * plugin can arrive after the page does; asking synchronously on mount would report
 * "no native push" for a device that has it.
 */
async function canUseNativePushWhenReady(): Promise<boolean> {
  if (!isNativeApp()) return false
  await waitForNativeBridge()
  return canUseNativePush()
}

async function saveNativeToken(token: string): Promise<void> {
  const response = await fetch('/api/push-subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ platform: getPlatform(), token }),
  })
  if (!response.ok) {
    let detail = ''
    try {
      detail = String(((await response.json()) as { error?: string }).error || '').trim()
    } catch {
      // A proxy may return HTML for an upstream failure; retain the safe fallback.
    }
    throw new Error(detail || 'This device could not be registered for notifications.')
  }
}

async function ensureNativePushListeners(): Promise<void> {
  if (nativeListenersPromise) return nativeListenersPromise

  nativeListenersPromise = (async () => {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    await PushNotifications.addListener('registration', (token) => {
      // Fix: registration is successful only after the authenticated backend has
      // persisted the FCM token. This prevents the prompt from reporting success
      // while the device is still unreachable.
      void saveNativeToken(token.value)
        .then(() => pendingNativeRegistration?.resolve())
        .catch((error) => pendingNativeRegistration?.reject(error as Error))
    })

    await PushNotifications.addListener('registrationError', (error) => {
      const detail = String(error?.error || '').trim()
      pendingNativeRegistration?.reject(
        new Error(detail || 'This device could not register for notifications.'),
      )
    })

    await PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      // iOS already presents foreground notifications through presentationOptions.
      // Android does not, so mirror only Android messages as local notifications.
      if (getPlatform() !== 'android') return
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        await LocalNotifications.schedule({
          notifications: [
            {
              id: Math.floor(Math.random() * 1_000_000),
              title: notification.title || "Ann Ann's Beverages Trading",
              body: notification.body || '',
              extra: notification.data,
            },
          ],
        })
      } catch {
        // Without the local-notifications plugin the payload is simply not mirrored.
      }
    })

    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const target = String(action.notification?.data?.url || '/')
      if (typeof window !== 'undefined' && target) {
        window.location.assign(target)
      }
    })
  })().catch((error) => {
    // Allow a later attempt to recover if bridge/plugin initialization was early.
    nativeListenersPromise = null
    throw error
  })

  return nativeListenersPromise
}

/**
 * Register the native shell for push and keep it listening.
 *
 * Android foreground messages are re-raised as local notifications; iOS uses the
 * configured presentation options. Tapping either transport routes through the
 * payload's url.
 */
async function registerNativePush(): Promise<PushRegistration> {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  await ensureNativePushListeners()

  if (pendingNativeRegistration) {
    return { registered: false, transport: 'none', message: 'Notification registration is already in progress.' }
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const tokenSaved = new Promise<void>((resolve, reject) => {
      pendingNativeRegistration = { resolve, reject }
      // FCM normally answers immediately; bound the wait so a broken native setup
      // produces an actionable failure instead of leaving the button spinning.
      timeoutId = setTimeout(
        () => reject(new Error('Notification registration timed out. Check the Firebase app configuration.')),
        15_000,
      )
    })
    await PushNotifications.register()
    await tokenSaved
    return { registered: true, transport: 'fcm' }
  } catch (error) {
    console.warn('Native push registration failed:', error)
    return {
      registered: false,
      transport: 'none',
      message: (error as Error)?.message || 'This device could not register for notifications.',
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    pendingNativeRegistration = null
  }
}

async function registerWebPush(): Promise<PushRegistration> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { registered: false, transport: 'none', message: 'This browser cannot receive notifications.' }
  }

  const configResponse = await fetch('/api/push-subscriptions', { cache: 'no-store', credentials: 'include' })
  if (!configResponse.ok) {
    return { registered: false, transport: 'none', message: 'Notification settings could not be loaded.' }
  }
  const config = (await configResponse.json()) as { enabled?: boolean; publicKey?: string }
  if (!config.enabled || !config.publicKey) {
    return { registered: false, transport: 'none', message: 'Notifications are not configured on the server.' }
  }

  await navigator.serviceWorker.register('/push-sw.js')
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(config.publicKey) as BufferSource,
    })
  }

  const response = await fetch('/api/push-subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(subscription.toJSON()),
  })
  if (!response.ok) {
    return { registered: false, transport: 'none', message: 'The device subscription could not be saved.' }
  }
  return { registered: true, transport: 'web-push' }
}

/**
 * Ask for permission if needed, then register this device.
 *
 * Call it from a user action: browsers only allow one permission prompt per site
 * and spend it on the first request, whether or not the person expected it.
 */
export async function enableNotifications(): Promise<PushRegistration> {
  if (typeof window === 'undefined') return { registered: false, transport: 'none' }

  const permission = await ensureNotificationPermission()
  if (!permission.granted) {
    return { registered: false, transport: 'none', message: permission.message }
  }

  try {
    return (await canUseNativePushWhenReady()) ? await registerNativePush() : await registerWebPush()
  } catch (error) {
    return {
      registered: false,
      transport: 'none',
      message: (error as Error)?.message || 'Notifications could not be enabled on this device.',
    }
  }
}

/**
 * Register silently when permission was already granted on a previous visit, so a
 * returning device keeps receiving updates without being asked again.
 */
export async function resumeNotificationsIfAllowed(): Promise<PushRegistration> {
  if (typeof window === 'undefined') return { registered: false, transport: 'none' }

  if (await canUseNativePushWhenReady()) {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications')
      const status = await PushNotifications.checkPermissions()
      if (status.receive !== 'granted') return { registered: false, transport: 'none' }
      return await registerNativePush()
    } catch {
      return { registered: false, transport: 'none' }
    }
  }

  // A shell without a bridge has no web push either, so there is nothing to resume.
  if (isNativeApp()) return { registered: false, transport: 'none' }

  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return { registered: false, transport: 'none' }
  }
  try {
    return await registerWebPush()
  } catch {
    return { registered: false, transport: 'none' }
  }
}
