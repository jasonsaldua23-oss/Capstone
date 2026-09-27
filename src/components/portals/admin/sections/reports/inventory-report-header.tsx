'use client'

import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Download, FileSpreadsheet, Printer } from 'lucide-react'

/**
 * The Inventory tab holds several reports. One is shown at a time, picked from
 * the dropdown in this header, and the header's exports act on that report.
 */
export type InventoryReportType = 'fast-moving' | 'stock-movement' | 'low-stock' | 'batch-expiry'

export const INVENTORY_REPORT_TYPE_OPTIONS: Array<{ value: InventoryReportType; label: string }> = [
  { value: 'fast-moving', label: 'Fast-Moving Products' },
  { value: 'stock-movement', label: 'Stock Movement' },
  { value: 'low-stock', label: 'Low Stock Alerts' },
  { value: 'batch-expiry', label: 'Batch Expiry' },
]

export function InventoryReportTypeSelect({
  value,
  onChange,
}: {
  value: InventoryReportType
  onChange: (value: InventoryReportType) => void
}) {
  return (
    <select
      aria-label="Report type"
      title="Choose which inventory report to show"
      value={value}
      onChange={(event) => onChange(event.target.value as InventoryReportType)}
      className="h-11 min-w-[210px] rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
    >
      {INVENTORY_REPORT_TYPE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/** Header card shared by every inventory report: title, badge, report picker and exports. */
export function InventoryReportHeader({
  title,
  badge,
  description,
  reportTypeSelect,
  onExportCsv,
  onExportPdf,
  onPrint,
}: {
  title: string
  badge: { icon: ReactNode; label: string; className: string }
  description: string
  reportTypeSelect: ReactNode
  onExportCsv: () => void
  onExportPdf: () => void
  onPrint: () => void
}) {
  return (
    <div className="order-[-2] flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          <Badge className={`gap-1 text-xs ${badge.className}`}>
            {badge.icon} {badge.label}
          </Badge>
        </div>
        <p className="text-sm text-slate-500">{description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {reportTypeSelect}
        <Button
          variant="outline"
          size="sm"
          onClick={onExportCsv}
          className="h-11 gap-2 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          <FileSpreadsheet className="h-4 w-4 text-slate-700" />
          Export CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onExportPdf}
          className="h-11 gap-2 rounded-xl border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-100"
        >
          <Download className="h-4 w-4 text-blue-600" />
          Export PDF
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onPrint}
          className="h-11 gap-2 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          <Printer className="h-4 w-4 text-slate-600" />
          Print
        </Button>
      </div>
    </div>
  )
}
