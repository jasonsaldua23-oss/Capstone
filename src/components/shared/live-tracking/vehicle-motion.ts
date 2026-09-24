/**
 * Smooth motion for the vehicle icon between GPS fixes.
 *
 * A phone reports a fix about once a second, while the map draws sixty frames in
 * that time. The icon therefore has to be *predicted* between fixes, and each
 * fix then tells us how wrong the prediction was. The previous approach restarted
 * a linear interpolation at every fix, which made the icon's speed jump each
 * second (surging when it was behind, dragging when ahead), turned prediction off
 * below walking pace (so slow crawls became stop-and-go), and snapped the heading
 * from one road segment to the next.
 *
 * This model keeps two things continuous - velocity and heading - by separating
 * the motion into:
 *
 *  - a **prediction**: the last fix advanced by a low-pass-filtered ground speed,
 *    eased to a stop if fixes stop arriving; and
 *  - an **error offset**: the difference between what is drawn and the
 *    prediction. When a fix arrives the offset absorbs the jump so the drawn
 *    position does not move, then it is worked off at an acceleration a vehicle
 *    could plausibly have - the icon gently speeds up or slows down to converge
 *    instead of jumping.
 *
 * Everything here is pure and in metres along the route (or a local plane when
 * off-route), so it can be tested without a browser.
 */

/** Longest a vehicle is advanced on prediction alone before it is eased to a stop. */
export const MOTION_MAX_EXTRAPOLATION_MS = 3500
/** The final part of that window over which predicted speed ramps down to zero. */
export const MOTION_EXTRAPOLATION_RAMP_MS = 1500
/** How long after a fix the vehicle's measured acceleration keeps shaping the prediction. */
export const MOTION_ACCEL_HORIZON_MS = 1000
/** Plausible bounds on that acceleration; anything beyond is a bad Doppler reading. */
export const MOTION_MAX_ACCEL_MPS2 = 4
export const MOTION_MAX_DECEL_MPS2 = 6
/** Time constant of the final exponential approach once an error is nearly worked off. */
export const MOTION_CORRECTION_TIME_S = 0.8
/** Where there is no prediction the icon gets onto each newly reported position within about this long. */
export const MOTION_REPORT_ARRIVAL_TIME_S = 1.2
/** Gentlest acceleration used to work off an error; noise-sized errors use exactly this. */
export const MOTION_MIN_CORRECTION_ACCEL_MPS2 = 3
/** Larger errors accelerate harder so that any correction completes in about this long. */
export const MOTION_MAX_CORRECTION_TIME_S = 3
/** ...and the icon is never drawn moving more than this much faster than the vehicle
 * itself, so a big correction reads as hurrying rather than as being fired down the road. */
export const MOTION_MAX_CATCHUP_SPEED_MPS = 8
/** A speed change carried over from a fix (the vehicle braked or pulled away) is worked off within about this long. */
export const MOTION_CARRIED_SPEED_TIME_S = 1
/** Beyond this the prediction is simply wrong (reroute, tunnel exit); jump rather than glide. */
export const MOTION_SNAP_ERROR_METERS = 2000
/** While a small error is behind the icon it slows to this share of the predicted speed, never to a halt. */
export const MOTION_MIN_SPEED_FRACTION = 0.4
/** Time constant of the speed filter when the phone reports a (Doppler) speed. Short: that reading is already steady, and braking must show promptly. */
export const MOTION_SPEED_FILTER_TIME_S = 0.4
/** ...and when speed can only be measured from position deltas, which carry the position noise. */
export const MOTION_MEASURED_SPEED_FILTER_TIME_S = 1.2
/** Below this the vehicle is treated as parked: no prediction, heading held. */
export const MOTION_STATIONARY_SPEED_MPS = 0.3
/** A standing phone's Doppler speed wanders up to about half a metre per second, so a
 * reading below this is a standstill rather than a crawl... */
export const MOTION_STOPPED_READING_MPS = 0.6
/** ...and once it has said so, it must read at least this before the vehicle is moving
 * again. Without the gap, every stray reading at the kerb set the icon off down the road. */
