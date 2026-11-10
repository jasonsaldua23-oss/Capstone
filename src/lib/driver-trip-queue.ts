// One driver, several trips: the order they run in, for the driver's own list.
//
// A driver runs one trip at a time - trip_start refuses a second while one is in
// progress. The trip already on the road comes first (one left running from an
// earlier day still holds today), then each day's planned trips in the order they
// were planned: planned start, then trip number, which follows the order the
// warehouse created them - except a load transfer, which goes right after the
// running trip. views_trip_planning.driver_day_queue orders the
// warehouse's trip dialogs the same way.

import { getTripScheduledDateKey, isOpenDeliveryTrip, toManilaDateKey } from './trip-schedule.ts'

export type TripQueuePlace = {
  dayKey: string
  /** 1-based place among the day's open trips. */
  position: number
  count: number
  isRunning: boolean
  /** The trip on the road that must be completed before this one can start. */
  blockedBy: string | null
  /** The trip planned to run just before this one, when it has not started yet. */
  plannedAfter: string | null
}

const isRunning = (trip: any) => String(trip?.status || '').toUpperCase() === 'IN_PROGRESS'
const plannedStartTime = (trip: any) => {
  const time = Date.parse(String(trip?.plannedStartAt || ''))
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

// The running trip, then a load transfer (its goods wait at the roadside), then the rest.
const runRank = (trip: any) => (isRunning(trip) ? 0 : trip?.transferredFromNumber ? 1 : 2)

/** The running trip first, then a load transfer, then planned start, then trip number. */
export const compareTripRunOrder = (a: any, b: any): number => {
  const rank = runRank(a) - runRank(b)
  if (rank !== 0) return rank
  const timeA = plannedStartTime(a)
  const timeB = plannedStartTime(b)
  if (timeA !== timeB) return timeA < timeB ? -1 : 1
  return String(a?.tripNumber || '').localeCompare(String(b?.tripNumber || ''))
}

/** Each open trip's place in its day's run, keyed by trip id. */
export function getTripQueue(trips: any[], todayKey: string | null = toManilaDateKey()): Map<string, TripQueuePlace> {
  const days = new Map<string, any[]>()
  for (const trip of trips || []) {
    if (!trip?.id || !isOpenDeliveryTrip(trip)) continue
    const scheduledKey = getTripScheduledDateKey(trip)
    // A running trip, or a load transfer carrying on its deliveries, belongs to today
    // whatever day its orders were planned for.
    const carriesOn = isRunning(trip) || Boolean(trip?.transferredFromNumber)
    const dayKey = carriesOn && todayKey && (!scheduledKey || scheduledKey < todayKey) ? todayKey : scheduledKey
    if (!dayKey) continue
    days.set(dayKey, [...(days.get(dayKey) || []), trip])
  }

  const places = new Map<string, TripQueuePlace>()
  for (const [dayKey, dayTrips] of days) {
    const ordered = [...dayTrips].sort(compareTripRunOrder)
    const running = ordered.find(isRunning)
    ordered.forEach((trip, index) => {
      const previous = index > 0 ? ordered[index - 1] : null
      places.set(String(trip.id), {
        dayKey,
        position: index + 1,
        count: ordered.length,
        isRunning: isRunning(trip),
        blockedBy: running && running !== trip ? String(running.tripNumber || '') : null,
        plannedAfter: previous && !isRunning(previous) ? String(previous.tripNumber || '') : null,
      })
    })
  }
  return places
}

/** Stops on a trip that still need an outcome. */
export const countOpenStops = (trip: any): number =>
  (Array.isArray(trip?.dropPoints) ? trip.dropPoints : []).filter((point: any) =>
    ['PENDING', 'IN_TRANSIT', 'ARRIVED'].includes(String(point?.status || '').toUpperCase())
  ).length

/** "2nd", "3rd", "11th". */
export const ordinal = (value: number): string => {
  const tens = value % 100
  if (tens >= 11 && tens <= 13) return `${value}th`
  return `${value}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] || 'th'}`
}
