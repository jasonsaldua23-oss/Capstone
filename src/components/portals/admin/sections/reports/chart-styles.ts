import type { ReactNode } from 'react'

/** Presentation constants and tiny formatters shared by the inline report tabs. */

export const chartCardClassName = 'rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden'
export const chartTooltipStyle = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: '12px',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.22)',
  color: '#e2e8f0',
}
export const chartTooltipLabelStyle = { color: '#f8fafc', fontWeight: 700 }
export const chartTooltipItemStyle = { color: '#cbd5e1' }

// Keep order-count copy readable and grammatically correct inside the custom-styled report tooltips.
export const formatOrderCountLabel = (value: unknown) => {
  const count = Number(value || 0)
  const safeCount = Number.isFinite(count) ? count : 0
  return `${safeCount.toLocaleString()} ${safeCount === 1 ? 'order' : 'orders'}`
}

export const previewRows = <T extends Record<string, unknown>>(rows: T[]) => rows.slice(0, 8)

export type ReportToolbarConfig = {
  title: string
  statusLabel?: string
  statusOptions?: string[]
  statusValue?: string
  onStatusChange?: (value: string) => void
  showWarehouse?: boolean
  showDriver?: boolean
  showStatus?: boolean
}

/** The screen renders the shared filter toolbar; tabs receive it as a renderer. */
export type ReportToolbarRenderer = (config: ReportToolbarConfig) => ReactNode
