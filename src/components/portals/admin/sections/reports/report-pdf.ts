import { toast } from 'sonner'
import type { InventoryMovementSummary } from '@/lib/report-metrics'
import { formatPeso } from '../shared'
import { exportReportPdf, type ExportColumn } from './export-utils'

export const formatPesoCompact = (value: number) => formatPeso(value).replace(/\.00\b/, '')

// Inventory batch aging is easier to scan with calendar dates only.
export function formatReportDateOnly(value: unknown) {
  if (!value) return 'N/A'
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return 'N/A'
  return parsed.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
}

export type ReportPdfOptions = {
  companyName?: string
  summaryLines?: string[]
  rangeLabel?: string
  extraSections?: Array<{
    title: string
    lines?: string[]
    rows?: Array<Record<string, unknown>>
  }>
}

// Keep the existing call contract; visible KPI values now come from summaryLines.
export type ReportPdfContext = {
  driverPerformanceKpi: { total: number; active: number; totalTrips: number }
  feedbackExportRows: any[]
  inventoryMovementSummary: InventoryMovementSummary
  replacementRows: any[]
  stockExpiryKpi: { total: number; critical: number; warning: number; expired: number }
  stockExpiryRows: any[]
  transportDriverRows: any[]
  warehouses: any[]
}

const omittedKeys = /^(id|createdAt|updatedAt|created_at|updated_at)$/i

function reportColumns(rows: Array<Record<string, unknown>>): ExportColumn<Record<string, unknown>>[] {
  return Object.keys(rows[0])
    .filter((key) => !omittedKeys.test(key))
    .map((key) => ({
      key,
      header: key
        .replace(/([A-Z])/g, ' $1')
        .replace(/_/g, ' ')
        .replace(/^./, (character) => character.toUpperCase())
        .trim(),
    }))
}

/**
 * All analytics exports share the same centered title, KPI strip, numbered rows,
 * and bordered table as the record-report PDFs.
 */
export async function downloadReportPdf(
  _context: ReportPdfContext,
  filename: string,
  title: string,
  rows: Array<Record<string, unknown>>,
  options?: ReportPdfOptions,
) {
  if (!rows.length) {
    toast.error(`No data to export for ${filename}`)
    return
  }

  await exportReportPdf(
    filename,
    title,
    reportColumns(rows),
    rows,
    options?.summaryLines || [`Total Records: ${rows.length}`],
    options?.rangeLabel,
  )
}
