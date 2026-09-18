import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFeedbackAttentionQueue,
  buildFeedbackComparisonWindow,
  buildFeedbackDimensionBreakdown,
  buildFeedbackRows,
  buildFeedbackSatisfactionTrend,
  buildFeedbackTopIssues,
  classifyFeedbackReason,
  compareFeedbackKpis,
  describeFeedbackDelta,
  filterFeedbackRowsByWindow,
  getFeedbackPolarity,
  parseFeedbackReasons,
  summarizeFeedbackKpis,
  summarizeFeedbackParticipation,
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
  getInventoryLooseRemainder,
  getInventoryThreshold,
  normalizeOrderReportStatus,
  summarizeOrderReportRows,
  summarizeInventoryMovementRows,
  summarizeInventoryMovementTrend,
  summarizeStockHealth,
  summarizeWarehouseDashboardOrders,
} from './report-metrics.ts'
import {
  FEEDBACK_OVERALL_REASONS,
  FEEDBACK_REASON_CATALOGS,
  OTHER_FEEDBACK_REASON,
  buildFeedbackReasonMessage,
  getFeedbackOptionsForRating,
  inferFeedbackDimensions,
} from '../../shared/customer-logic/src/feedback-reasons.ts'

test('inventory shows complete loose sets as cases and preserves remaining bottles', () => {
  const item = { quantity: 33, reservedQuantity: 24, looseBottles: 12, product: { quantityPerCase: 12 } }
  assert.equal(getInventoryAvailableQty(item), 10)
  assert.equal(getInventoryLooseRemainder(item), 0)
  assert.equal(getInventoryAvailableQty({ ...item, looseBottles: 26 }), 11)
  assert.equal(getInventoryLooseRemainder({ ...item, looseBottles: 26 }), 2)
  assert.equal(getInventoryLooseRemainder({ ...item, product: { quantityPerCase: 24 } }), 12)
  assert.equal(item.quantity, 33)
  assert.equal(item.looseBottles, 12)
})

test('inventory availability and stock health use reserved quantities', () => {
  const items = [
    { quantity: 50, reservedQuantity: 45, minStock: 15 },
    { quantity: 0, reservedQuantity: 0, minStock: 10 },
    { quantity: 61, reservedQuantity: 0, minStock: 20, updatedAt: '2026-05-01T00:00:00Z' },
    { quantity: 18, reservedQuantity: 0, minStock: 15 },
  ]

  assert.equal(getInventoryAvailableQty(items[0]), 5)
  assert.equal(getInventoryAvailableQty({
    quantity: 2,
    reservedQuantity: 0,
    reservedBaseUnits: 12,
    looseBottles: 0,
    product: { quantityPerCase: 24 },
  }), 1)
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
    { createdAt: '2026-05-21T12:00:00Z', type: 'RETURN', quantity: 3, baseUnitQuantity: 3, warehouse: { id: 'w1', name: 'Main' }, product: { name: 'Pepzi-reg', size: '250ml (8 oz)' } },
    { createdAt: '2026-04-20T11:00:00Z', type: 'IN', quantity: 12, warehouse: { id: 'w1', name: 'Main' }, product: { name: 'Pepzi-reg' } },
  ], {
    rangeStart,
    selectedWarehouse: 'w1',
    getWarehouseIdFromRow: (row) => String(row?.warehouse?.id || ''),
  })

  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map((row) => row.type), ['IN', 'OUT', 'IN'])
  assert.deepEqual(rows.map((row) => row.sourceType), ['IN', 'OUT', 'RETURN'])
  assert.deepEqual(rows.map((row) => row.product), ['Pepzi-reg (250ml (8 oz))', 'Pepzi-reg (250ml (8 oz))', 'Pepzi-reg (250ml (8 oz))'])

  const summary = summarizeInventoryMovementRows(rows)
  assert.deepEqual(summary, {
    totalMovements: 3,
    stockIn: 11,
    stockOut: 5,
  })

  const chart = buildInventoryMovementChart(rows, {
    rangeDays: '7',
    rangeStart: new Date('2026-05-16T00:00:00Z'),
    now: new Date('2026-05-23T00:00:00Z'),
  })
  const trend = summarizeInventoryMovementTrend(chart)
  assert.equal(trend.totalIn, 11)
  assert.equal(trend.totalOut, 5)
})

