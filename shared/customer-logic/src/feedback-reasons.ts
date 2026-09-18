// Client feedback reason catalogs and their service-dimension map.
//
// The checkbox options were duplicated in the web rating dialog
// (src/components/portals/customer/sections/orders/rating-dialog.tsx) and the Expo
// customer app (mobile/customer-app/src/components/ui/rating-dialog.tsx), and the two
// copies had already drifted — the mobile lists are four options wide instead of five
// and word the same ideas differently. Both now import from here.
//
// Clients never type a dimension; they tick a phrase. Every phrase belongs to exactly
// one service dimension, so the admin feedback summary can report WHY a rating landed
// where it did instead of only reporting its average. The mapping has to be an explicit
// per-phrase table: the web delivery list is ordered
// [timeliness, accuracy, condition, driver, communication], the web replacement list is
// ordered differently (and differently again at 3 stars), and the mobile lists follow
// neither. Position carries no meaning across catalogs.

export type FeedbackServiceDimension =
  | 'timeliness'
  | 'accuracy'
  | 'condition'
  | 'driver'
  | 'communication'
  | 'overall'

export type FeedbackReasonCatalogKey =
  | 'web-delivery'
  | 'web-replacement'
  | 'mobile-delivery'
  | 'mobile-replacement'

// Canonical order — the admin breakdown renders these rows in this sequence.
export const FEEDBACK_SERVICE_DIMENSIONS: readonly FeedbackServiceDimension[] = [
  'timeliness',
  'accuracy',
  'condition',
  'driver',
  'communication',
  'overall',
]

export const FEEDBACK_DIMENSION_LABELS: Record<FeedbackServiceDimension, string> = {
  timeliness: 'Timeliness',
  accuracy: 'Order Accuracy',
  condition: 'Product Condition',
  driver: 'Driver Conduct',
  communication: 'Communication',
  overall: 'Overall Experience',
}

// ---------------------------------------------------------------------------
// The four catalogs, verbatim from the two rating dialogs.
// ---------------------------------------------------------------------------

// Each rating uses the same delivery dimensions so admin summaries remain comparable and actionable.
export const DELIVERY_FEEDBACK_OPTIONS_BY_RATING: Record<number, readonly string[]> = {
  1: ['Delivery was severely delayed', 'Order had missing or wrong items', 'Damaged cases or leaking bottles', 'Driver conduct was unprofessional', 'No clear delivery updates were provided'],
  2: ['Delivery was delayed', 'Order was incomplete or had quantity errors', 'Some products or packaging were damaged', 'Driver service needs improvement', 'Delivery updates were unclear'],
  3: ['Delivery timing was acceptable', 'Order was mostly complete and correct', 'Product condition was acceptable', 'Driver service was acceptable', 'Communication could improve'],
  4: ['Delivery was on time', 'Order was complete and accurate', 'Products arrived in good condition', 'Driver was courteous and professional', 'Communication was clear'],
  5: ['Delivery was on time as scheduled', 'Order was complete and exactly correct', 'Products and packaging were in excellent condition', 'Driver was highly professional', 'Communication was excellent'],
}

// Replacement choices focus on the resolution itself rather than repeating general delivery feedback.
export const REPLACEMENT_FEEDBACK_OPTIONS_BY_RATING: Record<number, readonly string[]> = {
  1: ['Issue was not resolved', 'Replacement was incomplete or incorrect', 'Replacement items arrived damaged', 'Redelivery was severely delayed', 'No clear updates were provided'],
  2: ['Issue was only partly resolved', 'Replacement quantity was incomplete', 'Replacement item condition was poor', 'Redelivery was delayed', 'Updates were unclear'],
  3: ['Issue was resolved', 'Handling time was acceptable', 'Replacement condition was acceptable', 'Updates could improve', 'Overall replacement service was acceptable'],
  4: ['Issue was fully resolved', 'Replacement was complete and correct', 'Replacement arrived in good condition', 'Redelivery was prompt', 'Updates were clear'],
  5: ['Issue was resolved efficiently', 'Replacement was complete and exactly correct', 'Replacement arrived in excellent condition', 'Resolution was very fast', 'Communication was excellent'],
}

