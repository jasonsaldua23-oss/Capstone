import test from 'node:test'
import assert from 'node:assert/strict'

import {
  describeCapacity,
  describeComparison,
  describeComposition,
  describeRanking,
  describeSeriesMix,
  describeTrend,
  toPoints,
} from './chart-interpretation.ts'

const points = (values: Array<[string, number]>) => values.map(([label, value]) => ({ label, value }))
const percent = (value: number) => `${value.toFixed(1)}%`

test('toPoints coerces missing labels and non-numeric values', () => {
  const result = toPoints(
    [{ day: 'Mon', count: '4' }, { day: null, count: undefined }],
    (row) => row.day,
    (row) => row.count
  )
  assert.deepEqual(result, [
    { label: 'Mon', value: 4 },
    { label: 'Unlabeled', value: 0 },
  ])
})

test('toPoints carries an optional weight', () => {
  const result = toPoints([{ m: 'Jan', avg: 4, n: 3 }], (row) => row.m, (row) => row.avg, (row) => row.n)
  assert.deepEqual(result, [{ label: 'Jan', value: 4, weight: 3 }])
})

// ── Trends ────────────────────────────────────────────────────────────────

test('describeTrend reads the total, the daily average and the busiest and quietest days', () => {
  const text = describeTrend(points([['Mon', 2], ['Tue', 8], ['Wed', 5]]), { noun: 'orders' })
  assert.equal(
    text,
    'There were 15 orders over the 3 days shown, or 5 a day on average. ' +
      'The busiest day was Tue with 8 orders, and the quietest was Mon with 2 orders.'
  )
})

test('describeTrend rounds a messy average instead of printing decimals', () => {
  const text = describeTrend(points([['a', 10], ['b', 9], ['c', 7]]), { noun: 'orders' })
  assert.match(text, /There were 26 orders over the 3 days shown, or about 9 a day on average\./)
})

test('describeTrend says when the later days more than doubled', () => {
  const text = describeTrend(points([['a', 2], ['b', 2], ['c', 6], ['d', 6]]), { noun: 'orders' })
  assert.match(text, /Orders more than doubled: the last 2 days averaged 6 a day, up from 2 in the first 2\./)
  assert.match(text, /The busiest days were c and d, with 6 orders each, and the quietest were a and b, with 2 orders each\./)
})

test('describeTrend says when the later days are going up', () => {
  const text = describeTrend(points([['a', 10], ['b', 10], ['c', 13], ['d', 13]]), { noun: 'orders' })
  assert.match(text, /Orders are going up: the last 2 days averaged 13 a day, up from 10 in the first 2\./)
})

test('describeTrend says when the later days are going down', () => {
  const text = describeTrend(points([['a', 10], ['b', 10], ['c', 6], ['d', 6]]), { noun: 'orders' })
  assert.match(text, /Orders are going down: the last 2 days averaged 6 a day, down from 10 in the first 2\./)
})

test('describeTrend says when the later days dropped by half or more', () => {
  const text = describeTrend(points([['a', 10], ['b', 10], ['c', 4], ['d', 4]]), { noun: 'orders' })
  assert.match(text, /Orders dropped by half or more: the last 2 days averaged 4 a day, down from 10 in the first 2\./)
})

test('describeTrend calls a small wobble steady', () => {
  const text = describeTrend(points([['a', 10], ['b', 11], ['c', 10], ['d', 11]]), { noun: 'orders' })
  assert.match(text, /Orders are holding steady at about 11 a day\./)
})

test('describeTrend says a flat series is the same every day and skips the direction', () => {
  const text = describeTrend(points([['a', 10], ['b', 10], ['c', 10], ['d', 10]]), { noun: 'orders' })
  assert.match(text, /It was the same every day: 10 orders a day\./)
  assert.doesNotMatch(text, /going|steady|doubled/)
})

test('describeTrend names days with nothing instead of calling them the quietest', () => {
  const text = describeTrend(points([['Mon', 1], ['Tue', 0]]), { noun: 'orders' })
  assert.equal(
    text,
    'There was 1 order over the 2 days shown, or 0.5 a day on average. ' +
      'The busiest day was Mon with 1 order, and nothing was recorded on Tue.'
  )
})

