'use client'

import { type Dispatch, type SetStateAction } from 'react'
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
import { formatDateTime } from '../shared'
import { chartCardClassName, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle, previewRows } from './chart-styles'
import type { ReportDatasets } from './use-report-datasets'
import type { ReportToolbarRenderer } from './chart-styles'

/**
 * Warehouse utilization tab: capacity, movement and stock health.
 */
export type WarehouseReportTabProps = {
  inventory: any[]
  inventoryKpi: ReportDatasets['inventoryKpi']
  inventoryMovementByProductChart: ReportDatasets['inventoryMovementByProductChart']
  inventoryMovementChart: ReportDatasets['inventoryMovementChart']
  inventoryMovementRows: ReportDatasets['inventoryMovementRows']
  inventoryMovementTypeOptions: ReportDatasets['inventoryMovementTypeOptions']
  inventoryTransactions: any[]
  lowStockKpi: ReportDatasets['lowStockKpi']
  lowStockRows: ReportDatasets['lowStockRows']
  orders: any[]
  reportToolbar: ReportToolbarRenderer
  retailSales: any[]
  selectedMovementType: string
  setSelectedMovementType: Dispatch<SetStateAction<string>>
  stockBatches: any[]
  stockExpiryKpi: ReportDatasets['stockExpiryKpi']
  stockExpiryRows: ReportDatasets['stockExpiryRows']
  stockTrendSummary: ReportDatasets['stockTrendSummary']
  warehouseCapacityVsUsedChart: ReportDatasets['warehouseCapacityVsUsedChart']
  warehouses: any[]
}

