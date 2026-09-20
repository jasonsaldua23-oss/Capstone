'use client'

import { type Dispatch, type SetStateAction } from 'react'
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
  Legend,
  PieChart,
  Pie,
} from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeComposition, describeRanking, toPoints } from '@/lib/chart-interpretation'
import { chartCardClassName, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle, previewRows } from './chart-styles'
import type { ReportDatasets } from './use-report-datasets'
import type { ReportToolbarRenderer } from './chart-styles'

/**
 * Transportation tab: driver performance filters, charts and tables.
 */
export type TransportReportTabProps = {
  driverPerformanceKpi: ReportDatasets['driverPerformanceKpi']
  driverPerformanceStatusOptions: ReportDatasets['driverPerformanceStatusOptions']
  drivers: any[]
  reportToolbar: ReportToolbarRenderer
  selectedDriverRating: 'all' | '4_up' | '3_up' | 'below_3'
  selectedDriverTripVolume: 'all' | 'with_trips' | '10_plus'
  selectedTripStatus: string
  setSelectedDriverRating: Dispatch<SetStateAction<'all' | '4_up' | '3_up' | 'below_3'>>
  setSelectedDriverTripVolume: Dispatch<SetStateAction<'all' | 'with_trips' | '10_plus'>>
  setSelectedTripStatus: Dispatch<SetStateAction<string>>
  transportCompletionBandChart: ReportDatasets['transportCompletionBandChart']
  transportDriverRows: ReportDatasets['transportDriverRows']
  transportTopDrivers: ReportDatasets['transportTopDrivers']
  trips: any[]
}

