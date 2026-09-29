'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WarehouseInventoryReport } from '.'
import {
  CartesianGrid,
  YAxis,
  XAxis,
  LineChart,
  Line,
  Tooltip,
  BarChart,
  Bar,
  ResponsiveContainer,
  Legend,
  LabelList,
} from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeComparison, describeRanking, toPoints } from '@/lib/chart-interpretation'
import { chartBucketNoun } from '@/lib/report-metrics'
import { chartCardClassName, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle, previewRows } from './chart-styles'
import type { ReportDatasets } from './use-report-datasets'
import type { ReportToolbarRenderer } from './chart-styles'
import { ReportKpiRow } from './report-kpi'
import { formatReportTableDateTime } from '@/components/portals/admin/sections/report-date-utils'
import { exportReportPdf, exportToCsv, printReportTable } from './export-utils'
import {
  InventoryReportHeader,
  InventoryReportTypeSelect,
  type InventoryReportType,
} from './inventory-report-header'
import { INVENTORY_REPORT_HEADERS, buildInventoryReportExport } from './inventory-report-exports'

/**
 * Inventory tab: product velocity, stock movement, low stock and batch expiry,
 * one report at a time, picked from the dropdown in the report header.
 * Storage capacity and utilization belong to the warehouse tab.
 */
export type InventoryReportTabProps = {
  inventory: any[]
  inventoryKpi: ReportDatasets['inventoryKpi']
  inventoryMovementByProductChart: ReportDatasets['inventoryMovementByProductChart']
  inventoryMovementChart: ReportDatasets['inventoryMovementChart']
  inventoryMovementRows: ReportDatasets['inventoryMovementRows']
  inventoryMovementTypeOptions: ReportDatasets['inventoryMovementTypeOptions']
  inventoryTransactions: any[]
  lowStockKpi: ReportDatasets['lowStockKpi']
  lowStockRows: ReportDatasets['lowStockRows']
  /** Label of the shared date range the movement figures are filtered by. */
  movementRangeLabel: string
  orders: any[]
  reportToolbar: ReportToolbarRenderer
  retailSales: any[]
  selectedMovementType: string
  setSelectedMovementType: Dispatch<SetStateAction<string>>
  stockBatches: any[]
  stockExpiryKpi: ReportDatasets['stockExpiryKpi']
  stockExpiryRows: ReportDatasets['stockExpiryRows']
  stockTrendSummary: ReportDatasets['stockTrendSummary']
  warehouses: any[]
}

