import test from 'node:test'
import assert from 'node:assert/strict'

import { skuNamesOtherOrderFormat } from './product-sku.ts'

test('a SKU naming another order format is flagged for rebuilding', () => {
  // Seed-era SKUs kept CAS after their products moved to packs.
  assert.equal(skuNamesOtherOrderFormat('MILK-CAS-250M-CAN24', 'pack'), true)
  assert.equal(skuNamesOtherOrderFormat('GATO-CAS-900M-PET12', 'Pack (Bundle)'), true)
  assert.equal(skuNamesOtherOrderFormat('CHUN-PAC-290M-U642J', 'case'), true)
})

test('a SKU that matches its format, or names none, is left alone', () => {
  assert.equal(skuNamesOtherOrderFormat('7UPP-CAS-8OZ-RGB24', 'case'), false)
  assert.equal(skuNamesOtherOrderFormat('CHUN-PAC-290M-U642J', 'pack'), false)
  // An empty unit is stored as a case.
  assert.equal(skuNamesOtherOrderFormat('PEPS-CAS-1LIT-RGB12', ''), false)
  // Hand-made SKUs without a format segment are not second-guessed.
  assert.equal(skuNamesOtherOrderFormat('PRODUCT-DELETE-HISTORY', 'pack'), false)
  assert.equal(skuNamesOtherOrderFormat('', 'pack'), false)
})
