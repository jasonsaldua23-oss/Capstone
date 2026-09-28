import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendLeg,
  createPlayout,
  fastForwardPlayout,
  isPlayoutSettled,
  playoutLead,
  playoutPose,
  relocatePlayout,
  stepPlayout,
  type TrackPlayout,
} from './track-playout.ts'

const FRAME_MS = 1000 / 60
const LAT0 = 10.7
const COS = Math.cos((LAT0 * Math.PI) / 180)
// [east, north] metres from a fixed origin to [lat, lng].
const at = (east: number, north = 0): [number, number] => [LAT0 + north / 110540, 122.95 + east / (111320 * COS)]
const meters = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * COS)
const eastLeg = (from: number, to: number): [number, number][] => [at(from), at((from + to) / 2), at(to)]

type Frame = { t: number; point: [number, number]; heading: number | null; speed: number; step: number }

function run(playout: TrackPlayout, fromMs: number, toMs: number, frames: Frame[] = []) {
  let current = playout
  let previous = playoutPose(current).point
  for (let t = fromMs + FRAME_MS; t <= toMs; t += FRAME_MS) {
    current = stepPlayout(current, t)
    const pose = playoutPose(current)
    frames.push({ t, point: pose.point, heading: pose.heading, speed: pose.speedMps, step: meters(previous, pose.point) })
    previous = pose.point
  }
  return { playout: current, frames }
}

test('a leg plays at the speed the vehicle drove it and stops on the report', () => {
  let playout = createPlayout(at(0), 0)
  playout = appendLeg(playout, eastLeg(0, 50), 4500, 0)
  const { playout: done, frames } = run(playout, 0, 7000)
  const mid = frames.filter((f) => f.t > 1500 && f.t < 4000)
  for (const frame of mid) assert.ok(Math.abs(frame.speed - 50 / 4.5) < 0.6, `speed ${frame.speed.toFixed(2)} at ${frame.t.toFixed(0)}`)
  assert.ok(meters(playoutPose(done).point, at(50)) < 0.05, 'did not stop on the report')
  assert.ok(isPlayoutSettled(done))
})

test('reports arriving on time keep the icon rolling without a dip at each one', () => {
  let playout = createPlayout(at(0), 0)
  playout = appendLeg(playout, eastLeg(0, 50), 4500, 0)
  const frames: Frame[] = []
  ;({ playout } = run(playout, 0, 4500, frames))
  playout = appendLeg(playout, eastLeg(50, 100), 4500, 4500)
  ;({ playout } = run(playout, 4500, 9000, frames))
  playout = appendLeg(playout, eastLeg(100, 150), 4500, 9000)
  ;({ playout } = run(playout, 9000, 12000, frames))
  const steady = frames.filter((f) => f.t > 2000 && f.t < 11000)
  const slowest = Math.min(...steady.map((f) => f.speed))
  assert.ok(slowest > 0.9 * (50 / 4.5), `slowed to ${slowest.toFixed(2)} m/s between reports`)
})

test('the icon never passes the newest report and never moves backwards', () => {
  let playout = createPlayout(at(0), 0)
  playout = appendLeg(playout, eastLeg(0, 30), 2000, 0)
  const { frames } = run(playout, 0, 10000)
  for (const frame of frames) {
    const east = (frame.point[1] - 122.95) * 111320 * COS
    assert.ok(east <= 30.001, `drawn ${east.toFixed(3)} m, past the report at 30 m`)
  }
  let east = -Infinity
  for (const frame of frames) {
    const now = (frame.point[1] - 122.95) * 111320 * COS
    assert.ok(now >= east - 1e-6, 'moved backwards')
    east = now
  }
})

test('a burst of late reports is caught up on faster, never by a jump', () => {
  let playout = createPlayout(at(0), 0)
  playout = appendLeg(playout, eastLeg(0, 50), 4500, 0)
  playout = appendLeg(playout, eastLeg(50, 100), 4500, 0)
  playout = appendLeg(playout, eastLeg(100, 150), 4500, 0)
  const { playout: done, frames } = run(playout, 0, 14000)
  const reached = frames.find((f) => meters(f.point, at(150)) < 0.5)
  assert.ok(reached && reached.t < 11000, `took ${reached?.t.toFixed(0)} ms to catch up 13.5 s of driving`)
  const biggestStep = Math.max(...frames.map((f) => f.step))
  assert.ok(biggestStep < 1, `a ${biggestStep.toFixed(2)} m step in one frame`)
  assert.ok(isPlayoutSettled(done))
})

test('the icon turns with the road, smoothly, and ends facing along it', () => {
  let playout = createPlayout(at(0), 0, 90)
  // East 40 m, then a right-angle turn north for 40 m.
  playout = appendLeg(playout, [at(0), at(40), at(40, 40)], 7000, 0)
  const { frames } = run(playout, 0, 9000)
  let largestTurn = 0
  for (let index = 1; index < frames.length; index += 1) {
    const a = frames[index - 1].heading
    const b = frames[index].heading
    if (a === null || b === null) continue
    largestTurn = Math.max(largestTurn, Math.abs(((b - a + 540) % 360) - 180))
  }
  assert.ok(largestTurn < 6, `turned ${largestTurn.toFixed(1)} degrees in one frame`)
  const last = frames[frames.length - 1].heading ?? -1
  assert.ok(Math.abs(((last - 0 + 540) % 360) - 180) < 3, `ended facing ${last.toFixed(1)}, not north`)
})

