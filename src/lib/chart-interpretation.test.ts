import test from 'node:test'
import assert from 'node:assert/strict'

import {
  describeComparison,
  describeComposition,
  describeRanking,
  describeSeriesMix,
  describeTrend,
  toPoints,
} from './chart-interpretation.ts'

const points = (values: Array<[string, number]>) => values.map(([label, value]) => ({ label, value }))

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

test('describeTrend reports the total, the average and the extremes', () => {
  const text = describeTrend(points([['Mon', 2], ['Tue', 8], ['Wed', 5]]), { noun: 'orders' })
  assert.match(text, /The 3 days in range total 15 orders, an average of 5 per day\./)
  assert.match(text, /peak is Tue at 8 and the low is Mon at 2/)
})

test('describeTrend calls out a rising second half', () => {
  const text = describeTrend(points([['a', 2], ['b', 2], ['c', 6], ['d', 6]]), { noun: 'orders' })
  assert.match(text, /later half of the range averages 200\.0% higher/)
})

test('describeTrend calls out a steady series', () => {
  const text = describeTrend(points([['a', 10], ['b', 10], ['c', 10], ['d', 10]]), { noun: 'orders' })
  assert.match(text, /holding steady/)
})

test('describeTrend suppresses totals for level measures', () => {
  const text = describeTrend(points([['Jan', 4.5], ['Feb', 4.1]]), {
    noun: 'ratings',
    periodNoun: 'month',
    measure: 'level',
  })
  assert.match(text, /Ratings average 4\.3 across 2 months\./)
  assert.doesNotMatch(text, /total/)
})

test('describeTrend handles an all-zero range', () => {
  const text = describeTrend(points([['Mon', 0], ['Tue', 0]]), { noun: 'deliveries' })
  assert.equal(text, 'No deliveries were recorded on any of the 2 days in the current range.')
})

test('describeTrend falls back to the empty message', () => {
  assert.match(describeTrend([], { noun: 'orders' }), /nothing to interpret yet/)
  assert.equal(
    describeTrend([], { noun: 'orders', emptyMessage: 'Nothing here.' }),
    'Nothing here.'
  )
})

test('describeComposition ranks the mix and counts the tail', () => {
  const text = describeComposition(
    points([['Delivered', 70], ['Pending', 20], ['Cancelled', 8], ['Returned', 2]]),
    { noun: 'orders', entityNoun: 'status' }
  )
  assert.match(text, /Delivered is the largest share at 70 \(70\.0%\) of 100 orders\./)
  assert.match(text, /Pending follows at 20 \(20\.0%\)\./)
  assert.match(text, /remaining 2 statuses together make up 10\.0%/)
})

test('describeComposition collapses to a single slice', () => {
  const text = describeComposition(points([['Delivered', 12], ['Pending', 0]]), {
    noun: 'orders',
    entityNoun: 'status',
  })
  assert.match(text, /All 12 orders fall under Delivered/)
})

test('describeComposition reports empty categories', () => {
  const text = describeComposition(
    points([['A', 5], ['B', 3], ['C', 0], ['D', 0]]),
    { noun: 'orders', entityNoun: 'status' }
  )
  assert.match(text, /2 statuses recorded none\./)
})

test('describeRanking names the leader, the concentration and the laggard', () => {
  const text = describeRanking(
    points([['Alpha', 50], ['Bravo', 30], ['Charlie', 15], ['Delta', 5]]),
    { noun: 'cases', entityNoun: 'client' }
  )
  assert.match(text, /Alpha leads with 50 cases, 50\.0% of the 100 total\./)
  assert.match(text, /top 2 of 4 clients account for 80\.0%\./)
  assert.match(text, /Delta is the lowest at 5\./)
})

test('describeRanking handles a range with no activity', () => {
  const text = describeRanking(points([['Alpha', 0], ['Bravo', 0]]), {
    noun: 'cases',
    entityNoun: 'client',
  })
  assert.equal(text, 'None of the 2 clients recorded any cases in the current range.')
})

test('describeComparison names the leader and how often it wins', () => {
  const text = describeComparison(
    { name: 'Delivered', points: points([['Mon', 5], ['Tue', 9]]) },
    { name: 'Cancelled', points: points([['Mon', 1], ['Tue', 2]]) },
    { noun: 'orders' }
  )
  assert.match(text, /Delivered carries 14 orders against Cancelled's 3/)
  assert.match(text, /82\.4% of the combined 17/)
  assert.match(text, /Delivered is ahead in 2 of 2 days\./)
})

test('describeComparison handles two empty series', () => {
  const text = describeComparison(
    { name: 'Delivered', points: points([['Mon', 0]]) },
    { name: 'Cancelled', points: points([['Mon', 0]]) },
    { noun: 'orders' }
  )
  assert.equal(text, 'Neither Delivered nor Cancelled recorded any orders in the current range.')
})

test('describeTrend keeps a mass noun grammatical', () => {
  const text = describeTrend(points([['a', 10], ['b', 10], ['c', 30], ['d', 30]]), {
    noun: 'utilization',
    nounIsPlural: false,
    measure: 'level',
    format: (value) => `${value.toFixed(1)}%`,
  })
  assert.match(text, /Utilization averages 20\.0% across 4 days\./)
  assert.match(text, /so utilization is rising\./)
})

test('describeTrend never formats the period count with the value formatter', () => {
  const text = describeTrend(points([['a', 100], ['b', 300]]), {
    noun: 'revenue',
    nounIsPlural: false,
    format: (value) => `P${value}`,
  })
  assert.match(text, /The 2 days in range total P400 revenue, an average of P200 per day\./)
  assert.doesNotMatch(text, /P2 days/)
})

test('describeRanking never formats the entity counts with the value formatter', () => {
  const text = describeRanking(
    points([['A', 50], ['B', 30], ['C', 15], ['D', 5]]),
    { noun: 'revenue', entityNoun: 'client', format: (value) => `P${value}` }
  )
  assert.match(text, /The top 2 of 4 clients account for 80\.0%\./)
  assert.doesNotMatch(text, /P2 of P4/)
})

test('describeComposition names a lone remainder instead of counting it', () => {
  const text = describeComposition(
    points([['Delivered', 70], ['Pending', 20], ['Cancelled', 10]]),
    { noun: 'orders', entityNoun: 'status' }
  )
  assert.match(text, /Cancelled makes up the remaining 10\.0%\./)
  assert.doesNotMatch(text, /remaining 1 status/)
})

test('describeSeriesMix ranks series totals against each other', () => {
  const text = describeSeriesMix(
    [
      { name: 'Inbound', points: points([['Mon', 6], ['Tue', 4]]) },
      { name: 'Outbound', points: points([['Mon', 2], ['Tue', 3]]) },
    ],
    { noun: 'movements', entityNoun: 'series' }
  )
  assert.match(text, /Inbound is the largest share at 10 \(66\.7%\) of 15 movements\./)
})
