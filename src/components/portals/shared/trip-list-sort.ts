// Ordering for the admin and warehouse trip lists, kept in one place so the two
// portals cannot drift apart on the delivery-date sequence.

export type TripListSort = 'DELIVERY_DATE' | 'TRIP_ID'

export const TRIP_LIST_SORT_OPTIONS: Array<{ value: TripListSort; label: string }> = [
  { value: 'DELIVERY_DATE', label: 'Delivery date' },
  { value: 'TRIP_ID', label: 'Trip ID' },
]

type SortableTrip = {
  tripNumber?: string | null
  status?: string | null
  actualEndAt?: string | null
  tripSchedule?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

const toMs = (value: unknown) => {
  const ms = new Date(String(value || '')).getTime()
  return Number.isFinite(ms) ? ms : 0
}

// Show the latest delivery work first. When dates match, the newest-created
// trip wins; trips without a valid schedule remain at the end.
const compareDeliveryDate = (a: SortableTrip, b: SortableTrip) => {
  const aSchedule = toMs(a.tripSchedule)
  const bSchedule = toMs(b.tripSchedule)
  if (!aSchedule && bSchedule) return 1
  if (aSchedule && !bSchedule) return -1
  return bSchedule - aSchedule || toMs(b.createdAt) - toMs(a.createdAt)
}

// TRP-<year>-<zero-padded sequence>; numeric collation keeps it right even if a
// sequence ever outgrows its padding.
const compareTripId = (a: SortableTrip, b: SortableTrip) =>
  String(b?.tripNumber || '').localeCompare(String(a?.tripNumber || ''), undefined, { numeric: true })

export function sortTripsForList<T extends SortableTrip>(trips: T[], sort: TripListSort): T[] {
  return trips.slice().sort(sort === 'TRIP_ID' ? compareTripId : compareDeliveryDate)
}

// The server-side equivalent, for lists paged by the API instead of in memory.
export const tripListSortParam = (sort: TripListSort) => (sort === 'TRIP_ID' ? 'trip_number' : 'scheduled')
