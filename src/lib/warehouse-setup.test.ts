import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWarehouseSetup } from './warehouse-setup.ts'

// Regression: gateway/parse failures previously sent an existing warehouse into setup.
test('invalid responses cannot establish an unregistered warehouse', () => {
  for (const payload of [null, undefined, {}, '', '<html>Gateway error</html>', { success: true }, { error: 'Unavailable' }, { warehouses: null }]) {
    assert.throws(() => parseWarehouseSetup(payload), /Unable to verify/)
  }
  assert.throws(() => parseWarehouseSetup({ success: false, warehouses: [], error: 'Unauthorized' }), /Unauthorized/)
})

test('an explicitly empty collection still allows genuine first-time registration', () => {
  assert.deepEqual(parseWarehouseSetup({ success: true, warehouses: [], total: 0 }), [])
})

test('registered warehouse responses preserve the existing record', () => {
  const rows = [{ id: 'warehouse-1', name: 'Main Warehouse', isActive: true }]
  assert.deepEqual(parseWarehouseSetup({ success: true, warehouses: rows, total: 1 }), rows)
  assert.deepEqual(parseWarehouseSetup({ data: rows }), rows)
  assert.deepEqual(parseWarehouseSetup(rows), rows)
})