export function TransportReportTab({
  driverPerformanceKpi,
  driverPerformanceStatusOptions,
  drivers,
  reportToolbar,
  selectedDriverRating,
  selectedDriverTripVolume,
  selectedTripStatus,
  setSelectedDriverRating,
  setSelectedDriverTripVolume,
  setSelectedTripStatus,
  transportCompletionBandChart,
  transportDriverRows,
  transportTopDrivers,
  trips,
}: TransportReportTabProps) {
  const bandInterpretation = describeComposition(
    toPoints(transportCompletionBandChart, (row: any) => `the ${row.name} band`, (row: any) => row.count),
    {
      noun: 'drivers',
      entityNoun: 'band',
      emptyMessage: 'No driver has completion data under the selected filters, so the bands are empty.',
    }
  )
  // Completion rate is a percentage per driver, so the ranking reads the leader rather than a total.
  const topDriverInterpretation = describeRanking(
    toPoints(transportTopDrivers, (row: any) => row.name, (row: any) => row.completionRate),
    {
      noun: 'completion',
      entityNoun: 'driver',
      format: (value) => `${value.toFixed(1)}%`,
      emptyMessage: 'No driver matches the selected filters, so there is no ranking to interpret yet.',
    }
  )

  return (
    <>
      {reportToolbar({
        title: 'Transport Driver Performance',
        statusLabel: 'Driver Status',
        statusOptions: driverPerformanceStatusOptions,
        statusValue: selectedTripStatus,
        onStatusChange: setSelectedTripStatus,
        showWarehouse: false,
        showDriver: true,
        showStatus: true,
      })}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            value={selectedDriverRating}
            onChange={(event) => setSelectedDriverRating(event.target.value as 'all' | '4_up' | '3_up' | 'below_3')}
            title="Filter by driver rating"
          >
            <option value="all">All Ratings</option>
            <option value="4_up">4.0 and above</option>
            <option value="3_up">3.0 and above</option>
            <option value="below_3">Below 3.0</option>
          </select>
          <select
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            value={selectedDriverTripVolume}
            onChange={(event) => setSelectedDriverTripVolume(event.target.value as 'all' | 'with_trips' | '10_plus')}
            title="Filter by total trips"
          >
            <option value="all">All Trip Volumes</option>
            <option value="with_trips">With trips only</option>
            <option value="10_plus">10+ trips</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total Drivers</CardDescription><CardTitle className="text-[30px] leading-none">{driverPerformanceKpi.total}</CardTitle><p className="text-[11px] text-slate-400">Registered drivers</p></CardHeader></Card>
        <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Active Drivers</CardDescription><CardTitle className="text-[30px] leading-none text-emerald-600">{driverPerformanceKpi.active}</CardTitle><p className="text-[11px] text-emerald-600">Currently active</p></CardHeader></Card>
        <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Avg Rating</CardDescription><CardTitle className="text-[30px] leading-none">{driverPerformanceKpi.avgRating}</CardTitle><p className="text-[11px] text-slate-400">Out of 5.0</p></CardHeader></Card>
        <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total Trips</CardDescription><CardTitle className="text-[30px] leading-none text-blue-700">{driverPerformanceKpi.totalTrips}</CardTitle><p className="text-[11px] text-slate-400">Trips assigned to listed drivers</p></CardHeader></Card>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className={chartCardClassName}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Completion Band Distribution</CardTitle>
            <CardDescription>How drivers are spread by completion performance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              {transportCompletionBandChart.every((band) => Number(band.count) === 0) ? (
                <p className="py-8 text-center text-gray-500">No completion data for selected filters</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={transportCompletionBandChart}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={56}
                      outerRadius={94}
                      paddingAngle={2}
                    >
                      {transportCompletionBandChart.map((entry) => (
                        <Cell key={entry.key} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                      itemStyle={chartTooltipItemStyle}
                      formatter={(value: any) => [`${Number(value || 0)} drivers`, 'Count']}
                    />
                    <Legend verticalAlign="bottom" wrapperStyle={{ color: '#64748b', fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <ChartInterpretation text={bandInterpretation} />
          </CardContent>
        </Card>
        <Card className={chartCardClassName}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Top Drivers by Completion</CardTitle>
            <CardDescription>Ranking by completion rate, tie-broken by trip volume</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              {transportTopDrivers.length === 0 ? (
                <p className="py-8 text-center text-gray-500">No ranked driver data for selected filters</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={transportTopDrivers} margin={{ top: 12, right: 20, left: 0, bottom: 36 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                      itemStyle={chartTooltipItemStyle}
                      formatter={(value: any, key: any) => [key === 'completionRate' ? `${Number(value || 0)}%` : Number(value || 0).toLocaleString(), key === 'completionRate' ? 'Completion' : 'Trips']}
                    />
                    <Legend verticalAlign="top" wrapperStyle={{ fontSize: '12px', color: '#64748b' }} />
                    <Bar dataKey="completionRate" name="Completion %" fill="#2563eb" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="totalTrips" name="Trips" fill="#22c55e" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <ChartInterpretation
              text={
                transportTopDrivers.length === 0
                  ? 'No driver matches the selected filters, so there is no ranking to interpret yet.'
                  : `${topDriverInterpretation} The ranked drivers carry ${transportTopDrivers.reduce((sum, row) => sum + Number(row.totalTrips || 0), 0).toLocaleString('en-US')} of the ${Number(driverPerformanceKpi.totalTrips || 0).toLocaleString('en-US')} trips in the period.`
              }
            />
          </CardContent>
        </Card>
      </div>
      <Card className="rounded-2xl border border-slate-200 shadow-sm">
        <CardHeader>
          <div>
            <CardTitle>Transportation Driver Performance Report</CardTitle>
            <CardDescription>Driver metrics and performance indicators</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <table className="stack-table w-full min-w-[760px] text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Driver Name</th>
                  <th className="p-3 text-left">Rating</th>
                  <th className="p-3 text-left">Total Trips</th>
                  <th className="p-3 text-left">Delivered Drop Points</th>
                  <th className="p-3 text-left">Completion %</th>
                  <th className="p-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows(transportDriverRows).map((row, index) => (
                  <tr key={`${row.driverName}-${index}`} className="border-b last:border-0">
                    <td className="p-3 font-medium">{String(row.driverName || 'N/A')}</td>
                    <td className="p-3">{String(row.rating || 'N/A')}</td>
                    <td className="p-3">{String(row.totalTrips || 0)}</td>
                    <td className="p-3">{String(row.deliveredDropPoints || 0)}/{String(row.dropPointsTotal || 0)}</td>
                    <td className="p-3">{String(row.completionRate || '0%')}</td>
                    <td className="p-3">{String(row.isActive || 'N/A')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transportDriverRows.length === 0 ? <p className="py-8 text-center text-gray-500">No driver performance data available for the selected filters</p> : null}
          </div>
        </CardContent>
      </Card>
    </>
  )
}