test('warehouse dashboard total retains cancelled orders while activity metrics exclude them', () => {
  const now = new Date('2026-05-23T12:00:00Z')
  const orders = [
    { orderNumber: 'ORD-1', purchaseOrderNumber: 'PO-1', purchaseOrderStage: 'DELIVERED', status: 'DELIVERED', createdAt: '2026-05-23T09:00:00Z' },
    { orderNumber: 'ORD-2', purchaseOrderNumber: 'PO-2', purchaseOrderStage: 'OUT_FOR_DELIVERY', status: 'IN_TRANSIT', createdAt: '2026-05-22T09:00:00Z' },
    { orderNumber: 'ORD-3', purchaseOrderNumber: 'PO-3', purchaseOrderStage: 'DELIVERED', status: 'DELIVERED', createdAt: '2026-05-16T09:00:00Z' },
    { orderNumber: 'RPL-1', purchaseOrderNumber: 'PO-RPL', purchaseOrderStage: 'DELIVERED', status: 'DELIVERED', createdAt: '2026-05-23T09:00:00Z' },
    { orderNumber: 'ORD-4', purchaseOrderNumber: 'PO-4', purchaseOrderStage: 'CANCELLED', status: 'CANCELLED', createdAt: '2026-05-23T09:00:00Z' },
    { orderNumber: 'ORD-5', purchaseOrderNumber: 'PO-5', purchaseOrderStage: 'DELIVERED', status: 'DELIVERED', createdAt: '2026-05-21T09:00:00Z', isScheduledReplacement: true },
    { orderNumber: 'ORD-6', requestStatus: 'PENDING', status: 'PENDING', createdAt: '2026-05-01T09:00:00Z' },
  ]

  assert.deepEqual(summarizeWarehouseDashboardOrders(orders), {
    totalOrders: 4,
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
    { status: 'IN_PROGRESS' },
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

const feedbackRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'fb-1',
  createdAt: '2026-09-10T08:00:00Z',
  rating: 5,
  type: 'COMPLIMENT',
  subject: 'Order Review - ORD-1',
  message: '- Delivery was on time',
  customer: { name: 'Case Runner' },
  order: { id: 'ord-1', orderNumber: 'ORD-1' },
  orderId: 'ord-1',
  ...overrides,
})

test('feedback messages parse into reasons and map onto service dimensions', () => {
  assert.deepEqual(
    parseFeedbackReasons('- Delivery was delayed\n- Order was incomplete or had quantity errors'),
    ['Delivery was delayed', 'Order was incomplete or had quantity errors']
  )
  // Position carries no meaning across catalogs, so each phrase is checked directly.
  assert.equal(classifyFeedbackReason('Delivery was severely delayed', 1).dimension, 'timeliness')
  assert.equal(classifyFeedbackReason('Replacement items arrived damaged', 1).dimension, 'condition')
  assert.equal(classifyFeedbackReason('Hard to contact driver', 2).dimension, 'communication')
  assert.equal(classifyFeedbackReason('Poor driver attitude', 1).dimension, 'driver')
  assert.equal(classifyFeedbackReason('Missing items', 1).dimension, 'accuracy')
  // Legacy free text never came from a catalog and still has to land somewhere.
  const legacy = classifyFeedbackReason('The bottles were leaking everywhere', 1)
  assert.equal(legacy.matched, false)
  assert.equal(legacy.dimension, 'condition')
})

test('every rating option in the shared catalogs maps to a known service dimension', () => {
  const allowedOverall = new Set(FEEDBACK_OVERALL_REASONS.map((reason) => reason.toLowerCase()))
  const seen = new Map<string, { dimension: string; rating: number }>()

  for (const catalogKey of Object.keys(FEEDBACK_REASON_CATALOGS)) {
    const catalog = FEEDBACK_REASON_CATALOGS[catalogKey as keyof typeof FEEDBACK_REASON_CATALOGS]
    for (const ratingKey of Object.keys(catalog)) {
      const rating = Number(ratingKey)
      for (const phrase of catalog[rating]) {
        // The Other placeholder is never submitted as-is; the typed words replace it.
        if (phrase === OTHER_FEEDBACK_REASON) continue
        const hit = classifyFeedbackReason(phrase, rating)
        assert.equal(hit.matched, true, `${catalogKey} ${rating}star "${phrase}" has no dimension mapping`)
        if (!allowedOverall.has(phrase.toLowerCase())) {
          assert.notEqual(hit.dimension, 'overall', `${catalogKey} "${phrase}" fell through to overall`)
        }
        // A phrase shared by two catalogs must agree on both dimension and star.
        const key = phrase.toLowerCase()
        const previous = seen.get(key)
        if (previous) {
          assert.equal(previous.dimension, hit.dimension, `"${phrase}" maps to two dimensions`)
          assert.equal(previous.rating, rating, `"${phrase}" sits under two different stars`)
        } else {
          seen.set(key, { dimension: hit.dimension, rating })
        }
      }
    }
  }
})

test('feedback polarity follows the parent star rating rather than the phrase wording', () => {
  // "Issue was resolved" reads positive but is a 3-star phrase; the rating decides.
  assert.equal(classifyFeedbackReason('Issue was resolved', 1).polarity, 'negative')
  assert.equal(classifyFeedbackReason('Issue was resolved', 5).polarity, 'positive')
  assert.equal(getFeedbackPolarity(3), 'neutral')
  assert.equal(getFeedbackPolarity(null), 'unrated')
  // With no rating supplied, the star the phrase sits under is the fallback.
  assert.equal(classifyFeedbackReason('Delivery was severely delayed').polarity, 'negative')
  // Unmatched legacy text still takes a polarity from its row rating.
  assert.equal(classifyFeedbackReason('Something nobody ever offered', 2).polarity, 'negative')
})

test('feedback KPI totals and period deltas come from one row set', () => {
  const rows = buildFeedbackRows([
    feedbackRow({ id: 'a', rating: 5 }),
    feedbackRow({ id: 'b', rating: 3, message: '- Communication could improve' }),
    feedbackRow({ id: 'c', rating: 1, message: '- Delivery was severely delayed' }),
    feedbackRow({ id: 'd', rating: null, message: '- Delivery was on time' }),
  ])

  const summary = summarizeFeedbackKpis(rows)
  assert.equal(summary.total, 4)
  assert.equal(summary.ratedCount, 3)
  // The stated total and the percentages must describe the same population.
  assert.equal(summary.positiveCount + summary.neutralCount + summary.negativeCount, summary.ratedCount)
  assert.equal(summary.avgRating, 3)
  assert.equal(summary.describedCount, 0)

  const comparison = compareFeedbackKpis(rows, [rows[0]])
  assert.equal(comparison.hasPreviousPeriod, true)
  assert.equal(comparison.totalDelta, 3)
  assert.equal(comparison.avgRatingDelta, -2)

  // An unbounded window has nothing to compare against, so the UI must not fake a zero.
  assert.equal(compareFeedbackKpis(rows, null).hasPreviousPeriod, false)
  assert.equal(describeFeedbackDelta(-4, { unit: 'percent', higherIsBetter: false }).tone, 'good')
  assert.equal(describeFeedbackDelta(-4, { unit: 'percent', higherIsBetter: false }).text, '-4 pts')
  assert.equal(describeFeedbackDelta(0, { unit: 'rating' }).direction, 'flat')
  assert.equal(describeFeedbackDelta(0.3, { unit: 'rating' }).text, '+0.3')
})

test('satisfaction trend returns trailing months and never a future month', () => {
  const now = new Date(2026, 8, 17)
  const rows = buildFeedbackRows([
    feedbackRow({ id: 'a', rating: 4, createdAt: '2026-09-02T00:00:00' }),
    feedbackRow({ id: 'b', rating: 2, createdAt: '2026-09-09T00:00:00' }),
    feedbackRow({ id: 'c', rating: 5, createdAt: '2026-07-04T00:00:00' }),
  ])

  const points = buildFeedbackSatisfactionTrend(rows, { months: 6, now })
  assert.deepEqual(
    points.map((point) => point.key),
    ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']
  )
  assert.equal(points[points.length - 1].key, '2026-09')
  assert.equal(points.every((point) => point.sortDate.getTime() <= now.getTime()), true)
  // An empty month reports no score AND no responses, so a gap cannot read as a dip.
  assert.equal(points[0].avgScore, null)
  assert.equal(points[0].responses, 0)
  assert.equal(points[5].avgScore, 3)
  assert.equal(points[5].responses, 2)
})

test('dimension breakdown returns every bucket and counts each review once per dimension', () => {
  const rows = buildFeedbackRows([
    feedbackRow({
      id: 'a',
      rating: 1,
      // Two condition phrases in one review.
      message: '- Damaged cases or leaking bottles\n- Replacement items arrived damaged',
    }),
    feedbackRow({ id: 'b', rating: 5, message: '- Driver was highly professional' }),
  ])

  const breakdown = buildFeedbackDimensionBreakdown(rows)
  assert.equal(breakdown.length, 6)
  assert.deepEqual(
    breakdown.map((entry) => entry.dimension),
    ['timeliness', 'accuracy', 'condition', 'driver', 'communication', 'overall']
  )

  const condition = breakdown.find((entry) => entry.dimension === 'condition')!
  assert.equal(condition.mentions, 1)
  assert.equal(condition.reasonCount, 2)
  assert.equal(condition.negative, 1)

  // Nobody mentioned timeliness, which must read as "no signal" and not as a clean bar.
  const timeliness = breakdown.find((entry) => entry.dimension === 'timeliness')!
  assert.equal(timeliness.hasSignal, false)
  assert.equal(timeliness.mentions, 0)
  assert.equal(timeliness.positive, 0)
})

test('top issues rank negative reasons with deterministic tie-breaks', () => {
  const rows = buildFeedbackRows([
    feedbackRow({ id: 'a', rating: 1, message: '- Delivery was severely delayed' }),
    feedbackRow({ id: 'b', rating: 1, message: '- Delivery was severely delayed' }),
    feedbackRow({ id: 'c', rating: 2, message: '- Driver service needs improvement' }),
    feedbackRow({ id: 'd', rating: 5, message: '- Delivery was on time as scheduled' }),
  ])

  const issues = buildFeedbackTopIssues(rows, { limit: 5 })
  assert.equal(issues.length, 2)
  assert.equal(issues[0].reason, 'Delivery was severely delayed')
  assert.equal(issues[0].rank, 1)
  assert.equal(issues[0].count, 2)
  assert.equal(issues[0].dimension, 'timeliness')
  // Positive phrases are not complaints and must never enter the leaderboard.
  assert.equal(issues.some((issue) => issue.reason === 'Delivery was on time as scheduled'), false)
  assert.equal(issues.reduce((sum, issue) => sum + issue.share, 0), 100)
  assert.equal(buildFeedbackTopIssues(rows, { limit: 1 }).length, 1)
})

test('needs-attention queue pins the most recent one and two star feedback', () => {
  const now = new Date(2026, 8, 17)
  const rows = buildFeedbackRows([
    feedbackRow({ id: 'old', rating: 1, createdAt: '2026-09-10T00:00:00', message: '- Delivery was severely delayed' }),
    feedbackRow({ id: 'new', rating: 2, createdAt: '2026-09-16T00:00:00', message: '- Other: Please call me about this' }),
    feedbackRow({ id: 'fine', rating: 3, createdAt: '2026-09-17T00:00:00', message: '- Communication could improve' }),
  ])

  const queue = buildFeedbackAttentionQueue(rows, { now })
  assert.deepEqual(queue.map((entry) => entry.id), ['new', 'old'])
  assert.equal(queue[0].ageLabel, 'Yesterday')
  assert.equal(queue[0].describedText, 'Please call me about this')
  // Described text is not repeated as a chip; it renders as a quote instead.
  assert.deepEqual(queue[0].reasons, [])
  assert.equal(queue[1].ageLabel, '1w ago')
  assert.equal(buildFeedbackAttentionQueue(rows, { now, limit: 1 }).length, 1)
})

test('feedback comparison window matches the current window length', () => {
  const window = { start: new Date(2026, 7, 18), end: new Date(2026, 8, 17) }
  const previous = buildFeedbackComparisonWindow(window)
  assert.notEqual(previous, null)
  const previousStart = previous?.start as Date
  const previousEnd = previous?.end as Date
  const currentSpan = window.end.getTime() - window.start.getTime()
  assert.equal(previousEnd.getTime() - previousStart.getTime(), currentSpan)
  // The previous period ends the instant before the current one starts.
  assert.equal(previousEnd.getTime(), window.start.getTime() - 1)

  // An "All Time" window has no preceding period at all.
  assert.equal(buildFeedbackComparisonWindow({ start: null, end: null }), null)

  const rows = buildFeedbackRows([
    feedbackRow({ id: 'in', createdAt: '2026-09-01T00:00:00' }),
    feedbackRow({ id: 'out', createdAt: '2026-06-01T00:00:00' }),
  ])
  assert.deepEqual(filterFeedbackRowsByWindow(rows, window).map((row) => row.id), ['in'])
  assert.equal(filterFeedbackRowsByWindow(rows, null).length, 2)
})

test('feedback participation keeps a delivered-order denominator inside the window', () => {
  const orders = [
    { id: 'ord-1', status: 'DELIVERED', deliveredAt: '2026-09-10T00:00:00' },
    { id: 'ord-2', status: 'DELIVERED', deliveredAt: '2026-09-12T00:00:00' },
    { id: 'ord-old', status: 'DELIVERED', deliveredAt: '2026-01-05T00:00:00' },
    { id: 'ord-3', status: 'PENDING', createdAt: '2026-09-11T00:00:00' },
  ]
  const rows = buildFeedbackRows([
    feedbackRow({ id: 'a', orderId: 'ord-1', order: { id: 'ord-1', orderNumber: 'ORD-1' }, createdAt: '2026-09-11T00:00:00' }),
  ])
  const window = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 17) }

  const participation = summarizeFeedbackParticipation(rows, orders, { window })
  // The January delivery and the pending order are both outside the denominator.
  assert.equal(participation.deliveredOrders, 2)
  assert.equal(participation.reviewedOrders, 1)
  assert.equal(participation.participationRate, 50)
})

