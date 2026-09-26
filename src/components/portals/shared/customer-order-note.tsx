import { StickyNote } from 'lucide-react'
import { getCustomerOrderNote } from '@/lib/purchase-documents'

/**
 * The note a customer typed at checkout. Staff approve requests straight from the
 * table rows, so the note is shown there as well as in View Details.
 */
export function CustomerOrderNotePreview({ order }: { order: any }) {
  const note = getCustomerOrderNote(order)
  if (!note) return null
  return (
    <p className="mt-1 flex items-start gap-1 text-xs text-amber-800" title={note}>
      <StickyNote className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span className="line-clamp-2 whitespace-pre-wrap break-words">
        <span className="font-semibold">Note: </span>
        {note}
      </span>
    </p>
  )
}

export function CustomerOrderNoteCard({ order }: { order: any }) {
  const note = getCustomerOrderNote(order)
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <p className="mb-3 flex items-center gap-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-50 text-amber-600">
          <StickyNote className="h-5 w-5" />
        </span>
        Customer Notes
      </p>
      {note ? (
        <p className="whitespace-pre-wrap break-words text-sm text-slate-700 sm:text-base">{note}</p>
      ) : (
        <p className="text-sm italic text-slate-500 sm:text-base">No notes from the customer.</p>
      )}
    </div>
  )
}
