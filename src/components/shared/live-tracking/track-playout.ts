/**
 * Plays a vehicle's confirmed journey back along the road it took, in real time.
 *
 * A report map learns where a vehicle is every few seconds. Getting the icon onto
 * each report within about a second and then waiting there made it lurch forward
 * and stop at every report; guessing ahead instead meant guessing the road, which is
 * exactly how it used to turn into junctions the driver drove straight past. Here
 * the icon only ever travels the road between confirmed positions (matched legs of
 * `road-match`), each leg over the time the vehicle actually took to drive it. When
 * the next report comes in on time the next leg follows on without a pause, so the
 * icon moves at the vehicle's own speed, a report interval behind it. When a report
 * is late the icon waits on the last confirmed position rather than inventing more.
 *
 * All distances are absolute metres from where tracking began, so a leg appended to
 * the track never re-measures where the icon already is, even when the road doubles
 * back on itself after a U-turn.
 */
import { approximateMapDistanceMeters, bearingBetweenMapPoints, projectPointOntoRoute } from '../../../lib/map-navigation.ts'
import { stepHeading } from './vehicle-motion.ts'

type LatLng = [number, number]

/** Time constant with which the drawn position follows the schedule; it rounds off the step in speed where one leg meets the next. */
export const PLAYOUT_FOLLOW_TIME_S = 0.35
/** Beyond the newest leg's own duration plus this, the queue is behind and plays faster... */
export const PLAYOUT_BACKLOG_ALLOWANCE_MS = 500
/** ...but never more than this many times real time, so catching up never reads as a jump. */
export const PLAYOUT_MAX_RATE = 3
/** A leg is never played faster than this, whatever time it claims. */
export const PLAYOUT_MIN_LEG_MS = 300
/** Road kept behind the icon, for its heading; the rest has been driven. */
export const PLAYOUT_KEEP_BEHIND_METERS = 60
/** A relocation nearer than this is glided to... */
export const PLAYOUT_RELOCATE_GLIDE_METERS = 400
/** ...over at most this long. Further than that it is shown at once. */
export const PLAYOUT_RELOCATE_GLIDE_MS = 1500
/** A new leg passing within this of where the track ends is joined where they meet. */
export const PLAYOUT_JOIN_REACH_METERS = 20
/** How far behind and ahead of the icon the road is read for its heading. */
const HEADING_BEHIND_METERS = 3
const HEADING_AHEAD_METERS = 6
/** Frame gaps longer than this (tab switch, jank) are stepped as this instead. */
const MAX_FRAME_S = 0.1
const SETTLE_METERS = 0.02

export type TrackPlayout = {
  points: LatLng[]
  /** Absolute metres at each point, ascending. */
  meters: number[]
  /** Legs still to play, in order; the first is under way. */
  legs: { endMeters: number; durationMs: number }[]
  legStartMeters: number
  legElapsedMs: number
  /** Where the schedule has reached. */
  scheduledMeters: number
  /** Where the icon is drawn. Never ahead of the schedule, never going back. */
  drawnMeters: number
  drawnSpeedMps: number
  heading: number | null
  /** The icon keeps its heading until it is drawn this far (a first sighting settling onto its road). */
  headingHeldToMeters: number | null
  lastStepAtMs: number
}

export function createPlayout(point: LatLng, nowMs: number, heading: number | null = null): TrackPlayout {
  return {
    points: [point],
    meters: [0],
    legs: [],
    legStartMeters: 0,
    legElapsedMs: 0,
    scheduledMeters: 0,
    drawnMeters: 0,
    drawnSpeedMps: 0,
    heading,
    headingHeldToMeters: null,
    lastStepAtMs: nowMs,
  }
}

function endMeters(playout: TrackPlayout): number {
  return playout.meters[playout.meters.length - 1]
}

function endPoint(playout: TrackPlayout): LatLng {
  return playout.points[playout.points.length - 1]
}

/** The point `distance` metres along the track, clamped to what is kept of it. */
export function pointAtMeters(playout: TrackPlayout, distance: number): LatLng {
  const { points, meters } = playout
  if (distance <= meters[0]) return points[0]
  if (distance >= meters[meters.length - 1]) return points[points.length - 1]
  let low = 0
  let high = meters.length - 1
  while (high - low > 1) {
    const mid = (low + high) >> 1
    if (meters[mid] <= distance) low = mid
    else high = mid
  }
  const span = meters[high] - meters[low]
  const t = span > 0 ? (distance - meters[low]) / span : 0
  return [
    points[low][0] + (points[high][0] - points[low][0]) * t,
    points[low][1] + (points[high][1] - points[low][1]) * t,
  ]
}

