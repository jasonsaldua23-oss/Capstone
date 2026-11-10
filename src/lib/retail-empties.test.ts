import test from 'node:test'
import assert from 'node:assert/strict'
import { caseLineEmpties, receiptEmptiesLabel, receiptEmptiesTotals } from './retail-empties.ts'

test('bottles follow the cases as full ones until the cashier types a count', () => {
  assert.deepEqual(caseLineEmpties({ quantity: 3 }, 24), { cases: 0, bottles: 0 })
  assert.deepEqual(caseLineEmpties({ quantity: 3, emptyCasesProvided: 2 }, 24), { cases: 2, bottles: 48 })
})

test('an empty case alone, or bottles without their case, are kept apart', () => {
  assert.deepEqual(
    caseLineEmpties({ quantity: 3, emptyCasesProvided: 1, emptyBottlesProvided: 0 }, 24),
    { cases: 1, bottles: 0 },
  )
  assert.deepEqual(
    caseLineEmpties({ quantity: 3, emptyCasesProvided: 0, emptyBottlesProvided: 30 }, 24),
    { cases: 0, bottles: 30 },
  )
})

test('counts never exceed what the line sold', () => {
  assert.deepEqual(
    caseLineEmpties({ quantity: 2, emptyCasesProvided: 5, emptyBottlesProvided: 99 }, 24),
    { cases: 2, bottles: 48 },
  )
  assert.deepEqual(
    caseLineEmpties({ quantity: 2, emptyCasesProvided: -1, emptyBottlesProvided: Number.NaN }, 24),
    { cases: 0, bottles: 0 },
  )
})

test('the receipt reports an empty case returned without bottles', () => {
  assert.equal(
    receiptEmptiesLabel([{ mode: 'CASE', caseCapacity: 24, emptyBottlesProvided: 0, emptyCasesProvided: 1 }]),
    '1 case, 0 bottles',
  )
  assert.equal(
    receiptEmptiesLabel([{ mode: 'CASE', caseCapacity: 24, emptyBottlesProvided: 30, emptyCasesProvided: 0 }]),
    '30 bottles',
  )
})

test('the receipt adds loose and mixed-case returns to the case counts', () => {
  assert.deepEqual(
    receiptEmptiesTotals([
      { mode: 'CASE', caseCapacity: 24, emptyBottlesProvided: 48, emptyCasesProvided: 2 },
      { mode: 'LOOSE', emptyBottlesProvided: 3, emptyCasesProvided: 0 },
      { mode: 'MIXED_CASE', caseCapacity: 24, emptyBottlesProvided: 24, emptyCasesProvided: 1 },
    ]),
    { cases: 3, bottles: 75 },
  )
  assert.equal(receiptEmptiesLabel([]), '0 bottles')
})

test('sales recorded before the case count was kept still show their cases', () => {
  // A part-filled case came back in its shell, as those sales were priced.
  assert.equal(
    receiptEmptiesLabel([{ mode: 'CASE', caseCapacity: 24, emptyBottlesProvided: 40 }]),
    '2 cases, 40 bottles',
  )
  // A legacy mixed case recorded no case count to infer from.
  assert.equal(receiptEmptiesLabel([{ mode: 'MIXED_CASE', caseCapacity: 24, emptyBottlesProvided: 24 }]), '24 bottles')
})