test('describeTrend counts empty days once there are too many to name', () => {
  const values: Array<[string, number]> = [
    ['1', 3], ['2', 0], ['3', 2], ['4', 0], ['5', 4], ['6', 0], ['7', 1],
    ['8', 0], ['9', 2], ['10', 0], ['11', 3], ['12', 2], ['13', 1], ['14', 2],
  ]
  const text = describeTrend(points(values), { noun: 'orders' })
  assert.match(text, /nothing was recorded on 5 of the 14 days\./)
})

test('describeTrend flags a single day that carries most of the total', () => {
  const text = describeTrend(points([['a', 1], ['b', 1], ['c', 1], ['d', 17]]), { noun: 'orders' })
  assert.match(text, /That one day alone makes up 85% of the total, so a single busy day drives this chart\./)
})

// A single huge day in the first half used to make the reading say orders "dropped by half".
test('describeTrend judges the direction with the spike day left out', () => {
  const values: Array<[string, number]> = [
    ['1', 1], ['2', 0], ['3', 2], ['4', 1], ['5', 0], ['6', 1], ['7', 25],
    ['8', 1], ['9', 0], ['10', 2], ['11', 1], ['12', 0], ['13', 1], ['14', 2],
  ]
  const text = describeTrend(points(values), { noun: 'orders' })
  assert.match(text, /Leaving that day aside, orders are holding steady at about 0\.9 a day\./)
  assert.doesNotMatch(text, /dropped by half/)
})

// Going from 1 a day to 1.3 a day is noise, not a trend a reader should act on.
test('describeTrend calls a tiny change in a small count steady', () => {
  const text = describeTrend(points([['a', 1], ['b', 1], ['c', 1], ['d', 2]]), { noun: 'orders' })
  assert.match(text, /Orders are holding steady at about 1\.3 a day\./)
})

test('describeTrend says when all activity sits in the later days', () => {
  const text = describeTrend(points([['a', 0], ['b', 0], ['c', 3], ['d', 5]]), { noun: 'orders' })
  assert.match(text, /Everything came in the last 2 days; the first 2 had none\./)
})

test('describeTrend says when activity stopped in the later days', () => {
  const text = describeTrend(points([['a', 3], ['b', 5], ['c', 0], ['d', 0]]), { noun: 'orders' })
  assert.match(text, /Orders dropped to nothing in the last 2 days\./)
})

test('describeTrend handles an all-zero range', () => {
  const text = describeTrend(points([['Mon', 0], ['Tue', 0]]), { noun: 'deliveries' })
  assert.equal(text, 'No deliveries were recorded on any of the 2 days shown.')
})

test('describeTrend reads a single period', () => {
  const text = describeTrend(points([['Mon', 4]]), { noun: 'orders' })
  assert.equal(text, 'There were 4 orders on Mon, the only day shown.')
})

test('describeTrend falls back to the empty message', () => {
  assert.match(describeTrend([], { noun: 'orders' }), /nothing to interpret yet/)
  assert.equal(describeTrend([], { noun: 'orders', emptyMessage: 'Nothing here.' }), 'Nothing here.')
})

test('describeTrend names the periods a chart leaves out through periodScope', () => {
  const text = describeTrend(points([['9/1', 4], ['9/5', 2]]), { noun: 'retail sales', nounIsPlural: false, periodScope: 'with sales' })
  assert.match(text, /Retail sales came to 6 over the 2 days with sales, or 3 a day on average\./)
})

test('describeTrend uses the bucket the chart draws, not always days', () => {
  const text = describeTrend(points([['W36', 7], ['W37', 3]]), { noun: 'orders', periodNoun: 'week' })
  assert.match(text, /over the 2 weeks shown, or 5 a week on average\./)
  assert.match(text, /The busiest week was W36 with 7 orders/)
  assert.doesNotMatch(text, /day/)
})

test('describeTrend keeps a money total grammatical and never formats the period count', () => {
  const text = describeTrend(points([['a', 100], ['b', 300]]), {
    noun: 'revenue',
    nounIsPlural: false,
    format: (value) => `P${value}`,
  })
  assert.equal(
    text,
    'Revenue came to P400 over the 2 days shown, or P200 a day on average. ' +
      'It was highest on b at P300, and lowest on a at P100.'
  )
})

