'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Camera, Loader2, Plus, Recycle, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type OpeningProduct = {
  productId: string
  productName: string
  /** Name plus size, e.g. "Pepsi - 1 Liter"; several products share a name. */
  productLabel: string
  unit: string
  containersPerCase: number
}

type OpeningDeclaration = {
  id: string
  /** Products declared in one submission share this id and are reviewed together. */
  submissionId?: string
  productId: string
  productName: string
  productLabel?: string
  cases: number
  bottles: number
  containersPerCase: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  notes: string | null
  evidencePhotoUrl: string | null
  reviewNotes: string | null
  createdAt: string
  reviewedAt: string | null
}

/** One product being declared: its own quantities and its own photo. */
type DeclarationLine = {
  key: string
  productId: string
  cases: string
  bottles: string
  photo: File | null
}

type ExistingEmptiesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  refreshCustomerBalances: () => Promise<void>
  /** The declarations card belongs to the Available tab; the dialog stays mounted for the Record Empties shortcut. */
  showSummary?: boolean
}

// Matches the server's per-submission limit.
const MAX_LINES = 20

const emptyLine = (): DeclarationLine => ({ key: crypto.randomUUID(), productId: '', cases: '', bottles: '', photo: null })

const usesCases = (product: OpeningProduct | undefined) => product?.unit.trim().toLowerCase() === 'case'

const formatQuantity = (row: OpeningDeclaration) => [
  row.cases > 0 ? `${row.cases} case${row.cases === 1 ? '' : 's'}` : '',
  row.bottles > 0 ? `${row.bottles} bottle${row.bottles === 1 ? '' : 's'}` : '',
].filter(Boolean).join(' + ')

/** One entry per submission, products in the order they were added. */
function groupSubmissions(rows: OpeningDeclaration[]) {
  const groups = new Map<string, OpeningDeclaration[]>()
  for (const row of rows) groups.set(row.submissionId || row.id, [...(groups.get(row.submissionId || row.id) || []), row])
  return Array.from(groups, ([id, group]) => {
    const products = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    const statuses = new Set(products.map((row) => row.status))
    const status: OpeningDeclaration['status'] | 'MIXED' = statuses.has('PENDING') ? 'PENDING' : statuses.size === 1 ? products[0].status : 'MIXED'
    return {
      id,
      products,
      status,
      createdAt: products[0].createdAt,
      notes: products.find((row) => row.notes)?.notes || null,
      reviewNotes: products.find((row) => row.reviewNotes)?.reviewNotes || null,
    }
  })
}

