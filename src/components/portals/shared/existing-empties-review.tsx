'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { Check, ClipboardCheck, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { ACTION_DECIDE, ACTION_INSPECT, ACTION_REFUSE } from '@/components/portals/shared/row-actions'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { emitDataSync } from '@/lib/data-sync'

type DeclarationStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/** One product line; the server stores each product separately. */
interface ExistingEmptiesDeclaration {
  id: string
  /** Products declared in one submission share this id. */
  submissionId?: string
  customerId: string
  customerName: string
  productId: string
  productName: string
  /** Name plus size, e.g. "Pepsi - 1 Liter". */
  productLabel?: string
  cases: number
  bottles: number
  containersPerCase: number
  status: DeclarationStatus
  notes: string | null
  evidencePhotoUrl: string | null
  reviewNotes: string | null
  createdAt: string
  reviewedAt: string | null
  reviewedBy: string | null
}

/** What the customer submitted at once: one declaration, reviewed as a unit. */
interface Submission {
  id: string
  customerName: string
  createdAt: string
  status: DeclarationStatus | 'MIXED'
  products: ExistingEmptiesDeclaration[]
  notes: string | null
  reviewNotes: string | null
  reviewedAt: string | null
  reviewedBy: string | null
}

function groupSubmissions(rows: ExistingEmptiesDeclaration[]): Submission[] {
  const groups = new Map<string, ExistingEmptiesDeclaration[]>()
  for (const row of rows) {
    const key = row.submissionId || row.id
    groups.set(key, [...(groups.get(key) || []), row])
  }
  return Array.from(groups, ([id, group]) => {
    // Newest submissions first, but products in the order the customer added them.
    const products = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    const statuses = new Set(products.map((row) => row.status))
    const reviewed = products.find((row) => row.reviewedAt)
    return {
      id,
      customerName: products[0].customerName,
      createdAt: products[0].createdAt,
      status: statuses.has('PENDING') ? 'PENDING' : statuses.size === 1 ? products[0].status : 'MIXED',
      products,
      notes: products.find((row) => row.notes)?.notes || null,
      reviewNotes: products.find((row) => row.reviewNotes)?.reviewNotes || null,
      reviewedAt: reviewed?.reviewedAt || null,
      reviewedBy: reviewed?.reviewedBy || null,
    }
  })
}