// Regression: a rate used to be described as "30.0% higher", a percent of a percent.
test('describeTrend describes a level change in the measure itself, not as a percent of it', () => {
  const text = describeTrend(points([['a', 10], ['b', 10], ['c', 30], ['d', 30]]), {
    noun: 'utilization',
    nounIsPlural: false,
    measure: 'level',
    format: percent,
  })
  assert.match(text, /Utilization averaged 20\.0% over the 4 days shown\./)
  assert.match(text, /It was highest on c and d at 30\.0%, and lowest on a and b at 10\.0%\./)
  assert.match(text, /Utilization is going up: it averaged 30\.0% in the last 2 days, up from 10\.0% in the first 2\./)
  assert.doesNotMatch(text, /200/)
})

test('describeTrend suppresses totals for level measures', () => {
  const text = describeTrend(points([['Jan', 4.5], ['Feb', 4.1]]), {
    noun: 'satisfaction',
    nounIsPlural: false,
    periodNoun: 'month',
    measure: 'level',
  })
  assert.equal(text, 'Satisfaction averaged 4.3 over the 2 months shown. It was highest in Jan at 4.5, and lowest in Feb at 4.1.')
})

// Regression: a month with one rating used to count as much as a month with a hundred.
test('describeTrend weights a level average by each period\'s weight', () => {
  const text = describeTrend(
    [
      { label: 'Jan', value: 5, weight: 1 },
      { label: 'Feb', value: 3, weight: 3 },
    ],
    { noun: 'satisfaction', nounIsPlural: false, periodNoun: 'month', measure: 'level', periodScope: 'with ratings' }
  )
  assert.match(text, /Satisfaction averaged 3\.5 over the 2 months with ratings\./)
})

// ── Composition ───────────────────────────────────────────────────────────

test('describeComposition names the biggest group, says how dominant it is, and sums the rest', () => {
  const text = describeComposition(
    points([['Delivered', 70], ['Pending', 20], ['Cancelled', 8], ['Returned', 2]]),
    { noun: 'orders', entityNoun: 'status', entityNounPlural: 'statuses' }
  )
  assert.equal(
    text,
    'Delivered is the biggest group: 70 of the 100 orders (70%). That is more than half. ' +
      'Pending is next with 20 (20%). The other 2 statuses make up the remaining 10%.'
  )
})

test('describeComposition says when one group is nearly everything', () => {
  const text = describeComposition(points([['Delivered', 95], ['Failed', 5]]), { noun: 'closed orders' })
  assert.match(text, /That is nearly all of them\./)
})

test('describeComposition says when the top two are close', () => {
  const text = describeComposition(points([['A', 40], ['B', 38], ['C', 22]]), { noun: 'orders' })
  assert.match(text, /B is close behind with 38 \(38%\)\./)
})

test('describeComposition handles a tie for the biggest group', () => {
  const text = describeComposition(points([['A', 50], ['B', 50]]), { noun: 'orders' })
  assert.equal(text, 'A and B are tied as the biggest groups, with 50 orders each (50% each).')
})

test('describeComposition collapses to a single group', () => {
  const text = describeComposition(points([['Delivered', 12], ['Pending', 0]]), { noun: 'orders', entityNoun: 'status' })
  assert.equal(text, 'All 12 orders fall under Delivered.')
})

test('describeComposition names groups that had none', () => {
  const text = describeComposition(points([['A', 5], ['B', 3], ['C', 0], ['D', 0]]), { noun: 'orders', entityNoun: 'status' })
  assert.match(text, /C and D had none\./)
})

test('describeComposition names a lone remainder instead of counting it', () => {
  const text = describeComposition(points([['Delivered', 70], ['Pending', 20], ['Cancelled', 10]]), { noun: 'orders' })
  assert.match(text, /Cancelled makes up the remaining 10%\./)
})

test('describeComposition never rounds a sliver to 0% or a majority to 100%', () => {
  const text = describeComposition(points([['A', 999], ['B', 1]]), { noun: 'orders' })
  assert.match(text, /999 of the 1,000 orders \(over 99%\)/)
  assert.match(text, /B is next with 1 \(under 1%\)\./)
})

