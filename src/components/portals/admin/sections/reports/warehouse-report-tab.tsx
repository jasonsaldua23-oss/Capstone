'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
} from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeRanking, describeTrend, toPoints } from '@/lib/chart-interpretation'
import { chartCardClassName, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle, previewRows } from './chart-styles'
import type { ReportDatasets } from './use-report-datasets'
import type { ReportToolbarRenderer } from './chart-styles'
import { ReportKpiRow } from './report-kpi'

/**
 * Warehouse tab: storage capacity and utilization only. Stock levels, movement and
 * batch expiry belong to the inventory tab so each report stands on its own.
 */
export type WarehouseReportTabProps = {
  reportToolbar: ReportToolbarRenderer
  warehouseCapacityTrendPoints: ReportDatasets['warehouseCapacityTrendPoints']
  warehouseCapacityVsUsedChart: ReportDatasets['warehouseCapacityVsUsedChart']
  warehouses: any[]
}

const formatPercentValue = (value: number) => `${value.toFixed(1)}%`

export function WarehouseReportTab({
  reportToolbar,
  warehouseCapacityTrendPoints,
  warehouseCapacityVsUsedChart,
  warehouses,
}: WarehouseReportTabProps) {
  // Utilization is already a percentage per warehouse, so this ranks rather than totals.
  const capacityInterpretation = describeRanking(
    toPoints(warehouseCapacityVsUsedChart, (row: any) => row.name, (row: any) => row.usedPercent),
    {
      noun: 'utilization',
      entityNoun: 'warehouse',
      format: formatPercentValue,
      emptyMessage: 'No warehouse capacity has been recorded, so there is nothing to interpret yet.',
    }
  )
  // Utilization is a rate, so the reading describes the level rather than a total.
  const utilizationTrendInterpretation = describeTrend(
    toPoints(warehouseCapacityTrendPoints, (point: any) => point.date, (point: any) => point.utilizationPercent),
    {
      noun: 'utilization',
      periodNoun: 'day',
      measure: 'level',
      nounIsPlural: false,
      format: formatPercentValue,
      emptyMessage: 'No capacity history falls inside the selected range, so there is nothing to interpret yet.',
    }
  )

  const totalCapacity = warehouseCapacityVsUsedChart.reduce((sum, row: any) => sum + Math.max(0, Number(row.totalCapacity || 0)), 0)
  const storedUnits = warehouseCapacityVsUsedChart.reduce((sum, row: any) => sum + Math.max(0, Number(row.usedUnits || 0)), 0)
  const remainingCapacity = Math.max(0, totalCapacity - storedUnits)
  const utilizationPercent = totalCapacity > 0 ? (storedUnits / totalCapacity) * 100 : 0
  // Newest day first, because the recent end of the range is what gets acted on.
  const utilizationRows = [...warehouseCapacityTrendPoints].reverse()
  const latestPoint = utilizationRows[0]

  return (
    <>
      <div>
        <h2 className="text-lg font-bold text-slate-900">Warehouse Capacity & Storage Utilization</h2>
        <p className="text-xs text-slate-500">Storage capacity per warehouse and how occupied space moved across the selected range</p>
      </div>

      {reportToolbar({
        title: 'Warehouse',
        showWarehouse: true,
        showStatus: false,
      })}

      {/* Utilization is the number that decides whether more space is needed,
          so it leads; the raw capacity figures explain how it was derived. */}
      <ReportKpiRow
        headline={{
          label: 'Capacity Utilization',
          value: formatPercentValue(utilizationPercent),
          hint: `${storedUnits.toLocaleString()} of ${totalCapacity.toLocaleString()} units in use`,
          tone: 'amber',
        }}
        items={[
          { label: 'Warehouses', value: warehouses.length, hint: 'Facilities on record', tone: 'slate' },
          { label: 'Stored Units', value: storedUnits.toLocaleString(), hint: 'Occupying space', tone: 'blue' },
          { label: 'Remaining', value: remainingCapacity.toLocaleString(), hint: 'Units still free', tone: 'emerald' },
        ]}
      />

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
          <ChartInterpretation text={capacityInterpretation} />
        </CardContent>
      </Card>

      <Card className={chartCardClassName}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Storage Utilization Trend</CardTitle>
              <CardDescription>Occupied capacity across the selected range</CardDescription>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
              {latestPoint
                ? `${latestPoint.usedUnits.toLocaleString()} / ${latestPoint.totalCapacity.toLocaleString()} units (${formatPercentValue(latestPoint.utilizationPercent)})`
                : 'No capacity history'}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            {warehouseCapacityTrendPoints.length === 0 ? (
              <p className="py-8 text-center text-gray-500">No warehouse utilization data for this range</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={warehouseCapacityTrendPoints} margin={{ top: 20, right: 22, left: 8, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={chartTooltipLabelStyle}
                    itemStyle={chartTooltipItemStyle}
                    formatter={(value: any, name: any) => [`${Number(value).toFixed(1)}%`, String(name || '')]}
                  />
                  <Legend wrapperStyle={{ paddingTop: '8px', color: '#475569' }} iconType="circle" verticalAlign="top" height={24} />
                  <Line type="monotone" dataKey="utilizationPercent" name="Utilization" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3, fill: '#2563eb' }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <ChartInterpretation text={utilizationTrendInterpretation} />
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-slate-200 shadow-sm">
        <CardHeader>
          <div>
            <CardTitle>Warehouse Utilization Report</CardTitle>
            <CardDescription>Occupied and remaining capacity per day, most recent first</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <table className="stack-table w-full min-w-[760px] text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Stored Units</th>
                  <th className="p-3 text-left">Total Capacity</th>
                  <th className="p-3 text-left">Remaining</th>
                  <th className="p-3 text-left">Utilization</th>
                </tr>
              </thead>
              <tbody>
                {previewRows(utilizationRows).map((row, index) => (
                  <tr key={`${row.date}-${index}`} className="border-b last:border-0">
                    <td className="p-3 font-medium">{row.date}</td>
                    <td className="p-3">{row.usedUnits.toLocaleString()}</td>
                    <td className="p-3">{row.totalCapacity.toLocaleString()}</td>
                    <td className="p-3">{Math.max(0, row.totalCapacity - row.usedUnits).toLocaleString()}</td>
                    <td className="p-3">{formatPercentValue(row.utilizationPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {utilizationRows.length === 0 ? <p className="py-8 text-center text-gray-500">No warehouse utilization found for this range</p> : null}
          </div>
        </CardContent>
      </Card>
    </>
  )
}
