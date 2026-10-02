import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProductMovements, formatDailyVelocity, resolveVelocityDays } from './product-movement.ts'

const everything = () => true

// Shapes follow the backend: /api/orders items (api_serializers) and /api/retail/sales (serialize_retail_sale).
function onlineOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 'ORD-2026-0001',
    status: 'DELIVERED',
    createdAt: '2026-09-20T09:00:00+08:00',
    deliveredAt: '2026-09-21T15:00:00+08:00',
    items: [],
    ...overrides,
  }
}

function caseLine(productId: string, quantity: number) {
  return { itemType: 'STANDARD_CASE', quantity, unitPrice: 500, product: { id: productId, name: `Product ${productId}`, unit: 'case' } }
}

function mixedLine(caseCount: number, parts: Array<[string, number]>) {
  return {
    itemType: 'MIXED_CASE',
    quantity: caseCount,
    caseCapacity: parts.reduce((sum, [, perCase]) => sum + perCase, 0),
    unitPrice: 600,
    product: null,
    components: parts.map(([productId, perCase]) => ({
      productId,
      productName: `Product ${productId}`,
      quantityPerCase: perCase,
      caseCount,
      totalBaseUnits: perCase * caseCount,
      unitPrice: 25,
      componentSubtotal: perCase * caseCount * 25,
      product: { id: productId, name: `Product ${productId}`, category: 'Glass Bottle Softdrinks' },
    })),
  }
}

function counterSale(items: unknown[], overrides: Record<string, unknown> = {}) {
  return { id: 'sale-1', createdAt: '2026-09-22T10:00:00+08:00', transactionStatus: 'COMPLETED', items, ...overrides }
}

const byId = (rows: ReturnType<typeof buildProductMovements>) => new Map(rows.map((row) => [row.productId, row]))

test('the product that sold the most case-equivalents ranks first', () => {
  // A: 8 full cases. B: 10 mixed cases at 12 of 24 bottles, plus 15 loose bottles at the counter.
  const rows = byId(buildProductMovements(
    [onlineOrder({ items: [caseLine('A', 8), mixedLine(10, [['B', 12], ['C', 12]])] })],
    [counterSale([{ mode: 'LOOSE', productId: 'B', productName: 'Product B', quantity: 15, caseCapacity: 24, unitPrice: '25.00', productSubtotal: '375.00', packagingType: 'Glass Bottle' }])],
    everything,
  ))

  assert.equal(rows.get('A')?.totalComparableUnits, 8)
  assert.equal(rows.get('B')?.totalComparableUnits, 5 + 15 / 24)
  assert.equal(rows.get('C')?.totalComparableUnits, 5)
  const ranked = [...rows.values()].sort((a, b) => b.totalComparableUnits - a.totalComparableUnits)
  assert.equal(ranked[0].productId, 'A')
})

test('a mixed case is shared between its products, not counted as a full case of each', () => {
  const [row] = buildProductMovements(
    [onlineOrder({ items: [mixedLine(2, [['B', 12], ['C', 12]])] })],
    [],
    everything,
  ).filter((movement) => movement.productId === 'B')

  assert.equal(row.totalComparableUnits, 1)
  assert.equal(row.totalUnitsSold, 24)
  assert.deepEqual([...row.unitsMap], [['glass bottles', 24]])
  assert.equal(row.totalRevenue, 600)
})

test('counter mixed-case bottles are already a total across cases', () => {
  // retail_pos stores quantityBaseUnits for all cases; multiplying by the case count again inflated it.
  const rows = byId(buildProductMovements([], [counterSale([{
    mode: 'MIXED_CASE',
    productId: null,
    quantity: 3,
    caseCapacity: 24,
    components: [
      { productId: 'B', productName: 'Product B', quantityPerCase: 12, caseCount: 3, quantityBaseUnits: 36, unitPrice: '25.000000', productSubtotal: '900.00', packagingType: 'Glass Bottle' },
      { productId: 'C', productName: 'Product C', quantityPerCase: 12, caseCount: 3, quantityBaseUnits: 36, unitPrice: '25.000000', productSubtotal: '900.00', packagingType: 'Glass Bottle' },
    ],
  }])], everything))

  assert.equal(rows.get('B')?.totalUnitsSold, 36)
  assert.equal(rows.get('B')?.totalComparableUnits, 1.5)
  assert.equal(rows.get('B')?.totalRevenue, 900)
})

