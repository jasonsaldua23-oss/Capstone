'use client'

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
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  LabelList,
} from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeComposition, describeRanking, describeTrend, toPoints } from '@/lib/chart-interpretation'
import type { FeedbackServiceDimension } from '@shared/customer-logic/feedback-reasons'
import {  } from '../shared'
import { chartCardClassName, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle } from './chart-styles'
import type { ReportDatasets } from './use-report-datasets'
import type { ReportToolbarRenderer } from './chart-styles'
import { ReportKpiRow } from './report-kpi'
import { formatReportTableDateTime } from '@/components/portals/admin/sections/report-date-utils'

/**
 * Client feedback tab: the rating spread, what each review was actually about,
 * the complaints that recur, and the detail table behind every export.
 */
export type FeedbackReportTabProps = {
  feedback: any[]
  feedbackDimensionRows: ReportDatasets['feedbackDimensionRows']
  feedbackKpi: ReportDatasets['feedbackKpi']
  feedbackParticipation: ReportDatasets['feedbackParticipation']
  feedbackRatingChart: ReportDatasets['feedbackRatingChart']
  feedbackRatingTotal: ReportDatasets['feedbackRatingTotal']
  feedbackRows: ReportDatasets['feedbackRows']
  feedbackSatisfactionTrend: ReportDatasets['feedbackSatisfactionTrend']
  feedbackTopIssues: ReportDatasets['feedbackTopIssues']
  reportToolbar: ReportToolbarRenderer
}

// The same colour per service dimension as the admin feedback screen, so a reader
// moving between the two does not have to relearn the pills.
const DIMENSION_PILL_CLASS: Record<FeedbackServiceDimension, string> = {
  timeliness: 'bg-blue-50 text-blue-700 ring-blue-200',
  accuracy: 'bg-violet-50 text-violet-700 ring-violet-200',
  condition: 'bg-amber-50 text-amber-700 ring-amber-200',
  driver: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  communication: 'bg-sky-50 text-sky-700 ring-sky-200',
  overall: 'bg-slate-100 text-slate-600 ring-slate-200',
}

const SENTIMENT_BADGE_CLASS: Record<string, string> = {
  Positive: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
  Neutral: 'bg-amber-100 text-amber-700 hover:bg-amber-100',
  Negative: 'bg-red-100 text-red-700 hover:bg-red-100',
  Unrated: 'bg-slate-100 text-slate-600 hover:bg-slate-100',
}