test('describeComposition percentages always add up to 100', () => {
  const text = describeComposition(
    points([['Healthy', 31], ['Low', 4], ['Critical', 2], ['Overstocked', 3]]),
    { noun: 'SKUs', entityNoun: 'health band' }
  )
  assert.match(text, /31 of the 40 SKUs \(78%\)/)
  assert.match(text, /Low is next with 4 \(10%\)\./)
  assert.match(text, /The other 2 health bands make up the remaining 12%\./)
})

// ── Rankings ──────────────────────────────────────────────────────────────

test('describeRanking names the leader, the concentration at the top and the lowest', () => {
  const text = describeRanking(points([['Alpha', 50], ['Bravo', 30], ['Charlie', 15], ['Delta', 5]]), {
    noun: 'cases',
    entityNoun: 'client',
  })
  assert.equal(
    text,
    'Alpha has the most cases: 50 out of 100 (50%). ' +
      'Together, the top 2 of the 4 clients make up 80% of the total. Delta has the fewest, with 5.'
  )
})

test('describeRanking calls out a runaway leader', () => {
  const text = describeRanking(points([['A', 60], ['B', 20], ['C', 10]]), { noun: 'cases', entityNoun: 'client' })
  assert.match(text, /That is more than twice as many as B \(20\), the next highest\./)
})

test('describeRanking reports ties at the top and entries with none', () => {
  const text = describeRanking(points([['A', 5], ['B', 5], ['C', 2], ['D', 0]]), { noun: 'cases', entityNoun: 'client' })
  assert.match(text, /A and B are tied for the most cases, with 5 each\./)
  assert.match(text, /D had none\./)
})

test('describeRanking says when every entry is level', () => {
  const text = describeRanking(points([['A', 5], ['B', 5], ['C', 5]]), { noun: 'cases', entityNoun: 'client' })
  assert.equal(text, 'All 3 clients are level, with 5 cases each.')
})

test('describeRanking handles a range with no activity', () => {
  const text = describeRanking(points([['Alpha', 0], ['Bravo', 0]]), { noun: 'cases', entityNoun: 'client' })
  assert.equal(text, 'None of the 2 clients recorded any cases in the selected period.')
})

test('describeRanking never formats the entity counts with the value formatter', () => {
  const text = describeRanking(points([['A', 50], ['B', 30], ['C', 15], ['D', 5]]), {
    noun: 'revenue',
    nounIsPlural: false,
    entityNoun: 'client',
    format: (value) => `P${value}`,
  })
  assert.match(text, /Together, the top 2 of the 4 clients make up 80% of the total\./)
  assert.match(text, /D has the least, with P5\./)
  assert.doesNotMatch(text, /P2 of|P4 clients/)
})

// Regression: per-warehouse percentages used to be summed into "60% of the 133% total".
test('describeRanking reads a per-entry rate without adding the rates up', () => {
  const text = describeRanking(points([['North', 80], ['South', 40], ['East', 13.3]]), {
    noun: 'utilization',
    nounIsPlural: false,
    entityNoun: 'warehouse',
    measure: 'level',
    format: percent,
  })
  assert.equal(text, 'North has the highest utilization, at 80.0%, and East has the lowest, at 13.3%.')
})

test('describeRanking groups tied rates', () => {
  const text = describeRanking(points([['Ana', 100], ['Ben', 100], ['Cy', 90]]), {
    noun: 'completion rate',
    nounIsPlural: false,
    entityNoun: 'driver',
    measure: 'level',
    format: percent,
  })
  assert.equal(text, 'Ana and Ben share the highest completion rate, at 100.0%, and Cy has the lowest, at 90.0%.')
})

test('describeRanking reads a single rate and a level field of rates', () => {
  const level = { noun: 'utilization', nounIsPlural: false, entityNoun: 'warehouse', measure: 'level' as const, format: percent }
  assert.equal(describeRanking(points([['North', 80]]), level), 'North is at 80.0% utilization.')
  assert.equal(describeRanking(points([['A', 50], ['B', 50]]), level), 'Both warehouses have the same utilization, 50.0%.')
})

// ── Comparisons ───────────────────────────────────────────────────────────

