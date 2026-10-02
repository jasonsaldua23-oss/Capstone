import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as dates from '../report-date-utils'
import * as shared from '../shared'
import * as metrics from '@/lib/report-metrics'
import * as documents from '@/lib/purchase-documents'
import * as movement from '@/lib/product-movement'

// Exercise the components' actual data derivation with controlled hook state.
// Stop at the requested memo before rendering: these are filter tests, not browser tests.
function derive(file: string, component: string, props: object, state: unknown[], memoNumber: number): any {
  let stateIndex = 0, memoIndex = 0, result: unknown
  const stop = Symbol('captured report rows')
  const hooks = {
    // Effects never run here: these tests feed fetched data in as state instead.
    useCallback: (callback: unknown) => callback,
    useEffect: () => {},
    useState: (initial: unknown) => [stateIndex < state.length ? state[stateIndex++] : initial, () => {}],
    useMemo: (calculate: () => unknown) => {
      const value = calculate()
      if (++memoIndex === memoNumber) { result = value; throw stop }
      return value
    },
  }
  const exports: Record<string, (...args: any[]) => any> = {}
  const source = readFileSync(new URL(`./${file}.tsx`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === 'react') return hooks
    if (name.endsWith('/report-date-utils')) return dates
    if (name === '../shared') return shared
    if (name === '@/lib/report-metrics') return metrics
    if (name === '@/lib/purchase-documents') return documents
    if (name === '@/lib/product-movement') return movement
    return {}
  } })
  try { exports[component](props) } catch (error) { if (error !== stop) throw error }
  assert.equal(memoIndex, memoNumber)
  return result
}

const orders = [
  { id: 'start', createdAt: '2026-09-10T00:00:00', status: 'DELIVERED', paymentStatus: 'PAID' },
  { id: 'end', createdAt: '2026-09-12T23:59:59.999', status: 'DELIVERED', paymentStatus: 'PAID' },
  { id: 'outside', createdAt: '2026-09-13T00:00:00', status: 'DELIVERED', paymentStatus: 'PAID' },
  { id: 'pending', createdAt: '2026-09-11T12:00:00', status: 'PENDING', paymentStatus: 'PENDING' },
  { id: 'missing', createdAt: '', status: 'DELIVERED', paymentStatus: 'PAID' },
].map((row) => ({ ...row, orderNumber: `PO-${row.id}`, purchaseOrderNumber: `PO-${row.id}`, purchaseRequestNumber: `PR-${row.id}`, purchaseRequest: {}, requestStatus: row.status === 'PENDING' ? 'PENDING' : 'APPROVED', customer: { id: 'client', name: 'Alice', email: 'alice@example.com' }, totalAmount: 100, items: [] }))

const ids = (rows: any[]) => Array.from(rows, (row) => row.id)

test('purchase request and order reports combine custom range, status, search, and sort', () => {
  for (const [file, component, status] of [['purchase-requests-report', 'PurchaseRequestsReport', 'APPROVED'], ['purchase-orders-report', 'PurchaseOrdersReport', 'DELIVERED']]) {
    const state = [' ALICE ', status, 'custom', '2026-09-10', '2026-09-12', 'asc', 1]
    assert.deepEqual(ids(derive(file, component, { orders }, state, 2)), ['start', 'end'])
    state[5] = 'desc'
    assert.deepEqual(ids(derive(file, component, { orders }, state, 2)), ['end', 'start'])
    state[0] = 'no matching client'
    assert.equal(derive(file, component, { orders }, state, 2).length, 0)
  }
})

test('transactions combine dates with channel, status, payment, and search', () => {
  const state = ['alice', 'WHOLESALE_ONLINE', 'DELIVERED', 'PAID', 'custom', '2026-09-10', '2026-09-12', 'asc', 1]
  assert.deepEqual(ids(derive('transactions-report', 'TransactionsReport', { orders }, state, 2)), ['start', 'end'])
  state[1] = 'RETAIL'
  assert.equal(derive('transactions-report', 'TransactionsReport', { orders }, state, 2).length, 0)
})

