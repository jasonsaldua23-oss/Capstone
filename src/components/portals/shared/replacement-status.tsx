import { Badge } from '@/components/ui/badge'

/**
 * Shared vocabulary for replacement claims.
 *
 * Admin and warehouse each render the same claim queue, and each had its own copy
 * of the status badge and the decision buttons. Both copies tinted the badge with
 * a single test -- `Needs Follow-up` red, *everything else* emerald -- so a
 * rejected claim and a completed claim looked identical, and a cancelled one
 * looked like a success. The tones below say what the state actually means.
 */

/** What a state tells the staff member looking at the queue. */
type StatusTone =
  | 'filed' // just arrived, nobody has looked at it
  | 'review' // being adjudicated right now
  | 'advancing' // decided in the customer's favour, work still to do
  | 'settled' // finished, nothing owed
  | 'refused' // decided against the customer, terminal
  | 'attention' // finished on paper but quantities are still outstanding
  | 'closed' // withdrawn or failed; terminal but nobody's fault

const TONE_CLASSES: Record<StatusTone, string> = {
  filed: 'border-slate-200 bg-slate-100 text-slate-700',
  review: 'border-amber-200 bg-amber-50 text-amber-800',
  advancing: 'border-sky-200 bg-sky-50 text-sky-800',
  settled: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  refused: 'border-rose-200 bg-rose-50 text-rose-800',
  attention: 'border-orange-300 bg-orange-100 text-orange-900',
  // Recessed rather than tinted: a withdrawn claim should read as inactive, not
  // as another colour competing with the live ones.
  closed: 'border-slate-300 bg-white text-slate-500',
}

/**
 * Keyed by the labels `formatIssueStatus` produces in both views. An unmapped
 * label falls back to `filed` rather than to a colour that would imply a
 * decision nobody made.
 */
const STATUS_TONES: Record<string, StatusTone> = {
  Reported: 'filed',
  Pending: 'filed',
  'Under Review': 'review',
  Approved: 'advancing',
  Processing: 'advancing',
  'In Progress': 'advancing',
  'Scheduled for Delivery': 'advancing',
  Completed: 'settled',
  Rejected: 'refused',
  'Needs Follow-up': 'attention',
  Cancelled: 'closed',
}

export function replacementStatusClasses(statusLabel: string): string {
  return TONE_CLASSES[STATUS_TONES[statusLabel] ?? 'filed']
}

export function ReplacementStatusBadge({
  statusLabel,
  className = '',
}: {
  statusLabel: string
  className?: string
}) {
  return (
    <Badge className={`${replacementStatusClasses(statusLabel)} ${className}`}>
      {statusLabel}
    </Badge>
  )
}

/**
 * Decision actions, so weight tracks what the click commits you to.
 *
 * Before this, "Approve" and "Under Review" were both solid saturated buttons of
 * equal weight, though one settles a claim and the other only moves it onto the
 * next desk. Four classes, each meaning one thing:
 */
/** Settles the claim in the customer's favour. Used only for Approve. */
export const ACTION_DECIDE =
  'h-9 bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-700 motion-reduce:transition-none'
/** Moves the claim to the next stage: start review, start processing, schedule. */
export const ACTION_ADVANCE =
  'h-9 bg-[#0e5aa8] text-white hover:bg-[#0d4f92] focus-visible:ring-[#0f3d72] motion-reduce:transition-none'
/** Refuses the claim. Outlined, because it is the destructive half of a decision. */
export const ACTION_REFUSE =
  'h-9 border-rose-300 bg-white text-rose-700 hover:bg-rose-50 hover:text-rose-800 focus-visible:ring-rose-600 motion-reduce:transition-none'
/** Opens the dossier. Quietest: it commits to nothing. */
export const ACTION_INSPECT =
  'h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-500 motion-reduce:transition-none'

/**
 * The head of a claim's dossier.
 *
 * Both views used to open with the same ten identical `bg-slate-50` boxes, which
 * gave "Replacement #" the same weight as "Decision Remarks" and buried the two
 * things staff actually open the dialog for: what state the claim is in and how
 * much money is attached. Here the claim identifies itself once, the state and the
 * amount are stated plainly, the reference fields go quiet, and the customer's
 * own words are set as the testimony they are.
 */
export function ReplacementDossierHeader({
  replacementNumber,
  statusLabel,
  contextLine,
  lossDisplay,
  reference,
  customerAccount,
}: {
  replacementNumber: string
  statusLabel: string
  contextLine: string
  lossDisplay?: string | null
  reference: Array<[string, string]>
  customerAccount?: string | null
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-lg font-bold tracking-[-0.01em] text-slate-900">{replacementNumber}</p>
            {contextLine ? <p className="mt-0.5 text-xs text-slate-500">{contextLine}</p> : null}
          </div>
          <ReplacementStatusBadge statusLabel={statusLabel} className="mt-0.5" />
        </div>

        {lossDisplay ? (
          <div className="mt-3 flex items-baseline justify-between border-t border-slate-200 pt-3">
            <p className="text-xs font-medium text-slate-500">Total loss</p>
            <p className="text-base font-bold tabular-nums text-rose-700">{lossDisplay}</p>
          </div>
        ) : null}
      </div>

      {reference.length ? (
        // A definition list, not a grid of boxes: these are reference values, and
        // they should not each look like a headline.
        <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {reference.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs font-medium text-slate-500">{label}</dt>
              <dd className="mt-0.5 break-words text-sm font-medium leading-5 text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {customerAccount ? (
        <figure className="border-l-2 border-slate-300 pl-3">
          <figcaption className="text-xs font-medium text-slate-500">Customer&rsquo;s account</figcaption>
          <blockquote className="mt-1 whitespace-pre-line break-words text-sm leading-6 text-slate-700">
            {customerAccount}
          </blockquote>
        </figure>
      ) : null}
    </div>
  )
}
