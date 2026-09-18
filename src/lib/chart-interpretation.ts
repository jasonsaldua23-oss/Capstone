/**
 * Plain-language readings for the charts on the admin and warehouse screens.
 *
 * Every chart carries a short interpretation underneath it. The sentences are
 * derived from the same array the chart draws, so they move with the active
 * date range, warehouse and status filters instead of restating a fixed caption.
 *
 * The helpers here are deliberately pure and shape-agnostic: a caller maps its
 * rows to {@link InterpretationPoint}s with {@link toPoints} and picks the
 * builder that matches what the chart is showing — a series over time, a share
 * of a whole, a ranking of categories, or two series side by side.
 */

export type InterpretationPoint = {
  label: string
  value: number
}

export type ValueFormatter = (value: number) => string

/** How the y-axis should be summarized: a countable total, or a level that only averages. */
export type InterpretationMeasure = 'total' | 'level'

export type InterpretationOptions = {
  /** What the values count, e.g. 'orders', 'deliveries', 'revenue'. Used mid-sentence. */
  noun: string
  /** What one x-axis step is, e.g. 'day', 'week', 'month'. */
  periodNoun?: string
  /** What one category is, e.g. 'status', 'client', 'warehouse'. */
  entityNoun?: string
  /** Plural of `entityNoun` when the default rule would get it wrong. */
  entityNounPlural?: string
  /** Renders a raw value for display. Defaults to a grouped number. Never applied to counts. */
  format?: ValueFormatter
  /** False for mass nouns like 'revenue' or 'utilization', so the verbs agree. */
  nounIsPlural?: boolean
  /** Shown when there is nothing to read. */
  emptyMessage?: string
  /** 'level' suppresses totals for rates, ratings and utilization series. */
  measure?: InterpretationMeasure
}

const DEFAULT_EMPTY = 'No data matches the current filters, so there is nothing to interpret yet.'

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const toText = (value: unknown) => String(value ?? '').trim()

/** Grouped number with at most two decimals — deterministic so SSR and the client agree. */
export const formatChartNumber: ValueFormatter = (value) =>
  Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })

const formatPercent = (value: number) => `${value.toFixed(1)}%`

const shareOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

/** Regular English plural, good enough for the nouns these charts use. */
const defaultPlural = (singular: string) => {
  if (/(s|x|z|ch|sh)$/i.test(singular)) return `${singular}es`
  if (/[^aeiou]y$/i.test(singular)) return `${singular.slice(0, -1)}ies`
  return `${singular}s`
}

const pluralize = (count: number, singular: string, plural?: string) =>
  count === 1 ? singular : plural || defaultPlural(singular)

const capitalize = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value)

const joinSentences = (parts: Array<string | null | undefined>) =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(' ')

/** Maps arbitrary chart rows onto the label/value pairs the builders read. */
export function toPoints<T>(
  rows: readonly T[] | null | undefined,
  label: (row: T, index: number) => unknown,
  value: (row: T, index: number) => unknown
): InterpretationPoint[] {
  return (rows || []).map((row, index) => ({
    label: toText(label(row, index)) || 'Unlabeled',
    value: toNumber(value(row, index)),
  }))
}

const sumOf = (points: readonly InterpretationPoint[]) =>
  points.reduce((running, point) => running + point.value, 0)

const extremesOf = (points: readonly InterpretationPoint[]) => {
  let highest = points[0]
  let lowest = points[0]
  for (const point of points) {
    if (point.value > highest.value) highest = point
    if (point.value < lowest.value) lowest = point
  }
  return { highest, lowest }
}

/**
 * Reads a series plotted over time: how much, how it is distributed, and which
 * way the later half of the range moved against the earlier half.
 */