/**
 * Add the road driven to the newest confirmed position, to be played over
 * `durationMs` - the time the vehicle took. A leg that starts a little way from
 * where the track ends (the earlier position matched a few metres differently this
 * time) is joined on rather than jumped to.
 */
export function appendLeg(
  playout: TrackPlayout,
  leg: LatLng[],
  durationMs: number,
  nowMs: number,
  options: { keepHeading?: boolean } = {}
): TrackPlayout {
  if (leg.length < 2) return playout
  const base = reviseRoadAhead(playout, leg)
  const points = [...base.points]
  const meters = [...base.meters]
  let total = endMeters(base)
  for (const point of joinedLeg(endPoint(base), leg)) {
    const step = approximateMapDistanceMeters(points[points.length - 1], point)
    if (step < 0.01) continue
    total += step
    points.push(point)
    meters.push(total)
  }
  if (total - endMeters(base) < 0.3) return base

  const idle = base.legs.length === 0
  const next: TrackPlayout = {
    ...base,
    points,
    meters,
    legs: [...base.legs, { endMeters: total, durationMs: Math.max(PLAYOUT_MIN_LEG_MS, durationMs) }],
    headingHeldToMeters: options.keepHeading ? total : base.headingHeldToMeters,
    legStartMeters: idle ? base.scheduledMeters : base.legStartMeters,
    legElapsedMs: idle ? 0 : base.legElapsedMs,
    // A loop that had stopped resumes from now, not from its last frame.
    lastStepAtMs: idle && isPlayoutSettled(base) ? nowMs : base.lastStepAtMs,
  }
  return trimBehind(next)
}

/**
 * Matched again with the next report beside it, the position a new leg starts from
 * is sometimes short of where the road ahead of the icon was drawn to - most of all
 * where the van turned round: the earlier match carried the road on past the turn.
 * When the new leg starts on the road the icon has not yet driven, and does not run
 * on through where that road ended, the road ahead is cut back to where the new leg
 * starts, rather than the icon driving out to the old estimate and back.
 */
function reviseRoadAhead(playout: TrackPlayout, leg: LatLng[]): TrackPlayout {
  const end = endPoint(playout)
  if (approximateMapDistanceMeters(end, leg[0]) <= 0.5) return playout
  const through = projectPointOntoRoute(end, leg)
  const runsOnThroughEnd = through !== null &&
    through.distanceFromRouteMeters <= PLAYOUT_JOIN_REACH_METERS &&
    (through.segmentIndex > 0 || through.segmentProgress > 0)
  if (runsOnThroughEnd) return playout

  const firstAhead = playout.meters.findIndex((distance) => distance > playout.drawnMeters)
  if (firstAhead < 0) return playout
  const ahead: LatLng[] = [pointAtMeters(playout, playout.drawnMeters), ...playout.points.slice(firstAhead)]
  const start = projectPointOntoRoute(leg[0], ahead)
  const aheadMeters = endMeters(playout) - playout.drawnMeters
  if (!start || start.distanceFromRouteMeters > PLAYOUT_JOIN_REACH_METERS || start.distanceAlongMeters >= aheadMeters - 0.5) {
    return playout
  }
  return truncateAt(playout, playout.drawnMeters + start.distanceAlongMeters)
}

/** The track ending at `cut` (not behind the icon), with the legs queued past it shortened to match. */
function truncateAt(playout: TrackPlayout, cut: number): TrackPlayout {
  const kept = playout.meters.filter((distance) => distance < cut).length
  const points = [...playout.points.slice(0, kept), pointAtMeters(playout, cut)]
  const meters = [...playout.meters.slice(0, kept), cut]
  if (playout.scheduledMeters >= cut) {
    return { ...playout, points, meters, legs: [], legStartMeters: cut, legElapsedMs: 0, scheduledMeters: cut }
  }
  const legs: TrackPlayout['legs'] = []
  let legStart = playout.legStartMeters
  for (const leg of playout.legs) {
    if (leg.endMeters <= cut) {
      legs.push(leg)
      legStart = leg.endMeters
      continue
    }
    // The part of this leg that is left keeps its share of the leg's time.
    const share = leg.endMeters > legStart ? (cut - legStart) / (leg.endMeters - legStart) : 1
    const elapsed = legs.length === 0 ? playout.legElapsedMs : 0
    legs.push({ ...leg, endMeters: cut, durationMs: Math.max(elapsed + 1, leg.durationMs * share) })
    break
  }
  return { ...playout, points, meters, legs }
}

