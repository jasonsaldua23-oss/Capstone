export type RouteCoordinate = { lat: number; lng: number }

// Pure route calculations stay outside the trip screen's large workflow state.
export function haversineKm(from: RouteCoordinate, to: RouteCoordinate) {
  const radiusKm = 6371
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(to.lat - from.lat)
  const dLng = toRad(to.lng - from.lng)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return radiusKm * c
}

// Find the shortest distance from a GPS point to the routed polyline.
export function distanceFromRouteMeters(point: RouteCoordinate, routePoints: [number, number][]) {
  if (!Array.isArray(routePoints) || routePoints.length < 2) return null
  const longitudeScale = Math.cos((point.lat * Math.PI) / 180)
  const px = point.lng * longitudeScale
  const py = point.lat
  let bestDegrees = Infinity
  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const [aLat, aLng] = routePoints[index]
    const [bLat, bLng] = routePoints[index + 1]
    const ax = aLng * longitudeScale
    const ay = aLat
    const bx = bLng * longitudeScale
    const by = bLat
    const vx = bx - ax
    const vy = by - ay
    const length2 = vx * vx + vy * vy
    const t = length2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / length2)) : 0
    const projectedX = ax + vx * t
    const projectedY = ay + vy * t
    const dx = px - projectedX
    const dy = py - projectedY
    const distanceDegrees = Math.sqrt(dx * dx + dy * dy)
    if (distanceDegrees < bestDegrees) bestDegrees = distanceDegrees
  }
  return bestDegrees * 111320
}