export function describeTrend(
  points: readonly InterpretationPoint[],
  options: InterpretationOptions
): string {
  const { noun, periodNoun = 'day', measure = 'total', format = formatChartNumber } = options
  if (!points.length) return options.emptyMessage || DEFAULT_EMPTY

  const total = sumOf(points)
  const average = total / points.length
  const { highest, lowest } = extremesOf(points)
  // Counts of periods and categories are always plain numbers, never pesos or percentages.
  const periodCount = `${formatChartNumber(points.length)} ${pluralize(points.length, periodNoun)}`

  if (measure === 'total' && total === 0) {
    return `No ${noun} were recorded on any of the ${periodCount} in the current range.`
  }

  const plural = options.nounIsPlural !== false
  const headline =
    measure === 'total'
      ? `The ${periodCount} in range total ${format(total)} ${noun}, an average of ${format(average)} per ${periodNoun}.`
      : `${capitalize(noun)} ${plural ? 'average' : 'averages'} ${format(average)} across ${periodCount}.`

  const spread =
    highest.label === lowest.label || highest.value === lowest.value
      ? `Every ${periodNoun} sits at ${format(highest.value)}, so the series is flat.`
      : `The peak is ${highest.label} at ${format(highest.value)} and the low is ${lowest.label} at ${format(lowest.value)}.`

  return joinSentences([headline, spread, describeHalfOverHalf(points, options)])
}

/** Compares the later half of an ordered series against the earlier half. */
function describeHalfOverHalf(
  points: readonly InterpretationPoint[],
  options: InterpretationOptions
): string | null {
  if (points.length < 4) return null
  const middle = Math.floor(points.length / 2)
  const earlier = points.slice(0, middle)
  const later = points.slice(points.length - middle)
  const earlierAverage = sumOf(earlier) / earlier.length
  const laterAverage = sumOf(later) / later.length
  if (earlierAverage === 0) {
    return laterAverage > 0
      ? 'The earlier half of the range was empty, so all of the activity sits in the later half.'
      : null
  }
  const change = ((laterAverage - earlierAverage) / Math.abs(earlierAverage)) * 100
  if (Math.abs(change) < 5) {
    return `The two halves of the range are within ${formatPercent(Math.abs(change))} of each other, so the level is holding steady.`
  }
  const direction = change > 0 ? 'higher' : 'lower'
  const verb = change > 0 ? 'rising' : 'easing'
  const plural = options.nounIsPlural !== false
  return `The later half of the range averages ${formatPercent(Math.abs(change))} ${direction} than the earlier half, so ${options.noun} ${plural ? 'are' : 'is'} ${verb}.`
}

/**
 * Reads a pie, donut or stacked mix: which slice dominates, what follows it,
 * and how much of the whole is left over.
 */
export function describeComposition(
  points: readonly InterpretationPoint[],
  options: InterpretationOptions
): string {
  const { noun, entityNoun = 'category', entityNounPlural, format = formatChartNumber } = options
  const total = sumOf(points)
  if (!points.length || total <= 0) return options.emptyMessage || DEFAULT_EMPTY

  const ranked = [...points].filter((point) => point.value > 0).sort((a, b) => b.value - a.value)
  const [top, second, ...rest] = ranked

  if (ranked.length === 1) {
    return `All ${format(total)} ${noun} fall under ${top.label}, so the mix has a single ${entityNoun}.`
  }

  const headline = `${top.label} is the largest share at ${format(top.value)} (${formatPercent(
    shareOf(top.value, total)
  )}) of ${format(total)} ${noun}.`
  const runnerUp = `${second.label} follows at ${format(second.value)} (${formatPercent(
    shareOf(second.value, total)
  )}).`
  const tail = rest.length
    ? rest.length === 1
      ? `${rest[0].label} makes up the remaining ${formatPercent(shareOf(rest[0].value, total))}.`
      : `The remaining ${formatChartNumber(rest.length)} ${pluralize(
          rest.length,
          entityNoun,
          entityNounPlural
        )} together make up ${formatPercent(shareOf(sumOf(rest), total))}.`
    : null
  const zeroed = points.length - ranked.length
  const empty = zeroed
    ? `${formatChartNumber(zeroed)} ${pluralize(zeroed, entityNoun, entityNounPlural)} recorded none.`
    : null

  return joinSentences([headline, runnerUp, tail, empty])
}

