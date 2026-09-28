/**
 * Table row actions, shared by every portal table.
 *
 * Actions cells had drifted into eight looks: icon-only ghost buttons, solid violet
 * and amber, sky-tinted text, a solid red Delete, and outlines at three heights.
 * Every row action is now `size="sm"` with a leading `size-3.5` icon (swapped for
 * the spinner while it runs) and a text label, and takes one of four tones so its
 * weight tracks what the click commits you to.
 *
 * These began as the replacement queue's decision buttons, where "Approve" and
 * "Under Review" were both solid saturated buttons of equal weight, though one
 * settles a claim and the other only moves it onto the next desk.
 */
/** Settles a decision in the requester's favour: Approve. */
export const ACTION_DECIDE =
  'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-700 motion-reduce:transition-none'
/** Moves the record to its next stage: start review or processing, schedule, reschedule, assign. */
export const ACTION_ADVANCE =
  'bg-[#0e5aa8] text-white hover:bg-[#0d4f92] focus-visible:ring-[#0f3d72] motion-reduce:transition-none'
/** Refuses, cancels or removes. Outlined, because it is the destructive half of a decision. */
export const ACTION_REFUSE =
  'border-rose-300 bg-white text-rose-700 hover:bg-rose-50 hover:text-rose-800 focus-visible:ring-rose-600 motion-reduce:transition-none'
/** Opens, edits or prints. Quietest: it commits to nothing on its own. */
export const ACTION_INSPECT =
  'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus-visible:ring-slate-500 motion-reduce:transition-none'
