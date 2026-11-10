'use client'

import { useMemo } from 'react'
import { LiveTrackingPage } from '@/components/portals/shared/live-tracking-page'
import { useVehicleIncidents } from '@/components/portals/shared/use-vehicle-incidents'
import { toMapWarehouses } from '@/components/shared/live-tracking/warehouse-markers'
import { withIncidentMarkers } from '@/lib/vehicle-incidents'
import type { WarehouseLiveTrackingViewProps } from '../shared/types'

export function WarehouseLiveTrackingView({
  trackingDate,
  setTrackingDate,
  fetchTripsData,
  fetchOrdersData,
  loadingTrips,
  loadingOrders,
  LiveTrackingMap,
  liveTrackingLocations,
  liveTrackingRouteLines,
  liveTrackingCenter,
  liveTrackingActiveTrips,
  liveTrackingDeliveredTransactions,
  liveTrackingRecentLocations,
  warehouses,
}: WarehouseLiveTrackingViewProps) {
  const mapWarehouses = useMemo(() => toMapWarehouses(warehouses), [warehouses])
  // Warehouse staff respond to incidents on their own warehouse's trips (see views_incidents).
  const { incidents, isLoading: isLoadingIncidents, respond } = useVehicleIncidents({ date: trackingDate })
  const mapLocations = useMemo(
    () => withIncidentMarkers(liveTrackingLocations, incidents),
    [incidents, liveTrackingLocations]
  )
  const today = new Date()
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  return (
    <LiveTrackingPage
      trackingDate={trackingDate}
      onTrackingDateChange={(value) => setTrackingDate(value || todayDate)}
      onRefresh={() => {
        void Promise.all([
          fetchTripsData(),
          fetchOrdersData({ showLoading: false, silent: true }),
        ])
      }}
      isRefreshing={loadingTrips || loadingOrders}
      activeTrips={liveTrackingActiveTrips}
      deliveries={liveTrackingDeliveredTransactions}
      recentLocations={liveTrackingRecentLocations}
      isLoadingTrips={loadingTrips}
      incidents={incidents}
      isLoadingIncidents={isLoadingIncidents}
      onRespondToIncident={respond}
      map={
        <LiveTrackingMap
          locations={mapLocations}
          routeLines={liveTrackingRouteLines}
          center={liveTrackingCenter}
          zoom={mapLocations.length > 0 ? 12 : 10}
          restrictToNegrosOccidental
          showDriverSelfBadge={false}
          className="h-full w-full"
          warehouses={mapWarehouses}
        />
      }
    />
  )
}
