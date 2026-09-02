/**
 * Camera, location and notification permissions across the four runtimes.
 *
 * Every helper returns the same shape so callers can act on a refusal without
 * knowing which runtime denied it: `granted` says whether the feature may run,
 * `blocked` distinguishes "the user said no permanently" from "not asked yet",
 * and `message` is copy that can be shown to the person as-is.
 */

import { getPlatform, isNativeApp, isPluginAvailable, isSecureContextForDeviceApis, waitForNativeBridge } from './platform'

export type PermissionOutcome = {
  granted: boolean
  /** The user denied it in a way that only OS or browser settings can undo. */
  blocked: boolean
  message: string
}

const OK: PermissionOutcome = { granted: true, blocked: false, message: '' }

function denied(message: string, blocked = false): PermissionOutcome {
  return { granted: false, blocked, message }
}

/**
 * Camera access for proof-of-delivery capture and photo evidence.
 *
 * Native asks the OS through the Camera plugin. On the web the browser prompts
 * when `getUserMedia` runs, so there is nothing to request up front - only the
 * secure-context requirement to check, because an insecure page silently has no
 * camera at all.
 */
export async function ensureCameraPermission(): Promise<PermissionOutcome> {
  if (typeof window === 'undefined') return denied('The camera is not available here.')

  if (isNativeApp() && isPluginAvailable('Camera')) {
    try {
      const { Camera } = await import('@capacitor/camera')
      let status = await Camera.checkPermissions()
      if (status.camera !== 'granted') {
        status = await Camera.requestPermissions({ permissions: ['camera'] })
      }
      if (status.camera === 'granted' || status.camera === 'limited') return OK
      return denied(
        'Camera access is required to take the delivery photo. Enable the camera for this app in your device settings.',
        status.camera === 'denied',
      )
    } catch {
      return denied('The camera permission could not be checked. Enable it for this app in your device settings.')
    }
  }

  if (!isSecureContextForDeviceApis()) {
    return denied('The camera needs a secure (https) connection. Open the portal over https and try again.')
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return denied('This browser cannot open the camera. Try a different browser or install the app.')
  }

  // The browser raises its own prompt when the stream is requested.
  if (navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
      if (status.state === 'denied') {
        return denied(
          'Camera access is blocked for this site. Allow the camera in your browser settings and reload.',
          true,
        )
      }
    } catch {
      // Not every browser can query the camera permission; the prompt still works.
    }
  }
  return OK
}

/**
 * Location access. The driver portal tracks position continuously while a trip is
 * running, so it asks for the precise permission rather than the coarse one.
 */
export async function ensureLocationPermission(): Promise<PermissionOutcome> {
  if (typeof window === 'undefined') return denied('Location is not available here.')

  if (isNativeApp() && isPluginAvailable('Geolocation')) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation')
      let status = await Geolocation.checkPermissions()
      if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
        status = await Geolocation.requestPermissions({ permissions: ['location'] })
      }
      if (status.location === 'granted' || status.coarseLocation === 'granted') return OK
      return denied(
        'Location access is required to track deliveries. Enable location for this app in your device settings.',
        status.location === 'denied',
      )
    } catch {
      return denied('The location permission could not be checked. Enable it for this app in your device settings.')
    }
  }

  if (!isSecureContextForDeviceApis()) {
    return denied('Location needs a secure (https) connection. Open the portal over https and try again.')
  }
  if (!navigator.geolocation) {
    return denied('This browser cannot share your location. Try a different browser or install the app.')
  }

  if (navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' })
      if (status.state === 'denied') {
        return denied(
          'Location access is blocked for this site. Allow location in your browser settings and reload.',
          true,
        )
      }
    } catch {
      // Older browsers cannot query it; the position request will prompt instead.
    }
  }
  return OK
}

/**
 * Notification permission. Asking cold annoys people and burns the one chance the
 * browser gives you, so callers should only reach here from a deliberate action.
 */
export async function ensureNotificationPermission(): Promise<PermissionOutcome> {
  if (typeof window === 'undefined') return denied('Notifications are not available here.')

  // Inside a shell the OS owns this permission, so wait for the bridge rather than
  // falling through to a web Notification API the Android web view does not have.
  if (isNativeApp()) await waitForNativeBridge()

  if (isNativeApp() && isPluginAvailable('PushNotifications')) {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications')
      let status = await PushNotifications.checkPermissions()
      if (status.receive !== 'granted') {
        status = await PushNotifications.requestPermissions()
      }
      if (status.receive === 'granted') return OK
      return denied(
        'Notifications are turned off for this app. Enable them in your device settings to receive delivery updates.',
        status.receive === 'denied',
      )
    } catch {
      return denied('The notification permission could not be checked. Enable it in your device settings.')
    }
  }

  if (!('Notification' in window)) {
    return denied(
      isNativeApp()
        ? 'Notifications are turned off for this app. Enable them in your device settings to receive delivery updates.'
        : 'This browser does not support notifications.',
      isNativeApp(),
    )
  }
  if (Notification.permission === 'granted') return OK
  if (Notification.permission === 'denied') {
    return denied(
      'Notifications are blocked for this site. Allow them in your browser settings to receive delivery updates.',
      true,
    )
  }
  try {
    const result = await Notification.requestPermission()
    if (result === 'granted') return OK
    return denied('Notifications stay off until you allow them for this site.', result === 'denied')
  } catch {
    return denied('The notification permission request could not be completed.')
  }
}

/** A short label for logs and support conversations. */
export function describeRuntime(): string {
  const platform = getPlatform()
  if (platform === 'android' || platform === 'ios') return `${platform} app`
  return platform === 'pwa' ? 'installed web app' : 'browser'
}