export const MOTION_PULL_AWAY_READING_MPS = 1
/** A correction smaller than this never drives the icon backwards; larger ones may. */
export const MOTION_REVERSE_ERROR_METERS = 25
/** Share of the speed estimate taken from the phone's reported (Doppler) speed. */
export const MOTION_REPORTED_SPEED_WEIGHT = 0.85
/** While parked, fixes closer than this to the drawn position are treated as no movement. */
export const MOTION_PARKED_DEADBAND_METERS = 6
/** While the phone itself reports a standstill the icon holds through this much position
 * noise, and doubts the reading once the fixes leave that radius: beyond it they are not
 * noise but a vehicle that has moved - a tow, a ferry, a cold fix, or a phone reporting
 * a standstill it is not at. */
export const MOTION_PARKED_HOLD_METERS = 25
/** Heading turn-rate limits, degrees per second, scaling with speed between the two. */
export const MOTION_TURN_RATE_MIN_DPS = 45
export const MOTION_TURN_RATE_MAX_DPS = 240
export const MOTION_TURN_RATE_PER_MPS = 20
/** Time constant for the heading to settle onto the road tangent. */
export const MOTION_HEADING_TIME_S = 0.18
/** Frame gaps longer than this (tab switch, jank) are stepped as this instead. */
const MAX_FRAME_S = 0.1
/** A gap since the last frame longer than this means the loop was not running. */
const STALE_FRAME_MS = 50
/** An offset this small is finished; it is zeroed so the loop can stop. */
const SETTLE_EPSILON = 0.02

export type VehicleFix = {
  /** Distance along the route (route mode) or an axis in metres (planar mode). */
  progressMeters: number
  atMs: number
  reportedSpeedMps?: number | null
}

export type VehicleMotionState = {
  fixProgressMeters: number
  fixAtMs: number
  /** Filtered ground speed used for prediction. */
  speedMps: number
  /** Change in Doppler speed between the last two fixes; lets the prediction brake and pull away with the vehicle. */
  accelMps2: number
  reportedSpeedMps: number | null
  /** The last speed the phone actually reported was a standstill. A fix that carries
   * no reading at all (a network fix, a weak sky) leaves this standing rather than
   * refuting it, so alternating readings cannot keep a parked vehicle unrecognised. */
  reportedStill: boolean
  /** The last fix fell outside the hold radius of a standstill the phone was reporting. */
  lastFixStrayed: boolean
  /** Drawn position minus predicted position; worked off toward zero. */
  offsetMeters: number
  offsetVelocityMps: number
  /** Acceleration budget for the correction in progress. */
  correctionAccelMps2: number
  /** The error was large enough that the icon is being driven backwards to fix it. */
  reversing: boolean
  displayedMeters: number
  displayedVelocityMps: number
  lastStepAtMs: number
}

export type MotionOptions = {
  /** Advance on prediction between fixes. Off for maps that only show reported positions. */
  predict: boolean
}

export function createMotionState(fix: VehicleFix): VehicleMotionState {
  const reported = finiteSpeed(fix.reportedSpeedMps)
  return {
    fixProgressMeters: fix.progressMeters,
    fixAtMs: fix.atMs,
    speedMps: reported ?? 0,
    accelMps2: 0,
    reportedSpeedMps: reported,
    reportedStill: reported !== null && reported < MOTION_STOPPED_READING_MPS,
    lastFixStrayed: false,
    offsetMeters: 0,
    offsetVelocityMps: 0,
    correctionAccelMps2: MOTION_MIN_CORRECTION_ACCEL_MPS2,
    reversing: false,
    displayedMeters: fix.progressMeters,
    displayedVelocityMps: 0,
    lastStepAtMs: fix.atMs,
  }
}

function finiteSpeed(value: number | null | undefined): number | null {
  // Number(null) is 0, which would read as "parked" rather than "no reading".
  if (value === null || value === undefined) return null
  const speed = Number(value)
  // iOS reports -1 when the speed is unknown; treat any negative as "no reading".
  return Number.isFinite(speed) && speed >= 0 ? speed : null
}

