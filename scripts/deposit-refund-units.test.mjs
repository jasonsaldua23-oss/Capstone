import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/lib/deposit-refund-units.ts', import.meta.url), 'utf8')
const context = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context)
const {
  getProductDepositBalanceRows,
  getDepositRefundUnitDetails,
  getMaximumDepositRefundQuantity,
  serializeDepositRefundQuantity,
} = context.exports

test('case products use case capacity and case deposit', () => {
  const details = getDepositRefundUnitDetails({
    unit: 'case',
    containersPerCase: 12,
    depositAmount: 6,
    caseDepositAmount: 52,
  }, {})

  assert.deepEqual({ ...details }, {
    unitType: 'CASE',
    unitLabel: 'case',
    containersPerUnit: 12,
    depositPerUnit: 52,
  })
  assert.equal(getMaximumDepositRefundQuantity(612, 3672, details), 51)
  assert.deepEqual({ ...serializeDepositRefundQuantity({ ...details, quantity: 51 }) }, {
    quantity: 612,
    cases: 51,
    bottles: 0,
  })
})

test('bottle products use bottle quantity and per-bottle deposit', () => {
  const details = getDepositRefundUnitDetails({
    unit: 'bottle',
    containersPerCase: 12,
    depositAmount: 6,
    caseDepositAmount: 52,
  }, {})

  assert.equal(details.unitType, 'BOTTLE')
  assert.equal(details.containersPerUnit, 1)
  assert.equal(details.depositPerUnit, 6)
  assert.deepEqual({ ...serializeDepositRefundQuantity({ ...details, quantity: 7 }) }, {
    quantity: 7,
    cases: 0,
    bottles: 7,
  })
})

test('products sharing one container type remain separate balance rows', () => {
  // Fix regression: shared physical containers must not combine distinct products in the UI.
  const rows = getProductDepositBalanceRows({
    containerTypeId: 'shared-container',
    bottlesAvailable: 72,
    productLabel: 'Combined legacy label',
    productBalances: [
      {
        productId: 'mountain-dew',
        productLabel: 'Mountain Dew - 12oz',
        bottlesAvailable: 48,
        availableQuantity: 2,
        unit: 'case',
      },
      {
        productId: 'pepsi',
        productLabel: 'Pepsi - 1 Liter',
        bottlesAvailable: 24,
        availableQuantity: 2,
        unit: 'case',
      },
    ],
  })

  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => row.productLabel), [
    'Mountain Dew - 12oz',
    'Pepsi - 1 Liter',
  ])
  assert.deepEqual(rows.map((row) => row.containerBottlesAvailable), [72, 72])
})
