import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMatchUrl, isPlausibleLeg, parseMatchedLeg } from './road-match.ts'
import type { ReportFix } from './report-tracker.ts'

const fixAt = (lat: number, lng: number, recordedAtMs: number | null, accuracyM: number | null = 6): ReportFix => ({
  lat, lng, recordedAtMs, receivedAtMs: (recordedAtMs ?? 0) + 800, speedMps: 10, headingDeg: 90, accuracyM,
})

const window3 = [
  fixAt(10.7, 122.95, 1_700_000_000_000),
  fixAt(10.7, 122.9504, 1_700_000_004_000),
  fixAt(10.7, 122.9508, 1_700_000_008_000, 80),
]

test('the match request carries every position, its time and how far it may be from the road', () => {
  const url = new URL(buildMatchUrl(window3))
  assert.match(url.pathname, /\/match\/v1\/driving\/122\.95,10\.7;122\.9504,10\.7;122\.9508,10\.7$/)
  assert.equal(url.searchParams.get('timestamps'), '1700000000;1700000004;1700000008')
  // Accuracy sets the search radius, within bounds: a phone claiming 6 m still gets
  // room for the road's width, and an 80 m fix cannot reach a road a block away.
  assert.equal(url.searchParams.get('radiuses'), '10;10;40')
  assert.equal(url.searchParams.get('steps'), 'true')
  assert.equal(url.searchParams.get('gaps'), 'ignore')
})

test('timestamps never go backwards even when a report has no phone time', () => {
  const url = new URL(buildMatchUrl([fixAt(10.7, 122.95, 5000), fixAt(10.7, 122.9504, null)]))
  const [a, b] = url.searchParams.get('timestamps')!.split(';').map(Number)
  assert.ok(b > a, `${a} then ${b}`)
})

const step = (coordinates: [number, number][]) => ({ geometry: { coordinates } })
const matchPayload = {
  code: 'Ok',
  tracepoints: [
    { matchings_index: 0, waypoint_index: 0, location: [122.95, 10.70001] },
    { matchings_index: 0, waypoint_index: 1, location: [122.9504, 10.70001] },
    { matchings_index: 0, waypoint_index: 2, location: [122.9508, 10.70001] },
  ],
  matchings: [{
    legs: [
      { distance: 44, steps: [step([[122.95, 10.70001], [122.9504, 10.70001]]), step([[122.9504, 10.70001]])] },
      {
        distance: 44,
        steps: [
          step([[122.9504, 10.70001], [122.9506, 10.70001]]),
          step([[122.9506, 10.70001], [122.9508, 10.70001]]),
        ],
      },
    ],
  }],
}

test('only the newest leg is taken, as [lat, lng] from where the previous report matched', () => {
  const leg = parseMatchedLeg(matchPayload, window3)
  assert.deepEqual(leg, [[10.70001, 122.9504], [10.70001, 122.9506], [10.70001, 122.9508]])
})

test('no leg when the newest two reports did not match onto one continuous road', () => {
  const split = structuredClone(matchPayload)
  split.tracepoints[2] = { matchings_index: 1, waypoint_index: 0, location: [122.9508, 10.70001] }
  assert.equal(parseMatchedLeg(split, window3), null)

  const unmatched = structuredClone(matchPayload)
  ;(unmatched.tracepoints as unknown[])[2] = null
  assert.equal(parseMatchedLeg(unmatched, window3), null)

  assert.equal(parseMatchedLeg({ code: 'NoMatch' }, window3), null)
})

test('a leg that wanders far longer than the trip between two reports is refused', () => {
  const from: [number, number] = [10.7, 122.95]
  const to: [number, number] = [10.7, 122.9004 + 0.05]
  const direct: [number, number][] = [from, to]
  assert.equal(isPlausibleLeg(direct, from, to, 4), true)
  // A detour into a side street and back doubles a 44 m hop.
  const detour: [number, number][] = [from, [10.7006, 122.9502], [10.7006, 122.9506], to]
  assert.equal(isPlausibleLeg(detour, [10.7, 122.95], [10.7, 122.9504], 4), false)
})
