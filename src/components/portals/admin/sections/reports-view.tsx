'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { subscribeDataSync } from '@/lib/data-sync'
import { useAuth } from '@/app/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PortalDashboardSkeleton } from '@/components/portals/shared/loading-skeletons'
import {
  Truck,
  MessageSquare,
  BarChart3,
  Building2,
  FileText,
  FileSpreadsheet,
  Download,
  Receipt,
  FileCheck,
  RotateCcw,
  Store,
  Trophy,
} from 'lucide-react'
import {
  PurchaseRequestsReport,
  PurchaseOrdersReport,
  TransactionsReport,
  LogisticsReport,
  ReplacementRecordsReport,
  RetailSalesReport,
  TopClientsReport,
} from './reports'
import { getCollection, fetchAllPaginatedCollection, safeFetchJson } from './shared'
import { exportToCsv } from './reports/export-utils'
import { downloadReportPdf, type ReportPdfOptions } from './reports/report-pdf'
import { type ReportToolbarConfig } from './reports/chart-styles'
import { buildReportStamp, type ReportDatePreset } from './report-date-utils'
import { useReportDatasets } from './reports/use-report-datasets'
import { FeedbackReportTab } from './reports/feedback-report-tab'
import { ReplacementReportTab } from './reports/replacement-report-tab'
import { InventoryReportTab } from './reports/inventory-report-tab'
import { WarehouseReportTab } from './reports/warehouse-report-tab'
import { TransportReportTab } from './reports/transport-report-tab'
import { OrdersReportTab } from './reports/orders-report-tab'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function ReportsView() {
  const { user } = useAuth()
  const [activeReportTab, setActiveReportTab] = useState('purchase_requests')
  const [rangeDays, setRangeDays] = useState<'today' | '7' | '30' | '90'>('30')
  const [selectedDriver, setSelectedDriver] = useState('all')
  const [selectedOrderStatus, setSelectedOrderStatus] = useState('all')
  const [selectedTripStatus, setSelectedTripStatus] = useState('all')
  const [selectedDriverRating, setSelectedDriverRating] = useState<'all' | '4_up' | '3_up' | 'below_3'>('all')
  const [selectedDriverTripVolume, setSelectedDriverTripVolume] = useState<'all' | 'with_trips' | '10_plus'>('all')
  const [selectedMovementType, setSelectedMovementType] = useState('all')
  const [selectedReplacementStatus, setSelectedReplacementStatus] = useState('all')
  const [feedbackDatePreset, setFeedbackDatePreset] = useState<ReportDatePreset>('30')
  const [feedbackDateFrom, setFeedbackDateFrom] = useState('')
  const [feedbackDateTo, setFeedbackDateTo] = useState('')
  const [warehouseDatePreset, setWarehouseDatePreset] = useState<ReportDatePreset>('30')
  const [warehouseDateFrom, setWarehouseDateFrom] = useState('')
  const [warehouseDateTo, setWarehouseDateTo] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [orders, setOrders] = useState<any[]>([])
  const [trips, setTrips] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [inventory, setInventory] = useState<any[]>([])
  const [inventoryTransactions, setInventoryTransactions] = useState<any[]>([])
  const [replacementsData, setReplacementsData] = useState<any[]>([])
  const [feedback, setFeedback] = useState<any[]>([])
  const [stockBatches, setStockBatches] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [retailSales, setRetailSales] = useState<any[]>([])
  const reportBranding = {
    companyName: "Ann Ann's Beverages Trading",
  }
  useEffect(() => {
    let isMounted = true

    async function fetchReportsPack() {
      setIsLoading(true)
      try {
        const [ordersRes, tripsRes, driversRes, warehousesRes, inventoryRes, transactionsRes, replacementsRes, feedbackRes, stockBatchesRes, customersRes, retailSalesRes] = await Promise.all([
          fetchAllPaginatedCollection<any>('/api/orders', 'orders', undefined, {
            retries: 1,
            timeoutMs: 20000,
            pageSize: 200,
            maxPages: 100,
          }),
          safeFetchJson('/api/trips?limit=1000', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/drivers?limit=500&includeSample=true', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/warehouses?limit=200', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/inventory?limit=1000', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/inventory-transactions?limit=1000', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/replacements?limit=1000', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/feedback?limit=1000', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/stock-batches?page=1&pageSize=2000', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/customers?limit=1000', undefined, { retries: 1, timeoutMs: 20000 }),
          safeFetchJson('/api/retail/sales?limit=1000', undefined, { retries: 1, timeoutMs: 20000 }),
        ])

        if (!isMounted) return

        setOrders(ordersRes.ok ? getCollection<any>(ordersRes.data, ['orders']) : [])
        setTrips(tripsRes.ok ? getCollection<any>(tripsRes.data, ['trips']) : [])
        setDrivers(driversRes.ok ? getCollection<any>(driversRes.data, ['drivers']) : [])
        setWarehouses(warehousesRes.ok ? getCollection<any>(warehousesRes.data, ['warehouses']) : [])
        setInventory(inventoryRes.ok ? getCollection<any>(inventoryRes.data, ['inventory']) : [])
        setInventoryTransactions(transactionsRes.ok ? getCollection<any>(transactionsRes.data, ['transactions']) : [])
        const fallbackReplacements = ordersRes.ok ? getCollection<any>(ordersRes.data, ['replacements']) : []
        setReplacementsData(replacementsRes.ok ? getCollection<any>(replacementsRes.data, ['replacements']) : fallbackReplacements)
        setFeedback(feedbackRes.ok ? getCollection<any>(feedbackRes.data, ['feedback']) : [])
        // The stock batches endpoint returns `stockBatches`, not `batches`, so read the real collection key first.
        setStockBatches(stockBatchesRes.ok ? getCollection<any>(stockBatchesRes.data, ['stockBatches', 'batches']) : [])
        setCustomers(customersRes.ok ? getCollection<any>(customersRes.data, ['customers', 'users']) : [])
        setRetailSales(retailSalesRes.ok ? getCollection<any>(retailSalesRes.data, ['sales', 'retailSales']) : [])
      } catch (error) {
        console.error('Failed to load reports pack:', error)
        if (isMounted) {
          setOrders([])
          setTrips([])
          setDrivers([])
          setWarehouses([])
          setInventory([])
          setInventoryTransactions([])
          setReplacementsData([])
          setFeedback([])
          setStockBatches([])
          setCustomers([])
          setRetailSales([])
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchReportsPack()

    const unsubscribe = subscribeDataSync((message) => {
      if (
        message.scopes.includes('orders') ||
        message.scopes.includes('trips') ||
        message.scopes.includes('inventory') ||
        message.scopes.includes('stocks') ||
        message.scopes.includes('feedback') ||
        message.scopes.includes('replacements')
      ) {
        void fetchReportsPack()
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const {
    driverPerformanceKpi,
    driverPerformanceStatusOptions,
    feedbackDateWindow,
    feedbackExportRows,
    feedbackKpi,
    feedbackRatingChart,
    feedbackRatingTotal,
    feedbackRows,
    feedbackSummaryLines,
    inventoryExportRows,
    inventoryKpi,
    inventoryMovementByProductChart,
    inventoryMovementChart,
    inventoryMovementRows,
    inventoryMovementSummary,
    inventoryMovementTypeOptions,
    inventorySummaryLines,
    lowStockKpi,
    lowStockRows,
    orderExportRows,
    orderKpi,
    orderOutcomeTrendChart,
    orderRows,
    orderStatusChart,
    orderStatusOptions,
    orderSummaryLines,
    replacementKpi,
    replacementLossTrendChart,
    replacementRows,
    replacementStatusOptions,
    replacementSummaryLines,
    standardDateRangeLabel,
    stockExpiryKpi,
    stockExpiryRows,
    stockTrendSummary,
    transportCompletionBandChart,
    transportDriverRows,
    transportExportRows,
    transportSummaryLines,
    transportTopDrivers,
    warehouseCapacityTrendSummaryLines,
    warehouseCapacityVsUsedChart,
    warehouseDateWindow,
    warehouseSummaryLines,
    warehouseUtilizationRowsForExport,
  } = useReportDatasets({
    drivers,
    feedback,
    feedbackDateFrom,
    feedbackDatePreset,
    feedbackDateTo,
    inventory,
    inventoryTransactions,
    orders,
    rangeDays,
    replacementsData,
    selectedDriver,
    selectedDriverRating,
    selectedDriverTripVolume,
    selectedMovementType,
    selectedOrderStatus,
    selectedReplacementStatus,
    selectedTripStatus,
    stockBatches,
    trips,
    warehouseDateFrom,
    warehouseDatePreset,
    warehouseDateTo,
    warehouses,
  })

  const downloadPdf = (
    filename: string,
    title: string,
    rows: Array<Record<string, unknown>>,
    options?: ReportPdfOptions,
  ) => downloadReportPdf(
    { driverPerformanceKpi, feedbackExportRows, inventoryMovementSummary, replacementRows, stockExpiryKpi, stockExpiryRows, transportDriverRows, warehouses },
    filename,
    title,
    rows,
    options,
  )
  const exportAllPdf = async () => {
    const stamp = buildReportStamp()
    await downloadPdf(`orders-report-${stamp}.pdf`, 'Order Report', orderExportRows, {
      ...reportBranding,
      summaryLines: orderSummaryLines,
      rangeLabel: standardDateRangeLabel,
    })
    await downloadPdf(`transport-report-${stamp}.pdf`, 'Transportation Driver Performance Report', transportExportRows, {
      ...reportBranding,
      summaryLines: transportSummaryLines,
      rangeLabel: standardDateRangeLabel,
    })
    await downloadPdf(`warehouse-report-${stamp}.pdf`, 'Warehouse Utilization Report', warehouseUtilizationRowsForExport, {
      ...reportBranding,
      summaryLines: warehouseSummaryLines,
      rangeLabel: warehouseDateWindow.label,
      extraSections: [
        {
          title: 'Utilization Highlights',
          lines: warehouseCapacityTrendSummaryLines,
        },
      ],
    })
    await downloadPdf(`inventory-report-${stamp}.pdf`, 'Inventory Movement Report', inventoryExportRows, {
      ...reportBranding,
      summaryLines: inventorySummaryLines,
      rangeLabel: standardDateRangeLabel,
    })
    await downloadPdf(`replacement-report-${stamp}.pdf`, 'Replacement Handling Report', replacementRows, {
      ...reportBranding,
      summaryLines: replacementSummaryLines,
      rangeLabel: standardDateRangeLabel,
    })
    await downloadPdf(`feedback-report-${stamp}.pdf`, 'Client Feedback & Service Evaluation Report', feedbackExportRows, {
      ...reportBranding,
      summaryLines: feedbackSummaryLines,
      rangeLabel: feedbackDateWindow.label,
    })
    toast.success('All PDF reports exported')
  }

  const resetFilters = () => {
    setRangeDays('30')
    setWarehouseDatePreset('30')
    setWarehouseDateFrom('')
    setWarehouseDateTo('')
    setSelectedDriver('all')
    setSelectedOrderStatus('all')
    setSelectedTripStatus('all')
    setSelectedDriverRating('all')
    setSelectedDriverTripVolume('all')
    setSelectedMovementType('all')
    setSelectedReplacementStatus('all')
    setFeedbackDatePreset('30')
    setFeedbackDateFrom('')
    setFeedbackDateTo('')
  }

  // Export the filtered rows used by each shared report toolbar.
  const exportCurrentCsv = () => {
    const reportMap: Record<string, { filename: string; rows: Array<Record<string, unknown>> }> = {
      orders: { filename: 'orders-report', rows: orderExportRows },
      transport: { filename: 'transport-report', rows: transportExportRows },
      inventory: { filename: 'inventory-report', rows: inventoryExportRows },
      replacement: { filename: 'replacement-report', rows: replacementRows },
      feedback: { filename: 'feedback-report', rows: feedbackExportRows },
    }
    const report = reportMap[activeReportTab]

    if (!report || report.rows.length === 0) {
      toast.error('No report data to export')
      return
    }

    const columns = Object.keys(report.rows[0]).map((key) => ({
      header: key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (character) => character.toUpperCase()),
      key,
    }))
    exportToCsv(`${report.filename}-${buildReportStamp()}.csv`, columns, report.rows)
  }

  const reportToolbar = ({
    title,
    statusLabel,
    statusOptions = [],
    statusValue = 'all',
    onStatusChange = () => undefined,
    showWarehouse = false,
    showDriver = false,
    showStatus = true,
  }: ReportToolbarConfig) => (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {title !== 'Warehouse' && title !== 'Feedback' ? (
          <select
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            value={rangeDays}
            onChange={(event) => setRangeDays(event.target.value as 'today' | '7' | '30' | '90')}
            title="Select report date range"
          >
            <option value="today">Today</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        ) : null}
        {title === 'Feedback' ? (
          <>
            <select
              className="h-11 min-w-[190px] rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              value={feedbackDatePreset}
              onChange={(event) => setFeedbackDatePreset(event.target.value as ReportDatePreset)}
              title="Select feedback report date range"
              aria-label="Filter feedback by date range"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7">Past 7 Days</option>
              <option value="30">Past 30 Days</option>
              <option value="90">Past 90 Days</option>
              <option value="365">Past 1 Year</option>
              <option value="custom">Custom Date Range</option>
            </select>
            {feedbackDatePreset === 'custom' ? (
              <>
                <Input type="date" onClick={(event) => event.currentTarget.showPicker?.()} value={feedbackDateFrom} onChange={(event) => setFeedbackDateFrom(event.target.value)} className="h-11 w-[170px]" aria-label="Feedback date from" />
                <Input type="date" onClick={(event) => event.currentTarget.showPicker?.()} value={feedbackDateTo} onChange={(event) => setFeedbackDateTo(event.target.value)} className="h-11 w-[170px]" aria-label="Feedback date to" />
              </>
            ) : null}
          </>
        ) : null}
        {title === 'Warehouse' ? (
          <>
            <select
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
              value={warehouseDatePreset}
              onChange={(event) => setWarehouseDatePreset(event.target.value as ReportDatePreset)}
              title="Select warehouse report date range"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7">Past 7 Days</option>
              <option value="30">Past 30 Days</option>
              <option value="90">Past 90 Days</option>
              <option value="365">Past 1 Year</option>
              <option value="custom">Custom Date Range</option>
            </select>
            <Input
              type="date"
              onClick={(event) => event.currentTarget.showPicker?.()}
              value={warehouseDateFrom}
              onChange={(event) => setWarehouseDateFrom(event.target.value)}
              disabled={warehouseDatePreset !== 'custom'}
              className="h-10 w-[170px]"
              title="Warehouse report date from"
            />
            <Input
              type="date"
              onClick={(event) => event.currentTarget.showPicker?.()}
              value={warehouseDateTo}
              onChange={(event) => setWarehouseDateTo(event.target.value)}
              disabled={warehouseDatePreset !== 'custom'}
              className="h-10 w-[170px]"
              title="Warehouse report date to"
            />
          </>
        ) : null}
        {showWarehouse ? (
          <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
            Warehouse: {warehouses[0]?.name || warehouses[0]?.code || 'Not registered'}
          </div>
        ) : null}
        {showDriver ? (
          <select
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            value={selectedDriver}
            onChange={(event) => setSelectedDriver(event.target.value)}
            title="Filter by driver"
          >
            <option value="all">All Drivers</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver?.user?.name || driver.name || driver.id}
              </option>
            ))}
          </select>
        ) : null}
        {showStatus ? (
          <select
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            value={statusValue}
            onChange={(event) => onStatusChange(event.target.value)}
            title={`Filter by ${String(statusLabel || 'status').toLowerCase()}`}
          >
            <option value="all">All {statusLabel || 'Statuses'}</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        ) : null}
        <Button variant="outline" className="gap-2 rounded-lg border-slate-200" onClick={resetFilters}>
          Reset Filters
        </Button>
        {title === 'Warehouse' ? (
          <>
            <Button variant="outline" className="gap-2 rounded-lg border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => void exportWarehousePdf(buildReportStamp())} disabled={isLoading}>
              <Download className="h-4 w-4" />
              Export Warehouse PDF
            </Button>
            <Button variant="outline" className="gap-2 rounded-lg border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => void exportInventoryPdf(buildReportStamp())} disabled={isLoading}>
              <Download className="h-4 w-4" />
              Export Inventory PDF
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" className="h-11 gap-2 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50" onClick={exportCurrentCsv} disabled={isLoading}>
              <FileSpreadsheet className="h-4 w-4" />
              Export CSV
            </Button>
            <Button variant="outline" className="h-11 gap-2 rounded-xl border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-100" onClick={() => void exportCurrentPdf()} disabled={isLoading}>
              <Download className="h-4 w-4" />
              {`Export ${title} PDF`}
            </Button>
          </>
        )}
      </div>
    </div>
  )

  const exportWarehousePdf = async (stamp: string) => {
    await downloadPdf(
      `warehouse-report-${stamp}.pdf`,
      'Warehouse Utilization Report',
      warehouseUtilizationRowsForExport,
      {
        ...reportBranding,
        summaryLines: warehouseSummaryLines,
        rangeLabel: warehouseDateWindow.label,
        extraSections: [
          {
            title: 'Utilization Highlights',
            lines: warehouseCapacityTrendSummaryLines,
          },
        ],
      }
    )
  }

  const exportInventoryPdf = async (stamp: string) => {
    await downloadPdf(
      `inventory-report-${stamp}.pdf`,
      'Inventory Movement Report',
      inventoryExportRows,
      {
        ...reportBranding,
        summaryLines: inventorySummaryLines,
        rangeLabel: standardDateRangeLabel,
      }
    )
  }

  const exportCurrentPdf = async () => {
    const stamp = buildReportStamp()
    if (activeReportTab === 'orders') {
      await downloadPdf(`orders-report-${stamp}.pdf`, 'Order Report', orderExportRows, {
        ...reportBranding,
        summaryLines: orderSummaryLines,
        rangeLabel: standardDateRangeLabel,
      })
      return
    }
    if (activeReportTab === 'transport') {
      await downloadPdf(`transport-report-${stamp}.pdf`, 'Transportation Driver Performance Report', transportExportRows, {
        ...reportBranding,
        summaryLines: transportSummaryLines,
        rangeLabel: standardDateRangeLabel,
      })
      return
    }
    if (activeReportTab === 'warehouse') {
      await exportWarehousePdf(stamp)
      return
    }
    if (activeReportTab === 'inventory') {
      await exportInventoryPdf(stamp)
      return
    }
    if (activeReportTab === 'replacement') {
      await downloadPdf(`replacement-report-${stamp}.pdf`, 'Replacement Handling Report', replacementRows, {
        ...reportBranding,
        summaryLines: replacementSummaryLines,
        rangeLabel: standardDateRangeLabel,
      })
      return
    }
    await downloadPdf(`feedback-report-${stamp}.pdf`, 'Client Feedback & Service Evaluation Report', feedbackExportRows, {
      ...reportBranding,
      summaryLines: feedbackSummaryLines,
      rangeLabel: feedbackDateWindow.label,
    })
  }

  const printCurrentReport = () => {
    const reportMap: Record<string, { title: string; rows: Array<Record<string, unknown>>; summaryLines: string[] }> = {
      orders: { title: 'Order Report', rows: orderExportRows, summaryLines: orderSummaryLines },
      transport: { title: 'Transportation Driver Performance Report', rows: transportExportRows, summaryLines: transportSummaryLines },
      warehouse: { title: 'Warehouse Utilization Report', rows: warehouseUtilizationRowsForExport, summaryLines: warehouseSummaryLines },
      inventory: { title: 'Inventory Movement Report', rows: inventoryExportRows, summaryLines: inventorySummaryLines },
      replacement: { title: 'Replacement Handling Report', rows: replacementRows, summaryLines: replacementSummaryLines },
      feedback: { title: 'Client Feedback & Service Evaluation Report', rows: feedbackExportRows, summaryLines: feedbackSummaryLines },
    }

    const report = reportMap[activeReportTab]
    if (!report || report.rows.length === 0) {
      toast.error('No report data to print')
      return
    }

    const columns = Object.keys(report.rows[0])
    const summaryLines = report.summaryLines
    const reportDateLabel = activeReportTab === 'warehouse'
      ? warehouseDateWindow.label
      : activeReportTab === 'feedback'
        ? feedbackDateWindow.label
        : standardDateRangeLabel
    const bodyRows = report.rows
      .slice(0, 300)
      .map((row) => `<tr>${columns.map((column) => `<td>${String(row[column] ?? '').replace(/</g, '&lt;')}</td>`).join('')}</tr>`)
      .join('')

    const html = `
      <html>
        <head>
          <title>${report.title}</title>
          <style>
            body { font-family: 'Trebuchet MS', 'Segoe UI', Arial, sans-serif; margin: 24px; color: #111; font-size: 13px; line-height: 1.45; }
            h1 { margin: 0 0 4px 0; font-size: 24px; font-family: 'Trebuchet MS', 'Segoe UI', Arial, sans-serif; }
            p { margin: 0 0 12px 0; color: #333; font-family: 'Trebuchet MS', 'Segoe UI', Arial, sans-serif; }
            table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-family: 'Trebuchet MS', 'Segoe UI', Arial, sans-serif; table-layout: fixed; }
            th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; word-break: break-word; }
            th { background: #eef2ff; font-weight: 700; color: #0f172a; }
            tbody tr:nth-child(even) { background: #f8fafc; }
            .summary { margin: 16px 0 0 0; }
            .summary-line { font-size: 13px; color: #334155; margin: 0 0 4px 0; font-family: 'Trebuchet MS', 'Segoe UI', Arial, sans-serif; }
          </style>
        </head>
        <body>
          <h1>${reportBranding.companyName}</h1>
          <p><strong>${report.title}</strong></p>
          <p>Generated at ${new Date().toLocaleString()} | Date range: ${reportDateLabel}</p>
          <table>
            <thead>
              <tr>${columns.map((column) => `<th>${column.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()).trim()}</th>`).join('')}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
          <div class="summary">
            ${summaryLines.map((line) => `<p class="summary-line">${line}</p>`).join('')}
          </div>
        </body>
      </html>
    `

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Unable to open print window')
      return
    }
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-cyan-50/70 px-5 py-6 shadow-[0_18px_45px_rgba(30,64,175,0.08)] sm:px-7">
        <div className="relative flex items-center gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white shadow-[0_10px_24px_rgba(37,99,235,0.24)]">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Business intelligence</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-[30px]">Reports & Analytics</h1>
            <p className="mt-1 text-sm text-slate-600">Operational records, performance trends, and decision-ready summaries in one workspace.</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <PortalDashboardSkeleton />
      ) : (
        <Tabs value={activeReportTab} onValueChange={setActiveReportTab} className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <TabsList className="flex flex-wrap h-auto w-full gap-1.5 bg-transparent p-0">
              <TabsTrigger value="purchase_requests" className="h-10 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><FileText className="h-4 w-4" />Purchase Requests</TabsTrigger>
              <TabsTrigger value="purchase_orders" className="h-10 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><FileCheck className="h-4 w-4" />Purchase Orders</TabsTrigger>
              <TabsTrigger value="transactions" className="h-10 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Receipt className="h-4 w-4" />Transaction Records</TabsTrigger>
              <TabsTrigger value="logistics" className="h-10 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Truck className="h-4 w-4" />Logistics Records</TabsTrigger>
              <TabsTrigger value="replacement_records" className="h-10 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><RotateCcw className="h-4 w-4" />Replacement Records</TabsTrigger>
              <TabsTrigger value="retail_sales" className="h-10 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Store className="h-4 w-4" />Retail Sales</TabsTrigger>
              <TabsTrigger value="top_clients" className="h-10 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Trophy className="h-4 w-4" />Top Clients</TabsTrigger>
              <TabsTrigger value="warehouse" className="h-10 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Building2 className="h-4 w-4" />Warehouse & Inventory</TabsTrigger>
              <TabsTrigger value="feedback" className="h-10 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><MessageSquare className="h-4 w-4" />Feedback</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="orders" className="space-y-4">
            <OrdersReportTab
              orderKpi={orderKpi}
              orderOutcomeTrendChart={orderOutcomeTrendChart}
              orderRows={orderRows}
              orderStatusChart={orderStatusChart}
              orderStatusOptions={orderStatusOptions}
              orders={orders}
              reportToolbar={reportToolbar}
              selectedOrderStatus={selectedOrderStatus}
              setSelectedOrderStatus={setSelectedOrderStatus}
            />
          </TabsContent>

          <TabsContent value="transport" className="space-y-4">
            <TransportReportTab
              driverPerformanceKpi={driverPerformanceKpi}
              driverPerformanceStatusOptions={driverPerformanceStatusOptions}
              drivers={drivers}
              reportToolbar={reportToolbar}
              selectedDriverRating={selectedDriverRating}
              selectedDriverTripVolume={selectedDriverTripVolume}
              selectedTripStatus={selectedTripStatus}
              setSelectedDriverRating={setSelectedDriverRating}
              setSelectedDriverTripVolume={setSelectedDriverTripVolume}
              setSelectedTripStatus={setSelectedTripStatus}
              transportCompletionBandChart={transportCompletionBandChart}
              transportDriverRows={transportDriverRows}
              transportTopDrivers={transportTopDrivers}
              trips={trips}
            />
          </TabsContent>

          <TabsContent value="warehouse" className="report-design-system space-y-8">
            <WarehouseReportTab
              inventory={inventory}
              inventoryKpi={inventoryKpi}
              inventoryMovementByProductChart={inventoryMovementByProductChart}
              inventoryMovementChart={inventoryMovementChart}
              inventoryMovementRows={inventoryMovementRows}
              inventoryMovementTypeOptions={inventoryMovementTypeOptions}
              inventoryTransactions={inventoryTransactions}
              lowStockKpi={lowStockKpi}
              lowStockRows={lowStockRows}
              orders={orders}
              reportToolbar={reportToolbar}
              retailSales={retailSales}
              selectedMovementType={selectedMovementType}
              setSelectedMovementType={setSelectedMovementType}
              stockBatches={stockBatches}
              stockExpiryKpi={stockExpiryKpi}
              stockExpiryRows={stockExpiryRows}
              stockTrendSummary={stockTrendSummary}
              warehouseCapacityVsUsedChart={warehouseCapacityVsUsedChart}
              warehouses={warehouses}
            />
          </TabsContent>

          <TabsContent value="inventory" className="space-y-4">
            <InventoryReportTab
              inventory={inventory}
              inventoryKpi={inventoryKpi}
              inventoryMovementByProductChart={inventoryMovementByProductChart}
              inventoryMovementRows={inventoryMovementRows}
              inventoryMovementTypeOptions={inventoryMovementTypeOptions}
              lowStockKpi={lowStockKpi}
              lowStockRows={lowStockRows}
              reportToolbar={reportToolbar}
              selectedMovementType={selectedMovementType}
              setSelectedMovementType={setSelectedMovementType}
            />
          </TabsContent>

          <TabsContent value="replacement" className="space-y-4">
            <ReplacementReportTab
              replacementKpi={replacementKpi}
              replacementLossTrendChart={replacementLossTrendChart}
              replacementRows={replacementRows}
              replacementStatusOptions={replacementStatusOptions}
              reportToolbar={reportToolbar}
              selectedReplacementStatus={selectedReplacementStatus}
              setSelectedReplacementStatus={setSelectedReplacementStatus}
            />
          </TabsContent>

          <TabsContent value="feedback" className="report-design-system space-y-4">
            <FeedbackReportTab
              feedback={feedback}
              feedbackKpi={feedbackKpi}
              feedbackRatingChart={feedbackRatingChart}
              feedbackRatingTotal={feedbackRatingTotal}
              feedbackRows={feedbackRows}
              reportToolbar={reportToolbar}
            />
          </TabsContent>

          <TabsContent value="purchase_requests" className="space-y-4">
            <PurchaseRequestsReport orders={orders} warehouses={warehouses} />
          </TabsContent>

          <TabsContent value="purchase_orders" className="space-y-4">
            <PurchaseOrdersReport orders={orders} warehouses={warehouses} />
          </TabsContent>

          <TabsContent value="transactions" className="space-y-4">
            <TransactionsReport orders={orders} retailSales={retailSales} />
          </TabsContent>

          <TabsContent value="logistics" className="space-y-4">
            <LogisticsReport trips={trips} drivers={drivers} warehouses={warehouses} />
          </TabsContent>

          <TabsContent value="replacement_records" className="space-y-4">
            <ReplacementRecordsReport replacements={replacementsData} orders={orders} />
          </TabsContent>

          <TabsContent value="retail_sales" className="space-y-4">
            <RetailSalesReport orders={orders} retailSales={retailSales} />
          </TabsContent>

          <TabsContent value="top_clients" className="space-y-4">
            <TopClientsReport orders={orders} customers={customers} />
          </TabsContent>

        </Tabs>
      )}
    </div>
  )
}
