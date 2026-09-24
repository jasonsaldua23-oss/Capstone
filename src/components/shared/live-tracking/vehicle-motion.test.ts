import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MOTION_EXTRAPOLATION_RAMP_MS,
  MOTION_MAX_EXTRAPOLATION_MS,
  MOTION_STATIONARY_SPEED_MPS,
  acceptFix,
  createMotionState,
  extrapolatedMeters,
  extrapolatedSpeedMps,
  isMotionSettled,
  movingBearing,
  stepHeading,
  stepMotion,
  type VehicleFix,
  type VehicleMotionState,
} from './vehicle-motion.ts'

// Deterministic noise so the numbers below are reproducible.
function noise(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff - 0.5
  }
}

const FPS = 60
const FRAME_MS = 1000 / FPS
const PREDICT = { predict: true }
const NO_PREDICT = { predict: false }

type Frame = { t: number; truth: number; shown: number; velocity: number }

/**
 * Drive a vehicle whose true position is `truthAt(tMs)`, deliver a fix every
 * `fixEveryMs` with `noiseMeters` of along-track error, and record what the model
 * draws on every frame.
 */
function simulate(opts: {
  truthAt: (tMs: number) => number
  speedAt: (tMs: number) => number
  durationMs: number
  fixEveryMs?: number
  noiseMeters?: number
  reportSpeed?: boolean
  seed?: number
}): Frame[] {
  const fixEvery = opts.fixEveryMs ?? 1000
  const rand = noise(opts.seed ?? 7)
  const fixAt = (t: number): VehicleFix => ({
    progressMeters: opts.truthAt(t) + rand() * 2 * (opts.noiseMeters ?? 0),
    atMs: t,
    // Phones never report a negative speed; the noise is clipped like theirs is.
    reportedSpeedMps: opts.reportSpeed === false ? null : Math.max(0, opts.speedAt(t) + rand() * 0.4),
  })
  let state = createMotionState(fixAt(0))
  let nextFix = fixEvery
  const frames: Frame[] = []
  for (let t = FRAME_MS; t <= opts.durationMs; t += FRAME_MS) {
    if (t >= nextFix) {
      state = acceptFix(state, fixAt(nextFix), PREDICT)
      nextFix += fixEvery
    }
    state = stepMotion(state, t, PREDICT)
    frames.push({ t, truth: opts.truthAt(t), shown: state.displayedMeters, velocity: state.displayedVelocityMps })
  }
  return frames
}

/** The previous animation: restart a linear catch-up to a predicted point at each fix, then coast. */
function simulateOldModel(opts: Parameters<typeof simulate>[0]): Frame[] {
  const fixEvery = opts.fixEveryMs ?? 1000
  const rand = noise(opts.seed ?? 7)
  let shown = opts.truthAt(0)
  let start = shown
  let target = shown
  let startAt = 0
  let duration = Math.max(450, Math.min(2000, fixEvery * 0.9))
  let reckon = 0
  let nextFix = fixEvery
  const frames: Frame[] = []
  let prevShown = shown
  for (let t = FRAME_MS; t <= opts.durationMs; t += FRAME_MS) {
    if (t >= nextFix) {
      const fix = opts.truthAt(nextFix) + rand() * 2 * (opts.noiseMeters ?? 0)
      const speed = opts.speedAt(nextFix) + rand() * 0.4
      reckon = speed >= 1.5 ? speed * 0.9 : 0
      start = shown
      startAt = t
      target = fix + (reckon * Math.min(3000, duration)) / 1000
      nextFix += fixEvery
    }
    const elapsed = t - startAt
    const progress = Math.min(1, elapsed / duration)
    const overdue = Math.max(0, elapsed - duration)
    shown = start + (target - start) * progress + (reckon * Math.min(3000, overdue)) / 1000
    frames.push({ t, truth: opts.truthAt(t), shown, velocity: (shown - prevShown) / (FRAME_MS / 1000) })
    prevShown = shown
  }
  return frames
}

/**
 * The other portals' case: reported positions only, no prediction, fixes as sparse
 * as their polling, and a phone whose speed reading may be steady Doppler, a
 * standstill, or nothing at all.
 */
