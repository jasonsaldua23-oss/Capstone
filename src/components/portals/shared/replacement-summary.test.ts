import test from 'node:test'
import assert from 'node:assert/strict'
import { getReplacementLineQuantity, summarizeReplacementCases } from './replacement-summary.ts'

// Regression: bottle claims retain their own unit even when sold in cases or packs.
test('report quantities use input mode, package size, and singular labels', () => {
  const fixtures = [
    [{ lineInputMode: 'bottle', productUnit: 'case', quantityToReplace: 1 }, 1, 'bottle'],
    [{ lineInputMode: 'bottle', productUnit: 'mixed_case', quantityToReplace: 8 }, 8, 'bottles'],
    [{ lineInputMode: 'case', productUnit: 'case', quantityToReplace: 48, quantityPerCase: 24 }, 2, 'cases'],
    [{ lineInputMode: 'case', productUnit: 'case', quantityToReplace: 120, quantityToReplaceCases: 5 }, 5, 'cases'],
    [{ lineInputMode: 'case', productUnit: 'pack', quantityToReplace: 12, quantityToReplaceCases: 1 }, 1, 'pack'],
    [{ lineInputMode: 'bottle', productUnit: 'pack', quantityToReplace: 2 }, 2, 'bottles'],
    [{ lineInputMode: 'case', productUnit: 'bundle', quantityToReplace: 24, quantityPerCase: 12 }, 2, 'bundles'],
  ] as const
  for (const [line, quantity, label] of fixtures) {
    const actual = getReplacementLineQuantity(line, 'toReplace')
    assert.equal(actual.quantity, quantity)
    assert.equal(actual.unitLabel, label)
  }
})

test('mixed requests count every line without counting the parent total again', () => {
  const lines = [
    { lineInputMode: 'case', productUnit: 'pack', quantityReplaced: 180, quantityReplacedCases: 9 },
    { lineInputMode: 'bottle', productUnit: 'pack', quantityReplaced: 3 },
    { lineInputMode: 'case', productUnit: 'case', quantityReplaced: 24, quantityPerCase: 24 },
  ]
  const result = summarizeReplacementCases([{ status: 'COMPLETED', replacementQuantity: 207, replacementLines: lines }])
  assert.equal(result.replacedQty, 10)
  assert.equal(result.replacedBottleQty, 3)
  assert.equal(result.totalCases, 1)
  const reversed = summarizeReplacementCases([{ status: 'COMPLETED', replacementLines: [...lines].reverse() }])
  assert.equal(reversed.replacedQty, result.replacedQty)
  assert.equal(reversed.replacedBottleQty, result.replacedBottleQty)
})

test('cancelled and unfinished claims do not count as replacements', () => {
  const rows = ['CANCELLED', 'FAILED_DELIVERY', 'REJECTED', 'REQUESTED', 'IN_PROGRESS'].map(status => ({
    status, replacementQuantity: 48,
    replacementLines: [{ lineInputMode: 'case', quantityReplaced: 0, quantityToReplace: 48, quantityToReplaceCases: 2 }],
  }))
  assert.equal(summarizeReplacementCases(rows).replacedQty, 0)
  assert.equal(summarizeReplacementCases(rows).replacedBottleQty, 0)
  assert.equal(getReplacementLineQuantity({ quantityReplaced: 0, replacementCases: 2 }, 'replaced').quantity, 0)
})

test('metadata lines and legacy no-line records remain supported', () => {
  const result = summarizeReplacementCases([{ status: 'COMPLETED', notes: 'Meta: '+JSON.stringify({ replacementLines: [
    { lineInputMode: 'bottle', quantityReplaced: 2 },
    { lineInputMode: 'case', quantityReplaced: 24, quantityPerCase: 24 },
  ] }) }, { status: 'COMPLETED', replacementCases: 2 }])
  assert.equal(result.replacedQty, 3)
  assert.equal(result.replacedBottleQty, 2)
})
