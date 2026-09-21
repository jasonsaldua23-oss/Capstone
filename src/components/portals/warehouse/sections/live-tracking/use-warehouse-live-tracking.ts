import { useCallback, useMemo } from 'react'
import type { WarehouseOrderItem, WarehouseTripItem } from '../../warehouse-portal-types'
import { normalizeTripStatus } from '../../warehouse-portal-utils'
import { isDropPointCompleted, isCompletedOrderStatus, isCancelledLikeStatus, isDateMatch } from '../../warehouse-order-helpers'
import type { DriverLocationItem } from '../../warehouse-portal-types'

/**
 * Live-tracking map data: which trips, drop points and driver locations belong to the selected tracking day, and the route lines drawn for them.
 */
export type WarehouseLiveTrackingInputs = {
  driverLocations: DriverLocationItem[]
  scopedOrders: WarehouseOrderItem[]
  scopedTrips: WarehouseTripItem[]
  trackingDate: string
}

const recordedAtMs = (point: any) =>
  new Date(point?.recordedAt || point?.recorded_at || point?.createdAt || point?.created_at || 0).getTime()

// The phone's own ground speed in m/s, forwarded to the map so its motion model
// can tell a parked vehicle from GPS noise: without it the icon reads the wander
// of a standing vehicle as movement and drifts around the stop. A missing or
// negative reading (iOS reports -1 for "unknown") is no reading, not a standstill.
const reportedSpeedMps = (point: any) => {
  const speed = Number(point?.speed)
  return Number.isFinite(speed) && speed >= 0 ? speed : undefined
}

