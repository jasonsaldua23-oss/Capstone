/**
 * Plain-language readings for the charts on the admin and warehouse screens.
 *
 * Every chart carries a short interpretation underneath it. The sentences are
 * derived from the same array the chart draws, so they move with the active
 * date range, warehouse and status filters instead of restating a fixed caption.
 * They are written for someone who does not read charts for a living: whole
 * percentages, rounded averages, "going up / going down" rather than
 * half-over-half ratios, and words that change with the data (a tie, a runaway
 * leader, a single busy day, groups that had none).
 *
 * The helpers here are deliberately pure and shape-agnostic: a caller maps its
 * rows to {@link InterpretationPoint}s with {@link toPoints} and picks the
 * builder that matches what the chart is showing — a series over time, a share
 * of a whole, a ranking of categories, or two series side by side.
 */

export type InterpretationPoint = {
  label: string
  value: number
  /** How much this point counts toward a 'level' average, e.g. the responses behind a monthly rating. */
  weight?: number
}

export type ValueFormatter = (value: number) => string

/**
 * How values combine: 'total' values add up (orders, pesos, units), while a
 * 'level' is a rate, rating or utilization that only averages — adding two
 * warehouses' 80% and 40% together means nothing.
 */
export type InterpretationMeasure = 'total' | 'level'

export type InterpretationOptions = {
  /** What the values count, e.g. 'orders', 'deliveries', 'revenue'. Used mid-sentence. */
  noun: string
  /** What one x-axis step is, e.g. 'day', 'week', 'month'. */
  periodNoun?: string
  /** Which periods the chart holds, after "the 14 days …". Defaults to 'shown'. */
  periodScope?: string
  /** What one category is, e.g. 'status', 'client', 'warehouse'. */
  entityNoun?: string
  /** Plural of `entityNoun` when the default rule would get it wrong. */
  entityNounPlural?: string
  /** Renders a raw value for display. Defaults to a grouped, rounded number. Never applied to counts. */
  format?: ValueFormatter
  /** False for mass nouns like 'revenue' or 'utilization', so the verbs agree. */
  nounIsPlural?: boolean
  /** Shown when there is nothing to read. */
  emptyMessage?: string
  /** 'level' reads averages and extremes and never adds values up. */
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

/** A 1–5 rating as a reader says it: "4.3 stars". */
export const formatStars: ValueFormatter = (value) => `${Number(value || 0).toFixed(1)} stars`

/** Whole percentages, without rounding a sliver to 0% or a near-total to 100%. */
const formatShare = (share: number) => {
  if (share <= 0) return '0%'
  if (share >= 100) return '100%'
  const rounded = Math.round(share)
  if (rounded === 0) return 'under 1%'
  if (rounded === 100) return 'over 99%'
  return `${rounded}%`
}

const shareOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)

/**
 * Whole percentages for parts that make up a whole, rounded together (largest
 * remainder) so the ones printed side by side add up to 100 rather than 101.
 */
const wholeShares = (parts: readonly number[], whole: number) => {
  const exact = parts.map((part) => shareOf(part, whole))
  const rounded = exact.map(Math.floor)
  let missing = 100 - rounded.reduce((sum, value) => sum + value, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)
  for (const { index } of byRemainder) {
    if (missing <= 0) break
    rounded[index] += 1
    missing -= 1
  }
  return rounded.map((value, index) => {
    if (parts[index] > 0 && value === 0) return 'under 1%'
    if (value === 100 && parts[index] < whole) return 'over 99%'
    return `${value}%`
  })
}

const roundTo = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Regular English plural, good enough for the nouns these charts use. */
const defaultPlural = (singular: string) => {
  if (/(s|x|z|ch|sh)$/i.test(singular)) return `${singular}es`
  if (/[^aeiou]y$/i.test(singular)) return `${singular.slice(0, -1)}ies`
  return `${singular}s`
}

const pluralize = (count: number, singular: string, plural?: string) =>
  count === 1 ? singular : plural || defaultPlural(singular)

