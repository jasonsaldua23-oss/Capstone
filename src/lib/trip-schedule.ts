// The day a trip is due and whether a planned trip missed it, shared by the
// driver, warehouse and admin portals. The server sends both on every trip
// (scheduledDate / isOverdue); these helpers only re-derive them, the same way
// the server does, for payloads that lack them.

// Added: trip days are Philippine calendar days on the server (trip_start and the
// serializer's scheduledDate), so the portal compares against Manila's date too,
// whatever timezone the phone is set to.
const MANILA_DATE_KEY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** YYYY-MM-DD of an instant (default: now) on the Philippine calendar. */
export const toManilaDateKey = (value: Date | string | null | undefined = new Date()): string | null => {
  if (value === null || value === undefined || value === '') return null
  const instant = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(instant.getTime())) return null
  return MANILA_DATE_KEY_FORMAT.format(instant)
}

/** The day the trip is due: the server's scheduledDate, else the legacy timestamps. */
export const getTripScheduledDateKey = (trip: any): string | null => {
  const serverKey = String(trip?.scheduledDate || '').trim()
  if (DATE_KEY_PATTERN.test(serverKey)) return serverKey
  // Offline or older payloads: derive it the same way the server does.
  const deliveryKeys = (Array.isArray(trip?.dropPoints) ? trip.dropPoints : [])
    .map((point: any) => toManilaDateKey(point?.order?.deliveryDate || null))
    .filter((key: string | null): key is string => Boolean(key))
    .sort()
  if (deliveryKeys.length > 0) return deliveryKeys[0]
  return toManilaDateKey(trip?.tripSchedule || trip?.plannedStartAt || null)
}

/** A planned trip whose day has passed; it can no longer be started. */
export const isTripOverdue = (trip: any): boolean => {
  if (String(trip?.status || '').toUpperCase() !== 'PLANNED') return false
  if (typeof trip?.isOverdue === 'boolean') return trip.isOverdue
  const scheduledKey = getTripScheduledDateKey(trip)
  const todayKey = toManilaDateKey()
  return Boolean(scheduledKey && todayKey && scheduledKey < todayKey)
}

/** Work the driver can still do: the running trip, then planned trips whose day has not passed. */
export const isOpenDeliveryTrip = (trip: any): boolean => {
  const status = String(trip?.status || '').toUpperCase()
  return status === 'IN_PROGRESS' || (status === 'PLANNED' && !isTripOverdue(trip))
}
