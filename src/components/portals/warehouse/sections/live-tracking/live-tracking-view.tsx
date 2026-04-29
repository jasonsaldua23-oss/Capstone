'use client'

import { Loader2, MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
  liveTrackingRecentLocations,
}: WarehouseLiveTrackingViewProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Tracking</h1>
          <p className="text-gray-500">Monitor active deliveries in real-time</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={trackingDate}
            onChange={(event) => setTrackingDate(event.target.value)}
            className="w-[160px]"
          />
          <Button
            className="gap-2"
            onClick={async () => {
              await Promise.all([
                fetchTripsData(),
                fetchOrdersData({ showLoading: false, silent: true }),
              ])
            }}
            disabled={loadingTrips || loadingOrders}
          >
            {(loadingTrips || loadingOrders) ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            Refresh Map
          </Button>
        </div>
      </div>

      <div className="text-sm text-slate-600">
        Route colors: <span className="font-medium text-blue-400">Muted blue dashed = Completed</span> |{' '}
        <span className="font-medium text-blue-700">Bright blue = Upcoming</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="h-[500px]">
            <CardContent className="h-full p-0">
              <LiveTrackingMap
                locations={liveTrackingLocations}
                routeLines={liveTrackingRouteLines}
                center={liveTrackingCenter}
                zoom={liveTrackingLocations.length > 0 ? 12 : 10}
                restrictToNegrosOccidental
                showDriverSelfBadge={false}
                className="w-full h-full rounded-xl overflow-hidden"
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Active Trips</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingTrips ? (
                <div className="flex h-24 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </div>
              ) : liveTrackingActiveTrips.length === 0 ? (
                <p className="text-sm text-gray-500">No active trips right now</p>
              ) : (
                <div className="space-y-3">
                  {liveTrackingActiveTrips.slice(0, 5).map((trip) => (
                    <div key={trip.id} className="flex items-center gap-3 rounded-lg bg-gray-50 p-2">
                      <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{trip.tripNumber}</p>
                        <p className="text-xs text-gray-500">
                          Driver: {trip.driver?.name || trip.driver?.user?.name || 'Unassigned'}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {trip.completedDropPoints || 0}/{trip.totalDropPoints || 0}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Locations</CardTitle>
            </CardHeader>
            <CardContent>
              {liveTrackingRecentLocations.length === 0 ? (
                <p className="text-sm text-gray-500">No coordinate logs available</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {liveTrackingRecentLocations.map((log: any) => {
                    const latitude = Number(log.latitude)
                    const longitude = Number(log.longitude)

                    return (
                      <div key={log.id} className="flex justify-between gap-2">
                        <span className="truncate text-gray-500">
                          {new Date(log.recordedAt || log.createdAt || Date.now()).toLocaleTimeString()}
                        </span>
                        <span>{latitude.toFixed(4)}, {longitude.toFixed(4)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
