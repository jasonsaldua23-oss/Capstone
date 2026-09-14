import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/lib/deposit-refund-units.ts', import.meta.url), 'utf8')
const sharedSource = fs.readFileSync(new URL('../shared/customer-logic/src/empty-credit.ts', import.meta.url), 'utf8')
const sharedContext = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(sharedSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, sharedContext)
const mixedSource = fs.readFileSync(new URL('../shared/customer-logic/src/mixed-case-deposit.ts', import.meta.url), 'utf8')
const mixedContext = vm.createContext({ exports: {} })
vm.runInContext(ts.transpileModule(mixedSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, mixedContext)
// Resolve the production shared helper while keeping this focused test dependency-free.
const context = vm.createContext({
  exports: {},
  require: (specifier) => {
    if (specifier === '@shared/customer-logic/empty-credit') return sharedContext.exports
    throw new Error(`Unexpected test import: ${specifier}`)
  },
})
vm.runInContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context)
const {
  getProductDepositBalanceRows,
  getDepositRefundUnitDetails,
  getMaximumDepositRefundQuantity,
  serializeDepositRefundQuantity,
} = context.exports

const { getAutomaticEmptyCredit, getFullCaseDepositAmount, getLineDepositAmounts } = sharedContext.exports
const { getMixedCaseDepositAmounts } = mixedContext.exports

test('full cases add bottle deposits and the physical case deposit', () => {
  const item = {
    packagingType: 'RETURNABLE',
    containerTypeId: 'glass-12oz',
    unit: 'case',
    quantity: 1,
    containersPerCase: 24,
    depositAmount: 2,
    caseDepositAmount: 42,
    emptyReturnedQuantity: 24,
  }

  assert.equal(getFullCaseDepositAmount(item), 90)
  assert.deepEqual({ ...getLineDepositAmounts(item) }, { charged: 90, refunded: 90 })
})

test('mixed cases add one physical case deposit and refund it only with full coverage', () => {
  const component = (emptyReturnedQuantity) => ({
    quantityPerCase: 12,
    emptyReturnedQuantity,
    product: {
      containersPerCase: 24,
      depositAmount: 2,
      caseDepositAmount: 42,
    },
  })
  const partial = getMixedCaseDepositAmounts({
    quantity: 1,
    caseCapacity: 24,
    components: [component(12), component(0)],
  })
  const full = getMixedCaseDepositAmounts({
    quantity: 1,
    caseCapacity: 24,
    components: [component(12), component(12)],
  })

  assert.deepEqual({ ...partial }, { charged: 90, refunded: 24 })
  assert.deepEqual({ ...full }, { charged: 90, refunded: 90 })
})

test('case products combine case capacity, bottle deposits, and case deposit', () => {
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
    depositPerUnit: 124,
  })
  assert.equal(getMaximumDepositRefundQuantity(612, 6324, details), 51)
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

test('automatic empty credit only uses the exact product sub-balance', () => {
  const balances = [{
    containerTypeId: 'glass-8oz',
    bottlesOutstanding: 2376,
    depositBalance: 8910,
    productBalances: [{
      productId: '7up-8oz',
      bottlesAvailable: 2376,
      depositAvailable: 8910,
    }],
  }]

  const mountainDew = getAutomaticEmptyCredit({
    productId: 'mountain-dew-8oz',
    packagingType: 'RETURNABLE',
    containerTypeId: 'glass-8oz',
    unit: 'case',
    containersPerCase: 24,
    depositAmount: 2,
    caseDepositAmount: 42,
  }, 25, balances)
  const sevenUp = getAutomaticEmptyCredit({
    productId: '7up-8oz',
    packagingType: 'RETURNABLE',
    containerTypeId: 'glass-8oz',
    unit: 'case',
    containersPerCase: 24,
    depositAmount: 2,
    caseDepositAmount: 42,
  }, 25, balances)

  assert.deepEqual({ ...mountainDew }, {
    availableEmptyBottles: 0,
    availableDepositBalance: 0,
    emptyReturnedQuantity: 0,
  })
  assert.deepEqual({ ...sevenUp }, {
    availableEmptyBottles: 2376,
    availableDepositBalance: 8910,
    emptyReturnedQuantity: 600,
  })
})

test('legacy shared balances are not guessed and their product labels stay separate', () => {
  const sharedBalance = {
    containerTypeId: 'glass-1l',
    bottlesOutstanding: 24,
    depositBalance: 248,
    productOptions: [
      { id: 'mountain-dew-1l', name: 'Mountain Dew', label: 'Mountain Dew - 1 Liter' },
      { id: 'pepsi-1l', name: 'Pepsi', label: 'Pepsi - 1 Liter' },
    ],
  }

  const credit = getAutomaticEmptyCredit({
    productId: 'mountain-dew-1l',
    packagingType: 'RETURNABLE',
    containerTypeId: 'glass-1l',
    unit: 'case',
    containersPerCase: 12,
    depositAmount: 6,
    caseDepositAmount: 52,
  }, 1, [sharedBalance])
  const rows = getProductDepositBalanceRows(sharedBalance)

  assert.equal(credit.emptyReturnedQuantity, 0)
  assert.deepEqual(rows.map((row) => row.productLabel), [
    'Mountain Dew - 1 Liter',
    'Pepsi - 1 Liter',
  ])
  assert.deepEqual(rows.map((row) => row.bottlesAvailable), [0, 0])
})
