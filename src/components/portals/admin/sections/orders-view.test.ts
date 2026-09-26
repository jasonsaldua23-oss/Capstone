import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import * as shared from './shared'
import * as documents from '@/lib/purchase-documents'
import * as empties from '@/components/shared/empties-charge-note'

const source = readFileSync(new URL('./orders-view.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

// Render the real admin view with controlled state; keep network effects and UI wrappers out of these regressions.
function renderOrders(orders: object[]) {
  const state: unknown[] = [orders, false]
  let stateIndex = 0
  const hooks = {
    useState: (initial: unknown) => {
      const index = stateIndex++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], (next: unknown) => {
        state[index] = typeof next === 'function' ? next(state[index]) : next
      }]
    },
    useMemo: (calculate: () => unknown) => calculate(),
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: () => {},
  }
  const wrapper = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children)
  const exports: Record<string, (...args: any[]) => any> = {}
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === 'react') return { ...hooks, default: React }
      if (name === 'react/jsx-runtime') return jsxRuntime
      if (name === 'next/dynamic') return { default: () => wrapper }
      if (name === './shared') return shared
      if (name === '@/lib/purchase-documents') return documents
      if (name === '@/components/shared/empties-charge-note') return empties
      return new Proxy({}, { get: () => wrapper })
    },
  })
  return () => {
    stateIndex = 0
    const tree = exports.OrdersView({ mode: 'orders' }) as React.ReactElement
    return { tree, html: renderToStaticMarkup(tree) }
  }
}

function findByLabel(tree: React.ReactNode, label: string): React.ReactElement<any> | undefined {
  for (const child of React.Children.toArray(tree)) {
    if (!React.isValidElement<{ children?: React.ReactNode; 'aria-label'?: string }>(child)) continue
    if (child.props['aria-label'] === label) return child
    const found = findByLabel(child.props.children, label)
    if (found) return found
  }
  return undefined
}

const purchaseOrder = (id: string, status: string, deliveryDate = '2026-09-26') => ({
  id,
  orderNumber: `PO-${id}`,
  purchaseOrderNumber: `PO-${id}`,
  status,
  approvedAt: '2026-09-25T09:00:00',
  createdAt: '2026-09-24T09:00:00',
  deliveryDate,
  items: [],
  totalAmount: 100,
})

test('admin PO status choices remain available with no orders or only one stage', () => {
  // These choices must not disappear when the currently loaded rows have different stages.
  for (const orders of [[], [purchaseOrder('processing', 'PREPARING')], [purchaseOrder('delivered', 'DELIVERED')]]) {
    const { html } = renderOrders(orders)()
    for (const [value, label] of [
      ['APPROVED', 'Approved'], ['PROCESSING', 'Processing'], ['RESCHEDULED', 'Rescheduled'],
      ['OUT_FOR_DELIVERY', 'Out for Delivery'], ['DELIVERED', 'Delivered'], ['CANCELLED', 'Cancelled'],
    ]) {
      assert.ok(html.includes(`<option value="${value}">${label}</option>`), `${value} must always be selectable`)
    }
  }
})

test('admin PO custom date selects the displayed delivery date instead of its approval date', () => {
  const render = renderOrders([
    purchaseOrder('delivery-26', 'DELIVERED'),
    { ...purchaseOrder('delivery-27', 'PREPARING', '2026-09-27'), approvedAt: '2026-09-26T09:00:00' },
  ])
  const input = findByLabel(render().tree, 'Delivery date')
  assert.ok(input)
  // Exercise the actual input handler, which also activates the custom-date preset.
  input.props.onChange({ target: { value: '2026-09-26' } })
  const { tree, html } = render()
  assert.equal(findByLabel(tree, 'Filter orders by delivery date')?.props.value, 'custom')
  assert.ok(html.includes('PO-delivery-26'))
  assert.ok(!html.includes('PO-delivery-27'))
})

test('admin PO delivery-stage selection filters rows and stays selected with no matches', () => {
  const render = renderOrders([
    purchaseOrder('processing', 'PREPARING'),
    purchaseOrder('out', 'OUT_FOR_DELIVERY'),
  ])
  findByLabel(render().tree, 'Filter orders by status')?.props.onChange({ target: { value: 'OUT_FOR_DELIVERY' } })
  const outgoing = render()
  assert.ok(outgoing.html.includes('PO-out'))
  assert.ok(!outgoing.html.includes('PO-processing'))
  findByLabel(outgoing.tree, 'Filter orders by status')?.props.onChange({ target: { value: 'RESCHEDULED' } })
  const rescheduled = render()
  assert.equal(findByLabel(rescheduled.tree, 'Filter orders by status')?.props.value, 'RESCHEDULED')
  assert.ok(rescheduled.html.includes('No orders match the selected filters'))
  assert.ok(rescheduled.html.includes('<option value="RESCHEDULED" selected="">Rescheduled</option>'))
})