test('the Other option is offered last and excludes the preset phrases', () => {
  const options = getFeedbackOptionsForRating(FEEDBACK_REASON_CATALOGS['web-delivery'], 1)
  assert.equal(options[options.length - 1], OTHER_FEEDBACK_REASON)
  assert.equal(options.length, FEEDBACK_REASON_CATALOGS['web-delivery'][1].length + 1)

  // Picking Other discards anything else, so a review is either preset or described.
  assert.equal(
    buildFeedbackReasonMessage([OTHER_FEEDBACK_REASON], 'The driver shouted at my staff'),
    '- Other: The driver shouted at my staff'
  )
  // Other with nothing typed is not submittable feedback.
  assert.equal(buildFeedbackReasonMessage([OTHER_FEEDBACK_REASON], '   '), '')
  assert.equal(
    buildFeedbackReasonMessage(['Delivery was delayed', 'Delivery updates were unclear'], ''),
    '- Delivery was delayed\n- Delivery updates were unclear'
  )
})

test('free text typed into Other is classified onto a service dimension', () => {
  const rows = buildFeedbackRows([
    {
      id: 'a',
      rating: 1,
      createdAt: '2026-09-10T08:00:00Z',
      message: '- Other: The driver shouted at my staff',
      customer: { name: 'Case Runner' },
      order: { id: 'ord-1', orderNumber: 'ORD-1' },
    },
  ])

  const hit = rows[0].reasons[0]
  // The "Other:" marker must not be what gets classified.
  assert.equal(hit.dimension, 'driver')
  assert.equal(hit.matched, false)
  assert.equal(hit.polarity, 'negative')
  assert.deepEqual(rows[0].dimensions, ['driver'])
  assert.equal(rows[0].reasons.every((hit) => !hit.matched), true)

  // It counts in the breakdown, which is the point of classifying it at all.
  const driver = buildFeedbackDimensionBreakdown(rows).find((d) => d.dimension === 'driver')
  assert.equal(driver?.mentions, 1)
  assert.equal(driver?.negative, 1)

  // But it stays out of the frequency leaderboard: every free-text entry is unique,
  // so ranking them by count is meaningless and would crowd out real repeat offenders.
  assert.equal(buildFeedbackTopIssues(rows).length, 0)
})