/**
 * The part of a new leg that carries on from where the track already reached.
 * Matched again with more positions around it, the report the leg starts from often
 * lands a few metres from where it did last time - ahead, behind, or across the
 * carriageway. Joining at the leg's own start then drew the icon backwards and
 * forwards again, or sideways; joining where the track's end meets the leg does not.
 */
function joinedLeg(trackEnd: LatLng, leg: LatLng[]): LatLng[] {
  if (approximateMapDistanceMeters(trackEnd, leg[0]) <= 0.5) return leg.slice(1)
  const meet = projectPointOntoRoute(trackEnd, leg)
  if (!meet || meet.distanceFromRouteMeters > PLAYOUT_JOIN_REACH_METERS) return leg
  const rest = leg.slice(meet.segmentIndex + 1)
  return approximateMapDistanceMeters(trackEnd, meet.point) > 0.5 ? [meet.point, ...rest] : rest
}

function trimBehind(playout: TrackPlayout): TrackPlayout {
  const keepFrom = playout.drawnMeters - PLAYOUT_KEEP_BEHIND_METERS
  let drop = 0
  while (drop < playout.meters.length - 2 && playout.meters[drop + 1] <= keepFrom) drop += 1
  if (drop === 0) return playout
  return { ...playout, points: playout.points.slice(drop), meters: playout.meters.slice(drop) }
}

/** The direction of the road under `distance`, read across a few metres either side. */
function roadHeadingAt(playout: TrackPlayout, distance: number): number | null {
  const from = Math.max(playout.meters[0], distance - HEADING_BEHIND_METERS)
  const to = Math.min(endMeters(playout), distance + HEADING_AHEAD_METERS)
  // Near either end there is less road on one side; read what there is.
  const behind = to - from < HEADING_AHEAD_METERS ? Math.max(playout.meters[0], to - HEADING_AHEAD_METERS) : from
  if (to - behind < 0.5) return null
  return bearingBetweenMapPoints(pointAtMeters(playout, behind), pointAtMeters(playout, to))
}

/** One animation frame. */
export function stepPlayout(playout: TrackPlayout, nowMs: number): TrackPlayout {
  const dtS = Math.min(MAX_FRAME_S, Math.max(0, (nowMs - playout.lastStepAtMs) / 1000))
  if (dtS === 0) return playout

  let legs = playout.legs
  let legStartMeters = playout.legStartMeters
  let legElapsedMs = playout.legElapsedMs
  let scheduledMeters = playout.scheduledMeters
  if (legs.length > 0) {
    // The newest leg's duration is how often reports arrive. Much more than that
    // still queued means the icon has fallen behind (a burst of late reports), and
    // it plays faster until the backlog is back to one report's worth.
    const backlogMs = legs.reduce((sum, leg) => sum + leg.durationMs, 0) - legElapsedMs
    const allowedMs = legs[legs.length - 1].durationMs + PLAYOUT_BACKLOG_ALLOWANCE_MS
    const rate = Math.min(PLAYOUT_MAX_RATE, Math.max(1, backlogMs / allowedMs))
    let budgetMs = dtS * 1000 * rate
    legs = [...legs]
    while (legs.length > 0 && budgetMs > 0) {
      const leg = legs[0]
      const leftMs = leg.durationMs - legElapsedMs
      if (budgetMs < leftMs) {
        legElapsedMs += budgetMs
        scheduledMeters = legStartMeters + (leg.endMeters - legStartMeters) * (legElapsedMs / leg.durationMs)
        budgetMs = 0
      } else {
        budgetMs -= leftMs
        scheduledMeters = leg.endMeters
        legStartMeters = leg.endMeters
        legElapsedMs = 0
        legs.shift()
      }
    }
  }

  // Follow the schedule through a first-order lag: the drawn speed is then the
  // schedule's speed smoothed, so it changes gently where one leg meets the next,
  // and the drawn position can never overtake the schedule or reverse.
  let drawnMeters = playout.drawnMeters + (scheduledMeters - playout.drawnMeters) * (1 - Math.exp(-dtS / PLAYOUT_FOLLOW_TIME_S))
  if (legs.length === 0 && scheduledMeters - drawnMeters < SETTLE_METERS) drawnMeters = scheduledMeters
  const drawnSpeedMps = (drawnMeters - playout.drawnMeters) / dtS

  const next: TrackPlayout = {
    ...playout,
    legs,
    legStartMeters,
    legElapsedMs,
    scheduledMeters,
    drawnMeters,
    drawnSpeedMps,
    lastStepAtMs: nowMs,
  }
  const held = playout.headingHeldToMeters
  if (held !== null && drawnMeters < held - SETTLE_METERS) {
    next.heading = playout.heading
  } else {
    next.headingHeldToMeters = null
    next.heading = stepHeading(playout.heading, roadHeadingAt(next, drawnMeters), drawnSpeedMps, dtS)
  }
  return next
}