export function FeedbackReportTab({
  feedback,
  feedbackDimensionRows,
  feedbackKpi,
  feedbackParticipation,
  feedbackRatingChart,
  feedbackRatingTotal,
  feedbackRows,
  feedbackSatisfactionTrend,
  feedbackTopIssues,
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

  const mentionedDimensions = feedbackDimensionRows.filter((row) => row.hasSignal)
  const silentDimensions = feedbackDimensionRows.filter((row) => !row.hasSignal)
  const dimensionInterpretation = mentionedDimensions.length === 0
    ? 'No review in this range cited a service area, so there is nothing to break down yet.'
    : `${describeRanking(
        toPoints(mentionedDimensions, (row: any) => row.label, (row: any) => row.mentions),
        { noun: 'mentions', entityNoun: 'service area' }
      )}${
        // The area drawing the most complaints is the actionable part, not the loudest one.
        (() => {
          const worst = mentionedDimensions.slice().sort((a, b) => b.negativeRate - a.negativeRate)[0]
          return worst && worst.negative > 0
            ? ` ${worst.label} draws the most complaints, with ${worst.negativeRate}% of its mentions rated 1-2 stars.`
            : ' No service area drew a negative rating in this range.'
        })()
      }`

  const negativeReasonTotal = feedbackTopIssues.reduce((sum, issue) => sum + issue.count, 0)

  const ratedTrendPoints = feedbackSatisfactionTrend.filter((point) => Number(point.responses || 0) > 0)
  const trendResponses = ratedTrendPoints.reduce((sum, point) => sum + Number(point.responses || 0), 0)
  const trendInterpretation = ratedTrendPoints.length === 0
    ? 'No month in the last six carries a rated response, so the trend cannot be read yet.'
    : `${describeTrend(
        toPoints(ratedTrendPoints, (point: any) => point.label, (point: any) => point.avgScore),
        // 'level' keeps this reading as an average rating rather than a running total.
        { noun: 'satisfaction scores', periodNoun: 'month', measure: 'level' }
      )} That is based on ${trendResponses.toLocaleString('en-US')} rated responses across ${ratedTrendPoints.length} of the last 6 months.`

  return (
    <>
      {reportToolbar({
        title: 'Feedback',
        showStatus: false,
      })}
      {/* Feedback has no response workflow, so only measurable submission metrics are shown. */}
      {/* The average rating is the headline this tab answers to; the polarity
          split and participation say how much that average can be trusted. */}
      <ReportKpiRow
        headline={{
          label: 'Average Rating',
          value: feedbackKpi.avgRating.toFixed(2),
          hint: `Across ${feedbackKpi.ratedCount} rated submissions`,
          tone: 'indigo',
        }}
        items={[
          { label: 'Positive', value: `${feedbackKpi.positiveRate}%`, hint: `${feedbackKpi.positiveCount} rated 4-5 stars`, tone: 'emerald' },
          { label: 'Neutral', value: `${feedbackKpi.neutralRate}%`, hint: `${feedbackKpi.neutralCount} rated 3 stars`, tone: 'amber' },
          { label: 'Negative', value: `${feedbackKpi.negativeRate}%`, hint: `${feedbackKpi.negativeCount} rated 1-2 stars`, tone: 'rose' },
          {
            label: 'Participation',
            value: `${feedbackParticipation.participationRate}%`,
            hint: `${feedbackParticipation.reviewedOrders} of ${feedbackParticipation.deliveredOrders} delivered orders reviewed`,
            tone: 'blue',
          },
          { label: 'Total Feedback', value: feedbackKpi.total, hint: `${feedbackKpi.ratedCount} carried a rating`, tone: 'slate' },
          { label: 'Described In Own Words', value: feedbackKpi.describedCount, hint: 'Wrote instead of ticking a phrase', tone: 'purple' },
          { label: 'Distinct Complaints', value: negativeReasonTotal, hint: 'Negative reasons raised in range', tone: 'cyan' },
        ]}
      />
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

      <Card className={chartCardClassName}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Satisfaction Trend — last 6 months</CardTitle>
          <CardDescription>Monthly average rating. Covers all feedback, not just the selected range.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            {ratedTrendPoints.length === 0 ? (
              <p className="py-8 text-center text-gray-500">No rated feedback in the last six months</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={feedbackSatisfactionTrend} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={chartTooltipLabelStyle}
                    itemStyle={chartTooltipItemStyle}
                    formatter={(value: any, _name: any, entry: any) => [
                      `${value} from ${entry?.payload?.responses ?? 0} response${entry?.payload?.responses === 1 ? '' : 's'}`,
                      'Avg Rating',
                    ]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="avgScore"
                    name="Avg Rating"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 4, strokeWidth: 2, fill: '#ffffff' }}
                    // A month with no feedback is a gap in the record, not a zero score.
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <ChartInterpretation text={trendInterpretation} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className={chartCardClassName}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Service Dimension Breakdown</CardTitle>
            <CardDescription>
              What each review was about — from the phrases clients ticked and from anything they
              described themselves, in English, Tagalog or Hiligaynon.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {mentionedDimensions.length === 0 ? (
                <p className="py-8 text-center text-gray-500">No feedback cited a service area in this range</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={feedbackDimensionRows} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis type="category" dataKey="label" width={126} tick={{ fontSize: 12, fill: '#64748b' }} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                      itemStyle={chartTooltipItemStyle}
                    />
                    <Legend />
                    <Bar dataKey="negative" stackId="dimension" fill="#ef4444" name="Negative" />
                    <Bar dataKey="neutral" stackId="dimension" fill="#f59e0b" name="Neutral" />
                    <Bar dataKey="positive" stackId="dimension" fill="#16a34a" name="Positive" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            {silentDimensions.length > 0 ? (
              // An unmentioned dimension is missing evidence, not a clean record.
              <p className="pt-1 text-xs text-gray-400">
                No feedback mentioned: {silentDimensions.map((row) => row.label).join(', ')}
              </p>
            ) : null}
            <ChartInterpretation text={dimensionInterpretation} />
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Top Issues</CardTitle>
            <CardDescription>The complaints clients raised most often in this range</CardDescription>
          </CardHeader>
          <CardContent>
            {feedbackTopIssues.length === 0 ? (
              <p className="py-12 text-center text-gray-500">No negative feedback in this range</p>
            ) : (
              <div className="space-y-3">
                {feedbackTopIssues.map((issue) => (
                  <div key={issue.reason} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                      {issue.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-900">{issue.reason}</p>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${DIMENSION_PILL_CLASS[issue.dimension]}`}>
                          {issue.dimensionLabel}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-red-400" style={{ width: `${issue.share}%` }} />
                        </div>
                        <span className="shrink-0 text-xs text-gray-500">
                          {issue.count}x · {issue.share}% · avg {issue.avgRating.toFixed(1)}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-400">Last reported {formatReportTableDateTime(issue.lastSeenAt as any)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border border-slate-200 shadow-sm">
        <CardHeader>
          <div>
            <CardTitle>Client Feedback & Service Evaluation Report</CardTitle>
            <CardDescription>Every review with the order it rates, the service areas it covers, and what the client actually said</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <table className="stack-table w-full min-w-[1180px] text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Customer</th>
                  <th className="p-3 text-left">Order #</th>
                  <th className="p-3 text-left">Source</th>
                  <th className="p-3 text-left">Driver</th>
                  <th className="p-3 text-left">Type</th>
                  <th className="p-3 text-left">Rating</th>
                  <th className="p-3 text-left">Service Areas</th>
                  <th className="p-3 text-left">Feedback Details</th>
                </tr>
              </thead>
              <tbody>
                {/* Fix: show every filtered review counted by the KPI, including rows beyond the old eight-row preview. */}
                {feedbackRows.map((row, index) => (
                  <tr key={`${row.id || row.createdAt}-${index}`} className="border-b last:border-0 align-top">
                    <td className="p-3">{formatReportTableDateTime(row.createdAt)}</td>
                    <td className="p-3">{String(row.customer || 'N/A')}</td>
                    <td className="p-3">{String(row.orderNumber || 'N/A')}</td>
                    <td className="p-3">{String(row.source || 'N/A')}</td>
                    <td className="p-3">{String(row.driver || 'N/A')}</td>
                    <td className="p-3">{String(row.type || 'N/A')}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{String(row.rating ?? 'N/A')}</span>
                        <Badge className={SENTIMENT_BADGE_CLASS[row.sentiment] || SENTIMENT_BADGE_CLASS.Unrated}>{row.sentiment}</Badge>
                      </div>
                    </td>
                    <td className="p-3">
                      {row.serviceAreas.length === 0 ? (
                        <span className="text-gray-400">N/A</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {row.serviceAreas.map((label) => (
                            <span key={label} className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      {row.reasons.length > 0 ? (
                        <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-slate-700">
                          {row.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                        </ul>
                      ) : null}
                      {row.describedText ? (
                        // Free text is quoted so a reader can tell the client's own words
                        // apart from a phrase they ticked.
                        <p className="mt-1 border-l-2 border-slate-200 pl-2 text-[13px] italic text-slate-600">
                          &ldquo;{row.describedText}&rdquo;
                        </p>
                      ) : null}
                      {row.reasons.length === 0 && !row.describedText ? <span className="text-gray-400">No details given</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {feedbackRows.length === 0 ? <p className="py-8 text-center text-gray-500">No feedback records found for this range</p> : null}
            {feedbackRows.length > 0 ? (
              <p className="pt-3 text-xs text-gray-400">
                Showing all {feedbackRows.length} {feedbackRows.length === 1 ? 'review' : 'reviews'}.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </>
  )
}
