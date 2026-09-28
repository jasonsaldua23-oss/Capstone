import test from 'node:test'
import assert from 'node:assert/strict'
import { ingestReport, movementBearing, type ReportFix, type ReportTracker } from './report-tracker.ts'

// Positions on a straight road running east from [10.7, 122.95].
const east = (meters: number, north = 0) => ({
  lat: 10.7 + north / 110540,
  lng: 122.95 + meters / (111320 * Math.cos((10.7 * Math.PI) / 180)),
})

const fix = (over: Partial<ReportFix> & { at: number; m: number; north?: number }): ReportFix => ({
  ...east(over.m, over.north ?? 0),
  recordedAtMs: over.at,
  receivedAtMs: over.at + 900,
  speedMps: 11,
  headingDeg: 90,
  accuracyM: 6,
  ...over,
})

function feed(fixes: ReportFix[]) {
  let tracker: ReportTracker | undefined
  return fixes.map((next) => {
    const result = ingestReport(tracker, next)
    tracker = result.tracker
    return result
  })
}

test('the first report places the vehicle and later ones extend it at the time they took', () => {
  const [first, second] = feed([fix({ at: 0, m: 0 }), fix({ at: 4500, m: 50 })])
  assert.equal(first.outcome.kind, 'first')
  assert.equal(second.outcome.kind, 'moved')
  if (second.outcome.kind !== 'moved') return
  assert.equal(second.outcome.sinceLastMs, 4500)
  assert.equal(second.outcome.window.length, 2)
})

test('a repeated or late report is ignored rather than moving the vehicle back', () => {
  const results = feed([
    fix({ at: 0, m: 0 }),
    fix({ at: 4000, m: 45 }),
    fix({ at: 4000, m: 45 }),
    fix({ at: 2000, m: 22 }),
  ])
  assert.deepEqual(results.slice(2).map((r) => r.outcome), [
    { kind: 'ignored', reason: 'duplicate' },
    { kind: 'ignored', reason: 'older' },
  ])
})

test('a parked vehicle is held through its wandering, and the drive away is timed from the last report', () => {
  const results = feed([
    fix({ at: 0, m: 0 }),
    fix({ at: 4000, m: 40, speedMps: 0 }),
    fix({ at: 8000, m: 47, north: 5, speedMps: 0.2 }),
    fix({ at: 12000, m: 36, north: -3, speedMps: 0.4 }),
    fix({ at: 16000, m: 80, speedMps: 9 }),
  ])
  assert.deepEqual(results.slice(2, 4).map((r) => r.outcome.kind), ['still', 'still'])
  const drive = results[4].outcome
  assert.equal(drive.kind, 'moved')
  if (drive.kind === 'moved') assert.equal(drive.sinceLastMs, 4000)
})

test('without a speed reading, a few metres of wander is still no movement', () => {
  const results = feed([
    fix({ at: 0, m: 0, speedMps: null }),
    fix({ at: 4000, m: 6, speedMps: null, accuracyM: 9 }),
  ])
  assert.equal(results[1].outcome.kind, 'still')
})

test('a coarse network fix between GPS fixes is held back', () => {
  const results = feed([
    fix({ at: 0, m: 0 }),
    fix({ at: 1000, m: 30, north: 25, speedMps: null, headingDeg: null, accuracyM: 35 }),
    fix({ at: 4500, m: 50 }),
  ])
  assert.deepEqual(results[1].outcome, { kind: 'held', reason: 'coarse' })
  assert.equal(results[2].outcome.kind, 'moved')
})

test('a very inaccurate fix is held while better ones are recent, then taken as the best there is', () => {
  const results = feed([
    fix({ at: 0, m: 0 }),
    fix({ at: 4000, m: 40, accuracyM: 90 }),
    fix({ at: 25000, m: 200, accuracyM: 90 }),
  ])
  assert.deepEqual(results[1].outcome, { kind: 'held', reason: 'inaccurate' })
  assert.equal(results[2].outcome.kind, 'moved')
})

test('an impossible leap is never shown when the next report is back on course', () => {
  const results = feed([
    fix({ at: 0, m: 0 }),
    fix({ at: 4000, m: 600 }),
    fix({ at: 8000, m: 90 }),
  ])
  assert.deepEqual(results[1].outcome, { kind: 'held', reason: 'implausible' })
  const next = results[2].outcome
  assert.equal(next.kind, 'moved')
  // The leg still runs from the last good report; the leap left no trace.
  if (next.kind === 'moved') assert.equal(next.window[0].recordedAtMs, 0)
})

test('a leap the following reports confirm is followed, as a relocation', () => {
  const results = feed([
    fix({ at: 0, m: 0 }),
    fix({ at: 4000, m: 900 }),
    fix({ at: 8000, m: 945 }),
  ])
  assert.deepEqual(results[1].outcome, { kind: 'held', reason: 'implausible' })
  assert.equal(results[2].outcome.kind, 'relocated')
})

test('a long silence allows a long way, so the drive after a signal gap is followed, not held', () => {
  const results = feed([fix({ at: 0, m: 0 }), fix({ at: 75000, m: 700 })])
  assert.equal(results[1].outcome.kind, 'moved')
})

test('the direction of travel comes from the reports themselves once they are far enough apart', () => {
  let tracker: ReportTracker | undefined
  for (const next of [fix({ at: 0, m: 0, headingDeg: null }), fix({ at: 4000, m: 40, headingDeg: null })]) {
    tracker = ingestReport(tracker, next).tracker
  }
  const bearing = movementBearing(tracker)
  assert.ok(bearing !== null && Math.abs(bearing - 90) < 1, `bearing ${bearing}`)
})

test('a slow or parked phone bearing is not taken as the direction of travel', () => {
  const tracker = ingestReport(undefined, fix({ at: 0, m: 0, headingDeg: 270, speedMps: 0.2 })).tracker
  assert.equal(movementBearing(tracker), null)
})
