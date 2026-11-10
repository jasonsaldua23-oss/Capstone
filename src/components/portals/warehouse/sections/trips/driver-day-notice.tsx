'use client'

import { useEffect, useState } from 'react'
import { ordinal } from '@/lib/driver-trip-queue'

interface DriverDayTrip {
  id: string
  tripNumber: string
  status: string
  position: number
  stops: number
  openStops: number
  warehouseName?: string | null
}

type DriverDayResult = { key: string; trips: DriverDayTrip[]; error: string }

const STATUS_LABELS: Record<string, string> = { IN_PROGRESS: 'on the road', PLANNED: 'planned' }

const formatDay = (dayKey: string) =>
  new Date(`${dayKey}T12:00:00+08:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })

/**
 * The selected driver's other trips on the trip's day, in the order they run.
 * A driver runs one trip at a time, so a second trip that day waits for the first
 * (see views_trip_planning.trips_driver_day). Trips from every warehouse count.
 */
export function DriverDayNotice({
  driverId,
  driverName,
  date,
  excludeTripId,
  compact = false,
}: {
  driverId: string
  driverName?: string
  /** YYYY-MM-DD, or an ISO date-time whose day is used. */
  date: string
  /** The trip being edited, which is not its own neighbour. */
  excludeTripId?: string
  compact?: boolean
}) {
  const dayKey = /^\d{4}-\d{2}-\d{2}/.test(date || '') ? date.slice(0, 10) : ''
  const requestKey = driverId && dayKey ? `${driverId}|${dayKey}|${excludeTripId || ''}` : ''
  const [result, setResult] = useState<DriverDayResult | null>(null)

  useEffect(() => {
    if (!requestKey) return
    const controller = new AbortController()
    const params = new URLSearchParams({ driverId, date: dayKey })
    if (excludeTripId) params.set('excludeTripId', excludeTripId)
    fetch(`/api/trips/driver-day?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.error || "The driver's other trips could not be checked.")
        setResult({ key: requestKey, trips: Array.isArray(payload.trips) ? payload.trips : [], error: '' })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setResult({ key: requestKey, trips: [], error: error instanceof Error ? error.message : "The driver's other trips could not be checked." })
      })
    return () => controller.abort()
  }, [requestKey, driverId, dayKey, excludeTripId])

  // Nothing until the selected driver's day has loaded, so a stale driver never shows.
  if (!requestKey || result?.key !== requestKey) return null
  const textSize = compact ? 'text-[11px]' : 'text-xs'
  const name = driverName || 'This driver'
  if (result.error) return <p role="alert" className={`${textSize} text-slate-500`}>{result.error}</p>
  if (result.trips.length === 0) {
    return <p className={`${textSize} text-slate-600`}>{name} has no other trips on {formatDay(dayKey)}.</p>
  }

  const count = result.trips.length
  return (
    <div className={`rounded-md border border-sky-200 bg-sky-50 px-2.5 py-2 ${textSize} leading-relaxed text-sky-900`}>
      <p className="font-semibold">
        {excludeTripId
          ? `${name} also has ${count} other ${count === 1 ? 'trip' : 'trips'} on ${formatDay(dayKey)}. Trips run one at a time:`
          : `${name} already has ${count} ${count === 1 ? 'trip' : 'trips'} on ${formatDay(dayKey)}. Trips run one at a time, so this one runs ${ordinal(count + 1)}, after:`}
      </p>
      <ol className="mt-1 space-y-0.5">
        {result.trips.map((trip) => (
          <li key={trip.id}>
            {trip.position}. <span className="font-semibold">{trip.tripNumber}</span>
            {' · '}{STATUS_LABELS[trip.status] || trip.status.toLowerCase()}
            {' · '}{trip.openStops} of {trip.stops} {trip.stops === 1 ? 'stop' : 'stops'} to go
            {trip.warehouseName ? ` · ${trip.warehouseName}` : ''}
          </li>
        ))}
      </ol>
    </div>
  )
}
