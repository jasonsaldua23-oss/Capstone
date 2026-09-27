import type { ReactNode } from 'react'
import { AlertTriangle, ArrowLeftRight, CalendarClock } from 'lucide-react'
import { formatReportTableDateTime } from '@/components/portals/admin/sections/report-date-utils'
import type { ExportColumn } from './export-utils'
import type { InventoryReportType } from './inventory-report-header'
import type { ReportDatasets } from './use-report-datasets'

type TabReportType = Exclude<InventoryReportType, 'fast-moving'>

/** Header copy for the reports the tab renders itself; Fast-Moving owns its own. */
export const INVENTORY_REPORT_HEADERS: Record<
  TabReportType,
  { title: string; badge: { icon: ReactNode; label: string; className: string }; description: string }
> = {
  'stock-movement': {
    title: 'Stock Movement Report',
    badge: {
      icon: <ArrowLeftRight className="h-3 w-3 text-blue-600" />,
      label: 'Stock In / Out',
      className: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    description: 'Stock received and issued across the selected range, by product and by day, with the full movement history.',
  },
  'low-stock': {
    title: 'Low Stock Alert Report',
    badge: {
      icon: <AlertTriangle className="h-3 w-3 text-rose-600" />,
      label: 'Needs Restock',
      className: 'bg-rose-50 text-rose-700 border-rose-200',
    },
    description: 'Products at or below their reorder point, how far below it they are, and which are already out of stock.',
  },
  'batch-expiry': {
    title: 'Stock Batch Expiry Report',
    badge: {
      icon: <CalendarClock className="h-3 w-3 text-orange-600" />,
      label: 'Expiry Watch',
      className: 'bg-orange-50 text-orange-700 border-orange-200',
    },
    description: 'Batches with an expiry date, most urgent first, so near-expiry stock is used or disposed of in time.',
  },
}

type InventoryReportExportData = {
  inventoryKpi: ReportDatasets['inventoryKpi']
  inventoryMovementRows: ReportDatasets['inventoryMovementRows']
  lowStockKpi: ReportDatasets['lowStockKpi']
  lowStockRows: ReportDatasets['lowStockRows']
  movementRangeLabel: string
  selectedMovementType: string
  stockExpiryKpi: ReportDatasets['stockExpiryKpi']
  stockExpiryRows: ReportDatasets['stockExpiryRows']
}

type InventoryReportExport = {
  filename: string
  columns: ExportColumn<any>[]
  rows: any[]
  summaryLines: string[]
  /** Printed as the report period; omitted for point-in-time reports. */
  dateLabel?: string
}

const readableStatus = (value: unknown) => String(value || 'N/A').replace(/_/g, ' ')

/** Each report exports exactly the table it shows on screen. */
export function buildInventoryReportExport(type: TabReportType, data: InventoryReportExportData): InventoryReportExport {
  if (type === 'stock-movement') {
    return {
      filename: 'stock-movement-report',
      columns: [
        { header: 'Date', accessor: (row) => formatReportTableDateTime(row.createdAt) },
        { header: 'Product', accessor: (row) => String(row.product || 'N/A') },
        { header: 'Type', accessor: (row) => String(row.sourceType || row.type || 'N/A') },
        { header: 'Quantity', accessor: (row) => Number(row.quantity || 0) },
      ],
      rows: data.inventoryMovementRows,
      summaryLines: [
        `Stock In: ${Number(data.inventoryKpi.stockIn || 0).toLocaleString()} units`,
        `Stock Out: ${Number(data.inventoryKpi.stockOut || 0).toLocaleString()} units`,
        `Movement Type: ${data.selectedMovementType === 'all' ? 'All' : data.selectedMovementType}`,
      ],
      dateLabel: data.movementRangeLabel,
    }
  }

  if (type === 'low-stock') {
    return {
      filename: 'low-stock-report',
      columns: [
        { header: 'Product', accessor: (row) => String(row.product || 'N/A') },
        { header: 'SKU', accessor: (row) => String(row.sku || 'N/A') },
        { header: 'Current Stock', accessor: (row) => Number(row.currentStock || 0) },
        { header: 'Min Stock', accessor: (row) => Number(row.minStock || 0) },
        { header: 'Reorder Point', accessor: (row) => Number(row.reorderPoint || 0) },
        { header: 'Stock %', accessor: (row) => `${Number(row.stockPercent || 0)}%` },
        { header: 'Status', accessor: (row) => readableStatus(row.status) },
      ],
      rows: data.lowStockRows,
      summaryLines: [
        `Low Stock Items: ${data.lowStockKpi.total}`,
        `Critical Stock (below minimum): ${data.lowStockKpi.critical}`,
        `Out of Stock: ${data.lowStockKpi.outOfStock}`,
      ],
    }
  }

  return {
    filename: 'batch-expiry-report',
    columns: [
      { header: 'Batch #', accessor: (row) => String(row.batchNumber || 'N/A') },
      { header: 'Product', accessor: (row) => String(row.product || 'N/A') },
      { header: 'SKU', accessor: (row) => String(row.sku || 'N/A') },
      { header: 'Quantity', accessor: (row) => Number(row.quantity || 0) },
      { header: 'Manufacture Date', accessor: (row) => String(row.manufacturedDate || 'N/A') },
      { header: 'Expiry Date', accessor: (row) => String(row.expiryDate || 'N/A') },
      { header: 'Days Left', accessor: (row) => (typeof row.daysUntilExpiry === 'number' ? row.daysUntilExpiry : 'N/A') },
      { header: 'Status', accessor: (row) => readableStatus(row.status) },
    ],
    rows: data.stockExpiryRows,
    summaryLines: [
      `Tracked Batches: ${data.stockExpiryKpi.total}`,
      `Expired: ${data.stockExpiryKpi.expired}`,
      `Critical: ${data.stockExpiryKpi.critical}`,
      `Warning: ${data.stockExpiryKpi.warning}`,
    ],
  }
}
