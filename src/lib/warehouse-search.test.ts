import test from 'node:test'
import assert from 'node:assert/strict'
import { searchWarehouseRecords } from './warehouse-search.ts'

const orders = [
  { id: 'request-1', orderNumber: 'ORD-101', customer: { name: 'Ana Cruz' }, status: 'PENDING', items: [{ productName: 'Cola' }] },
  { id: 'order-2', orderNumber: 'ORD-102', purchaseOrderNumber: 'PO-102', purchaseOrderStage: 'PROCESSING', requestStatus: 'APPROVED', customer: { name: 'Ben' }, status: 'OUT_FOR_DELIVERY' },
]
const inventory = [{ id: 'stock-1', product: { name: 'Cola', sku: 'COL-24' } }]

// Verify user queries match identifiers, customer names, products and display statuses.
test('warehouse search supports case-insensitive multiword queries and status labels', () => {
  assert.equal(searchWarehouseRecords(' ANA cola ', orders, inventory)[0]?.id, 'request-1')
  assert.equal(searchWarehouseRecords('out for delivery', orders, inventory)[0]?.id, 'order-2')
  assert.equal(searchWarehouseRecords('col-24', orders, inventory)[0]?.kind, 'inventory')
  assert.equal(searchWarehouseRecords('PO-102', orders, inventory)[0]?.kind, 'orders')
  assert.equal(searchWarehouseRecords('ORD-101', orders, inventory)[0]?.kind, 'purchaseRequests')
})

test('blank and unmatched queries return no results; only supplied records are searched', () => {
  assert.deepEqual(searchWarehouseRecords(' ', orders, inventory), [])
  assert.deepEqual(searchWarehouseRecords('missing', orders, inventory), [])
  assert.deepEqual(searchWarehouseRecords('ORD-102', orders.slice(0, 1), inventory), [])
  assert.equal(searchWarehouseRecords('cola', orders, inventory).length, 2)
})
