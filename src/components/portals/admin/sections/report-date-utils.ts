export type ReportDatePreset = 'all' | 'today' | '7' | '30' | '90' | '365' | 'custom'

// Report filenames and headings share one date representation across every tab.
export const formatReportRangeDate = (value: Date) =>
  value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export const formatReportDateRangeLabel = (start: Date, end: Date) =>
  `${formatReportRangeDate(start)} - ${formatReportRangeDate(end)}`

export const buildReportStamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
