import test from 'node:test'
import assert from 'node:assert/strict'

import { formatStockBatchDaysLeft, isStockBatchExpired, stockBatchDaysLeft, stockBatchHealth } from './stock-batch-health.ts'

// Local times, so the tests hold in any timezone the suite runs in.
const at = (month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0) =>
  new Date(2026, month - 1, day, hour, minute, second, ms)
// How the backend stores a date-only expiry: the last instant of that local day.
const endOfDay = (month: number, day: number) => at(month, day, 23, 59, 59, 999).toISOString()

test('a batch expiring later today has 0 days left, not 1', () => {
  const now = at(9, 27, 15, 30)
  assert.equal(stockBatchDaysLeft(endOfDay(9, 27), now), 0)
  assert.equal(formatStockBatchDaysLeft(0), 'Today')
  assert.equal(stockBatchHealth(endOfDay(9, 27), now), 'CRITICAL')
})

test('days left counts calendar days whatever the hour', () => {
  assert.equal(stockBatchDaysLeft(endOfDay(9, 28), at(9, 27, 0, 1)), 1)
  assert.equal(stockBatchDaysLeft(endOfDay(9, 28), at(9, 27, 23, 59)), 1)
  assert.equal(stockBatchDaysLeft(endOfDay(10, 27), at(9, 27, 12)), 30)
})

test('a batch is expired once its expiry moment passes, as the backend decides', () => {
  assert.equal(isStockBatchExpired(endOfDay(9, 27), at(9, 27, 23, 59)), false)
  assert.equal(isStockBatchExpired(endOfDay(9, 27), at(9, 28, 0, 0)), true)
  assert.equal(stockBatchHealth(endOfDay(9, 27), at(9, 28, 0, 0)), 'EXPIRED')
})

test('critical is 0-14 days, expiring soon 15-30, healthy beyond', () => {
  const now = at(9, 1, 9)
  assert.equal(stockBatchHealth(endOfDay(9, 15), now), 'CRITICAL') // 14 days
  assert.equal(stockBatchHealth(endOfDay(9, 16), now), 'EXPIRING_SOON') // 15 days
  assert.equal(stockBatchHealth(endOfDay(10, 1), now), 'EXPIRING_SOON') // 30 days
  assert.equal(stockBatchHealth(endOfDay(10, 2), now), 'HEALTHY') // 31 days
})

test('a batch without an expiry date is healthy with no days left to show', () => {
  assert.equal(stockBatchHealth(null), 'HEALTHY')
  assert.equal(stockBatchDaysLeft(null), null)
  assert.equal(stockBatchDaysLeft('not a date'), null)
})

test('days left reads naturally', () => {
  assert.equal(formatStockBatchDaysLeft(1), '1 day')
  assert.equal(formatStockBatchDaysLeft(12), '12 days')
})