// /api/retail/sales rows carry their state only as transactionStatus. The reports read
// retailStatus and status, found nothing, defaulted to COMPLETED, and counted cancelled sales.
// subtotal is the goods; the rest of totalAmount is the bottle deposit.
const counterSales = [
  { id: 'sale-done', transactionNumber: 'POS-1', createdAt: '2026-09-11T10:00:00', transactionStatus: 'COMPLETED', customerName: 'Walk-in Customer', subtotal: '90.00', totalAmount: '100.00', items: [] },
  { id: 'sale-void', transactionNumber: 'POS-2', createdAt: '2026-09-11T11:00:00', transactionStatus: 'CANCELLED', customerName: 'Walk-in Customer', subtotal: '850.00', totalAmount: '900.00', items: [] },
]

test('cancelled counter sales stay listed but leave every retail total', () => {
  const retailProps = { orders: [], retailSales: counterSales }
  const retailState = ['all', '', '', '', 'asc', 1]
  const listed = derive('retail-sales-report', 'RetailSalesReport', retailProps, retailState, 1)
  assert.deepEqual(Array.from(listed, (row: any) => [row.id, row.status]), [['sale-done', 'COMPLETED'], ['sale-void', 'CANCELLED']])
  const retail = derive('retail-sales-report', 'RetailSalesReport', retailProps, retailState, 4)
  // Takings are the goods; the 10.00 bottle deposit is reported beside them.
  assert.deepEqual([retail.currentSales, retail.currentDeposits, retail.currentTxCount], [90, 10, 1])

  const ledger = derive('transactions-report', 'TransactionsReport', retailProps, ['', 'all', 'all', 'all', 'all', '', '', 'asc', 1], 3)
  assert.deepEqual([ledger.totalVolume, ledger.totalDeposits, ledger.totalCount], [90, 10, 2])

  // Without the API's totals the page adds up what it loaded.
  const counter = derive('../retail-transactions-view', 'RetailTransactionsView', {}, [counterSales, false, '', null, null], 2)
  assert.deepEqual({ ...counter }, { revenue: 90, deposits: 10, completedCount: 1, cancelledCount: 1 })
})

// The page loads only the newest receipts, so its card must use the API's totals over all of them.
test('counter transactions card reads the totals over every sale', () => {
  const summary = { completedCount: 140, cancelledCount: 3, salesTotal: 51234.5, depositTotal: 1820 }
  const counter = derive('../retail-transactions-view', 'RetailTransactionsView', {}, [counterSales, false, '', null, summary, 143], 2)
  assert.deepEqual({ ...counter }, { revenue: 51234.5, deposits: 1820, completedCount: 140, cancelledCount: 3 })
})

test('transaction status options cover every status their badge shows', () => {
  const props = { orders: [orders[0], { ...orders[0], id: 'rejected', status: 'REJECTED' }], retailSales: counterSales }
  const state = ['', 'all', 'DELIVERED', 'all', 'all', '', '', 'asc', 1]
  // "Delivered / Completed" used to drop every counter sale, which finishes COMPLETED.
  assert.deepEqual(ids(derive('transactions-report', 'TransactionsReport', props, state, 2)), ['start', 'sale-done'])
  // "Cancelled" used to drop rejected orders, although their badge reads Cancelled.
  state[2] = 'CANCELLED'
  assert.deepEqual(ids(derive('transactions-report', 'TransactionsReport', props, state, 2)), ['rejected', 'sale-void'])
})