// The Expo app's shorter sets. Note there is no timeliness phrase at any star here —
// see FEEDBACK_DIMENSIONS_MISSING_FROM_MOBILE_DELIVERY below.
export const MOBILE_DELIVERY_FEEDBACK_OPTIONS_BY_RATING: Record<number, readonly string[]> = {
  1: ['Missing items', 'Damaged unit', 'Wrong order', 'Poor driver attitude'],
  2: ['Packaging issue', 'Incomplete order', 'Hard to contact driver', 'Item condition problem'],
  3: ['Minor packaging issue', 'Communication could improve', 'Acceptable service', 'Minor inconvenience'],
  4: ['Friendly driver', 'Good unit', 'Accurate order', 'Smooth transaction'],
  5: ['Professional driver', 'Perfect packaging', 'Complete order', 'Great overall experience'],
}

export const MOBILE_REPLACEMENT_FEEDBACK_OPTIONS_BY_RATING: Record<number, readonly string[]> = {
  1: ['Issue was not resolved', 'Replacement arrived damaged', 'Very slow handling', 'Poor communication'],
  2: ['Resolution was incomplete', 'Redelivery was delayed', 'Updates were unclear', 'Replacement quality issue'],
  3: ['Issue was resolved', 'Handling time was acceptable', 'Updates could improve', 'Replacement was acceptable'],
  4: ['Fast replacement handling', 'Good replacement condition', 'Clear status updates', 'Smooth redelivery'],
  5: ['Excellent replacement service', 'Perfect replacement condition', 'Very fast resolution', 'Excellent communication'],
}

export const FEEDBACK_REASON_CATALOGS: Record<FeedbackReasonCatalogKey, Record<number, readonly string[]>> = {
  'web-delivery': DELIVERY_FEEDBACK_OPTIONS_BY_RATING,
  'web-replacement': REPLACEMENT_FEEDBACK_OPTIONS_BY_RATING,
  'mobile-delivery': MOBILE_DELIVERY_FEEDBACK_OPTIONS_BY_RATING,
  'mobile-replacement': MOBILE_REPLACEMENT_FEEDBACK_OPTIONS_BY_RATING,
}

// ---------------------------------------------------------------------------
// Phrase -> dimension. One entry per distinct phrase across all four catalogs.
// ---------------------------------------------------------------------------

// Holistic phrases that deliberately map to 'overall'. Kept as an explicit set so the
// drift guard can allow these and still fail any NEW phrase that falls through.
export const FEEDBACK_OVERALL_REASONS: readonly string[] = [
  'Overall replacement service was acceptable',
  'Acceptable service',
  'Minor inconvenience',
  'Smooth transaction',
  'Great overall experience',
  'Replacement was acceptable',
  'Excellent replacement service',
]

const REASON_DIMENSION_SOURCE: ReadonlyArray<readonly [FeedbackServiceDimension, readonly string[]]> = [
  ['timeliness', [
    'Delivery was severely delayed',
    'Delivery was delayed',
    'Delivery timing was acceptable',
    'Delivery was on time',
    'Delivery was on time as scheduled',
    'Redelivery was severely delayed',
    'Redelivery was delayed',
    'Redelivery was prompt',
    'Handling time was acceptable',
    'Resolution was very fast',
    'Very slow handling',
    'Fast replacement handling',
    'Smooth redelivery',
    'Very fast resolution',
  ]],
  ['accuracy', [
    'Order had missing or wrong items',
    'Order was incomplete or had quantity errors',
    'Order was mostly complete and correct',
    'Order was complete and accurate',
    'Order was complete and exactly correct',
    // Replacement "resolution" phrases fold in here: the corrective action is the same
    // question — did we deliver what was owed?
    'Issue was not resolved',
    'Issue was only partly resolved',
    'Issue was resolved',
    'Issue was fully resolved',
    'Issue was resolved efficiently',
    'Replacement was incomplete or incorrect',
    'Replacement quantity was incomplete',
    'Replacement was complete and correct',
    'Replacement was complete and exactly correct',
    'Resolution was incomplete',
    'Missing items',
    'Wrong order',
    'Incomplete order',
    'Accurate order',
    'Complete order',
  ]],
  ['condition', [
    'Damaged cases or leaking bottles',
    'Some products or packaging were damaged',
    'Product condition was acceptable',
    'Products arrived in good condition',
    'Products and packaging were in excellent condition',
    'Replacement items arrived damaged',
    'Replacement item condition was poor',
    'Replacement condition was acceptable',
    'Replacement arrived in good condition',
    'Replacement arrived in excellent condition',
    'Replacement arrived damaged',
    'Replacement quality issue',
    'Good replacement condition',
    'Perfect replacement condition',
    'Damaged unit',
    'Packaging issue',
    'Item condition problem',
    'Minor packaging issue',
    'Good unit',
    'Perfect packaging',
  ]],
  ['driver', [
    'Driver conduct was unprofessional',
    'Driver service needs improvement',
    'Driver service was acceptable',
    'Driver was courteous and professional',
    'Driver was highly professional',
    'Poor driver attitude',
    'Friendly driver',
    'Professional driver',
  ]],
  ['communication', [
    'No clear delivery updates were provided',
    'Delivery updates were unclear',
    'Communication could improve',
    'Communication was clear',
    'Communication was excellent',
    'No clear updates were provided',
    'Updates were unclear',
    'Updates could improve',
    'Updates were clear',
    'Hard to contact driver',
    'Poor communication',
    'Clear status updates',
    'Excellent communication',
  ]],
  ['overall', FEEDBACK_OVERALL_REASONS],
]

