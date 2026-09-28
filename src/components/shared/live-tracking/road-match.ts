/**
 * The road a vehicle actually took between its last two reports.
 *
 * The report maps used to put the icon on the *planned* route to the next stop and
 * slide each report onto whichever part of it lay nearest. Wherever that plan turned
 * and the driver did not, the icon turned anyway: a report 25 m straight past the
 * junction was still within reach of the planned road, so the icon was pinned at the
 * corner or sent down the side street. And the plan, redrawn from each raw report
 * with no direction, sometimes started on the cross street or facing back the way
 * the van had come.
 *
 * Map matching answers a different question - which roads join these positions, in
 * this order, at these times - so it follows what the reports show: straight on past
 * a turn the plan wanted, round a turn the plan did not, back down a road after a
 * U-turn. Several recent positions go in together, so a single noisy one cannot pull
 * the path onto a neighbouring street, and each one's accuracy bounds how far from
 * it a road may be.
 */
import { approximateMapDistanceMeters } from '../../../lib/map-navigation.ts'
import type { ReportFix } from './report-tracker.ts'

type LatLng = [number, number]

const OSRM_MATCH_URL = 'https://router.project-osrm.org/match/v1/driving/'
/** A phone's claimed accuracy is often better than the road's own width... */
export const MATCH_MIN_RADIUS_METERS = 10
/** ...and a fix this vague must not reach a road a block away. */
export const MATCH_MAX_RADIUS_METERS = 40
/** A matched leg longer than this multiple of the straight hop (plus slack) is a detour the reports do not show. */
export const LEG_MAX_DETOUR_RATIO = 1.8
export const LEG_DETOUR_SLACK_METERS = 60
/** ...or longer than a vehicle could drive in the time between the reports. */
export const LEG_MAX_SPEED_MPS = 45

function radiusFor(fix: ReportFix): number {
  const accuracy = fix.accuracyM !== null && Number.isFinite(fix.accuracyM) ? fix.accuracyM * 1.5 : MATCH_MIN_RADIUS_METERS
  return Math.round(Math.min(MATCH_MAX_RADIUS_METERS, Math.max(MATCH_MIN_RADIUS_METERS, accuracy)))
}

export function buildMatchUrl(window: ReportFix[]): string {
  const coordinates = window.map((fix) => `${fix.lng},${fix.lat}`).join(';')
  // OSRM wants whole seconds that never decrease. The phone's clock is the truth
  // about when the van was where; a report without it falls back on when it came in.
  let previous = -Infinity
  const timestamps = window.map((fix) => {
    const seconds = Math.floor((fix.recordedAtMs ?? fix.receivedAtMs) / 1000)
    previous = Math.max(previous + (previous === -Infinity ? 0 : 1), seconds)
    return previous
  })
  const params = new URLSearchParams({
    overview: 'false',
    steps: 'true',
    geometries: 'geojson',
    annotations: 'false',
    // A long gap between reports is still one journey.
    gaps: 'ignore',
    tidy: 'false',
    timestamps: timestamps.join(';'),
    radiuses: window.map(radiusFor).join(';'),
  })
  return `${OSRM_MATCH_URL}${coordinates}?${params.toString()}`
}

/**
 * The geometry of the leg between the last two positions of `window`, from where the
 * earlier one matched to where the newest did, or null when the two did not match
 * onto one continuous road.
 */
export function parseMatchedLeg(payload: any, window: ReportFix[]): LatLng[] | null {
  if (payload?.code !== 'Ok' || !Array.isArray(payload?.tracepoints) || !Array.isArray(payload?.matchings)) return null
  const n = window.length
  const newest = payload.tracepoints[n - 1]
  const previous = payload.tracepoints[n - 2]
  if (!newest || !previous || newest.matchings_index !== previous.matchings_index) return null
  if (newest.waypoint_index !== previous.waypoint_index + 1) return null
  const leg = payload.matchings[newest.matchings_index]?.legs?.[previous.waypoint_index]
  if (!leg || !Array.isArray(leg.steps)) return null

  const points: LatLng[] = []
  for (const step of leg.steps) {
    for (const pair of step?.geometry?.coordinates ?? []) {
      const point: LatLng = [Number(pair?.[1]), Number(pair?.[0])]
      if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
      const last = points[points.length - 1]
      if (last && Math.abs(last[0] - point[0]) < 1e-7 && Math.abs(last[1] - point[1]) < 1e-7) continue
      points.push(point)
    }
  }
  return points.length >= 2 ? points : null
}

function pathLength(points: LatLng[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) total += approximateMapDistanceMeters(points[index - 1], points[index])
  return total
}

/** Whether a matched leg is a road the vehicle could have driven between two reports `dtS` apart. */
export function isPlausibleLeg(leg: LatLng[], from: LatLng, to: LatLng, dtS: number | null): boolean {
  const length = pathLength(leg)
  const direct = approximateMapDistanceMeters(from, to)
  if (length > direct * LEG_MAX_DETOUR_RATIO + LEG_DETOUR_SLACK_METERS) return false
  if (dtS !== null && dtS > 0 && length > LEG_MAX_SPEED_MPS * dtS + LEG_DETOUR_SLACK_METERS) return false
  return true
}

/** A vehicle first seen further than this from any road is shown where it was reported. */
export const NEAREST_ROAD_MAX_METERS = 30

/**
 * The point on the nearest road to a vehicle's first report, facing the way it is
 * going when that is known, so the icon starts on the road rather than beside it.
 */
export async function fetchNearestRoadPoint(
  fix: ReportFix,
  bearingDeg: number | null,
  signal?: AbortSignal
): Promise<LatLng | null> {
  const bearing = bearingDeg === null ? '' : `&bearings=${Math.round(((bearingDeg % 360) + 360) % 360)},45`
  try {
    const response = await fetch(
      `https://router.project-osrm.org/nearest/v1/driving/${fix.lng},${fix.lat}?number=1${bearing}`,
      { signal }
    )
    if (!response.ok) return null
    const payload: any = await response.json().catch(() => null)
    const location = payload?.waypoints?.[0]?.location
    if (payload?.code !== 'Ok' || !Array.isArray(location)) return null
    const point: LatLng = [Number(location[1]), Number(location[0])]
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null
    return approximateMapDistanceMeters([fix.lat, fix.lng], point) <= NEAREST_ROAD_MAX_METERS ? point : null
  } catch {
    return null
  }
}

/** The matched road between the newest two reports, or null when matching could not say. */
export async function fetchMatchedLeg(window: ReportFix[], signal?: AbortSignal): Promise<LatLng[] | null> {
  if (window.length < 2) return null
  try {
    const response = await fetch(buildMatchUrl(window), { signal })
    if (!response.ok) return null
    const payload = await response.json().catch(() => null)
    const leg = parseMatchedLeg(payload, window)
    if (!leg) return null
    const from = window[window.length - 2]
    const to = window[window.length - 1]
    const dtS = from.recordedAtMs !== null && to.recordedAtMs !== null
      ? (to.recordedAtMs - from.recordedAtMs) / 1000
      : (to.receivedAtMs - from.receivedAtMs) / 1000
    return isPlausibleLeg(leg, [from.lat, from.lng], [to.lat, to.lng], dtS) ? leg : null
  } catch {
    return null
  }
}