test('logistics combines custom dates, trip status, driver, and search', () => {
  const trips = orders.map((row) => ({ ...row, tripNumber: row.orderNumber, status: row.status === 'PENDING' ? 'PLANNED' : 'COMPLETED', driver: { id: 'driver-1', name: 'Alice' } }))
  const state = ['alice', 'COMPLETED', 'driver-1', 'custom', '2026-09-10', '2026-09-12', 'asc', 1]
  assert.deepEqual(ids(derive('logistics-report', 'LogisticsReport', { trips }, state, 2)), ['start', 'end'])
  state[2] = 'driver-2'
  assert.equal(derive('logistics-report', 'LogisticsReport', { trips }, state, 2).length, 0)
})

test('retail period preserves full custom days and an exactly preceding comparison window', () => {
  const retailOrders = orders.map((row) => ({ ...row, salesChannel: 'RETAIL_POS' }))
  const result = derive('retail-sales-report', 'RetailSalesReport', { orders: retailOrders }, ['custom', '2026-09-10', '2026-09-12', '', 'asc', 1], 2)
  assert.deepEqual(ids(result.currentPeriodItems), ['start', 'end', 'pending'])
  assert.equal(result.prevPeriodItems.length, 0)
})

test('warehouse period counts inclusive days and rejects invalid dates', () => {
  const state = ['custom', '2026-09-10', '2026-09-12', 'all', '', 'velocity', 'desc', 1]
  assert.equal(derive('warehouse-inventory-report', 'WarehouseInventoryReport', { inventory: [] }, state, 1), 3)
  const matches = derive('warehouse-inventory-report', 'WarehouseInventoryReport', { inventory: [] }, state, 2)
  assert.equal(matches('2026-09-12T23:59:59.999'), true)
  assert.equal(matches('invalid'), false)
  assert.equal(matches('2026-09-13T00:00:00'), false)
})

// Regression: rank was the row's position after the table sort, so sorting by stock
// gave the gold medal to the least-stocked product, and 30 loose bottles beat 5 cases.
test('fast-moving rank and #1 follow volume whatever the table is sorted by', () => {
  const sale = (id: string, productId: string, quantity: number, mode = 'CASE') => ({
    id,
    createdAt: '2026-09-11T10:00:00',
    transactionStatus: 'COMPLETED',
    items: [{ mode, productId, productName: `Product ${productId}`, quantity, caseCapacity: 24, unitPrice: '10.00', productSubtotal: String(quantity * 10) }],
  })
  // Product ids are lowercase cuids, as the backend issues them.
  const retailSales = [sale('s1', 'a', 5), sale('s2', 'b', 2), sale('s3', 'c', 30, 'LOOSE')]
  const inventory = [['a', 100], ['b', 1], ['c', 50]].map(([id, quantity]) => ({ product: { id, name: `Product ${id}` }, quantity }))
  const state = ['all', '', '', 'all', '', 'stock', 'asc', 1]
  const props = { inventory, retailSales }

  const rows = derive('warehouse-inventory-report', 'WarehouseInventoryReport', props, state, 6)
  assert.deepEqual(Array.from(rows, (row: any) => [row.productId, row.rank]), [['b', 2], ['c', 3], ['a', 1]])
  const kpis = derive('warehouse-inventory-report', 'WarehouseInventoryReport', props, state, 8)
  assert.equal(kpis.topFastestProduct.productId, 'a')
  assert.equal(kpis.totalUnitsDispatched, 5 + 2 + 30 / 24)
})

test('replacement filters and historical chart use the same selected records', () => {
  const replacements = orders.map((row) => ({ ...row, status: row.status === 'PENDING' ? 'REPORTED' : 'RESOLVED', reason: 'Broken bottle' }))
  const state = ['alice', 'RESOLVED', 'Broken bottle', 'custom', '2026-09-10', '2026-09-12', 'asc', 1]
  assert.deepEqual(ids(derive('replacement-records-report', 'ReplacementRecordsReport', { replacements }, state, 4)), ['start', 'end'])
  const chart = derive('replacement-records-report', 'ReplacementRecordsReport', { replacements }, state, 6)
  assert.equal(chart.length, 3)
  assert.equal(chart.reduce((sum: number, day: any) => sum + day.total, 0), 2)
  assert.equal(chart[0].dateKey, '2026-09-10')
  assert.equal(chart[2].dateKey, '2026-09-12')
  state[2] = 'Wrong item'
  assert.equal(derive('replacement-records-report', 'ReplacementRecordsReport', { replacements }, state, 4).length, 0)
})

