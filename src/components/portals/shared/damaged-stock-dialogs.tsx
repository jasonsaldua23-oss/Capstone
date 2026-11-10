'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CheckCheck, Loader2, PackageX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PodImagePreview } from '@/components/shared/pod-image-preview'
import { FILTER_SELECT_CLASS } from '@/components/portals/shared/filter-select'
import { prepareImageForUpload } from '@/lib/client-image'
import {
  DAMAGED_STOCK_ACTIONS,
  DAMAGED_STOCK_CAUSES,
  damagedQuantityLabel,
  damagedStockCauseLabel,
  damagedStockStatusLabel,
  newDamagedStockRequestId,
  parseDamagedStockRecord,
  productWithSize,
  type DamagedStockAction,
  type DamagedStockCause,
  type DamagedStockRecord,
} from '@/lib/damaged-stock'

const DESCRIPTION_MAX_LENGTH = 1000
const NOTES_MAX_LENGTH = 1000

const formatPeso = (value: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value)
const formatDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

type BatchOption = {
  id: string
  batchNumber: string
  productName: string
  unitsPerCase: number
  cases: number
  loose: number
  expiryDate: string | null
}

function parseBatchOptions(raw: unknown): BatchOption[] {
  const rows = Array.isArray(raw) ? raw : []
  return rows
    .map((row: any) => {
      const product = row?.inventory?.product || {}
      const sizes = Array.isArray(product.sizes) ? product.sizes.map((size: unknown) => String(size).trim()).filter(Boolean) : []
      return {
        id: String(row?.id || ''),
        batchNumber: String(row?.batchNumber || ''),
        productName: productWithSize(String(product.name || 'Product'), sizes),
        unitsPerCase: Math.max(1, Number(product.quantityPerUnit) || 1),
        cases: Math.max(0, Number(row?.quantity) || 0),
        loose: Math.max(0, Number(row?.looseUnits) || 0),
        expiryDate: row?.expiryDate ? String(row.expiryDate) : null,
      }
    })
    .filter((row) => row.id && (row.cases > 0 || row.loose > 0))
    .sort((a, b) => a.productName.localeCompare(b.productName) || a.batchNumber.localeCompare(b.batchNumber))
}

async function uploadPhoto(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', await prepareImageForUpload(file))
  const response = await fetch('/api/damaged-stock/photo', { method: 'POST', body: formData })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.imageUrl) throw new Error(String(payload?.error || 'The photo could not be uploaded'))
  return String(payload.imageUrl)
}