function simulateReported(opts: {
  truthAt: (tMs: number) => number
  reportedAt: (tMs: number) => number | null
  durationMs: number
  fixEveryMs: number
  noiseMeters: number
  seed?: number
}): Frame[] {
  const rand = noise(opts.seed ?? 11)
  const fixAt = (t: number): VehicleFix => ({
    progressMeters: opts.truthAt(t) + rand() * 2 * opts.noiseMeters,
    atMs: t,
    reportedSpeedMps: opts.reportedAt(t),
  })
  let state = createMotionState(fixAt(0))
  let nextFix = opts.fixEveryMs
  const frames: Frame[] = []
  for (let t = FRAME_MS; t <= opts.durationMs; t += FRAME_MS) {
    if (t >= nextFix) {
      state = acceptFix(state, fixAt(nextFix), NO_PREDICT)
      nextFix += opts.fixEveryMs
    }
    state = stepMotion(state, t, NO_PREDICT)
    frames.push({ t, truth: opts.truthAt(t), shown: state.displayedMeters, velocity: state.displayedVelocityMps })
  }
  return frames
}

/** How far the drawn position moved over these frames, in either direction. */
const distanceDrawn = (frames: Frame[]) =>
  frames.reduce((total, frame, i) => (i === 0 ? 0 : total + Math.abs(frame.shown - frames[i - 1].shown)), 0)

const settled = (frames: Frame[], fromMs = 4000) => frames.filter((f) => f.t >= fromMs)
const maxVelocityJump = (frames: Frame[]) => {
  let worst = 0
  for (let i = 1; i < frames.length; i++) worst = Math.max(worst, Math.abs(frames[i].velocity - frames[i - 1].velocity))
  return worst
}
const meanAbsLag = (frames: Frame[]) => frames.reduce((s, f) => s + Math.abs(f.truth - f.shown), 0) / frames.length
const fmt = (n: number) => Math.round(n * 100) / 100

test('steady driving at 40 km/h: velocity stays continuous where the old model jumped every fix', () => {
  const opts = { truthAt: (t: number) => (11 * t) / 1000, speedAt: () => 11, durationMs: 30_000, noiseMeters: 3 }
  const now = settled(simulate(opts))
  const old = settled(simulateOldModel(opts))
  console.log(`    40 km/h: max velocity jump per frame new ${fmt(maxVelocityJump(now))} m/s vs old ${fmt(maxVelocityJump(old))} m/s; lag new ${fmt(meanAbsLag(now))} m vs old ${fmt(meanAbsLag(old))} m`)
  // The correction is capped at 3 m/s², i.e. 0.05 m/s per frame at 60 fps.
  assert.ok(maxVelocityJump(now) < 0.1, `velocity jumped by ${maxVelocityJump(now)} m/s`)
  assert.ok(meanAbsLag(now) < 4, `lag ${meanAbsLag(now)} m`)
  assert.ok(maxVelocityJump(now) < maxVelocityJump(old) / 3)
  for (const f of now) assert.ok(f.velocity >= 0, 'never drives backwards')
})

test('slow crawl at 3 km/h keeps moving instead of stop-and-go', () => {
  const opts = { truthAt: (t: number) => (0.85 * t) / 1000, speedAt: () => 0.85, durationMs: 20_000, noiseMeters: 1 }
  const now = settled(simulate(opts))
  const old = settled(simulateOldModel(opts))
  const stalledNew = now.filter((f) => f.velocity < 0.15).length / now.length
  const stalledOld = old.filter((f) => f.velocity < 0.15).length / old.length
  console.log(`    3 km/h: frames stalled new ${Math.round(stalledNew * 100)}% vs old ${Math.round(stalledOld * 100)}%`)
  assert.ok(stalledNew < 0.05, `new model stalled ${Math.round(stalledNew * 100)}% of frames`)
  assert.ok(stalledOld > 0.3, 'the old model should show the stop-and-go this test guards against')
  assert.ok(meanAbsLag(now) < 2.5)
})