// Regression: rejected and cancelled replacements were drawn as "Open / In-Progress".
// Admins reject requests and a cancelled replacement delivery cancels the request.
test('replacement trend keeps rejected and cancelled replacements out of open', () => {
  const statuses = ['RESOLVED_ON_DELIVERY', 'COMPLETED', 'REJECTED', 'CANCELLED', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS']
  const replacements = statuses.map((status, index) => ({ ...orders[0], id: `rep-${index}`, status, reason: 'Broken bottle' }))
  const [day] = derive('replacement-records-report', 'ReplacementRecordsReport', { replacements }, ['', 'all', 'all', 'all', '', '', 'asc', 1], 6)
  assert.deepEqual(
    { total: day.total, resolved: day.resolved, rejected: day.rejected, pending: day.pending },
    { total: 7, resolved: 2, rejected: 2, pending: 3 },
  )
})

test('top clients combines its custom range and client search', () => {
  const state = ['custom', '2026-09-10', '2026-09-12', 'alice', 'amount', 1]
  const rows = derive('top-clients-report', 'TopClientsReport', { orders }, state, 3)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].totalAmount, 200)
  state[3] = 'no matching client'
  assert.equal(derive('top-clients-report', 'TopClientsReport', { orders }, state, 3).length, 0)
})

test('September 25 PO report and warehouse page agree on one delivered and two processing orders', () => {
  // Staff filters delivery date; report filters approval date. These POs share both dates.
  const purchaseOrders = ['DELIVERED', 'PREPARING', 'PROCESSING'].map((status, index) => ({
    ...orders[0], id: `po-${index}`, purchaseOrderNumber: `PO-${index}`, orderNumber: `PO-${index}`,
    createdAt: '2026-09-24T12:00:00', approvedAt: '2026-09-25T09:00:00', deliveryDate: '2026-09-25', status,
  }))
  for (const stage of ['all', 'DELIVERED', 'PROCESSING']) {
    const report = derive('purchase-orders-report', 'PurchaseOrdersReport', { orders: purchaseOrders }, ['', stage, 'custom', '2026-09-25', '2026-09-25', 'asc', 1], 2)
    const page = derive('../../../warehouse/sections/orders/orders-view', 'WarehouseOrdersView', { purchaseOrders }, ['', stage, 'custom', '2026-09-25', '', ''], 2)
    assert.deepEqual(ids(report), ids(page))
    assert.equal(report.length, stage === 'all' ? 3 : stage === 'DELIVERED' ? 1 : 2)
  }
})

test('warehouse custom date follows the displayed delivery schedule, not approval or creation', () => {
  const purchaseOrders = [
    { ...orders[0], id: 'delivery-today', approvedAt: '2026-09-25T09:00:00', deliveryDate: '2026-09-26' },
    { ...orders[0], id: 'approved-today', approvedAt: '2026-09-26T09:00:00', deliveryDate: '2026-09-27' },
    { ...orders[0], id: 'timeline-today', timeline: { deliveryDate: '2026-09-26' } },
    { ...orders[0], id: 'unscheduled', createdAt: '2026-09-26T09:00:00' },
  ]
  const page = derive('../../../warehouse/sections/orders/orders-view', 'WarehouseOrdersView', { purchaseOrders }, ['', 'all', 'custom', '2026-09-26', '', ''], 2)
  assert.deepEqual(ids(page), ['delivery-today', 'timeline-today'])
})
