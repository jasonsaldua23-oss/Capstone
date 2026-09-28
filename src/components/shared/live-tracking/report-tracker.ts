/**
 * Which driver reports a map that learns positions every few seconds should believe.
 *
 * The admin, warehouse and customer maps are told where a vehicle is a report at a
 * time, and each report used to move the icon straight away. A Wi-Fi fix 30 m off
 * the road, a spike a kilometre away, a late response describing where the van was
 * before, or a parked phone's wander each did exactly that. Here every report is
 * judged against the ones before it first, and only a confirmed one moves anything:
 *
 *  - duplicates and reports older than the newest are dropped;
 *  - a coarse network fix between GPS fixes, and a very inaccurate one while better
 *    ones are recent, are held back;
 *  - a leap no vehicle could make in the time is held until the next report either
 *    comes back on course (it was a spike, never shown) or confirms it (relocation);
 *  - a vehicle whose phone says it is standing still, or whose position has barely
 *    moved, is not moved for the wander.
 *
 * Pure and in plain coordinates, so node's test runner can load it.
 */
import { approximateMapDistanceMeters, bearingBetweenMapPoints } from '../../../lib/map-navigation.ts'
import { isCoarseFixAmidGps } from '../../../lib/driver-gps-quality.ts'
import { movingBearing } from './vehicle-motion.ts'

export type ReportFix = {
  lat: number
  lng: number
  /** When the phone took the fix, on the phone's clock. */
  recordedAtMs: number | null
  /** When this map learned of it, on this browser's clock. */
  receivedAtMs: number
  speedMps: number | null
  headingDeg: number | null
  accuracyM: number | null
}

export type ReportTracker = {
  /** Confirmed positions the vehicle moved through, oldest first. */
  accepted: ReportFix[]
  /** The newest confirmed report, moved or not; legs are timed from it. */
  lastConfirmed: ReportFix
  /** A leap waiting for the next report to confirm or refute it. */
  suspect: ReportFix | null
  /** Whether the phone's last reading was a standstill (hysteresis for pulling away). */
  reportedStill: boolean
}

export type ReportOutcome =
  | { kind: 'first'; fix: ReportFix }
  /** Extend the track to `fix`; `window` is the recent path ending in it, for road matching. */
  | { kind: 'moved'; fix: ReportFix; window: ReportFix[]; sinceLastMs: number }
  | { kind: 'still'; fix: ReportFix }
  /** A leap the next report confirmed: the vehicle really is somewhere else. */
  | { kind: 'relocated'; fix: ReportFix; sinceLastMs: number }
  | { kind: 'held'; reason: 'coarse' | 'inaccurate' | 'implausible' }
  | { kind: 'ignored'; reason: 'duplicate' | 'older' }

/** Recent confirmed positions kept for matching and direction. */
export const TRACKER_HISTORY = 6
/** Positions matched together to decide the road of the newest leg. */
export const TRACKER_MATCH_WINDOW = 4
/** Faster than any delivery vehicle here; beyond it a report is a spike until confirmed. */
export const TRACKER_MAX_SPEED_MPS = 42
/** Allowance on top of the speed limit, for two fixes' worth of error. */
export const TRACKER_LEAP_SLACK_METERS = 25
/** Accuracy worse than this is not trusted while better fixes are recent... */
export const TRACKER_MAX_TRUSTED_ACCURACY_METERS = 50
/** ...where recent means within this long. After it the coarse fix is the best there is. */
export const TRACKER_INACCURATE_HOLD_MS = 20_000
/** A leap is held at most this long; after it the newest report is taken as the truth. */
export const TRACKER_SUSPECT_HOLD_MS = 15_000
/** A phone reading below this is a standstill... */
export const TRACKER_STOPPED_READING_MPS = 0.6
/** ...and once it has said so, it must read this before the vehicle is moving again. */
export const TRACKER_PULL_AWAY_READING_MPS = 1
/** A standing phone's positions wander within this of where it stopped. */
export const TRACKER_PARKED_HOLD_METERS = 25
/** Without a speed reading, moving less than this (or the fix's own accuracy) is no movement. */
export const TRACKER_MIN_MOVE_METERS = 8

const DEFAULT_ACCURACY_M = 15

const pointOf = (fix: ReportFix): [number, number] => [fix.lat, fix.lng]

/** Milliseconds from `a` to `b`, on the phone's clock when both carry it. */
function elapsedMs(a: ReportFix, b: ReportFix): number {
  if (a.recordedAtMs !== null && b.recordedAtMs !== null) return b.recordedAtMs - a.recordedAtMs
  return b.receivedAtMs - a.receivedAtMs
}

function sameReport(a: ReportFix, b: ReportFix): boolean {
  if (a.recordedAtMs !== null && b.recordedAtMs !== null) return a.recordedAtMs === b.recordedAtMs
  return a.lat === b.lat && a.lng === b.lng && a.speedMps === b.speedMps && a.headingDeg === b.headingDeg
}

function accuracyOf(fix: ReportFix): number {
  return fix.accuracyM !== null && Number.isFinite(fix.accuracyM) && fix.accuracyM >= 0 ? fix.accuracyM : DEFAULT_ACCURACY_M
}