test('described feedback is classified in English, Tagalog and Hiligaynon', () => {
  const cases: Array<[string, string]> = [
    // English
    ['The driver shouted at my staff', 'driver'],
    ['3 cases were missing from my order', 'accuracy'],
    ['the bottles arrived cracked and leaking', 'condition'],
    ['nobody answered my calls, no update at all', 'communication'],
    // Tagalog / Filipino
    ['Sobrang tagal ng delivery, hinintay ko ng 3 hours', 'timeliness'],
    ['Kulang ang order ko, may nawawalang 2 cases', 'accuracy'],
    ['Sira yung mga bote, tumagas lahat', 'condition'],
    ['Ang bastos ng tsuper, sinigawan ako', 'driver'],
    ['Hindi sumagot sa text, walang abiso', 'communication'],
    // Hiligaynon / Ilonggo
    ['Dugay gid ang delivery, naulihi sila', 'timeliness'],
    ['Nagtulo ang softdrinks kay naguba ang case', 'condition'],
    ['Wala nagsabat sa tawag ko', 'communication'],
    ['maayo ang serbisyo, buotan ang drayber', 'driver'],
  ]
  for (const [text, expected] of cases) {
    assert.equal(classifyFeedbackReason(text, 1).dimension, expected, `"${text}" should be ${expected}`)
  }
})

