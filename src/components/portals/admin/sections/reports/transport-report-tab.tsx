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
} from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeComposition, describeRanking, toPoints } from '@/lib/chart-interpretation'
import { chartCardClassName, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle, previewRows } from './chart-styles'
import type { ReportDatasets } from './use-report-datasets'
import type { ReportToolbarRenderer } from './chart-styles'
import { ReportKpiRow } from './report-kpi'

/**
 * Transportation tab: driver performance filters, charts and tables.
 */
export type TransportReportTabProps = {
  driverPerformanceKpi: ReportDatasets['driverPerformanceKpi']
  driverPerformanceStatusOptions: ReportDatasets['driverPerformanceStatusOptions']
  drivers: any[]
  reportToolbar: ReportToolbarRenderer
  selectedDriverTripVolume: 'all' | 'with_trips' | '10_plus'
  selectedTripStatus: string
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
  selectedDriverTripVolume,
  selectedTripStatus,
  setSelectedDriverTripVolume,
  setSelectedTripStatus,
  transportCompletionBandChart,
  transportDriverRows,
  transportTopDrivers,
  trips,
}: TransportReportTabProps) {
  const bandInterpretation = describeComposition(
    // No leading article: the label also appears mid-sentence ("… and 0-39% completion had none").
    toPoints(transportCompletionBandChart, (row: any) => `${row.name} completion`, (row: any) => row.count),
    {
      noun: 'drivers',
      entityNoun: 'band',
      emptyMessage: 'No driver has completion data under the selected filters, so the bands are empty.',
    }
  )
  // Completion rate is a percentage per driver, so the reading compares levels
  // and never adds two drivers' rates together.
  const topDriverInterpretation = describeRanking(
    toPoints(transportTopDrivers, (row: any) => row.name, (row: any) => row.completionRate),
    {
      noun: 'completion rate',
      nounIsPlural: false,
      measure: 'level',
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
      {/* Trips run and completed drop points measure transport performance. */}
      <ReportKpiRow
        headline={{ label: 'Total Trips', value: driverPerformanceKpi.totalTrips, hint: 'Assigned to listed drivers', tone: 'blue' }}
        items={[
          { label: 'Active Drivers', value: driverPerformanceKpi.active, hint: `of ${driverPerformanceKpi.total} registered`, tone: 'emerald' },
          { label: 'Total Drivers', value: driverPerformanceKpi.total, hint: 'Registered driver accounts', tone: 'purple' },
        ]}
      />
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
                // The bands are an ordered scale, so they stand in order along an
                // axis; a donut lost that order.
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={transportCompletionBandChart} margin={{ top: 12, right: 20, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                      label={{ value: 'Completion rate', position: 'insideBottom', offset: -10, style: { fontSize: 12, fill: '#64748b' } }}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={false}
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                      itemStyle={chartTooltipItemStyle}
                      formatter={(value: any) => {
                        const count = Number(value || 0)
                        return [`${count} ${count === 1 ? 'driver' : 'drivers'}`, 'Drivers']
                      }}
                    />
                    <Bar dataKey="count" name="Drivers" radius={[6, 6, 0, 0]} maxBarSize={56}>
                      {transportCompletionBandChart.map((entry) => (
                        <Cell key={entry.key} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <ChartInterpretation text={bandInterpretation} />
          </CardContent>
        </Card>
        <Card className={chartCardClassName}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Top Drivers by Completion</CardTitle>
            <CardDescription>Completion rate per driver, tie-broken by trip volume · trip counts in the tooltip</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              {transportTopDrivers.length === 0 ? (
                <p className="py-8 text-center text-gray-500">No ranked driver data for selected filters</p>
              ) : (
                // Only the percentage is plotted. Trip counts used to share this
                // 0-100% axis, so a driver with 5 trips drew a sliver beside a full
                // bar, and anyone past 100 trips stretched the percentage scale.
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={transportTopDrivers} margin={{ top: 12, right: 20, left: 0, bottom: 36 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis
                      allowDecimals={false}
                      domain={[0, 100]}
                      tickFormatter={(value: any) => `${value}%`}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                      itemStyle={chartTooltipItemStyle}
                      formatter={(value: any, _name: any, entry: any) => {
                        const trips = Number(entry?.payload?.totalTrips || 0)
                        return [`${Number(value || 0)}% · ${trips.toLocaleString()} ${trips === 1 ? 'trip' : 'trips'}`, 'Completion']
                      }}
                    />
                    <Bar dataKey="completionRate" name="Completion %" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={48} />
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
