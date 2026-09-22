export type ReportDatePreset = 'all' | 'today' | '7' | '30' | '90' | '365' | 'custom'

// Report filenames and headings share one date representation across every tab.
export const formatReportRangeDate = (value: Date) =>
  value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export const formatReportDateRangeLabel = (start: Date, end: Date) =>
  `${formatReportRangeDate(start)} - ${formatReportRangeDate(end)}`

export const buildReportStamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)

/**
 * Timestamps inside report tables.
 *
 * The shared admin `formatDateTime` renders `9/22/2026, 10:00:00 AM`. Seconds
 * are precision no one reads on a report, and several tables carry three date
 * columns side by side, so the rows were mostly punctuation. This drops the
 * seconds and the year for the current year - `Sep 22, 10:00 AM` - and keeps the
 * year on anything older so past records stay unambiguous.
 *
 * Deliberately separate from `formatDateTime`, which ten other admin screens
 * use and which is not in this change's scope.
 */
export const formatReportTableDateTime = (value: unknown, now: Date = new Date()) => {
  if (!value) return 'N/A'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return 'N/A'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}

export type ReportDateWindow = { start: Date | null; end: Date | null; label: string }

/**
 * The first instant a "Past N Days" preset covers.
 *
 * "Past 7 Days" means seven days ending today, so the cutoff is six days back,
 * not seven. The chart builders in report-metrics already count this way - they
 * emit `days` points ending today - while every filter subtracted the full N and
 * so covered N+1 days. A tab's table and its chart were reporting on different
 * windows, and any period-over-period growth compared an N+1 day window against
 * an N day one.
 */
export function resolveReportCutoff(
  preset: Exclude<ReportDatePreset, 'all' | 'custom'>,
  now: Date = new Date(),
): Date {
  const days = preset === 'today' ? 1 : Math.max(1, Number(preset) || 1)
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  cutoff.setHours(0, 0, 0, 0)
  return cutoff
}

/** How many days a preset spans, so a comparison period can match it exactly. */
export function resolveReportSpanDays(preset: Exclude<ReportDatePreset, 'all' | 'custom'>): number {
  return preset === 'today' ? 1 : Math.max(1, Number(preset) || 1)
}

// Lifted verbatim from reports/use-report-datasets.ts so the Reports tab and the
// Feedback page resolve a preset the same way. The label strings feed PDF headings and
// export filenames, so they must not drift.
export function buildReportDateWindow(
  preset: ReportDatePreset,
  from?: string,
  to?: string,
  now: Date = new Date(),
): ReportDateWindow {
  if (preset === 'all') return { start: null, end: null, label: 'All Time' }
  if (preset === 'custom') {
    const start = from ? new Date(`${from}T00:00:00`) : null
    const end = to ? new Date(`${to}T23:59:59.999`) : null
    return {
      start,
      end,
      label: from || to
        ? `${from || 'Start'} to ${to || 'Today'}`
        : 'Custom Date Range',
    }
  }

  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const start = resolveReportCutoff(preset, now)
  return {
    start,
    end,
    label: preset === 'today' ? 'Today' : preset === '365' ? 'Past 1 Year' : `Past ${preset} Days`,
  }
}
