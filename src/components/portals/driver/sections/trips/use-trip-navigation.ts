import { useCallback, useEffect, useMemo } from 'react'
import { type DriverRouteOption, NAVIGATION_OFF_ROUTE_METERS, NAVIGATION_MANEUVER_PASSED_MARGIN_METERS } from './trip-navigation-config'
import { stopDriverNavigationSpeech } from '@/lib/native/driver-speech'
import { projectPointOntoRoute, shouldRefreshDriverRoute, selectFollowedRoute } from '@/lib/map-navigation'
import { toast } from 'sonner'
import { DriverGpsLocation, DropPoint, stripPhilippinesFromAddress, Trip } from './trip-detail-helpers'
import { haversineKm } from './trip-route-geometry'
import { type OsrmStep } from '@/components/shared/NavInstructionsPanel'
import { getItemDisplayNameWithSize, getOrderQtyWithUnitLabel, speakNavigationPrompt, buildVoicePrompt } from './trip-detail-format'
import { toRecordedAtMs, toCoordinate, isDropPointDone, MAX_REAL_CURRENT_LOCATION_AGE_MS, isValidDeviceCoordinate, isFreshRecordedAt, formatLocationAge, getFreshDriverLocation } from './trip-detail-location'
import type { Dispatch, SetStateAction, MutableRefObject } from 'react'

/**
 * Live navigation for a trip: which stop is next, where the driver actually is (device fix, preview, or last trip log), the OSRM route and its alternatives, ETA anchoring, maneuver tracking, and the map centre/recenter behaviour.
 */
export type TripNavigationInputs = {
  activeRouteOptionIndex: number
  currentLocation: DriverGpsLocation | null
  currentStepIndex: number
  isTracking: boolean
  mobileMapRecenterCenter: [number, number] | null
  navigationRouteAbortRef: MutableRefObject<AbortController | null>
  navigationRouteCheckEpoch: number
  navigationRouteLastRequestAtRef: MutableRefObject<number>
  navigationRouteOrigin: { tripId: string; lat: number; lng: number; revision: number } | null
  navigationRouteRequestInFlightRef: MutableRefObject<boolean>
  navigationRouteRetryAtRef: MutableRefObject<number>
  navigationRouteSelectionEpochRef: MutableRefObject<number>
  navigationStopsKeyRef: MutableRefObject<string>
  previewDriverLocation: DriverGpsLocation | null
  routeOptions: DriverRouteOption[]
  routeSteps: OsrmStep[]
  setActiveRouteOptionIndex: Dispatch<SetStateAction<number>>
  setCurrentStepIndex: Dispatch<SetStateAction<number>>
  setIs3DPerspective: Dispatch<SetStateAction<boolean>>
  setMobileMapRecenterCenter: Dispatch<SetStateAction<[number, number] | null>>
  setMobileMapRecenterSignal: Dispatch<SetStateAction<number>>
  setNavigationRouteOrigin: Dispatch<SetStateAction<{ tripId: string; lat: number; lng: number; revision: number } | null>>
  setPreviewDriverLocation: Dispatch<SetStateAction<DriverGpsLocation | null>>
  setRouteOptions: Dispatch<SetStateAction<DriverRouteOption[]>>
  setRouteSteps: Dispatch<SetStateAction<OsrmStep[]>>
  sortedDropPoints: DropPoint[]
  spokenNavigationPromptsRef: MutableRefObject<Set<string>>
  trip: Trip
  voiceGuidanceEnabled: boolean
}