const STATUS_BADGE: Record<Submission['status'], { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  APPROVED: { label: 'Approved', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  REJECTED: { label: 'Rejected', className: 'border-red-200 bg-red-50 text-red-700' },
  MIXED: { label: 'Partly approved', className: 'border-slate-200 bg-slate-50 text-slate-700' },
}

// Added: one review flow keeps admin and warehouse decisions consistent.
export function ExistingEmptiesReview({ openRequest, onOpenRequestHandled }: {
  /** Changes when a staff notification about a declaration is opened; the dialog opens for it. */
  openRequest?: number
  /** Called once the dialog has opened for `openRequest`, so the parent can drop it. */
  onOpenRequestHandled?: () => void
} = {}) {
  const [open, setOpen] = useState(false)
  const [handledOpenRequest, setHandledOpenRequest] = useState<number | undefined>(undefined)
  if (openRequest && openRequest !== handledOpenRequest) {
    setHandledOpenRequest(openRequest)
    setOpen(true)
  }
  const [declarations, setDeclarations] = useState<ExistingEmptiesDeclaration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // The declaration whose rejection is being confirmed, and the reason the customer will see.
  const [rejecting, setRejecting] = useState<Submission | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState('')
  // Which declaration and decision are being saved, so only that button swaps its icon for the spinner.
  const [savingReview, setSavingReview] = useState<{ id: string; decision: 'APPROVED' | 'REJECTED' } | null>(null)
  const saving = savingReview !== null
  const formId = useId()

  const loadDeclarations = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/staff/empty-bottles/opening', { cache: 'no-store', signal })
      const payload = await response.json()
      if (!response.ok || payload.success !== true || !Array.isArray(payload.declarations)) {
        throw new Error(payload.error || 'Unable to load existing empties declarations.')
      }
      if (!signal?.aborted) setDeclarations(payload.declarations)
    } catch (requestError) {
      if (!signal?.aborted) setError(requestError instanceof Error ? requestError.message : 'Unable to load existing empties declarations.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void loadDeclarations(controller.signal)
    return () => controller.abort()
  }, [open, loadDeclarations])

  // A request left in the parent would reopen the dialog every time this view mounts again.
  useEffect(() => {
    if (open && openRequest) onOpenRequestHandled?.()
  }, [open, openRequest, onOpenRequestHandled])

  /** Approve or reject every product in one declaration. Returns whether it saved. */
  const reviewSubmission = async (id: string, decision: 'APPROVED' | 'REJECTED', reason = '') => {
    if (saving) return false
    setSavingReview({ id, decision })
    setError('')
    try {
      const response = await fetch(`/api/staff/empty-bottles/opening/submissions/${encodeURIComponent(id)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reviewNotes: reason }),
      })
      const payload = await response.json()
      if (!response.ok || payload.success !== true || !Array.isArray(payload.declarations)) {
        throw new Error(payload.error || 'Unable to review this declaration.')
      }
      const updated = new Map<string, ExistingEmptiesDeclaration>(payload.declarations.map((row: ExistingEmptiesDeclaration) => [row.id, row]))
      setDeclarations((current) => current.map((row) => updated.get(row.id) || row))
      emitDataSync(['customers'])
      toast.success(decision === 'APPROVED' ? 'Existing empties approved for exchange' : 'Existing empties declaration rejected')
      return true
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to review this declaration.'
      if (decision === 'REJECTED') setRejectError(message)
      else setError(message)
      return false
    } finally {
      setSavingReview(null)
    }
  }

  const startReject = (submission: Submission) => {
    setRejecting(submission)
    setRejectReason('')
    setRejectError('')
  }

  const confirmReject = async () => {
    if (!rejecting) return
    // The reason is shown to the customer so they know what to correct.
    if (!rejectReason.trim()) {
      setRejectError('Enter a reason so the customer knows what to correct.')
      return
    }
    if (await reviewSubmission(rejecting.id, 'REJECTED', rejectReason.trim())) setRejecting(null)
  }

  const submissions = groupSubmissions(declarations)
  const pending = submissions.filter((submission) => submission.status === 'PENDING')
  const history = submissions.filter((submission) => submission.status !== 'PENDING')
  const formatDate = (value: string) => new Date(value).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  // Same wording as the customer's own card: "2 cases + 5 bottles", never "0 full cases".
  const formatQuantity = (row: ExistingEmptiesDeclaration) => [
    row.cases > 0 ? `${row.cases.toLocaleString()} case${row.cases === 1 ? '' : 's'}` : '',
    row.bottles > 0 ? `${row.bottles.toLocaleString()} bottle${row.bottles === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' + ')

  const renderSubmission = (submission: Submission) => {
    const badge = STATUS_BADGE[submission.status]
    const count = submission.products.length
    return (
      <article key={submission.id} className="rounded-lg border border-slate-200 bg-white">
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-slate-900">{submission.customerName}</p>
              <p className="text-xs text-slate-500">
                {count} product{count === 1 ? '' : 's'} · Submitted {formatDate(submission.createdAt)}
              </p>
            </div>
            <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
          </div>

          {/* Each photo sits beside its declared count so the two can be checked against each other. */}
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-100">
            {submission.products.map((row) => {
              const label = row.productLabel || row.productName
              return (
                <li key={row.id} className="flex gap-3 p-3">
                  {row.evidencePhotoUrl ? (
                    <a
                      href={row.evidencePhotoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open full-size photo"
                      className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                    >
                      <img src={row.evidencePhotoUrl} alt={`Photo of ${submission.customerName}'s ${label} empties`} className="h-16 w-20 rounded-md border border-slate-200 bg-slate-50 object-cover sm:h-20 sm:w-28" />
                    </a>
                  ) : (
                    <div className="grid h-16 w-20 shrink-0 place-items-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500 sm:h-20 sm:w-28">No photo</div>
                  )}
                  <div className="min-w-0 space-y-0.5">
                    <p className="break-words text-sm text-slate-600">{label}</p>
                    <p className="text-base font-semibold text-slate-900">{formatQuantity(row)}</p>
                    <p className="text-xs text-slate-500">{row.containersPerCase} bottles per case</p>
                    {row.evidencePhotoUrl && (
                      <a href={row.evidencePhotoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 underline-offset-2 hover:underline">
                        <ExternalLink className="size-3" />
                        Open full-size photo
                      </a>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {(submission.notes || submission.reviewNotes) && (
            <div className="space-y-1 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
              {submission.notes && <p className="whitespace-pre-wrap break-words"><span className="font-medium text-slate-800">Customer note:</span> {submission.notes}</p>}
              {submission.reviewNotes && <p className="whitespace-pre-wrap break-words"><span className="font-medium text-slate-800">Review note:</span> {submission.reviewNotes}</p>}
            </div>
          )}
          {submission.reviewedAt && <p className="text-xs text-slate-500">Reviewed {formatDate(submission.reviewedAt)}{submission.reviewedBy ? ` by ${submission.reviewedBy}` : ''}</p>}
          {submission.status === 'PENDING' && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" className={ACTION_REFUSE} disabled={saving} onClick={() => startReject(submission)}>
                <X className="size-3.5" />
                Reject<span className="sr-only"> declaration from {submission.customerName}</span>
              </Button>
              <Button size="sm" className={ACTION_DECIDE} disabled={saving} onClick={() => void reviewSubmission(submission.id, 'APPROVED')}>
                {savingReview?.id === submission.id && savingReview.decision === 'APPROVED' ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Approve empties<span className="sr-only"> from {submission.customerName}</span>
              </Button>
            </div>
          )}
        </div>
      </article>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (saving) return
      setOpen(nextOpen)
      setRejecting(null)
      setError('')
      if (nextOpen) setLoading(true)
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2"><ClipboardCheck className="size-4" />Review existing empties</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl" showCloseButton={!saving}>
        <DialogHeader className="pr-6 text-left">
          <DialogTitle>Existing empties declarations</DialogTitle>
          <DialogDescription>Verify customers' starting empty containers before making them available for exchange.</DialogDescription>
        </DialogHeader>
        {/* Existing containers establish an exchange balance, never proof of a prior cash deposit. */}
        <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">Approval adds empties to the customer's available exchange balance. It does not record a paid deposit or create a cash refund.</p>
        <Tabs defaultValue="pending" className="gap-3">
          {/* Status tabs and Refresh share one toolbar row instead of stacking. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList aria-label="Declaration status">
              <TabsTrigger value="pending" disabled={saving}>Pending{loading ? '' : ` (${pending.length})`}</TabsTrigger>
              <TabsTrigger value="history" disabled={saving}>History{loading ? '' : ` (${history.length})`}</TabsTrigger>
            </TabsList>
            <Button variant="outline" size="sm" className={ACTION_INSPECT} disabled={loading || saving} onClick={() => void loadDeclarations()}>
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {loading ? (
            <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Loading declarations...</p>
          ) : (
            <>
              <TabsContent value="pending" className="space-y-3">
                {pending.map(renderSubmission)}
                {!error && pending.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No declarations awaiting review.</p>}
              </TabsContent>
              <TabsContent value="history" className="space-y-3">
                {history.map(renderSubmission)}
                {!error && history.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No reviewed declarations yet.</p>}
              </TabsContent>
            </>
          )}
        </Tabs>

        {/* Rejecting is confirmed separately and needs a reason the customer can act on. */}
        <AlertDialog open={rejecting !== null} onOpenChange={(nextOpen) => { if (!nextOpen && !saving) setRejecting(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject this declaration?</AlertDialogTitle>
              <AlertDialogDescription>
                {rejecting
                  ? `${rejecting.customerName}'s ${rejecting.products.length === 1 ? 'product' : `${rejecting.products.length} products`} will not be added to their exchange balance. They will see your reason and can declare again.`
                  : ''}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-reject-reason`}>Reason for rejection</Label>
              <Textarea
                id={`${formId}-reject-reason`}
                value={rejectReason}
                maxLength={1000}
                disabled={saving}
                autoFocus
                onChange={(event) => { setRejectReason(event.target.value); setRejectError('') }}
                placeholder="e.g. Only 2 of the 3 declared cases were present. Please declare 2 cases."
              />
              {rejectError && <p role="alert" className="text-sm text-red-700">{rejectError}</p>}
            </div>
            <AlertDialogFooter>
              <Button variant="outline" className={ACTION_INSPECT} disabled={saving} onClick={() => setRejecting(null)}>Cancel</Button>
              <Button variant="outline" className={ACTION_REFUSE} disabled={saving || !rejectReason.trim()} onClick={() => void confirmReject()}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                Reject declaration
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
