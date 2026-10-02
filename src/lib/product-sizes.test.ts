import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProductSizeFilterOptions, productHasSize } from './product-sizes.ts'

test('size filter lists every registrable size in registration order', () => {
  assert.deepEqual(buildProductSizeFilterOptions([]), [
    '7oz', '8oz', '12oz',
    '195ml', '230ml', '237ml', '240ml', '250ml', '290ml', '295ml', '300ml', '320ml', '330ml',
    '350ml', '355ml', '360ml', '450ml', '500ml', '600ml', '750ml', '900ml',
    '1 Liter', '1.5 Liters', '2 Liters', '10 Liters', '20 Liters',
    '320g', '640g',
  ])
})

test('a legacy label for a known size folds into the registration spelling', () => {
  const options = buildProductSizeFilterOptions(['330ml (11 oz)', '1L', '8oz'])
  assert.equal(options.filter((size) => size.startsWith('330')).length, 1)
  assert.ok(options.includes('330ml'))
  assert.ok(!options.includes('1L'))
})

test('an unreadable legacy label stays filterable after the known sizes', () => {
  const options = buildProductSizeFilterOptions(['Family pack'])
  assert.equal(options[options.length - 1], 'Family pack')
})

test('a product matches the filter by physical size, not by spelling', () => {
  assert.equal(productHasSize(['330ml (11 oz)'], '330ml'), true)
  assert.equal(productHasSize(['1L'], '1 Liter'), true)
  assert.equal(productHasSize(['8oz'], '12oz'), false)
  assert.equal(productHasSize([], '8oz'), false)
})
