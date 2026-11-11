import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampEmptiesCount,
  stepEmptiesCases,
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
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 287, cases: 12 }), 2)
})

test('a case not handed over costs its bottles and its shell', () => {
  assert.deepEqual(stepEmptiesCases({ cases: 12, bottles: 288 }, 11, twelveCases), { cases: 11, bottles: 264 })
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 264, cases: 11 }), 90)
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 263, cases: 11 }), 92)
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 0, cases: 0 }), 1080)
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 288, cases: 12 }), 0)
})

test('loose bottles are charged per bottle', () => {
  const loose: EmptiesDeclaration = {
    declaredBottles: 30, declaredCases: 0, declaredLooseBottles: 30, containersPerCase: 24, depositValue: 60, shellDepositValue: 0,
  }
  assert.deepEqual(clampEmptiesCount({ cases: 3, bottles: 25 }, loose), { cases: 0, bottles: 25 })
  assert.equal(uncoveredDeposit(loose, { bottles: 25, cases: 0 }), 10)
})

test('older declarations without a shell figure keep the per-bottle share', () => {
  assert.equal(uncoveredDeposit({ ...twelveCases, shellDepositValue: 0 }, { bottles: 287, cases: 12 }), 3.75)
})

test('an empty case alone, or bottles without their case, can both be counted', () => {
  // One case handed back empty: its 24 bottles are short, its shell is not.
  assert.deepEqual(clampEmptiesCount({ cases: 12, bottles: 264 }, twelveCases), { cases: 12, bottles: 264 })
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 264, cases: 12 }), 48)
  // All the bottles of a case without the case: only the shell is short.
  assert.deepEqual(clampEmptiesCount({ cases: 11, bottles: 288 }, twelveCases), { cases: 11, bottles: 288 })
  assert.equal(uncoveredDeposit(twelveCases, { bottles: 288, cases: 11 }), 42)
})

test('counts stay within the declaration and stepping cases moves a case of bottles', () => {
  assert.deepEqual(clampEmptiesCount({ cases: 20, bottles: -3 }, twelveCases), { cases: 12, bottles: 0 })
  assert.deepEqual(clampEmptiesCount({ cases: 1, bottles: 999 }, twelveCases), { cases: 1, bottles: 288 })
  // A corrected bottle count is kept when a case is added back.
  assert.deepEqual(stepEmptiesCases({ cases: 11, bottles: 270 }, 12, twelveCases), { cases: 12, bottles: 288 })
  assert.deepEqual(stepEmptiesCases({ cases: 1, bottles: 10 }, 0, twelveCases), { cases: 0, bottles: 0 })
})