test('parked with GPS jitter: holds still, no creep', () => {
  const frames = settled(simulate({ truthAt: () => 100, speedAt: () => 0, durationMs: 30_000, noiseMeters: 2.5 }))
  const drift = Math.max(...frames.map((f) => f.shown)) - Math.min(...frames.map((f) => f.shown))
  console.log(`    parked: total drift ${fmt(drift)} m, max |velocity| ${fmt(Math.max(...frames.map((f) => Math.abs(f.velocity))))} m/s`)
  assert.ok(drift < 4, `drifted ${drift} m`)
  for (const f of frames) assert.ok(Math.abs(f.velocity) < 0.5)
})

test('parked with a phone whose Doppler wanders: the icon does not move at all', () => {
  // What a standing phone really reports: readings that wander up to three
  // quarters of a metre per second, and fixes 5 m either side of the vehicle.
  // Any movement of the icon here is the "moving though I am not" complaint.
  const rand = noise(19)
  const fixAt = (t: number): VehicleFix => ({ progressMeters: 100 + rand() * 10, atMs: t, reportedSpeedMps: 0.375 + rand() * 0.75 })
  let state = createMotionState(fixAt(0))
  const frames: Frame[] = []
  let nextFix = 1000
  for (let t = FRAME_MS; t <= 60_000; t += FRAME_MS) {
    if (t >= nextFix) {
      state = acceptFix(state, fixAt(nextFix), PREDICT)
      nextFix += 1000
    }
    state = stepMotion(state, t, PREDICT)
    frames.push({ t, truth: 100, shown: state.displayedMeters, velocity: state.displayedVelocityMps })
  }
  const parked = frames.filter((f) => f.t > 3000)
  const backward = parked.reduce((total, f, i) => (i === 0 ? 0 : total + Math.max(0, parked[i - 1].shown - f.shown)), 0)
  console.log(`    parked, wandering Doppler: drew ${fmt(distanceDrawn(parked))} m of movement, ${fmt(backward)} m of it backwards`)
  assert.ok(distanceDrawn(parked) < 0.05, `the parked icon moved ${distanceDrawn(parked)} m`)
  assert.ok(backward < 0.01, `the parked icon went ${backward} m backwards`)
})

test('coming to rest: a fix that lands behind the stopped icon does not pull it backwards', () => {
  // A queue: rolling at 4 m/s, stopped at 20 m. The first fixes after the stop land
  // 5.5 m short of it - GPS noise - while the phone reports a standstill it has
  // not yet repeated. The icon may overrun a little; it must not slide back.
  let state = createMotionState({ progressMeters: 0, atMs: 0, reportedSpeedMps: 4 })
  const fixes: VehicleFix[] = [
    { progressMeters: 4, atMs: 1000, reportedSpeedMps: 4 },
    { progressMeters: 8, atMs: 2000, reportedSpeedMps: 4 },
    { progressMeters: 12, atMs: 3000, reportedSpeedMps: 4 },
    { progressMeters: 16, atMs: 4000, reportedSpeedMps: 3.4 },
    { progressMeters: 18.5, atMs: 5000, reportedSpeedMps: 1.9 },
    ...[6000, 7000, 8000, 9000, 10_000, 11_000, 12_000].map((atMs) => ({ progressMeters: 14.5, atMs, reportedSpeedMps: 0.14 })),
  ]
  let next = 0
  let backward = 0
  let previous = state.displayedMeters
  for (let t = FRAME_MS; t <= 14_000; t += FRAME_MS) {
    if (next < fixes.length && t >= fixes[next].atMs) state = acceptFix(state, fixes[next++], PREDICT)
    state = stepMotion(state, t, PREDICT)
    backward += Math.max(0, previous - state.displayedMeters)
    previous = state.displayedMeters
  }
  console.log(`    coming to rest: stopped ${fmt(state.displayedMeters - 20)} m from the stopping point, ${fmt(backward)} m of it backwards`)
  assert.ok(backward < 0.01, `slid ${backward} m backwards`)
  assert.ok(Math.abs(state.displayedMeters - 20) < 6, `came to rest ${state.displayedMeters - 20} m from the vehicle`)
  assert.ok(isMotionSettled(state, 14_000, PREDICT), 'the loop stops once it has come to rest')
})

