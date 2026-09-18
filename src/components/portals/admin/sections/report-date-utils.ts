export type ReportDatePreset = 'all' | 'today' | '7' | '30' | '90' | '365' | 'custom'

// Report filenames and headings share one date representation across every tab.
export const formatReportRangeDate = (value: Date) =>
  value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export const formatReportDateRangeLabel = (start: Date, end: Date) =>
  `${formatReportRangeDate(start)} - ${formatReportRangeDate(end)}`

export const buildReportStamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)

export type ReportDateWindow = { start: Date | null; end: Date | null; label: string }

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
  const start = new Date(now)
  if (preset !== 'today') start.setDate(start.getDate() - Number(preset))
  start.setHours(0, 0, 0, 0)
  return {
    start,
    end,
    label: preset === 'today' ? 'Today' : preset === '365' ? 'Past 1 Year' : `Past ${preset} Days`,
  }
}
