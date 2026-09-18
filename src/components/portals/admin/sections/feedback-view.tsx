'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { subscribeDataSync } from '@/lib/data-sync'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PortalCardsSkeleton } from '@/components/portals/shared/loading-skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CircleCheck,
  FileText,
  MessageSquare,
  Star,
  TrendingDown,
  TrendingUp,
  User,
} from 'lucide-react'
import { BarChart, Bar, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { resolveClientImageUrl } from '@/lib/client-image'
import { getCollection, fetchAllPaginatedCollection } from './shared'
import { buildReportDateWindow, type ReportDatePreset } from './report-date-utils'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeComposition, describeRanking, describeTrend, toPoints } from '@/lib/chart-interpretation'
import { chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle } from './reports/chart-styles'
import {
  buildFeedbackAttentionQueue,
  buildFeedbackComparisonWindow,
  buildFeedbackDimensionBreakdown,
  buildFeedbackRatingDistribution,
  buildFeedbackRows,
  buildFeedbackSatisfactionTrend,
  buildFeedbackTopIssues,
  compareFeedbackKpis,
  describeFeedbackDelta,
  filterFeedbackRowsByWindow,
  summarizeFeedbackParticipation,
  type FeedbackDeltaDisplay,
} from '@/lib/report-metrics'
import {
  FEEDBACK_DIMENSION_LABELS,
  stripOtherReasonPrefix,
  type FeedbackServiceDimension,
} from '@shared/customer-logic/feedback-reasons'

const DIMENSION_PILL_CLASS: Record<FeedbackServiceDimension, string> = {
  timeliness: 'bg-blue-50 text-blue-700 ring-blue-200',
  accuracy: 'bg-violet-50 text-violet-700 ring-violet-200',
  condition: 'bg-amber-50 text-amber-700 ring-amber-200',
  driver: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  communication: 'bg-sky-50 text-sky-700 ring-sky-200',
  overall: 'bg-slate-100 text-slate-600 ring-slate-200',
}

const DATE_PRESET_OPTIONS: Array<{ value: ReportDatePreset; label: string }> = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Past 7 Days' },
  { value: '30', label: 'Past 30 Days' },
  { value: '90', label: 'Past 90 Days' },
  { value: '365', label: 'Past 1 Year' },
  { value: 'custom', label: 'Custom Date Range' },
]

// Feedback carries no driver column, so the driver has to be recovered from whichever
// shape the order payload happens to expose. Lifted out of the render loop, unchanged.
function getAssignedDriverName(item: any, matchedOrder: any): string | null {
  return (
    matchedOrder?.progress?.trip?.driver?.user?.name ||
    matchedOrder?.progress?.trip?.driver?.name ||
    matchedOrder?.assignedDriverName ||
    matchedOrder?.driverName ||
    item?.order?.driver?.name ||
    item?.order?.assignedDriver?.name ||
    item?.order?.assignedDriverName ||
    item?.order?.driverName ||
    item?.order?.trip?.driver?.name ||
    item?.trip?.driver?.name ||
    null
  )
}