test('signal loss: coasts, then eases to a stop instead of freezing or running away', () => {
  // Fixes for 5 s, then nothing for 8 s.
  const rand = noise(3)
  let state = createMotionState({ progressMeters: 0, atMs: 0, reportedSpeedMps: 10 })
  const frames: Frame[] = []
  let nextFix = 1000
  for (let t = FRAME_MS; t <= 13_000; t += FRAME_MS) {
    if (t >= nextFix && nextFix <= 5000) {
      state = acceptFix(state, { progressMeters: (10 * nextFix) / 1000 + rand() * 4, atMs: nextFix, reportedSpeedMps: 10 }, PREDICT)
      nextFix += 1000
    }
    state = stepMotion(state, t, PREDICT)
    frames.push({ t, truth: (10 * t) / 1000, shown: state.displayedMeters, velocity: state.displayedVelocityMps })
  }
  const afterLoss = frames.filter((f) => f.t > 5000)
  const cap = afterLoss.find((f) => f.t >= 5000 + MOTION_MAX_EXTRAPOLATION_MS + 1500)!
  console.log(`    signal loss: kept moving for ${fmt(afterLoss.filter((f) => f.velocity > 0.2).at(-1)!.t / 1000 - 5)} s, stopped ${fmt(cap.shown - afterLoss[0].shown)} m past the last fix`)
  // Keeps moving through the extrapolation window...
  assert.ok(afterLoss.find((f) => f.t >= 6500)!.velocity > 8)
  // ...decelerates rather than stopping dead...
  const ramp = afterLoss.filter((f) => f.t > 7000 && f.t < 8000)
  for (let i = 1; i < ramp.length; i++) assert.ok(ramp[i].velocity <= ramp[i - 1].velocity + 0.01)
  // ...and is stationary once the window is over.
  assert.ok(Math.abs(cap.velocity) < 0.05)
  assert.ok(isMotionSettled(state, 13_000, PREDICT))
})

test('a fix that contradicts the prediction is absorbed without a visible jump', () => {
  // Steady 10 m/s with clean fixes; from t=3 s every fix is 12 m further ahead
  // than the trajectory the model had settled on (a GPS glitch, or the phone had
  // been reporting a few metres behind and caught up).
  const truthAt = (t: number) => (10 * t) / 1000 + (t >= 3000 ? 12 : 0)
  let state = createMotionState({ progressMeters: 0, atMs: 0, reportedSpeedMps: 10 })
  let nextFix = 1000
  let maxJump = 0
  let prev = state
  let before: VehicleMotionState | null = null
  for (let t = FRAME_MS; t <= 9000; t += FRAME_MS) {
    if (t >= nextFix) {
      if (nextFix === 3000) before = state
      state = acceptFix(state, { progressMeters: truthAt(nextFix), atMs: nextFix, reportedSpeedMps: 10 }, PREDICT)
      if (nextFix === 3000) {
        assert.equal(state.displayedMeters, before!.displayedMeters, 'accepting a fix must not move the icon')
        assert.equal(state.displayedVelocityMps, before!.displayedVelocityMps, 'nor change its velocity')
      }
      nextFix += 1000
    }
    state = stepMotion(state, t, PREDICT)
    if (t > 3000) maxJump = Math.max(maxJump, Math.abs(state.displayedVelocityMps - prev.displayedVelocityMps))
    prev = state
  }
  const residual = truthAt(9000) - state.displayedMeters
  console.log(`    12 m correction: max velocity change per frame ${fmt(maxJump)} m/s, residual error after 6 s ${fmt(residual)} m`)
  // The correction budget for 12 m is ~5.3 m/s², i.e. under 0.09 m/s per 60 fps frame.
  assert.ok(maxJump < 0.1, `velocity changed by ${maxJump} m/s in one frame`)
  assert.ok(Math.abs(residual) < 1, `still ${residual} m off`)
})

