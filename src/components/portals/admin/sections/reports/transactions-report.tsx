'use client'

import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Receipt,
  Search,
  ArrowUpDown,
  DollarSign,
  TrendingUp,
  CreditCard,
  Building2,
  Calendar,
  Store,
  Globe,
  ShoppingBag,
  Download,
  Printer,
  FileSpreadsheet,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { formatPeso, formatDateTime, formatDayKey, withinRange } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'

interface TransactionsReportProps {
  orders: any[]
  retailSales?: any[]
}

export function TransactionsReport({ orders, retailSales = [] }: TransactionsReportProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [channelFilter, setChannelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('all')
  const [datePreset, setDatePreset] = useState<'all' | '7' | '30' | '90' | '365' | 'custom'>('30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 15

  // Unified transactions list combining Orders and Retail Sales
  const allTransactions = useMemo(() => {
    const list: any[] = []

    // Add Wholesale and regular Online orders
    orders.forEach((o) => {
      const channel = String(o.salesChannel || 'ONLINE').toUpperCase()
      const txNumber = o.retailTransactionNumber || o.orderNumber || `TX-${o.id?.slice(-8)}`
      const client = o.customer?.name || o.shippingName || o.walkInName || 'Client / Customer'
      const clientEmail = o.customer?.email || ''
      const amount = Number(o.totalAmount || o.subtotal || 0)
      const date = o.createdAt || new Date().toISOString()
      const status = String(o.status || 'PENDING').toUpperCase()
      const paymentStatus = String(o.paymentStatus || (status === 'DELIVERED' ? 'PAID' : 'PENDING')).toUpperCase()

      list.push({
        id: o.id,
        txNumber,
        orderId: o.id,
        client,
        clientEmail,
        amount,
        date,
        channel: channel === 'RETAIL_POS' ? 'RETAIL_POS' : channel === 'RETAIL' ? 'RETAIL_COUNTER' : 'WHOLESALE_ONLINE',
        status,
        paymentStatus,
        itemSummary: Array.isArray(o.items) ? `${o.items.length} items` : '1 order',
      })
    })

    // If retailSales are provided separately and not already in orders list, append unique ones
    retailSales.forEach((rs) => {
      const txNum = rs.transactionNumber || rs.id
      const exists = list.some((item) => item.txNumber === txNum || item.id === rs.id)
      if (!exists) {
        list.push({
          id: rs.id,
          txNumber: txNum,
          orderId: rs.id,
          client: rs.customerName || rs.walkInName || 'Walk-in Retail Customer',
          clientEmail: '',
          amount: Number(rs.totalAmount || rs.subtotal || 0),
          date: rs.createdAt || new Date().toISOString(),
          channel: 'RETAIL_POS',
          status: 'COMPLETED',
          paymentStatus: 'PAID',
          itemSummary: Array.isArray(rs.items) ? `${rs.items.length} items` : 'Retail items',
        })
      }
    })

    return list
  }, [orders, retailSales])

  // Filter and Sort
  const filteredTransactions = useMemo(() => {
    let list = allTransactions

    // Date filtering
    if (datePreset !== 'all') {
      if (datePreset === 'custom') {
        if (dateFrom) {
          const fromTime = new Date(`${dateFrom}T00:00:00`).getTime()
          list = list.filter((item) => new Date(item.date).getTime() >= fromTime)
        }
        if (dateTo) {
          const toTime = new Date(`${dateTo}T23:59:59.999`).getTime()
          list = list.filter((item) => new Date(item.date).getTime() <= toTime)
        }
      } else {
        const days = Number(datePreset)
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - days)
        cutoff.setHours(0, 0, 0, 0)
        list = list.filter((item) => withinRange(item.date, cutoff))
      }
    }

    // Channel filter
    if (channelFilter !== 'all') {
      list = list.filter((item) => item.channel === channelFilter)
    }

    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter((item) => item.status === statusFilter)
    }

    // Payment Status filter
    if (paymentStatusFilter !== 'all') {
      list = list.filter((item) => item.paymentStatus === paymentStatusFilter)
    }

    // Search term
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      list = list.filter(
        (item) =>
          item.txNumber.toLowerCase().includes(q) ||
          item.client.toLowerCase().includes(q) ||
          item.clientEmail.toLowerCase().includes(q)
      )
    }

    // Sorting
    list = [...list].sort((a, b) => {
      const timeA = new Date(a.date).getTime()
      const timeB = new Date(b.date).getTime()
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB
    })

    return list
  }, [allTransactions, datePreset, dateFrom, dateTo, channelFilter, statusFilter, paymentStatusFilter, searchTerm, sortOrder])

  // KPIs
  const kpis = useMemo(() => {
    const totalCount = filteredTransactions.length
    const totalVolume = filteredTransactions.reduce((sum, item) => sum + (item.amount || 0), 0)
    const paidCount = filteredTransactions.filter((item) => item.paymentStatus === 'PAID').length
    const avgValue = totalCount > 0 ? totalVolume / totalCount : 0

    return { totalCount, totalVolume, paidCount, avgValue }
  }, [filteredTransactions])

  // Trend Chart Data (Daily Revenue)
  const chartData = useMemo(() => {
    const map: Record<string, { date: string; amount: number; count: number }> = {}
    filteredTransactions.forEach((item) => {
      const d = new Date(item.date)
      const key = formatDayKey(d)
      if (!map[key]) {
        map[key] = {
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          amount: 0,
          count: 0,
        }
      }
      map[key].amount += item.amount || 0
      map[key].count += 1
    })

    return Object.values(map).slice(-14)
  }, [filteredTransactions])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / pageSize))
  const paginatedTransactions = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredTransactions.slice(start, start + pageSize)
  }, [filteredTransactions, currentPage])

  const getChannelBadge = (channel: string) => {
    switch (channel) {
      case 'WHOLESALE_ONLINE':
        return (
          <Badge variant="outline" className="gap-1 border-blue-200 bg-blue-50 text-blue-700">
            <Globe className="h-3 w-3" /> Wholesale
          </Badge>
        )
      case 'RETAIL_POS':
        return (
          <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
            <Store className="h-3 w-3" /> Retail POS
          </Badge>
        )
      case 'RETAIL_COUNTER':
        return (
          <Badge variant="outline" className="gap-1 border-indigo-200 bg-indigo-50 text-indigo-700">
            <ShoppingBag className="h-3 w-3" /> Counter Sale
          </Badge>
        )
      default:
        return <Badge variant="outline">{channel}</Badge>
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DELIVERED':
      case 'COMPLETED':
        return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Completed</Badge>
      case 'OUT_FOR_DELIVERY':
      case 'PREPARING':
      case 'IN_TRANSIT':
        return <Badge className="bg-blue-50 text-blue-700 border-blue-200">Processing</Badge>
      case 'PENDING':
        return <Badge className="bg-amber-50 text-amber-700 border-amber-200">Pending</Badge>
      case 'CANCELLED':
      case 'REJECTED':
        return <Badge className="bg-rose-50 text-rose-700 border-rose-200">Cancelled</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const exportColumns: ExportColumn[] = [
    { header: 'Transaction ID', key: 'txNumber' },
    { header: 'Channel / Type', key: 'channel' },
    { header: 'Client / Customer', key: 'client' },
    { header: 'Status', key: 'status' },
    { header: 'Payment Status', key: 'paymentStatus' },
    { header: 'Amount (PHP)', accessor: (r) => Number(r.amount || 0).toFixed(2) },
    { header: 'Transaction Date', accessor: (r) => formatDateTime(r.date) },
  ]

  const handleExportCsv = () => {
    exportToCsv(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, exportColumns, filteredTransactions)
  }

  const handleExportPdf = () => {
    exportReportPdf(
      `transactions-${new Date().toISOString().slice(0, 10)}.pdf`,
      'Transaction Records Report',
      exportColumns,
      filteredTransactions,
      [
        `Total Transactions: ${kpis.totalCount}`,
        `Gross Revenue: ${formatPeso(kpis.totalVolume)} | Average Ticket: ${formatPeso(kpis.avgValue)}`,
        `Settled / Paid: ${kpis.paidCount} of ${kpis.totalCount}`,
      ]
    )
  }

  const handlePrint = () => {
    printReportTable(
      'Transaction Records Report',
      exportColumns,
      filteredTransactions,
      [
        `Total Transactions: ${kpis.totalCount}`,
        `Gross Revenue: ${formatPeso(kpis.totalVolume)} | Average Ticket: ${formatPeso(kpis.avgValue)}`,
        `Settled / Paid: ${kpis.paidCount} of ${kpis.totalCount}`,
      ]
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Transaction Records</h2>
          <p className="text-sm text-slate-500">Complete financial ledger of wholesale and retail sales transactions across all sales channels.</p>
        </div>

        {/* Export Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="h-9 gap-1.5 rounded-xl border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            className="h-9 gap-1.5 rounded-xl border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <Download className="h-4 w-4 text-blue-600" />
            Export PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="h-9 gap-1.5 rounded-xl border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <Printer className="h-4 w-4 text-slate-600" />
            Print
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl border border-blue-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-blue-600">Total Transactions</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{kpis.totalCount}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">All matching ledger entries</CardContent>
        </Card>

        <Card className="rounded-2xl border border-emerald-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-emerald-600">Gross Transaction Revenue</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-700">{formatPeso(kpis.totalVolume)}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Total transaction value</CardContent>
        </Card>

        <Card className="rounded-2xl border border-purple-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-purple-600">Average Transaction Value</CardDescription>
            <CardTitle className="text-2xl font-bold text-purple-700">{formatPeso(kpis.avgValue)}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Mean basket size per transaction</CardContent>
        </Card>

        <Card className="rounded-2xl border border-amber-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-amber-600">Settled / Paid Records</CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-700">{kpis.paidCount}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">
            {kpis.totalCount > 0 ? ((kpis.paidCount / kpis.totalCount) * 100).toFixed(1) : 0}% settlement rate
          </CardContent>
        </Card>
      </div>

      {/* Daily Revenue Trend */}
      {chartData.length > 0 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Transaction Revenue Trend</CardTitle>
            <CardDescription className="text-xs text-slate-500">Daily gross value over time</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="txRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `₱${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(value: any) => [formatPeso(Number(value)), 'Revenue']}
                    contentStyle={{ borderRadius: '12px', borderColor: '#e2e8f0', fontSize: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#txRevenueGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter Bar */}
      <Card className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search TX ID / Client..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-9 text-xs"
            />
          </div>

          {/* Channel Filter */}
          <div>
            <select
              value={channelFilter}
              onChange={(e) => {
                setChannelFilter(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter by transaction type or sales channel"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Transaction Types</option>
              <option value="WHOLESALE_ONLINE">Wholesale (Online)</option>
              <option value="RETAIL_POS">Retail POS</option>
              <option value="RETAIL_COUNTER">Retail Counter</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter by transaction status"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Transaction Statuses</option>
              <option value="DELIVERED">Delivered / Completed</option>
              <option value="PREPARING">Preparing</option>
              <option value="OUT_FOR_DELIVERY">Out For Delivery</option>
              <option value="PENDING">Pending</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* Date Range Preset */}
          <div>
            <select
              value={datePreset}
              onChange={(e) => {
                setDatePreset(e.target.value as any)
                setCurrentPage(1)
              }}
              aria-label="Filter by transaction date preset"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Time</option>
              <option value="7">Past 7 Days</option>
              <option value="30">Past 30 Days</option>
              <option value="90">Past 90 Days</option>
              <option value="365">Past 1 Year</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </div>

          {/* Sort Order */}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className="w-full gap-2 text-xs font-medium"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
            </Button>
          </div>
        </div>

        {/* Custom Date Pickers */}
        {datePreset === 'custom' && (
          <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
            <span className="text-xs font-medium text-slate-500">Date Range:</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter transaction from date"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter transaction to date"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            />
          </div>
        )}
      </Card>

      {/* Transaction Table */}
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3.5 pl-4">Transaction ID</th>
                <th className="p-3.5">Type / Channel</th>
                <th className="p-3.5">Client / Customer</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Payment</th>
                <th className="p-3.5 text-right">Amount</th>
                <th className="p-3.5 pr-4">Transaction Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {paginatedTransactions.length > 0 ? (
                paginatedTransactions.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 pl-4 font-semibold text-slate-900">{row.txNumber}</td>
                    <td className="p-3.5">{getChannelBadge(row.channel)}</td>
                    <td className="p-3.5">
                      <div className="font-medium text-slate-900">{row.client}</div>
                      {row.clientEmail && <div className="text-[11px] text-slate-400">{row.clientEmail}</div>}
                    </td>
                    <td className="p-3.5">{getStatusBadge(row.status)}</td>
                    <td className="p-3.5">
                      <span className={`inline-flex items-center gap-1 font-medium ${row.paymentStatus === 'PAID' ? 'text-emerald-600' : 'text-amber-600'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${row.paymentStatus === 'PAID' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        {row.paymentStatus}
                      </span>
                    </td>
                    <td className="p-3.5 text-right font-semibold text-slate-900">{formatPeso(row.amount)}</td>
                    <td className="p-3.5 pr-4 text-slate-500 whitespace-nowrap">{formatDateTime(row.date)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Receipt className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    No transaction records match the selected filters.
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
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredTransactions.length)} of {filteredTransactions.length} records
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