export function InventoryReportTab({
  inventory,
  inventoryKpi,
  inventoryMovementByProductChart,
  inventoryMovementChart,
  inventoryMovementRows,
  inventoryMovementTypeOptions,
  inventoryTransactions,
  lowStockKpi,
  lowStockRows,
  movementRangeLabel,
  orders,
  reportToolbar,
  retailSales,
  selectedMovementType,
  setSelectedMovementType,
  stockBatches,
  stockExpiryKpi,
  stockExpiryRows,
  stockTrendSummary,
  warehouses,
}: InventoryReportTabProps) {
  // Both charts are truncated to the top five, so the readings describe the same slice.
  const topMovementProducts = inventoryMovementByProductChart.slice(0, 5)
  const movementInterpretation = describeComparison(
    { name: 'Stock in', points: toPoints(topMovementProducts, (row: any) => row.name, (row: any) => row.inQty) },
    { name: 'Stock out', points: toPoints(topMovementProducts, (row: any) => row.name, (row: any) => row.outQty) },
    {
      noun: 'units',
      periodNoun: 'product',
      emptyMessage: 'No product movement falls inside the selected range, so there is nothing to interpret yet.',
    }
  )
  const movementIn = inventoryMovementChart.reduce((sum, row: any) => sum + Number(row.inQty || 0), 0)
  const movementOut = inventoryMovementChart.reduce((sum, row: any) => sum + Number(row.outQty || 0), 0)
  const movementNet = movementIn - movementOut
  // What the two lines add up to for the shelves is the question this chart answers.
  const movementNetReading = movementIn + movementOut === 0
    ? ''
    : movementNet > 0
      ? ` Overall, ${movementNet.toLocaleString('en-US')} more units came in than went out, so stock built up.`
      : movementNet < 0
        ? ` Overall, ${Math.abs(movementNet).toLocaleString('en-US')} more units went out than came in, so stock was drawn down.`
        : ' Overall, as many units came in as went out, so stock levels held.'
  const movementTrendInterpretation = `${describeComparison(
    { name: 'Stock in', points: toPoints(inventoryMovementChart, (row: any) => row.label, (row: any) => row.inQty) },
    { name: 'Stock out', points: toPoints(inventoryMovementChart, (row: any) => row.label, (row: any) => row.outQty) },
    {
      noun: 'units',
      // Longer ranges draw weekly or monthly bars.
      periodNoun: chartBucketNoun(inventoryMovementChart),
      emptyMessage: 'No stock movement falls inside the selected range, so there is nothing to interpret yet.',
    }
  )}${movementNetReading}`
  const [reportType, setReportType] = useState<InventoryReportType>('fast-moving')
  const reportTypeSelect = <InventoryReportTypeSelect value={reportType} onChange={setReportType} />
  const topLowStock = lowStockRows.slice(0, 5)
  const lowStockPoints = toPoints(
    topLowStock,
    (row: any) => row.product,
    (row: any) => Math.max(0, Number(row.reorderPoint || 0) - Number(row.currentStock || 0))
  )
  const furthestBelow = [...lowStockPoints].sort((a, b) => b.value - a.value)[0]
  const lowStockInterpretation = `${describeRanking(lowStockPoints, {
    noun: 'units below the reorder point',
    entityNoun: 'product',
    emptyMessage: 'Every tracked product is at or above its reorder point, so no replenishment is flagged.',
  })}${furthestBelow && furthestBelow.value > 0 ? ` Restock ${furthestBelow.label} first.` : ''}`

  if (reportType === 'fast-moving') {
    return (
      <WarehouseInventoryReport
        inventory={inventory}
        inventoryTransactions={inventoryTransactions}
        orders={orders}
        retailSales={retailSales}
        warehouses={warehouses}
        stockBatches={stockBatches}
        reportTypeSelect={reportTypeSelect}
      />
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const report = buildInventoryReportExport(reportType, {
    inventoryKpi,
    inventoryMovementRows,
    lowStockKpi,
    lowStockRows,
    movementRangeLabel,
    selectedMovementType,
    stockExpiryKpi,
    stockExpiryRows,
  })
  const header = INVENTORY_REPORT_HEADERS[reportType]

  return (
    <div className="report-design-system flex flex-col gap-6">
      <InventoryReportHeader
        title={header.title}
        badge={header.badge}
        description={header.description}
        reportTypeSelect={reportTypeSelect}
        onExportCsv={() => exportToCsv(`${report.filename}-${today}.csv`, report.columns, report.rows)}
        onExportPdf={() => void exportReportPdf(`${report.filename}-${today}.pdf`, header.title, report.columns, report.rows, report.summaryLines, report.dateLabel)}
        onPrint={() => printReportTable(header.title, report.columns, report.rows, report.summaryLines, report.dateLabel)}
      />

      {reportType === 'stock-movement' ? (
        <>
          {reportToolbar({
            title: 'Inventory',
            statusLabel: 'Movement Types',
            statusOptions: inventoryMovementTypeOptions,
            statusValue: selectedMovementType,
            onStatusChange: setSelectedMovementType,
            showWarehouse: true,
            showExports: false,
          })}

          <ReportKpiRow
            items={[
              { label: 'Total On Hand', value: inventoryKpi.totalQuantity, hint: 'Units available', tone: 'slate' },
              { label: 'Stock In', value: inventoryKpi.stockIn, hint: 'Received in period', tone: 'blue' },
              { label: 'Stock Out', value: inventoryKpi.stockOut, hint: 'Issued in period', tone: 'purple' },
            ]}
          />

          <Card className={chartCardClassName}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Inventory Movement by Product</CardTitle>
                  <CardDescription>Top products by movement volume</CardDescription>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">Top 5 Products</div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                {inventoryMovementByProductChart.length === 0 ? (
                  <p className="py-8 text-center text-gray-500">No product movement data for this range</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={inventoryMovementByProductChart.slice(0, 5)} margin={{ top: 10, right: 20, left: 0, bottom: 26 }} barGap={8}>
                      <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} tickCount={5} />
                      <Legend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: '8px', color: '#64748b', fontSize: '12px' }} iconType="rect" />
                      <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} formatter={(value: any, name: any) => [`${Number(value).toLocaleString()} units`, name]} />
                      <Bar dataKey="inQty" name="Stock In" fill="#38bdf8" radius={[4, 4, 0, 0]} maxBarSize={22}><LabelList dataKey="inQty" position="top" fill="#0f172a" fontSize={11} /></Bar>
                      <Bar dataKey="outQty" name="Stock Out" fill="#fbbf24" radius={[4, 4, 0, 0]} maxBarSize={22}><LabelList dataKey="outQty" position="top" fill="#0f172a" fontSize={11} /></Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <ChartInterpretation text={movementInterpretation} />
            </CardContent>
          </Card>

        <Card className={chartCardClassName}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-3xl font-bold tracking-tight text-slate-800">Stock In vs Stock Out Trend</CardTitle>
                <CardDescription>Track stock movement over time</CardDescription>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">
                {inventoryMovementChart[0]?.label || 'N/A'} - {inventoryMovementChart[inventoryMovementChart.length - 1]?.label || 'N/A'}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {inventoryMovementChart.length === 0 ? (
              <p className="py-8 text-center text-gray-500">No movement trend data for this range</p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-2">
                  <div className="rounded-2xl border border-blue-100 bg-slate-50 p-5">
                    <p className="text-sm font-medium text-slate-600">Total Stock In</p>
                    <p className="text-4xl font-bold text-blue-600 mt-1">{stockTrendSummary.totalIn.toLocaleString()}</p>
                    <p className="text-sm text-slate-500">units</p>
                    <p className="mt-2 inline-block rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                      {stockTrendSummary.inChangePercent >= 0 ? '+' : ''}{stockTrendSummary.inChangePercent.toFixed(1)}% vs previous period
                    </p>
                  </div>
                  <div className="rounded-2xl border border-amber-100 bg-amber-50/40 p-5">
                    <p className="text-sm font-medium text-slate-600">Total Stock Out</p>
                    <p className="text-4xl font-bold text-amber-600 mt-1">{stockTrendSummary.totalOut.toLocaleString()}</p>
                    <p className="text-sm text-slate-500">units</p>
                    <p className="mt-2 inline-block rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                      {stockTrendSummary.outChangePercent >= 0 ? '+' : ''}{stockTrendSummary.outChangePercent.toFixed(1)}% vs previous period
                    </p>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="h-[360px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={inventoryMovementChart} margin={{ top: 24, right: 22, left: 8, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        labelStyle={chartTooltipLabelStyle}
                        itemStyle={chartTooltipItemStyle}
                        formatter={(value: any, name: any) => [`${Number(value).toLocaleString()} units`, name]}
                      />
                      <Legend wrapperStyle={{ paddingTop: '8px', color: '#475569' }} iconType="circle" verticalAlign="top" height={24} />
                      <Line type="monotone" dataKey="inQty" name="Stock In" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4, fill: '#2563eb' }} animationDuration={1000} isAnimationActive>
                        <LabelList dataKey="inQty" position="top" style={{ fill: '#2563eb', fontSize: 11, fontWeight: 700 }} />
                      </Line>
                      <Line type="monotone" dataKey="outQty" name="Stock Out" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 4, fill: '#f59e0b' }} animationDuration={1000} isAnimationActive>
                        <LabelList dataKey="outQty" position="bottom" style={{ fill: '#d97706', fontSize: 11, fontWeight: 700 }} />
                      </Line>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <ChartInterpretation
                  text={`${movementTrendInterpretation} Against the previous period stock in moved ${stockTrendSummary.inChangePercent >= 0 ? 'up' : 'down'} ${Math.abs(stockTrendSummary.inChangePercent).toFixed(1)}% and stock out ${stockTrendSummary.outChangePercent >= 0 ? 'up' : 'down'} ${Math.abs(stockTrendSummary.outChangePercent).toFixed(1)}%.`}
                />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200 shadow-sm">
          <CardHeader>
            <div>
              <CardTitle>Movement History</CardTitle>
              <CardDescription>Stock transactions in the selected range</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="stack-table w-full min-w-[760px] text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="p-3 text-left">Date</th>
                    <th className="p-3 text-left">Product</th>
                    <th className="p-3 text-left">Type</th>
                    <th className="p-3 text-left">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows(inventoryMovementRows).map((row, index) => (
                    <tr key={`${row.createdAt}-${index}`} className="border-b last:border-0">
                      <td className="p-3">{formatReportTableDateTime(row.createdAt)}</td>
                      <td className="p-3">{String(row.product || 'N/A')}</td>
                      <td className="p-3">{String(row.sourceType || row.type || 'N/A')}</td>
                      <td className="p-3">{String(row.quantity || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {inventoryMovementRows.length === 0 ? <p className="py-8 text-center text-gray-500">No inventory movement found for this range</p> : null}
            </div>
          </CardContent>
        </Card>
        </>
      ) : null}

      {reportType === 'low-stock' ? (
        <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Low Stock Items</CardDescription><CardTitle className="text-[30px] leading-none text-amber-600">{lowStockKpi.total}</CardTitle><p className="text-[11px] text-amber-600">Below reorder point</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Critical Stock</CardDescription><CardTitle className="text-[30px] leading-none text-red-600">{lowStockKpi.critical}</CardTitle><p className="text-[11px] text-red-600">Below minimum stock</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Out of Stock</CardDescription><CardTitle className="text-[30px] leading-none text-red-700">{lowStockKpi.outOfStock}</CardTitle><p className="text-[11px] text-red-700">Immediate reorder needed</p></CardHeader></Card>
        </div>

          <Card className={chartCardClassName}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Low Stock Alerts</CardTitle>
              <CardDescription>Products below minimum stock levels</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                {lowStockRows.length === 0 ? (
                  <p className="py-8 text-center text-gray-500">All stock levels are healthy</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={lowStockRows.slice(0, 5)} margin={{ top: 10, right: 20, left: 0, bottom: 26 }}>
                      <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="product" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} />
                      <Bar dataKey="currentStock" name="Current" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={30} />
                      <Bar dataKey="reorderPoint" name="Reorder Point" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={30} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <ChartInterpretation
                text={
                  lowStockRows.length === 0
                    ? 'Every tracked product is at or above its reorder point, so no replenishment is flagged.'
                    : `${lowStockInterpretation} ${lowStockKpi.critical} of ${lowStockKpi.total} flagged products are already below minimum stock and ${lowStockKpi.outOfStock} are out of stock.`
                }
              />
            </CardContent>
          </Card>

        <Card className="rounded-2xl border border-slate-200 shadow-sm">
          <CardHeader>
            <div>
              <CardTitle>Low Stock Products</CardTitle>
              <CardDescription>Products requiring replenishment attention</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="stack-table w-full min-w-[760px] text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="p-3 text-left">Product</th>
                    <th className="p-3 text-left">SKU</th>
                    <th className="p-3 text-left">Current Stock</th>
                    <th className="p-3 text-left">Min Stock</th>
                    <th className="p-3 text-left">Reorder Point</th>
                    <th className="p-3 text-left">Stock %</th>
                    <th className="p-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows(lowStockRows).map((row, index) => (
                    <tr key={`${row.sku}-${index}`} className="border-b last:border-0">
                      <td className="p-3 font-medium">{String(row.product || 'N/A')}</td>
                      <td className="p-3">{String(row.sku || 'N/A')}</td>
                      <td className="p-3">{String(row.currentStock || 0)}</td>
                      <td className="p-3">{String(row.minStock || 0)}</td>
                      <td className="p-3">{String(row.reorderPoint || 0)}</td>
                      <td className="p-3">{String(row.stockPercent || 0)}%</td>
                      <td className="p-3">
                        <Badge variant={row.status === 'OUT_OF_STOCK' ? 'destructive' : row.status === 'CRITICAL' ? 'destructive' : 'secondary'}>{String(row.status || 'N/A')}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lowStockRows.length === 0 ? <p className="py-8 text-center text-gray-500">All stock levels are healthy</p> : null}
            </div>
          </CardContent>
        </Card>
        </>
      ) : null}

      {reportType === 'batch-expiry' ? (
        <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Tracked Batches</CardDescription><CardTitle className="text-[30px] leading-none">{stockExpiryKpi.total}</CardTitle><p className="text-[11px] text-slate-400">Inventory batches with expiry dates</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Critical (&lt;30 days)</CardDescription><CardTitle className="text-[30px] leading-none text-red-600">{stockExpiryKpi.critical}</CardTitle><p className="text-[11px] text-red-600">Immediate action needed</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Expired</CardDescription><CardTitle className="text-[30px] leading-none text-red-700">{stockExpiryKpi.expired}</CardTitle><p className="text-[11px] text-red-700">Awaiting disposal</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Warning (30-60 days)</CardDescription><CardTitle className="text-[30px] leading-none text-amber-600">{stockExpiryKpi.warning}</CardTitle><p className="text-[11px] text-amber-600">Plan usage first</p></CardHeader></Card>
        </div>

        <Card className="rounded-2xl border border-slate-200 shadow-sm">
          <CardHeader>
            <div>
              <CardTitle>Batches by Expiry</CardTitle>
              <CardDescription>Batches nearing expiration sorted by urgency</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="stack-table w-full min-w-[760px] text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="p-3 text-left">Batch #</th>
                    <th className="p-3 text-left">Product</th>
                    <th className="p-3 text-left">SKU</th>
                    <th className="p-3 text-left">Quantity</th>
                    <th className="p-3 text-left">Manufacture Date</th>
                    <th className="p-3 text-left">Expiry Date</th>
                    <th className="p-3 text-left">Days Left</th>
                    <th className="p-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows(stockExpiryRows).map((row, index) => (
                    <tr key={`${row.batchNumber}-${index}`} className="border-b last:border-0">
                      <td className="p-3 font-medium">{String(row.batchNumber || 'N/A')}</td>
                      <td className="p-3">{String(row.product || 'N/A')}</td>
                      <td className="p-3">{String(row.sku || 'N/A')}</td>
                      <td className="p-3">{String(row.quantity || 0)}</td>
                      <td className="p-3">{String(row.manufacturedDate || 'N/A')}</td>
                      <td className="p-3">{String(row.expiryDate || 'N/A')}</td>
                      <td className="p-3">{typeof row.daysUntilExpiry === 'number' ? row.daysUntilExpiry : 'N/A'}</td>
                      <td className="p-3">
                        <Badge variant={
                          row.status === 'EXPIRED' ? 'destructive' :
                          row.status === 'CRITICAL' ? 'destructive' :
                          row.status === 'WARNING' ? 'secondary' : 'default'
                        }>{String(row.status || 'N/A')}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stockExpiryRows.length === 0 ? <p className="py-8 text-center text-gray-500">No batch expiry data available</p> : null}
            </div>
          </CardContent>
        </Card>
        </>
      ) : null}
    </div>
  )
}
