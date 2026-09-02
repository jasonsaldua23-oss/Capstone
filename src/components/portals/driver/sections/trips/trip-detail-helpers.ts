'use client'

import { isNativeApp, openAppSettings } from '@/lib/native/platform'
import { ensureCameraPermission } from '@/lib/native/permissions'

export type Trip = any
export type DropPoint = any
export type DriverGpsLocation = any

// Native camera permission check response shape.
type NativeCameraCheckResult = {
  granted: boolean
  reason?: string
}

// Default map center and map bounds used by driver trip map.
export const NEGROS_OCCIDENTAL_CENTER: [number, number] = [10.6765, 122.9511]
export const NEGROS_OCCIDENTAL_BOUNDS = {
  south: 9.18,
  west: 122.22,
  north: 11.05,
  east: 123.35,
}

// Terminal statuses are treated as "done" in progress computations.
export const TERMINAL_DROP_POINT_STATUSES = new Set(['COMPLETED', 'DELIVERED', 'FAILED', 'SKIPPED', 'CANCELED', 'CANCELLED'])

// Removes trailing Philippines labels from addresses to avoid repeated country suffix in UI.
export const stripPhilippinesFromAddress = (address: string | null | undefined) => {
  const text = String(address || '').trim()
  if (!text) return ''
  const tokens = text
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  while (tokens.length > 0) {
    const tail = String(tokens[tokens.length - 1] || '').toLowerCase()
    if (tail === 'philippines' || tail === 'republic of the philippines') {
      tokens.pop()
      continue
    }
    break
  }
  return tokens.join(', ')
}

// Runtime and permission handling live in @/lib/native so the driver portal, the
// customer portal and the install flow all answer these questions the same way.
export const isNativeCapacitorApp = isNativeApp

// Checks/requests camera permission in native app; web always returns granted.
export const checkNativeCameraPermission = async (): Promise<NativeCameraCheckResult> => {
  const outcome = await ensureCameraPermission()
  return outcome.granted ? { granted: true } : { granted: false, reason: outcome.message }
}

// Opens application settings (native) so user can manually grant blocked permissions.
export const openNativeAppSettings = openAppSettings

// Applies a patch to one drop point and recomputes trip-level completion fields.
export const mergeDropPointIntoTrip = (
  currentTrip: Trip,
  dropPointId: string,
  dropPointPatch: Partial<DropPoint>
): Trip => {
  const nextDropPoints = (currentTrip.dropPoints || []).map((point: DropPoint) => {
    if (point.id !== dropPointId) return point
    return {
      ...point,
      ...dropPointPatch,
      order: dropPointPatch.order === undefined ? point.order : dropPointPatch.order,
    }
  })
  const completedCount = nextDropPoints.filter((point: DropPoint) =>
    TERMINAL_DROP_POINT_STATUSES.has(String(point.status || '').toUpperCase())
  ).length
  const totalCount = Math.max(Number(currentTrip.totalDropPoints || 0), nextDropPoints.length)
  return {
    ...currentTrip,
    dropPoints: nextDropPoints,
    completedDropPoints: completedCount,
    totalDropPoints: totalCount,
    status:
      totalCount > 0 && completedCount >= totalCount
        ? 'COMPLETED'
        : currentTrip.status === 'PLANNED' && currentTrip.actualStartAt
          ? 'IN_PROGRESS'
          : currentTrip.status,
  }
}

export type NavigationApp = 'google' | 'waze' | 'organic'

export type OpenNavigationOptions = {
  latitude: number
  longitude: number
  label?: string
  app?: NavigationApp
}

export const openNavigation = async (options: OpenNavigationOptions): Promise<boolean> => {
  const { latitude, longitude, label, app = 'google' } = options
  const labelEncoded = encodeURIComponent(label || 'Destination')

  let url = ''
  if (app === 'waze') {
    url = `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`
  } else if (app === 'organic') {
    url = `geo:${latitude},${longitude}?q=${latitude},${longitude}(${labelEncoded})`
  } else {
    url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
  }

  if (typeof window !== 'undefined') {
    if (isNativeCapacitorApp()) {
      let nativeUrl = ''
      if (app === 'waze') {
        nativeUrl = `waze://?ll=${latitude},${longitude}&navigate=yes`
      } else if (app === 'google') {
        nativeUrl = `comgooglemaps://?q=${latitude},${longitude}`
      } else {
        nativeUrl = `geo:${latitude},${longitude}?q=${latitude},${longitude}(${labelEncoded})`
      }

      try {
        window.location.href = nativeUrl
        return true
      } catch {
        window.open(url, '_blank')
        return true
      }
    } else {
      window.open(url, '_blank')
      return true
    }
  }
  return false
}
