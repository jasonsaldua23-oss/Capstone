import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampEmptiesCount,
  countedBottles,
  uncoveredDeposit,
  type EmptiesDeclaration,
} from './empties-count.ts'

// Twelve cases of 8oz glass: 24 bottles at 2.00 plus a 42.00 shell, 90.00 a case.
const twelveCases: EmptiesDeclaration = {
  declaredBottles: 288,
  declaredCases: 12,
  declaredLooseBottles: 0,
  containersPerCase: 24,
  depositValue: 1080,
  shellDepositValue: 504,
}

test('a case handed back one bottle short costs that bottle, not a share of the shell', () => {
  const count = { cases: 12, missingBottles: 1, looseBottles: 0 }
  assert.equal(countedBottles(count, twelveCases), 287)
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 287, cases: 12 }), 2)
})

test('a case not handed over costs its bottles and its shell', () => {
  assert.equal(countedBottles({ cases: 11, missingBottles: 0, looseBottles: 0 }, twelveCases), 264)
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 264, cases: 11 }), 90)
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 263, cases: 11 }), 92)
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 0, cases: 0 }), 1080)
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 288, cases: 12 }), 0)
})

test('loose bottles are charged per bottle', () => {
  const loose: EmptiesDeclaration = {
    declaredBottles: 30, declaredCases: 0, declaredLooseBottles: 30, containersPerCase: 24, depositValue: 60, shellDepositValue: 0,
  }
  assert.equal(countedBottles({ cases: 0, missingBottles: 0, looseBottles: 25 }, loose), 25)
  assert.equal(uncoveredDeposit(loose, { bottles: 25, cases: 0 }), 10)
})

test('older declarations without a shell figure keep the per-bottle share', () => {
  assert.equal(uncoveredDeposit({ ...twelveCases, shellDepositValue: 0 }, { bottles: 287, cases: 12 }), 3.75)
})

test('missing bottles can only come out of the cases handed over', () => {
  assert.deepEqual(
    clampEmptiesCount({ cases: 1, missingBottles: 40, looseBottles: 9 }, { ...twelveCases, declaredLooseBottles: 5 }),
    { cases: 1, missingBottles: 24, looseBottles: 5 },
  )
  assert.deepEqual(
    clampEmptiesCount({ cases: 20, missingBottles: -3, looseBottles: 0 }, twelveCases),
    { cases: 12, missingBottles: 0, looseBottles: 0 },
  )
})
