import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildOrderReportRows,
  buildOrderReportStatusBreakdown,
  buildOrderReportStatusOptions,
  buildOrderReportVolumeChart,
  buildInventoryMovementChart,
  buildInventoryMovementRows,
  buildInventoryStatusBreakdown,
  buildWarehouseCapacitySummary,
  buildWeeklyOrderTrendData,
  countActiveTrips,
  formatOrderReportStatus,
  getInventoryAvailableQty,
  getInventoryThreshold,
  normalizeOrderReportStatus,
  summarizeOrderReportRows,
  summarizeInventoryMovementRows,
  summarizeInventoryMovementTrend,
  summarizeStockHealth,
  summarizeWarehouseDashboardOrders,
} from './report-metrics.ts'

test('inventory availability and stock health use reserved quantities', () => {
  const items = [
    { quantity: 50, reservedQuantity: 45, minStock: 15 },
    { quantity: 0, reservedQuantity: 0, minStock: 10 },
    { quantity: 61, reservedQuantity: 0, minStock: 20, updatedAt: '2026-05-01T00:00:00Z' },
    { quantity: 18, reservedQuantity: 0, minStock: 15 },
  ]

  assert.equal(getInventoryAvailableQty(items[0]), 5)
  assert.equal(getInventoryThreshold(items[0]), 15)

  const summary = summarizeStockHealth(items, Date.parse('2026-05-23T12:00:00Z'))
  assert.deepEqual(summary, {
    healthy: 0,
    low: 1,
    critical: 1,
    outOfStock: 1,
    overstocked: 1,
    total: 4,
    belowThreshold: 2,
  })

  assert.deepEqual(buildInventoryStatusBreakdown(items, Date.parse('2026-05-23T12:00:00Z')), {
    healthy: 0,
    lowStock: 1,
    critical: 1,
    outOfStock: 1,
  })
})

test('warehouse capacity summary keeps one decimal precision and fallback capacity', () => {
  const tinyUsage = buildWarehouseCapacitySummary(
    { capacity: 10000 },
    [{ quantity: 48 }],
  )
  assert.equal(tinyUsage.usedUnits, 48)
  assert.equal(tinyUsage.totalCapacity, 10000)
  assert.equal(tinyUsage.availableCapacity, 9952)
  assert.equal(tinyUsage.usagePercent, 0.5)

  const fallbackUsage = buildWarehouseCapacitySummary(
    { capacity: 0 },
    [{ quantity: 48 }],
  )
  assert.equal(fallbackUsage.totalCapacity, 1000)
  assert.equal(fallbackUsage.usagePercent, 4.8)
})

test('inventory movement selectors keep only in and out and chart totals match row totals', () => {
  const rangeStart = new Date('2026-05-01T00:00:00Z')
  const rows = buildInventoryMovementRows([
    { createdAt: '2026-05-22T10:00:00Z', type: 'IN', quantity: 8, warehouse: { id: 'w1', name: 'Main' }, product: { name: 'Pepzi-reg', sizes: ['250ml (8 oz)'] } },
    { createdAt: '2026-05-21T10:00:00Z', type: 'OUT', quantity: 5, warehouse: { id: 'w1', name: 'Main' }, product: { name: 'Pepzi-reg', size: '250ml (8 oz)' } },
    { createdAt: '2026-05-21T11:00:00Z', type: 'RESERVE', quantity: 99, warehouse: { id: 'w1', name: 'Main' }, product: { name: 'Pepzi-reg' } },
    { createdAt: '2026-04-20T11:00:00Z', type: 'IN', quantity: 12, warehouse: { id: 'w1', name: 'Main' }, product: { name: 'Pepzi-reg' } },
  ], {
    rangeStart,
    selectedWarehouse: 'w1',
    getWarehouseIdFromRow: (row) => String(row?.warehouse?.id || ''),
  })

  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => row.type), ['IN', 'OUT'])
  assert.deepEqual(rows.map((row) => row.product), ['Pepzi-reg (250ml (8 oz))', 'Pepzi-reg (250ml (8 oz))'])

  const summary = summarizeInventoryMovementRows(rows)
  assert.deepEqual(summary, {
    totalMovements: 2,
    stockIn: 8,
    stockOut: 5,
  })

  const chart = buildInventoryMovementChart(rows, {
    rangeDays: '7',
    rangeStart: new Date('2026-05-16T00:00:00Z'),
    now: new Date('2026-05-23T00:00:00Z'),
  })
  const trend = summarizeInventoryMovementTrend(chart)
  assert.equal(trend.totalIn, 8)
  assert.equal(trend.totalOut, 5)
})

