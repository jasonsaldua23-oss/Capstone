// The "Route: A -> B" line on trip cards in every portal.
//
// B is the trip's last stop. A trip whose stops all moved to another truck
// (views_trips.trip_transfer) has none left, so it names where they went.

export const describeTripDestination = (trip: any): string => {
  const points = Array.isArray(trip?.dropPoints) ? trip.dropPoints : []
  const last = points[points.length - 1]
  const name = String(last?.locationName || '').trim()
  if (name) return name
  if (points.length === 0 && trip?.transferredToNumber) return `stops moved to ${trip.transferredToNumber}`
  return 'Destination'
}

export const describeTripRoute = (trip: any, origin?: string | null): string =>
  `${String(origin || trip?.warehouse?.name || '').trim() || 'Warehouse'} -> ${describeTripDestination(trip)}`
