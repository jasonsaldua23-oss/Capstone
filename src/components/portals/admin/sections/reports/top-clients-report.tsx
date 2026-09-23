'use client'

import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Trophy,
  Users,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  Search,
  ArrowUpDown,
  Calendar,
  Building2,
  Clock,
  Sparkles,
  Download,
  Printer,
  FileSpreadsheet,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeRanking, toPoints } from '@/lib/chart-interpretation'
import { formatPeso, withinRange } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'
import { resolveReportCutoff, formatReportTableDateTime } from '@/components/portals/admin/sections/report-date-utils'
import { isRevenueRecognized, summarizeCustomerMix } from '@/lib/report-metrics'
import { ReportKpiRow } from './report-kpi'

// Blue is the tab's existing series hue; amber pairs with it at CVD delta-E 37,
// well clear of the 8 floor. Amber sits under 3:1 against white, so every segment
// carries a visible label rather than relying on the fill alone.
const CUSTOMER_MIX_COLORS = { new: '#f59e0b', returning: '#2563eb' } as const

/**
 * One 100% share bar. Labels sit beneath the bar so a thin segment still states
 * its value, and each segment keeps a minimum width so a 1% share stays visible.
 */
function CustomerShareBar({
  label,
  total,
  newValue,
  returningValue,
  newShare,
  returningShare,
  formatValue,
}: {
  label: string
  total: string
  newValue: number
  returningValue: number
  newShare: number
  returningShare: number
  formatValue: (value: number) => string
}) {
  const sum = newValue + returningValue
  const newPercent = sum > 0 ? (newValue / sum) * 100 : 0
  const returningPercent = sum > 0 ? 100 - newPercent : 0

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-slate-600">{label}</p>
        <p className="text-lg font-bold text-slate-900">{total}</p>
      </div>
      <div
        className="mt-2 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={`${label}: ${formatValue(newValue)} new (${newShare}%), ${formatValue(returningValue)} returning (${returningShare}%)`}
      >
        {newValue > 0 ? (
          <span className="h-full rounded-full" style={{ width: `${newPercent}%`, minWidth: 4, background: CUSTOMER_MIX_COLORS.new }} />
        ) : null}
        {returningValue > 0 ? (
          <span className="h-full rounded-full" style={{ width: `${returningPercent}%`, minWidth: 4, background: CUSTOMER_MIX_COLORS.returning }} />
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: CUSTOMER_MIX_COLORS.new }} />
          New {formatValue(newValue)} <span className="text-slate-400">({newShare}%)</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rounded-sm" style={{ background: CUSTOMER_MIX_COLORS.returning }} />
          Returning {formatValue(returningValue)} <span className="text-slate-400">({returningShare}%)</span>
        </span>
      </div>
    </div>
  )
}

interface TopClientsReportProps {
  orders: any[]
  customers?: any[]
}

type PeriodFilter = 'all' | 'today' | '7' | '30' | '90' | '365' | 'custom'

