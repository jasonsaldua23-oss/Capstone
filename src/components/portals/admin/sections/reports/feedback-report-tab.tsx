'use client'

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
} from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeComposition, toPoints } from '@/lib/chart-interpretation'
import { formatDateTime } from '../shared'
import { chartCardClassName, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle, previewRows } from './chart-styles'
import type { ReportDatasets } from './use-report-datasets'
import type { ReportToolbarRenderer } from './chart-styles'

/**
 * Client feedback tab: rating distribution and the feedback table.
 */
export type FeedbackReportTabProps = {
  feedback: any[]
  feedbackKpi: ReportDatasets['feedbackKpi']
  feedbackRatingChart: ReportDatasets['feedbackRatingChart']
  feedbackRatingTotal: ReportDatasets['feedbackRatingTotal']
  feedbackRows: ReportDatasets['feedbackRows']
  reportToolbar: ReportToolbarRenderer
}

export function FeedbackReportTab({
  feedback,
  feedbackKpi,
  feedbackRatingChart,
  feedbackRatingTotal,
  feedbackRows,
  reportToolbar,
}: FeedbackReportTabProps) {
  // The spread reads as a mix of star buckets rather than a series, since the x-axis is a scale.
  const ratingInterpretation = describeComposition(
    toPoints(feedbackRatingChart, (row: any) => `${row.rating}-star`, (row: any) => row.count),
    {
      noun: 'ratings',
      entityNoun: 'star level',
      emptyMessage: 'No rated feedback falls inside the selected range, so there is nothing to interpret yet.',
    }
  )

  return (
    <>
      {reportToolbar({
        title: 'Feedback',
        showStatus: false,
      })}
      {/* Feedback has no response workflow, so only measurable submission metrics are shown. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total Feedback</CardDescription><CardTitle className="text-[30px] leading-none">{feedbackKpi.total}</CardTitle><p className="text-[11px] text-slate-400">Responses in selected period</p></CardHeader></Card>
        <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Average Rating</CardDescription><CardTitle className="text-[30px] leading-none">{feedbackKpi.avgRating.toFixed(2)}</CardTitle><p className="text-[11px] text-slate-400">Across rated submissions</p></CardHeader></Card>
        <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Positive Ratings</CardDescription><CardTitle className="text-[30px] leading-none">{feedbackKpi.positiveRate}%</CardTitle><p className="text-[11px] text-slate-400">Ratings of 4–5 stars</p></CardHeader></Card>
        <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Neutral Ratings</CardDescription><CardTitle className="text-[30px] leading-none">{feedbackKpi.neutralRate}%</CardTitle><p className="text-[11px] text-slate-400">Ratings of 3 stars</p></CardHeader></Card>
        <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Negative Ratings</CardDescription><CardTitle className="text-[30px] leading-none">{feedbackKpi.negativeRate}%</CardTitle><p className="text-[11px] text-slate-400">Ratings of 1–2 stars</p></CardHeader></Card>
      </div>
      <Card className={chartCardClassName}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Ratings Distribution</CardTitle>
          <CardDescription>Client rating spread from 1 to 5</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            {feedbackRatingTotal === 0 ? (
              <p className="py-8 text-center text-gray-500">No feedback rating data for this range</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={feedbackRatingChart} margin={{ top: 15, right: 30, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="rating"
                    tick={{ fontSize: 14, fill: '#64748b', fontWeight: 'bold' }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: 'Star Rating', position: 'insideBottom', offset: -10, style: { fontSize: 12 } }}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={false}
                    contentStyle={chartTooltipStyle}
                    labelStyle={chartTooltipLabelStyle}
                    itemStyle={chartTooltipItemStyle}
                    formatter={(value: any) => [`${Number(value).toLocaleString()} ratings`, 'Count']}
                  />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]} animationDuration={800} maxBarSize={42}>
                    {feedbackRatingChart.map((entry) => {
                      const rating = Number(entry.rating)
                      let color = '#ef4444'
                      if (rating === 5) color = '#22c55e'
                      else if (rating === 4) color = '#3b82f6'
                      else if (rating === 3) color = '#fbbf24'
                      else if (rating === 2) color = '#f97316'
                      return <Cell key={entry.rating} fill={color} />
                    })}
                    <LabelList
                      dataKey="count"
                      position="top"
                      fill="#0f172a"
                      fontSize={11}
                      formatter={(value: any) => (Number(value) > 0 ? String(value) : '')}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <ChartInterpretation
            text={
              feedbackRatingTotal === 0
                ? 'No rated feedback falls inside the selected range, so there is nothing to interpret yet.'
                : `${ratingInterpretation} The average rating is ${feedbackKpi.avgRating.toFixed(2)}, with ${feedbackKpi.positiveRate}% positive and ${feedbackKpi.negativeRate}% negative.`
            }
          />
        </CardContent>
      </Card>
      <Card className="rounded-2xl border border-slate-200 shadow-sm">
        <CardHeader>
          <div>
            <CardTitle>Client Feedback & Service Evaluation Report</CardTitle>
            <CardDescription>Customer ratings and evaluation records</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Customer</th>
                  <th className="p-3 text-left">Driver</th>
                  <th className="p-3 text-left">Type</th>
                  <th className="p-3 text-left">Rating</th>
                </tr>
              </thead>
              <tbody>
                {previewRows(feedbackRows).map((row, index) => (
                  <tr key={`${row.createdAt}-${index}`} className="border-b last:border-0">
                    <td className="p-3">{formatDateTime(row.createdAt)}</td>
                    <td className="p-3">{String(row.customer || 'N/A')}</td>
                    <td className="p-3">{String((row as any).driver || 'N/A')}</td>
                    <td className="p-3">{String(row.type || 'N/A')}</td>
                    <td className="p-3">{String(row.rating || 'N/A')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {feedbackRows.length === 0 ? <p className="py-8 text-center text-gray-500">No feedback records found for this range</p> : null}
          </div>
        </CardContent>
      </Card>
    </>
  )
}
