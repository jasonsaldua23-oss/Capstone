'use client'

import { LiveTrackingPage } from '@/components/portals/shared/live-tracking-page'
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
}: WarehouseLiveTrackingViewProps) {
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
      map={
        <LiveTrackingMap
          locations={liveTrackingLocations}
          routeLines={liveTrackingRouteLines}
          center={liveTrackingCenter}
          zoom={liveTrackingLocations.length > 0 ? 12 : 10}
          restrictToNegrosOccidental
          showDriverSelfBadge={false}
          className="h-full w-full"
        />
      }
    />
  )
}