test('described feedback covering two areas counts in both', () => {
  // One sentence, two subjects - the breakdown must not have to pick a favourite.
  assert.deepEqual(inferFeedbackDimensions('the driver was late and very rude'), ['driver', 'timeliness'])
  assert.deepEqual(inferFeedbackDimensions('basag ang 3 bottles at kulang pa'), ['accuracy', 'condition'])

  const rows = buildFeedbackRows([
    {
      id: 'a',
      rating: 1,
      createdAt: '2026-09-10T08:00:00Z',
      message: '- Other: the driver was late and very rude',
      customer: { name: 'Case Runner' },
      order: { id: 'ord-1', orderNumber: 'ORD-1' },
    },
  ])
  assert.deepEqual(rows[0].dimensions, ['timeliness', 'driver'])

  const breakdown = buildFeedbackDimensionBreakdown(rows)
  assert.equal(breakdown.find((d) => d.dimension === 'driver')?.mentions, 1)
  assert.equal(breakdown.find((d) => d.dimension === 'timeliness')?.mentions, 1)
})

test('unrelated text does not get forced onto a dimension', () => {
  // A bare /late/ would match "chocolate"; word boundaries keep these in Overall.
  assert.equal(classifyFeedbackReason('I love chocolate', 5).dimension, 'overall')
  assert.equal(classifyFeedbackReason('everything was perfect, salamat', 5).dimension, 'overall')
  assert.deepEqual(inferFeedbackDimensions('no comment'), ['overall'])
})
