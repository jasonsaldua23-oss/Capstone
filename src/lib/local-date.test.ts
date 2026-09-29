import test from 'node:test'
import assert from 'node:assert/strict'
import { localDateInputValue } from './local-date.ts'

test('localDateInputValue counts local calendar days, not UTC ones', () => {
  // Late evening and early morning both belong to the local day, whatever UTC says.
  assert.equal(localDateInputValue(0, new Date(2026, 8, 29, 23, 30)), '2026-09-29')
  assert.equal(localDateInputValue(0, new Date(2026, 8, 29, 0, 30)), '2026-09-29')
  assert.equal(localDateInputValue(2, new Date(2026, 8, 29, 7, 0)), '2026-10-01')
  assert.equal(localDateInputValue(2, new Date(2026, 11, 31, 12, 0)), '2027-01-02')
})