export type FeedbackReasonEntry = {
  /** Canonical display text, so the leaderboard shows one spelling. */
  reason: string
  dimension: FeedbackServiceDimension
  /** 1..5 — the star this phrase sits under in its catalog. */
  catalogRating: number
  catalogs: readonly FeedbackReasonCatalogKey[]
}

/** Strip a leading bullet marker, collapse internal whitespace, trim. */
export function normalizeFeedbackReasonText(value: unknown): string {
  return String(value ?? '')
    .replace(/^\s*[-•*•]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const reasonKey = (value: unknown) => normalizeFeedbackReasonText(value).toLowerCase()

const DIMENSION_BY_REASON_KEY: ReadonlyMap<string, FeedbackServiceDimension> = (() => {
  const map = new Map<string, FeedbackServiceDimension>()
  for (const [dimension, reasons] of REASON_DIMENSION_SOURCE) {
    for (const reason of reasons) map.set(reasonKey(reason), dimension)
  }
  return map
})()

// Built by walking the catalogs so the entry list can never claim a phrase the clients
// do not actually offer. A catalog phrase with no dimension mapping is simply absent
// here, which is what the drift-guard test detects.
export const FEEDBACK_REASON_ENTRIES: readonly FeedbackReasonEntry[] = (() => {
  const byKey = new Map<string, { reason: string; dimension: FeedbackServiceDimension; catalogRating: number; catalogs: FeedbackReasonCatalogKey[] }>()
  for (const catalogKey of Object.keys(FEEDBACK_REASON_CATALOGS) as FeedbackReasonCatalogKey[]) {
    const catalog = FEEDBACK_REASON_CATALOGS[catalogKey]
    for (const ratingKey of Object.keys(catalog)) {
      const rating = Number(ratingKey)
      for (const reason of catalog[rating] || []) {
        const key = reasonKey(reason)
        const dimension = DIMENSION_BY_REASON_KEY.get(key)
        if (!dimension) continue
        const existing = byKey.get(key)
        if (existing) {
          if (!existing.catalogs.includes(catalogKey)) existing.catalogs.push(catalogKey)
          continue
        }
        byKey.set(key, {
          reason: normalizeFeedbackReasonText(reason),
          dimension,
          catalogRating: rating,
          catalogs: [catalogKey],
        })
      }
    }
  }
  return Array.from(byKey.values())
})()

const ENTRY_BY_REASON_KEY: ReadonlyMap<string, FeedbackReasonEntry> = new Map(
  FEEDBACK_REASON_ENTRIES.map((entry) => [reasonKey(entry.reason), entry])
)

export function lookupFeedbackReason(reason: unknown): FeedbackReasonEntry | null {
  return ENTRY_BY_REASON_KEY.get(reasonKey(reason)) || null
}

// What a client types is matched against a weighted lexicon rather than the first
// regex that happens to fire, because one sentence often covers two dimensions
// ("the driver was late and rude"). Weight 2 marks a word that only belongs to that
// dimension; weight 1 marks a supporting word that could plausibly appear elsewhere.
//
// Clients in Negros Occidental write in English, Tagalog and Hiligaynon, often mixed in
// one sentence, so each dimension carries all three. Patterns use word boundaries on
// short words on purpose - a bare /late/ would match "chocolate".
//
// Polarity is NOT read from this text; it comes from the star rating, so the lexicon
// deliberately does not try to handle negation ("not damaged" still scores condition,
// which is correct - the review IS about condition).
type FeedbackLexiconEntry = readonly [RegExp, number]

const DIMENSION_LEXICON: Record<FeedbackServiceDimension, readonly FeedbackLexiconEntry[]> = {
  timeliness: [
    // English
    [/\blate\b|\blatee?d\b/i, 2],
    [/delay/i, 2],
    [/\boverdue\b/i, 2],
    [/behind schedule|not on schedule/i, 2],
    [/took (so |too )?long|took forever|ang tagal|sobrang tagal/i, 2],
    [/resched|re-?schedule/i, 2],
    [/\bon ?time\b/i, 1],
    [/\bslow\b|\bslowly\b/i, 1],
    [/\bwait(ed|ing)?\b/i, 1],
    [/\bprompt\b|\bpromptly\b/i, 1],
    [/\bearly\b|\bearlier\b/i, 1],
    [/\bhours?\b|\bminutes?\b/i, 1],
    // Tagalog / Filipino
    [/\btagal\b|matagal|napakatagal/i, 2],
    [/\bhuli\b|nahuli|pagkahuli|nagpahuli/i, 2],
    [/\bbagal\b|mabagal/i, 2],
    [/antala|naantala/i, 2],
    [/\bhintay\b|naghintay|hinintay|paghihintay/i, 2],
    [/\bmaaga\b|\bagad\b/i, 1],
    [/sakto sa oras|\boras\b/i, 1],
    // Hiligaynon / Cebuano
    [/\bdugay\b|madugay|nadugay|kadugay/i, 2],
    [/\bulihi\b|naulihi|pagkaulihi/i, 2],
    [/\bhinay\b|mahinay/i, 1],
    [/\bdasig\b|madasig/i, 1],
  ],
  accuracy: [
    // English
    [/\bmissing\b/i, 2],
    [/\bwrong\b/i, 2],
    [/incorrect/i, 2],
    [/incomplete|not complete|isn'?t complete/i, 2],
    [/\blacking\b|\blacked\b/i, 2],
    [/short[- ]?deliver|short[- ]?ship/i, 2],
    [/substitut/i, 2],
    [/mismatch/i, 2],
    [/different (item|product|brand|order|size)/i, 2],
    [/\bshortage\b/i, 1],
    [/\bquantity\b|\bqty\b|\bcount\b/i, 1],
    // Tagalog / Filipino
    [/\bkulang\b|nakulangan|kinulang/i, 2],
    [/\bmali\b|maling|namali|nagkamali/i, 2],
    [/hindi tama|di tama|indi tama/i, 2],
    [/hindi kumpleto|di kumpleto|kulang ang/i, 2],
    [/nawawala|\bnawala\b/i, 2],
    [/\bwala\b|\bwalang\b/i, 1],
    [/\biba\b|\bibang\b|napalitan|\bpalit\b/i, 1],
    [/\bsobra\b|sumobra/i, 1],
    // Hiligaynon / Cebuano
    [/\bsayop\b|nagsayop|kasayop/i, 2],
    [/indi kompleto|indi kumpleto/i, 2],
    [/\bsala\b|nagsala/i, 1],
    [/\blain\b/i, 1],
  ],
  condition: [
    // English
    [/damag/i, 2],
    [/\bbroke(n)?\b/i, 2],
    [/crack/i, 2],
    [/\bleak/i, 2],
    [/\bspill/i, 2],
    [/\bdent/i, 2],
    [/\btorn\b|\btear\b|\bripped\b/i, 2],
    [/spoil|\brotten\b|\bstale\b/i, 2],
    [/expir/i, 2],
    [/packag/i, 2],
    [/\bdirty\b|\bfilthy\b|\bmuddy\b/i, 2],
    [/\bmelted\b|\bbulging\b|\bswollen\b/i, 2],
    [/\bcondition\b|\bquality\b/i, 1],
    [/\bseal(ed|ing)?\b/i, 1],
    [/\bwet\b|\bflat\b|\bwarm\b/i, 1],
    // Tagalog / Filipino
    [/\bsira\b|sirang|nasira|sira-sira/i, 2],
    [/\bbasag\b|basang|nabasag/i, 2],
    [/tumagas|\btagas\b|tumutulo|tumulo/i, 2],
    [/\bbutas\b|butas-butas/i, 2],
    [/\blukot\b|lukot-lukot/i, 2],
    [/marumi|madumi/i, 2],
    [/\bpanis\b|napanis|\bamoy\b/i, 2],
    [/\byupi\b|nayupi|\bgusot\b/i, 2],
    [/\bbasa\b|\bluma\b|\bmainit\b/i, 1],
    // Hiligaynon / Cebuano
    [/\bguba\b|naguba|guba-guba/i, 2],
    [/\bbuak\b|nabuak|buka/i, 2],
    [/nagtulo|\btulo\b/i, 2],
    [/mahigko|\bhigko\b/i, 2],
    [/pan-?os|napan-?os/i, 2],
  ],
  driver: [
    // English
    [/\bdrivers?\b/i, 2],
    [/\briders?\b/i, 2],
    [/courier/i, 2],
    [/delivery ?man|deliveryman|delivery ?guy/i, 2],
    [/\brude\b|\brudely\b/i, 2],
    [/impolite|disrespect|discourteous/i, 2],
    [/\battitude\b/i, 2],
    [/shout|yell|scream/i, 2],
    [/arrogant|\bsnob\b/i, 2],
    [/curs(e|ed|ing)\b|swear|swore|swearing/i, 2],
    [/unprofessional/i, 2],
    [/\bprofessional\b|courteous|\bpolite\b|friendly|helpful|accommodating/i, 1],
    [/\bcrew\b|\bhelper\b|\bstaff\b|\bpersonnel\b/i, 1],
    [/\bconduct\b|\bbehaviou?r\b/i, 1],
    // Tagalog / Filipino
    [/\btsuper\b|\bdrayber\b/i, 2],
    [/\bbastos\b|bastusan|kabastusan/i, 2],
    [/walang modo|walang galang|wala galang|walang respeto/i, 2],
    [/\bsungit\b|masungit/i, 2],
    [/\bsigaw\b|sumigaw|nagsigaw|sinigawan/i, 2],
    [/\bpabaya\b|pabayaan/i, 2],
    [/nagmumura|nagmura/i, 2],
    [/\bmabait\b|magalang|\bugali\b/i, 1],
    // Hiligaynon / Cebuano
    [/nagsinggit|\bsinggit\b/i, 2],
    [/\bbuotan\b|maayo nga tawo/i, 1],
    [/\bmasuko\b|nagsuko/i, 1],
  ],
  communication: [
    // English
    [/\bupdates?\b|updated|no update/i, 2],
    [/notif/i, 2],
    [/\bcontact(ed|ing)?\b|unreachable|can'?t be reached|cannot be reached/i, 2],
    [/no (answer|reply|response)|never (called|replied|answered)/i, 2],
    [/communicat/i, 2],
    [/coordinat/i, 2],
    [/follow ?up/i, 2],
    [/\breply\b|\breplied\b|\bresponse\b|responsive/i, 1],
    [/inform(ed|ation)?\b|\badvise[d]?\b|\bnotice\b/i, 1],
    [/\bcall(ed|ing)?\b|\btext(ed|ing)?\b|\bmessage[ds]?\b/i, 1],
    // Tagalog / Filipino
    [/hindi sumagot|di sumagot|walang sagot|walang sumasagot/i, 2],
    [/hindi nagpaalam|walang paalam|hindi nagsabi|walang nagsabi/i, 2],
    [/walang abiso|\babiso\b/i, 2],
    [/hindi nag-?update|walang update/i, 2],
    [/\btawag\b|tumawag|tinawagan|\bmensahe\b/i, 1],
    // Hiligaynon / Cebuano
    [/wala nagsabat|\bsabat\b|wala gasabat/i, 2],
    [/wala gin ?pahibalo|\bpahibalo\b|wala gin ?sugid/i, 2],
  ],
  // The catch-all has no vocabulary of its own; it is where text lands when nothing
  // else scores.
  overall: [],
}

export type FeedbackDimensionScore = {
  dimension: FeedbackServiceDimension
  score: number
  /** The words that fired, so a reviewer can see why a sentence was classified. */
  matches: string[]
}

/** Score every dimension the text touches, strongest first. */
export function scoreFeedbackDimensions(reason: unknown): FeedbackDimensionScore[] {
  const text = normalizeFeedbackReasonText(reason)
  if (!text) return []

  const scored: FeedbackDimensionScore[] = []
  for (const dimension of FEEDBACK_SERVICE_DIMENSIONS) {
    const lexicon = DIMENSION_LEXICON[dimension]
    if (!lexicon.length) continue
    let score = 0
    const matches: string[] = []
    for (const [pattern, weight] of lexicon) {
      const found = text.match(pattern)
      if (!found) continue
      score += weight
      matches.push(found[0].toLowerCase())
    }
    if (score > 0) scored.push({ dimension, score, matches })
  }

  return scored.sort((a, b) =>
    (b.score - a.score)
    || (FEEDBACK_SERVICE_DIMENSIONS.indexOf(a.dimension) - FEEDBACK_SERVICE_DIMENSIONS.indexOf(b.dimension))
  )
}

export function inferFeedbackDimension(reason: unknown): FeedbackServiceDimension {
  const entry = lookupFeedbackReason(reason)
  if (entry) return entry.dimension
  return scoreFeedbackDimensions(reason)[0]?.dimension || 'overall'
}

/**
 * Every dimension the text genuinely covers, primary first. A sentence scoring far
 * below the winner is dropped: one weak supporting word should not drag a whole
 * dimension into the breakdown when another is clearly the subject.
 */
export function inferFeedbackDimensions(
  reason: unknown,
  options: { limit?: number } = {},
): FeedbackServiceDimension[] {
  const entry = lookupFeedbackReason(reason)
  if (entry) return [entry.dimension]

  const scored = scoreFeedbackDimensions(reason)
  if (!scored.length) return ['overall']

  const threshold = scored[0].score / 2
  return scored
    .filter((row) => row.score >= threshold)
    .slice(0, options.limit ?? 3)
    .map((row) => row.dimension)
}

// Documents a real gap rather than hiding it: a delivery review submitted from the Expo
// app can never produce a timeliness signal, because no mobile delivery option mentions
// timing. The admin breakdown must therefore show a zero-mention dimension as "no data",
// never as a full-width positive bar.
export const FEEDBACK_DIMENSIONS_MISSING_FROM_MOBILE_DELIVERY: readonly FeedbackServiceDimension[] = ['timeliness']

// ---------------------------------------------------------------------------
// The "Other" escape hatch.
//
// Clients pick a canned phrase or they describe the problem themselves - never both,
// because a review that says "Other" alongside four preset phrases cannot be attributed
// to anything. What they type is classified by the keyword fallback above, so free text
// still lands in a service dimension instead of dropping out of the analytics.
// ---------------------------------------------------------------------------

export const OTHER_FEEDBACK_REASON = 'Other (please describe)'

/** Stored prefix that marks a reason as the client's own words rather than a catalog pick. */
export const OTHER_REASON_PREFIX = 'Other: '

const NEWLINE = String.fromCharCode(10)

export const OTHER_REASON_MAX_LENGTH = 1000
export const OTHER_REASON_LABEL = 'Tell us what happened'
export const OTHER_REASON_PLACEHOLDER = 'Describe the issue in your own words...'

/** The options for a rating, with the Other escape hatch always last. */
export function getFeedbackOptionsForRating(
  catalog: Record<number, readonly string[]>,
  rating: unknown,
): string[] {
  const star = Math.max(1, Math.min(5, Math.round(Number(rating) || 0)))
  return [...(catalog[star] || []), OTHER_FEEDBACK_REASON]
}

export function isOtherFeedbackReason(reason: unknown): boolean {
  return normalizeFeedbackReasonText(reason) === OTHER_FEEDBACK_REASON
}

/** Strip the stored marker so the client's actual words get classified, not the label. */
export function stripOtherReasonPrefix(reason: unknown): string {
  const text = normalizeFeedbackReasonText(reason)
  return text.toLowerCase().startsWith(OTHER_REASON_PREFIX.toLowerCase())
    ? text.slice(OTHER_REASON_PREFIX.length).trim()
    : text
}

/**
 * Compose the stored `message`. Mirrors buildOrderActionReason in order-reasons.ts:
 * one place decides the wire format so the web and Expo dialogs cannot diverge.
 */
export function buildFeedbackReasonMessage(selectedReasons: string[], otherText: string): string {
  const picked = selectedReasons
    .map((reason) => normalizeFeedbackReasonText(reason))
    .filter(Boolean)

  if (picked.some(isOtherFeedbackReason)) {
    const described = String(otherText || '').trim()
    return described ? `- ${OTHER_REASON_PREFIX}${described}` : ''
  }

  return Array.from(new Set(picked)).map((reason) => `- ${reason}`).join(NEWLINE)
}