const FULL_SPEED_MS = MOTION_MAX_EXTRAPOLATION_MS - MOTION_EXTRAPOLATION_RAMP_MS

/**
 * The prediction after a fix runs in three phases: the vehicle's acceleration is
 * applied for a short horizon (a braking van keeps braking, one pulling away keeps
 * gaining), then the speed holds, then it ramps to zero if no fix has come.
 * This gives the end of the acceleration phase within `untilMs`.
 */
function accelPhase(speedMps: number, accelMps2: number, untilMs: number): { endMs: number; endSpeed: number } {
  if (accelMps2 === 0) return { endMs: 0, endSpeed: speedMps }
  let endMs = Math.min(untilMs, MOTION_ACCEL_HORIZON_MS)
  if (accelMps2 < 0) endMs = Math.min(endMs, (speedMps / -accelMps2) * 1000)
  return { endMs, endSpeed: Math.max(0, speedMps + (accelMps2 * endMs) / 1000) }
}

/** Distance the prediction has advanced `elapsedMs` after a fix, easing to a stop at the cap. */
export function extrapolatedMeters(speedMps: number, elapsedMs: number, accelMps2 = 0): number {
  if (speedMps < MOTION_STATIONARY_SPEED_MPS || elapsedMs <= 0) return 0
  const t = Math.min(elapsedMs, MOTION_MAX_EXTRAPOLATION_MS)
  const { endMs, endSpeed } = accelPhase(speedMps, accelMps2, Math.min(t, FULL_SPEED_MS))
  const accelS = endMs / 1000
  let meters = speedMps * accelS + (accelMps2 * accelS * accelS) / 2
  meters += (endSpeed * (Math.min(t, FULL_SPEED_MS) - endMs)) / 1000
  if (t > FULL_SPEED_MS) {
    // Integral of a speed that falls linearly from endSpeed to 0 across the ramp.
    const intoRamp = t - FULL_SPEED_MS
    meters += (endSpeed * intoRamp * (1 - intoRamp / (2 * MOTION_EXTRAPOLATION_RAMP_MS))) / 1000
  }
  return meters
}

/** Speed the prediction is moving at `elapsedMs` after a fix (the derivative of the above). */
export function extrapolatedSpeedMps(speedMps: number, elapsedMs: number, accelMps2 = 0): number {
  if (speedMps < MOTION_STATIONARY_SPEED_MPS || elapsedMs < 0) return 0
  if (elapsedMs >= MOTION_MAX_EXTRAPOLATION_MS) return 0
  const { endMs, endSpeed } = accelPhase(speedMps, accelMps2, Math.min(elapsedMs, FULL_SPEED_MS))
  if (elapsedMs <= endMs) return Math.max(0, speedMps + (accelMps2 * elapsedMs) / 1000)
  if (elapsedMs <= FULL_SPEED_MS) return endSpeed
  return endSpeed * (1 - (elapsedMs - FULL_SPEED_MS) / MOTION_EXTRAPOLATION_RAMP_MS)
}

function predictedMeters(state: VehicleMotionState, nowMs: number, options: MotionOptions): number {
  if (!options.predict) return state.fixProgressMeters
  return state.fixProgressMeters + extrapolatedMeters(state.speedMps, nowMs - state.fixAtMs, state.accelMps2)
}

function predictedSpeed(state: VehicleMotionState, nowMs: number, options: MotionOptions): number {
  if (!options.predict) return 0
  return extrapolatedSpeedMps(state.speedMps, nowMs - state.fixAtMs, state.accelMps2)
}

/** The frame time the drawn position belongs to, for folding a fix in without a jump. */
function anchorTimeFor(state: VehicleMotionState, fix: VehicleFix): number {
  return fix.atMs - state.lastStepAtMs > STALE_FRAME_MS ? fix.atMs : state.lastStepAtMs
}

