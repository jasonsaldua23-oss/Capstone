'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CartesianGrid,
  YAxis,
  XAxis,
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
 * Inventory movement tab: movement type filter, charts and the movement table.
 */
export type InventoryReportTabProps = {
  inventory: any[]
  inventoryKpi: ReportDatasets['inventoryKpi']
  inventoryMovementByProductChart: ReportDatasets['inventoryMovementByProductChart']
  inventoryMovementRows: ReportDatasets['inventoryMovementRows']
  inventoryMovementTypeOptions: ReportDatasets['inventoryMovementTypeOptions']
  lowStockKpi: ReportDatasets['lowStockKpi']
  lowStockRows: ReportDatasets['lowStockRows']
  reportToolbar: ReportToolbarRenderer
  selectedMovementType: string
  setSelectedMovementType: Dispatch<SetStateAction<string>>
}

export function InventoryReportTab({
  inventory,
  inventoryKpi,
  inventoryMovementByProductChart,
  inventoryMovementRows,
  inventoryMovementTypeOptions,
  lowStockKpi,
  lowStockRows,
  reportToolbar,
  selectedMovementType,
  setSelectedMovementType,
}: InventoryReportTabProps) {
  return (
    <>
      {reportToolbar({
        title: 'Inventory',
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
          </CardContent>
        </Card>
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
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border border-slate-200 shadow-sm">
        <CardHeader>
          <div>
            <CardTitle>Inventory Movement Report</CardTitle>
            <CardDescription>Warehouse stock movements within selected range</CardDescription>
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
  )
}
