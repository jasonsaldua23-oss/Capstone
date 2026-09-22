'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CartesianGrid,
  YAxis,
  XAxis,
  LineChart,
  Line,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeTrend, toPoints } from '@/lib/chart-interpretation'
import { formatPeso } from '../shared'
import { chartCardClassName, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle, previewRows } from './chart-styles'
import type { ReportDatasets } from './use-report-datasets'
import type { ReportToolbarRenderer } from './chart-styles'
import { ReportKpiRow } from './report-kpi'

/**
 * Replacement handling tab: status filter, loss trend and the replacement table.
 */
export type ReplacementReportTabProps = {
  replacementKpi: ReportDatasets['replacementKpi']
  replacementLossTrendChart: ReportDatasets['replacementLossTrendChart']
  replacementRows: ReportDatasets['replacementRows']
  replacementStatusOptions: ReportDatasets['replacementStatusOptions']
  reportToolbar: ReportToolbarRenderer
  selectedReplacementStatus: string
  setSelectedReplacementStatus: Dispatch<SetStateAction<string>>
}

export function ReplacementReportTab({
  replacementKpi,
  replacementLossTrendChart,
  replacementRows,
  replacementStatusOptions,
  reportToolbar,
  selectedReplacementStatus,
  setSelectedReplacementStatus,
}: ReplacementReportTabProps) {
  // Peso amounts read better through the report's own formatter than the generic one.
  const lossInterpretation = describeTrend(
    toPoints(replacementLossTrendChart, (row: any) => row.label, (row: any) => row.loss),
    {
      noun: 'replacement loss',
      nounIsPlural: false,
      periodNoun: 'day',
      format: (value) => formatPeso(value),
      emptyMessage: 'No replacement loss falls inside the selected range, so there is nothing to interpret yet.',
    }
  )

  return (
    <>
      {reportToolbar({
        title: 'Replacement',
        statusLabel: 'Replacement Statuses',
        statusOptions: replacementStatusOptions,
        statusValue: selectedReplacementStatus,
        onStatusChange: setSelectedReplacementStatus,
        showWarehouse: true,
        showStatus: false,
      })}
      {/* How many cases are still open is the operational question, so the
          open count leads rather than the raw total. */}
      <ReportKpiRow
        headline={{ label: 'Open Cases', value: replacementKpi.open, hint: 'Awaiting resolution', tone: 'amber' }}
        items={[
          { label: 'Total Cases', value: replacementKpi.total, hint: 'In selected period', tone: 'blue' },
          { label: 'Processed', value: replacementKpi.completed, hint: 'Completed cases', tone: 'emerald' },
        ]}
      />
      <Card className={chartCardClassName}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Replacement Loss Trend (Line)</CardTitle>
          <CardDescription>Total replacement loss over time based on current filters</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            {replacementLossTrendChart.length === 0 ? (
              <p className="py-8 text-center text-gray-500">No loss trend data for this range</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={replacementLossTrendChart} margin={{ top: 12, right: 20, left: 0, bottom: 26 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value: any) => formatPeso(Number(value || 0))}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={chartTooltipLabelStyle}
                    itemStyle={chartTooltipItemStyle}
                    formatter={(value: any) => [formatPeso(Number(value || 0)), 'Total Loss']}
                  />
                  <Legend verticalAlign="top" wrapperStyle={{ fontSize: '12px', color: '#64748b' }} />
                  <Line type="monotone" dataKey="loss" name="Total Loss" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 4, fill: '#ef4444' }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <ChartInterpretation
            text={
              replacementLossTrendChart.length === 0
                ? 'No replacement loss falls inside the selected range, so there is nothing to interpret yet.'
                : `${lossInterpretation} ${replacementKpi.completed} of ${replacementKpi.total} cases are processed and ${replacementKpi.open} remain open.`
            }
          />
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-slate-200 shadow-sm">
        <CardHeader>
          <div>
            <CardTitle>Replacement Report</CardTitle>
            <CardDescription>Replacement handling and case tracking</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <table className="stack-table w-full min-w-[760px] text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Replacement #</th>
                  <th className="p-3 text-left">Order #</th>
                  <th className="p-3 text-left">Customer</th>
                  <th className="p-3 text-left">Assigned Driver</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Total Loss</th>
                </tr>
              </thead>
              <tbody>
                {previewRows(replacementRows).map((row, index) => (
                  <tr key={`${row.replacementNumber}-${index}`} className="border-b last:border-0">
                    <td className="p-3 font-medium">{String(row.replacementNumber || 'N/A')}</td>
                    <td className="p-3">{String(row.orderNumber || 'N/A')}</td>
                    <td className="p-3">{String(row.customer || 'N/A')}</td>
                    <td className="p-3">{String(row.assignedDriver || 'N/A')}</td>
                    <td className="p-3">{String(row.status || 'N/A')}</td>
                    <td className="p-3 font-semibold text-red-600">{formatPeso(Math.max(0, Number(row.totalLoss || 0)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {replacementRows.length === 0 ? <p className="py-8 text-center text-gray-500">No replacement records found for this range</p> : null}
          </div>
        </CardContent>
      </Card>
    </>
  )
}
