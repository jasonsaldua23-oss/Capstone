import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { QueryClient, QueriesObserver } from '@tanstack/react-query'
// @ts-ignore Node's test runner reads this TypeScript source directly.
import { REPORT_DATASETS, REPORT_DEPENDENCIES, type ReportDataset } from './report-data-plan.ts'

test('opening Reports avoids unrelated requests, reuses orders, and refreshes invalidated tabs', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const names = Object.keys(REPORT_DATASETS) as ReportDataset[]
  const calls: ReportDataset[] = []
  const options = (tab: string) => names.map((name) => ({
    queryKey: ['report-data', 'test-user', name],
    enabled: REPORT_DEPENDENCIES[tab].includes(name),
    staleTime: 60_000,
    queryFn: async () => { calls.push(name); return [{ id: `${name}-record` }] },
  }))
  const observer = new QueriesObserver(client, options('purchase_requests'))
  const unsubscribe = observer.subscribe(() => {})
  try {
    await setImmediate()
    assert.deepEqual(calls, ['orders'])
    assert.equal(observer.getCurrentResult()[names.indexOf('orders')].isSuccess, true)

    observer.setQueries(options('purchase_orders'))
    await setImmediate()
    assert.deepEqual(calls, ['orders'], 'the next orders report must reuse the same complete collection')

    observer.setQueries(options('logistics'))
    await setImmediate()
    assert.deepEqual(calls, ['orders', 'trips', 'drivers', 'warehouses'])
    await client.invalidateQueries({ queryKey: ['report-data', 'test-user'] })
    assert.equal(calls.filter((name) => name === 'orders').length, 1, 'inactive tabs must not refetch in the background')
    observer.setQueries(options('purchase_requests'))
    await setImmediate()
    assert.equal(calls.filter((name) => name === 'orders').length, 2, 'changed orders must reload when their tab returns')
  } finally {
    unsubscribe()
    observer.destroy()
    client.clear()
  }
})

test('report dependencies include the sources used by charts and exports', () => {
  assert.deepEqual(REPORT_DEPENDENCIES.warehouse, ['warehouses', 'inventory', 'inventoryTransactions'])
  assert.deepEqual(REPORT_DEPENDENCIES.feedback, ['feedback', 'orders', 'trips'])
  assert.deepEqual(REPORT_DEPENDENCIES.inventory, ['inventory', 'inventoryTransactions', 'stockBatches', 'warehouses', 'orders', 'retailSales'])
  for (const dependencies of Object.values(REPORT_DEPENDENCIES)) {
    for (const name of dependencies) assert.ok(name in REPORT_DATASETS)
  }
})
