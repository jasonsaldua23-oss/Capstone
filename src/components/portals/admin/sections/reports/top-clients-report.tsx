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
import { formatPeso, formatDateTime, withinRange } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'

interface TopClientsReportProps {
  orders: any[]
  customers?: any[]
}

type PeriodFilter = 'all' | '7' | '30' | '90' | '365' | 'custom'

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
        const days = Number(periodFilter)
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - days)
        cutoff.setHours(0, 0, 0, 0)
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

      const orderAmount = Number(o.totalAmount || o.subtotal || 0)
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
          transactionsCount: 0,
          firstOrderDate: orderDate,
          mostRecentDate: orderDate,
        }
      }

      const entry = clientStatsMap[key]
      entry.totalAmount += orderAmount
      entry.orderCount += 1
      entry.transactionsCount += 1

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

  // KPIs
  const kpis = useMemo(() => {
    const totalClients = rankedClients.length
    const totalRevenue = rankedClients.reduce((sum, c) => sum + c.totalAmount, 0)
    const avgPerClient = totalClients > 0 ? totalRevenue / totalClients : 0
    const topClient = rankedClients[0] || null

    return { totalClients, totalRevenue, avgPerClient, topClient }
  }, [rankedClients])

  // Chart Data: Top 8 Clients by Revenue
  const chartData = useMemo(() => {
    return rankedClients.slice(0, 8).map((c, i) => ({
      name: c.name.length > 18 ? `${c.name.slice(0, 18)}...` : c.name,
      amount: c.totalAmount,
      orders: c.orderCount,
      rank: i + 1,
    }))
  }, [rankedClients])

  // Top 3 Podium
  const topThree = rankedClients.slice(0, 3)

  // Pagination
  const totalPages = Math.max(1, Math.ceil(rankedClients.length / pageSize))
  const paginatedClients = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return rankedClients.slice(start, start + pageSize)
  }, [rankedClients, currentPage])

  const exportColumns: ExportColumn[] = [
    { header: 'Rank', accessor: (r: any) => `#${r.rank || 1}` },
    { header: 'Client Name', key: 'name' },
    { header: 'Email', key: 'email' },
    { header: 'Barangay', key: 'barangay' },
    { header: 'Orders Placed', key: 'orderCount' },
    { header: 'Total Purchased (PHP)', accessor: (r) => Number(r.totalAmount || 0).toFixed(2) },
    { header: 'Latest Transaction', accessor: (r) => formatDateTime(r.mostRecentDate) },
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
    <div className="report-design-system space-y-6">
      {/* Header with Period Switcher & Export */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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
            className="h-11 min-w-[190px] rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            <option value="all">All Time</option>
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
        <Card className="p-3 border border-slate-200 bg-white">
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Top Performer */}
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs uppercase font-medium tracking-wide text-slate-500">
                #1 Top Client
              </CardDescription>
              <Trophy className="h-4 w-4 text-blue-600" />
            </div>
            <CardTitle className="text-xl font-bold text-slate-900 truncate">
              {kpis.topClient ? kpis.topClient.name : 'No records'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs font-semibold text-blue-700">
            {kpis.topClient ? `${formatPeso(kpis.topClient.totalAmount)} (${kpis.topClient.orderCount} orders)` : 'N/A'}
          </CardContent>
        </Card>

        {/* Total Active Clients */}
        <Card className="rounded-2xl border border-blue-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-blue-600">Active Purchasing Clients</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{kpis.totalClients}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Clients with placed orders in period</CardContent>
        </Card>

        {/* Total Revenue */}
        <Card className="rounded-2xl border border-emerald-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-emerald-600">Cumulative Revenue</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-700">{formatPeso(kpis.totalRevenue)}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Total client revenue in period</CardContent>
        </Card>

        {/* Average per Client */}
        <Card className="rounded-2xl border border-purple-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-purple-600">Average Client Value</CardDescription>
            <CardTitle className="text-2xl font-bold text-purple-700">{formatPeso(kpis.avgPerClient)}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Average spending per active client</CardContent>
        </Card>
      </div>

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
          </CardContent>
        </Card>
      )}

      {/* Filter and Sort Toolbar */}
      <Card className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
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
                      <td className="p-3.5 pr-4 text-right text-slate-500 whitespace-nowrap">{formatDateTime(client.mostRecentDate)}</td>
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
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 bg-slate-50/50">
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
