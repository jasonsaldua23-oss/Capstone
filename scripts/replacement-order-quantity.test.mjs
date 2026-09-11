import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Execute production formatters against recorded scheduling/request shapes without live data.
const modules = new Map()
function load(name) {
  if (modules.has(name)) return modules.get(name)
  const exports = {}
  const source = fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: path => load(path.replace('./', '')) })
  modules.set(name, exports)
  return exports
}
const { replacementOrderQuantity } = load('replacement-order-quantity')
test('loose replacements show the actual count and container rather than a rounded package', () => {
  assert.equal(replacementOrderQuantity({ quantity: 1, product: { unit: 'Pack', category: 'Carbonated (Cans)' }, notes: 'ReplacementUnitMode=BOTTLE\nReplacementRequestedBottles=3' }), '3 cans')
})
test('case replacement preserves full packages and loose remainder', () => {
  assert.equal(replacementOrderQuantity({ quantity: 3, quantityPerCase: 24, product: { unit: 'Case', category: 'Carbonated (Glass)' }, notes: 'ReplacementUnitMode=UNIT\nReplacementRequestedBottles=50' }), '2 cases, 2 glass bottles')
})
test('packs and bundles retain their specific packaging unit', () => {
  for (const unit of ['pack', 'bundle']) {
    assert.equal(replacementOrderQuantity({ quantity: 3, quantityPerCase: 6, productUnit: unit, notes: 'ReplacementUnitMode=UNIT\nReplacementRequestedBottles=18' }), `3 ${unit}s`)
  }
})
test('legacy quantities retain stored units without invented conversions', () => {
  assert.equal(replacementOrderQuantity({ quantity: 1, productUnit: 'Pack' }), '1 pack')
  assert.equal(replacementOrderQuantity({ quantity: 3, productUnit: 'Case', notes: 'ReplacementUnitMode=UNIT\nReplacementRequestedBottles=50' }), '50 bottles')
})