test('describeComparison reads this period against the last one as a change', () => {
  const text = describeComparison(
    { name: 'This week', points: points([['Mon', 5], ['Tue', 9]]) },
    { name: 'Last week', points: points([['Mon', 1], ['Tue', 2]]) },
    { noun: 'orders', framing: 'change' }
  )
  assert.equal(
    text,
    'This week had 14 orders, up from 3 last week (11 more, about 4.7 times as many). This week was busier on both days.'
  )
})

test('describeComparison reads a drop and credits the busier period', () => {
  const text = describeComparison(
    { name: 'This week', points: points([['Mon', 3], ['Tue', 3], ['Wed', 3]]) },
    { name: 'Last week', points: points([['Mon', 5], ['Tue', 5], ['Wed', 3]]) },
    { noun: 'orders', framing: 'change' }
  )
  assert.equal(
    text,
    'This week had 9 orders, down from 13 last week (4 fewer, or 31% fewer). Last week was busier on 2 of the 3 days, and they tied on 1 day.'
  )
})

test('describeComparison reads a period with nothing before it', () => {
  const text = describeComparison(
    { name: 'This week', points: points([['Mon', 2], ['Tue', 3]]) },
    { name: 'Last week', points: points([['Mon', 0], ['Tue', 0]]) },
    { noun: 'orders', framing: 'change' }
  )
  assert.match(text, /^This week had 5 orders; last week had none\./)
})

test('describeComparison reads two side-by-side series', () => {
  const text = describeComparison(
    { name: 'Stock in', points: points([['Cola', 10], ['Lemon', 5]]) },
    { name: 'Stock out', points: points([['Cola', 4], ['Lemon', 8]]) },
    { noun: 'units', periodNoun: 'product' }
  )
  assert.equal(text, 'Stock in is higher, with 15 units against 12 for Stock out. Stock in was higher for 1 of the 2 products.')
})

test('describeComparison handles two empty series', () => {
  const versus = describeComparison(
    { name: 'Delivered', points: points([['Mon', 0]]) },
    { name: 'Cancelled', points: points([['Mon', 0]]) },
    { noun: 'orders' }
  )
  assert.equal(versus, 'Neither Delivered nor Cancelled recorded any orders.')
  const change = describeComparison(
    { name: 'This week', points: points([['Mon', 0]]) },
    { name: 'Last week', points: points([['Mon', 0]]) },
    { noun: 'approved orders', framing: 'change' }
  )
  assert.equal(change, 'There were no approved orders this week or last week.')
})

// ── Series mix and capacity ───────────────────────────────────────────────

test('describeSeriesMix ranks series totals under a "By …" lead', () => {
  const text = describeSeriesMix(
    [
      { name: 'Inbound', points: points([['Mon', 6], ['Tue', 4]]) },
      { name: 'Outbound', points: points([['Mon', 2], ['Tue', 3]]) },
    ],
    { noun: 'movements', entityNoun: 'direction' }
  )
  assert.match(text, /^By direction, Inbound is the biggest group: 10 of the 15 movements \(67%\)\./)
})

test('describeSeriesMix stays silent when every series is empty', () => {
  const text = describeSeriesMix([{ name: 'Approved', points: points([['Mon', 0]]) }], { noun: 'requests', entityNoun: 'status' })
  assert.equal(text, '')
})

test('describeCapacity reads the used share and what is left', () => {
  assert.equal(describeCapacity(8000, 10000), '8,000 of the 10,000 units of space are in use (80%), leaving 2,000 free.')
})

// The capacity card beside this reading shows one decimal, so the reading must not say 88% next to 87.6%.
test('describeCapacity matches the one-decimal percentage on the capacity card', () => {
  assert.match(describeCapacity(4380, 5000), /\(87\.6%\)/)
})

test('describeCapacity warns when the warehouse is almost full, full or over', () => {
  assert.match(describeCapacity(9500, 10000), /The warehouse is almost full, so check space before taking in more stock\./)
  assert.equal(describeCapacity(10000, 10000), 'The warehouse is full: all 10,000 units of space are in use.')
  assert.equal(describeCapacity(12000, 10000), 'The warehouse is over capacity: it holds 12,000 units in space for 10,000.')
})

test('describeCapacity falls back when no capacity is recorded', () => {
  assert.match(describeCapacity(0, 0), /nothing to interpret yet/)
})