const STATUS_PILL = {
  PENDING: { label: 'Pending verification', className: 'border-amber-100 bg-amber-50 text-amber-700' },
  APPROVED: { label: 'Approved', className: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
  REJECTED: { label: 'Rejected', className: 'border-red-100 bg-red-50 text-red-700' },
  MIXED: { label: 'Partly approved', className: 'border-slate-200 bg-slate-50 text-slate-700' },
} as const

/** The problem with a line, or '' when it can be submitted. */
function lineProblem(line: DeclarationLine, product: OpeningProduct | undefined) {
  if (!product) return 'Select a product.'
  const caseCount = Number(line.cases || 0)
  const bottleCount = Number(line.bottles || 0)
  const capacity = product.containersPerCase
  const totalBottles = caseCount * capacity + bottleCount
  if (!Number.isSafeInteger(caseCount) || caseCount < 0
    || !Number.isSafeInteger(bottleCount) || bottleCount < 0
    || !Number.isSafeInteger(totalBottles) || totalBottles <= 0) {
    return 'Enter whole, non-negative quantities with at least one empty container.'
  }
  // Case products keep loose bottles below a full case; bottle products use bottles only.
  if (usesCases(product) && bottleCount >= capacity) return `Enter fewer than ${capacity} loose bottles and count full cases in Cases.`
  if (!usesCases(product) && caseCount !== 0) return 'This product is recorded in bottles only.'
  if (!line.photo) return 'Add a photo of these empties so staff can verify them.'
  return ''
}

function DeclarationLineFields({
  index,
  line,
  products,
  unavailable,
  error,
  canRemove,
  disabled,
  onChange,
  onRemove,
}: {
  index: number
  line: DeclarationLine
  products: OpeningProduct[]
  /** Why a product cannot be picked on this line, by product id. */
  unavailable: Map<string, string>
  error: string
  canRemove: boolean
  disabled: boolean
  onChange: (patch: Partial<DeclarationLine>) => void
  onRemove: () => void
}) {
  const photoInputRef = useRef<HTMLInputElement>(null)
  const product = products.find((row) => row.productId === line.productId)
  const casesFormat = usesCases(product)
  const photoPreview = useMemo(() => (line.photo ? URL.createObjectURL(line.photo) : ''), [line.photo])
  const id = `opening-empties-${line.key}`

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
  }, [photoPreview])

  return (
    <div role="group" aria-labelledby={`${id}-title`} className={`space-y-3 rounded-2xl border p-3.5 ${error ? 'border-red-200 bg-red-50/30' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <p id={`${id}-title`} className="text-xs font-bold uppercase tracking-wider text-slate-500">Product {index + 1}</p>
        {canRemove ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800" disabled={disabled} onClick={onRemove}>
            <X className="size-3.5" />
            Remove
          </Button>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-product`} className="text-xs font-semibold text-slate-700">Product</Label>
        <select
          id={`${id}-product`}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-emerald-600 focus:outline-none"
          value={line.productId}
          disabled={disabled}
          onChange={(event) => onChange({ productId: event.target.value, cases: '', bottles: '', photo: null })}
        >
          <option value="" disabled>Select a product</option>
          {products.map((row) => {
            const reason = row.productId === line.productId ? '' : unavailable.get(row.productId) || ''
            return (
              <option key={row.productId} value={row.productId} disabled={Boolean(reason)}>
                {row.productLabel}{reason ? ` — ${reason}` : ''}
              </option>
            )
          })}
        </select>
        {casesFormat ? <p className="text-xs text-slate-500">{product?.containersPerCase} bottles per case.</p> : null}
      </div>

      {product ? (
        <div className={`grid gap-3 ${casesFormat ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {casesFormat ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-cases`} className="text-xs font-semibold text-slate-700">Cases</Label>
              <Input id={`${id}-cases`} type="number" min="0" step="1" placeholder="0" value={line.cases} disabled={disabled} onChange={(event) => onChange({ cases: event.target.value })} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-bottles`} className="text-xs font-semibold text-slate-700">{casesFormat ? 'Loose bottles' : 'Bottles'}</Label>
            <Input id={`${id}-bottles`} type="number" min="0" max={casesFormat ? (product.containersPerCase || 1) - 1 : undefined} step="1" placeholder="0" value={line.bottles} disabled={disabled} onChange={(event) => onChange({ bottles: event.target.value })} />
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <p id={`${id}-photo-label`} className="text-xs font-semibold text-slate-700">Photo of these empties</p>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-labelledby={`${id}-photo-label`}
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file && file.type.startsWith('image/')) onChange({ photo: file })
            event.target.value = ''
          }}
        />
        {photoPreview ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <img src={photoPreview} alt={`Your ${product?.productLabel || 'empties'} photo`} className="h-40 w-full bg-slate-50 object-cover" />
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
              <p className="min-w-0 truncate text-xs text-slate-500">{line.photo?.name}</p>
              <div className="flex shrink-0 gap-1.5">
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-xl text-xs" disabled={disabled} onClick={() => photoInputRef.current?.click()}>
                  <Camera className="size-3.5" />
                  Change
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 rounded-xl text-xs text-red-700 hover:bg-red-50 hover:text-red-800" disabled={disabled} onClick={() => onChange({ photo: null })}>
                  <X className="size-3.5" />
                  Remove
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => photoInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-center transition-colors hover:border-emerald-500 hover:bg-emerald-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="mb-1 grid size-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
              <Camera className="size-4" />
            </span>
            <span className="text-sm font-semibold text-slate-800">Add photo</span>
            <span className="text-[11px] text-slate-500">One photo showing the cases and bottles of this product.</span>
          </button>
        )}
      </div>

      {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
    </div>
  )
}

// Added: starting empties have their own review history and never require purchase history.
export function ExistingEmptiesDialog({ open, onOpenChange, refreshCustomerBalances, showSummary = true }: ExistingEmptiesDialogProps) {
  const [products, setProducts] = useState<OpeningProduct[]>([])
  const [declarations, setDeclarations] = useState<OpeningDeclaration[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [lines, setLines] = useState<DeclarationLine[]>(() => [emptyLine()])
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  // A retry after a lost response reuses each stored photo and each line's request ID.
  const uploadedPhotosRef = useRef(new WeakMap<File, string>())
  const requestIdsRef = useRef(new Map<string, { key: string; requestId: string }>())

  // A product with a pending or approved declaration cannot be declared again.
  const declaredProductIds = new Set(declarations.filter((row) => row.status !== 'REJECTED').map((row) => row.productId))
  const selectableCount = products.filter((row) => !declaredProductIds.has(row.productId)).length

  const unavailableFor = (line: DeclarationLine) => {
    const reasons = new Map<string, string>()
    for (const productId of declaredProductIds) reasons.set(productId, 'already declared')
    for (const other of lines) {
      if (other.key !== line.key && other.productId) reasons.set(other.productId, 'already added')
    }
    return reasons
  }

  const updateLine = (key: string, patch: Partial<DeclarationLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
    setLineErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setFormError('')
  }

  const loadDeclarations = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await fetch('/api/customer/empty-bottles/opening', {
        credentials: 'include',
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Unable to load existing empties declarations')
      }
      setProducts(Array.isArray(payload.products) ? payload.products : [])
      setDeclarations(Array.isArray(payload.declarations) ? payload.declarations : [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load existing empties declarations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDeclarations()
  }, [loadDeclarations])

  const refreshDeclarations = async () => {
    // Added: approved declarations and the existing checkout balance refresh together.
    await Promise.all([loadDeclarations(), refreshCustomerBalances()])
  }

  const uploadPhoto = async (photo: File) => {
    const stored = uploadedPhotosRef.current.get(photo)
    if (stored) return stored
    const formData = new FormData()
    formData.append('file', photo)
    const response = await fetch('/api/customer/empty-bottles/opening/evidence', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.imageUrl) {
      throw new Error(payload.error || 'Unable to upload your photo. Please try again.')
    }
    const url = String(payload.imageUrl)
    uploadedPhotosRef.current.set(photo, url)
    return url
  }

  const submitDeclaration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    setFormError('')
    const problems: Record<string, string> = {}
    for (const line of lines) {
      const problem = lineProblem(line, products.find((row) => row.productId === line.productId))
      if (problem) problems[line.key] = problem
    }
    setLineErrors(problems)
    if (Object.keys(problems).length > 0) {
      setFormError(lines.length > 1 ? 'Check the products marked in red above.' : '')
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const photoUrls = await Promise.all(lines.map((line) => uploadPhoto(line.photo as File)))
      const items = lines.map((line, index) => {
        const values = {
          productId: line.productId,
          cases: Number(line.cases || 0),
          bottles: Number(line.bottles || 0),
          notes: notes.trim(),
          evidencePhotoUrl: photoUrls[index],
        }
        const key = JSON.stringify(values)
        // Added: retrying the same line reuses its ID if a response was lost.
        if (requestIdsRef.current.get(line.key)?.key !== key) {
          requestIdsRef.current.set(line.key, { key, requestId: crypto.randomUUID() })
        }
        return { requestId: requestIdsRef.current.get(line.key)!.requestId, ...values }
      })
      const response = await fetch('/api/customer/empty-bottles/opening', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success || !Array.isArray(payload.declarations)) {
        throw new Error(payload.error || 'Unable to submit your existing empties. Please try again.')
      }
      const saved: OpeningDeclaration[] = payload.declarations
      const savedIds = new Set(saved.map((row) => row.id))
      setDeclarations((current) => [...saved, ...current.filter((row) => !savedIds.has(row.id))])
      requestIdsRef.current.clear()
      setLines([emptyLine()])
      setLineErrors({})
      setNotes('')
      onOpenChange(false)
      toast.success(saved.length > 1
        ? `${saved.length} products submitted for staff verification.`
        : 'Existing empties submitted for staff verification.')
      await refreshDeclarations()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to submit your existing empties. Please try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <>
      {showSummary ? (
        <div className="mx-4 overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)]">
          {/* Same header as the balance cards above: title and description, one control on the right. */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-slate-900">Existing empties</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Already had empties before using this system? Declare them without purchase history. Staff must verify them before they become available for exchange.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Refresh existing empties"
              title="Refresh"
              disabled={loading || submitting}
              onClick={() => void refreshDeclarations()}
            >
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <div className="space-y-2 px-4 py-3.5">
            <Button
              type="button"
              className="h-11 w-full gap-1.5 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-500"
              onClick={() => { setFormError(''); onOpenChange(true) }}
            >
              <Plus className="size-4" />
              Declare existing empties
            </Button>
            {loadError ? <p role="alert" className="text-xs text-red-600">{loadError}. Use Refresh to try again.</p> : null}
            {loading && declarations.length === 0 ? <p role="status" className="py-1 text-center text-xs text-slate-400">Loading declarations...</p> : null}
          </div>
          {declarations.length > 0 ? (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {groupSubmissions(declarations).map((submission) => {
                const pill = STATUS_PILL[submission.status]
                const count = submission.products.length
                return (
                  <div key={submission.id} className="space-y-2.5 px-4 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-slate-500">
                        Declared {new Date(submission.createdAt).toLocaleDateString()} · {count} product{count === 1 ? '' : 's'}
                      </p>
                      <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${pill.className}`}>{pill.label}</span>
                    </div>
                    <ul className="space-y-2">
                      {submission.products.map((row) => {
                        const label = row.productLabel || row.productName
                        return (
                          <li key={row.id} className="flex items-center gap-3">
                            {row.evidencePhotoUrl ? (
                              <a href={row.evidencePhotoUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600" title="Open photo">
                                <img src={row.evidencePhotoUrl} alt={`Photo submitted for ${label}`} className="size-12 rounded-xl border border-slate-200 bg-slate-50 object-cover" />
                              </a>
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold leading-5 text-slate-800">{label}</p>
                              <p className="text-xs font-semibold text-slate-600">{formatQuantity(row)}</p>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                    {submission.status === 'APPROVED' ? <p className="text-xs text-emerald-700">Approved for exchange only.</p> : null}
                    {submission.status === 'PENDING' ? <p className="text-xs text-slate-500">Not available until staff approves.</p> : null}
                    {submission.notes || submission.reviewNotes ? (
                      <div className="space-y-1 rounded-2xl bg-slate-50 p-3 text-xs">
                        {submission.notes ? <p className="break-words text-slate-600"><span className="font-semibold text-slate-700">Your note:</span> {submission.notes}</p> : null}
                        {submission.reviewNotes ? <p className="break-words text-slate-600"><span className="font-semibold text-slate-700">Staff note:</span> {submission.reviewNotes}</p> : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
        {/* minmax(0,1fr): the dialog is a grid, and a long photo file name would otherwise widen its column past the screen. */}
        <DialogContent className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto rounded-3xl p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Recycle className="h-5 w-5 text-emerald-600" />
              Declare existing empties
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-slate-500">
              Record the empties you already had before using this system. Staff will verify your quantities for exchange.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            Approval makes these empties available for exchange only. It does not establish a previously paid deposit or create a refundable cash balance.
          </p>
          {loading ? <p role="status" className="py-4 text-center text-xs text-slate-500">Loading returnable products...</p> : loadError ? (
            <div className="space-y-3 text-center">
              <p role="alert" className="text-xs text-red-600">{loadError}</p>
              <Button type="button" variant="outline" className="rounded-xl text-xs" onClick={() => void loadDeclarations()}>Try again</Button>
            </div>
          ) : products.length === 0 ? <p className="py-4 text-center text-xs text-slate-500">No returnable products are currently available. Contact staff to record your starting quantities.</p> : (
            <form className="space-y-4" onSubmit={submitDeclaration}>
              <p className="text-xs text-slate-500">Products with a container deposit. Add each product with its own count and 1 photo.</p>
              {lines.map((line, index) => (
                <DeclarationLineFields
                  key={line.key}
                  index={index}
                  line={line}
                  products={products}
                  unavailable={unavailableFor(line)}
                  error={lineErrors[line.key] || ''}
                  canRemove={lines.length > 1}
                  disabled={submitting}
                  onChange={(patch) => updateLine(line.key, patch)}
                  onRemove={() => {
                    setLines((current) => current.filter((row) => row.key !== line.key))
                    requestIdsRef.current.delete(line.key)
                  }}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full gap-1.5 rounded-xl border-dashed text-xs font-semibold text-slate-700"
                disabled={submitting || lines.length >= Math.min(MAX_LINES, selectableCount)}
                onClick={() => setLines((current) => [...current, emptyLine()])}
              >
                <Plus className="size-4" />
                Add another product
              </Button>
              <div className="space-y-1.5">
                <Label htmlFor="opening-empties-notes" className="text-xs font-semibold text-slate-700">Notes (optional)</Label>
                <Textarea id="opening-empties-notes" className="rounded-xl text-sm" rows={3} maxLength={1000} value={notes} disabled={submitting} onChange={(event) => setNotes(event.target.value)} placeholder="Details to help staff verify your existing empties" />
              </div>
              {formError ? <p role="alert" className="text-xs text-red-600">{formError}</p> : null}
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1 rounded-xl text-xs" disabled={submitting} onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" className="flex-1 rounded-xl bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500" disabled={submitting}>
                  {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {submitting ? 'Submitting...' : lines.length > 1 ? `Submit ${lines.length} products` : 'Submit for verification'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
