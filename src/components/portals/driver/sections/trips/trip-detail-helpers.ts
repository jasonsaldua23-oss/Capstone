'use client'

export type Trip = any
export type DropPoint = any
export type DriverGpsLocation = any
export type SpareReplacementLine = any

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

export const MAX_SPARE_DAMAGE_PHOTOS = 2
export const SPARE_DAMAGE_REASON_OPTIONS = ['Broken bottles', 'Cracked containers', 'Leakages', 'Spoilage', 'Others'] as const
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

// Detects whether app is running in Capacitor native runtime.
export const isNativeCapacitorApp = () => {
  const cap = (globalThis as any)?.Capacitor
  if (!cap) return false
  if (typeof cap.isNativePlatform === 'function') {
    return Boolean(cap.isNativePlatform())
  }
  if (typeof cap.getPlatform === 'function') {
    return cap.getPlatform() !== 'web'
  }
  return false
}

// Checks/requests camera permission in native app; web always returns granted.
export const checkNativeCameraPermission = async (): Promise<NativeCameraCheckResult> => {
  if (!isNativeCapacitorApp()) return { granted: true }
  try {
    const cameraModule = await import('@capacitor/camera')
    const current = await cameraModule.Camera.checkPermissions()
    const currentState = current.camera
    if (currentState === 'granted' || currentState === 'limited') {
      return { granted: true }
    }

    const requested = await cameraModule.Camera.requestPermissions({ permissions: ['camera'] })
    if (requested.camera === 'granted' || requested.camera === 'limited') {
      return { granted: true }
    }
    return { granted: false, reason: 'Camera permission is required to take photos.' }
  } catch (error: any) {
    return { granted: false, reason: error?.message || 'Unable to check camera permission.' }
  }
}

// Opens application settings (native) so user can manually grant blocked permissions.
export const openNativeAppSettings = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || !isNativeCapacitorApp()) {
    return false
  }

  try {
    const appModule = await import('@capacitor/app')
    const appAny = appModule.App as any
    if (typeof appAny?.openAppSettings === 'function') {
      await appAny.openAppSettings()
      return true
    }
  } catch {
    // Fall back to platform-specific best effort below.
  }

  try {
    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('android')) {
      window.location.href = 'intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;end'
      return true
    }

    window.location.href = 'app-settings:'
    return true
  } catch {
    return false
  }
}

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