export function playoutPose(playout: TrackPlayout): { point: LatLng; heading: number | null; speedMps: number; trackMeters: number } {
  return {
    point: pointAtMeters(playout, playout.drawnMeters),
    heading: playout.heading,
    speedMps: playout.drawnSpeedMps,
    trackMeters: playout.drawnMeters,
  }
}

export function isPlayoutSettled(playout: TrackPlayout): boolean {
  return playout.legs.length === 0 && playout.scheduledMeters - playout.drawnMeters < SETTLE_METERS
}

/** Show the newest confirmed position at once: the page was hidden and the journey since is not worth replaying. */
export function fastForwardPlayout(playout: TrackPlayout, nowMs: number): TrackPlayout {
  const end = endMeters(playout)
  const heading = roadHeadingAt(playout, end) ?? playout.heading
  return trimBehind({
    ...playout,
    legs: [],
    legStartMeters: end,
    legElapsedMs: 0,
    scheduledMeters: end,
    drawnMeters: end,
    drawnSpeedMps: 0,
    heading,
    lastStepAtMs: nowMs,
  })
}

/**
 * The vehicle is confirmed somewhere the track does not lead (after a signal gap,
 * or a jump the next report bore out). Near enough, the icon glides there quickly;
 * across town, gliding would draw it through buildings, so it is shown there at once.
 */
export function relocatePlayout(playout: TrackPlayout, point: LatLng, sinceLastMs: number, nowMs: number): TrackPlayout {
  const from = pointAtMeters(playout, playout.drawnMeters)
  const distance = approximateMapDistanceMeters(from, point)
  if (distance > PLAYOUT_RELOCATE_GLIDE_METERS) {
    const heading = bearingBetweenMapPoints(from, point) ?? playout.heading
    return createPlayout(point, nowMs, heading)
  }
  // The road still queued ahead of the icon led somewhere the vehicle is not; the
  // glide starts from where the icon is drawn.
  const kept = playout.meters.filter((distance) => distance < playout.drawnMeters).length
  const here: TrackPlayout = {
    ...playout,
    points: [...playout.points.slice(0, kept), from],
    meters: [...playout.meters.slice(0, kept), playout.drawnMeters],
    legs: [],
    legStartMeters: playout.drawnMeters,
    legElapsedMs: 0,
    scheduledMeters: playout.drawnMeters,
    lastStepAtMs: nowMs,
  }
  const glideMs = Math.min(PLAYOUT_RELOCATE_GLIDE_MS, Math.max(PLAYOUT_MIN_LEG_MS, sinceLastMs))
  return appendLeg(here, [from, point], glideMs, nowMs)
}

/** The road from the icon to the newest confirmed position, for the route line to start at the icon. */
export function playoutLead(playout: TrackPlayout): LatLng[] {
  const lead: LatLng[] = [pointAtMeters(playout, playout.drawnMeters)]
  for (let index = 0; index < playout.points.length; index += 1) {
    if (playout.meters[index] > playout.drawnMeters + 0.01) lead.push(playout.points[index])
  }
  return lead
}
