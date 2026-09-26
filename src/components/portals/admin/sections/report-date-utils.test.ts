import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReportDateWindow, matchesReportDateWindow, type ReportDatePreset } from './report-date-utils'
import { matchesPurchaseDatePreset } from '@/lib/purchase-documents'

const now = new Date(2026, 8, 27, 12)

test('custom range includes both full local days and excludes adjacent days', () => {
  const window = buildReportDateWindow('custom', '2026-09-10', '2026-09-12', now)
  for (const value of ['2026-09-10T00:00:00', '2026-09-12T23:59:59.999']) {
    assert.equal(matchesReportDateWindow(value, window), true)
  }
  for (const value of ['2026-09-09T23:59:59.999', '2026-09-13T00:00:00', '', 'invalid']) {
    assert.equal(matchesReportDateWindow(value, window), false)
  }
})

test('single-day custom range uses the local day for UTC timestamps', () => {
  const window = buildReportDateWindow('custom', '2026-09-10', '2026-09-10', now)
  const midnight = new Date(2026, 8, 10)
  assert.equal(matchesReportDateWindow(midnight.toISOString(), window), true)
  assert.equal(matchesPurchaseDatePreset(midnight.toISOString(), 'custom', '2026-09-10', now), true)
  assert.equal(matchesReportDateWindow(new Date(midnight.getTime() - 1).toISOString(), window), false)
})

test('custom range supports either boundary, clearing both, and all-time reset', () => {
  assert.equal(matchesReportDateWindow('2020-01-01', buildReportDateWindow('custom', '', '2026-09-10')), true)
  assert.equal(matchesReportDateWindow('2027-01-01', buildReportDateWindow('custom', '2026-09-10', '')), true)
  assert.equal(matchesReportDateWindow('2020-01-01', buildReportDateWindow('custom', '2026-09-10', '')), false)
  assert.equal(matchesReportDateWindow('2027-01-01', buildReportDateWindow('custom', '', '2026-09-10')), false)
  assert.equal(matchesReportDateWindow('', buildReportDateWindow('custom', '', '')), true)
  assert.equal(matchesReportDateWindow('2020-01-01', buildReportDateWindow('all', '2026-09-10', '2026-09-12')), true)
})

test('invalid or reversed custom ranges cannot silently fall back to another period', () => {
  for (const window of [buildReportDateWindow('custom', 'invalid', ''), buildReportDateWindow('custom', '2026-09-12', '2026-09-10')]) {
    assert.equal(matchesReportDateWindow('2026-09-11T12:00:00', window), false)
    assert.equal(matchesReportDateWindow(now.toISOString(), window), false)
  }
})

test('every preset covers exactly its calendar days and excludes tomorrow in reports and staff lists', () => {
  for (const preset of ['today', '7', '30', '90', '365'] as ReportDatePreset[]) {
    const window = buildReportDateWindow(preset, '', '', now)
    const days = preset === 'today' ? 1 : Number(preset)
    const start = new Date(2026, 8, 27 - days + 1)
    assert.equal(window.start?.getTime(), start.getTime())
    for (const [date, expected] of [[start, true], [new Date(start.getTime() - 1), false], [new Date(2026, 8, 27, 23, 59, 59, 999), true], [new Date(2026, 8, 28), false]] as const) {
      assert.equal(matchesReportDateWindow(date.toISOString(), window), expected, preset)
      assert.equal(matchesPurchaseDatePreset(date.toISOString(), preset, '', now), expected, preset)
    }
  }
})
