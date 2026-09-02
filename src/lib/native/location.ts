/**
 * One location API for the browser and the native shells.
 *
 * The driver portal already had a working `navigator.geolocation` flow; this keeps
 * that exact behaviour on the web and routes through the Capacitor plugin inside the
 * app, where the browser API is unreliable and the OS permission has to be requested
 * explicitly. Callers get plain coordinates and never learn which path ran.
 */

import { isNativeApp, isPluginAvailable } from './platform'
import { ensureLocationPermission, type PermissionOutcome } from './permissions'

export type Coordinates = {
  latitude: number
  longitude: number
  accuracy: number | null
  heading: number | null
  speed: number | null
  timestamp: number
}

export type LocationOptions = {
  enableHighAccuracy?: boolean
  timeout?: number
  maximumAge?: number
}

export class LocationUnavailableError extends Error {
  readonly blocked: boolean
  constructor(message: string, blocked = false) {
    super(message)
    this.name = 'LocationUnavailableError'
    this.blocked = blocked
  }
}

const DEFAULTS: Required<LocationOptions> = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,
}

function fromBrowserPosition(position: GeolocationPosition): Coordinates {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    heading: Number.isFinite(position.coords.heading as number) ? (position.coords.heading as number) : null,
    speed: Number.isFinite(position.coords.speed as number) ? (position.coords.speed as number) : null,
    timestamp: position.timestamp || Date.now(),
  }
}

function describeBrowserError(error: GeolocationPositionError): LocationUnavailableError {
  if (error.code === error.PERMISSION_DENIED) {
    return new LocationUnavailableError(
      'Location access is blocked. Allow location for this site and try again.',
      true,
    )
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return new LocationUnavailableError(
      'Your location could not be determined. Check that location services are switched on.',
    )
  }
  return new LocationUnavailableError('Getting your location took too long. Try again in a moment.')
}

function shouldUseNativePlugin(): boolean {
  return isNativeApp() && isPluginAvailable('Geolocation')
}

/** Ask for permission first; callers can show `message` when it is refused. */
export async function requestLocationAccess(): Promise<PermissionOutcome> {
  return ensureLocationPermission()
}

export async function getCurrentPosition(options: LocationOptions = {}): Promise<Coordinates> {
  const settings = { ...DEFAULTS, ...options }
  const permission = await ensureLocationPermission()
  if (!permission.granted) {
    throw new LocationUnavailableError(permission.message, permission.blocked)
  }

  if (shouldUseNativePlugin()) {
    const { Geolocation } = await import('@capacitor/geolocation')
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: settings.enableHighAccuracy,
      timeout: settings.timeout,
      maximumAge: settings.maximumAge,
    })
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
      heading: position.coords.heading ?? null,
      speed: position.coords.speed ?? null,
      timestamp: position.timestamp || Date.now(),
    }
  }

  if (!navigator.geolocation) {
    throw new LocationUnavailableError('This browser cannot share your location.')
  }
  return new Promise<Coordinates>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(fromBrowserPosition(position)),
      (error) => reject(describeBrowserError(error)),
      settings,
    )
  })
}

export type LocationWatch = {
  /** Stops the watch. Safe to call more than once. */
  clear: () => void
}

/**
 * Follow the device position until `clear()` is called. Errors are delivered to
 * `onError` rather than thrown, because a watch outlives the call that started it.
 */
export async function watchPosition(
  onPosition: (coords: Coordinates) => void,
  onError?: (error: LocationUnavailableError) => void,
  options: LocationOptions = {},
): Promise<LocationWatch> {
  const settings = { ...DEFAULTS, ...options }
  const permission = await ensureLocationPermission()
  if (!permission.granted) {
    const failure = new LocationUnavailableError(permission.message, permission.blocked)
    onError?.(failure)
    return { clear: () => {} }
  }

  if (shouldUseNativePlugin()) {
    const { Geolocation } = await import('@capacitor/geolocation')
    const watchId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: settings.enableHighAccuracy,
        timeout: settings.timeout,
        maximumAge: settings.maximumAge,
      },
      (position, error) => {
        if (error || !position) {
          onError?.(new LocationUnavailableError('Live location was interrupted. Trying again.'))
          return
        }
        onPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
          heading: position.coords.heading ?? null,
          speed: position.coords.speed ?? null,
          timestamp: position.timestamp || Date.now(),
        })
      },
    )
    let cleared = false
    return {
      clear: () => {
        if (cleared) return
        cleared = true
        void Geolocation.clearWatch({ id: watchId }).catch(() => {})
      },
    }
  }

  if (!navigator.geolocation) {
    onError?.(new LocationUnavailableError('This browser cannot share your location.'))
    return { clear: () => {} }
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => onPosition(fromBrowserPosition(position)),
    (error) => onError?.(describeBrowserError(error)),
    settings,
  )
  let cleared = false
  return {
    clear: () => {
      if (cleared) return
      cleared = true
      navigator.geolocation.clearWatch(watchId)
    },
  }
}
