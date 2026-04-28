'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { getTabAuthToken } from '@/lib/client-auth'
import { toast } from 'sonner'

// Driver trip payload shape returned by `/api/driver/trips`.
interface Trip {
  id: string
  tripNumber: string
  status: string
  tripSchedule?: string | null
  warehouseId?: string | null
  warehouseLatitude?: number | null
  warehouseLongitude?: number | null
  startLatitude?: number | null
  startLongitude?: number | null
  warehouse?: {
    id?: string
    name?: string
    code?: string
    address?: string
    city?: string
    province?: string
    latitude?: number | null
    longitude?: number | null
  } | null
  plannedStartAt: string | null
  actualStartAt?: string | null
  actualEndAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  totalDropPoints: number
  completedDropPoints: number
  latestLocation?: {
    latitude?: number | null
    longitude?: number | null
    accuracy?: number | null
    heading?: number | null
    speed?: number | null
    recordedAt?: string | null
  } | null
  driver?: {
    name?: string
    user?: {
      name?: string
    }
  }
  vehicle: {
    licensePlate: string
    type: string
  }
  dropPoints: DropPoint[]
}

// Order item spare-product guidance attached to a drop point order item.
interface SpareProductsInfo {
  unit?: string | null
  minPercent?: number
  maxPercent?: number
  recommendedPercent?: number
  minQuantity?: number
  recommendedQuantity?: number
  maxQuantity?: number
  totalLoadQuantity?: number
}

// Trip stop with nested order and replacement metadata used by driver flow.
interface DropPoint {
  id: string
  sequence: number
  status: string
  locationName: string
  address: string
  city: string
  latitude?: number | null
  longitude?: number | null
  contactName: string | null
  contactPhone: string | null
  deliveryPhoto?: string | null
  order: {
    id?: string
    orderNumber: string
    deliveryDate?: string | null
    warehouseId?: string | null
    warehouseName?: string | null
    warehouseCode?: string | null
    warehouseAddress?: string | null
    warehouseCity?: string | null
    warehouseProvince?: string | null
    totalAmount?: number | null
    warehouseStage?: string | null
    loadedAt?: string | null
    checklistItemsVerified?: boolean
    checklistQuantityVerified?: boolean
    checklistPackagingVerified?: boolean
    checklistSpareProductsVerified?: boolean
    checklistVehicleAssigned?: boolean
    checklistDriverAssigned?: boolean
    isDriverAssigned?: boolean
    assignedDriverName?: string | null
    items?: Array<{
      id: string
      productId: string
      quantity: number
      product?: {
        sku?: string | null
        name?: string | null
        unit?: string | null
      } | null
      spareProducts?: SpareProductsInfo | null
    }>
    replacements?: Array<{
      id: string
      status: string
      replacementQuantity?: number | null
      remainingQuantity?: number | null
      originalOrderItemId?: string | null
      dropPointId?: string | null
      replacementMode?: string | null
      damagePhotoUrl?: string | null
      notes?: string | null
      processedAt?: string | null
      isClosed?: boolean
    }>
  } | null
}

// Native camera permission check result.
type NativeCameraCheckResult = {
  granted: boolean
  reason?: string
}

export type LocationPermissionState = 'granted' | 'denied' | 'prompt'

export type DriverGpsLocation = {
  lat: number
  lng: number
  accuracy?: number | null
  heading?: number | null
  speed?: number | null
  recordedAt?: number
}

// Security and GPS filtering constants used by tracking flow.
const isSecureWebContext = typeof window !== 'undefined' ? window.isSecureContext : true
const DRIVER_GPS_GOOD_ACCURACY_METERS = 50
const DRIVER_GPS_MAX_USABLE_ACCURACY_METERS = 120
const DRIVER_GPS_MAX_JUMP_METERS = 250

