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
const DRIVER_GPS_GOOD_ACCURACY_METERS = 35
const DRIVER_GPS_MAX_USABLE_ACCURACY_METERS = 80
const DRIVER_GPS_MAX_JUMP_METERS = 180
const DRIVER_GPS_MAX_REALISTIC_SPEED_MPS = 45

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
      let data: any = {}
      if (raw) {
        const contentType = String(response.headers.get('content-type') || '').toLowerCase()
        const isJson = contentType.includes('application/json')
        const looksLikeHtml = /^\s*</.test(raw)
        if (isJson) {
          data = JSON.parse(raw)
        } else if (looksLikeHtml) {
          data = { error: `Non-JSON response received (status ${response.status}).` }
        } else {
          data = { error: raw }
        }
      }
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
  const lastLocationUploadAtRef = useRef<number>(0)
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoTrackingTripIdRef = useRef<string | null>(null)
  const trackingLifecycleLockRef = useRef(false)
  const currentDriverUserIdRef = useRef<string | null>(null)

  const extractTripDriverId = useCallback((trip: any): string | null => {
    const value =
      trip?.driver?.id ??
      trip?.driver_id ??
      trip?.driverId ??
      trip?.driver?.userId ??
      trip?.driver?.user?.id ??
      null
    const normalized = String(value || '').trim()
    return normalized || null
  }, [])

  const resolveCurrentDriverUserId = useCallback(async (): Promise<string | null> => {
    if (currentDriverUserIdRef.current) return currentDriverUserIdRef.current
    const me = await fetchJsonWithRetry('/api/auth/me', { cache: 'no-store', credentials: 'include' }, { retries: 1, timeoutMs: 8000 })
    if (!me.response?.ok || me.data?.success === false) return null
    const role = String(me.data?.user?.role || '').toUpperCase()
    const userId = String(me.data?.user?.id || me.data?.user?.userId || '').trim()
    if (role !== 'DRIVER' || !userId) return null
    currentDriverUserIdRef.current = userId
    return userId
  }, [])

  const fetchTripsFallback = useCallback(async (): Promise<Trip[]> => {
    const driverUserId = await resolveCurrentDriverUserId()
    if (!driverUserId) return []
    const allTrips = await fetchJsonWithRetry(
      '/api/trips?page=1&pageSize=200',
      { cache: 'no-store', credentials: 'include' },
      { retries: 1, timeoutMs: 10000 }
    )
    if (!allTrips.response?.ok || allTrips.data?.success === false) return []
    const rows = Array.isArray(allTrips.data?.trips) ? allTrips.data.trips : []
    return rows.filter((trip: any) => extractTripDriverId(trip) === driverUserId)
  }, [extractTripDriverId, resolveCurrentDriverUserId])

  // Fetches driver trips and keeps both state and refs in sync.
  const fetchTrips = useCallback(async (_silent = false): Promise<Trip[]> => {
    if (isFetchingTripsRef.current) return latestTripsRef.current
    isFetchingTripsRef.current = true
    try {
      const { response, data, raw } = await fetchJsonWithRetry(
        '/api/driver/trips?page=1&pageSize=50',
        { cache: 'no-store', credentials: 'include' },
        { retries: 2, timeoutMs: 10000 }
      )

      let nextTrips = Array.isArray(data?.trips) ? data.trips : []
      const primaryFailed = !response?.ok || data?.success === false
      if (primaryFailed) {
        const fallbackTrips = await fetchTripsFallback()
        if (fallbackTrips.length > 0) {
          nextTrips = fallbackTrips
        } else {
          const rawMessage = typeof data?.error === 'string' ? data.error : ''
          const status = response?.status || 0
          const fallbackMessage =
            status >= 500
              ? `Server error (${status}).`
              : `Request failed (${status}).`
          const detail = !rawMessage && raw ? ` ${raw.slice(0, 180)}` : ''
          throw new Error((rawMessage || fallbackMessage) + detail)
        }
      }

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
  }, [fetchTripsFallback])

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
    if (!Number.isFinite(nextAccuracy)) return false
    if (!previous) return nextAccuracy <= DRIVER_GPS_MAX_USABLE_ACCURACY_METERS

    const previousAccuracy = Number(previous.accuracy ?? Number.POSITIVE_INFINITY)
    if (nextAccuracy > DRIVER_GPS_MAX_USABLE_ACCURACY_METERS) return false
    if (nextAccuracy <= DRIVER_GPS_GOOD_ACCURACY_METERS) return true

    const movedMeters = distanceMeters(previous, next)
    const nextTime = Number(next.recordedAt || Date.now())
    const previousTime = Number(previous.recordedAt || Date.now())
    const elapsedSeconds = Math.max((nextTime - previousTime) / 1000, 1)
    const inferredSpeedMps = movedMeters / elapsedSeconds
    if (inferredSpeedMps > DRIVER_GPS_MAX_REALISTIC_SPEED_MPS && nextAccuracy >= previousAccuracy) {
      return false
    }
    if (movedMeters > DRIVER_GPS_MAX_JUMP_METERS && nextAccuracy > previousAccuracy) {
      return false
    }
    return true
  }

  // Sends driver coordinates to backend; failures are intentionally non-blocking.
  const sendLocationUpdate = async (location: DriverGpsLocation, tripId?: string | null) => {
    try {
      const token = getTabAuthToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      await fetch('/api/driver/location', {
        method: 'POST',
        credentials: 'include',
        headers,
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
    const sourceTrips = latestTripsRef.current.length > 0 ? latestTripsRef.current : trips
    const normalizeStatus = (status: unknown) => {
      const value = String(status || '').toUpperCase()
      if (value === 'IN_TRANSIT' || value === 'OUT_FOR_DELIVERY') return 'IN_PROGRESS'
      return value
    }
    const isTrackableTrip = (trip: Trip | null | undefined) => {
      const normalized = normalizeStatus(trip?.status)
      return normalized === 'IN_PROGRESS' || normalized === 'PLANNED'
    }
    const isActiveTrip = (trip: Trip | null | undefined) => normalizeStatus(trip?.status) === 'IN_PROGRESS'
    const pickMostRecentActiveTrip = (tripList: Trip[]) => {
      const activeTrips = tripList.filter((trip) => isActiveTrip(trip))
      if (activeTrips.length === 0) return null
      return [...activeTrips].sort((a, b) => {
        const aTime = new Date((a as any)?.actualStartAt || (a as any)?.updatedAt || (a as any)?.createdAt || 0).getTime()
        const bTime = new Date((b as any)?.actualStartAt || (b as any)?.updatedAt || (b as any)?.createdAt || 0).getTime()
        return bTime - aTime
      })[0] || null
    }

    if (selectedTripId) {
      const selectedTrip = sourceTrips.find((trip) => trip.id === selectedTripId) || null
      if (isTrackableTrip(selectedTrip)) return selectedTrip?.id || null
    }

    const fallbackActiveTrip = pickMostRecentActiveTrip(sourceTrips)
    return fallbackActiveTrip?.id || null
  }

  // Applies accepted GPS point locally and sends it upstream.
  const applyGpsLocation = (next: DriverGpsLocation, tripId?: string | null) => {
    const now = Date.now()
    if (!shouldUseGpsLocation(next, latestGpsRef.current)) {
      const fallbackAccuracy = Number(next.accuracy ?? Number.POSITIVE_INFINITY)
      const shouldSendFallback = now - lastLocationUploadAtRef.current > 30000 && fallbackAccuracy <= 150
      if (shouldSendFallback) {
        void sendLocationUpdate(next, tripId)
        lastLocationUploadAtRef.current = now
      }
      return false
    }
    latestGpsRef.current = next
    setCurrentLocation(next)
    setLocationPermission('granted')
    setIsTracking(true)
    void sendLocationUpdate(next, tripId)
    lastLocationUploadAtRef.current = now
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
    } catch (error: any) {
      const geolocationErrorCode = Number(error?.code)
      if (geolocationErrorCode === 3) {
        // Timeout fallback: retry with lower accuracy and longer timeout.
        try {
          const fallback = await readCurrentPosition({
            enableHighAccuracy: false,
            maximumAge: 60000,
            timeout: 25000,
          })
          const fallbackLocation = gpsFromPosition(fallback)
          if (fallbackLocation) {
            applyGpsLocation(fallbackLocation, getActiveTripId())
          }
        } catch {
          // Continue to normal timeout handling below.
        }
      }

      if (latestGpsRef.current) {
        // Recovery succeeded from fallback read.
        setLocationPermission('granted')
      } else if (geolocationErrorCode === 1) {
        setLocationPermission('denied')
      } else {
        setLocationPermission('prompt')
      }

      if (latestGpsRef.current) {
        // Continue startup; watchPosition setup below will run normally.
      } else {
        setIsTracking(false)
        if (geolocationErrorCode === 1) {
          toast.error('Location is required to start trip. Please enable location access in settings.')
          void openLocationSettings()
        } else if (geolocationErrorCode === 3) {
          toast.error('Location request timed out. Please move to open sky and try again.')
        } else {
          toast.error('Unable to get current location right now. Please try again.')
        }
        return false
      }
    }

    if (watchIdRef.current !== null) {
      if (heartbeatIntervalRef.current === null) {
        heartbeatIntervalRef.current = setInterval(() => {
          void (async () => {
            try {
              const position = await readCurrentPosition({ enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 })
              const location = gpsFromPosition(position)
              if (!location) return
              const activeTripId = getActiveTripId()
              if (activeTripId) {
                void sendLocationUpdate(location, activeTripId)
                lastLocationUploadAtRef.current = Date.now()
              }
              applyGpsLocation(location, activeTripId)
            } catch {
              // heartbeat is best-effort
            }
          })()
        }, 20000)
      }
      setIsTracking(true)
      return true
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const location = gpsFromPosition(position)
        if (!location) return
        applyGpsLocation(location, getActiveTripId())
      },
      (error) => {
        if (Number(error?.code) === 1) {
          setLocationPermission('denied')
        } else {
          setLocationPermission('prompt')
        }
        setIsTracking(false)
        if (heartbeatIntervalRef.current !== null) {
          clearInterval(heartbeatIntervalRef.current)
          heartbeatIntervalRef.current = null
        }
        if (Number(error?.code) === 1) {
          toast.error('Location permission denied. Please enable location access.')
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    )

    watchIdRef.current = watchId
    heartbeatIntervalRef.current = setInterval(() => {
      void (async () => {
        try {
          const position = await readCurrentPosition({ enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 })
          const location = gpsFromPosition(position)
          if (!location) return
          const activeTripId = getActiveTripId()
          if (activeTripId) {
            void sendLocationUpdate(location, activeTripId)
            lastLocationUploadAtRef.current = Date.now()
          }
          applyGpsLocation(location, activeTripId)
        } catch {
          // heartbeat is best-effort
        }
      })()
    }, 20000)
    toast.success('Location tracking started')
    return true
  }

  const stopLocationTracking = useCallback(() => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (heartbeatIntervalRef.current !== null) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
    setIsTracking(false)
  }, [])

  // Auto-start tracking when driver opens a specific trip so current location is visible/saved without extra taps.
  useEffect(() => {
    const sourceTrips = latestTripsRef.current.length > 0 ? latestTripsRef.current : trips
    const selectedTrip = selectedTripId
      ? sourceTrips.find((trip) => String(trip.id || '') === String(selectedTripId || '')) || null
      : null
    const normalizedStatus = String(selectedTrip?.status || '').toUpperCase()
    const isTrackable = normalizedStatus === 'PLANNED' || normalizedStatus === 'IN_PROGRESS' || normalizedStatus === 'IN_TRANSIT' || normalizedStatus === 'OUT_FOR_DELIVERY'
    if (!selectedTripId || !selectedTrip || !isTrackable) return
    if (locationPermission === 'denied') return
    if (watchIdRef.current !== null) return
    if (autoTrackingTripIdRef.current === selectedTripId) return

    autoTrackingTripIdRef.current = selectedTripId
    void startLocationTracking()
  }, [selectedTripId, trips, locationPermission])

  // Keep tracking alive while any trip is in progress; stop only when all active trips are done.
  useEffect(() => {
    if (trackingLifecycleLockRef.current) return
    const sourceTrips = latestTripsRef.current.length > 0 ? latestTripsRef.current : trips
    const hasInProgressTrip = sourceTrips.some((trip) => {
      const status = String(trip?.status || '').toUpperCase()
      return status === 'IN_PROGRESS' || status === 'IN_TRANSIT' || status === 'OUT_FOR_DELIVERY'
    })

    if (hasInProgressTrip) {
      if (locationPermission === 'denied') return
      if (watchIdRef.current !== null) {
        setIsTracking(true)
        return
      }
      trackingLifecycleLockRef.current = true
      void startLocationTracking().finally(() => {
        trackingLifecycleLockRef.current = false
      })
      return
    }

    if (watchIdRef.current !== null || heartbeatIntervalRef.current !== null || isTracking) {
      stopLocationTracking()
    }
  }, [trips, locationPermission, isTracking, stopLocationTracking])

  // Clears geolocation watch on unmount.
  useEffect(() => {
    return () => {
      stopLocationTracking()
    }
  }, [stopLocationTracking])

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