/**
 * Reads a ranked bar chart of categories: the leader, how concentrated the
 * total is at the top, and the weakest entry.
 */
export function describeRanking(
  points: readonly InterpretationPoint[],
  options: InterpretationOptions
): string {
  const { noun, entityNoun = 'entry', entityNounPlural, format = formatChartNumber } = options
  if (!points.length) return options.emptyMessage || DEFAULT_EMPTY

  const ranked = [...points].sort((a, b) => b.value - a.value)
  const total = sumOf(ranked)
  const top = ranked[0]
  const bottom = ranked[ranked.length - 1]

  if (total <= 0) {
    return `None of the ${formatChartNumber(points.length)} ${pluralize(points.length, entityNoun, entityNounPlural)} recorded any ${noun} in the current range.`
  }

  const headline = `${top.label} leads with ${format(top.value)} ${noun}${
    total > 0 ? `, ${formatPercent(shareOf(top.value, total))} of the ${format(total)} total` : ''
  }.`

  const leadingCount = Math.min(3, Math.max(1, Math.ceil(ranked.length / 3)))
  const concentration =
    ranked.length >= 4
      ? `The top ${formatChartNumber(leadingCount)} of ${formatChartNumber(ranked.length)} ${pluralize(
          ranked.length,
          entityNoun,
          entityNounPlural
        )} account for ${formatPercent(shareOf(sumOf(ranked.slice(0, leadingCount)), total))}.`
      : null

  const trailing =
    ranked.length > 1 && bottom.value !== top.value
      ? `${bottom.label} is the lowest at ${format(bottom.value)}.`
      : null

  return joinSentences([headline, concentration, trailing])
}

export type ComparisonSeries = {
  name: string
  points: readonly InterpretationPoint[]
}

/**
 * Reads two series drawn against the same x-axis: which one carries more, by
 * how much, and how often the leader changes.
 */
export function describeComparison(
  first: ComparisonSeries,
  second: ComparisonSeries,
  options: InterpretationOptions
): string {
  const { noun, periodNoun = 'day', format = formatChartNumber } = options
  const firstTotal = sumOf(first.points)
  const secondTotal = sumOf(second.points)
  if (!first.points.length && !second.points.length) return options.emptyMessage || DEFAULT_EMPTY
  if (firstTotal === 0 && secondTotal === 0) {
    return `Neither ${first.name} nor ${second.name} recorded any ${noun} in the current range.`
  }

  const leader = firstTotal >= secondTotal ? first : second
  const trailer = firstTotal >= secondTotal ? second : first
  const leaderTotal = Math.max(firstTotal, secondTotal)
  const trailerTotal = Math.min(firstTotal, secondTotal)
  const combined = firstTotal + secondTotal

  const headline = `${leader.name} carries ${format(leaderTotal)} ${noun} against ${trailer.name}'s ${format(
    trailerTotal
  )} — ${formatPercent(shareOf(leaderTotal, combined))} of the combined ${format(combined)}.`

  const paired = Math.min(first.points.length, second.points.length)
  let leaderWins = 0
  for (let index = 0; index < paired; index += 1) {
    const a = first.points[index].value
    const b = second.points[index].value
    if (leader === first ? a > b : b > a) leaderWins += 1
  }
  const cadence = paired
    ? `${leader.name} is ahead in ${formatChartNumber(leaderWins)} of ${formatChartNumber(paired)} ${pluralize(paired, periodNoun)}.`
    : null

  return joinSentences([headline, cadence])
}

/**
 * Reads a chart whose bars are split across several named series, by ranking
 * the series totals against each other.
 */
export function describeSeriesMix(
  series: readonly ComparisonSeries[],
  options: InterpretationOptions
): string {
  const totals = series.map((entry) => ({ label: entry.name, value: sumOf(entry.points) }))
  return describeComposition(totals, { entityNoun: 'series', ...options })
}