test('a parked vehicle stays put and keeps its heading', () => {
  const playout = createPlayout(at(0), 0, 90)
  const { frames } = run(playout, 0, 3000)
  assert.ok(frames.every((f) => f.step === 0 && f.heading === 90))
  assert.ok(isPlayoutSettled(playout))
})

test('a leg matched from a slightly different point is joined on, not jumped to', () => {
  let playout = createPlayout(at(0), 0)
  playout = appendLeg(playout, eastLeg(0, 50), 4500, 0)
  ;({ playout } = run(playout, 0, 4500))
  // The next leg starts 6 m north of where the last one ended.
  playout = appendLeg(playout, [at(50, 6), at(100, 6)], 4500, 4500)
  const { frames } = run(playout, 4500, 12000)
  assert.ok(Math.max(...frames.map((f) => f.step)) < 0.5)
  assert.ok(meters(frames[frames.length - 1].point, at(100, 6)) < 0.05)
})

test('a leg that starts a little behind where the track reached does not back the icon up', () => {
  let playout = createPlayout(at(0), 0)
  playout = appendLeg(playout, eastLeg(0, 50), 4500, 0)
  const frames: Frame[] = []
  ;({ playout } = run(playout, 0, 4500, frames))
  // With more positions to go on, the earlier report matched 5 m further back this time.
  playout = appendLeg(playout, [at(45, 1), at(70, 1), at(100, 1)], 4500, 4500)
  ;({ playout } = run(playout, 4500, 11000, frames))
  let east = -Infinity
  for (const frame of frames) {
    const now = (frame.point[1] - 122.95) * 111320 * COS
    assert.ok(now >= east - 1e-6, `backed up from ${east.toFixed(2)} to ${now.toFixed(2)} m`)
    east = now
  }
  assert.ok(meters(frames[frames.length - 1].point, at(100, 1)) < 0.05)
})

test('when a report is re-matched short of where the road ahead ran, the icon does not drive out and back', () => {
  let playout = createPlayout(at(0), 0)
  playout = appendLeg(playout, eastLeg(0, 50), 4500, 0)
  const frames: Frame[] = []
  ;({ playout } = run(playout, 0, 3000, frames))
  // The van turned round at 40 m, not 50: the next leg, matched with more reports,
  // starts there and runs back west. The icon has not reached 40 m yet.
  playout = appendLeg(playout, [at(40), at(20)], 4500, 3000)
  ;({ playout } = run(playout, 3000, 12000, frames))
  const furthest = Math.max(...frames.map((f) => (f.point[1] - 122.95) * 111320 * COS))
  assert.ok(furthest < 40.5, `drove out to ${furthest.toFixed(1)} m before turning back`)
  assert.ok(meters(frames[frames.length - 1].point, at(20)) < 0.05)
})

test('a glide onto the road keeps the heading the vehicle was shown with', () => {
  let playout = createPlayout(at(0, 12), 0, 90)
  playout = appendLeg(playout, [at(0, 12), at(0)], 600, 0, { keepHeading: true })
  const { frames } = run(playout, 0, 2000)
  assert.ok(frames.every((f) => f.heading === 90), 'turned to face the side of the road')
})

test('back in the tab after a while, the icon is where the reports say', () => {
  let playout = createPlayout(at(0), 0)
  playout = appendLeg(playout, eastLeg(0, 50), 4500, 0)
  playout = appendLeg(playout, eastLeg(50, 100), 4500, 0)
  playout = fastForwardPlayout(playout, 60000)
  assert.ok(meters(playoutPose(playout).point, at(100)) < 0.01)
  assert.ok(isPlayoutSettled(playout))
})

test('after a signal gap the icon glides to the confirmed position rather than teleporting', () => {
  let playout = createPlayout(at(0), 0)
  playout = relocatePlayout(playout, at(250), 90000, 90000)
  const { frames } = run(playout, 90000, 95000)
  assert.ok(frames[0].step < 5, `first frame moved ${frames[0].step.toFixed(1)} m`)
  assert.ok(meters(frames[frames.length - 1].point, at(250)) < 0.05)
})

test('a relocation across town is shown at once: gliding there would cross buildings', () => {
  let playout = createPlayout(at(0), 0)
  playout = relocatePlayout(playout, at(3000), 90000, 90000)
  assert.ok(meters(playoutPose(playout).point, at(3000)) < 0.01)
})

test('the road ahead of the icon runs from the icon to the newest report', () => {
  let playout = createPlayout(at(0), 0)
  playout = appendLeg(playout, eastLeg(0, 50), 4500, 0)
  ;({ playout } = run(playout, 0, 2250))
  const lead = playoutLead(playout)
  assert.ok(meters(lead[0], playoutPose(playout).point) < 0.01)
  assert.ok(meters(lead[lead.length - 1], at(50)) < 0.01)
})

test('a long drive does not keep the whole road it has driven', () => {
  let playout = createPlayout(at(0), 0)
  let t = 0
  for (let leg = 0; leg < 200; leg += 1) {
    playout = appendLeg(playout, eastLeg(leg * 50, leg * 50 + 50), 4500, t)
    ;({ playout } = run(playout, t, t + 4500))
    t += 4500
  }
  ;({ playout } = run(playout, t, t + 3000))
  assert.ok(playout.points.length < 60, `${playout.points.length} points kept`)
  assert.ok(meters(playoutPose(playout).point, at(10000)) < 1)
})
