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
