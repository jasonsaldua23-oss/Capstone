import test from 'node:test'
import assert from 'node:assert/strict'
import {
  customerDamageQuantityLabel,
  customerDamageStatusLabel,
  damagedQuantityLabel,
  parseCustomerDamageReports,
  parseDamagedStockRecords,
  parseDamagedStockSummary,
  productWithSize,
} from './damaged-stock.ts'

test('records the client cannot read are dropped, and odd values are made safe', () => {
  const rows = parseDamagedStockRecords([
    { id: 'a', status: 'PENDING', cause: 'BROKEN_IN_WAREHOUSE', cases: 2, looseUnits: '3', lossAmount: null, canManage: true },
    { id: 'b', status: 'LOST' },
    { status: 'PENDING' },
    { id: 'c', status: 'DISPOSED', cause: 'SOMETHING_NEW', cases: -4, lossAmount: '276.5' },
  ])
  assert.deepEqual(rows.map((row) => row.id), ['a', 'c'])
  assert.equal(rows[0].looseUnits, 3)
  assert.equal(rows[0].canManage, true)
  assert.equal(rows[1].cause, 'OTHER')
  assert.equal(rows[1].cases, 0)
  assert.equal(rows[1].lossAmount, 276.5)
})

test('quantities read the way the damage was recorded', () => {
  assert.equal(damagedQuantityLabel(2, 0), '2 cases')
  assert.equal(damagedQuantityLabel(1, 7), '1 case and 7 bottles')
  assert.equal(damagedQuantityLabel(0, 1), '1 bottle')
  assert.equal(customerDamageQuantityLabel({ quantity: 6, unitLabel: 'bottle' }), '6 bottles')
  assert.equal(customerDamageQuantityLabel({ quantity: 1, unitLabel: 'cases' }), '1 case')
})

test('claim statuses use the Replacements page vocabulary', () => {
  assert.equal(customerDamageStatusLabel('UNDER_REVIEW'), 'Under Review')
  assert.equal(customerDamageStatusLabel('RESOLVED_ON_DELIVERY'), 'Completed')
  assert.equal(customerDamageStatusLabel('PENDING'), 'Reported')
  assert.equal(customerDamageStatusLabel(''), 'Reported')
})

test('summary and customer reports tolerate missing fields', () => {
  assert.deepEqual(parseDamagedStockSummary(null), { pending: 0, disposed: 0, returnedToSupplier: 0, restocked: 0, lossAmount: 0 })
  const reports = parseCustomerDamageReports([{ id: 'line-1', quantity: 6, unitLabel: '', status: 'APPROVED' }, { quantity: 1 }])
  assert.equal(reports.length, 1)
  assert.equal(reports[0].unitLabel, 'unit')
  assert.equal(reports[0].productName, 'Product')
})

test('a size already in the product name is not repeated', () => {
  assert.equal(productWithSize('Pepsi', ['12oz']), 'Pepsi 12oz')
  assert.equal(productWithSize('Pepsi 12oz', ['12oz']), 'Pepsi 12oz')
  assert.equal(productWithSize('Pepsi', []), 'Pepsi')
})