async function fetchJsonWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retryConfig: number | { retries?: number; timeoutMs?: number } = 5
) {
  // Retry wrapper with timeout and auth token injection for portal API calls.
  const retries = typeof retryConfig === 'number' ? retryConfig : (retryConfig.retries ?? 5)
  const timeoutMs = typeof retryConfig === 'number' ? 10000 : (retryConfig.timeoutMs ?? 10000)
  let lastResponse: Response | null = null
  let lastData: any = {}
  let lastRaw = ''

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const token = getTabAuthToken()
      const headers = new Headers(init?.headers)
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`)
      }
      const response = await fetch(input, {
        ...(init || {}),
        headers,
        credentials: init?.credentials ?? 'include',
        signal: controller.signal,
      })
      const raw = await response.text()
      const data = raw ? JSON.parse(raw) : {}
      lastResponse = response
      lastData = data
      lastRaw = raw
      if (response.ok && data?.success !== false) {
        return { response, data, raw }
      }
      if (response.status === 401 || response.status === 403) {
        return { response, data, raw }
      }
    } catch (error) {
      lastData = { error: error instanceof Error ? error.message : 'Request failed' }
      lastRaw = ''
    } finally {
      window.clearTimeout(timeoutId)
    }

    if (attempt < retries) {
      await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)))
    }
  }

  return { response: lastResponse, data: lastData, raw: lastRaw }
}

// Determines if app runs inside Capacitor native container.
const isNativeCapacitorApp = () => {
  if (typeof window === 'undefined') return false
  const cap = (window as any).Capacitor
  if (!cap) return false
  if (typeof cap.isNativePlatform === 'function') {
    return Boolean(cap.isNativePlatform())
  }
  return String(cap?.getPlatform?.() || '').toLowerCase() !== 'web'
}

// Ensures camera permission for native app before allowing camera-dependent operations.
const checkNativeCameraPermission = async (): Promise<NativeCameraCheckResult> => {
  if (typeof window === 'undefined' || !isNativeCapacitorApp()) {
    return { granted: true }
  }

  try {
    const cameraModule = await import('@capacitor/camera')
    let result = await cameraModule.Camera.checkPermissions()
    const current = String((result as any)?.camera || (result as any)?.photos || '')
    if (current !== 'granted') {
      result = await cameraModule.Camera.requestPermissions({ permissions: ['camera'] })
    }
    const finalState = String((result as any)?.camera || (result as any)?.photos || '')
    if (finalState === 'granted') {
      return { granted: true }
    }
    return { granted: false, reason: 'Camera permission is blocked. Enable it in app settings.' }
  } catch {
    return { granted: false, reason: 'Unable to verify camera permission. Please allow it in app settings.' }
  }
}

// Opens application settings (native) so user can manually grant blocked permissions.
const openNativeAppSettings = async (): Promise<boolean> => {
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

// Main driver portal state hook: data fetching, sync, permissions, and GPS tracking.
export function useDriverPortalState() {
  // View and trip state.
  const [activeView, setActiveView] = useState('home')
  const [trips, setTrips] = useState<Trip[]>([])
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [locationPermission, setLocationPermission] = useState<LocationPermissionState>('prompt')
  const [currentLocation, setCurrentLocation] = useState<DriverGpsLocation | null>(null)
  const [isTracking, setIsTracking] = useState(false)
  const [isNativeCameraGateOpen, setIsNativeCameraGateOpen] = useState(false)
  const [nativeCameraGateMessage, setNativeCameraGateMessage] = useState('Camera permission is required to use AnnDrive.')
  const [isCheckingNativeCameraPermission, setIsCheckingNativeCameraPermission] = useState(false)
  const [loadingOrderId, setLoadingOrderId] = useState<string | null>(null)
  // Mutable refs for polling/tracking without rerender churn.
  const watchIdRef = useRef<number | null>(null)
  const isFetchingTripsRef = useRef(false)
  const latestTripsRef = useRef<Trip[]>([])
  const latestGpsRef = useRef<DriverGpsLocation | null>(null)

  // Fetches driver trips and keeps both state and refs in sync.
  const fetchTrips = useCallback(async (_silent = false): Promise<Trip[]> => {
    if (isFetchingTripsRef.current) return latestTripsRef.current
    isFetchingTripsRef.current = true
    try {
      const { response, data, raw } = await fetchJsonWithRetry(
        '/api/driver/trips',
        { cache: 'no-store', credentials: 'include' },
        { retries: 2, timeoutMs: 10000 }
      )

      if (!response?.ok || data?.success === false) {
        const rawMessage = typeof data?.error === 'string' ? data.error : ''
        const status = response?.status || 0
        const fallbackMessage =
          status >= 500
            ? `Server error (${status}).`
            : `Request failed (${status}).`
        const detail = !rawMessage && raw ? ` ${raw.slice(0, 180)}` : ''
        throw new Error((rawMessage || fallbackMessage) + detail)
      }

      const nextTrips = Array.isArray(data.trips) ? data.trips : []
      latestTripsRef.current = nextTrips
      setTrips(nextTrips)
      return nextTrips
    } catch (error: any) {
      console.warn('Failed to fetch trips:', error)
      return latestTripsRef.current
    } finally {
      isFetchingTripsRef.current = false
      setIsLoading(false)
    }
  }, [])

  // Applies a local optimistic patch to a specific trip.
  const applyTripUpdate = useCallback((tripId: string, updater: (trip: Trip) => Trip) => {
    setTrips((previousTrips) => {
      const nextTrips = previousTrips.map((trip) => (trip.id === tripId ? updater(trip) : trip))
      latestTripsRef.current = nextTrips
      return nextTrips
    })
  }, [])

  // Initial load + polling + cross-portal sync listeners.
  useEffect(() => {
    void fetchTrips()

    const unsubscribe = subscribeDataSync((message) => {
      if (message.scopes.includes('orders') || message.scopes.includes('trips') || message.scopes.includes('replacements')) {
        void fetchTrips(true)
      }
    })

    const onFocus = () => {
      void fetchTrips(true)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchTrips(true)
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchTrips(true)
      }
    }, 15000)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [fetchTrips])

  // Marks order as loaded from driver side and updates nested trip/order state optimistically.
  const markOrderLoaded = useCallback(async (orderId: string) => {
    setLoadingOrderId(orderId)
    try {
      const response = await fetch(`/api/orders/${orderId}/warehouse-stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseStage: 'LOADED',
          checklist: {
            quantityVerified: true,
          },
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to mark order as loaded')
      }
      const updatedOrder = payload?.order || {}
      setTrips((previousTrips) => {
        const nextTrips = previousTrips.map((trip) => ({
          ...trip,
          dropPoints: (trip.dropPoints || []).map((point) => {
            if (point.order?.id !== orderId) return point
            return {
              ...point,
              order: point.order
                ? {
                    ...point.order,
                    ...updatedOrder,
                    warehouseStage: updatedOrder.warehouseStage || 'LOADED',
                    loadedAt: updatedOrder.loadedAt || new Date().toISOString(),
                    checklistQuantityVerified: true,
                  }
                : point.order,
            }
          }),
        }))
        latestTripsRef.current = nextTrips
        return nextTrips
      })
      toast.success(payload?.message || 'Order marked as loaded')
      emitDataSync(['orders', 'trips'])
      void fetchTrips(true)
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to mark order as loaded')
      return false
    } finally {
      setLoadingOrderId(null)
    }
  }, [fetchTrips])

  // Camera gate check used for native app startup/focus.
  const enforceNativeCameraPermission = useCallback(async () => {
    if (!isNativeCapacitorApp()) {
      setIsNativeCameraGateOpen(false)
      return true
    }
    setIsCheckingNativeCameraPermission(true)
    const permission = await checkNativeCameraPermission()
    if (permission.granted) {
      setIsNativeCameraGateOpen(false)
      setIsCheckingNativeCameraPermission(false)
      return true
    }
    setNativeCameraGateMessage(permission.reason || 'Camera permission is required to use AnnDrive.')
    setIsNativeCameraGateOpen(true)
    setIsCheckingNativeCameraPermission(false)
    return false
  }, [])

  // Re-check camera permission when app regains focus/visibility.
  useEffect(() => {
    void enforceNativeCameraPermission()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void enforceNativeCameraPermission()
      }
    }
    const onFocus = () => {
      void enforceNativeCameraPermission()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
    }
  }, [enforceNativeCameraPermission])

  // Reads browser geolocation permission status when available.
  useEffect(() => {
    if (!('permissions' in navigator) || !navigator.permissions?.query) return
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((result) => {
        setLocationPermission(result.state as LocationPermissionState)
      })
      .catch(() => {
        setLocationPermission('prompt')
      })
  }, [])

  // Lightweight promise wrappers and GPS transforms.
  const readCurrentPosition = (options?: PositionOptions) =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options)
    })

  const gpsFromPosition = (position: GeolocationPosition): DriverGpsLocation | null => {
    const lat = Number(position.coords.latitude)
    const lng = Number(position.coords.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return {
      lat,
      lng,
      accuracy: Number.isFinite(Number(position.coords.accuracy)) ? Number(position.coords.accuracy) : null,
      heading: Number.isFinite(Number(position.coords.heading)) ? Number(position.coords.heading) : null,
      speed: Number.isFinite(Number(position.coords.speed)) ? Number(position.coords.speed) : null,
      recordedAt: Number(position.timestamp || Date.now()),
    }
  }

  // Distance + quality heuristics to reject noisy GPS jumps.
  const distanceMeters = (from: DriverGpsLocation, to: DriverGpsLocation) => {
    const radiusMeters = 6371000
    const toRad = (value: number) => (value * Math.PI) / 180
    const dLat = toRad(to.lat - from.lat)
    const dLng = toRad(to.lng - from.lng)
    const lat1 = toRad(from.lat)
    const lat2 = toRad(to.lat)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
    return radiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  const shouldUseGpsLocation = (next: DriverGpsLocation, previous: DriverGpsLocation | null) => {
    const nextAccuracy = Number(next.accuracy ?? Number.POSITIVE_INFINITY)
    if (!previous) return nextAccuracy <= DRIVER_GPS_MAX_USABLE_ACCURACY_METERS || !Number.isFinite(nextAccuracy)

    const previousAccuracy = Number(previous.accuracy ?? Number.POSITIVE_INFINITY)
    if (nextAccuracy <= DRIVER_GPS_GOOD_ACCURACY_METERS) return true
    if (nextAccuracy > DRIVER_GPS_MAX_USABLE_ACCURACY_METERS && previousAccuracy <= DRIVER_GPS_MAX_USABLE_ACCURACY_METERS) {
      return false
    }

    const movedMeters = distanceMeters(previous, next)
    if (movedMeters > DRIVER_GPS_MAX_JUMP_METERS && nextAccuracy > previousAccuracy) {
      return false
    }
    return true
  }

  // Sends driver coordinates to backend; failures are intentionally non-blocking.
  const sendLocationUpdate = async (location: DriverGpsLocation, tripId?: string | null) => {
    try {
      await fetch('/api/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: location.lat,
          longitude: location.lng,
          tripId: tripId || null,
          accuracy: location.accuracy ?? null,
          heading: location.heading ?? null,
          speed: location.speed ?? null,
        }),
      })
    } catch {
      // ignore location sync failures to avoid disrupting driving flow
    }
  }

  // Selects the trip currently eligible for live tracking attachment.
  const getActiveTripId = () => {
    if (selectedTripId) {
      const t = trips.find((trip) => trip.id === selectedTripId)
      if (t?.status === 'IN_PROGRESS') return t.id
    }
    const inProgress = trips.find((trip) => trip.status === 'IN_PROGRESS')
    return inProgress?.id || null
  }

  // Applies accepted GPS point locally and sends it upstream.
  const applyGpsLocation = (next: DriverGpsLocation, tripId?: string | null) => {
    if (!shouldUseGpsLocation(next, latestGpsRef.current)) return false
    latestGpsRef.current = next
    setCurrentLocation(next)
    setLocationPermission('granted')
    setIsTracking(true)
    void sendLocationUpdate(next, tripId)
    return true
  }

  // Attempts two high-accuracy position reads and picks the best sample.
  const getAccurateCurrentPosition = async () => {
    const first = await readCurrentPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 18000 })
    let best = gpsFromPosition(first)
    if (best && Number(best.accuracy ?? Number.POSITIVE_INFINITY) <= DRIVER_GPS_GOOD_ACCURACY_METERS) {
      return best
    }

    const second = await readCurrentPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }).catch(() => null)
    const next = second ? gpsFromPosition(second) : null
    if (!best) return next
    if (next && Number(next.accuracy ?? Number.POSITIVE_INFINITY) < Number(best.accuracy ?? Number.POSITIVE_INFINITY)) {
      best = next
    }
    return best
  }

  // Opens location settings to help user recover from denied permissions.
  const openLocationSettings = async () => {
    try {
      if (await openNativeAppSettings()) {
        return
      }
      const ua = navigator.userAgent.toLowerCase()
      if (ua.includes('android')) {
        window.location.href = 'intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end'
        return
      }
      if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
        window.location.href = 'app-settings:'
        return
      }
      window.open('about:preferences#privacy', '_blank')
    } catch {
      // best effort only
    }
  }

  // Starts live location tracking session with guardrails for platform/permissions.
  const startLocationTracking = async (): Promise<boolean> => {
    if (!isSecureWebContext && !isNativeCapacitorApp()) {
      toast.error('Location requires HTTPS on browser. Open this app over HTTPS or use the native app.')
      return false
    }

    if (!navigator.geolocation) {
      toast.error('Location is not supported on this device/browser')
      return false
    }

    try {
      const location = await getAccurateCurrentPosition()
      if (!location) {
        throw new Error('Location unavailable')
      }
      applyGpsLocation(location, getActiveTripId())
    } catch {
      setLocationPermission('denied')
      setIsTracking(false)
      toast.error('Location is required to start trip. Please enable location access in settings.')
      void openLocationSettings()
      return false
    }

    if (watchIdRef.current !== null) {
      setIsTracking(true)
      return true
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const location = gpsFromPosition(position)
        if (!location) return
        applyGpsLocation(location, getActiveTripId())
      },
      () => {
        setLocationPermission('denied')
        setIsTracking(false)
        toast.error('Location permission denied. Please enable location access.')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    )

    watchIdRef.current = watchId
    toast.success('Location tracking started')
    return true
  }

  // Clears geolocation watch on unmount.
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  // Convenience handler used by camera gate dialog.
  const openNativeCameraAppSettings = useCallback(async () => {
    const opened = await openNativeAppSettings()
    if (!opened) {
      toast.error('Could not open app settings automatically. Open app settings manually and allow Camera.')
    }
  }, [])

  // Public hook contract consumed by `DriverPortal`.
  return {
    activeView,
    setActiveView,
    trips,
    selectedTripId,
    setSelectedTripId,
    isLoading,
    locationPermission,
    currentLocation,
    isTracking,
    isNativeCameraGateOpen,
    nativeCameraGateMessage,
    isCheckingNativeCameraPermission,
    loadingOrderId,
    fetchTrips,
    applyTripUpdate,
    markOrderLoaded,
    enforceNativeCameraPermission,
    startLocationTracking,
    openNativeCameraAppSettings,
  }
}