/** Warehouse staff set damaged units aside from a batch; they leave sellable stock at once. */
export function RecordDamagedStockDialog({
  open,
  onOpenChange,
  onRecorded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRecorded: (record: DamagedStockRecord) => void
}) {
  const [batches, setBatches] = useState<BatchOption[]>([])
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [batchId, setBatchId] = useState('')
  const [cases, setCases] = useState('')
  const [bottles, setBottles] = useState('')
  const [cause, setCause] = useState<DamagedStockCause | ''>('')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Kept across retries of one recording, replaced only once it is saved.
  const requestIdRef = useRef(newDamagedStockRequestId())
  const photoInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async () => {
      setLoadingBatches(true)
      try {
        const response = await fetch('/api/stock-batches?page=1&pageSize=500', { cache: 'no-store' })
        const payload = await response.json().catch(() => ({}))
        if (!cancelled && response.ok) setBatches(parseBatchOptions(payload?.stockBatches))
      } finally {
        if (!cancelled) setLoadingBatches(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const batch = batches.find((row) => row.id === batchId) || null
  const byProduct = useMemo(() => {
    const groups = new Map<string, BatchOption[]>()
    for (const row of batches) groups.set(row.productName, [...(groups.get(row.productName) || []), row])
    return Array.from(groups.entries())
  }, [batches])
  const hasBottles = (batch?.unitsPerCase || 1) > 1

  const reset = () => {
    setBatchId('')
    setCases('')
    setBottles('')
    setCause('')
    setDescription('')
    setPhoto(null)
    setError('')
    requestIdRef.current = newDamagedStockRequestId()
  }

  const close = () => {
    if (saving) return
    onOpenChange(false)
  }

  const submit = async () => {
    const caseCount = cases.trim() === '' ? 0 : Number(cases)
    const bottleCount = bottles.trim() === '' ? 0 : Number(bottles)
    if (!batch) return setError('Choose the batch the damaged stock came from.')
    if (![caseCount, bottleCount].every((value) => Number.isInteger(value) && value >= 0)) {
      return setError('Enter whole numbers of cases and bottles.')
    }
    if (caseCount + bottleCount === 0) return setError('Enter how many cases or bottles are damaged.')
    if (!cause) return setError('Choose what caused the damage.')
    if (!description.trim()) return setError('Describe the damage.')
    setSaving(true)
    setError('')
    try {
      const photoUrl = photo ? await uploadPhoto(photo) : null
      const response = await fetch('/api/damaged-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: requestIdRef.current,
          batchId: batch.id,
          cases: caseCount,
          looseUnits: bottleCount,
          cause,
          description: description.trim(),
          photoUrl,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      const record = parseDamagedStockRecord(payload?.record)
      if (!response.ok || !record) throw new Error(String(payload?.error || 'The damaged stock could not be recorded'))
      reset()
      onRecorded(record)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The damaged stock could not be recorded')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!saving}>
        <DialogHeader className="pr-6 text-left">
          <DialogTitle className="flex items-center gap-2">
            <PackageX className="size-5 text-rose-600" aria-hidden="true" />
            Record damaged stock
          </DialogTitle>
          <DialogDescription>
            The damaged units leave sellable stock now and stay listed as Pending until you dispose of them, return them
            to the supplier, or put them back.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="damaged-batch">Batch <span className="text-red-600">*</span></Label>
            <select
              id="damaged-batch"
              className={`${FILTER_SELECT_CLASS} w-full`}
              value={batchId}
              disabled={saving || loadingBatches}
              onChange={(event) => {
                setBatchId(event.target.value)
                setError('')
              }}
            >
              <option value="">{loadingBatches ? 'Loading batches…' : 'Choose a batch'}</option>
              {byProduct.map(([productName, rows]) => (
                <optgroup key={productName} label={productName}>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.batchNumber} · {damagedQuantityLabel(row.cases, row.loose)}
                      {row.expiryDate ? ` · expires ${new Date(row.expiryDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {!loadingBatches && batches.length === 0 ? (
              <p className="text-xs text-slate-500">No batch in your warehouse has stock to set aside.</p>
            ) : null}
          </div>

          <div className={`grid gap-3 ${hasBottles ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div className="space-y-1.5">
              <Label htmlFor="damaged-cases">Damaged full cases</Label>
              <Input
                id="damaged-cases"
                type="number"
                inputMode="numeric"
                min={0}
                max={batch?.cases}
                value={cases}
                disabled={saving}
                aria-describedby={hasBottles && batch ? 'damaged-cases-hint' : undefined}
                onChange={(event) => {
                  setCases(event.target.value)
                  setError('')
                }}
                placeholder="0"
              />
              {hasBottles && batch ? (
                // Glass comes in crates, PET and cans in cartons or packs: "container" covers all.
                <p id="damaged-cases-hint" className="text-xs text-slate-500">
                  A whole case of {batch.unitsPerCase}: the container and all its bottles.
                </p>
              ) : null}
            </div>
            {hasBottles ? (
              <div className="space-y-1.5">
                <Label htmlFor="damaged-bottles">Damaged bottles</Label>
                <Input
                  id="damaged-bottles"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={bottles}
                  disabled={saving}
                  onChange={(event) => {
                    setBottles(event.target.value)
                    setError('')
                  }}
                  placeholder="0"
                />
              </div>
            ) : null}
          </div>
          {hasBottles && batch ? (
            <p className="-mt-2 text-xs text-slate-500">
              Damaged bottles come from the batch&apos;s loose bottles first. If there are not enough, a case of{' '}
              {batch.unitsPerCase} is opened and its good bottles stay in stock as loose bottles.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="damaged-cause">Cause <span className="text-red-600">*</span></Label>
            <select
              id="damaged-cause"
              className={`${FILTER_SELECT_CLASS} w-full`}
              value={cause}
              disabled={saving}
              onChange={(event) => {
                setCause(event.target.value as DamagedStockCause)
                setError('')
              }}
            >
              <option value="">Choose what caused it</option>
              {DAMAGED_STOCK_CAUSES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="damaged-description">What is damaged <span className="text-red-600">*</span></Label>
            <Textarea
              id="damaged-description"
              value={description}
              maxLength={DESCRIPTION_MAX_LENGTH}
              rows={3}
              disabled={saving}
              onChange={(event) => {
                setDescription(event.target.value)
                setError('')
              }}
              placeholder="What happened and what the damage looks like"
              className="resize-none text-sm"
            />
            <p className="text-right text-[11px] text-slate-400">{description.length}/{DESCRIPTION_MAX_LENGTH}</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-900">Photo <span className="font-normal text-slate-500">(optional)</span></p>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0] || null
                event.target.value = ''
                if (file && !file.type.startsWith('image/')) return setError('Choose a photo (an image file).')
                setPhoto(file)
              }}
            />
            {photoPreview ? (
              <div className="relative w-fit">
                {/* A local preview; nothing is uploaded until the record is saved. */}
                <img src={photoPreview} alt="Damaged stock photo to attach" className="h-24 w-36 rounded-lg border border-slate-200 object-cover" />
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  disabled={saving}
                  aria-label="Remove photo"
                  className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <Button type="button" variant="outline" disabled={saving} onClick={() => photoInputRef.current?.click()} className="gap-2">
                <Camera className="size-4" />
                Add photo
              </Button>
            )}
          </div>

          {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" disabled={saving} onClick={close}>Cancel</Button>
          <Button className="bg-rose-600 text-white hover:bg-rose-700" disabled={saving} onClick={() => void submit()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <PackageX className="size-4" />}
            {saving ? 'Saving…' : 'Set aside damaged stock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-900">{children}</dd>
    </div>
  )
}

/** One record in full; warehouse staff also decide here what becomes of it. */
export function DamagedStockDetailsDialog({
  record,
  onClose,
  onResolved,
}: {
  record: DamagedStockRecord | null
  onClose: () => void
  onResolved: (record: DamagedStockRecord) => void
}) {
  const [action, setAction] = useState<DamagedStockAction | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const close = () => {
    if (saving) return
    setAction(null)
    setNotes('')
    setError('')
    onClose()
  }

  const submit = async () => {
    if (!record) return
    if (!action) return setError('Choose what became of the damaged stock.')
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/damaged-stock/${encodeURIComponent(record.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes: notes.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      const updated = parseDamagedStockRecord(payload?.record)
      if (!response.ok || !updated) throw new Error(String(payload?.error || 'The record could not be updated'))
      setAction(null)
      setNotes('')
      onResolved(updated)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The record could not be updated')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={record !== null} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!saving}>
        {record ? (
          <>
            <DialogHeader className="pr-6 text-left">
              <DialogTitle>{record.recordNumber}</DialogTitle>
              <DialogDescription>
                {productWithSize(record.productName, record.productSizes)} · {damagedStockStatusLabel(record.status)}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Quantity">
                {damagedQuantityLabel(record.cases, record.looseUnits)}
                {record.casesOpened ? (
                  <span className="block text-xs text-slate-500">
                    {record.casesOpened === 1 ? '1 case was' : `${record.casesOpened} cases were`} opened; the good bottles stayed in stock.
                  </span>
                ) : null}
              </Fact>
              <Fact label="Batch">{record.batchNumber || 'Unavailable batch'}</Fact>
              <Fact label="Cause">{damagedStockCauseLabel(record.cause)}</Fact>
              <Fact label="Recorded">
                {formatDateTime(record.recordedAt)}
                {record.recordedBy ? <span className="block text-xs text-slate-500">by {record.recordedBy}</span> : null}
              </Fact>
            </dl>
            <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{record.description}</p>
            {record.photoUrl ? (
              <div className="w-40">
                <PodImagePreview src={record.photoUrl} alt={`Photo of damaged stock ${record.recordNumber}`} caption="View photo" className="h-28 w-40 rounded-lg object-cover" />
              </div>
            ) : null}

            {record.status !== 'PENDING' ? (
              <div className="space-y-1 rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-medium text-slate-900">
                  {damagedStockStatusLabel(record.status)}
                  {record.resolvedBy ? <span className="font-normal text-slate-500"> · {record.resolvedBy}, {formatDateTime(record.resolvedAt)}</span> : null}
                </p>
                {record.lossAmount !== null ? <p className="text-rose-700">Loss at listed price: {formatPeso(record.lossAmount)}</p> : null}
                {record.resolutionNotes ? <p className="whitespace-pre-wrap break-words text-slate-600">{record.resolutionNotes}</p> : null}
              </div>
            ) : null}

            {record.canManage ? (
              <>
                <fieldset className="space-y-2">
                  <legend className="mb-1.5 text-sm font-medium text-slate-900">What became of it?</legend>
                  {DAMAGED_STOCK_ACTIONS.map((option) => {
                    const selected = action === option.value
                    return (
                      <label
                        key={option.value}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${selected ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                      >
                        <input
                          type="radio"
                          name="damaged-stock-action"
                          value={option.value}
                          checked={selected}
                          disabled={saving}
                          onChange={() => {
                            setAction(option.value)
                            setError('')
                          }}
                          className="mt-1 size-4 accent-emerald-600"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-900">{option.label}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">{option.hint}</span>
                        </span>
                      </label>
                    )
                  })}
                </fieldset>
                <div className="space-y-1.5">
                  <Label htmlFor="damaged-resolution-notes">Notes <span className="font-normal text-slate-500">(optional)</span></Label>
                  <Textarea
                    id="damaged-resolution-notes"
                    value={notes}
                    maxLength={NOTES_MAX_LENGTH}
                    rows={2}
                    disabled={saving}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="How it was disposed of, or the supplier's return reference"
                    className="resize-none text-sm"
                  />
                </div>
                {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}
                <DialogFooter className="gap-2 sm:gap-2">
                  <Button variant="outline" disabled={saving} onClick={close}>Cancel</Button>
                  <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving} onClick={() => void submit()}>
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
                    Confirm
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <DialogFooter>
                <Button variant="outline" onClick={close}>Close</Button>
              </DialogFooter>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
