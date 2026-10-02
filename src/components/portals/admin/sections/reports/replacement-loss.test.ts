import test from 'node:test'
import assert from 'node:assert/strict'
import { getReplacementLineLoss } from './replacement-loss.ts'

test('RPL-2026-0019 uses the mixed component bottle price, not the parent case price', () => {
  // Recorded pricing: the full assortment is 242.50; Mountain Dew is 10.208333 per bottle.
  const items = [{ id: 'mixed', itemType: 'MIXED_CASE', unitPrice: 242.5, components: [
    { id: '7up', unitPrice: 10 }, { id: 'dew', unitPrice: 10.208333 },
  ] }]
  const loss = getReplacementLineLoss({ originalOrderItemId: 'mixed', mixedCaseComponentId: 'dew', quantityReplaced: 8 }, items)
  assert.equal(loss?.toFixed(2), '81.67')
})

test('case, pack, and bottle sales use their own original prices', () => {
  const items = [
    { id: 'case', productUnit: 'case', unitPrice: 240 },
    { id: 'pack', productUnit: 'pack', unitPrice: 120 },
    { id: 'bottle', productUnit: 'bottle', unitPrice: 12 },
  ]
  assert.equal(getReplacementLineLoss({ originalOrderItemId: 'case', quantityReplaced: 48, quantityPerCase: 24 }, items), 480)
  assert.equal(getReplacementLineLoss({ originalOrderItemId: 'pack', quantityReplaced: 3, quantityPerCase: 12 }, items), 30)
  assert.equal(getReplacementLineLoss({ originalOrderItemId: 'bottle', quantityReplaced: 3, quantityPerCase: 24 }, items), 36)
})

test('unfulfilled claims have zero loss and missing prices do not select another product', () => {
  assert.equal(getReplacementLineLoss({ quantityReplaced: 0, quantityToReplace: 48 }, []), 0)
  assert.equal(getReplacementLineLoss({ originalOrderItemId: 'missing', quantityReplaced: 8 }, [{ id: 'other', unitPrice: 242.5 }]), null)
  assert.equal(getReplacementLineLoss({ originalOrderItemId: 'mixed', mixedCaseComponentId: 'missing', quantityReplaced: 8 }, [{ id: 'mixed', itemType: 'MIXED_CASE', unitPrice: 242.5 }]), null)
})