/** Prediction at a time that may precede the fix (linear backwards) or follow it (extrapolated). */
function predictedMetersAt(state: VehicleMotionState, atMs: number, options: MotionOptions): number {
  if (!options.predict) return state.fixProgressMeters
  if (atMs >= state.fixAtMs) return predictedMeters(state, atMs, options)
  const speed = state.speedMps < MOTION_STATIONARY_SPEED_MPS ? 0 : state.speedMps
  return state.fixProgressMeters - (speed * (state.fixAtMs - atMs)) / 1000
}

/**
 * Acceleration that works off `errorMeters` from rest in the time allowed: about
 * MOTION_MAX_CORRECTION_TIME_S for a prediction's error, and
 * MOTION_REPORT_ARRIVAL_TIME_S for the way to a newly reported position.
 */
function correctionAccelFor(errorMeters: number, options: MotionOptions): number {
  const t = options.predict ? MOTION_MAX_CORRECTION_TIME_S : MOTION_REPORT_ARRIVAL_TIME_S
  // Braking at the full budget covers d from rest in t when the budget is 4d/t².
  // The way to a report is braked at half of it (see closingSpeedMps), which
  // takes 6d/t² to land in the same time.
  const factor = options.predict ? 4 : 6
  return Math.max(MOTION_MIN_CORRECTION_ACCEL_MPS2, (factor * Math.abs(errorMeters)) / (t * t))
}

/**
 * Fold a new fix into the model without moving the drawn icon.
 *
 * The speed estimate blends the GPS-reported speed with the distance covered
 * since the previous fix, then low-passes the result so one noisy fix cannot make
 * the icon lurch. The prediction re-anchors on the new fix; whatever that changes
 * about "where the icon should be right now" goes into the error offset, and the
 * offset velocity is set so the drawn velocity is unchanged this frame.
 */
