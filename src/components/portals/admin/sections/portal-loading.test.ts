import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import * as reportPlan from './reports/report-data-plan'

// Exercise the real loading branches and mount effects without live API requests.
const compiled = Object.fromEntries(['reports-view', 'customers-view'].map((file) => [file,
  ts.transpileModule(readFileSync(new URL(`./${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText,
]))

function loadView(file: string, overrides: Record<string, any>, initialState?: unknown[]) {
  const state: unknown[] = [...(initialState || [])]
  const effects: Array<() => unknown> = []
  let index = 0
  const hooks = {
    useState: (initial: unknown) => {
      const position = index++
      if (!(position in state)) state[position] = initial
      return [state[position], (value: unknown) => { state[position] = value }]
    },
    useRef: (value: unknown) => ({ current: value }),
    useMemo: (fn: () => unknown) => fn(),
    useEffect: (fn: () => unknown) => effects.push(fn),
  }
  const wrapper = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children)
  const fallback = new Proxy({}, { get: () => wrapper })
  const exports: any = {}
  vm.runInNewContext(compiled[file], {
    exports, console, window: { setInterval: () => 1, clearInterval: () => {} },
    document: { visibilityState: 'visible' },
    require: (name: string) => {
      if (name in overrides) return overrides[name]
      if (name === 'react') return { ...hooks, default: React }
      if (name === 'react/jsx-runtime') return jsxRuntime
      if (name === 'next/dynamic') return { default: () => wrapper }
      if (name === '@/app/page') return { useAuth: () => ({ user: { userId: 'staff' } }) }
      if (name === './reports/report-data-plan') return reportPlan
      if (name === './reports/use-report-datasets') return { useReportDatasets: () => ({}) }
      if (name === '@/lib/data-sync') return { subscribeDataSync: () => () => {} }
      return fallback
    },
  })
  return { exports, state, effects }
}

test('Warehouse and Inventory report navigation remains usable during loading and errors', () => {
  for (const tab of ['warehouse', 'inventory']) {
    for (const failed of [false, true]) {
      let queries: any[] = []
      const { exports } = loadView('reports-view', {
        '@tanstack/react-query': {
          useQueryClient: () => ({}),
          useQueries: (options: any) => {
            queries = options.queries
            return queries.map(() => ({ isPending: !failed, isError: failed, error: failed ? new Error('Report data unavailable') : null, refetch: async () => {} }))
          },
        },
      }, [tab])
      const html = renderToStaticMarkup(exports.ReportsView())
      for (const title of ['Purchase Orders', 'Warehouse', 'Inventory', 'Feedback']) assert.ok(html.includes(title))
      if (failed) assert.ok(html.includes('Report data unavailable') && html.includes('Retry'))
      // Copy out of the vm realm: its arrays have a different Array.prototype, which
      // strict deep equality rejects even when the contents match.
      assert.deepEqual([...queries.filter((query) => query.enabled).map((query) => query.queryKey[2])],
        Object.keys(reportPlan.REPORT_DATASETS).filter((name) => reportPlan.REPORT_DEPENDENCIES[tab].includes(name as reportPlan.ReportDataset)))
    }
  }
})

test('Clients loads directory aggregates without downloading order and feedback histories', async () => {
  const calls: string[] = []
  const rows = [{ id: 'client', successfulDeliveries: 7, successfulDeliverySpend: 1200, rating: 4.5, ratingCount: 24 }]
  const { exports, effects, state } = loadView('customers-view', {
    './shared': {
      fetchAllPaginatedCollection: async (endpoint: string, key: string) => {
        calls.push(endpoint)
        assert.equal(key, 'customers')
        return { ok: true, data: { customers: rows } }
      },
      getCollection: (data: any) => data.customers,
    },
  })
  exports.CustomersView()
  for (const effect of effects) effect()
  await setImmediate()
  assert.deepEqual(calls, ['/api/customers'])
  assert.equal(state[0], rows)
  assert.equal(state[2], false, 'The loading state ends after the directory arrives')
})