export function WarehouseReportTab({
  inventory,
  inventoryKpi,
  inventoryMovementByProductChart,
  inventoryMovementChart,
  inventoryMovementRows,
  inventoryMovementTypeOptions,
  inventoryTransactions,
  lowStockKpi,
  lowStockRows,
  orders,
  reportToolbar,
  retailSales,
  selectedMovementType,
  setSelectedMovementType,
  stockBatches,
  stockExpiryKpi,
  stockExpiryRows,
  stockTrendSummary,
  warehouseCapacityVsUsedChart,
  warehouses,
}: WarehouseReportTabProps) {
  return (
    <>
      {/* Fastest-Moving Products Ranking & Velocity Report */}
      <WarehouseInventoryReport
        inventory={inventory}
        inventoryTransactions={inventoryTransactions}
        orders={orders}
        retailSales={retailSales}
        warehouses={warehouses}
        stockBatches={stockBatches}
      />

      {/* General Warehouse & Inventory Health Overview */}
      <div className="pt-6 border-t border-slate-200 space-y-6">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Warehouse Capacity & Stock Movement Overview</h3>
          <p className="text-xs text-slate-500">Storage utilization, inventory movement trends, stock alerts, and batch expiry records</p>
        </div>

        {reportToolbar({
          title: 'Warehouse',
          statusLabel: 'Movement Types',
          statusOptions: inventoryMovementTypeOptions,
          statusValue: selectedMovementType,
          onStatusChange: setSelectedMovementType,
          showWarehouse: true,
        })}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total SKUs</CardDescription><CardTitle className="text-[30px] leading-none">{inventoryKpi.totalSkus}</CardTitle><p className="text-[11px] text-slate-400">Products currently tracked</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Low Stock SKUs</CardDescription><CardTitle className="text-[30px] leading-none">{inventoryKpi.lowStock}</CardTitle><p className="text-[11px] text-slate-400">At or below reorder threshold</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total On Hand</CardDescription><CardTitle className="text-[30px] leading-none">{inventoryKpi.totalQuantity}</CardTitle><p className="text-[11px] text-slate-400">Units currently available</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Stock In</CardDescription><CardTitle className="text-[30px] leading-none text-blue-600">{inventoryKpi.stockIn}</CardTitle><p className="text-[11px] text-slate-400">Units received in selected period</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Stock Out</CardDescription><CardTitle className="text-[30px] leading-none text-amber-600">{inventoryKpi.stockOut}</CardTitle><p className="text-[11px] text-slate-400">Units issued in selected period</p></CardHeader></Card>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card className={chartCardClassName}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Warehouse Capacity vs Used</CardTitle>
              <CardDescription>Utilization percentage per warehouse</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                {warehouseCapacityVsUsedChart.length === 0 ? (
                  <p className="py-8 text-center text-gray-500">No warehouse capacity data available</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={warehouseCapacityVsUsedChart} margin={{ top: 15, right: 20, left: 0, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} domain={[0, 100]} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        labelStyle={chartTooltipLabelStyle}
                        itemStyle={chartTooltipItemStyle}
                        formatter={(value: any, name: any) => [
                          `${Number(value).toLocaleString()}%`,
                          String(name || ''),
                        ]}
                      />
                      <Legend wrapperStyle={{ paddingTop: '14px', color: '#475569' }} />
                      <Bar dataKey="capacityPercent" name="Capacity" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="usedPercent" name="Used" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className={chartCardClassName}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Inventory Movement by Product</CardTitle>
                  <CardDescription>Top products by movement volume</CardDescription>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                  Top 5 Products
                </div>
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
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#6b7280' }}
                        axisLine={false}
                        tickLine={false}
                        tickCount={5}
                      />
                      <Legend
                        verticalAlign="top"
                        align="center"
                        wrapperStyle={{ paddingBottom: '8px', color: '#64748b', fontSize: '12px' }}
                        iconType="rect"
                      />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        labelStyle={chartTooltipLabelStyle}
                        itemStyle={chartTooltipItemStyle}
                        formatter={(value: any, name: any) => [`${Number(value).toLocaleString()} units`, name]}
                      />
                      <Bar dataKey="inQty" name="Stock In" fill="#38bdf8" radius={[4, 4, 0, 0]} maxBarSize={22}>
                        <LabelList dataKey="inQty" position="top" fill="#0f172a" fontSize={11} />
                      </Bar>
                      <Bar dataKey="outQty" name="Stock Out" fill="#fbbf24" radius={[4, 4, 0, 0]} maxBarSize={22}>
                        <LabelList dataKey="outQty" position="top" fill="#0f172a" fontSize={11} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
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
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200 shadow-sm">
          <CardHeader>
            <div>
              <CardTitle>Warehouse & Inventory Movement Report</CardTitle>
              <CardDescription>Stock transactions and movement history</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[760px] text-sm">
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
                      <td className="p-3">{formatDateTime(row.createdAt)}</td>
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

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Low Stock Items</CardDescription><CardTitle className="text-[30px] leading-none text-amber-600">{lowStockKpi.total}</CardTitle><p className="text-[11px] text-amber-600">Below reorder point</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Critical Stock</CardDescription><CardTitle className="text-[30px] leading-none text-red-600">{lowStockKpi.critical}</CardTitle><p className="text-[11px] text-red-600">Below minimum stock</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Out of Stock</CardDescription><CardTitle className="text-[30px] leading-none text-red-700">{lowStockKpi.outOfStock}</CardTitle><p className="text-[11px] text-red-700">Immediate reorder needed</p></CardHeader></Card>
        </div>

        <Card className="rounded-2xl border border-slate-200 shadow-sm">
          <CardHeader>
            <div>
              <CardTitle>Low Stock Alert Report</CardTitle>
              <CardDescription>Products requiring replenishment attention</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[760px] text-sm">
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
                        <Badge variant={
                          row.status === 'OUT_OF_STOCK' ? 'destructive' :
                          row.status === 'CRITICAL' ? 'destructive' : 'secondary'
                        }>{String(row.status || 'N/A')}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lowStockRows.length === 0 ? <p className="py-8 text-center text-gray-500">All stock levels are healthy</p> : null}
            </div>
          </CardContent>
        </Card>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Tracked Batches</CardDescription><CardTitle className="text-[30px] leading-none">{stockExpiryKpi.total}</CardTitle><p className="text-[11px] text-slate-400">Inventory batches with expiry dates</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Critical (&lt;30 days)</CardDescription><CardTitle className="text-[30px] leading-none text-red-600">{stockExpiryKpi.critical}</CardTitle><p className="text-[11px] text-red-600">Immediate action needed</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Expired</CardDescription><CardTitle className="text-[30px] leading-none text-red-700">{stockExpiryKpi.expired}</CardTitle><p className="text-[11px] text-red-700">Write-off required</p></CardHeader></Card>
          <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Warning (30-60 days)</CardDescription><CardTitle className="text-[30px] leading-none text-amber-600">{stockExpiryKpi.warning}</CardTitle><p className="text-[11px] text-amber-600">Plan usage first</p></CardHeader></Card>
        </div>

        <Card className="rounded-2xl border border-slate-200 shadow-sm">
          <CardHeader>
            <div>
              <CardTitle>Stock Batch Expiry Report</CardTitle>
              <CardDescription>Batches nearing expiration sorted by urgency</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[760px] text-sm">
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
      </div>
    </>
  )
}