export function acceptFix(state: VehicleMotionState, fix: VehicleFix, options: MotionOptions): VehicleMotionState {
  const dtS = (fix.atMs - state.fixAtMs) / 1000
  const reported = finiteSpeed(fix.reportedSpeedMps)
  // Distance over time is only meaningful once fixes are far enough apart, and
  // even then it inherits the position noise: 3 m of error on a 1 s gap is 3 m/s.
  // The phone's Doppler speed is far steadier, so it leads when available.
  const movedMeters = fix.progressMeters - state.fixProgressMeters
  const measuredRaw = dtS >= 0.25 ? Math.max(0, movedMeters / dtS) : null
  const jumpMeters = fix.progressMeters - state.displayedMeters

  // A parked vehicle's fixes wander by metres per second though nothing moves.
  // Doppler says so directly, and it is the one reading the wandering cannot
  // fake, so the model's own estimate is not asked to confirm it: where there is
  // no Doppler that estimate is measured from these same fixes, and a distance is
  // never negative, so noise rectifies into a speed that never falls to zero and
  // a parked vehicle would never be recognised as one.
  //
  // A phone is believed once it has reported a standstill twice running, or once
  // the model already had the vehicle stopped, and only while its fixes stay within
  // the hold radius of the anchor. That anchor is frozen for as long as the hold
  // lasts, so a parked vehicle's wandering is measured from one fixed point and
  // stays inside the radius, while a vehicle that has really pulled away walks out
  // of it within a fix or two. A single bad reading therefore cannot freeze a
  // moving vehicle, and a phone that keeps insisting on a standstill it is not at
  // is released as soon as its own positions say otherwise - twice running, since
  // a street canyon's wander reaches past the radius now and then, and reversing
  // a parked icon down the road to meet one such fix is exactly what the hold is for.
  //
  // Where the phone has never said anything about its speed, staying inside the
  // deadband is all there is to go on. Such a fix contributes no speed, and the
  // icon is held where it is drawn rather than fidgeting after the noise.
  const wasParked = state.speedMps < MOTION_STATIONARY_SPEED_MPS
  const insideDeadband = Math.abs(jumpMeters) < MOTION_PARKED_DEADBAND_METERS
  const readingStill = reported !== null &&
    reported < (state.reportedStill ? MOTION_PULL_AWAY_READING_MPS : MOTION_STOPPED_READING_MPS)
  // A fix carrying no speed at all is no news about speed - a network fix, a weak
  // sky - so the phone's last word on it stands rather than being read as movement.
  const phoneSaysStill = reported === null ? state.reportedStill : readingStill
  const believedStill = phoneSaysStill && (state.reportedStill || wasParked)
  const outsideHold = Math.abs(movedMeters) >= MOTION_PARKED_HOLD_METERS
  const stray = believedStill && outsideHold && !state.lastFixStrayed
  const stationary = phoneSaysStill
    ? believedStill && (!outsideHold || stray)
    : reported === null && wasParked && insideDeadband
  // A standstill the positions agree with contributes no speed at all: the distance
  // beside it is the wandering, and letting even a fifteenth of it through keeps the
  // estimate off zero fix after fix.
  const measured = stationary ? 0 : measuredRaw
  // Nor does the reading beside it: a standstill read as half a metre per second
  // would still pace the prediction forward from under a held icon. And a
  // standstill the positions flatly contradict is not a speed reading at all. Left
  // in the blend it would carry most of the weight and pace the icon at a fraction
  // of a vehicle that is plainly covering ground, dropping it further behind at every fix.
  const trusted = stationary ? 0 : phoneSaysStill && outsideHold ? null : reported
  const raw = trusted !== null && measured !== null
    ? trusted * MOTION_REPORTED_SPEED_WEIGHT + measured * (1 - MOTION_REPORTED_SPEED_WEIGHT)
    : trusted ?? measured ?? state.speedMps
  const filterTimeS = trusted !== null ? MOTION_SPEED_FILTER_TIME_S : MOTION_MEASURED_SPEED_FILTER_TIME_S
  const alpha = dtS > 0 ? 1 - Math.exp(-dtS / filterTimeS) : 1
  const speedMps = Math.max(0, state.speedMps + (raw - state.speedMps) * alpha)
  // Two Doppler readings give the vehicle's acceleration, which the prediction
  // carries forward so that braking and pulling away are followed rather than
  // discovered a fix late. Position-derived speeds are far too noisy for this.
  const accelMps2 = trusted !== null && state.reportedSpeedMps !== null && dtS >= 0.5 && !stationary
    ? Math.max(-MOTION_MAX_DECEL_MPS2, Math.min(MOTION_MAX_ACCEL_MPS2, (trusted - state.reportedSpeedMps) / dtS))
    : 0
  // Holding freezes the anchor under the icon, so only do it when the icon is
  // still enough to stop within half a metre of where it is. A phone reporting
  // its own standstill is worth holding through far more noise than the deadband:
  // a network or cold fix lands tens of metres away, and gliding out to meet it
  // is the drifting-while-parked that the deadband exists to prevent.
  const stoppingMeters = (state.offsetVelocityMps * state.offsetVelocityMps) / (2 * state.correctionAccelMps2)
  const held = stationary && stoppingMeters < 0.5 &&
    (stray || Math.abs(jumpMeters) < (phoneSaysStill ? MOTION_PARKED_HOLD_METERS : MOTION_PARKED_DEADBAND_METERS))
  const progressMeters = held ? state.displayedMeters : fix.progressMeters

  const next: VehicleMotionState = {
    ...state,
    fixProgressMeters: progressMeters,
    fixAtMs: fix.atMs,
    speedMps,
    accelMps2,
    reportedSpeedMps: reported,
    reportedStill: phoneSaysStill,
    lastFixStrayed: phoneSaysStill && outsideHold,
  }
  // Re-anchor without a visible jump. The drawn position is as of the last frame,
  // so compare it with where the new prediction says the vehicle was *then*; the
  // next frame then advances both together. If frames stopped a while ago (the
  // icon had settled, or the browser stalled) the icon has not moved since, and
  // anchoring at the fix keeps the gap from being replayed as a leap.
  const anchorMs = anchorTimeFor(state, fix)
  next.lastStepAtMs = anchorMs
  next.offsetMeters = state.displayedMeters - predictedMetersAt(next, anchorMs, options)
  next.offsetVelocityMps = state.displayedVelocityMps - predictedSpeed(next, Math.max(fix.atMs, anchorMs), options)
  if (Math.abs(next.offsetMeters) > MOTION_SNAP_ERROR_METERS) {
    next.offsetMeters = 0
    next.offsetVelocityMps = 0
    next.displayedMeters = predictedMetersAt(next, anchorMs, options)
    next.displayedVelocityMps = predictedSpeed(next, Math.max(fix.atMs, anchorMs), options)
  }
  // A correction already under way keeps its budget: fixes keep arriving while
  // it runs and each one re-measures roughly the same shrinking error, which
  // must not be mistaken for a smaller job and braked into an overshoot. And when
  // the vehicle's own speed changed, the icon must follow at a comparable rate
  // or it sails on past a braking van.
  const underWay = Math.abs(state.offsetVelocityMps) > MOTION_STATIONARY_SPEED_MPS
  next.correctionAccelMps2 = Math.max(
    correctionAccelFor(next.offsetMeters, options),
    underWay ? state.correctionAccelMps2 : 0,
    Math.abs(next.offsetVelocityMps) / MOTION_CARRIED_SPEED_TIME_S
  )
  // Backing the icon up is only ever worth it for a large error, and once begun
  // it runs to completion rather than stalling as the error dips below the line.
  next.reversing = next.offsetMeters > 0 && (state.reversing || next.offsetMeters >= MOTION_REVERSE_ERROR_METERS)
  return next
}