/** Whether `to` could have been reached from `from` in the time between them. */
function plausibleStep(from: ReportFix, to: ReportFix): boolean {
  const dtS = Math.max(0.5, elapsedMs(from, to) / 1000)
  const allowance = TRACKER_MAX_SPEED_MPS * dtS + accuracyOf(from) + accuracyOf(to) + TRACKER_LEAP_SLACK_METERS
  return approximateMapDistanceMeters(pointOf(from), pointOf(to)) <= allowance
}

function phoneSaysStill(fix: ReportFix, previouslyStill: boolean): boolean | null {
  if (fix.speedMps === null || !Number.isFinite(fix.speedMps) || fix.speedMps < 0) return null
  return fix.speedMps < (previouslyStill ? TRACKER_PULL_AWAY_READING_MPS : TRACKER_STOPPED_READING_MPS)
}

function start(fix: ReportFix): ReportTracker {
  return { accepted: [fix], lastConfirmed: fix, suspect: null, reportedStill: phoneSaysStill(fix, false) === true }
}

export function ingestReport(
  tracker: ReportTracker | undefined,
  fix: ReportFix
): { tracker: ReportTracker; outcome: ReportOutcome } {
  if (!tracker) return { tracker: start(fix), outcome: { kind: 'first', fix } }
  const last = tracker.lastConfirmed
  const anchor = tracker.accepted[tracker.accepted.length - 1] ?? last

  if (sameReport(last, fix) || (tracker.suspect && sameReport(tracker.suspect, fix))) {
    return { tracker, outcome: { kind: 'ignored', reason: 'duplicate' } }
  }
  if (last.recordedAtMs !== null && fix.recordedAtMs !== null && fix.recordedAtMs < last.recordedAtMs) {
    return { tracker, outcome: { kind: 'ignored', reason: 'older' } }
  }

  if (isCoarseFixAmidGps(
    { accuracy: fix.accuracyM, speed: fix.speedMps, recordedAt: fix.recordedAtMs },
    { accuracy: last.accuracyM, speed: last.speedMps, recordedAt: last.recordedAtMs }
  )) {
    return { tracker, outcome: { kind: 'held', reason: 'coarse' } }
  }
  if (
    accuracyOf(fix) > TRACKER_MAX_TRUSTED_ACCURACY_METERS &&
    accuracyOf(last) <= TRACKER_MAX_TRUSTED_ACCURACY_METERS &&
    elapsedMs(last, fix) < TRACKER_INACCURATE_HOLD_MS
  ) {
    return { tracker, outcome: { kind: 'held', reason: 'inaccurate' } }
  }

  if (!plausibleStep(last, fix)) {
    const suspect = tracker.suspect
    // Two reports in a row, both far from the last good one but consistent with each
    // other: the vehicle is really there (a signal gap, or the earlier fix was bad).
    if (suspect && plausibleStep(suspect, fix)) {
      const relocated: ReportTracker = { ...start(fix), accepted: [suspect, fix] }
      return { tracker: relocated, outcome: { kind: 'relocated', fix, sinceLastMs: elapsedMs(last, fix) } }
    }
    if (suspect && elapsedMs(suspect, fix) >= TRACKER_SUSPECT_HOLD_MS) {
      return { tracker: start(fix), outcome: { kind: 'relocated', fix, sinceLastMs: elapsedMs(last, fix) } }
    }
    return { tracker: { ...tracker, suspect: suspect ?? fix }, outcome: { kind: 'held', reason: 'implausible' } }
  }

  const sinceLastMs = Math.max(0, elapsedMs(last, fix))
  const movedMeters = approximateMapDistanceMeters(pointOf(anchor), pointOf(fix))
  const still = phoneSaysStill(fix, tracker.reportedStill)
  const stationary = still === true
    ? movedMeters < TRACKER_PARKED_HOLD_METERS
    : still === null && movedMeters < Math.max(TRACKER_MIN_MOVE_METERS, accuracyOf(fix))
  const confirmed: ReportTracker = { ...tracker, lastConfirmed: fix, suspect: null, reportedStill: still ?? tracker.reportedStill }

  if (stationary) return { tracker: confirmed, outcome: { kind: 'still', fix } }

  const accepted = [...tracker.accepted, fix].slice(-TRACKER_HISTORY)
  return {
    tracker: { ...confirmed, accepted },
    outcome: { kind: 'moved', fix, window: accepted.slice(-TRACKER_MATCH_WINDOW), sinceLastMs },
  }
}

/**
 * The direction the vehicle is travelling: the phone's own bearing while it is
 * moving fast enough for one to mean anything, else the way its last two
 * confirmed positions lie.
 */
export function movementBearing(tracker: ReportTracker | undefined): number | null {
  if (!tracker) return null
  const last = tracker.lastConfirmed
  const phone = movingBearing(last.headingDeg, last.speedMps)
  if (phone !== null) return phone
  const [before, after] = tracker.accepted.slice(-2)
  if (!before || !after || approximateMapDistanceMeters(pointOf(before), pointOf(after)) < TRACKER_MIN_MOVE_METERS) return null
  return bearingBetweenMapPoints(pointOf(before), pointOf(after))
}