function renderStars(rating: number) {
  const rounded = Math.max(0, Math.min(5, Math.round(Number(rating || 0))))
  return (
    <span className="flex items-center gap-0.5" aria-label={`${Number(rating || 0).toFixed(1)} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className={`h-4 w-4 ${index < rounded ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`}
        />
      ))}
    </span>
  )
}

function DimensionPill({ dimension, label }: { dimension: FeedbackServiceDimension; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${DIMENSION_PILL_CLASS[dimension]}`}>
      {label}
    </span>
  )
}

function DeltaChip({ delta, hasPrevious, periodLabel }: { delta: FeedbackDeltaDisplay; hasPrevious: boolean; periodLabel: string }) {
  if (!hasPrevious) {
    return <p className="mt-1 text-xs text-gray-400">No prior period</p>
  }
  const toneClass = delta.tone === 'good' ? 'text-emerald-600' : delta.tone === 'bad' ? 'text-red-600' : 'text-gray-400'
  const Icon = delta.direction === 'up' ? TrendingUp : delta.direction === 'down' ? TrendingDown : null
  return (
    <p className={`mt-1 flex items-center gap-1 text-xs ${toneClass}`}>
      {Icon ? <Icon className="h-3 w-3" strokeWidth={2.2} /> : null}
      <span className="font-semibold">{delta.text}</span>
      <span className="text-gray-400">vs {periodLabel}</span>
    </p>
  )
}

function KpiCard(props: {
  label: string
  value: string
  icon: React.ReactNode
  iconWrapClass: string
  sublabel?: string
  delta?: FeedbackDeltaDisplay
  hasPrevious?: boolean
  periodLabel?: string
}) {
  const reduceMotion = useReducedMotion()
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 shrink-0 rounded-md flex items-center justify-center ${props.iconWrapClass}`}>
            {props.icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-gray-500">{props.label}</p>
            {/* The number itself crossfades so a filter change visibly lands. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={props.value}
                className="text-3xl font-bold"
                initial={reduceMotion ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
                transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
              >
                {props.value}
              </motion.p>
            </AnimatePresence>
            {props.sublabel ? <p className="text-xs text-gray-400">{props.sublabel}</p> : null}
            {props.delta ? (
              <DeltaChip
                delta={props.delta}
                hasPrevious={Boolean(props.hasPrevious)}
                periodLabel={props.periodLabel || 'previous period'}
              />
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function FeedbackKpiCardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Mirrors the loaded layout section for section. Rendering 0.0/5.0 and 0% while the
// fetch is still in flight reads as a real result rather than a pending one.
function FeedbackViewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-28 md:ml-auto" />
          <Skeleton className="h-3 w-48 md:ml-auto" />
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <Skeleton className="h-4 w-44" />
          <div className="flex flex-col gap-3 md:flex-row">
            <Skeleton className="h-10 w-full md:w-40" />
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 w-full md:w-36" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <FeedbackKpiCardSkeleton key={`feedback-kpi-skeleton-${index}`} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="space-y-2">
            <Skeleton className="h-6 w-60 max-w-full" />
            <Skeleton className="h-4 w-full max-w-sm" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full rounded-xl" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-full max-w-xs" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={`feedback-issue-skeleton-${index}`} className="flex items-start gap-3">
                <Skeleton className="mt-0.5 h-6 w-6 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="border-amber-200">
        <CardHeader className="space-y-2 bg-amber-50/60">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full max-w-md" />
        </CardHeader>
        <CardContent className="space-y-2 pt-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`feedback-attention-skeleton-${index}`}
              className="space-y-2 rounded-lg border border-slate-200 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="ml-auto h-3 w-16" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Skeleton className="h-5 w-40 rounded-full" />
                <Skeleton className="h-5 w-32 rounded-full" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-44" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full rounded-xl" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="space-y-2">
            <Skeleton className="h-6 w-64 max-w-full" />
            <Skeleton className="h-4 w-full max-w-xs" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[280px] w-full rounded-xl" />
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-[1.25rem] border border-slate-200/80 bg-white/95 shadow-[0_12px_28px_rgba(148,163,184,0.12)]">
        <CardContent className="space-y-2.5 p-2.5 md:p-3">
          <PortalCardsSkeleton cards={4} />
        </CardContent>
      </Card>
    </div>
  )
}

export function FeedbackView() {
  const [feedbacks, setFeedbacks] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [ordersState, setOrdersState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [searchTerm, setSearchTerm] = useState('')
  const [ratingFilter, setRatingFilter] = useState('all')
  const [datePreset, setDatePreset] = useState<ReportDatePreset>('30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [trendMonthStart, setTrendMonthStart] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  })

  // The two requests are deliberately not awaited together. /api/feedback answers in
  // about a second, while /api/orders serializes every order and takes roughly twenty,
  // so joining them would hold the whole page on a skeleton for the slower one.
  const fetchFeedbacks = useCallback(async () => {
    try {
      const feedbackResult = await fetchAllPaginatedCollection<any>(
        '/api/feedback',
        'feedbacks',
        { cache: 'no-store' },
        { retries: 3, timeoutMs: 15000, pageSize: 200, maxPages: 100 }
      )
      setFeedbacks(feedbackResult.ok ? getCollection<any>(feedbackResult.data, ['feedbacks']) : [])
    } catch (error) {
      console.error('Failed to fetch feedback:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchOrders = useCallback(async () => {
    setOrdersState('loading')
    try {
      // 45s because the endpoint genuinely takes about 23s for ~112 orders; the old
      // 15s ceiling aborted every attempt, which silently emptied the participation
      // denominator and made the rate read 0%.
      const ordersResult = await fetchAllPaginatedCollection<any>(
        '/api/orders?includeItems=none',
        'orders',
        { cache: 'no-store' },
        { retries: 2, timeoutMs: 45000, pageSize: 200, maxPages: 100 }
      )
      if (!ordersResult.ok) {
        setOrdersState('failed')
        return
      }
      setOrders(getCollection<any>(ordersResult.data, ['orders']))
      setOrdersState('ready')
    } catch (error) {
      console.error('Failed to fetch orders for feedback participation:', error)
      setOrdersState('failed')
    }
  }, [])

  useEffect(() => {
    void fetchFeedbacks()
    void fetchOrders()
    // A customer submitting a review bumps the feedback sync stamp, so an open admin
    // page now refreshes itself instead of showing stale counts until a reload.
    const unsubscribe = subscribeDataSync((message) => {
      if (message.scopes.includes('feedback')) void fetchFeedbacks()
      if (message.scopes.includes('orders')) void fetchOrders()
    })
    return unsubscribe
  }, [fetchFeedbacks, fetchOrders])

  useEffect(() => {
    // Keep the rolling chart aligned when an open dashboard crosses into a new month.
    const refreshTrendMonth = () => {
      const now = new Date()
      const nextMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
      setTrendMonthStart((current) => (current === nextMonthStart ? current : nextMonthStart))
    }
    const intervalId = window.setInterval(refreshTrendMonth, 60 * 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  // Parse once. Everything below is a view over these rows.
  const allRows = useMemo(() => buildFeedbackRows(feedbacks, { orders }), [feedbacks, orders])
  const dateWindow = useMemo(
    () => buildReportDateWindow(datePreset, dateFrom, dateTo),
    [datePreset, dateFrom, dateTo]
  )
  const previousWindow = useMemo(() => buildFeedbackComparisonWindow(dateWindow), [dateWindow])
  const currentRows = useMemo(() => filterFeedbackRowsByWindow(allRows, dateWindow), [allRows, dateWindow])
  const previousRows = useMemo(
    () => (previousWindow ? filterFeedbackRowsByWindow(allRows, previousWindow) : null),
    [allRows, previousWindow]
  )
  const kpis = useMemo(() => compareFeedbackKpis(currentRows, previousRows), [currentRows, previousRows])
  const participation = useMemo(
    () => summarizeFeedbackParticipation(currentRows, orders, { window: dateWindow }),
    [currentRows, orders, dateWindow]
  )
  const dimensionRows = useMemo(() => buildFeedbackDimensionBreakdown(currentRows), [currentRows])
  const topIssues = useMemo(() => buildFeedbackTopIssues(currentRows, { limit: 5 }), [currentRows])
  const attentionRows = useMemo(() => buildFeedbackAttentionQueue(currentRows, { limit: 8 }), [currentRows])
  const ratingDistribution = useMemo(() => buildFeedbackRatingDistribution(currentRows), [currentRows])
  // The trend reads every row on purpose: a 7-day filter must not blank a 6-month chart.
  const satisfactionTrend = useMemo(
    () => buildFeedbackSatisfactionTrend(allRows, { months: 6, now: new Date(trendMonthStart) }),
    [allRows, trendMonthStart]
  )

  const negativeReasonTotal = useMemo(
    () => new Set(
      currentRows.flatMap((row) => row.reasons.filter((hit) => hit.polarity === 'negative').map((hit) => hit.canonicalReason))
    ).size,
    [currentRows]
  )
  const silentDimensions = useMemo(() => dimensionRows.filter((row) => !row.hasSignal), [dimensionRows])

  // A dimension nobody mentioned carries no signal, so the reading ranks only the mentioned ones.
  const dimensionInterpretation = useMemo(() => {
    const mentioned = dimensionRows.filter((row) => row.hasSignal)
    if (mentioned.length === 0) {
      return 'No review in this range named a service dimension, so there is nothing to interpret yet.'
    }
    const worst = [...mentioned].sort((a, b) => b.negative - a.negative)[0]
    const complaints = worst.negative > 0
      ? ` ${worst.label} draws the most complaints with ${worst.negative} negative of ${worst.mentions} mentions (${worst.negativeRate}%).`
      : ' No dimension drew a negative mention in this range.'
    return `${describeRanking(
      toPoints(mentioned, (row) => row.label, (row) => row.mentions),
      { noun: 'mentions', entityNoun: 'mentioned dimension' }
    )}${complaints}`
  }, [dimensionRows])

  const ratingDistributionInterpretation = useMemo(() => describeComposition(
    toPoints(ratingDistribution, (row) => row.label, (row) => row.value),
    {
      noun: 'reviews',
      entityNoun: 'star level',
      emptyMessage: 'No rated review falls inside the selected range, so there is nothing to interpret yet.',
    }
  ), [ratingDistribution])

  const satisfactionTrendInterpretation = useMemo(() => {
    const scored = satisfactionTrend.filter((row) => Number(row.responses || 0) > 0)
    if (scored.length === 0) {
      return 'No month in the last six carries a rated response, so the trend cannot be read yet.'
    }
    const responses = scored.reduce((sum, row) => sum + Number(row.responses || 0), 0)
    return `${describeTrend(
      toPoints(scored, (row) => row.label, (row) => row.avgScore),
      { noun: 'satisfaction scores', periodNoun: 'month', measure: 'level' }
    )} That is based on ${responses.toLocaleString('en-US')} rated responses across ${scored.length} of the last 6 months.`
  }, [satisfactionTrend])

  // Raw rows keep the nested order payload the driver fallback needs; a map keeps the
  // lookup out of the render loop.
  const rawFeedbackById = useMemo(() => {
    const map = new Map<string, any>()
    feedbacks.forEach((item) => {
      const id = String(item?.id || '').trim()
      if (id) map.set(id, item)
    })
    return map
  }, [feedbacks])

  const ordersById = useMemo(() => {
    const map = new Map<string, any>()
    orders.forEach((order) => {
      const id = String(order?.id || '').trim()
      const number = String(order?.orderNumber || '').trim()
      if (id) map.set(id, order)
      if (number) map.set(number, order)
    })
    return map
  }, [orders])

  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    return currentRows.filter((row) => {
      const matchesSearch =
        search.length === 0 ||
        row.customerName.toLowerCase().includes(search) ||
        row.orderNumber.toLowerCase().includes(search)
      const matchesRating = ratingFilter === 'all' || row.rating === Number(ratingFilter)
      return matchesSearch && matchesRating
    })
  }, [currentRows, searchTerm, ratingFilter])

  const reduceMotion = useReducedMotion()
  // Keyed on the date window only. Typing in the search box must not remount the
  // charts on every keystroke - search filters the list below, nothing above it.
  const analyticsKey = `${datePreset}|${dateFrom}|${dateTo}`

  const periodLabel = previousWindow ? `previous ${dateWindow.label.toLowerCase().replace('past ', '')}` : 'previous period'
  const comparisonLabel = previousWindow
    ? `${previousWindow.start?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${previousWindow.end?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : null

  if (isLoading) return <FeedbackViewSkeleton />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Client Feedback</h1>
          <p className="text-gray-500">Monitor customer satisfaction and improve service quality</p>
        </div>
        <div className="text-sm text-gray-500 md:text-right">
          <p className="font-medium text-gray-700">{dateWindow.label}</p>
          {comparisonLabel ? <p className="text-xs text-gray-400">compared with {comparisonLabel}</p> : null}
        </div>
      </div>

      {/* The filters govern every number below them, so they sit first. */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <label className="text-sm font-medium text-gray-700">Feedback Search and Filter</label>
          <div className="flex flex-col gap-3 md:flex-row">
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              title="Filter date range"
              value={datePreset}
              onChange={(event) => setDatePreset(event.target.value as ReportDatePreset)}
            >
              {DATE_PRESET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {datePreset === 'custom' ? (
              <div className="flex flex-1 items-center gap-2">
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  onClick={(event) => event.currentTarget.showPicker?.()}
                  className="text-sm"
                />
                <span className="text-sm text-gray-400">to</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  onClick={(event) => event.currentTarget.showPicker?.()}
                  className="text-sm"
                />
              </div>
            ) : null}
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by customer or order ID..."
              className="flex-1"
            />
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              title="Filter Rating"
              value={ratingFilter}
              onChange={(event) => setRatingFilter(event.target.value)}
            >
              <option value="all">All Ratings</option>
              <option value="5">5 Stars</option>
              <option value="4">4 Stars</option>
              <option value="3">3 Stars</option>
              <option value="2">2 Stars</option>
              <option value="1">1 Star</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={analyticsKey}
          className="space-y-6"
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -8 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: 'easeOut' }}
        >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Avg Rating"
          value={`${kpis.current.avgRating.toFixed(1)}/5.0`}
          icon={<Star className="h-5 w-5 text-amber-500" />}
          iconWrapClass="bg-amber-50"
          sublabel={`${kpis.current.ratedCount} rated review${kpis.current.ratedCount === 1 ? '' : 's'}`}
          delta={describeFeedbackDelta(kpis.avgRatingDelta, { unit: 'rating' })}
          hasPrevious={kpis.hasPreviousPeriod}
          periodLabel={periodLabel}
        />
        <KpiCard
          label="Total Feedback"
          value={String(kpis.current.total)}
          icon={<MessageSquare className="h-5 w-5 text-blue-600" />}
          iconWrapClass="bg-blue-50"
          sublabel={`${kpis.current.describedCount} described in their own words`}
          delta={describeFeedbackDelta(kpis.totalDelta, { unit: 'count' })}
          hasPrevious={kpis.hasPreviousPeriod}
          periodLabel={periodLabel}
        />
        <KpiCard
          label="Participation Rate"
          // Orders arrive on their own slower request, so this card must not claim 0%
          // before they land - or claim it at all when they never do.
          value={ordersState === 'ready' ? `${participation.participationRate}%` : '--'}
          icon={<CircleCheck className="h-5 w-5 text-green-600" />}
          iconWrapClass="bg-green-50"
          sublabel={
            ordersState === 'ready'
              ? `${participation.reviewedOrders} of ${participation.deliveredOrders} delivered orders reviewed`
              : ordersState === 'loading'
                ? 'Loading delivered orders...'
                : 'Delivered orders unavailable'
          }
        />
        <KpiCard
          label="Positive Ratings"
          value={`${kpis.current.positiveRate}%`}
          icon={<CircleCheck className="h-5 w-5 text-emerald-600" />}
          iconWrapClass="bg-emerald-50"
          sublabel="4-5 stars"
          delta={describeFeedbackDelta(kpis.positiveRateDelta, { unit: 'percent' })}
          hasPrevious={kpis.hasPreviousPeriod}
          periodLabel={periodLabel}
        />
        <KpiCard
          label="Neutral Ratings"
          value={`${kpis.current.neutralRate}%`}
          icon={<BarChart3 className="h-5 w-5 text-amber-600" />}
          iconWrapClass="bg-amber-50"
          sublabel="3 stars"
          delta={describeFeedbackDelta(kpis.neutralRateDelta, { unit: 'percent', higherIsBetter: false })}
          hasPrevious={kpis.hasPreviousPeriod}
          periodLabel={periodLabel}
        />
        <KpiCard
          label="Negative Ratings"
          value={`${kpis.current.negativeRate}%`}
          icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
          iconWrapClass="bg-red-50"
          sublabel="1-2 stars"
          delta={describeFeedbackDelta(kpis.negativeRateDelta, { unit: 'percent', higherIsBetter: false })}
          hasPrevious={kpis.hasPreviousPeriod}
          periodLabel={periodLabel}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Service Dimension Breakdown</CardTitle>
            <p className="text-sm text-gray-500">
              What each review actually talked about - from the options clients ticked and from
              anything they described themselves, in English, Tagalog or Hiligaynon.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dimensionRows} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="4 4" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="label" width={126} tick={{ fontSize: 12 }} />
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
            </div>
            {silentDimensions.length > 0 ? (
              // An unmentioned dimension is missing evidence, not a clean record.
              <p className="text-xs text-gray-400">
                No feedback mentioned: {silentDimensions.map((row) => row.label).join(', ')}
              </p>
            ) : null}
            <ChartInterpretation text={dimensionInterpretation} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Issues</CardTitle>
            <p className="text-sm text-gray-500">The complaints clients raised most often in this period.</p>
          </CardHeader>
          <CardContent>
            {topIssues.length === 0 ? (
              <div className="py-12 text-center">
                <CircleCheck className="mx-auto mb-3 h-10 w-10 text-emerald-300" />
                <p className="text-sm text-gray-500">No negative feedback in this range</p>
              </div>
            ) : (
              <div className="space-y-3">
                {topIssues.map((issue, index) => (
                  <motion.div
                    key={issue.reason}
                    className="flex items-start gap-3"
                    initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.2, delay: reduceMotion ? 0 : index * 0.05 }}
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                      {issue.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-900">{issue.reason}</p>
                        <DimensionPill dimension={issue.dimension} label={issue.dimensionLabel} />
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-red-400" style={{ width: `${issue.share}%` }} />
                        </div>
                        <span className="shrink-0 text-xs text-gray-500">
                          {issue.count}x · avg {issue.avgRating.toFixed(1)}★
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
                <p className="pt-1 text-xs text-gray-400">
                  Showing top {topIssues.length} of {negativeReasonTotal} distinct negative reasons
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-amber-200">
        <CardHeader className="bg-amber-50/60">
          <CardTitle className="flex items-center gap-2 text-amber-900">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Needs Attention
            {attentionRows.length > 0 ? (
              <span className="rounded-full bg-amber-600 px-2 py-0.5 text-xs font-bold text-white">
                {attentionRows.length}
              </span>
            ) : null}
          </CardTitle>
          <p className="text-sm text-amber-800/80">Recent 1-2 star reviews. Select one to filter the list below.</p>
        </CardHeader>
        <CardContent className="pt-4">
          {attentionRows.length === 0 ? (
            <div className="py-8 text-center">
              <CircleCheck className="mx-auto mb-3 h-10 w-10 text-emerald-300" />
              <p className="text-sm text-gray-500">No 1-2 star feedback in this range</p>
            </div>
          ) : (
            <div className="space-y-2">
              {attentionRows.map((row, index) => (
                <motion.button
                  key={row.id}
                  type="button"
                  onClick={() => setSearchTerm(row.orderNumber)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-amber-300 hover:bg-amber-50/40"
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2, delay: reduceMotion ? 0 : Math.min(index, 6) * 0.04 }}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-slate-900">{row.customerName}</span>
                    <span className="text-xs text-slate-500">{row.orderNumber || 'No order'}</span>
                    {row.isReplacement ? (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">
                        Replacement
                      </span>
                    ) : null}
                    {renderStars(row.rating)}
                    <span className="ml-auto text-xs text-slate-400">{row.ageLabel}</span>
                  </div>
                  {row.reasons.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {row.reasons.map((reason) => (
                        <span key={reason} className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-700 ring-1 ring-red-100">
                          {reason}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {row.describedText ? (
                    <p className="mt-1.5 border-l-2 border-amber-200 pl-2 text-xs italic text-slate-600">{row.describedText}</p>
                  ) : null}
                </motion.button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Rating Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ratingDistribution} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="4 4" horizontal={true} vertical={true} />
                <XAxis type="category" dataKey="label" />
                <YAxis type="number" allowDecimals={false} domain={[0, 'auto']} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  labelStyle={chartTooltipLabelStyle}
                  itemStyle={chartTooltipItemStyle}
                />
                <Bar dataKey="value" name="Reviews" fill="#3b82f6" radius={[2, 2, 2, 2]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
          <CardContent className="pt-0">
            <ChartInterpretation text={ratingDistributionInterpretation} className="mt-0" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Satisfaction Trend - last 6 months</CardTitle>
            <p className="text-sm text-gray-500">Covers all feedback, not just the selected range.</p>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={satisfactionTrend} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="4 4" />
                <XAxis dataKey="label" />
                <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} allowDecimals={false} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  labelStyle={chartTooltipLabelStyle}
                  itemStyle={chartTooltipItemStyle}
                  formatter={(value: any, _name: any, entry: any) => [
                    `${value} from ${entry?.payload?.responses ?? 0} response${entry?.payload?.responses === 1 ? '' : 's'}`,
                    'Avg Score',
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="avgScore"
                  name="Avg Score"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 4, strokeWidth: 2, fill: '#ffffff' }}
                  connectNulls
                />
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
          <CardContent className="pt-0">
            <ChartInterpretation text={satisfactionTrendInterpretation} className="mt-0" />
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-[1.25rem] border border-slate-200/80 bg-white/95 shadow-[0_12px_28px_rgba(148,163,184,0.12)]">
        <CardContent className="space-y-2.5 p-2.5 md:p-3">
          {filteredRows.length === 0 ? (
            <div className="py-12 text-center">
              <MessageSquare className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No customer feedback found</p>
            </div>
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
            {filteredRows.map((row, index) => {
              const matchedOrder = ordersById.get(row.orderId) || ordersById.get(row.orderNumber) || null
              const assignedDriverName = getAssignedDriverName(rawFeedbackById.get(row.id), matchedOrder)
              const customerAvatarUrl = resolveClientImageUrl(row.customerAvatar)
              const presetReasons = row.reasons.filter((hit) => hit.matched)
              const describedReasons = row.reasons.filter((hit) => !hit.matched)
              // What the client typed, recovered from the stored "Other: ..." reason.
              const describedText = describedReasons
                .map((hit) => stripOtherReasonPrefix(hit.reason))
                .join(' ')
              const createdDate = row.createdAtDate ? row.createdAtDate.toLocaleDateString('en-US') : 'N/A'
              return (
                <motion.article
                  key={row.id}
                  layout={reduceMotion ? false : 'position'}
                  className="rounded-[1rem] border border-slate-200/80 bg-white px-2.5 py-2.5 shadow-[0_8px_18px_rgba(148,163,184,0.09)] md:px-3 md:py-3"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.98 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.2,
                    // Only the first few cascade; a long list must not crawl in.
                    delay: reduceMotion ? 0 : Math.min(index, 6) * 0.03,
                  }}
                >
                  <div className="flex flex-col gap-2.5">
                    <div className="flex flex-col gap-2.5 md:flex-row md:items-start">
                      <Avatar className="h-14 w-14 shrink-0 border border-[#d6e3ff] shadow-[0_8px_18px_rgba(148,163,184,0.16)]">
                        {customerAvatarUrl ? <AvatarImage src={customerAvatarUrl} alt={row.customerName} className="object-cover" /> : null}
                        <AvatarFallback className="bg-[linear-gradient(145deg,#e6ecff_0%,#dfe8ff_52%,#d9e4ff_100%)] text-[#4f7ef4]">
                          {String(row.customerName || 'CU')
                            .trim()
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part[0]?.toUpperCase() || '')
                            .join('') || 'CU'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-bold tracking-tight text-slate-900 md:text-[1.4rem]">{row.customerName}</h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.82rem] text-slate-500 md:text-[0.88rem]">
                          <FileText className="h-3.5 w-3.5 text-[#5b84f5]" strokeWidth={2} />
                          <span>Order</span>
                          <span className="text-[1rem] font-semibold leading-none tracking-wide text-[#2047a8] md:text-[1.15rem]">
                            {row.orderNumber || 'No Order'}
                          </span>
                          {row.isReplacement && (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200">
                              Replacement
                            </span>
                          )}
                          {describedReasons.length > 0 && (
                            <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700 ring-1 ring-sky-200">
                              Described
                            </span>
                          )}
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-slate-500">
                          {renderStars(row.rating)}
                          <span className="hidden h-5 w-px bg-slate-200 md:block" />
                          <div className="flex items-center gap-1 text-[0.82rem] md:text-[0.88rem]">
                            <CalendarDays className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.8} />
                            <span>{createdDate}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="h-px w-full bg-slate-200" />
                    <div className="flex flex-wrap items-center gap-1.5 text-[0.82rem] md:text-[0.88rem]">
                      <User className="h-4 w-4 text-[#4f7ef4]" strokeWidth={1.9} />
                      <span className="text-slate-500">Assigned Driver:</span>
                      <span className="font-semibold text-slate-900">{assignedDriverName || 'Unassigned'}</span>
                    </div>
                    <div className="rounded-[0.9rem] border border-[#d6e3ff] bg-[#fbfdff] px-2.5 py-2.5 md:px-3 md:py-3">
                      {presetReasons.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {presetReasons.map((hit) => (
                            <span
                              key={hit.reason}
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${DIMENSION_PILL_CLASS[hit.dimension]}`}
                              title={hit.dimensionLabel}
                            >
                              {hit.reason}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {describedReasons.length > 0 ? (
                        // The client wrote this themselves; show what the classifier made of it.
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] uppercase tracking-wide text-slate-400">Detected</span>
                          {/* One chip per dimension the classifier found, so a sentence
                              covering two areas is not misrepresented as covering one. */}
                          {Array.from(new Set(describedReasons.flatMap((hit) => hit.dimensions))).map((dimension) => (
                            <span
                              key={dimension}
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${DIMENSION_PILL_CLASS[dimension]}`}
                            >
                              {FEEDBACK_DIMENSION_LABELS[dimension]}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {presetReasons.length === 0 && describedReasons.length === 0 ? (
                        <p className="text-[0.82rem] text-slate-500 md:text-[0.9rem]">No feedback message</p>
                      ) : null}
                      {describedText ? (
                        <div className="mt-2.5 flex items-start gap-2 border-t border-[#d6e3ff] pt-2.5">
                          <span className="text-[1.6rem] font-bold leading-none text-[#355fca]">“</span>
                          <p className="pt-0.5 text-[0.82rem] leading-[1.55] text-slate-900 md:text-[0.9rem]">
                            {describedText}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </motion.article>
              )
            })}
            </AnimatePresence>
          )}
        </CardContent>
      </Card>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
