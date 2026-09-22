'use client'

import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * The KPI strip at the top of every Reports tab.
 *
 * The tabs used to hand-write their own grid of identical cards - 114 of them
 * across 14 files - so a count and a rate carried exactly the same weight and
 * nothing said which number the tab is actually about. One card is now the
 * headline and the rest are support, and `hint` is optional so a card can say
 * nothing rather than pad itself with filler like "100% of filtered routes".
 */

export type ReportKpiTone = 'slate' | 'blue' | 'emerald' | 'purple' | 'cyan' | 'indigo' | 'amber' | 'rose'

const TONE_STYLES: Record<ReportKpiTone, { border: string; label: string; value: string }> = {
  slate: { border: 'border-slate-200', label: 'text-slate-500', value: 'text-slate-900' },
  blue: { border: 'border-blue-100', label: 'text-blue-600', value: 'text-blue-700' },
  emerald: { border: 'border-emerald-100', label: 'text-emerald-600', value: 'text-emerald-700' },
  purple: { border: 'border-purple-100', label: 'text-purple-600', value: 'text-purple-700' },
  cyan: { border: 'border-cyan-100', label: 'text-cyan-600', value: 'text-cyan-700' },
  indigo: { border: 'border-indigo-100', label: 'text-indigo-600', value: 'text-indigo-700' },
  amber: { border: 'border-amber-100', label: 'text-amber-600', value: 'text-amber-700' },
  rose: { border: 'border-rose-100', label: 'text-rose-600', value: 'text-rose-700' },
}

export type ReportKpiItem = {
  /** Rich labels are allowed so a card can carry an icon beside its name. */
  label: ReactNode
  /** React key when `label` is not a plain string. */
  id?: string
  value: ReactNode
  /** One short clause of context. Omit it rather than restating the label. */
  hint?: ReactNode
  tone?: ReportKpiTone
  /**
   * `text` when the value is a name rather than a figure. A headline number can
   * carry 36px; a product or client name set that large just clips.
   */
  valueKind?: 'number' | 'text'
}

function KpiCard({ item, emphasis }: { item: ReportKpiItem; emphasis: 'headline' | 'support' }) {
  const tone = TONE_STYLES[item.tone || 'slate']
  const isHeadline = emphasis === 'headline'

  return (
    <Card className={`rounded-2xl border ${tone.border} bg-white shadow-sm ${isHeadline ? 'sm:col-span-2' : ''}`}>
      <CardHeader className="p-4 pb-2">
        <CardDescription className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wide ${tone.label}`}>
          {item.label}
        </CardDescription>
        <CardTitle
          className={`min-w-0 font-bold tracking-tight ${tone.value} ${
            item.valueKind === 'text'
              ? (isHeadline ? 'text-xl sm:text-2xl' : 'text-lg')
              : (isHeadline ? 'text-3xl sm:text-4xl' : 'text-2xl')
          }`}
        >
          {item.value}
        </CardTitle>
      </CardHeader>
      {item.hint ? (
        <CardContent className="p-4 pt-0 text-xs text-slate-500">{item.hint}</CardContent>
      ) : null}
    </Card>
  )
}

/**
 * `headline` is the one number the tab exists to answer; `items` support it.
 * Without a headline the row renders as an even grid, which is the right shape
 * for a tab whose numbers really are peers.
 */
export function ReportKpiRow({
  headline,
  items = [],
  className = '',
}: {
  headline?: ReportKpiItem
  items?: ReportKpiItem[]
  className?: string
}) {
  const supportCount = items.length
  // The headline occupies two tracks, so the row is sized to fit it plus the rest.
  const columns = headline ? Math.min(6, supportCount + 2) : Math.min(5, Math.max(1, supportCount))
  const columnClass =
    columns >= 6 ? 'lg:grid-cols-6'
      : columns === 5 ? 'lg:grid-cols-5'
        : columns === 4 ? 'lg:grid-cols-4'
          : columns === 3 ? 'lg:grid-cols-3'
            : 'lg:grid-cols-2'

  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${columnClass} ${className}`.trim()}>
      {headline ? <KpiCard item={headline} emphasis="headline" /> : null}
      {items.map((item, index) => (
        <KpiCard key={item.id ?? (typeof item.label === 'string' ? item.label : index)} item={item} emphasis="support" />
      ))}
    </div>
  )
}
