'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CartesianGrid,
  YAxis,
  XAxis,
  Tooltip,
  Cell,
  BarChart,
  Bar,
  ResponsiveContainer,
  LabelList,
  PieChart,
  Pie,
} from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeComposition, describeTrend, toPoints } from '@/lib/chart-interpretation'
import { formatPeso } from '../shared'
import { formatOrderReportStatus } from '@/lib/report-metrics'
import { chartCardClassName, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle, formatOrderCountLabel, previewRows } from './chart-styles'
import type { ReportDatasets } from './use-report-datasets'
import type { ReportToolbarRenderer } from './chart-styles'

/**
 * Order report tab: status filter, outcome charts and the order table.
 */
export type OrdersReportTabProps = {
  orderKpi: ReportDatasets['orderKpi']
  orderOutcomeTrendChart: ReportDatasets['orderOutcomeTrendChart']
  orderRows: ReportDatasets['orderRows']
  orderStatusChart: ReportDatasets['orderStatusChart']
  orderStatusOptions: ReportDatasets['orderStatusOptions']
  orders: any[]
  reportToolbar: ReportToolbarRenderer
  selectedOrderStatus: string
  setSelectedOrderStatus: Dispatch<SetStateAction<string>>
}

export function OrdersReportTab({
  orderKpi,
  orderOutcomeTrendChart,
  orderRows,
  orderStatusChart,
  orderStatusOptions,
  orders,
  reportToolbar,
  selectedOrderStatus,
  setSelectedOrderStatus,
}: OrdersReportTabProps) {
  // Both readings come off the same arrays the charts draw, so they follow the filters.
  const volumeInterpretation = describeTrend(
    toPoints(orderOutcomeTrendChart, (row: any) => row.label, (row: any) => row.orders),
    { noun: 'orders', periodNoun: 'day', emptyMessage: 'No orders fall inside the selected range, so there is nothing to interpret yet.' }
  )
  const statusInterpretation = describeComposition(
    toPoints(orderStatusChart, (row: any) => row.name, (row: any) => row.value),
    { noun: 'orders', entityNoun: 'status', emptyMessage: 'No orders fall inside the selected range, so the status mix is empty.' }
  )

  return (
    <>
      {reportToolbar({
        title: 'Orders',
        statusLabel: 'Order Statuses',
        statusOptions: orderStatusOptions,
        statusValue: selectedOrderStatus,
        onStatusChange: setSelectedOrderStatus,
        showWarehouse: true,
      })}
      {/* These KPI cards mirror the exported summary so the report headline numbers never drift. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card className="rounded-3xl border border-blue-100 bg-white shadow-sm"><CardHeader className="p-5"><CardDescription className="text-xs uppercase tracking-wide text-blue-500">Total Orders</CardDescription><CardTitle className="mt-2 text-[34px] leading-none text-slate-900">{orderKpi.totalOrders}</CardTitle><p className="mt-2 text-sm text-slate-500">100% of filtered orders</p></CardHeader></Card>
        <Card className="rounded-3xl border border-emerald-100 bg-white shadow-sm"><CardHeader className="p-5"><CardDescription className="text-xs uppercase tracking-wide text-emerald-500">Delivered Orders</CardDescription><CardTitle className="mt-2 text-[34px] leading-none text-emerald-700">{orderKpi.deliveredOrders}</CardTitle><p className="mt-2 text-sm text-slate-500">{orderKpi.totalOrders > 0 ? ((orderKpi.deliveredOrders / orderKpi.totalOrders) * 100).toFixed(1) : '0.0'}% of filtered orders</p></CardHeader></Card>
        <Card className="rounded-3xl border border-amber-100 bg-white shadow-sm"><CardHeader className="p-5"><CardDescription className="text-xs uppercase tracking-wide text-amber-500">Pending Orders</CardDescription><CardTitle className="mt-2 text-[34px] leading-none text-amber-600">{orderKpi.pendingOrders}</CardTitle><p className="mt-2 text-sm text-slate-500">{orderKpi.totalOrders > 0 ? ((orderKpi.pendingOrders / orderKpi.totalOrders) * 100).toFixed(1) : '0.0'}% of filtered orders</p></CardHeader></Card>
        <Card className="rounded-3xl border border-rose-100 bg-white shadow-sm"><CardHeader className="p-5"><CardDescription className="text-xs uppercase tracking-wide text-rose-500">Cancelled Orders</CardDescription><CardTitle className="mt-2 text-[34px] leading-none text-rose-600">{orderKpi.cancelledOrders}</CardTitle><p className="mt-2 text-sm text-slate-500">{orderKpi.totalOrders > 0 ? ((orderKpi.cancelledOrders / orderKpi.totalOrders) * 100).toFixed(1) : '0.0'}% of filtered orders</p></CardHeader></Card>
        <Card className="rounded-3xl border border-cyan-100 bg-white shadow-sm"><CardHeader className="p-5"><CardDescription className="text-xs uppercase tracking-wide text-cyan-500">Total Revenue</CardDescription><CardTitle className="mt-2 text-[34px] leading-none text-cyan-700">{formatPeso(orderKpi.totalRevenue)}</CardTitle><p className="mt-2 text-sm text-slate-500">Revenue from delivered orders only</p></CardHeader></Card>
      </div>

      {/* The chart row tells the report story at a glance: volume first, outcome mix second. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className={chartCardClassName}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-blue-700">Orders by Day</CardTitle>
            <CardDescription>Filtered order volume over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={orderOutcomeTrendChart} margin={{ top: 16, right: 20, left: 0, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={chartTooltipLabelStyle}
                    itemStyle={chartTooltipItemStyle}
                    formatter={(value: any) => [formatOrderCountLabel(value), 'Orders']}
                  />
                  <Bar dataKey="orders" name="Orders" fill="#2563eb" radius={[8, 8, 0, 0]}>
                    <LabelList dataKey="orders" position="top" fill="#0f172a" fontSize={11} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ChartInterpretation text={volumeInterpretation} />
          </CardContent>
        </Card>

        <Card className={chartCardClassName}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-blue-700">Order Status Breakdown</CardTitle>
            <CardDescription>Delivered, pending, and cancelled mix</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={orderStatusChart}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={94}
                    paddingAngle={2}
                  >
                    {orderStatusChart.map((entry) => (
                      <Cell key={entry.key} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={chartTooltipLabelStyle}
                    itemStyle={chartTooltipItemStyle}
                    formatter={(value: any, _name: any, details: any) => {
                      const percentage = Number(details?.payload?.percentage || 0)
                      return [formatOrderCountLabel(value), `${details?.payload?.name} (${percentage.toFixed(1)}%)`]
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              {orderStatusChart.map((entry) => (
                <div key={entry.key} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span className="font-medium text-slate-700">{entry.name}</span>
                  </div>
                  <span className="text-slate-600">{entry.value} ({entry.percentage.toFixed(1)}%)</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-slate-900">
                <span>Total</span>
                <span>{orderKpi.totalOrders} (100%)</span>
              </div>
            </div>
            <ChartInterpretation text={statusInterpretation} className="mt-0" />
          </CardContent>
        </Card>
      </div>

      {/* The table keeps richer order detail visible without introducing payment-specific columns the user excluded. */}
      <Card className="rounded-2xl border border-slate-200 shadow-sm">
        <CardHeader>
          <div>
            <CardTitle>Order Report</CardTitle>
            <CardDescription>Filtered order list with item summaries and normalized status labels</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Order ID</th>
                  <th className="p-3 text-left">Customer</th>
                  <th className="p-3 text-left">Product / Items</th>
                  <th className="p-3 text-left">Quantity</th>
                  <th className="p-3 text-left">Order Date</th>
                  <th className="p-3 text-left">Order Status</th>
                  <th className="p-3 text-left">Total Amount</th>
                </tr>
              </thead>
              <tbody>
                {previewRows(orderRows).map((row, index) => (
                  <tr key={`${row.orderNumber}-${index}`} className="border-b last:border-0">
                    <td className="p-3 font-medium">{String(row.orderNumber || 'N/A')}</td>
                    <td className="p-3">{String(row.customer || 'N/A')}</td>
                    <td className="p-3">
                      <div className="leading-tight">
                        <p className="text-slate-700">{String((row as any).productNameWithSize || row.itemSummary || 'N/A')}</p>
                        <p className="mt-1 text-xs text-slate-500">{String((row as any).productCategory || 'Uncategorized')}</p>
                      </div>
                    </td>
                    <td className="p-3">{Number(row.totalQuantity || 0).toLocaleString()}</td>
                    <td className="p-3">{String(row.orderDateLabel || 'N/A')}</td>
                    <td className="p-3">
                      <Badge
                        className={
                          row.normalizedReportStatus === 'PENDING'
                            ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100'
                            : row.normalizedReportStatus === 'CANCELLED'
                                ? 'bg-red-100 text-red-700 hover:bg-red-100'
                                : row.normalizedReportStatus === 'DELIVERED'
                                  ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-100'
                        }
                      >
                        {formatOrderReportStatus(row.normalizedReportStatus)}
                      </Badge>
                    </td>
                    <td className="p-3">{formatPeso(Number(row.amount || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orderRows.length === 0 ? <p className="py-8 text-center text-gray-500">No matching orders found for this range</p> : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"><CardContent className="flex items-center justify-between p-5"><p className="text-sm font-medium text-slate-600">Total Orders</p><p className="text-2xl font-black text-blue-700">{orderKpi.totalOrders}</p></CardContent></Card>
        <Card className="rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"><CardContent className="flex items-center justify-between p-5"><p className="text-sm font-medium text-slate-600">Total Quantity</p><p className="text-2xl font-black text-slate-900">{orderKpi.totalQuantity.toLocaleString()}</p></CardContent></Card>
        <Card className="rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"><CardContent className="flex items-center justify-between p-5"><p className="text-sm font-medium text-slate-600">Total Revenue</p><p className="text-2xl font-black text-cyan-700">{formatPeso(orderKpi.totalRevenue)}</p></CardContent></Card>
      </div>
    </>
  )
}