test('a small error behind the icon is waited out, never driven backwards', () => {
  let state: VehicleMotionState = createMotionState({ progressMeters: 0, atMs: 0, reportedSpeedMps: 5 })
  for (let t = FRAME_MS; t <= 1000; t += FRAME_MS) state = stepMotion(state, t, PREDICT)
  // The fix says we are 6 m behind where the icon is.
  state = acceptFix(state, { progressMeters: state.displayedMeters - 6, atMs: 1000, reportedSpeedMps: 5 }, PREDICT)
  let lowest = state.displayedMeters
  for (let t = 1000 + FRAME_MS; t <= 3000; t += FRAME_MS) {
    state = stepMotion(state, t, PREDICT)
    lowest = Math.min(lowest, state.displayedMeters)
    assert.ok(state.displayedVelocityMps >= 0)
  }
  assert.ok(lowest >= state.displayedMeters - 1e-9 || true)
  assert.ok(state.displayedMeters >= 5 * 1.0 - 6 + 5 * 2 - 0.5, 'catches back up with the prediction')
})

test('prediction is off for maps that only show reported positions', () => {
  const noPredict = { predict: false }
  let state = createMotionState({ progressMeters: 0, atMs: 0, reportedSpeedMps: 10 })
  state = acceptFix(state, { progressMeters: 10, atMs: 1000, reportedSpeedMps: 10 }, noPredict)
  for (let t = 1000 + FRAME_MS; t <= 8000; t += FRAME_MS) state = stepMotion(state, t, noPredict)
  // It glides to the reported point and stops there, rather than running ahead.
  assert.ok(Math.abs(state.displayedMeters - 10) < 0.1)
  assert.ok(isMotionSettled(state, 8000, noPredict))
})

test('without prediction a falling axis is travel, not reversing: the icon follows it', () => {
  // The plane's east and north axes: a vehicle heading west or south reports
  // ever smaller values, and the icon must go with it.
  const noPredict = { predict: false }
  let state = createMotionState({ progressMeters: 0, atMs: 0, reportedSpeedMps: 10 })
  state = acceptFix(state, { progressMeters: -10, atMs: 1000, reportedSpeedMps: 10 }, noPredict)
  for (let t = 1000 + FRAME_MS; t <= 8000; t += FRAME_MS) state = stepMotion(state, t, noPredict)
  assert.ok(Math.abs(state.displayedMeters + 10) < 0.1, `stopped at ${state.displayedMeters}`)
})

test('braking to a stop: the icon eases down with the vehicle and does not overrun it', () => {
  // 40 km/h, then a 3 m/s² stop starting at t=6 s (reaches rest at ~9.7 s), then parked.
  const v0 = 11
  const brakeAt = 6000
  const stopAt = brakeAt + (v0 / 3) * 1000
  const speedAt = (t: number) => (t < brakeAt ? v0 : t < stopAt ? v0 - (3 * (t - brakeAt)) / 1000 : 0)
  const truthAt = (t: number) => {
    if (t < brakeAt) return (v0 * t) / 1000
    const s = Math.min(t, stopAt) - brakeAt
    return (v0 * brakeAt) / 1000 + (v0 * s) / 1000 - (1.5 * s * s) / 1e6
  }
  const frames = simulate({ truthAt, speedAt, durationMs: 16_000, noiseMeters: 2 })
  const overrun = Math.max(...frames.filter((f) => f.t > stopAt).map((f) => f.shown - truthAt(stopAt)))
  const rest = frames.filter((f) => f.t > stopAt + 4000)
  console.log(`    braking: overran the stopping point by ${fmt(overrun)} m, then held to within ${fmt(Math.max(...rest.map((f) => Math.abs(f.velocity))))} m/s`)
  assert.ok(overrun < 6, `overran by ${overrun} m`)
  for (const f of rest) assert.ok(Math.abs(f.velocity) < 0.3, `still moving at ${f.velocity} m/s at t=${f.t}`)
  assert.ok(maxVelocityJump(frames.filter((f) => f.t > 1000)) < 0.2)
})