export function useWarehouseLiveTracking(inputs: WarehouseLiveTrackingInputs) {
  const {
    driverLocations,
    scopedOrders,
    scopedTrips,
    trackingDate,
  } = inputs

  const orderMatchesTrackingDay = useCallback((order: WarehouseOrderItem) => {
    if (!trackingDate) return true
    // Strict filter: an order belongs to its scheduled delivery day, not its creation day.
    return isDateMatch(order?.deliveryDate, trackingDate)
  }, [trackingDate])

  const tripMatchesTrackingDay = useCallback((trip: WarehouseTripItem) => {
    if (!trackingDate) return true
    const tripAny = trip as any
    const dropPoints = Array.isArray(tripAny?.dropPoints) ? tripAny.dropPoints : []
    const scheduledDates = [
      tripAny?.tripSchedule,
      ...dropPoints.flatMap((point) => [
        point?.order?.deliveryDate,
        point?.order?.timeline?.deliveryDate,
        point?.deliveryDate,
      ]),
    ].filter(Boolean)
    if (scheduledDates.length > 0) {
      return scheduledDates.some((value) => isDateMatch(value, trackingDate))
    }
    // Legacy trips without order schedules use only their planned start date.
    return isDateMatch(tripAny?.plannedStartAt, trackingDate)
  }, [trackingDate])
  const dropPointMatchesTrackingDay = useCallback((dropPoint: any) => {
    if (!trackingDate) return true
    return [
      dropPoint?.order?.deliveryDate,
      dropPoint?.order?.timeline?.deliveryDate,
      dropPoint?.deliveryDate,
    ].some((value) => isDateMatch(value, trackingDate))
  }, [trackingDate])

  const liveMapData = useMemo(() => {
    const locations: Array<{
      id: string
      driverName: string
      vehiclePlate: string
      lat: number
      lng: number
      status: string
      markerColor?: string
      markerLabel?: string
      markerType?: 'pin' | 'dot' | 'truck' | 'default'
      markerDirection?: 'left' | 'right'
      markerHeading?: number
      markerNumber?: number | string
      speedMps?: number
      assignedTripNumber?: string
      destinationCustomer?: string
    }> = []
    const routeLines: Array<{
      id: string
      points: [number, number][]
      color: string
      label?: string
      opacity?: number
      weight?: number
      dashArray?: string
      snapToRoad?: boolean
    }> = []

    const cancelledOrderIds = new Set(
      scopedOrders
        .filter((order: any) => isCancelledLikeStatus(order?.status))
        .map((order: any) => String(order?.id || '').trim())
        .filter(Boolean)
    )
    const dayOrders = scopedOrders.filter((order: any) => orderMatchesTrackingDay(order) && !isCancelledLikeStatus(order?.status))
    const dayOrderIds = new Set(
      dayOrders.map((order: any) => String(order?.id || '').trim()).filter(Boolean)
    )
    const tripOrderIds = new Set<string>()
    // A driver can hold several trips at once but is only ever in one place, so
    // the trip loop below must emit a single marker for them. Without this, every
    // extra trip pushed another marker with the same `driver-<id>` key and React
    // discarded all but one of them.
    const driverMarkerSlots = new Map<string, { index: number; recordedAt: number }>()
    const latestDriverPointById = new Map<string, any>(
      driverLocations
        .map((location: any) => [String(location?.driverId || '').trim(), location] as const)
        .filter(([driverId]) => Boolean(driverId))
    )

    scopedTrips
      .filter(
        (trip: any) =>
          ['IN_PROGRESS'].includes(normalizeTripStatus(trip?.status)) && tripMatchesTrackingDay(trip)
      )
      .forEach((trip: any) => {
        const tripMatchesDay = tripMatchesTrackingDay(trip)
        const toCoordinate = (value: unknown) => {
          const parsed = Number(value)
          return Number.isFinite(parsed) ? parsed : null
        }
        const allEligibleDropPoints = (trip.dropPoints || [])
          .filter((point: any) => {
            const orderId = String(point?.orderId || '').trim()
            if (orderId && cancelledOrderIds.has(orderId)) return false
            if (isCancelledLikeStatus(point?.status) || isCancelledLikeStatus(point?.orderStatus) || isCancelledLikeStatus(point?.order?.status)) return false
            return true
          })
          .filter((point: any) => typeof point?.latitude === 'number' && typeof point?.longitude === 'number')
          .sort((a: any, b: any) => Number(a?.sequence || 0) - Number(b?.sequence || 0))

        const dropPointsFilteredByDate = allEligibleDropPoints
          .filter((point: any) => {
            const orderId = String(point?.orderId || '').trim()
            if (dropPointMatchesTrackingDay(point)) return true
            if (tripMatchesDay && !trackingDate) return true
            if (!orderId) return false
            return dayOrderIds.has(orderId)
          })
        const hasScheduledDropPoints = allEligibleDropPoints.some((point: any) => [
          point?.order?.deliveryDate,
          point?.order?.timeline?.deliveryDate,
          point?.deliveryDate,
        ].some(Boolean))
        // Do not leak orders from another scheduled day; only legacy undated trips fall back.
        const dropPoints = dropPointsFilteredByDate.length > 0
          ? dropPointsFilteredByDate
          : hasScheduledDropPoints
            ? []
            : allEligibleDropPoints

        const getLogLatitude = (log: any) => Number(log?.latitude ?? log?.lat)
        const getLogLongitude = (log: any) => Number(log?.longitude ?? log?.lng)
        const getLogTripId = (log: any) => String(log?.tripId || log?.trip_id || log?.trip || '').trim()
        const getLogRecordedAt = (log: any) =>
          new Date(log?.recordedAt || log?.recorded_at || log?.createdAt || log?.created_at || 0).getTime()
        const logs = (trip.locationLogs || [])
          .filter((log: any) => isDateMatch(log?.recordedAt || log?.createdAt, trackingDate))
          .filter((log: any) => {
            const lat = getLogLatitude(log)
            const lng = getLogLongitude(log)
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
            const logTripId = getLogTripId(log)
            return !logTripId || logTripId === String(trip?.id || '')
          })
          .map((log: any) => ({
            ...log,
            latitude: getLogLatitude(log),
            longitude: getLogLongitude(log),
          }))
          .sort((a: any, b: any) => getLogRecordedAt(a) - getLogRecordedAt(b))

        const terminalStatuses = ['COMPLETED', 'DELIVERED', 'FULFILLED', 'FAILED', 'CANCELLED', 'SKIPPED']
        const nextPendingIndex = dropPoints.findIndex((point: any) => {
          const status = String(point?.status || point?.orderStatus || '').toUpperCase()
          return !terminalStatuses.includes(status)
        })
        const nextDropPoint = nextPendingIndex !== -1 ? dropPoints[nextPendingIndex] : null
        const warehouseStartLat =
          toCoordinate(trip?.warehouseLatitude) ??
          toCoordinate(trip?.warehouse?.latitude) ??
          toCoordinate(trip?.startLatitude)
        const warehouseStartLng =
          toCoordinate(trip?.warehouseLongitude) ??
          toCoordinate(trip?.warehouse?.longitude) ??
          toCoordinate(trip?.startLongitude)
        const warehouseStart =
          warehouseStartLat !== null && warehouseStartLng !== null
            ? ([warehouseStartLat, warehouseStartLng] as [number, number])
            : null

        const latestLog = logs[logs.length - 1]
        const latestLocation = trip.latestLocation
        const driverName = String(trip?.driver?.user?.name || trip?.driver?.name || 'Driver')
        const driverId = String(trip?.driver?.id || '').trim()
        // The trip payload is re-read only when a trip changes; the driver's own
        // position is refreshed on its own scope every few seconds. Whichever of
        // them was recorded last is where the vehicle actually is.
        const livePoint = latestDriverPointById.get(driverId)
        const freshestPoint = [latestLog, latestLocation, livePoint]
          .filter((point: any) => Number.isFinite(Number(point?.latitude ?? point?.lat)))
          .sort((a: any, b: any) => recordedAtMs(a) - recordedAtMs(b))
          .pop()
        const driverLat = Number(freshestPoint?.latitude ?? freshestPoint?.lat)
        const driverLng = Number(freshestPoint?.longitude ?? freshestPoint?.lng)
        const hasDriverPosition = Number.isFinite(driverLat) && Number.isFinite(driverLng)
        const vehiclePlate = String(trip?.vehicle?.licensePlate || 'N/A')
        
        const markerHeading =
          nextDropPoint &&
          Number.isFinite(Number(nextDropPoint?.latitude)) &&
          Number.isFinite(Number(nextDropPoint?.longitude)) &&
          hasDriverPosition
            ? (() => {
                const fromLat = driverLat
                const fromLng = driverLng
                const toLat = Number(nextDropPoint.latitude)
                const toLng = Number(nextDropPoint.longitude)
                const toRad = (value: number) => (value * Math.PI) / 180
                const toDeg = (value: number) => (value * 180) / Math.PI
                const phi1 = toRad(fromLat)
                const phi2 = toRad(toLat)
                const deltaLng = toRad(toLng - fromLng)
                const y = Math.sin(deltaLng) * Math.cos(phi2)
                const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLng)
                return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360
              })()
            : null

        const driverLocationMarker = hasDriverPosition
          ? {
              id: `driver-${driverId || trip.id}`,
              driverName,
              vehiclePlate,
              lat: driverLat,
              lng: driverLng,
              status: String(trip?.status || 'IN_PROGRESS'),
              markerColor: '#1d4ed8',
              // Only IN_PROGRESS trips reach this loop, so this is never a stale fix.
              markerLabel: 'Driver current location',
              markerType: 'truck' as const,
              markerHeading: markerHeading ?? undefined,
              speedMps: reportedSpeedMps(freshestPoint),
              // Added: provide the assignment details rendered by the shared truck popup.
              assignedTripNumber: String(trip?.tripNumber || ''),
              destinationCustomer: String(nextDropPoint?.locationName || 'N/A'),
            }
          : null

        dropPoints.forEach((dropPoint: any, index: number) => {
          const dropPointOrderId = String(dropPoint?.orderId || '').trim()
          if (dropPointOrderId) tripOrderIds.add(dropPointOrderId)

          const dpStatus = String(dropPoint?.status || '').toUpperCase()
          const isCancelledOrFailed = ['FAILED', 'CANCELLED', 'SKIPPED'].includes(dpStatus)
          const completed = isDropPointCompleted(dropPoint?.status) || isDropPointCompleted(dropPoint?.orderStatus)
          const isNext = index === nextPendingIndex
          const markerColor = completed ? '#2563eb' : (isNext ? '#ef4444' : '#16a34a')
          const markerLabel = isCancelledOrFailed ? 'Cancelled' : (completed ? 'Completed' : (isNext ? 'Next Stop' : 'Upcoming'))

          locations.push({
            id: `trip-order-${trip.id}-${dropPoint.id}`,
            driverName: String(dropPoint.orderNumber || dropPoint.locationName || 'Order Stop'),
            vehiclePlate: String(dropPoint.locationName || trip?.tripNumber || 'Trip'),
            lat: Number(dropPoint.latitude),
            lng: Number(dropPoint.longitude),
            status: String(dropPoint.orderStatus || dropPoint.status || 'PENDING'),
            markerColor,
            markerType: 'pin',
            markerLabel,
            markerNumber: Number.isFinite(Number(dropPoint?.sequence)) ? Number(dropPoint.sequence) : undefined,
          })
        })

        if (driverLocationMarker) {
          // Push driver marker last so it stays visually on top of stop pins.
          // Keep whichever of this driver's trips carries their most recent fix,
          // so the marker shows where they actually are rather than whichever
          // trip the API happened to return first.
          const markerRecordedAt = recordedAtMs(freshestPoint)
          const existingSlot = driverMarkerSlots.get(driverLocationMarker.id)
          if (!existingSlot) {
            driverMarkerSlots.set(driverLocationMarker.id, { index: locations.length, recordedAt: markerRecordedAt })
            locations.push(driverLocationMarker)
          } else if (markerRecordedAt > existingSlot.recordedAt) {
            locations[existingSlot.index] = driverLocationMarker
            existingSlot.recordedAt = markerRecordedAt
          }
        }

        if (logs.length > 0) {
          const passedPathPoints: [number, number][] = [
            ...(warehouseStart ? [warehouseStart] : []),
            ...logs.map((log: any) => [Number(log.latitude), Number(log.longitude)] as [number, number]),
          ].filter((point, index, list) => {
            if (index === 0) return true
            const previous = list[index - 1]
            return !(Math.abs(point[0] - previous[0]) < 0.000001 && Math.abs(point[1] - previous[1]) < 0.000001)
          })

          if (passedPathPoints.length > 1) {
          routeLines.push({
            id: `passed-${trip.id}`,
            points: passedPathPoints,
            color: '#6b7280',
            label: `${trip.tripNumber || 'Trip'} - Path taken`,
            opacity: 0.95,
            weight: 7,
            dashArray: '8 8',
            snapToRoad: true,
          })
          }
        }

        const pendingPoints = dropPoints.filter(
          (point: any) => !isDropPointCompleted(point?.status) && !isDropPointCompleted(point?.orderStatus)
        )
        if (hasDriverPosition && pendingPoints.length > 0) {
          routeLines.push({
            id: `remaining-${trip.id}`,
            points: [
              [driverLat, driverLng],
              ...pendingPoints.map((point: any) => [Number(point.latitude), Number(point.longitude)] as [number, number]),
            ],
            color: '#2563eb',
            label: `${trip.tripNumber || 'Trip'} - Remaining route`,
            opacity: 1,
            weight: 8,
            snapToRoad: true,
          })
        } else if (logs.length <= 1 && dropPoints.length > 0) {
          const plannedWaypoints: [number, number][] = [
            ...(warehouseStart ? [warehouseStart] : []),
            ...dropPoints.map((point: any) => [Number(point.latitude), Number(point.longitude)] as [number, number]),
          ]
          for (let index = 0; index < plannedWaypoints.length - 1; index += 1) {
            const nextPoint = dropPoints[Math.max(0, index - (warehouseStart ? 1 : 0))]
            const completed = isDropPointCompleted(nextPoint?.status) || isDropPointCompleted(nextPoint?.orderStatus)
            routeLines.push({
              id: `planned-${trip.id}-${index}`,
              points: [
                plannedWaypoints[index],
                plannedWaypoints[index + 1],
              ],
              color: completed ? '#93c5fd' : '#2563eb',
              label: `${trip.tripNumber || 'Trip'} route segment`,
              opacity: completed ? 0.85 : 1,
              weight: completed ? 6 : 8,
              dashArray: completed ? '7 9' : undefined,
              snapToRoad: true,
            })
          }
        }
      })

    // Fix: trucks exist only for the trips in the loop above, i.e. the ones
    // IN_PROGRESS on the tracking day. The old "last known location" pass put a
    // truck on the map for every driver with a fix that day, so drivers whose
    // trip had already been completed (or who had no trip at all) kept showing
    // as if they were still out delivering. `driverLocations` now only feeds the
    // live position of a driver who is on an active trip.

    dayOrders.forEach((order: any) => {
      if (order?.id && tripOrderIds.has(order.id)) return
      const lat = Number(order?.shippingLatitude)
      const lng = Number(order?.shippingLongitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

      const shippingAddress = String(order?.shippingAddress || '').trim()
      const orderAddressLabel = shippingAddress || [
        String(order?.shippingCity || '').trim(),
        String(order?.shippingProvince || '').trim(),
        String(order?.shippingZipCode || '').trim(),
      ]
        .filter(Boolean)
        .join(', ') || 'Address unavailable'
      const completed = isCompletedOrderStatus(order?.status)
      locations.push({
        id: `warehouse-standalone-order-${order.id}`,
        driverName: String(order?.orderNumber || 'Order'),
        vehiclePlate: String(order?.shippingAddress || 'Customer location'),
        lat,
        lng,
        status: String(order?.status || 'PREPARING'),
        markerColor: String(order?.status || '').toUpperCase() === 'CANCELLED' ? '#ef4444' : (completed ? '#2563eb' : '#16a34a'),
        markerType: 'pin',
        markerLabel: orderAddressLabel,
      })
    })

    return { locations, routeLines }
  }, [driverLocations, dropPointMatchesTrackingDay, orderMatchesTrackingDay, scopedOrders, scopedTrips, trackingDate, tripMatchesTrackingDay])

  const liveTrackingLocations = liveMapData.locations
  const liveTrackingRouteLines = liveMapData.routeLines
  const liveTrackingCenter = (liveTrackingLocations[0]
    ? [liveTrackingLocations[0].lat, liveTrackingLocations[0].lng]
    : [10.55, 122.95]) as [number, number]

  const liveTrackingActiveTrips = useMemo(
    () =>
      scopedTrips.filter(
        (trip) => ['IN_PROGRESS'].includes(normalizeTripStatus(trip.status)) && tripMatchesTrackingDay(trip)
      ),
    [scopedTrips, tripMatchesTrackingDay]
  )

  const liveTrackingRecentLocations = useMemo(
    () =>
      scopedTrips
        .filter((trip: any) => tripMatchesTrackingDay(trip))
        .flatMap((trip: any) => (Array.isArray(trip?.locationLogs) ? trip.locationLogs : []))
        .filter((log: any) => isDateMatch(log?.recordedAt || log?.createdAt, trackingDate))
        .filter((log: any) => Number.isFinite(Number(log?.latitude)) && Number.isFinite(Number(log?.longitude)))
        .map((log: any) => ({
          ...log,
          latitude: Number(log.latitude),
          longitude: Number(log.longitude),
        }))
        .sort((a: any, b: any) => new Date(b.recordedAt || 0).getTime() - new Date(a.recordedAt || 0).getTime())
        .slice(0, 5),
    [scopedTrips, trackingDate, tripMatchesTrackingDay]
  )

  return {
    liveTrackingActiveTrips,
    liveTrackingCenter,
    liveTrackingLocations,
    liveTrackingRecentLocations,
    liveTrackingRouteLines,
  }
}