const singularWord = (word: string) => {
  if (/[^aeiou]ies$/i.test(word)) return `${word.slice(0, -3)}y`
  if (/(ch|sh|x|ss)es$/i.test(word)) return word.slice(0, -2)
  if (/[^s]s$/i.test(word)) return word.slice(0, -1)
  return word
}

/** "orders" → "order", "units of capacity" → "unit of capacity", for a count of one. */
const singularNoun = (noun: string) => {
  const ofIndex = noun.indexOf(' of ')
  if (ofIndex > 0) return `${singularNoun(noun.slice(0, ofIndex))}${noun.slice(ofIndex)}`
  const words = noun.split(' ')
  words[words.length - 1] = singularWord(words[words.length - 1])
  return words.join(' ')
}

const capitalize = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value)

const lowerFirst = (value: string) => (value ? value.charAt(0).toLowerCase() + value.slice(1) : value)

const joinSentences = (parts: Array<string | null | undefined>) =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(' ')

/** "A", "A and B", "A, B and C". */
export const joinNames = (names: readonly string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** "a day", "an hour". */
const perPeriod = (periodNoun: string) => `${/^[aeiou]/i.test(periodNoun) ? 'an' : 'a'} ${periodNoun}`

/** "on Tue", "in Sep", "for Cola". */
const periodPreposition = (periodNoun: string) => {
  if (/^(day|date)$/i.test(periodNoun)) return 'on'
  if (/^(product|item|sku|client|driver|warehouse)$/i.test(periodNoun)) return 'for'
  return 'in'
}

type Reader = {
  plural: boolean
  /** A value as the chart would print it. */
  exact: (value: number) => string
  /** An average or ratio, rounded for a reader and marked "about" when rounding changed it. */
  approx: (value: number) => string
  /** The noun, singular when the count is exactly one. */
  nounFor: (count: number) => string
}

function readerFor(options: InterpretationOptions): Reader {
  const plural = options.nounIsPlural !== false
  const level = options.measure === 'level'
  const exact = options.format || formatChartNumber
  return {
    plural,
    exact,
    approx: (value) => {
      // A caller's formatter already decides precision (pesos, percentages), so it is trusted as is.
      if (options.format) return options.format(value)
      // Counts read best whole once they are past a handful; levels such as ratings keep one decimal.
      const rounded = !level && Math.abs(value) >= 5 ? Math.round(value) : roundTo(value, 1)
      const text = formatChartNumber(rounded)
      return rounded === value ? text : `about ${text}`
    },
    nounFor: (count) => (plural && count === 1 ? singularNoun(options.noun) : options.noun),
  }
}

/** Maps arbitrary chart rows onto the label/value pairs the builders read. */
export function toPoints<T>(
  rows: readonly T[] | null | undefined,
  label: (row: T, index: number) => unknown,
  value: (row: T, index: number) => unknown,
  weight?: (row: T, index: number) => unknown
): InterpretationPoint[] {
  return (rows || []).map((row, index) => {
    const point: InterpretationPoint = {
      label: toText(label(row, index)) || 'Unlabeled',
      value: toNumber(value(row, index)),
    }
    if (weight) point.weight = toNumber(weight(row, index))
    return point
  })
}

const sumOf = (points: readonly InterpretationPoint[]) =>
  points.reduce((running, point) => running + point.value, 0)

/** Plain mean, or a weighted one when the points carry weights. */
const averageOf = (points: readonly InterpretationPoint[]) => {
  if (!points.length) return 0
  const weighted = points.some((point) => point.weight !== undefined)
  if (!weighted) return sumOf(points) / points.length
  const totalWeight = points.reduce((running, point) => running + Math.max(0, point.weight ?? 0), 0)
  if (totalWeight <= 0) return sumOf(points) / points.length
  return points.reduce((running, point) => running + point.value * Math.max(0, point.weight ?? 0), 0) / totalWeight
}

const pointsAt = (points: readonly InterpretationPoint[], value: number) =>
  points.filter((point) => point.value === value)

// ── Trends ────────────────────────────────────────────────────────────────

/**
 * Reads a series plotted over time: how much there was, the busiest and
 * quietest periods, whether one period carries the chart, and which way the
 * later periods moved against the earlier ones.
 */
export function describeTrend(points: readonly InterpretationPoint[], options: InterpretationOptions): string {
  const { noun, periodNoun = 'day', periodScope = 'shown', measure = 'total' } = options
  if (!points.length) return options.emptyMessage || DEFAULT_EMPTY

  const read = readerFor(options)
  const prep = periodPreposition(periodNoun)
  const total = sumOf(points)
  // Counts of periods and categories are always plain numbers, never pesos or percentages.
  const span = `the ${formatChartNumber(points.length)} ${pluralize(points.length, periodNoun)} ${periodScope}`

  if (measure === 'total' && total === 0) {
    return `No ${noun} ${read.plural ? 'were' : 'was'} recorded ${prep} any of ${span}.`
  }

  if (points.length === 1) {
    const only = points[0]
    const where = `${prep} ${only.label}, the only ${periodNoun} ${periodScope}`
    if (measure === 'level') return `${capitalize(noun)} was ${read.exact(only.value)} ${where}.`
    return read.plural
      ? `There ${only.value === 1 ? 'was' : 'were'} ${read.exact(only.value)} ${read.nounFor(only.value)} ${where}.`
      : `${capitalize(noun)} came to ${read.exact(only.value)} ${where}.`
  }

  const average = averageOf(points)
  let headline: string
  if (measure === 'level') {
    headline = `${capitalize(noun)} averaged ${read.approx(average)} over ${span}.`
  } else if (read.plural) {
    headline = `There ${total === 1 ? 'was' : 'were'} ${read.exact(total)} ${read.nounFor(total)} over ${span}, or ${read.approx(average)} ${perPeriod(periodNoun)} on average.`
  } else {
    headline = `${capitalize(noun)} came to ${read.exact(total)} over ${span}, or ${read.approx(average)} ${perPeriod(periodNoun)} on average.`
  }

  const flat = points.every((point) => point.value === points[0].value)
  if (flat) {
    const steady =
      measure === 'level'
        ? `It stayed at ${read.exact(points[0].value)} the whole time.`
        : `It was the same every ${periodNoun}: ${read.exact(points[0].value)} ${read.nounFor(points[0].value)} ${perPeriod(periodNoun)}.`
    return joinSentences([headline, steady])
  }

  const spike = measure === 'total' ? findSpike(points, total) : null
  // A lone spike would otherwise decide "going up" or "down" by which half it
  // happens to fall in, so the direction is read from the other periods.
  const direction = spike
    ? describeDirection(points.filter((point) => point !== spike.point), options, read)
    : describeDirection(points, options, read)

  return joinSentences([
    headline,
    describeTrendExtremes(points, options, read),
    spike
      ? `That one ${periodNoun} alone makes up ${formatShare(spike.share)} of the total, so a single busy ${periodNoun} drives this chart.`
      : null,
    direction && spike ? `Leaving that ${periodNoun} aside, ${lowerFirst(direction)}` : direction,
  ])
}

function describeTrendExtremes(
  points: readonly InterpretationPoint[],
  options: InterpretationOptions,
  read: Reader
): string {
  const { periodNoun = 'day', measure = 'total' } = options
  const prep = periodPreposition(periodNoun)
  const values = points.map((point) => point.value)
  const highest = Math.max(...values)
  const lowest = Math.min(...values)
  const highs = pointsAt(points, highest)
  const lows = pointsAt(points, lowest)
  const periods = pluralize(2, periodNoun)

  // A money or rate series reads as "highest/lowest"; a count of things as "busiest/quietest".
  if (measure === 'level' || !read.plural) {
    const where = (group: InterpretationPoint[]) =>
      group.length <= 3 ? `${prep} ${joinNames(group.map((point) => point.label))}` : `${prep} ${group.length} ${periods}`
    const high = `It was highest ${where(highs)} at ${read.exact(highest)}`
    const low =
      measure === 'total' && lowest === 0
        ? `nothing was recorded ${where(lows)}`
        : `lowest ${where(lows)} at ${read.exact(lowest)}`
    return `${high}, and ${low}.`
  }

  const highNoun = read.nounFor(highest)
  const high =
    highs.length === 1
      ? `The busiest ${periodNoun} was ${highs[0].label} with ${read.exact(highest)} ${highNoun}`
      : highs.length <= 3
        ? `The busiest ${periods} were ${joinNames(highs.map((point) => point.label))}, with ${read.exact(highest)} ${highNoun} each`
        : `${highs.length} ${periods} tied for the busiest, with ${read.exact(highest)} ${highNoun} each`

  let low: string
  if (lowest === 0) {
    low =
      lows.length <= 3
        ? `nothing was recorded ${prep} ${joinNames(lows.map((point) => point.label))}`
        : `nothing was recorded ${prep} ${lows.length} of the ${points.length} ${periods}`
  } else {
    const lowNoun = read.nounFor(lowest)
    low =
      lows.length === 1
        ? `the quietest was ${lows[0].label} with ${read.exact(lowest)} ${lowNoun}`
        : lows.length <= 3
          ? `the quietest were ${joinNames(lows.map((point) => point.label))}, with ${read.exact(lowest)} ${lowNoun} each`
          : `${lows.length} ${periods} tied for the quietest, with ${read.exact(lowest)} ${lowNoun} each`
  }
  return `${high}, and ${low}.`
}

/**
 * One period carrying at least half the total and towering over the rest (at
 * least three times the next highest): the chart is really about that period.
 */
function findSpike(points: readonly InterpretationPoint[], total: number) {
  if (points.length < 4 || total <= 0) return null
  const ranked = [...points].sort((a, b) => b.value - a.value)
  const [peak, runnerUp] = ranked
  if (peak.value === runnerUp.value || peak.value < runnerUp.value * 3) return null
  const share = shareOf(peak.value, total)
  return share >= 50 ? { point: peak, share } : null
}

/** Compares the last few periods against the first few, in the chart's own units. */
function describeDirection(
  points: readonly InterpretationPoint[],
  options: InterpretationOptions,
  read: Reader
): string | null {
  if (points.length < 4) return null
  const { noun, periodNoun = 'day', measure = 'total' } = options
  const size = Math.floor(points.length / 2)
  const earlier = averageOf(points.slice(0, size))
  const later = averageOf(points.slice(points.length - size))
  const periods = pluralize(size, periodNoun)
  const lastSpan = `the last ${formatChartNumber(size)} ${periods}`
  const firstSpan = `the first ${formatChartNumber(size)}`
  const subject = capitalize(noun)
  const verb = read.plural ? 'are' : 'is'
  // "Steady" names the level across everything compared, not just the later half.
  const overall = averageOf(points)

  if (measure === 'level') {
    if (earlier === later || (earlier !== 0 && Math.abs((later - earlier) / earlier) < 0.05)) {
      return `${subject} ${verb} holding steady at around ${read.approx(overall)}.`
    }
    const pronoun = read.plural ? 'they' : 'it'
    const rising = later > earlier
    return `${subject} ${verb} going ${rising ? 'up' : 'down'}: ${pronoun} averaged ${read.approx(later)} in ${lastSpan}, ${
      rising ? 'up' : 'down'
    } from ${read.approx(earlier)} in ${firstSpan}.`
  }

  if (earlier === 0 && later === 0) return null
  if (earlier === 0) return `Everything came in ${lastSpan}; ${firstSpan} had none.`
  if (later === 0) return `${subject} dropped to nothing in ${lastSpan}.`

  const ratio = later / earlier
  // Small counts wobble by chance: 1 a day against 1.3 a day is noise, not a
  // trend. For plain counts under five a period, a change smaller than the
  // usual random spread of the two averages (√((a+b)/n)) is read as steady.
  const smallCount = read.plural && !options.format && Math.max(earlier, later) < 5
  const withinNoise = smallCount && Math.abs(later - earlier) < Math.sqrt((earlier + later) / size)
  if (Math.abs(ratio - 1) < 0.1 || withinNoise) {
    return `${subject} ${verb} holding steady at ${read.approx(overall)} ${perPeriod(periodNoun)}.`
  }
  const lead =
    ratio > 2
      ? `${subject} more than doubled`
      : ratio === 2
        ? `${subject} doubled`
        : ratio <= 0.5
          ? `${subject} dropped by half or more`
          : `${subject} ${verb} going ${ratio > 1 ? 'up' : 'down'}`
  return `${lead}: ${lastSpan} averaged ${read.approx(later)} ${perPeriod(periodNoun)}, ${
    ratio > 1 ? 'up' : 'down'
  } from ${read.approx(earlier)} in ${firstSpan}.`
}

// ── Composition ───────────────────────────────────────────────────────────

/**
 * Reads a pie, donut or stacked mix: the biggest group and how dominant it is,
 * what follows it, how much is left over, and which groups had none.
 */
export function describeComposition(points: readonly InterpretationPoint[], options: InterpretationOptions): string {
  const { noun, entityNoun = 'category', entityNounPlural } = options
  const read = readerFor(options)
  const total = sumOf(points)
  if (!points.length || total <= 0) return options.emptyMessage || DEFAULT_EMPTY

  const ranked = [...points].filter((point) => point.value > 0).sort((a, b) => b.value - a.value)
  const [top, second, ...rest] = ranked
  const share = (point: InterpretationPoint) => formatShare(shareOf(point.value, total))

  if (ranked.length === 1) {
    return `All ${read.exact(total)} ${read.nounFor(total)} fall under ${top.label}.`
  }

  const zeroed = points.filter((point) => point.value <= 0)
  const empty = zeroed.length
    ? zeroed.length <= 3
      ? `${joinNames(zeroed.map((point) => point.label))} had none.`
      : `${formatChartNumber(zeroed.length)} ${pluralize(zeroed.length, entityNoun, entityNounPlural)} had none.`
    : null

  if (second.value === top.value) {
    const tied = ranked.filter((point) => point.value === top.value)
    const others = ranked.slice(tied.length)
    const lead =
      tied.length <= 3
        ? `${joinNames(tied.map((point) => point.label))} are tied as the biggest groups`
        : `${formatChartNumber(tied.length)} ${pluralize(tied.length, entityNoun, entityNounPlural)} are tied as the biggest groups`
    const remainder = others.length
      ? `The other ${formatChartNumber(others.length)} ${pluralize(others.length, entityNoun, entityNounPlural)} make up the remaining ${formatShare(
          shareOf(sumOf(others), total)
        )}.`
      : null
    return joinSentences([
      `${lead}, with ${read.exact(top.value)} ${read.nounFor(top.value)} each (${share(top)} each).`,
      remainder,
      empty,
    ])
  }

  const topShare = shareOf(top.value, total)
  // The figures printed together are rounded together, so they always sum to 100%.
  const [topPercent, secondPercent, restPercent] = wholeShares(
    rest.length ? [top.value, second.value, sumOf(rest)] : [top.value, second.value],
    total
  )
  const headline = `${top.label} is the biggest group: ${read.exact(top.value)} of the ${read.exact(total)} ${noun} (${topPercent}).`
  const dominance =
    topShare >= 90 ? `That is nearly all of ${read.plural ? 'them' : 'it'}.` : topShare > 50 ? 'That is more than half.' : null
  const closeBehind = !dominance && topShare - shareOf(second.value, total) < 5
  const runnerUp = closeBehind
    ? `${second.label} is close behind with ${read.exact(second.value)} (${secondPercent}).`
    : `${second.label} is next with ${read.exact(second.value)} (${secondPercent}).`
  const tail = rest.length
    ? rest.length === 1
      ? `${rest[0].label} makes up the remaining ${restPercent}.`
      : `The other ${formatChartNumber(rest.length)} ${pluralize(rest.length, entityNoun, entityNounPlural)} make up the remaining ${restPercent}.`
    : null

  return joinSentences([headline, dominance, runnerUp, tail, empty])
}

// ── Rankings ──────────────────────────────────────────────────────────────

/**
 * Reads a ranked bar chart of categories. Totals ('total') name the leader and
 * how much of the whole sits at the top; rates ('level') name the highest and
 * lowest without ever adding the rates together.
 */
export function describeRanking(points: readonly InterpretationPoint[], options: InterpretationOptions): string {
  if (!points.length) return options.emptyMessage || DEFAULT_EMPTY
  return options.measure === 'level' ? describeLevelRanking(points, options) : describeTotalRanking(points, options)
}

function describeTotalRanking(points: readonly InterpretationPoint[], options: InterpretationOptions): string {
  const { noun, entityNoun = 'entry', entityNounPlural } = options
  const read = readerFor(options)
  const entities = (count: number) => `${formatChartNumber(count)} ${pluralize(count, entityNoun, entityNounPlural)}`
  const ranked = [...points].sort((a, b) => b.value - a.value)
  const total = sumOf(ranked)
  const top = ranked[0]
  const bottom = ranked[ranked.length - 1]

  if (total <= 0) return `None of the ${entities(points.length)} recorded any ${noun} in the selected period.`
  if (ranked.length === 1) return `${top.label} is the only ${entityNoun}, with ${read.exact(top.value)} ${read.nounFor(top.value)}.`
  if (bottom.value === top.value) {
    return `All ${entities(ranked.length)} are level, with ${read.exact(top.value)} ${read.nounFor(top.value)} each.`
  }

  const leaders = pointsAt(ranked, top.value)
  let headline: string
  let gap: string | null = null
  if (leaders.length > 1) {
    const who = leaders.length <= 3 ? joinNames(leaders.map((point) => point.label)) : entities(leaders.length)
    headline = `${who} are tied for the most ${noun}, with ${read.exact(top.value)} each.`
  } else {
    headline = `${top.label} has the most ${noun}: ${read.exact(top.value)} out of ${read.exact(total)} (${formatShare(shareOf(top.value, total))}).`
    const second = ranked[1]
    if (second.value > 0 && top.value > second.value * 2) {
      gap = `That is more than twice as ${read.plural ? 'many' : 'much'} as ${second.label} (${read.exact(second.value)}), the next highest.`
    }
  }

  const leadingCount = Math.min(3, Math.max(1, Math.ceil(ranked.length / 3)))
  const concentration =
    ranked.length >= 4 && leadingCount >= 2
      ? `Together, the top ${formatChartNumber(leadingCount)} of the ${entities(ranked.length)} make up ${formatShare(
          shareOf(sumOf(ranked.slice(0, leadingCount)), total)
        )} of the total.`
      : null

  const lows = pointsAt(ranked, bottom.value)
  const trailing =
    bottom.value <= 0
      ? lows.length <= 3
        ? `${joinNames(lows.map((point) => point.label))} had none.`
        : `${entities(lows.length)} had none.`
      : lows.length === 1
        ? `${bottom.label} has the ${read.plural ? 'fewest' : 'least'}, with ${read.exact(bottom.value)}.`
        : null

  return joinSentences([headline, gap, concentration, trailing])
}

function describeLevelRanking(points: readonly InterpretationPoint[], options: InterpretationOptions): string {
  const { noun, entityNoun = 'entry', entityNounPlural } = options
  const read = readerFor(options)
  const entities = (count: number) => `${formatChartNumber(count)} ${pluralize(count, entityNoun, entityNounPlural)}`
  const values = points.map((point) => point.value)
  const highest = Math.max(...values)
  const lowest = Math.min(...values)

  if (points.length === 1) return `${points[0].label} is at ${read.exact(highest)} ${noun}.`
  if (highest === lowest) {
    const who = points.length === 2 ? `Both ${pluralize(2, entityNoun, entityNounPlural)}` : `All ${entities(points.length)}`
    return `${who} have the same ${noun}, ${read.exact(highest)}.`
  }

  const group = (value: number) => {
    const members = pointsAt(points, value)
    if (members.length === 1) return { who: members[0].label, single: true }
    if (members.length <= 3) return { who: joinNames(members.map((point) => point.label)), single: false }
    return { who: entities(members.length), single: false }
  }
  const high = group(highest)
  const low = group(lowest)
  const highText = high.single
    ? `${high.who} has the highest ${noun}, at ${read.exact(highest)}`
    : `${high.who} share the highest ${noun}, at ${read.exact(highest)}`
  const lowText = low.single
    ? `${low.who} has the lowest, at ${read.exact(lowest)}`
    : `${low.who} share the lowest, at ${read.exact(lowest)}`
  return `${highText}, and ${lowText}.`
}

// ── Comparisons ───────────────────────────────────────────────────────────

export type ComparisonSeries = {
  name: string
  points: readonly InterpretationPoint[]
}

export type ComparisonOptions = InterpretationOptions & {
  /**
   * 'change' reads the first series as the current period and the second as
   * the one before it ("up from 38 last week"); 'versus' reads two series side
   * by side ("Stock in is higher"). Defaults to 'versus'.
   */
  framing?: 'change' | 'versus'
}

/**
 * Reads two series drawn against the same x-axis: how they compare overall and
 * on how many of the shared periods each one came out ahead.
 */
export function describeComparison(first: ComparisonSeries, second: ComparisonSeries, options: ComparisonOptions): string {
  const { noun, periodNoun = 'day', framing = 'versus' } = options
  const read = readerFor(options)
  const firstTotal = sumOf(first.points)
  const secondTotal = sumOf(second.points)
  if (!first.points.length && !second.points.length) return options.emptyMessage || DEFAULT_EMPTY
  if (firstTotal === 0 && secondTotal === 0) {
    return framing === 'change'
      ? `There were no ${noun} ${lowerFirst(first.name)} or ${lowerFirst(second.name)}.`
      : `Neither ${first.name} nor ${second.name} recorded any ${noun}.`
  }

  const headline =
    framing === 'change'
      ? describeChange(first, second, firstTotal, secondTotal, options, read)
      : describeVersus(first, second, firstTotal, secondTotal, options, read)

  const paired = Math.min(first.points.length, second.points.length)
  let firstAhead = 0
  let secondAhead = 0
  for (let index = 0; index < paired; index += 1) {
    const a = first.points[index].value
    const b = second.points[index].value
    if (a > b) firstAhead += 1
    else if (b > a) secondAhead += 1
  }
  const level = paired - firstAhead - secondAhead
  const leaderIsFirst = firstAhead > secondAhead || (firstAhead === secondAhead && firstTotal >= secondTotal)
  const wins = leaderIsFirst ? firstAhead : secondAhead
  const periods = pluralize(paired, periodNoun)
  const prep = periodPreposition(periodNoun)
  const count =
    wins === paired
      ? paired === 2
        ? `${prep} both ${periods}`
        : `${prep} all ${formatChartNumber(paired)} ${periods}`
      : `${prep} ${formatChartNumber(wins)} of the ${formatChartNumber(paired)} ${periods}`
  const comparative = framing === 'change' && read.plural ? 'busier' : 'higher'
  const cadence =
    paired && wins > 0
      ? `${leaderIsFirst ? first.name : second.name} was ${comparative} ${count}${
          level > 0 ? `, and they tied ${prep} ${formatChartNumber(level)} ${pluralize(level, periodNoun)}` : ''
        }.`
      : null

  return joinSentences([headline, cadence])
}

function describeChange(
  current: ComparisonSeries,
  previous: ComparisonSeries,
  now: number,
  before: number,
  options: InterpretationOptions,
  read: Reader
): string {
  const previousName = lowerFirst(previous.name)
  if (before === 0) return `${current.name} had ${read.exact(now)} ${read.nounFor(now)}; ${previousName} had none.`
  if (now === 0) return `${current.name} has no ${options.noun} yet; ${previousName} had ${read.exact(before)}.`
  if (now === before) return `${current.name} had ${read.exact(now)} ${read.nounFor(now)}, the same as ${previousName}.`

  const rising = now > before
  const difference = Math.abs(now - before)
  const change = rising ? 'more' : read.plural ? 'fewer' : 'less'
  const ratio = now / before
  // A ratio is a plain multiplier, so it never goes through the caller's peso or percent formatter.
  const roundedRatio = roundTo(ratio, 1)
  const scale =
    rising && ratio >= 2
      ? `${roundedRatio === ratio ? '' : 'about '}${formatChartNumber(roundedRatio)} times as ${read.plural ? 'many' : 'much'}`
      : `or ${formatShare(shareOf(difference, before))} ${change}`
  return `${current.name} had ${read.exact(now)} ${read.nounFor(now)}, ${rising ? 'up' : 'down'} from ${read.exact(before)} ${previousName} (${read.exact(
    difference
  )} ${change}, ${scale}).`
}

function describeVersus(
  first: ComparisonSeries,
  second: ComparisonSeries,
  firstTotal: number,
  secondTotal: number,
  options: InterpretationOptions,
  read: Reader
): string {
  if (firstTotal === secondTotal) {
    return `${first.name} and ${second.name} are level, at ${read.exact(firstTotal)} ${options.noun} each.`
  }
  const [leader, trailer] = firstTotal > secondTotal ? [first, second] : [second, first]
  const leaderTotal = Math.max(firstTotal, secondTotal)
  const trailerTotal = Math.min(firstTotal, secondTotal)
  return trailerTotal === 0
    ? `${leader.name} is higher, with ${read.exact(leaderTotal)} ${read.nounFor(leaderTotal)}, and ${trailer.name} has none.`
    : `${leader.name} is higher, with ${read.exact(leaderTotal)} ${read.nounFor(leaderTotal)} against ${read.exact(trailerTotal)} for ${trailer.name}.`
}

/**
 * Reads a chart whose bars are split across several named series, by ranking
 * the series totals against each other. Silent when every series is empty,
 * because the trend reading beside it already says so.
 */
export function describeSeriesMix(series: readonly ComparisonSeries[], options: InterpretationOptions): string {
  const totals = series.map((entry) => ({ label: entry.name, value: sumOf(entry.points) }))
  if (sumOf(totals) <= 0) return ''
  const entityNoun = options.entityNoun || 'series'
  return `By ${entityNoun}, ${describeComposition(totals, { ...options, entityNoun })}`
}

// ── Capacity ──────────────────────────────────────────────────────────────

/**
 * Reads a used-versus-free capacity split, and says so when the space is
 * nearly gone, because that is the point at which someone has to act.
 */
export function describeCapacity(used: number, capacity: number, options: { emptyMessage?: string } = {}): string {
  if (!(capacity > 0)) return options.emptyMessage || DEFAULT_EMPTY
  const usedUnits = Math.max(0, used)
  if (usedUnits > capacity) {
    return `The warehouse is over capacity: it holds ${formatChartNumber(usedUnits)} units in space for ${formatChartNumber(capacity)}.`
  }
  if (usedUnits === capacity) {
    return `The warehouse is full: all ${formatChartNumber(capacity)} units of space are in use.`
  }
  const share = shareOf(usedUnits, capacity)
  // One decimal, like the "Used 87.6%" card printed beside this chart.
  const reading = `${formatChartNumber(usedUnits)} of the ${formatChartNumber(capacity)} units of space are in use (${formatChartNumber(
    Math.min(99.9, roundTo(share, 1))
  )}%), leaving ${formatChartNumber(capacity - usedUnits)} free.`
  return share >= 90 ? `${reading} The warehouse is almost full, so check space before taking in more stock.` : reading
}