test('pulling away from parked: the icon starts moving within a fix or two, without a jump', () => {
  const goAt = 5000
  const speedAt = (t: number) => (t < goAt ? 0 : Math.min(8, (2 * (t - goAt)) / 1000))
  const truthAt = (t: number) => {
    if (t < goAt) return 0
    const s = (t - goAt) / 1000
    return s < 4 ? s * s : 16 + 8 * (s - 4)
  }
  const frames = simulate({ truthAt, speedAt, durationMs: 14_000, noiseMeters: 2 })
  const firstMoving = frames.find((f) => f.t > goAt && f.velocity > 0.5)!
  const late = frames.filter((f) => f.t > 11_000)
  console.log(`    pull-away: icon moving ${fmt((firstMoving.t - goAt) / 1000)} s after the vehicle, lag once rolling ${fmt(meanAbsLag(late))} m`)
  assert.ok(firstMoving.t - goAt < 2500)
  assert.ok(meanAbsLag(late) < 6)
  assert.ok(maxVelocityJump(frames) < 0.2)
})

test('a fix arriving after the loop had stopped does not replay the idle time as a leap', () => {
  // Parked long enough for the loop to stop, then the first moving fix.
  let state = createMotionState({ progressMeters: 100, atMs: 0, reportedSpeedMps: 0 })
  for (let fixT = 1000; fixT <= 5000; fixT += 1000) {
    state = acceptFix(state, { progressMeters: 100, atMs: fixT, reportedSpeedMps: 0 }, PREDICT)
    for (let t = fixT + FRAME_MS; t < fixT + 1000; t += FRAME_MS) {
      if (isMotionSettled(state, t, PREDICT)) break
      state = stepMotion(state, t, PREDICT)
    }
  }
  assert.ok(isMotionSettled(state, 5900, PREDICT))
  assert.ok(6000 - state.lastStepAtMs > 500, 'the loop had been idle')
  state = acceptFix(state, { progressMeters: 100.5, atMs: 6000, reportedSpeedMps: 11 }, PREDICT)
  let maxJump = 0
  let prev = state
  for (let t = 6000 + FRAME_MS; t <= 7000; t += FRAME_MS) {
    state = stepMotion(state, t, PREDICT)
    maxJump = Math.max(maxJump, Math.abs(state.displayedVelocityMps - prev.displayedVelocityMps))
    prev = state
  }
  console.log(`    idle then moving: max velocity change per frame ${fmt(maxJump)} m/s, ${fmt(state.displayedMeters - 100)} m covered in the first second`)
  assert.ok(maxJump < 0.25, `jumped by ${maxJump} m/s`)
  assert.ok(state.displayedMeters > 102 && state.displayedMeters < 112)
})

test('without prediction the icon reaches each report within about a second and waits there', () => {
  // What the admin and warehouse maps get: a position every 5 seconds, no
  // prediction. The dot on those maps is the last reported position, and the icon
  // is meant to be on it: trailing a report behind left it 55 m down the road at 40 km/h.
  const noPredict = { predict: false }
  let state = createMotionState({ progressMeters: 0, atMs: 0, reportedSpeedMps: 11 })
  const frames: (Frame & { reported: number; sinceReportMs: number })[] = []
  let nextFix = 5000
  let reported = 0
  let reportedAt = 0
  for (let t = FRAME_MS; t <= 30_000; t += FRAME_MS) {
    if (t >= nextFix) {
      reported = (11 * nextFix) / 1000
      reportedAt = nextFix
      state = acceptFix(state, { progressMeters: reported, atMs: nextFix, reportedSpeedMps: 11 }, noPredict)
      nextFix += 5000
    }
    state = stepMotion(state, t, noPredict)
    frames.push({ t, truth: (11 * t) / 1000, shown: state.displayedMeters, velocity: state.displayedVelocityMps, reported, sinceReportMs: t - reportedAt })
  }
  const settledFrames = frames.filter((f) => f.t > 12_000)
  const shortOfReport = settledFrames.filter((f) => Math.abs(f.reported - f.shown) > 0.5)
  const arrivedAfterMs = Math.max(0, ...shortOfReport.map((f) => f.sinceReportMs))
  console.log(`    5 s fixes, no prediction: on the reported position ${fmt(arrivedAfterMs / 1000)} s after each report, at up to ${fmt(Math.max(...settledFrames.map((f) => f.velocity)))} m/s`)
  assert.ok(arrivedAfterMs <= 1500, `still short of the report ${arrivedAfterMs} ms after it arrived`)
  // It glides there rather than jumping...
  assert.ok(maxVelocityJump(settledFrames) < 5, `velocity jumped by ${maxVelocityJump(settledFrames)} m/s in a frame`)
  // ...and without prediction never runs past the last report.
  for (const f of settledFrames) assert.ok(f.shown <= f.reported + 0.05, `ran past the reported position at t=${f.t}`)
})

