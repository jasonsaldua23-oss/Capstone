import assert from 'node:assert/strict'
import test from 'node:test'
import { COARSE_FIX_HOLD_MS, isCoarseFixAmidGps } from './driver-gps-quality.ts'

const gps = { accuracy: 5, speed: 0.1, recordedAt: 10_000 }

test('a network fix between GPS fixes is not news', () => {
  // Android's network provider: tens of metres off, no Doppler speed.
  assert.equal(isCoarseFixAmidGps({ accuracy: 24, speed: null, recordedAt: 11_500 }, gps), true)
})

test('a network fix fills the gap once GPS has gone quiet', () => {
  assert.equal(isCoarseFixAmidGps({ accuracy: 24, speed: null, recordedAt: 10_000 + COARSE_FIX_HOLD_MS }, gps), false)
})

test('a GPS fix is never dropped for being less accurate than the last one', () => {
  // A street canyon degrades GPS gradually; every one of those fixes still carries Doppler.
  assert.equal(isCoarseFixAmidGps({ accuracy: 40, speed: 9, recordedAt: 11_000 }, gps), false)
})

test('a speedless fix at least as accurate as the last one is kept', () => {
  assert.equal(isCoarseFixAmidGps({ accuracy: 5, speed: null, recordedAt: 11_000 }, gps), false)
})

test('a phone that never reports speed is not filtered at all', () => {
  const browser = { accuracy: 8, speed: null, recordedAt: 10_000 }
  assert.equal(isCoarseFixAmidGps({ accuracy: 30, speed: null, recordedAt: 11_000 }, browser), false)
})

test('nothing to compare against keeps the fix', () => {
  assert.equal(isCoarseFixAmidGps({ accuracy: 30, speed: null, recordedAt: 11_000 }, null), false)
  assert.equal(isCoarseFixAmidGps({ accuracy: 30, speed: null }, gps), false)
  assert.equal(isCoarseFixAmidGps({ accuracy: null, speed: null, recordedAt: 11_000 }, gps), false)
})