test('loose counter bottles count as their share of a case and keep their bottle unit', () => {
  const [row] = buildProductMovements([], [counterSale([
    { mode: 'LOOSE', productId: 'B', productName: 'Product B', quantity: 12, caseCapacity: 24, unitPrice: '25.00', productSubtotal: '300.00', packagingType: 'Glass Bottle' },
    { mode: 'CASE', productId: 'B', productName: 'Product B', quantity: 2, caseCapacity: 24, unitPrice: '550.00', productSubtotal: '1100.00', packagingType: 'Glass Bottle' },
  ])], everything)

  assert.equal(row.totalComparableUnits, 2.5)
  assert.deepEqual(Object.fromEntries(row.unitsMap), { 'glass bottles': 12, cases: 2 })
  assert.equal(row.totalRevenue, 1400)
})

// Regression: counter CASE lines all read "cases" and orders kept the format from
// checkout, so one product showed "2 cases, 499 packs" or "404 cases" beside a stock of packs.
test("whole units are labelled in the product's current order format", () => {
  const caseOrder = onlineOrder({ items: [{ itemType: 'STANDARD_CASE', quantity: 404, unitPrice: 360, productUnit: 'case', product: { id: 'S', name: 'Product S', unit: 'case' } }] })
  const counterCase = (unit?: string) => ({ mode: 'CASE', unit, productId: 'S', productName: 'Product S', quantity: 1, caseCapacity: 24, unitPrice: '360.00', productSubtotal: '360.00', packagingType: 'PET/Plastic Bottle' })

  // The product is sold in packs now, so every whole unit reads packs, as its stock does.
  const [current] = buildProductMovements([caseOrder], [counterSale([counterCase(), counterCase('case')])], everything, { currentProductUnit: () => 'pack' })
  assert.deepEqual(Object.fromEntries(current.unitsMap), { packs: 406 })

  // With no stock row to say, the unit the sale recorded stands.
  const [recorded] = buildProductMovements([], [counterSale([counterCase('pack')])], everything)
  assert.deepEqual(Object.fromEntries(recorded.unitsMap), { packs: 1 })
})

test('a loose line is labelled by its container, not by the whole unit', () => {
  const [row] = buildProductMovements([], [counterSale([
    { mode: 'LOOSE', unit: 'case', productId: 'S', productName: 'Product S', quantity: 6, caseCapacity: 24, unitPrice: '20.00', productSubtotal: '120.00', category: 'Energy Drinks', packagingType: 'PET/Plastic Bottle' },
  ])], everything)

  assert.deepEqual(Object.fromEntries(row.unitsMap), { 'plastic bottles': 6 })
})

test('cancelled and unfinished counter sales are not sales', () => {
  const line = { mode: 'CASE', productId: 'A', productName: 'Product A', quantity: 4, caseCapacity: 24, unitPrice: '500.00', productSubtotal: '2000.00' }
  const rows = buildProductMovements([], [
    counterSale([line], { id: 'cancelled', transactionStatus: 'CANCELLED' }),
    counterSale([line], { id: 'open', transactionStatus: 'OPEN' }),
    counterSale([line], { id: 'done', transactionStatus: 'COMPLETED' }),
  ], everything)

  assert.equal(rows[0].totalComparableUnits, 4)
  assert.equal(rows[0].orderCount, 1)
})

