/**
 * The interpretation strip that sits under every chart.
 *
 * Kept as one component so the wording block reads the same on the admin
 * reports, the admin dashboard and the warehouse screens. The sentence itself
 * comes from `@/lib/chart-interpretation`, which derives it from the chart's
 * own data.
 */
export function ChartInterpretation({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null
  return (
    <div className={`mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 ${className}`.trim()}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Interpretation</p>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{text}</p>
    </div>
  )
}
