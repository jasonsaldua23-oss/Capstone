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

/** Tracks the listeners so a re-render cannot attach them twice. */
let nativeListenersAttached = false

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
    throw new Error('This device could not be registered for notifications.')
  }
}

/**
 * Register the native shell for push and keep it listening.
 *
 * A notification that arrives while the app is open does not appear in the tray on
 * either platform, so it is re-raised as a local notification; tapping either one
 * routes into the portal through the payload's url.
 */
async function registerNativePush(): Promise<PushRegistration> {
  const { PushNotifications } = await import('@capacitor/push-notifications')

  if (!nativeListenersAttached) {
    nativeListenersAttached = true

    await PushNotifications.addListener('registration', (token) => {
      void saveNativeToken(token.value).catch(() => {
        // Registration is best-effort; the next launch retries it.
      })
    })

    await PushNotifications.addListener('registrationError', () => {
      // Nothing to do here: the account still receives in-app notifications.
    })

    await PushNotifications.addListener('pushNotificationReceived', async (notification) => {
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
  }

  try {
    await PushNotifications.register()
  } catch (error) {
    // The permission is granted and notifications raised by the app itself still
    // arrive; only the remote token is missing, and the next launch retries it.
    console.warn('Native push registration failed:', error)
  }
  return { registered: true, transport: 'fcm' }
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