/**
 * The speed at which the icon should be closing the offset right now.
 *
 * With prediction the offset is an error to erase, so the icon eases onto the
 * prediction. Without prediction the offset is the way to the last reported
 * position, which is where the icon belongs - the maps that show reports alone
 * also mark that position - so it covers it within its budget and stops on it.
 * Pacing itself to trail a report behind instead kept it moving, but 50 m down
 * the road from the mark at a report every five seconds. Either way it never
 * exceeds the speed from which it can still stop on target, and the last stretch
 * is an easing approach rather than braking on the stopping curve to the end.
 */
function closingSpeedMps(state: VehicleMotionState, options: MotionOptions): number {
  const distance = Math.abs(state.offsetMeters)
  const accel = state.correctionAccelMps2
  if (options.predict) return Math.min(Math.sqrt(2 * accel * distance), distance / MOTION_CORRECTION_TIME_S)
  // At the speeds this reaches, braking on the full-budget curve lags it by a
  // frame and carries the icon past the report. Braking on half the budget leaves
  // the other half to hold the curve, and the easing approach below it needs no
  // more than the whole budget where the two meet.
  return Math.min(Math.sqrt(accel * distance), distance / (MOTION_REPORT_ARRIVAL_TIME_S / 8))
}

/**
 * One frame of working the error offset toward that speed, which it may approach
 * only at the acceleration budget - never as a jump.
 */
function stepCorrection(
  offsetMeters: number,
  offsetVelocityMps: number,
  accelMps2: number,
  dtS: number,
  maxSpeedMps: number,
  closingSpeed: number
): [number, number] {
  const desired = -Math.sign(offsetMeters) * Math.min(closingSpeed, maxSpeedMps)
  const maxChange = accelMps2 * dtS
  const change = Math.max(-maxChange, Math.min(maxChange, desired - offsetVelocityMps))
  const velocity = offsetVelocityMps + change
  // Carried velocity may cross zero; the overshoot is at most v²/2a - centimetres -
  // and the controller turns it around. Clamping at zero instead would move the
  // icon by that much within one frame, which reads as a flicker in velocity.
  return [offsetMeters + velocity * dtS, velocity]
}

