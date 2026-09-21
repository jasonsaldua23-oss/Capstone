'use client'

import { Upload, X } from 'lucide-react'

/**
 * Presentation for the customer's replacement claim form.
 *
 * The form exists twice -- once in the order dialog and once on the order detail
 * page -- with the markup copied between them, which is the same arrangement that
 * let the driver nav's four tabs drift apart. Each copy keeps its own state and
 * submit handler; the shell, the unit control and the evidence area come from here
 * so the two cannot look different.
 *
 * The wording is deliberately unchanged. Every label here is mirrored in the Expo
 * customer app and checked by `scripts/check-customer-copy-parity.mjs`, so altering
 * it would orphan the app's copy. This module changes structure, weight and
 * affordances only.
 */

/** One damaged product being claimed. */
export function ClaimLineShell({
  index,
  productLabel,
  onRemove,
  canRemove,
  children,
}: {
  index: number
  productLabel?: string
  onRemove: () => void
  canRemove: boolean
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* The position names the line, with the chosen product beneath it once
              picked, so a claim with several lines can be scanned. */}
          <p className="text-sm font-semibold text-slate-900">Product #{index + 1}</p>
          {productLabel?.trim() ? (
            <p className="truncate text-xs text-slate-500">{productLabel}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="-mr-1 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-rose-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:pointer-events-none disabled:opacity-30"
          disabled={!canRemove}
          onClick={onRemove}
          aria-label={`Remove Product #${index + 1}`}
          title={canRemove ? 'Remove' : 'Keep at least one product'}
        >
          <X className="size-4" />
        </button>
      </div>
      {children}
    </section>
  )
}

/** Whether a quantity is counted in cases or loose bottles. */
export function ClaimUnitToggle({
  mode,
  caseLabel,
  onSelect,
  caseDisabled = false,
}: {
  mode: 'case' | 'bottle'
  caseLabel: string
  onSelect: (mode: 'case' | 'bottle') => void
  caseDisabled?: boolean
}) {
  const base =
    'h-8 px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-40'
  const on = 'bg-emerald-600 text-white'
  const off = 'bg-white text-slate-700 hover:bg-slate-50'
  return (
    <div
      role="group"
      aria-label="Count damaged stock by"
      className="inline-flex h-8 overflow-hidden rounded-md border border-slate-300"
    >
      <button
        type="button"
        disabled={caseDisabled}
        aria-pressed={mode === 'case'}
        className={`${base} ${mode === 'case' ? on : off}`}
        onClick={() => onSelect('case')}
      >
        By {caseLabel}
      </button>
      <button
        type="button"
        aria-pressed={mode === 'bottle'}
        className={`${base} border-l border-slate-300 ${mode === 'bottle' ? on : off}`}
        onClick={() => onSelect('bottle')}
      >
        By Bottle
      </button>
    </div>
  )
}

/** A labelled field. Keeps every control in the claim on one baseline. */
export function ClaimField({
  label,
  hint,
  className = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  )
}

/** Shared control sizing, so selects, inputs and textareas line up. */
export const CLAIM_CONTROL =
  'h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-emerald-700'

/**
 * Photo evidence.
 *
 * The count used to sit under the control as loose grey text; here the area states
 * its own limit and an added photo can be taken back off, which the previous
 * version gave no way to do.
 */
export function ClaimEvidence({
  previews,
  count,
  max,
  onAdd,
  onRemove,
  disabled = false,
}: {
  previews: Array<{ url: string; name: string }>
  count: number
  max: number
  onAdd: (files: File[]) => void
  onRemove?: (url: string) => void
  /**
   * Photos are uploaded when the claim is submitted, from the list as it stood at
   * that moment. Locking the area while that runs stops a photo being removed
   * here after it has already gone into the request.
   */
  disabled?: boolean
}) {
  const isFull = count >= max
  const isLocked = disabled || isFull
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-slate-600">Upload Evidence (Photo)</p>
        <p className="text-[11px] tabular-nums text-slate-500">
          {count} / {max} photo(s) selected (2 per product)
        </p>
      </div>

      <label
        className={`flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs font-medium ${
          isLocked
            ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
            : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-500 hover:text-emerald-700'
        }`}
      >
        <Upload className="size-3.5" />
        {isFull ? 'Photo limit reached' : 'Upload Evidence (Photo)'}
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={isLocked}
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'))
            onAdd(files)
            event.target.value = ''
          }}
        />
      </label>

      {previews.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {previews.map((preview) => (
            <li key={preview.url} className="relative">
              <img
                src={preview.url}
                alt={preview.name}
                className="h-20 w-full rounded-md border border-slate-200 object-cover"
              />
              {onRemove ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(preview.url)}
                  aria-label={`Remove ${preview.name}`}
                  title="Remove photo"
                  className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-full bg-slate-900/70 text-white hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-40"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
