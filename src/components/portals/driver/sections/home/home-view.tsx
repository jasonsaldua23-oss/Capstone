'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Route, CalendarClock, Trophy, RotateCcw } from 'lucide-react'
import { WelcomePopup } from '@/components/portals/shared/welcome-popup'
import { useDriverTripsSnapshot, type DriverTripStats } from '../layout/portal-state'
import { getTripScheduledDateKey, isTripOverdue, toManilaDateKey } from '../trips/trip-detail-format'

type Trip = any

export function HomeView({
  user: _user,
  trips,
  stats,
  isLoading,
  isTracking: _isTracking,
  locationPermission: _locationPermission,
  currentLocation: _currentLocation,
  onOpenTrips,
  onOpenActiveTrip,
  onStartTracking: _onStartTracking,
}: {
  user: any
  trips: Trip[]
  /** Server dashboard counters; read from the portal snapshot when not passed. */
  stats?: DriverTripStats | null
  isLoading: boolean
  isTracking?: boolean
  locationPermission?: 'granted' | 'denied' | 'prompt'
  currentLocation?: { lat: number; lng: number } | null
  onOpenTrips: () => void
  onOpenActiveTrip: (trip: Trip) => void
  onStartTracking?: () => Promise<boolean>
  loadingOrderId?: string | null
  onMarkOrderLoaded?: (orderId: string) => Promise<boolean>
}) {
  const [welcomeState] = useState(() => {
    if (typeof window === 'undefined') return { open: false, message: 'Welcome back!' }
    try {
      const raw = window.sessionStorage.getItem('driver_welcome_state')
      if (!raw) return { open: false, message: 'Welcome back!' }
      const parsed = JSON.parse(raw) as { name?: string }
      const name = String(parsed?.name || '').trim()
      window.sessionStorage.removeItem('driver_welcome_state')
      return {
        open: true,
        message: name ? `Welcome back, ${name}.` : 'Welcome back!',
      }
    } catch {
      return { open: false, message: 'Welcome back!' }
    }
  })
  const [showWelcomePopup, setShowWelcomePopup] = useState(welcomeState.open)

  // Fix: the tiles come from the server's stats, which cover every trip of this
  // driver; the portal only holds the latest 50, so counting them here drifted.
  const snapshot = useDriverTripsSnapshot()
  const serverStats = stats ?? snapshot.stats

  const statusOf = (trip: Trip) => String(trip?.status || '').toUpperCase()
  const toTime = (value: string | null | undefined) => {
    const parsed = value ? new Date(value).getTime() : Number.NaN
    return Number.isNaN(parsed) ? 0 : parsed
  }

  // Fallback (e.g. the backup trip list, which carries no stats): the same rules
  // as the server - "today" is the trip's scheduled day, cancelled trips drop out.
  const todayKey = toManilaDateKey()
  const tripsForToday = trips.filter(
    (trip) => statusOf(trip) !== 'CANCELLED' && getTripScheduledDateKey(trip) === todayKey
  )
  const inProgressTrips = trips
    .filter((trip) => statusOf(trip) === 'IN_PROGRESS')
    .sort((a, b) => toTime(b.actualStartAt || b.updatedAt) - toTime(a.actualStartAt || a.updatedAt))
  const terminalStopStatuses = new Set(['COMPLETED', 'DELIVERED', 'FAILED', 'SKIPPED', 'CANCELED', 'CANCELLED'])
  const countOpenStops = (trip: Trip) =>
    (trip.dropPoints || []).filter((point: any) => !terminalStopStatuses.has(String(point.status || '').toUpperCase())).length

  const todayTripCount = serverStats ? serverStats.todayTrips : tripsForToday.length
  const plannedTrips = serverStats
    ? serverStats.plannedToday
    : tripsForToday.filter((trip) => statusOf(trip) === 'PLANNED').length
  const completedTrips = serverStats
    ? serverStats.completedToday
    : tripsForToday.filter((trip) => statusOf(trip) === 'COMPLETED').length
  const pendingStops = serverStats
    ? serverStats.pendingStops
    : inProgressTrips.reduce((sum, trip) => sum + countOpenStops(trip), 0)
  const overdueTrips = serverStats ? serverStats.overdueTrips : trips.filter((trip) => isTripOverdue(trip)).length

  const assignment = serverStats?.currentAssignment ?? null
  const activeTrip: Trip | null = assignment
    // The running trip is always recent, so it is in the loaded page; the id alone still opens it.
    ? trips.find((trip) => trip.id === assignment.tripId) ?? { id: assignment.tripId, tripNumber: assignment.tripNumber }
    : serverStats
      ? null
      : inProgressTrips[0] ?? null
  const activeTripNumber = assignment?.tripNumber ?? activeTrip?.tripNumber
  const activeCompletedStops = assignment ? assignment.completedDropPoints : activeTrip?.completedDropPoints
  const activeTotalStops = assignment ? assignment.totalDropPoints : activeTrip?.totalDropPoints

  return (
    <>
      <WelcomePopup
        open={showWelcomePopup}
        message={welcomeState.message}
        subtitle="Check your assigned trips and complete deliveries on time."
        onClose={() => setShowWelcomePopup(false)}
        overlayClassName="bg-black/70"
        panelClassName="border-slate-200 bg-white"
        titleClassName="text-slate-900"
        subtitleClassName="text-slate-600"
        buttonClassName="bg-slate-100 text-slate-600 hover:bg-slate-200"
      />
      {isLoading ? (
        <div className="space-y-4 rounded-[1.6rem] p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:p-5 md:pb-5">
          <div className="space-y-2">
            <Skeleton className="h-3 w-36 bg-white/70" />
            <Skeleton className="h-10 w-64 max-w-full bg-white/75" />
            <Skeleton className="h-5 w-80 max-w-full bg-white/70" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={`driver-home-stat-skeleton-${index}`} className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
                <CardContent className="min-h-[106px] pt-4">
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-24 bg-slate-200/80" />
                    <Skeleton className="h-8 w-16 bg-slate-200/80" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-[1.6rem] p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:p-5 md:pb-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#1f3558]">DRIVER DASHBOARD</p>
            <h2 className="mt-1 text-[2rem] font-black leading-tight tracking-[-0.02em] text-[#0a1435]">Driver Dashboard</h2>
            <p className="text-[1.12rem] leading-relaxed text-[#223c5d]">Here is your delivery overview for today.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
              <CardContent className="min-h-[106px] pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-[#1f4d79]">Total Trips</p>
                    <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{todayTripCount}</p>
                  </div>
                  <Route className="h-10 w-10 text-[#0f4f8f]" />
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
              <CardContent className="min-h-[106px] pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-[#1f4d79]">Planned</p>
                    <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{plannedTrips}</p>
                  </div>
                  <CalendarClock className="h-10 w-10 text-[#0f4f8f]" />
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
              <CardContent className="min-h-[106px] pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-[#1f4d79]">Completed</p>
                    <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{completedTrips}</p>
                  </div>
                  <Trophy className="h-10 w-10 text-[#0f4f8f]" />
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
              <CardContent className="min-h-[106px] pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium leading-tight text-[#1f4d79]">Pending Stops</p>
                    <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{pendingStops}</p>
                  </div>
                  <RotateCcw className="h-10 w-10 text-[#0f4f8f]" />
                </div>
              </CardContent>
            </Card>
          </div>

          {overdueTrips > 0 && (
            // Added: overdue trips leave My Deliveries; tell the driver where they went.
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              {overdueTrips} overdue {overdueTrips === 1 ? 'trip' : 'trips'} passed {overdueTrips === 1 ? 'its' : 'their'} scheduled date and moved to History.
            </p>
          )}

          <Card className="rounded-2xl border border-slate-200/70 bg-[#f8f8f2] shadow-[0_8px_20px_rgba(15,23,42,0.12)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-[1.7rem] font-semibold tracking-[-0.01em] leading-tight">
                <span className="text-[#0f4f8f]">Current</span>{' '}
                <span className="text-[#2f9a34]">Assignment</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeTrip ? (
                <div className="space-y-2">
                  <p className="font-semibold tracking-tight text-[#0e2442]">{activeTripNumber}</p>
                  <p className="text-sm leading-relaxed text-[#1f3558]">
                    {activeCompletedStops ?? 0}/{activeTotalStops ?? 0} stops completed
                  </p>
                  <Button className="h-10 w-full rounded-xl bg-[#0d61ad] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(2,132,199,0.22)] hover:bg-[#0b579c]" onClick={() => onOpenActiveTrip(activeTrip)}>
                    Open Active Trip
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[1.05rem] text-[#1f3558]">No active trip right now.</p>
                  <Button className="h-10 w-full rounded-xl bg-[#0d61ad] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(2,132,199,0.22)] hover:bg-[#0b579c]" onClick={onOpenTrips}>
                    View My Trips
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