/** Advance the drawn position to `nowMs`. Call once per animation frame. */
export function stepMotion(state: VehicleMotionState, nowMs: number, options: MotionOptions): VehicleMotionState {
  const dtS = Math.min(MAX_FRAME_S, Math.max(0, (nowMs - state.lastStepAtMs) / 1000))
  if (dtS === 0) return state
  const target = predictedMeters(state, nowMs, options)
  const targetSpeed = predictedSpeed(state, nowMs, options)
  // With prediction the icon may only be drawn moving a little faster than the
  // vehicle is, whatever the error. Without it the correction is the way to the
  // report, which the budget above already paces to arrive in time.
  const catchUpCeiling = options.predict
    ? Math.max(1, state.speedMps + MOTION_MAX_CATCHUP_SPEED_MPS - targetSpeed)
    : Number.POSITIVE_INFINITY
  let [offsetMeters, offsetVelocityMps] = stepCorrection(
    state.offsetMeters, state.offsetVelocityMps, state.correctionAccelMps2, dtS, catchUpCeiling,
    closingSpeedMps(state, options)
  )
  // A vehicle following a road does not reverse to fix a few metres of error; it
  // slows and lets the prediction catch up. Bounding the pull to a share of the
  // prediction's own speed keeps the icon rolling forward, just slower. The bound
  // is approached within the acceleration budget like everything else, so a
  // vehicle pulling away under a backing-up icon turns it around smoothly. Real
  // backtracking shows up as a large error and is allowed through. A vehicle that
  // has stopped does not back up either: a fix landing short of where the icon
  // came to rest is the same GPS noise, and sliding back to it read as the van
  // reversing at every red light. The icon brakes to rest instead. Prediction only
  // ever runs along a road, so only there is a decrease the vehicle backing up;
  // on the plane's east and north axes it is just the direction of travel.
  const moving = targetSpeed >= MOTION_STATIONARY_SPEED_MPS
  const reversing = state.reversing && offsetMeters > 0
  const forwardOnly = options.predict && !reversing
  if (forwardOnly) {
    const slowestVelocity = moving ? -(1 - MOTION_MIN_SPEED_FRACTION) * targetSpeed : -targetSpeed
    const floor = Math.min(slowestVelocity, state.offsetVelocityMps + state.correctionAccelMps2 * dtS)
    if (offsetVelocityMps < floor) {
      offsetVelocityMps = floor
      offsetMeters = state.offsetMeters + offsetVelocityMps * dtS
    }
  }
  // Once the correction is down to centimetres it is finished: fold what is left
  // into the anchor so the drawn position does not move, and stop the loop. So
  // too once a stopped icon has braked to rest short of a correction backwards:
  // the vehicle is taken to be where it is drawn. Not before the prediction itself
  // has stopped, though, or the icon would pick its last few centimetres a second
  // back up in one frame.
  let correctionAccelMps2 = state.correctionAccelMps2
  let fixProgressMeters = state.fixProgressMeters
  const restingAhead = forwardOnly && targetSpeed < SETTLE_EPSILON && offsetMeters > 0 &&
    offsetVelocityMps + targetSpeed < SETTLE_EPSILON
  if (restingAhead || (Math.abs(offsetMeters) < SETTLE_EPSILON && Math.abs(offsetVelocityMps) < SETTLE_EPSILON)) {
    fixProgressMeters += offsetMeters
    offsetMeters = 0
    offsetVelocityMps = 0
    correctionAccelMps2 = MOTION_MIN_CORRECTION_ACCEL_MPS2
  }
  const displayedMeters = target + (fixProgressMeters - state.fixProgressMeters) + offsetMeters
  const displayedVelocityMps = (displayedMeters - state.displayedMeters) / dtS

  return {
    ...state,
    fixProgressMeters,
    offsetMeters,
    offsetVelocityMps,
    correctionAccelMps2,
    reversing,
    displayedMeters,
    displayedVelocityMps,
    lastStepAtMs: nowMs,
  }
}

/** Whether the icon is still moving or converging, i.e. frames are still needed. */
export function isMotionSettled(state: VehicleMotionState, nowMs: number, options: MotionOptions): boolean {
  if (state.offsetMeters !== 0 || state.offsetVelocityMps !== 0) return false
  return predictedSpeed(state, nowMs, options) < 0.01
}

