'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Route, CalendarClock, Trophy, RotateCcw } from 'lucide-react'
import { WelcomePopup } from '@/components/portals/shared/welcome-popup'

type Trip = any

export function HomeView({
  user: _user,
  trips,
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

  const isCompletedTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'COMPLETED'
  const isInProgressTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'IN_PROGRESS'
  const isPlannedTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'PLANNED'
  const isSameLocalDate = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  const parseIsoDate = (raw: string | null | undefined) => {
    if (!raw) return null
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const getTripDayDate = (trip: Trip) => {
    return (
      parseIsoDate(trip.plannedStartAt) ||
      parseIsoDate(trip.actualStartAt) ||
      parseIsoDate(trip.createdAt) ||
      parseIsoDate(trip.updatedAt)
    )
  }
  const getTripScheduledDeliveryDates = (trip: Trip) =>
    (trip.dropPoints || [])
      .map((point: any) => parseIsoDate(point.order?.deliveryDate || null))
      .filter((value: any): value is Date => Boolean(value))
  const isTripForDay = (trip: Trip, day: Date) => {
    const scheduledDeliveryDates = getTripScheduledDeliveryDates(trip)
    if (scheduledDeliveryDates.length > 0) {
      return scheduledDeliveryDates.some((dateValue: any) => isSameLocalDate(dateValue, day))
    }
    const tripDate = getTripDayDate(trip)
    return tripDate ? isSameLocalDate(tripDate, day) : false
  }

  const getTripRecency = (trip: Trip) => {
    const tripDate = getTripDayDate(trip)
    return tripDate ? tripDate.getTime() : 0
  }
  const sortTripsByPriority = (rows: Trip[]) => [...rows].sort((a, b) => {
    const rank = (status: string | null | undefined) => {
      const normalized = String(status || '').toUpperCase()
      if (normalized === 'IN_PROGRESS') return 0
      if (normalized === 'PLANNED') return 1
      if (normalized === 'COMPLETED') return 2
      return 3
    }
    const rankDiff = rank(a.status) - rank(b.status)
    if (rankDiff !== 0) return rankDiff
    return getTripRecency(b) - getTripRecency(a)
  })

  const today = new Date()
  const prioritizedTrips = sortTripsByPriority(trips)
  const tripsForToday = trips.filter((trip) => isTripForDay(trip, today))
  const activeTrip = prioritizedTrips.find((trip) => isInProgressTrip(trip.status)) || null
  const plannedTrips = tripsForToday.filter((trip) => isPlannedTrip(trip.status)).length
  const completedTrips = tripsForToday.filter((trip) => isCompletedTrip(trip.status)).length
  const terminalStopStatuses = new Set(['COMPLETED', 'DELIVERED', 'FAILED', 'SKIPPED', 'CANCELED', 'CANCELLED'])
  const pendingStops = activeTrip
    ? (activeTrip.dropPoints || []).filter((point: any) => !terminalStopStatuses.has(String(point.status || '').toUpperCase())).length
    : 0

  return (
    <>
      <WelcomePopup
        open={showWelcomePopup}
        message={welcomeState.message}
        subtitle="Check your assigned trips and complete deliveries on time."
        onClose={() => setShowWelcomePopup(false)}
        overlayClassName="bg-black/70"
        panelClassName="border-emerald-200 bg-[#eaf8f1]"
        titleClassName="text-slate-900"
        subtitleClassName="text-slate-600"
        buttonClassName="bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
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
                    <p className="text-[2rem] font-black leading-none tracking-tight text-[#2f9a34]">{tripsForToday.length}</p>
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
                  <p className="font-semibold tracking-tight text-[#0e2442]">{activeTrip.tripNumber}</p>
                  <p className="text-sm leading-relaxed text-[#1f3558]">
                    {activeTrip.completedDropPoints}/{activeTrip.totalDropPoints} stops completed
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