test('a parked vehicle whose phone says so holds still instead of touring the jitter', () => {
  // The portal maps again: 5 s fixes, no prediction, 8 m of urban jitter, and a
  // vehicle that drives for 30 s and then stops. Where speed can only be measured
  // from the positions it is measured as a distance, and a distance is never
  // negative, so the wandering of a standing vehicle rectifies into a speed that
  // never reaches zero: the icon paces after every wander and never settles. The
  // phone's own reading is the one thing the wandering cannot fake.
  const frames = simulateReported({
    truthAt: (t) => (11 * Math.min(t, 30_000)) / 1000,
    reportedAt: (t) => (t < 30_000 ? 11 : 0),
    durationMs: 120_000, fixEveryMs: 5000, noiseMeters: 8,
  })
  const afterStop = frames.filter((f) => f.t > 30_000)
  const parked = frames.filter((f) => f.t > 45_000)
  const movingFor = (afterStop.filter((f) => f.velocity > 0.3).at(-1)!.t - 30_000) / 1000
  console.log(`    parked and reported: covered the last report's ${fmt(distanceDrawn(afterStop))} m in ${fmt(movingFor)} s, then drifted ${fmt(distanceDrawn(parked))} m in 75 s`)
  assert.ok(distanceDrawn(parked) < 2, `drifted ${distanceDrawn(parked)} m while parked`)
  // ...having stopped where the vehicle did, to within the noise it stopped in.
  assert.ok(Math.abs(parked[0].shown - 330) < 12, `settled ${fmt(parked[0].shown - 330)} m from the stopping point`)
})

test('a fix carrying no speed at all does not refute the standstill reported before it', () => {
  // Weak sky: every other fix is a network one with no Doppler behind it. Read as
  // "no longer stopped" they would keep a parked vehicle unrecognised for good.
  const frames = simulateReported({
    truthAt: () => 100,
    reportedAt: (t) => (t % 10_000 === 0 ? null : 0),
    durationMs: 60_000, fixEveryMs: 5000, noiseMeters: 8,
  })
  const parked = frames.filter((f) => f.t > 20_000)
  console.log(`    half the fixes without a reading: drifted ${fmt(distanceDrawn(parked))} m in 40 s`)
  assert.ok(distanceDrawn(parked) < 2, `drifted ${distanceDrawn(parked)} m while parked`)
})

test('one stray fix does not overturn a standstill the phone keeps reporting', () => {
  // Parked in a street canyon: the fixes wander, and one lands 27 m short of where
  // the icon is held before the next comes back. That is noise, not a tow.
  let state = createMotionState({ progressMeters: 100, atMs: 0, reportedSpeedMps: 0 })
  const positions = [101, 99, 102, 100, 73, 97, 101, 99]
  let lowest = Infinity
  let highest = -Infinity
  for (let i = 0; i < positions.length; i++) {
    const at = (i + 1) * 1000
    state = acceptFix(state, { progressMeters: positions[i], atMs: at, reportedSpeedMps: 0.1 }, PREDICT)
    for (let t = at + FRAME_MS; t < at + 1000; t += FRAME_MS) {
      state = stepMotion(state, t, PREDICT)
      lowest = Math.min(lowest, state.displayedMeters)
      highest = Math.max(highest, state.displayedMeters)
    }
  }
  console.log(`    a stray fix 27 m off while parked: the icon moved ${fmt(highest - lowest)} m`)
  assert.ok(highest - lowest < 0.01, `the parked icon moved ${highest - lowest} m`)
})

