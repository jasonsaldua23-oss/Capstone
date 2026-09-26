import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { REPORT_DATASETS } from './reports/report-data-plan'

// Run the real pagination and request code against controlled responses, without live data.
function reader(respond: (url: URL) => { status?: number; data: object }) {
  const calls: URL[] = []
  const exports: any = {}
  const fetch = async (input: string) => {
    const url = new URL(input, 'http://test.local')
    calls.push(url)
    const response = respond(url)
    return Response.json(response.data, { status: response.status ?? 200 })
  }
  const source = readFileSync(new URL('./shared.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, {
    exports, fetch, URLSearchParams, Headers, Request, AbortController, DOMException,
    window: { setTimeout, clearTimeout },
    require: (name: string) => name.endsWith('/client-auth')
      ? { getTabAuthToken: () => 'test-token' }
      : { ApiReadError: class extends Error {} },
  })
  return { fetchAll: exports.fetchAllPaginatedCollection, calls }
}

test('every report dataset loads later pages, even when the server caps page size', async () => {
  for (const dataset of Object.values(REPORT_DATASETS)) {
    const key = dataset.keys[0]
    const { fetchAll, calls } = reader((url) => ({ data: {
      [key]: [{ id: `row-${url.searchParams.get('page')}` }], pageSize: 1, totalPages: 3, total: 3,
    } }))
    const result = await fetchAll(dataset.endpoint, key, undefined, { retries: 0 })
    assert.equal(result.ok, true)
    assert.deepEqual(Array.from(result.data[key], (row: any) => row.id), ['row-1', 'row-2', 'row-3'])
    assert.equal(calls.length, 3)
  }
})

test('a failed later page or page cap never returns partial financial data as success', async () => {
  const { fetchAll } = reader((url) => url.searchParams.get('page') === '2'
    ? { status: 500, data: { error: 'Page failed' } }
    : { data: { orders: [{ id: 'first' }], totalPages: 2 } })
  assert.equal((await fetchAll('/api/orders', 'orders', undefined, { retries: 0 })).ok, false)
  assert.equal((await fetchAll('/api/orders', 'orders', undefined, { retries: 0, maxPages: 1 })).ok, false)
})

test('delta pagination preserves the cursor and deduplicates overlapping IDs', async () => {
  const { fetchAll, calls } = reader((url) => ({ data: {
    orders: url.searchParams.get('page') === '1' ? [{ id: 'delivered' }, { id: 'overlap' }] : [{ id: 'overlap' }, { id: 'processing' }],
    totalPages: 2,
  } }))
  const cursor = '2026-09-25T00:00:00Z'
  const result = await fetchAll(`/api/orders?updatedAfter=${cursor}&sort=updated_at`, 'orders')
  assert.deepEqual(Array.from(result.data.orders, (row: any) => row.id), ['delivered', 'overlap', 'processing'])
  assert.ok(calls.every((url) => url.searchParams.get('updatedAfter') === cursor && url.searchParams.get('sort') === 'updated_at'))
})