/** Snap the model to a fix with no motion, for tabs that were in the background. */
export function resetMotion(state: VehicleMotionState | undefined, fix: VehicleFix): VehicleMotionState {
  const fresh = createMotionState(fix)
  return state ? { ...fresh, speedMps: state.speedMps } : fresh
}

/**
 * Re-express the model in new coordinates (a replacement route, or a switch
 * between route and planar tracking) without moving the icon: it stays at
 * `displayedMeters` with `displayedVelocityMps`, and the new fix's disagreement
 * becomes an offset to work off as usual.
 */
export function rebaseMotion(
  previous: VehicleMotionState,
  fix: VehicleFix,
  displayedMeters: number,
  displayedVelocityMps: number,
  options: MotionOptions
): VehicleMotionState {
  const anchorMs = anchorTimeFor(previous, fix)
  const next: VehicleMotionState = {
    ...createMotionState(fix),
    speedMps: previous.speedMps,
    accelMps2: previous.accelMps2,
    displayedMeters,
    displayedVelocityMps,
    lastStepAtMs: anchorMs,
  }
  next.offsetMeters = displayedMeters - predictedMetersAt(next, anchorMs, options)
  next.offsetVelocityMps = displayedVelocityMps - predictedSpeed(next, Math.max(fix.atMs, anchorMs), options)
  if (Math.abs(next.offsetMeters) > MOTION_SNAP_ERROR_METERS) return resetMotion(previous, fix)
  // As in acceptFix, a correction under way keeps its budget: a road redrawn while
  // the icon is on its way to a report is the same journey, not a new one to pace
  // from the start.
  const underWay = Math.abs(previous.offsetVelocityMps) > MOTION_STATIONARY_SPEED_MPS
  next.correctionAccelMps2 = Math.max(
    correctionAccelFor(next.offsetMeters, options),
    underWay ? previous.correctionAccelMps2 : 0,
    Math.abs(next.offsetVelocityMps) / MOTION_CARRIED_SPEED_TIME_S
  )
  next.reversing = next.offsetMeters >= MOTION_REVERSE_ERROR_METERS
  return next
}

// ---------------------------------------------------------------------------------
// Heading

export function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360
}

export function shortestHeadingDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

/**
 * The phone's bearing, when it is moving fast enough by its own account for one to
 * mean anything. At rest many phones repeat their last bearing or report any at
 * all, and deciding from that which way the van faced along the road turned a
 * parked van round to face back down it.
 */
export function movingBearing(heading: number | null | undefined, speedMps: number | null | undefined): number | null {
  const speed = finiteSpeed(speedMps)
  if (speed === null || speed < MOTION_PULL_AWAY_READING_MPS) return null
  if (heading === null || heading === undefined || !Number.isFinite(heading) || heading < 0) return null
  return normalizeHeading(heading)
}

/**
 * Turn the drawn heading toward the road tangent at a rate a vehicle could
 * actually turn: quick at speed, slow when creeping, held when parked so GPS
 * jitter cannot spin a stationary van.
 */
export function stepHeading(
  current: number | null,
  desired: number | null,
  speedMps: number,
  dtS: number
): number | null {
  if (desired === null || !Number.isFinite(desired)) return current
  if (current === null || !Number.isFinite(current)) return normalizeHeading(desired)
  if (speedMps < MOTION_STATIONARY_SPEED_MPS) return current
  const delta = shortestHeadingDelta(current, desired)
  const maxRate = Math.min(
    MOTION_TURN_RATE_MAX_DPS,
    Math.max(MOTION_TURN_RATE_MIN_DPS, MOTION_TURN_RATE_MIN_DPS + MOTION_TURN_RATE_PER_MPS * speedMps)
  )
  const eased = delta * (1 - Math.exp(-dtS / MOTION_HEADING_TIME_S))
  const limited = Math.sign(delta) * Math.min(Math.abs(eased), maxRate * dtS)
  return normalizeHeading(current + limited)
}