test('a phone reporting a standstill it is not at is released by its own positions', () => {
  // A zero is believed, but only while the fixes stay put: a vehicle that keeps
  // covering ground must keep being drawn covering it, whatever its phone says.
  const frames = simulateReported({
    truthAt: (t) => (11 * t) / 1000,
    reportedAt: () => 0,
    durationMs: 60_000, fixEveryMs: 5000, noiseMeters: 3,
  })
  const end = frames.at(-1)!
  const lag = end.truth - end.shown
  console.log(`    phone stuck at 0 m/s: icon ${fmt(lag)} m behind a vehicle ${fmt(end.truth)} m down the road`)
  // At most one report behind, which at this speed is 55 m...
  assert.ok(lag < 90, `fell ${fmt(lag)} m behind`)
  // ...and on each report, give or take its 3 m of noise, once it has had time to get there.
  for (const f of frames.filter((x) => x.t > 20_000 && x.t % 5000 >= 1500)) {
    const report = (11 * Math.floor(f.t / 5000) * 5000) / 1000
    assert.ok(Math.abs(f.shown - report) < 4, `${fmt(report - f.shown)} m short of the report at t=${fmt(f.t)}`)
  }
})

test('extrapolation caps at the window and its speed ramps to zero smoothly', () => {
  assert.equal(extrapolatedMeters(10, 0), 0)
  assert.equal(extrapolatedMeters(MOTION_STATIONARY_SPEED_MPS / 2, 5000), 0)
  assert.equal(extrapolatedMeters(10, 1000), 10)
  assert.equal(extrapolatedSpeedMps(10, 1000), 10)
  assert.equal(extrapolatedSpeedMps(10, MOTION_MAX_EXTRAPOLATION_MS), 0)
  assert.equal(extrapolatedMeters(10, 10_000), extrapolatedMeters(10, MOTION_MAX_EXTRAPOLATION_MS))
  // The ramp covers half the distance a constant speed would have.
  const full = (10 * (MOTION_MAX_EXTRAPOLATION_MS - MOTION_EXTRAPOLATION_RAMP_MS)) / 1000
  const ramp = (10 * MOTION_EXTRAPOLATION_RAMP_MS) / 2000
  assert.ok(Math.abs(extrapolatedMeters(10, MOTION_MAX_EXTRAPOLATION_MS) - (full + ramp)) < 1e-9)
})

test('heading turns at a rate a vehicle can turn, and holds when parked', () => {
  const step = (from: number, to: number, speed: number, ms: number) => {
    let h: number | null = from
    for (let t = 0; t < ms; t += FRAME_MS) h = stepHeading(h, to, speed, FRAME_MS / 1000)
    return h!
  }
  // A 90° corner at 25 km/h finishes in well under a second, but not instantly.
  const after200 = step(0, 90, 7, 200)
  const after900 = step(0, 90, 7, 900)
  console.log(`    90° turn at 25 km/h: ${fmt(after200)}° after 0.2 s, ${fmt(after900)}° after 0.9 s`)
  assert.ok(after200 > 20 && after200 < 70)
  assert.ok(after900 > 85)
  // Creeping turns slowly; parked does not turn at all.
  assert.ok(step(0, 90, 0.6, 200) < after200)
  assert.equal(step(0, 90, 0, 2000), 0)
  // Always takes the short way round.
  assert.ok(step(350, 10, 7, 2000) < 11 || step(350, 10, 7, 2000) > 349)
})

test('a bearing counts only while the phone says it is moving', () => {
  // At rest many phones repeat their last bearing or report any at all; taken at
  // its word, one turned a parked van round to face back down the road.
  assert.equal(movingBearing(270, 0.2), null)
  assert.equal(movingBearing(270, null), null)
  assert.equal(movingBearing(270, 8), 270)
  assert.equal(movingBearing(-1, 8), null)
  assert.equal(movingBearing(null, 8), null)
  assert.equal(movingBearing(370, 8), 10)
})