test('only delivered, non-replacement orders count', () => {
  const rows = buildProductMovements([
    onlineOrder({ id: 'pending', status: 'PENDING', deliveredAt: null, items: [caseLine('A', 50)] }),
    onlineOrder({ id: 'out', status: 'OUT_FOR_DELIVERY', deliveredAt: null, items: [caseLine('A', 50)] }),
    onlineOrder({ id: 'rejected', status: 'REJECTED', deliveredAt: null, items: [caseLine('A', 50)] }),
    onlineOrder({ id: 'replacement', orderNumber: 'RPL-2026-0003', items: [caseLine('A', 50)] }),
    onlineOrder({ id: 'scheduled-replacement', isScheduledReplacement: true, items: [caseLine('A', 50)] }),
    onlineOrder({ id: 'delivered', items: [caseLine('A', 3)] }),
  ], [], everything)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].totalComparableUnits, 3)
})

test('product revenue takes its share of the order discount and no deposit', () => {
  // 1,000 of goods less a 100 bulk discount; 240 of the total is container deposit.
  const rows = byId(buildProductMovements([onlineOrder({
    subtotal: 1000,
    discount: 100,
    totalAmount: 1140,
    items: [
      { itemType: 'STANDARD_CASE', quantity: 2, unitPrice: 300, product: { id: 'A', name: 'Product A' } },
      { itemType: 'STANDARD_CASE', quantity: 4, unitPrice: 100, product: { id: 'B', name: 'Product B' } },
    ],
  })], [], everything))

  assert.equal(rows.get('A')?.totalRevenue, 540)
  assert.equal(rows.get('B')?.totalRevenue, 360)
})

test('a delivered order falls in the window it was delivered in', () => {
  const inOctober = (value: unknown) => String(value || '').startsWith('2026-10')
  const rows = buildProductMovements([
    onlineOrder({ createdAt: '2026-09-29T09:00:00+08:00', deliveredAt: '2026-10-01T15:00:00+08:00', items: [caseLine('A', 2)] }),
    onlineOrder({ createdAt: '2026-10-01T09:00:00+08:00', deliveredAt: '2026-09-30T15:00:00+08:00', items: [caseLine('B', 9)] }),
  ], [], inOctober)

  assert.deepEqual(rows.map((row) => [row.productId, row.totalComparableUnits]), [['A', 2]])
})

test('velocity days follow the selected window', () => {
  const now = new Date(2026, 9, 2, 14, 0)
  const records = ['2026-09-03T08:00:00+08:00', '2026-09-25T08:00:00+08:00', '', 'not a date']

  assert.equal(resolveVelocityDays('today', '', '', records, now), 1)
  assert.equal(resolveVelocityDays('7', '', '', records, now), 7)
  assert.equal(resolveVelocityDays('365', '', '', records, now), 365)
  // Sept 3 to Oct 2, both included.
  assert.equal(resolveVelocityDays('all', '', '', records, now), 30)
  assert.equal(resolveVelocityDays('custom', '2026-09-01', '2026-09-10', records, now), 10)
  // An open end runs to today, an open start from the first record; neither falls back to 30.
  assert.equal(resolveVelocityDays('custom', '2026-09-28', '', records, now), 5)
  assert.equal(resolveVelocityDays('custom', '', '2026-09-12', records, now), 10)
  assert.equal(resolveVelocityDays('custom', '', '', records, now), 30)
  // Future days have no sales yet.
  assert.equal(resolveVelocityDays('custom', '2026-09-28', '2026-12-31', records, now), 5)
  assert.equal(resolveVelocityDays('all', '', '', [], now), 1)
})

test('small velocities stay distinguishable', () => {
  assert.equal(formatDailyVelocity(0), '0')
  assert.equal(formatDailyVelocity(0.004), '<0.01')
  assert.equal(formatDailyVelocity(5 / 365), '0.01')
  assert.equal(formatDailyVelocity(18 / 365), '0.05')
  assert.equal(formatDailyVelocity(1234.56), '1,234.6')
  // One fixed decimal: 2.96 reads 3.0 next to 3.4, not a bare 3.
  assert.equal(formatDailyVelocity(434.5 / 147), '3.0')
  assert.equal(formatDailyVelocity(0.5), '0.50')
})
