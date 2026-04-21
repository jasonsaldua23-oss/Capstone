import re
import sys

def update_file(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Find the start of `const liveMapData = useMemo(() => {`
    start_str = "  const liveMapData = useMemo(() => {"
    end_str = "  }, [scopedOrders, scopedTrips, trackingDate])"

    start_idx = content.find(start_str)
    end_idx = content.find(end_str, start_idx) + len(end_str)

    if start_idx == -1 or end_idx == -1:
        print("Could not find the block to replace in", file_path)
        sys.exit(1)

    new_block = """  const liveMapData = useMemo(() => {
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
    }> = []
    const routeLines: Array<{
      id: string
      points: [number, number][]
      color: string
      label?: string
      opacity?: number
      weight?: number
      dashArray?: string
    }> = []

    const dayOrders = scopedOrders.filter((order: any) => orderMatchesTrackingDay(order))
    const dayOrderIds = new Set(
      dayOrders.map((order: any) => String(order?.id || '').trim()).filter(Boolean)
    )
    const tripOrderIds = new Set<string>()

    scopedTrips
      .filter((trip: any) => ['PLANNED', 'IN_PROGRESS', 'COMPLETED'].includes(normalizeTripStatus(trip.status)))
      .forEach((trip: any) => {
        const dropPoints = (trip.dropPoints || [])
          .filter((point: any) => {
            const orderId = String(point?.orderId || '').trim()
            if (!trackingDate) return true
            if (!orderId) return false
            return dayOrderIds.has(orderId)
          })
          .filter((point: any) => typeof point?.latitude === 'number' && typeof point?.longitude === 'number')
          .sort((a: any, b: any) => Number(a?.sequence || 0) - Number(b?.sequence || 0))

        const logs = (trip.locationLogs || [])
          .filter((log: any) => typeof log?.latitude === 'number' && typeof log?.longitude === 'number')
          .sort((a: any, b: any) => new Date(a.recordedAt || 0).getTime() - new Date(b.recordedAt || 0).getTime())

        const nextPendingIndex = dropPoints.findIndex((point: any) => {
          const status = String(point?.status || point?.orderStatus || '').toUpperCase()
          return !['COMPLETED', 'DELIVERED'].includes(status)
        })
        const nextDropPoint = nextPendingIndex !== -1 ? dropPoints[nextPendingIndex] : null

        const latestLog = logs[logs.length - 1]
        const latestLocation = trip.latestLocation
        const driverLat = Number(latestLog?.latitude ?? latestLocation?.latitude)
        const driverLng = Number(latestLog?.longitude ?? latestLocation?.longitude)
        const hasDriverPosition = Number.isFinite(driverLat) && Number.isFinite(driverLng)
        const driverName = String(trip?.driver?.user?.name || trip?.driver?.name || 'Driver')
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

        if (hasDriverPosition) {
          locations.push({
            id: `driver-${trip.id}`,
            driverName,
            vehiclePlate,
            lat: driverLat,
            lng: driverLng,
            status: String(trip?.status || 'IN_PROGRESS'),
            markerColor: '#1d4ed8',
            markerLabel: 'Current location',
            markerType: 'truck',
            markerHeading: markerHeading ?? undefined,
          })
        }

        dropPoints.forEach((dropPoint: any, index: number) => {
          const dropPointOrderId = String(dropPoint?.orderId || '').trim()
          if (dropPointOrderId) tripOrderIds.add(dropPointOrderId)

          const completed = isDropPointCompleted(dropPoint?.status) || isDropPointCompleted(dropPoint?.orderStatus)
          const isNext = index === nextPendingIndex
          const markerColor = completed ? '#2563eb' : (isNext ? '#ef4444' : '#16a34a')
          const markerLabel = completed ? 'Completed' : (isNext ? 'Next Stop' : 'Upcoming')

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

        if (logs.length > 1) {
          routeLines.push({
            id: `completed-${trip.id}`,
            points: logs.map((log: any) => [Number(log.latitude), Number(log.longitude)] as [number, number]),
            color: '#93c5fd',
            label: `${trip.tripNumber || 'Trip'} - Completed route`,
            opacity: 0.85,
            weight: 6,
            dashArray: '7 9',
          })
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
          })
        } else if (logs.length <= 1 && dropPoints.length > 1) {
          for (let index = 0; index < dropPoints.length - 1; index += 1) {
            const nextPoint = dropPoints[index + 1]
            const completed = isDropPointCompleted(nextPoint?.status) || isDropPointCompleted(nextPoint?.orderStatus)
            routeLines.push({
              id: `planned-${trip.id}-${index}`,
              points: [
                [Number(dropPoints[index].latitude), Number(dropPoints[index].longitude)],
                [Number(nextPoint.latitude), Number(nextPoint.longitude)],
              ],
              color: completed ? '#93c5fd' : '#2563eb',
              label: `${trip.tripNumber || 'Trip'} route segment`,
              opacity: completed ? 0.85 : 1,
              weight: completed ? 6 : 8,
              dashArray: completed ? '7 9' : undefined,
            })
          }
        }
      })

    dayOrders.forEach((order: any) => {
      if (order?.id && tripOrderIds.has(order.id)) return
      const lat = Number(order?.shippingLatitude)
      const lng = Number(order?.shippingLongitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

      const completed = isCompletedOrderStatus(order?.status)
      locations.push({
        id: `warehouse-standalone-order-${order.id}`,
        driverName: String(order?.orderNumber || 'Order'),
        vehiclePlate: String(order?.shippingAddress || 'Customer location'),
        lat,
        lng,
        status: String(order?.status || 'PROCESSING'),
        markerColor: completed ? '#2563eb' : '#16a34a',
        markerType: 'pin',
        markerLabel: completed ? 'Completed order location' : 'Not completed order location',
      })
    })

    return { locations, routeLines }
  }, [scopedOrders, scopedTrips, trackingDate])"""

    new_content = content[:start_idx] + new_block + content[end_idx:]
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Updated", file_path)

if __name__ == "__main__":
    update_file("c:/CAPSTONE/src/components/portals/WarehousePortal.tsx")
