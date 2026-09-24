'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import type { DriverLocation, LiveRouteLine } from '@/components/shared/live-tracking/types'

// The live map the warehouse and admin portals track deliveries on, fed the same
// way, so the customer sees the van exactly as they do: on the road, following it
// onto each reported position, with the view keeping up and keeping their zoom.
const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), { ssr: false })

type CustomerTrackingMapProps = {
  orderId: string
  driverLatitude: number
  driverLongitude: number
  destinationLatitude: number | null
  destinationLongitude: number | null
  warehouseLatitude: number | null
  warehouseLongitude: number | null
  delivered: boolean
  driverName?: string | null
  vehiclePlate?: string | null
  tripNumber?: string | null
  deliveryAddress?: string | null
  className?: string
}

export function CustomerTrackingMap({
  orderId,
  driverLatitude,
  driverLongitude,
  destinationLatitude,
  destinationLongitude,
  warehouseLatitude,
  warehouseLongitude,
  delivered,
  driverName,
  vehiclePlate,
  tripNumber,
  deliveryAddress,
  className,
}: CustomerTrackingMapProps) {
  const hasDestination = destinationLatitude !== null && destinationLongitude !== null
  const hasWarehouse = warehouseLatitude !== null && warehouseLongitude !== null

  const locations = useMemo<DriverLocation[]>(() => [
    {
      id: `driver-${orderId}`,
      driverName: driverName || 'Driver',
      vehiclePlate: vehiclePlate || 'N/A',
      lat: driverLatitude,
      lng: driverLongitude,
      status: 'IN_PROGRESS',
      markerColor: '#1d4ed8',
      markerLabel: 'Driver current location',
      markerType: 'truck',
      // Drawn along its remaining route between reports, as on the warehouse and admin maps.
      roadLineId: `remaining-${orderId}`,
      assignedTripNumber: tripNumber || '',
      destinationCustomer: deliveryAddress || 'N/A',
    },
    ...(hasDestination
      ? [{
        id: `destination-${orderId}`,
        driverName: 'Your delivery',
        vehiclePlate: '',
        lat: destinationLatitude as number,
        lng: destinationLongitude as number,
        status: delivered ? 'DELIVERED' : 'PENDING',
        markerColor: '#16a34a',
        markerType: 'pin' as const,
        markerLabel: deliveryAddress || 'Delivery address',
        popupCustomerName: 'Your delivery',
        popupAddress: deliveryAddress || '',
      }]
      : []),
  ], [
    orderId, driverName, vehiclePlate, driverLatitude, driverLongitude, tripNumber, deliveryAddress,
    hasDestination, destinationLatitude, destinationLongitude, delivered,
  ])

  const routeLines = useMemo<LiveRouteLine[]>(() => [
    ...(hasWarehouse
      ? [{
        id: `passed-${orderId}`,
        points: [[warehouseLatitude as number, warehouseLongitude as number], [driverLatitude, driverLongitude]] as [number, number][],
        color: '#6b7280',
        label: 'Path taken',
        opacity: 0.95,
        weight: 7,
        dashArray: '8 8',
        snapToRoad: true,
      }]
      : []),
    ...(hasDestination && !delivered
      ? [{
        id: `remaining-${orderId}`,
        points: [[driverLatitude, driverLongitude], [destinationLatitude as number, destinationLongitude as number]] as [number, number][],
        color: '#2563eb',
        label: 'Remaining route',
        opacity: 1,
        weight: 8,
        snapToRoad: true,
      }]
      : []),
  ], [
    orderId, hasWarehouse, warehouseLatitude, warehouseLongitude, driverLatitude, driverLongitude,
    hasDestination, destinationLatitude, destinationLongitude, delivered,
  ])

  const center = useMemo<[number, number]>(() => [driverLatitude, driverLongitude], [driverLatitude, driverLongitude])

  return (
    <LiveTrackingMap
      locations={locations}
      routeLines={routeLines}
      center={center}
      zoom={14}
      restrictToNegrosOccidental
      showDriverSelfBadge={false}
      className={className}
    />
  )
}