export function useTripNavigation(inputs: TripNavigationInputs) {
  const {
    activeRouteOptionIndex,
    currentLocation,
    currentStepIndex,
    isTracking,
    mobileMapRecenterCenter,
    navigationRouteAbortRef,
    navigationRouteCheckEpoch,
    navigationRouteLastRequestAtRef,
    navigationRouteOrigin,
    navigationRouteRequestInFlightRef,
    navigationRouteRetryAtRef,
    navigationRouteSelectionEpochRef,
    navigationStopsKeyRef,
    previewDriverLocation,
    routeOptions,
    routeSteps,
    setActiveRouteOptionIndex,
    setCurrentStepIndex,
    setIs3DPerspective,
    setMobileMapRecenterCenter,
    setMobileMapRecenterSignal,
    setNavigationRouteOrigin,
    setPreviewDriverLocation,
    setRouteOptions,
    setRouteSteps,
    sortedDropPoints,
    spokenNavigationPromptsRef,
    trip,
    voiceGuidanceEnabled,
  } = inputs

  const mappableDropPoints = sortedDropPoints
    .map((point) => {
      const latitude = toCoordinate(point.latitude)
      const longitude = toCoordinate(point.longitude)
      return {
        ...point,
        latitude,
        longitude,
      }
    })
    .filter((point) => point.latitude !== null && point.longitude !== null)
  const nextPendingIndex = mappableDropPoints.findIndex((point) => !isDropPointDone(point.status))
  const completedDropPoints =
    nextPendingIndex === -1 ? mappableDropPoints : mappableDropPoints.slice(0, Math.max(nextPendingIndex, 0))
  const pendingDropPoints =
    nextPendingIndex === -1 ? [] : mappableDropPoints.slice(Math.max(nextPendingIndex, 0))
  // Route/mapping derived values for start point, live driver marker, and waypoints.
  const warehouseRouteStart = (() => {
    // Fix: only the assigned warehouse can supply the trip origin.
    const warehouseLat =
      toCoordinate(trip.warehouseLatitude) ??
      toCoordinate(trip.warehouse?.latitude)
    const warehouseLng =
      toCoordinate(trip.warehouseLongitude) ??
      toCoordinate(trip.warehouse?.longitude)
    if (warehouseLat === null || warehouseLng === null) return null
    return { lat: warehouseLat, lng: warehouseLng }
  })()
  const normalizedTripStatus = String(trip.status || '').toUpperCase()
  useEffect(() => {
    // Fix: muting or ending navigation must stop native audio as well as browser audio.
    if (!voiceGuidanceEnabled || normalizedTripStatus !== 'IN_PROGRESS') stopDriverNavigationSpeech()
  }, [voiceGuidanceEnabled, normalizedTripStatus])
  const hasNearbyDropPointForWarehouseStart = warehouseRouteStart
    ? mappableDropPoints.some((point) =>
      haversineKm(
        { lat: warehouseRouteStart.lat, lng: warehouseRouteStart.lng },
        { lat: Number(point.latitude), lng: Number(point.longitude) }
      ) <= 60
    )
    : false
  const nextDropPoint = mappableDropPoints.find((point) => String(point.status || '').toUpperCase() !== 'COMPLETED' && String(point.status || '').toUpperCase() !== 'DELIVERED') || mappableDropPoints[0] || null
  const latestTripLocationAny = (() => {
    const src = (trip as any)?.latestLocation
    if (!src) return null
    const lat = toCoordinate(src?.latitude ?? src?.lat)
    const lng = toCoordinate(src?.longitude ?? src?.lng)
    if (lat === null || lng === null || !isValidDeviceCoordinate(lat, lng)) return null
    return {
      lat,
      lng,
      accuracy: toCoordinate(src?.accuracy),
      heading: toCoordinate(src?.heading),
      speed: toCoordinate(src?.speed),
      recordedAt: src?.recordedAt || src?.recorded_at || src?.createdAt || src?.created_at || null,
    }
  })()
  // Use fresh device GPS first, then only the account-scoped latest location
  // returned by the driver API. Trip waypoints and warehouse coordinates must
  // never become a fallback driver position.
  const liveDeviceLocation = currentLocation
    && isValidDeviceCoordinate(Number(currentLocation.lat), Number(currentLocation.lng))
    && isFreshRecordedAt(currentLocation.recordedAt, MAX_REAL_CURRENT_LOCATION_AGE_MS)
    ? currentLocation
    : null
  const livePreviewLocation = previewDriverLocation
    && isValidDeviceCoordinate(Number(previewDriverLocation.lat), Number(previewDriverLocation.lng))
    && isFreshRecordedAt(previewDriverLocation.recordedAt, MAX_REAL_CURRENT_LOCATION_AGE_MS)
    ? previewDriverLocation
    : null
  const effectiveDriverLocation = liveDeviceLocation || livePreviewLocation || latestTripLocationAny || null
  // Fix: the API row is only a last-known fix - it carries no freshness
  // guarantee, so once the device stops reporting the truck used to sit on an
  // hours-old coordinate that looked exactly like a live one.
  const isLiveDriverLocation = Boolean(liveDeviceLocation || livePreviewLocation)
    || isFreshRecordedAt(latestTripLocationAny?.recordedAt, MAX_REAL_CURRENT_LOCATION_AGE_MS)
  const driverLocationAgeMs = (() => {
    if (isLiveDriverLocation) return null
    const ts = toRecordedAtMs(effectiveDriverLocation?.recordedAt)
    return ts === null ? null : Math.max(Date.now() - ts, 0)
  })()

  useEffect(() => {
    if (
      !voiceGuidanceEnabled ||
      normalizedTripStatus !== 'IN_PROGRESS' ||
      routeSteps.length === 0
    ) {
      return
    }

    const currentStep = routeSteps[currentStepIndex] || null
    const upcomingStep = routeSteps[currentStepIndex + 1] || null

    if (currentStepIndex === 0 && currentStep) {
      const startKey = `start:${trip.id}:${currentStepIndex}`
      if (!spokenNavigationPromptsRef.current.has(startKey)) {
        spokenNavigationPromptsRef.current.add(startKey)
        speakNavigationPrompt(`Navigation started. ${buildVoicePrompt(currentStep, { immediate: true })}.`)
      }
    }

    if (!effectiveDriverLocation) {
      return
    }

    if (upcomingStep) {
      const distanceToUpcomingMeters =
        haversineKm(effectiveDriverLocation, {
          lat: upcomingStep.maneuver.location[1],
          lng: upcomingStep.maneuver.location[0],
        }) * 1000

      if (distanceToUpcomingMeters <= 180) {
        const prepKey = `prep:${trip.id}:${currentStepIndex + 1}`
        if (!spokenNavigationPromptsRef.current.has(prepKey)) {
          spokenNavigationPromptsRef.current.add(prepKey)
          speakNavigationPrompt(buildVoicePrompt(upcomingStep, { distanceMeters: distanceToUpcomingMeters }))
        }
      }

      if (distanceToUpcomingMeters <= 40) {
        const nowKey = `now:${trip.id}:${currentStepIndex + 1}`
        if (!spokenNavigationPromptsRef.current.has(nowKey)) {
          spokenNavigationPromptsRef.current.add(nowKey)
          speakNavigationPrompt(buildVoicePrompt(upcomingStep, { immediate: true }))
        }
      }

      return
    }

    if (currentStep) {
      const distanceToCurrentMeters =
        haversineKm(effectiveDriverLocation, {
          lat: currentStep.maneuver.location[1],
          lng: currentStep.maneuver.location[0],
        }) * 1000
      if (distanceToCurrentMeters <= 50) {
        const finalKey = `final:${trip.id}:${currentStepIndex}`
        if (!spokenNavigationPromptsRef.current.has(finalKey)) {
          spokenNavigationPromptsRef.current.add(finalKey)
          speakNavigationPrompt(buildVoicePrompt(currentStep, { finalPrompt: true }))
        }
      }
    }
  }, [
    voiceGuidanceEnabled,
    normalizedTripStatus,
    effectiveDriverLocation,
    routeSteps,
    currentStepIndex,
    trip.id,
  ])

  const driverMarkerHeading =
    typeof effectiveDriverLocation?.heading === 'number' &&
    Number.isFinite(effectiveDriverLocation.heading) &&
    effectiveDriverLocation.heading >= 0
      ? effectiveDriverLocation.heading
      : undefined

  // A stale or coarse fix must read as such: a 100 m wifi fix can sit kilometres
  // from the driver, and unlabelled it looks like a live GPS position.
  const driverLocationMarkerLabel = (() => {
    const accuracy = Number(effectiveDriverLocation?.accuracy)
    const accuracySuffix = Number.isFinite(accuracy) ? ` +- ${Math.round(accuracy)} m` : ''
    if (!isLiveDriverLocation) {
      const age = driverLocationAgeMs === null ? '' : ` ${formatLocationAge(driverLocationAgeMs)}`
      return `Last known location${age}${accuracySuffix}`
    }
    return `Current location${accuracySuffix}`
  })()

  const driverLocationMarker = (() => {
    const sourceLocation = effectiveDriverLocation
    // Never represent the warehouse/start point as the driver's live position.
    if (!sourceLocation) return null
    const lat = toCoordinate(sourceLocation?.lat)
    const lng = toCoordinate(sourceLocation?.lng)
    if (lat === null || lng === null) return null
    return {
      id: `driver-${trip.id}`,
      driverName: 'You (Driver)',
      vehiclePlate: trip.vehicle?.licensePlate || 'Vehicle',
      lat,
      lng,
      status: isTracking ? 'IN_PROGRESS' : (trip.status || 'PLANNED'),
      markerLabel: driverLocationMarkerLabel,
      markerType: 'truck' as const,
      markerHeading: driverMarkerHeading ?? undefined,
      markerColor: '#1d4ed8',
      // Added: keep the driver's navigation popup consistent with live tracking.
      assignedTripNumber: trip.tripNumber || '',
      destinationCustomer: nextDropPoint?.locationName || nextDropPoint?.contactName || 'N/A',
      accuracyMeters: Number.isFinite(Number(sourceLocation.accuracy))
        ? Number(sourceLocation.accuracy)
        : undefined,
      // Ground speed lets the map extrapolate between fixes rather than only
      // animating toward a position the driver has already left.
      // Fix: an unavailable speed sensor must not freeze a moving GPS position as "parked".
      speedMps: sourceLocation.speed != null && Number.isFinite(Number(sourceLocation.speed)) && Number(sourceLocation.speed) >= 0
        ? Number(sourceLocation.speed)
        : undefined,
    }
  })()

  // Do not calculate driver ETA from the warehouse when this account has no location.
  const etaStartPoint = driverLocationMarker
    ? { lat: driverLocationMarker.lat, lng: driverLocationMarker.lng }
    : null
  let etaAnchor = etaStartPoint
  let pendingPhaseIndex = 0
  const dropPointMapLocations = mappableDropPoints.map((point) => {
    const normalizedDropPointStatus = String(point.status || '').toUpperCase()
    const normalizedOrderStatus = String(point?.order?.status || '').toUpperCase()
    const isCancelledLike = ['FAILED', 'CANCELLED', 'CANCELED', 'SKIPPED'].includes(normalizedDropPointStatus)
      || ['FAILED', 'CANCELLED', 'CANCELED'].includes(normalizedOrderStatus)
    const isRescheduledLike = Boolean(point?.rescheduleRequested)
      || normalizedDropPointStatus === 'RESCHEDULED'
      || normalizedOrderStatus === 'RESCHEDULED'
    const isCompleted = isDropPointDone(point.status)
    let markerEta: string | undefined
    let markerEtaPhase: 'completed' | 'next' | 'upcoming' | undefined

    if (isCompleted) {
      markerEta = 'Arrived'
      markerEtaPhase = 'completed'
    } else if (etaAnchor) {
      const target = { lat: point.latitude as number, lng: point.longitude as number }
      etaAnchor = target
      markerEtaPhase = pendingPhaseIndex === 0 ? 'next' : 'upcoming'
      pendingPhaseIndex += 1
    }

    return {
      id: point.id,
      driverName: point.locationName || `Stop ${point.sequence}`,
      vehiclePlate: trip.vehicle?.licensePlate || 'Vehicle',
      lat: point.latitude as number,
      lng: point.longitude as number,
      status: point.status || 'PENDING',
      markerLabel: `${point.sequence}. ${stripPhilippinesFromAddress(point.address) || point.city || 'Drop Point'}`,
      markerType: 'pin' as const,
      markerColor: isCancelledLike ? '#ef4444' : (isRescheduledLike ? '#f59e0b' : '#2563eb'),
      markerNumber: point.sequence,
      markerEta,
      markerEtaPhase,
      popupCustomerName: point.locationName || point.contactName || `Stop ${point.sequence}`,
      popupAddress: stripPhilippinesFromAddress(point.address) || point.city || '',
      popupOrderItems: (point.order?.items || []).map((item: any) => ({
        name: getItemDisplayNameWithSize(item),
        qty: getOrderQtyWithUnitLabel(item, point.order),
      })),
    }
  })

  const mapLocations = driverLocationMarker ? [driverLocationMarker, ...dropPointMapLocations] : dropPointMapLocations
  const exactDriverLocationSource = effectiveDriverLocation
  const exactDriverLocationLabel = exactDriverLocationSource
    ? `${Number(exactDriverLocationSource.lat).toFixed(6)}, ${Number(exactDriverLocationSource.lng).toFixed(6)}`
      + (isLiveDriverLocation
        ? ''
        : ` (last known${driverLocationAgeMs === null ? '' : ` ${formatLocationAge(driverLocationAgeMs)}`})`)
    : null
  const currentVehicleSpeedMps = toCoordinate(effectiveDriverLocation?.speed)
  // Geolocation reports speed in m/s; keep unavailable sensor data explicit.
  const currentVehicleSpeedLabel = currentVehicleSpeedMps !== null && currentVehicleSpeedMps >= 0
    ? `${Math.round(currentVehicleSpeedMps * 3.6)} km/h`
    : '-- km/h'

  const navigationStopsKey = pendingDropPoints.map((point) => `${point.id}:${point.latitude},${point.longitude}`).join('|')
  useEffect(() => {
    if (!driverLocationMarker) return
    // Fix: following a light-blue road promotes it before requesting new geometry.
    const followedIndex = selectFollowedRoute(
      [driverLocationMarker.lat, driverLocationMarker.lng], routeOptions.map((option) => option.points),
      activeRouteOptionIndex, driverLocationMarker.markerHeading
    )
    if (followedIndex !== activeRouteOptionIndex) {
      navigationRouteSelectionEpochRef.current += 1
      navigationRouteAbortRef.current?.abort()
      navigationRouteRequestInFlightRef.current = false
      setActiveRouteOptionIndex(followedIndex)
      return
    }
    // Fix: a newly completed or changed stop starts its next route at the current GPS fix.
    const stopsChanged = navigationStopsKeyRef.current !== navigationStopsKey
    navigationStopsKeyRef.current = navigationStopsKey
    const nextOrigin = {
      tripId: trip.id,
      lat: driverLocationMarker.lat,
      lng: driverLocationMarker.lng,
      revision: (navigationRouteOrigin?.revision || 0) + 1,
    }
    setNavigationRouteOrigin((previous) => {
      if (!previous || previous.tripId !== trip.id || stopsChanged) return nextOrigin
      const activeRoutePoints = routeOptions[activeRouteOptionIndex]?.points
      return shouldRefreshDriverRoute({
        point: [nextOrigin.lat, nextOrigin.lng], route: activeRoutePoints || [],
        heading: driverLocationMarker.markerHeading, speed: effectiveDriverLocation?.speed,
        inFlight: navigationRouteRequestInFlightRef.current || Date.now() < navigationRouteRetryAtRef.current,
        elapsedMs: Date.now() - navigationRouteLastRequestAtRef.current,
      }) ? nextOrigin : previous
    })
  }, [trip.id, driverLocationMarker?.lat, driverLocationMarker?.lng, driverLocationMarker?.markerHeading, navigationStopsKey, navigationRouteCheckEpoch, routeOptions, activeRouteOptionIndex])

  const fullRouteWaypoints = (() => {
    const start = warehouseRouteStart ? [warehouseRouteStart] : []
    const completedCoords = completedDropPoints.map((point) => ({ lat: point.latitude as number, lng: point.longitude as number }))
    const pendingCoords = pendingDropPoints.map((point) => ({ lat: point.latitude as number, lng: point.longitude as number }))
    if (driverLocationMarker) {
      return [...start, ...completedCoords, { lat: driverLocationMarker.lat, lng: driverLocationMarker.lng }, ...pendingCoords]
    }
    return [...start, ...completedCoords, ...pendingCoords]
  })()
  const routeWaypoints = fullRouteWaypoints
  // Keep the origin stable until the driver needs a replacement route.
  // Must be declared before the route waypoint builders that reference it.
  const savedNavigationOrigin = navigationRouteOrigin
  const stableNavigationOrigin = savedNavigationOrigin && savedNavigationOrigin.tripId === trip.id
    ? { lat: savedNavigationOrigin.lat, lng: savedNavigationOrigin.lng }
    : driverLocationMarker
      ? { lat: driverLocationMarker.lat, lng: driverLocationMarker.lng }
      : null
  const upcomingRouteWaypoints = (() => {
    const pendingCoords = pendingDropPoints.map((point) => ({ lat: point.latitude as number, lng: point.longitude as number }))
    // Use the stable origin to avoid restarting route requests for every GPS fix.
    if (stableNavigationOrigin) return [stableNavigationOrigin, ...pendingCoords]
    return pendingCoords
  })()
  // Fix: every trip route starts at the warehouse; GPS is an intermediate waypoint for detours.
  const navigationRouteWaypoints = warehouseRouteStart ? [
    warehouseRouteStart,
    ...completedDropPoints.map((point) => ({ lat: point.latitude as number, lng: point.longitude as number })),
    ...(stableNavigationOrigin ? [stableNavigationOrigin] : []),
    ...pendingDropPoints.map((point) => ({ lat: point.latitude as number, lng: point.longitude as number })),
  ] : []
  const navigationWaypointsKey = `${trip.id}:${navigationRouteOrigin?.revision || 0}:` + navigationRouteWaypoints
    .map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
    .join('|')

  useEffect(() => {
    const uniqueWaypoints = navigationRouteWaypoints.filter((point, index, list) => {
      if (index === 0) return true
      const previous = list[index - 1]
      return !(Math.abs(point.lat - previous.lat) < 0.000001 && Math.abs(point.lng - previous.lng) < 0.000001)
    })

    if (uniqueWaypoints.length < 2) {
      setRouteOptions([])
      setActiveRouteOptionIndex(0)
      setRouteSteps([])
      setCurrentStepIndex(0)
      return
    }

    let cancelled = false
    let retryTimeoutId: number | null = null
    let activeController: AbortController | null = null
    const selectionEpoch = navigationRouteSelectionEpochRef.current

    const run = async (attemptNumber: number) => {
      // Fix: a delayed retry must not replace a route selected since this request began.
      if (cancelled || selectionEpoch !== navigationRouteSelectionEpochRef.current) return
      // Fix: each retry needs a fresh signal after a previous request times out.
      const controller = new AbortController()
      activeController = controller
      navigationRouteAbortRef.current = controller
      navigationRouteRequestInFlightRef.current = true
      navigationRouteRetryAtRef.current = 0
      navigationRouteLastRequestAtRef.current = Date.now()
      // Shared fetch owns timeouts and recovery; keep this signal for route changes/unmounts.
      try {
        const coordinates = uniqueWaypoints
          .map((point) => `${encodeURIComponent(String(point.lng))},${encodeURIComponent(String(point.lat))}`)
          .join(';')
        // Fix: a U-turn must leave the GPS waypoint in the driver's current direction.
        const gpsWaypointIndex = uniqueWaypoints.findIndex((point) => point.lat === stableNavigationOrigin?.lat && point.lng === stableNavigationOrigin?.lng)
        const bearingQuery = attemptNumber === 0 && gpsWaypointIndex >= 0 && driverMarkerHeading !== undefined
          && Number(effectiveDriverLocation?.speed) > 1
          ? `&bearings=${uniqueWaypoints.map((_, index) => index === gpsWaypointIndex ? `${Math.round(driverMarkerHeading)},60` : '').join(';')}&continue_straight=true`
          : ''
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true&alternatives=3${bearingQuery}`,
          { signal: controller.signal }
        )
        const payload = await response.json().catch(() => ({}))
        // Fix: a slow response cannot replace a route the driver has already selected/followed.
        if (cancelled || selectionEpoch !== navigationRouteSelectionEpochRef.current) return
        const rawRoutes = Array.isArray(payload?.routes) ? [...payload.routes] : []

        // OSRM may return no native alternatives. Ask it for two modestly shaped
        // road routes while keeping every real delivery coordinate as a waypoint.
        if (response.ok && rawRoutes.length < 3 && uniqueWaypoints.length >= 2 && !routeOptions.length && !isTracking) {
          const start = uniqueWaypoints[0]
          const firstStop = uniqueWaypoints[1]
          const midpoint = {
            lat: (start.lat + firstStop.lat) / 2,
            lng: (start.lng + firstStop.lng) / 2,
          }
          const longitudeScale = Math.max(Math.cos((midpoint.lat * Math.PI) / 180), 0.1)
          const dx = (firstStop.lng - start.lng) * longitudeScale
          const dy = firstStop.lat - start.lat
          const straightLength = Math.hypot(dx, dy)
          const offsetDegrees = Math.min(Math.max(haversineKm(start, firstStop) * 0.18, 0.5), 2.0) / 111

          if (straightLength > 0) {
            const detourPoints = [-1, 1].map((direction) => ({
              lat: midpoint.lat + direction * (dx / straightLength) * offsetDegrees,
              lng: midpoint.lng - direction * (dy / straightLength) * offsetDegrees / longitudeScale,
            }))
            const shapedRoutes = await Promise.all(detourPoints.map(async (detourPoint) => {
              const shapedCoordinates = [start, detourPoint, ...uniqueWaypoints.slice(1)]
                .map((point) => `${encodeURIComponent(String(point.lng))},${encodeURIComponent(String(point.lat))}`)
                .join(';')
              // Index 1 is a silent shaping coordinate, so instructions still reference only actual stops.
              const waypointIndexes = [0, ...Array.from({ length: uniqueWaypoints.length - 1 }, (_, index) => index + 2)]
                .join(';')
              try {
                const shapedResponse = await fetch(
                  `https://router.project-osrm.org/route/v1/driving/${shapedCoordinates}?overview=full&geometries=geojson&steps=true&alternatives=true&waypoints=${encodeURIComponent(waypointIndexes)}`,
                  { signal: controller.signal }
                )
                const shapedPayload = await shapedResponse.json().catch(() => ({}))
                return shapedResponse.ok && Array.isArray(shapedPayload?.routes) ? shapedPayload.routes : null
              } catch {
                return null
              }
            }))
            const recommendedDistance = Math.max(Number(rawRoutes[0]?.distance || 0), 1)
            const routeKeys = new Set(rawRoutes.map((route: any) => JSON.stringify(route?.geometry?.coordinates || [])))
            shapedRoutes.flat().filter(Boolean).forEach((route: any) => {
              const routeKey = JSON.stringify(route?.geometry?.coordinates || [])
              const routeDistance = Number(route?.distance || 0)
              if (
                routeKey !== '[]' &&
                !routeKeys.has(routeKey) &&
                routeDistance > 0 &&
                routeDistance <= recommendedDistance * 1.5
              ) {
                routeKeys.add(routeKey)
                rawRoutes.push(route)
              }
            })
          }
        }

        // Added: keep all returned routes so the driver can choose an alternative without changing the stop order.
        const normalizedOptions: DriverRouteOption[] = rawRoutes
          .map((route: any, routeIndex: number) => {
            const legs = Array.isArray(route?.legs) ? route.legs : []
            // Fix: warehouse legs remain visible, but only legs ahead of GPS drive the truck and instructions.
            const navigationLegIndex = Math.max(0, gpsWaypointIndex)
            const legPoints = (selectedLegs: any[]): [number, number][] => selectedLegs
              .flatMap((leg: any) => (leg.steps || []).flatMap((step: any) => step.geometry?.coordinates || []))
              .map((pair: any) => [Number(pair?.[1]), Number(pair?.[0])] as [number, number])
              .filter((point: [number, number], index: number, points: [number, number][]) =>
                Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
                (index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]))
            const points = legPoints(legs.slice(navigationLegIndex))
            const originPoints = legPoints(legs.slice(0, navigationLegIndex))
            // Color the next drop independently from the later delivery legs.
            const activeLegPoints = legPoints(legs.slice(navigationLegIndex, navigationLegIndex + 1))
            const futureLegPoints = legPoints(legs.slice(navigationLegIndex + 1))
            const steps: OsrmStep[] = legs.slice(navigationLegIndex)
              .flatMap((leg: any) => (Array.isArray(leg?.steps) ? leg.steps : []))
              .map((step: any) => ({
                maneuver: {
                  type: String(step?.maneuver?.type || '').trim(),
                  modifier: step?.maneuver?.modifier ? String(step.maneuver.modifier).trim() : undefined,
                  location: [
                    Number(step?.maneuver?.location?.[0]),
                    Number(step?.maneuver?.location?.[1]),
                  ] as [number, number],
                },
                name: String(step?.name || '').trim(),
                distance: Number(step?.distance || 0),
                duration: Number(step?.duration || 0),
                driving_side: step?.driving_side ? String(step.driving_side).trim() : undefined,
              }))
              .filter(
                (step: OsrmStep) =>
                  step.maneuver.type &&
                  Number.isFinite(step.maneuver.location[0]) &&
                  Number.isFinite(step.maneuver.location[1])
              )
            return { id: String(routeIndex), points, originPoints, activeLegPoints, futureLegPoints, steps }
          })
          .filter((route: DriverRouteOption) => route.points.length > 1)

        // Keep the last known-good route on an empty/failed response instead of
        // wiping it — a transient OSRM hiccup should not blank the driver's map
        // or make the vehicle marker disappear mid-trip.
        if (!cancelled && selectionEpoch === navigationRouteSelectionEpochRef.current && normalizedOptions.length > 0) {
          setRouteOptions(normalizedOptions)
          // Fix: alternative indexes belong to the previous response, not to a rerouted trip.
          setActiveRouteOptionIndex(0)
          setCurrentStepIndex(0)
        } else if (!cancelled && selectionEpoch === navigationRouteSelectionEpochRef.current && attemptNumber < 2) {
          navigationRouteRetryAtRef.current = Date.now() + 2500
          // Fix: retry failed reroutes too, even when an older route is still visible.
          retryTimeoutId = window.setTimeout(() => {
            if (!cancelled) void run(attemptNumber + 1)
          }, 2500)
        }
      } catch {
        if (!cancelled && selectionEpoch === navigationRouteSelectionEpochRef.current) navigationRouteRetryAtRef.current = Date.now() + 2500
        if (!cancelled && selectionEpoch === navigationRouteSelectionEpochRef.current && attemptNumber < 2) {
          retryTimeoutId = window.setTimeout(() => {
            if (!cancelled) void run(attemptNumber + 1)
          }, 2500)
        }
      } finally {
        if (!cancelled && navigationRouteAbortRef.current === controller) navigationRouteRequestInFlightRef.current = false
      }
    }

    void run(0)

    return () => {
      cancelled = true
      activeController?.abort()
      navigationRouteRequestInFlightRef.current = false
      if (retryTimeoutId !== null) window.clearTimeout(retryTimeoutId)
    }
  }, [navigationWaypointsKey])

  useEffect(() => {
    const activeOption = routeOptions[activeRouteOptionIndex]
    setRouteSteps(activeOption?.steps || [])
    setCurrentStepIndex(0)
    spokenNavigationPromptsRef.current.clear()
  }, [activeRouteOptionIndex, routeOptions])

  const upcomingRoutePoints = navigationRouteWaypoints.map(
    (point) => [point.lat, point.lng] as [number, number]
  )
  const activeRouteOption = routeOptions[activeRouteOptionIndex] || null

  // Along-route distance to each maneuver equals the summed length of every step
  // before it. Shared by step advancement and the live distance-to-turn readout
  // so the instruction, its countdown and the vehicle icon read one position.
  const maneuverCumulativeDistances = useMemo(() => {
    const distances: number[] = []
    let cumulative = 0
    routeSteps.forEach((step, index) => {
      distances[index] = cumulative
      cumulative += step.distance || 0
    })
    return distances
  }, [routeSteps])

  // Project the live driver position onto the active route once per render.
  const navigationRouteProjection = useMemo(() => {
    const geometry = activeRouteOption?.points
    if (!effectiveDriverLocation || !geometry || geometry.length < 2) return null
    return projectPointOntoRoute(
      [Number(effectiveDriverLocation.lat), Number(effectiveDriverLocation.lng)],
      geometry
    )
  }, [activeRouteOption, effectiveDriverLocation])

  // Advance the active turn-by-turn step from real progress along the route.
  // Measuring distance travelled along the route — rather than a fixed radius
  // around the next maneuver — keeps the instruction correct when GPS updates
  // are sparse and the driver passes a maneuver between fixes, and lets several
  // maneuvers clear at once instead of lagging a fix behind.
  useEffect(() => {
    if (routeSteps.length === 0) return
    // Only trust a projection taken on the geometry these steps belong to,
    // otherwise a reroute's new geometry could be measured with old steps.
    if (!navigationRouteProjection || activeRouteOption?.steps !== routeSteps) return
    if (navigationRouteProjection.distanceFromRouteMeters > NAVIGATION_OFF_ROUTE_METERS) return
    const driverDistance = navigationRouteProjection.distanceAlongMeters
    let travelingIndex = 0
    for (let index = 0; index < routeSteps.length - 1; index += 1) {
      const nextManeuverDistance = maneuverCumulativeDistances[index] + (routeSteps[index].distance || 0)
      if (driverDistance >= nextManeuverDistance - NAVIGATION_MANEUVER_PASSED_MARGIN_METERS) {
        travelingIndex = index + 1
      } else {
        break
      }
    }
    // Never move the instruction backwards on the same route; a reroute resets
    // the index to 0 when the route options change.
    setCurrentStepIndex((previous) => (travelingIndex > previous ? travelingIndex : previous))
  }, [navigationRouteProjection, routeSteps, activeRouteOption, maneuverCumulativeDistances])

  // The prominent instruction is the maneuver ahead of the segment the driver is
  // on, so a completed turn immediately reveals the next one; its distance
  // counts down live as the driver approaches.
  const upcomingManeuverIndex = routeSteps.length > 0
    ? Math.min(currentStepIndex + 1, routeSteps.length - 1)
    : currentStepIndex
  const liveDistanceToManeuverMeters =
    navigationRouteProjection &&
    navigationRouteProjection.distanceFromRouteMeters <= NAVIGATION_OFF_ROUTE_METERS &&
    typeof maneuverCumulativeDistances[upcomingManeuverIndex] === 'number'
      ? Math.max(0, maneuverCumulativeDistances[upcomingManeuverIndex] - navigationRouteProjection.distanceAlongMeters)
      : undefined

  const handleRouteLineSelect = useCallback((routeLineId: string) => {
    const alternativePrefix = `trip-${trip.id}-route-alternative-`
    if (!routeLineId.startsWith(alternativePrefix)) return
    const optionId = routeLineId.slice(alternativePrefix.length)
    const selectedIndex = routeOptions.findIndex((option) => option.id === optionId)
    if (selectedIndex < 0 || selectedIndex === activeRouteOptionIndex) return
    // Added: promote the tapped light-blue route and its instructions to the active route.
    navigationRouteSelectionEpochRef.current += 1
    navigationRouteAbortRef.current?.abort()
    navigationRouteRequestInFlightRef.current = false
    setActiveRouteOptionIndex(selectedIndex)
  }, [activeRouteOptionIndex, routeOptions, trip.id])
  const mapRouteLines = [
    // Fix: keep the warehouse as the fixed trip origin without snapping a detour onto an earlier leg.
    ...(activeRouteOption && activeRouteOption.originPoints.length > 1 ? [{
      id: `trip-${trip.id}-route-origin`, points: activeRouteOption.originPoints,
      color: '#6b7280', label: `${trip.tripNumber} warehouse origin`, opacity: 1, weight: 8,
      snapToRoad: false, selectable: false,
    }] : []),
    // The map splits the active geometry into traveled and upcoming sections.
    ...routeOptions
      .filter((_, optionIndex) => optionIndex !== activeRouteOptionIndex)
      .map((option) => ({
        id: `trip-${trip.id}-route-alternative-${option.id}`,
        points: option.points,
        color: '#93c5fd',
        label: `${trip.tripNumber} alternative path`,
        opacity: 0.82,
        weight: 6,
        selectable: true,
        preserveExactEndpoints: false,
      })),
    ...(activeRouteOption && activeRouteOption.futureLegPoints.length > 1 ? [{
      id: `trip-${trip.id}-route-future`, points: activeRouteOption.futureLegPoints,
      color: '#93c5fd', label: `${trip.tripNumber} future deliveries`, opacity: 0.82, weight: 6,
      snapToRoad: false, selectable: false,
    }] : []),
    ...((activeRouteOption?.points.length || upcomingRoutePoints.length) > 1
      ? [
        {
          id: `trip-${trip.id}-route-upcoming`,
          // Fix: use the same verified geometry for the truck, route line, and instructions.
          points: activeRouteOption?.activeLegPoints || upcomingRoutePoints,
          color: '#2563eb',
          label: `${trip.tripNumber} upcoming path`,
          opacity: 1,
          weight: 8,
          snapToRoad: !activeRouteOption,
          selectable: Boolean(activeRouteOption),
          // Fix: begin the visible path and truck marker at the routed road position.
          preserveExactEndpoints: false,
        },
      ]
      : []),
  ]
  // Center only on a real, fresh driver GPS position.
  const mapCenter = driverLocationMarker
    ? [driverLocationMarker.lat, driverLocationMarker.lng] as [number, number]
    : null
  const mobileMapCenter = mobileMapRecenterCenter || mapCenter

  // Recenter behavior for mobile map view.
  const handleMobileMapRecenter = async () => {
    // Fix: immediately restore the active 2D/3D default camera on every target
    // button click, without waiting for an optional fresh GPS lookup.
    setMobileMapRecenterSignal((previous) => previous + 1)

    const liveLat = toCoordinate(currentLocation?.lat)
    const liveLng = toCoordinate(currentLocation?.lng)
    const previewLat = toCoordinate(previewDriverLocation?.lat)
    const previewLng = toCoordinate(previewDriverLocation?.lng)

    let targetLat = liveLat ?? previewLat ?? driverLocationMarker?.lat ?? null
    let targetLng = liveLng ?? previewLng ?? driverLocationMarker?.lng ?? null

    if (!Number.isFinite(Number(targetLat)) || !Number.isFinite(Number(targetLng))) {
      const freshLocation = await getFreshDriverLocation()
      if (freshLocation) {
        setPreviewDriverLocation(freshLocation)
        targetLat = freshLocation.lat
        targetLng = freshLocation.lng
      }
    }

    if (!Number.isFinite(Number(targetLat)) || !Number.isFinite(Number(targetLng))) {
      toast.error('Current location unavailable. Enable location to recenter map.')
      return
    }

    const nextCenter: [number, number] = [Number(targetLat), Number(targetLng)]
    setMobileMapRecenterCenter(nextCenter)
  }

  // Added: every perspective toggle resets the map camera instead of preserving
  // a previously panned or zoomed position from the other mode.
  const handleToggleMapPerspective = () => {
    setIs3DPerspective((previous) => !previous)
    setMobileMapRecenterSignal((previous) => previous + 1)
  }

  return {
    currentVehicleSpeedLabel,
    driverLocationMarker,
    exactDriverLocationLabel,
    handleMobileMapRecenter,
    handleRouteLineSelect,
    handleToggleMapPerspective,
    liveDistanceToManeuverMeters,
    mapCenter,
    mapLocations,
    mapRouteLines,
    mobileMapCenter,
  }
}