test('warehouse dashboard order stats and weekly trends exclude replacements and cancelled orders', () => {
  const now = new Date('2026-05-23T12:00:00Z')
  const orders = [
    { orderNumber: 'ORD-1', status: 'DELIVERED', createdAt: '2026-05-23T09:00:00Z' },
    { orderNumber: 'ORD-2', status: 'IN_TRANSIT', createdAt: '2026-05-22T09:00:00Z' },
    { orderNumber: 'ORD-3', status: 'DELIVERED', createdAt: '2026-05-16T09:00:00Z' },
    { orderNumber: 'RPL-1', status: 'DELIVERED', createdAt: '2026-05-23T09:00:00Z' },
    { orderNumber: 'ORD-4', status: 'CANCELLED', createdAt: '2026-05-23T09:00:00Z' },
    { orderNumber: 'ORD-5', status: 'DELIVERED', createdAt: '2026-05-21T09:00:00Z', isScheduledReplacement: true },
  ]

  assert.deepEqual(summarizeWarehouseDashboardOrders(orders), {
    totalOrders: 3,
    outForDelivery: 1,
    delivered: 2,
  })

  const trend = buildWeeklyOrderTrendData(orders, now)
  assert.equal(trend.reduce((sum, point) => sum + point.thisWeek, 0), 2)
  assert.equal(trend.reduce((sum, point) => sum + point.lastWeek, 0), 1)
})

test('active trip counting uses normalized trip statuses', () => {
  const trips = [
    { status: 'PLANNED' },
    { status: 'IN_TRANSIT' },
    { status: 'OUT_FOR_DELIVERY' },
    { status: 'COMPLETED' },
    { status: 'CANCELLED' },
  ]

  assert.equal(countActiveTrips(trips), 3)
})

test('order report selectors normalize statuses and build report totals from primary orders only', () => {
  assert.equal(normalizeOrderReportStatus('delivered'), 'DELIVERED')
  assert.equal(normalizeOrderReportStatus('FAILED_DELIVERY'), 'CANCELLED')
  assert.equal(normalizeOrderReportStatus('IN_TRANSIT'), 'PENDING')
  assert.equal(formatOrderReportStatus('PENDING'), 'Pending')

  const rows = buildOrderReportRows([
    {
      orderNumber: 'ORD-1',
      status: 'DELIVERED',
      totalAmount: 100,
      createdAt: '2026-05-22T10:00:00Z',
      customer: { name: 'Alice' },
      items: [
        { quantity: 2, product: { name: 'Pepzi-reg', sizes: ['250ml (8 oz)'] } },
        { quantity: 1, product: { name: 'Cola' }, sizeLabel: '1L (34 oz)' },
      ],
      warehouse: { id: 'w1' },
    },
    {
      orderNumber: 'ORD-2',
      status: 'IN_TRANSIT',
      totalAmount: 55,
      createdAt: '2026-05-21T10:00:00Z',
      customer: { name: 'Bob' },
      items: [
        { quantity: 4, productName: 'Orange Soda' },
      ],
      warehouse: { id: 'w1' },
    },
    {
      orderNumber: 'ORD-3',
      status: 'FAILED_DELIVERY',
      totalAmount: 30,
      createdAt: '2026-05-20T10:00:00Z',
      shippingName: 'Cara',
      items: [],
      warehouse: { id: 'w1' },
    },
    {
      orderNumber: 'RPL-4',
      status: 'DELIVERED',
      totalAmount: 25,
      createdAt: '2026-05-22T10:00:00Z',
      customer: { name: 'Replacement' },
      items: [{ quantity: 1, product: { name: 'Ignore Me' } }],
      warehouse: { id: 'w1' },
    },
  ], {
    rangeStart: new Date('2026-05-19T00:00:00Z'),
    selectedWarehouse: 'w1',
    selectedOrderStatus: 'all',
    getWarehouseIdFromRow: (row) => String(row?.warehouse?.id || ''),
  })

  assert.equal(rows.length, 3)
  assert.deepEqual(buildOrderReportStatusOptions(rows), ['CANCELLED', 'DELIVERED', 'PENDING'])

  const summary = summarizeOrderReportRows(rows)
  assert.deepEqual(summary, {
    totalOrders: 3,
    deliveredOrders: 1,
    pendingOrders: 1,
    cancelledOrders: 1,
    totalRevenue: 100,
    totalQuantity: 7,
  })

  const breakdown = buildOrderReportStatusBreakdown(rows)
  assert.deepEqual(breakdown.map((entry) => entry.value), [1, 1, 1])

  const volume = buildOrderReportVolumeChart(rows, {
    rangeDays: '7',
    rangeStart: new Date('2026-05-19T00:00:00Z'),
    now: new Date('2026-05-23T00:00:00Z'),
  })
  assert.equal(volume.reduce((sum, point) => sum + point.orders, 0), 3)
  assert.equal(rows[0].itemSummary, 'Pepzi-reg (250ml (8 oz)), Cola (1L (34 oz))')
  assert.equal(rows[2].itemSummary, 'No items recorded')
})