function getClientBarangay(address: unknown, city: unknown) {
  const addressParts = String(address || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  const explicitBarangay = addressParts.find((part) => /\b(barangay|brgy\.?|poblacion)\b/i.test(part))
  if (explicitBarangay) {
    return explicitBarangay.replace(/\bbrgy\.?/i, 'Barangay').replace(/\s+/g, ' ').trim()
  }

  // Customer addresses are stored with the barangay immediately before the city.
  const normalizeLocality = (value: unknown) => String(value || '').toLowerCase().replace(/\bcity\b/g, '').replace(/[^a-z0-9]/g, '')
  const normalizedCity = normalizeLocality(city)
  const cityIndex = addressParts.findIndex((part) => normalizedCity && normalizeLocality(part) === normalizedCity)
  if (cityIndex > 0) {
    const barangayCandidate = addressParts[cityIndex - 1]
    if (normalizeLocality(barangayCandidate) !== normalizedCity) return barangayCandidate
  }

  return 'Barangay not specified'
}

export function TopClientsReport({ orders, customers = [] }: TopClientsReportProps) {
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<'amount' | 'orders' | 'recent'>('amount')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 15

  // Map customers for quick lookup
  const customersMap = useMemo(() => {
    const map = new Map<string, any>()
    customers.forEach((c) => {
      if (c.id) map.set(c.id, c)
      if (c.email) map.set(c.email.toLowerCase(), c)
    })
    return map
  }, [customers])

  // Filter orders by active period
  const filteredOrders = useMemo(() => {
    let list = orders.filter((o) => {
      const status = String(o.status || '').toUpperCase()
      // Exclude cancelled/rejected orders from revenue analytics
      return status !== 'CANCELLED' && status !== 'REJECTED'
    })

    if (periodFilter !== 'all') {
      if (periodFilter === 'custom') {
        if (dateFrom) {
          const fromTime = new Date(`${dateFrom}T00:00:00`).getTime()
          list = list.filter((o) => new Date(o.createdAt || o.date).getTime() >= fromTime)
        }
        if (dateTo) {
          const toTime = new Date(`${dateTo}T23:59:59.999`).getTime()
          list = list.filter((o) => new Date(o.createdAt || o.date).getTime() <= toTime)
        }
      } else {
        // Shared so every tab's window matches its chart; see resolveReportCutoff.
        const cutoff = resolveReportCutoff(periodFilter)
        list = list.filter((o) => withinRange(o.createdAt || o.date, cutoff))
      }
    }

    return list
  }, [orders, periodFilter, dateFrom, dateTo])

  // Aggregate stats per client
  const rankedClients = useMemo(() => {
    const clientStatsMap: Record<
      string,
      {
        id: string
        name: string
        email: string
        phone: string
        barangay: string
        totalAmount: number
        orderCount: number
        deliveredCount: number
        transactionsCount: number
        firstOrderDate: string
        mostRecentDate: string
      }
    > = {}

    filteredOrders.forEach((o) => {
      const customerId = o.customer?.id || o.customerId || o.customer_id || ''
      const customerEmail = (o.customer?.email || o.customerEmail || '').toLowerCase()
      const clientName = o.customer?.name || o.shippingName || o.walkInName || 'Valued Customer'
      const clientPhone = o.customer?.phone || o.shippingPhone || ''
      const customerRecord = customersMap.get(customerId) || customersMap.get(customerEmail)
      const clientCity = o.shippingCity || o.customer?.city || customerRecord?.city || ''
      const clientAddress = o.shippingAddress || o.customer?.address || customerRecord?.address || ''
      const clientBarangay = getClientBarangay(clientAddress, clientCity)

      // Key by ID or email or name
      const key = customerId || customerEmail || clientName

      // Revenue lands only once the order was delivered, the same rule the Orders
      // tab uses. The order count still reflects everything the client placed.
      const orderAmount = isRevenueRecognized(o) ? Math.max(0, Number(o.totalAmount || o.subtotal || 0)) : 0
      const orderDate = o.createdAt || new Date().toISOString()

      if (!clientStatsMap[key]) {
        clientStatsMap[key] = {
          id: customerId || key,
          name: clientName,
          email: customerEmail,
          phone: clientPhone,
          barangay: clientBarangay,
          totalAmount: 0,
          orderCount: 0,
          deliveredCount: 0,
          transactionsCount: 0,
          firstOrderDate: orderDate,
          mostRecentDate: orderDate,
        }
      }

      const entry = clientStatsMap[key]
      entry.totalAmount += orderAmount
      entry.orderCount += 1
      entry.transactionsCount += 1
      if (isRevenueRecognized(o)) entry.deliveredCount += 1

      if (new Date(orderDate).getTime() > new Date(entry.mostRecentDate).getTime()) {
        entry.mostRecentDate = orderDate
      }
      if (new Date(orderDate).getTime() < new Date(entry.firstOrderDate).getTime()) {
        entry.firstOrderDate = orderDate
      }
    })

    let list = Object.values(clientStatsMap)

    // Search filter
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.barangay.toLowerCase().includes(q)
      )
    }

    // Sorting
    list.sort((a, b) => {
      if (sortField === 'amount') return b.totalAmount - a.totalAmount
      if (sortField === 'orders') return b.orderCount - a.orderCount
      return new Date(b.mostRecentDate).getTime() - new Date(a.mostRecentDate).getTime()
    })

    return list
  }, [filteredOrders, customersMap, searchTerm, sortField])

  // The "#1 Top Client" card and the revenue leaderboard mean the same thing no
  // matter how the table below is sorted. They used to read rankedClients[0],
  // so choosing "Most Recent Transaction" relabelled the latest buyer as #1.
  const clientsByRevenue = useMemo(
    () => [...rankedClients].sort((a, b) => b.totalAmount - a.totalAmount || b.orderCount - a.orderCount),
    [rankedClients],
  )

  // KPIs
  const kpis = useMemo(() => {
    const totalClients = rankedClients.length
    const totalRevenue = rankedClients.reduce((sum, c) => sum + c.totalAmount, 0)
    const avgPerClient = totalClients > 0 ? totalRevenue / totalClients : 0
    const topClient = clientsByRevenue[0] || null

    return { totalClients, totalRevenue, avgPerClient, topClient }
  }, [rankedClients, clientsByRevenue])

  // New vs returning. Deliberately reads `orders`, not `filteredOrders`: a
  // client's cohort comes from their whole purchase history, so a short range
  // cannot relabel a long-standing client as new. Only the window's revenue is
  // split between the two groups.
  const customerMix = useMemo(() => {
    let windowStart: Date | null = null
    let windowEnd: Date | null = null
    if (periodFilter === 'custom') {
      windowStart = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null
      windowEnd = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null
    } else if (periodFilter !== 'all') {
      windowStart = resolveReportCutoff(periodFilter)
    }
    return summarizeCustomerMix(orders, { windowStart, windowEnd })
  }, [orders, periodFilter, dateFrom, dateTo])

  // Chart Data: Top 8 Clients by Revenue
  const chartData = useMemo(() => {
    // A client whose only orders are still undelivered has no revenue yet, and a
    // flat zero bar on a revenue leaderboard is noise rather than information.
    return clientsByRevenue.filter((c) => c.totalAmount > 0).slice(0, 8).map((c, i) => ({
      name: c.name.length > 18 ? `${c.name.slice(0, 18)}...` : c.name,
      amount: c.totalAmount,
      orders: c.orderCount,
      rank: i + 1,
    }))
  }, [clientsByRevenue])

  // The leaderboard is capped at eight clients, so the reading describes that same slice.
  const chartInterpretation = useMemo(() => {
    const orders = chartData.reduce((sum: number, row: any) => sum + Number(row.orders || 0), 0)
    return `${describeRanking(toPoints(chartData, (row: any) => row.name, (row: any) => row.amount), {
      noun: 'revenue',
      entityNoun: 'listed client',
      format: (value) => formatPeso(value),
    })} The ${chartData.length} charted clients placed ${orders.toLocaleString('en-US')} orders between them.`
  }, [chartData])

  // Top 3 Podium
  // The podium says "Rank 1 / Top performer", so it ranks by revenue too rather
  // than by whatever the table below happens to be sorted on.
  const topThree = clientsByRevenue.slice(0, 3)

  // Pagination
  const totalPages = Math.max(1, Math.ceil(rankedClients.length / pageSize))
  const paginatedClients = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return rankedClients.slice(start, start + pageSize)
  }, [rankedClients, currentPage])

  const exportColumns: ExportColumn[] = [
    { header: 'Rank', accessor: (r: any) => `#${r.rank || 1}` },
    { header: 'Client Name', key: 'name' },
    { header: 'Barangay', key: 'barangay' },
    { header: 'Orders Placed', key: 'orderCount' },
    { header: 'Total Purchased (PHP)', accessor: (r) => Number(r.totalAmount || 0).toFixed(2) },
  ]

  const handleExportCsv = () => {
    exportToCsv(`top-clients-${periodFilter}-${new Date().toISOString().slice(0, 10)}.csv`, exportColumns, rankedClients)
  }

  const handleExportPdf = () => {
    exportReportPdf(
      `top-clients-${periodFilter}-${new Date().toISOString().slice(0, 10)}.pdf`,
      `Top Clients Analytics (${periodFilter.toUpperCase()})`,
      exportColumns,
      rankedClients,
      [
        `Active Clients: ${kpis.totalClients}`,
        `Cumulative Top Client Revenue: ${formatPeso(kpis.totalRevenue)}`,
        `Average Client Value: ${formatPeso(kpis.avgPerClient)}`,
      ],
      periodFilter.toUpperCase()
    )
  }

  const handlePrint = () => {
    printReportTable(
      `Top Clients Analytics (${periodFilter.toUpperCase()})`,
      exportColumns,
      rankedClients,
      [
        `Active Clients: ${kpis.totalClients}`,
        `Cumulative Top Client Revenue: ${formatPeso(kpis.totalRevenue)}`,
        `Average Client Value: ${formatPeso(kpis.avgPerClient)}`,
      ],
      periodFilter.toUpperCase()
    )
  }

  return (
    <div className="report-design-system flex flex-col gap-6">
      {/* Header with Period Switcher & Export */}
      <div className="order-[-2] flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Top Clients Analytics</h2>
          <p className="text-sm text-slate-500">Ranking of high-value wholesale and commercial clients by purchase frequency, volume, and customer lifetime value.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Use the same fixed date-range choices as every other Reports tab. */}
          <select
            value={periodFilter}
            onChange={(event) => {
              setPeriodFilter(event.target.value as PeriodFilter)
              setCurrentPage(1)
            }}
            aria-label="Filter top clients by date range"
            className="order-last h-11 min-w-[190px] basis-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="7">Past 7 Days</option>
            <option value="30">Past 30 Days</option>
            <option value="90">Past 90 Days</option>
            <option value="365">Past 1 Year</option>
            <option value="custom">Custom Date Range</option>
          </select>

          {/* Export Buttons */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="h-11 gap-2 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <FileSpreadsheet className="h-4 w-4 text-slate-700" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            className="h-11 gap-2 rounded-xl border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-100"
          >
            <Download className="h-4 w-4 text-blue-600" />
            Export PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="h-11 gap-2 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            <Printer className="h-4 w-4 text-slate-600" />
            Print
          </Button>
        </div>
      </div>

      {/* Custom Date Pickers */}
      {periodFilter === 'custom' && (
        <Card className="order-[-1] border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Custom Date Range:</span>
            <input
              type="date"
              onClick={(event) => event.currentTarget.showPicker?.()}
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter client from date"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              onClick={(event) => event.currentTarget.showPicker?.()}
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter client to date"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            />
          </div>
        </Card>
      )}

      {/* Revenue is what the leaderboard ranks on, so it leads and the #1 client
          sits beside it as the name behind the number. */}
      <ReportKpiRow
        headline={{
          label: 'Cumulative Revenue',
          value: formatPeso(kpis.totalRevenue),
          hint: 'Revenue from delivered orders only',
          tone: 'emerald',
        }}
        items={[
          {
            id: 'top-client',
            label: (<><Trophy className="h-3.5 w-3.5 text-blue-600" /> #1 Top Client</>),
            value: <span className="block truncate">{kpis.topClient ? kpis.topClient.name : 'No records'}</span>,
            valueKind: 'text',
            hint: kpis.topClient ? `${formatPeso(kpis.topClient.totalAmount)} across ${kpis.topClient.orderCount} ${kpis.topClient.orderCount === 1 ? 'order' : 'orders'}` : undefined,
            tone: 'blue',
          },
          { label: 'Active Clients', value: kpis.totalClients, hint: 'Placed orders in period', tone: 'purple' },
          { label: 'Average Client Value', value: formatPeso(kpis.avgPerClient), hint: 'Revenue per active client', tone: 'indigo' },
        ]}
      />

      {/* New vs returning. Buyers and pesos are different scales, so they get a
          share bar each rather than sharing one axis. Two categories do not earn
          a pie. */}
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <CardHeader className="p-4 pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold text-slate-800">Customer Mix</CardTitle>
              <CardDescription className="mt-1 text-xs text-slate-500">
                First-time against returning buyers. A client counts as returning when they had
                already bought before this period, however short the period is.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-xs font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: CUSTOMER_MIX_COLORS.new }} />
                New
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: CUSTOMER_MIX_COLORS.returning }} />
                Returning
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-4 pt-0">
          {customerMix.totalCustomers === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No delivered orders in this period, so there is no customer mix to show yet.
            </p>
          ) : (
            <>
              <CustomerShareBar
                label="Buyers"
                total={customerMix.totalCustomers.toLocaleString('en-US')}
                newValue={customerMix.newCustomers}
                returningValue={customerMix.returningCustomers}
                newShare={customerMix.newCustomerShare}
                returningShare={customerMix.returningCustomerShare}
                formatValue={(value) => value.toLocaleString('en-US')}
              />
              <CustomerShareBar
                label="Revenue"
                total={formatPeso(customerMix.totalRevenue)}
                newValue={customerMix.newRevenue}
                returningValue={customerMix.returningRevenue}
                newShare={customerMix.newRevenueShare}
                returningShare={customerMix.returningRevenueShare}
                formatValue={(value) => formatPeso(value)}
              />
              <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                {customerMix.returningCustomers > 0
                  ? `Returning clients are ${customerMix.returningCustomerShare}% of buyers and bring ${customerMix.returningRevenueShare}% of revenue.`
                  : 'Every buyer in this period was buying for the first time.'}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Top 3 Podium Cards */}
      {topThree.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {topThree.map((client, index) => {
            return (
              <Card key={client.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="border-blue-100 bg-blue-50 font-semibold text-blue-700">
                    Rank {index + 1}
                  </Badge>
                  <span className="text-xs font-medium text-slate-400">Top performer</span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Avatar className="h-10 w-10 border border-white shadow-sm">
                    <AvatarFallback className="bg-white text-slate-800 font-bold text-xs">
                      {client.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-slate-900 truncate">{client.name}</h4>
                    <p className="text-xs text-slate-500 truncate">{client.barangay}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                  <div>
                    <span className="text-slate-500">Orders: </span>
                    <span className="font-bold text-slate-800">{client.orderCount}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-blue-700">{formatPeso(client.totalAmount)}</div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Revenue Distribution Chart */}
      {chartData.length > 0 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Top Clients Revenue Leaderboard</CardTitle>
            <CardDescription className="text-xs text-slate-500">Comparison of highest-volume purchasing clients</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `₱${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(value: any) => [formatPeso(Number(value)), 'Total Purchases']}
                    contentStyle={{ borderRadius: '12px', borderColor: '#e2e8f0', fontSize: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="amount" name="Revenue" fill="#2563eb" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ChartInterpretation text={chartInterpretation} />
          </CardContent>
        </Card>
      )}

      {/* Filter and Sort Toolbar */}
      <Card className="order-[-1] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search Client Name / Email / City..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-9 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">Sort by:</span>
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as any)}
              aria-label="Sort clients by"
              className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="amount">Total Purchases (Highest First)</option>
              <option value="orders">Number of Orders</option>
              <option value="recent">Most Recent Transaction</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Ranked Client Table */}
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          <table className="stack-table w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3.5 pl-4 w-12 text-center">Rank</th>
                <th className="p-3.5">Client Information</th>
                <th className="p-3.5">Barangay</th>
                <th className="p-3.5 text-center">Orders Placed</th>
                <th className="p-3.5 text-right">Total Purchased</th>
                <th className="p-3.5 pr-4 text-right">Latest Transaction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {paginatedClients.length > 0 ? (
                paginatedClients.map((client, index) => {
                  const globalRank = (currentPage - 1) * pageSize + index + 1
                  return (
                    <tr key={client.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 pl-4 text-center font-bold">
                        {globalRank === 1 ? (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">1</span>
                        ) : globalRank === 2 ? (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-slate-700 text-xs">2</span>
                        ) : globalRank === 3 ? (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-700">3</span>
                        ) : (
                          <span className="text-slate-400">#{globalRank}</span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <div className="font-semibold text-slate-900">{client.name}</div>
                        {client.email && <div className="text-[11px] text-slate-400">{client.email}</div>}
                      </td>
                      <td className="p-3.5 text-slate-600">{client.barangay}</td>
                      <td className="p-3.5 text-center font-semibold text-slate-900">{client.orderCount}</td>
                      <td className="p-3.5 text-right font-bold text-blue-700">{formatPeso(client.totalAmount)}</td>
                      <td className="p-3.5 pr-4 text-right text-slate-500 whitespace-nowrap">{formatReportTableDateTime(client.mostRecentDate)}</td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <Users className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    No client purchasing records found for this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-slate-100 px-4 py-3 bg-slate-50/50">
            <span className="text-xs text-slate-500">
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, rankedClients.length)} of {rankedClients.length} clients
            </span>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="h-7 text-xs"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="h-7 text-xs"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
