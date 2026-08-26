'use client'

import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Store,
  TrendingUp,
  TrendingDown,
  Receipt,
  DollarSign,
  ShoppingCart,
  Calendar,
  Search,
  ArrowUpDown,
  ShoppingBag,
  Building2,
  Users,
  Download,
  Printer,
  FileSpreadsheet,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { formatPeso, formatDateTime, formatDayKey } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'

function getItemSize(item: any): string {
  if (Array.isArray(item?.sizes) && item.sizes.length > 0) {
    return item.sizes.map((s: any) => String(s || '').trim()).filter(Boolean).join(' ')
  }
  if (Array.isArray(item?.product?.sizes) && item.product.sizes.length > 0) {
    return item.product.sizes.map((s: any) => String(s || '').trim()).filter(Boolean).join(' ')
  }
  const explicit = String(item?.sizeLabel || item?.productSize || item?.product?.sizeLabel || item?.product?.size || '').trim()
  if (explicit) return explicit
  const unit = String(item?.product?.unit || item?.productUnit || '').trim()
  return /\d\s*(ml|l|liter|litre|oz|cl|g|kg)\b/i.test(unit) ? unit : ''
}

function formatProductNameWithSize(item: any): string {
  const name = String(item?.productName || item?.product?.name || item?.name || 'Product').trim()
  const size = getItemSize(item)
  const cleanName = name.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  const cleanSize = size.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  return cleanSize && !cleanName.toLowerCase().includes(cleanSize.toLowerCase())
    ? `${cleanName} ${cleanSize}`
    : cleanName
}

interface RetailSalesReportProps {
  orders: any[]
  retailSales?: any[]
}

type PeriodMode = 'all' | '7' | '30' | '90' | '365' | 'custom'

export function RetailSalesReport({ orders, retailSales = [] }: RetailSalesReportProps) {
  const [periodMode, setPeriodMode] = useState<PeriodMode>('30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 15

  // Consolidate retail transactions from orders (salesChannel is RETAIL or RETAIL_POS) + retailSales
  const retailTransactions = useMemo(() => {
    const list: any[] = []

    orders
      .filter((o) => {
        const channel = String(o.salesChannel || '').toUpperCase()
        return channel === 'RETAIL' || channel === 'RETAIL_POS'
      })
      .forEach((o) => {
        const txNumber = o.retailTransactionNumber || o.orderNumber || `POS-${o.id?.slice(-6)}`
        const customer = o.walkInName || o.customer?.name || o.shippingName || 'Walk-in Retail Customer'
        const amount = Number(o.totalAmount || o.subtotal || 0)
        const date = o.createdAt || new Date().toISOString()
        const items = Array.isArray(o.items) ? o.items : []

        list.push({
          id: o.id,
          txNumber,
          customer,
          amount,
          date,
          itemsCount: items.length,
          items,
          channel: String(o.salesChannel || 'RETAIL').toUpperCase(),
          status: String(o.retailStatus || o.status || 'COMPLETED').toUpperCase(),
        })
      })

    // Also include any retailSales records not already included
    retailSales.forEach((rs) => {
      const txNum = rs.transactionNumber || rs.id
      const exists = list.some((item) => item.txNumber === txNum || item.id === rs.id)
      if (!exists) {
        list.push({
          id: rs.id,
          txNumber: txNum,
          customer: rs.customerName || rs.walkInName || 'Walk-in Retail Customer',
          amount: Number(rs.totalAmount || rs.subtotal || 0),
          date: rs.createdAt || new Date().toISOString(),
          itemsCount: Array.isArray(rs.items) ? rs.items.length : 0,
          items: rs.items || [],
          channel: 'RETAIL_POS',
          status: String(rs.status || 'COMPLETED').toUpperCase(),
        })
      }
    })

    return list
  }, [orders, retailSales])

  // Split the selected date window from its immediately preceding comparison period.
  const { currentPeriodItems, prevPeriodItems, periodLabel, prevPeriodLabel } = useMemo(() => {
    const now = new Date()
    let currentStartTime = Number.NEGATIVE_INFINITY
    let currentEndTime = now.getTime()
    let prevStartTime = Number.NEGATIVE_INFINITY
    let prevEndTime = Number.NEGATIVE_INFINITY
    let label = 'All Time'
    let prevLabel = 'No prior comparison'

    if (periodMode === 'custom') {
      if (dateFrom) currentStartTime = new Date(`${dateFrom}T00:00:00`).getTime()
      if (dateTo) currentEndTime = new Date(`${dateTo}T23:59:59.999`).getTime()
      label = dateFrom || dateTo ? `${dateFrom || 'Start'} to ${dateTo || 'Today'}` : 'Custom Date Range'

      // A complete custom range can be compared with the equally sized preceding window.
      if (dateFrom && dateTo && currentEndTime >= currentStartTime) {
        const duration = currentEndTime - currentStartTime
        prevEndTime = currentStartTime
        prevStartTime = currentStartTime - duration
        prevLabel = 'prior matching period'
      }
    } else if (periodMode !== 'all') {
      const days = Number(periodMode)
      const currentStart = new Date(now)
      currentStart.setDate(now.getDate() - days)
      currentStart.setHours(0, 0, 0, 0)
      currentStartTime = currentStart.getTime()
      prevEndTime = currentStartTime
      prevStartTime = currentStartTime - days * 24 * 60 * 60 * 1000
      label = periodMode === '365' ? 'Past 1 Year' : `Past ${days} Days`
      prevLabel = periodMode === '365' ? 'Prior 1 Year' : `Prior ${days} Days`
    }

    const currentPeriodItems = retailTransactions.filter((item) => {
      const t = new Date(item.date).getTime()
      return t >= currentStartTime && t <= currentEndTime
    })

    const prevPeriodItems = retailTransactions.filter((item) => {
      const t = new Date(item.date).getTime()
      return t >= prevStartTime && t < prevEndTime
    })

    return { currentPeriodItems, prevPeriodItems, periodLabel: label, prevPeriodLabel: prevLabel }
  }, [retailTransactions, periodMode, dateFrom, dateTo])

  // Filtered current period list for table
  const filteredCurrentItems = useMemo(() => {
    let list = currentPeriodItems

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      list = list.filter(
        (item) =>
          item.txNumber.toLowerCase().includes(q) ||
          item.customer.toLowerCase().includes(q) ||
          (Array.isArray(item.items) &&
            item.items.some((i: any) => {
              const name = String(i.productName || i.name || '').toLowerCase()
              const compMatch =
                Array.isArray(i.components) &&
                i.components.some((c: any) =>
                  String(c.productName || c.name || '').toLowerCase().includes(q)
                )
              return name.includes(q) || compMatch
            }))
      )
    }

    list = [...list].sort((a, b) => {
      const timeA = new Date(a.date).getTime()
      const timeB = new Date(b.date).getTime()
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB
    })

    return list
  }, [currentPeriodItems, searchTerm, sortOrder])

  // Period Metrics & Growth Calculation
  const metrics = useMemo(() => {
    const currentSales = currentPeriodItems.reduce((sum, item) => sum + item.amount, 0)
    const currentTxCount = currentPeriodItems.length
    const currentAvgValue = currentTxCount > 0 ? currentSales / currentTxCount : 0

    const prevSales = prevPeriodItems.reduce((sum, item) => sum + item.amount, 0)
    const prevTxCount = prevPeriodItems.length

    const salesGrowth = prevSales > 0 ? ((currentSales - prevSales) / prevSales) * 100 : currentSales > 0 ? 100 : 0
    const txGrowth = prevTxCount > 0 ? ((currentTxCount - prevTxCount) / prevTxCount) * 100 : currentTxCount > 0 ? 100 : 0

    return {
      currentSales,
      currentTxCount,
      currentAvgValue,
      prevSales,
      prevTxCount,
      salesGrowth,
      txGrowth,
    }
  }, [currentPeriodItems, prevPeriodItems])

  // Sales Trend Chart Data
  const trendChartData = useMemo(() => {
    const map: Record<string, { label: string; sales: number; count: number; dateSort: number }> = {}

    currentPeriodItems.forEach((item) => {
      const d = new Date(item.date)
      let key = ''
      let label = ''

      if (['7', '30', 'custom'].includes(periodMode)) {
        key = formatDayKey(d)
        label = `${d.getMonth() + 1}/${d.getDate()}`
      } else {
        // Longer ranges are grouped by month to keep the chart readable.
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      }

      if (!map[key]) {
        map[key] = {
          label,
          sales: 0,
          count: 0,
          dateSort: d.getTime(),
        }
      }
      map[key].sales += item.amount
      map[key].count += 1
    })

    return Object.values(map).sort((a, b) => a.dateSort - b.dateSort)
  }, [currentPeriodItems, periodMode])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredCurrentItems.length / pageSize))
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredCurrentItems.slice(start, start + pageSize)
  }, [filteredCurrentItems, currentPage])

  const exportColumns: ExportColumn[] = [
    { header: 'POS / Receipt ID', key: 'txNumber' },
    { header: 'Customer', key: 'customer' },
    {
      header: 'Products',
      accessor: (r) =>
        Array.isArray(r.items) && r.items.length > 0
          ? r.items
              .map((item: any) => {
                const isMixedCase =
                  String(item.itemType || item.item_type || item.mode || '').toUpperCase() === 'MIXED_CASE' ||
                  (Array.isArray(item.components) && item.components.length > 0) ||
                  /mixed\s*case/i.test(String(item.productName || item.name || ''))
                const hasComponents = Array.isArray(item.components) && item.components.length > 0
                const qty = Number(item.quantity || item.qty || 1)
                if (isMixedCase && hasComponents) {
                  const compList = item.components
                    .map((c: any) => {
                      const cName = formatProductNameWithSize(c)
                      const cQty = Number(c.quantityPerCase || c.quantityBaseUnits || c.quantity || 0)
                      return `${cName} ×${cQty}`
                    })
                    .join(', ')
                  return `${formatProductNameWithSize(item)} ×${qty} [${compList}]`
                }
                const name = formatProductNameWithSize(item)
                return `${name} ×${qty}`
              })
              .join('; ')
          : `${r.itemsCount} item(s)`,
    },
    { header: 'Status', key: 'status' },
    { header: 'Amount (PHP)', accessor: (r) => Number(r.amount || 0).toFixed(2) },
    { header: 'Date & Time', accessor: (r) => formatDateTime(r.date) },
  ]

  const handleExportCsv = () => {
    exportToCsv(`retail-sales-${periodMode}-${new Date().toISOString().slice(0, 10)}.csv`, exportColumns, filteredCurrentItems)
  }

  const handleExportPdf = () => {
    exportReportPdf(
      `retail-sales-${periodMode}-${new Date().toISOString().slice(0, 10)}.pdf`,
      `Retail Sales Report (${periodLabel})`,
      exportColumns,
      filteredCurrentItems,
      [
        `Total Retail Sales: ${formatPeso(metrics.currentSales)} (${metrics.salesGrowth >= 0 ? `+${metrics.salesGrowth.toFixed(1)}%` : `${metrics.salesGrowth.toFixed(1)}%`} vs prior period)`,
        `Transactions Count: ${metrics.currentTxCount} | Average Basket: ${formatPeso(metrics.currentAvgValue)}`,
      ],
      periodLabel
    )
  }

  const handlePrint = () => {
    printReportTable(
      `Retail Sales Report (${periodLabel})`,
      exportColumns,
      filteredCurrentItems,
      [
        `Total Retail Sales: ${formatPeso(metrics.currentSales)} (${metrics.salesGrowth >= 0 ? `+${metrics.salesGrowth.toFixed(1)}%` : `${metrics.salesGrowth.toFixed(1)}%`} vs prior period)`,
        `Transactions Count: ${metrics.currentTxCount} | Average Basket: ${formatPeso(metrics.currentAvgValue)}`,
      ],
      periodLabel
    )
  }

  return (
    <div className="report-design-system space-y-6">
      {/* Header with Mode Switcher & Export */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Retail Sales Reports</h2>
          <p className="text-sm text-slate-500">Retail POS performance, revenue velocity, period growth rates, and customer basket sizes.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Use the same fixed date-range choices as every other Reports tab. */}
          <select
            value={periodMode}
            onChange={(event) => {
              setPeriodMode(event.target.value as PeriodMode)
              setCurrentPage(1)
            }}
            aria-label="Filter retail sales by date range"
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

      {/* Custom dates appear only when the shared Custom Date Range option is selected. */}
      {periodMode === 'custom' && (
        <Card className="border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Custom Date Range:</span>
            <Input type="date" onClick={(event) => event.currentTarget.showPicker?.()} value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setCurrentPage(1) }} className="h-9 w-auto text-xs" aria-label="Retail sales date from" />
            <span className="text-xs text-slate-400">to</span>
            <Input type="date" onClick={(event) => event.currentTarget.showPicker?.()} value={dateTo} onChange={(event) => { setDateTo(event.target.value); setCurrentPage(1) }} className="h-9 w-auto text-xs" aria-label="Retail sales date to" />
          </div>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Sales */}
        <Card className="rounded-2xl border border-emerald-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-emerald-600">Total Retail Sales</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-700">{formatPeso(metrics.currentSales)}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center gap-1.5 text-xs">
              {metrics.salesGrowth >= 0 ? (
                <span className="flex items-center text-emerald-600 font-semibold">
                  <TrendingUp className="mr-0.5 h-3.5 w-3.5" /> +{metrics.salesGrowth.toFixed(1)}%
                </span>
              ) : (
                <span className="flex items-center text-rose-600 font-semibold">
                  <TrendingDown className="mr-0.5 h-3.5 w-3.5" /> {metrics.salesGrowth.toFixed(1)}%
                </span>
              )}
              <span className="text-slate-400">vs {prevPeriodLabel}</span>
            </div>
          </CardContent>
        </Card>

        {/* Total Transactions */}
        <Card className="rounded-2xl border border-blue-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-blue-600">Transactions Count</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{metrics.currentTxCount}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center gap-1.5 text-xs">
              {metrics.txGrowth >= 0 ? (
                <span className="flex items-center text-blue-600 font-semibold">
                  <TrendingUp className="mr-0.5 h-3.5 w-3.5" /> +{metrics.txGrowth.toFixed(1)}%
                </span>
              ) : (
                <span className="flex items-center text-rose-600 font-semibold">
                  <TrendingDown className="mr-0.5 h-3.5 w-3.5" /> {metrics.txGrowth.toFixed(1)}%
                </span>
              )}
              <span className="text-slate-400">vs {prevPeriodLabel}</span>
            </div>
          </CardContent>
        </Card>

        {/* Average Transaction Value */}
        <Card className="rounded-2xl border border-purple-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-purple-600">Average Basket Size</CardDescription>
            <CardTitle className="text-2xl font-bold text-purple-700">{formatPeso(metrics.currentAvgValue)}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Mean gross receipt value</CardContent>
        </Card>

        {/* Prior Period Benchmark */}
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-slate-500">Prior Period Revenue</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-700">{formatPeso(metrics.prevSales)}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-400">Baseline ({prevPeriodLabel})</CardContent>
        </Card>
      </div>

      {/* Sales Trend Chart */}
      {trendChartData.length > 0 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">
              Retail Sales Velocity ({periodLabel})
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">Periodic revenue and transaction volume trends</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="retailSalesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `₱${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(value: any) => [formatPeso(Number(value)), 'Retail Sales']}
                    contentStyle={{ borderRadius: '12px', borderColor: '#e2e8f0', fontSize: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Area type="monotone" dataKey="sales" stroke="#059669" strokeWidth={2.5} fillOpacity={1} fill="url(#retailSalesGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter & Search Bar */}
      <Card className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search POS Transaction ID / Customer..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-9 text-xs"
            />
          </div>

          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className="gap-2 text-xs font-medium"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Transaction Table */}
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3.5 pl-4">Receipt / POS ID</th>
                <th className="p-3.5">Customer / Walk-In</th>
                <th className="p-3.5">Products</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Sale Amount</th>
                <th className="p-3.5 pr-4">Date & Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {paginatedItems.length > 0 ? (
                paginatedItems.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 pl-4 font-semibold text-emerald-700">{row.txNumber}</td>
                    <td className="p-3.5 font-medium text-slate-900">{row.customer}</td>
                    <td className="p-3.5">
                      {Array.isArray(row.items) && row.items.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          {row.items.map((item: any, idx: number) => {
                            const isMixedCase =
                              String(item.itemType || item.item_type || item.mode || '').toUpperCase() === 'MIXED_CASE' ||
                              (Array.isArray(item.components) && item.components.length > 0) ||
                              /mixed\s*case/i.test(String(item.productName || item.name || ''))
                            const hasComponents = Array.isArray(item.components) && item.components.length > 0
                            const mainName = formatProductNameWithSize(item)
                            const qty = Number(item.quantity || item.qty || 1)

                            if (isMixedCase && hasComponents) {
                              return (
                                <div key={idx} className="space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-slate-800 leading-snug">{mainName}</span>
                                    <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">×{qty}</span>
                                  </div>
                                  <div className="pl-2 border-l-2 border-slate-200 space-y-0.5">
                                    {item.components.map((comp: any, cIdx: number) => {
                                      const compName = formatProductNameWithSize(comp)
                                      const compQty = Number(comp.quantityPerCase || comp.quantityBaseUnits || comp.quantity || 0)
                                      const totalUnits = Number(comp.totalBaseUnits || (compQty * qty))
                                      const displayCount = compQty > 0 ? compQty : totalUnits
                                      return (
                                        <div key={cIdx} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                                          <span className="text-slate-400">↳</span>
                                          <span className="font-medium text-slate-700">{compName}</span>
                                          <span className="shrink-0 rounded bg-slate-100 px-1 py-0.2 text-[9px] font-semibold text-slate-500">×{displayCount}</span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            }

                            return (
                              <div key={idx} className="flex items-center gap-1.5">
                                <span className="font-medium text-slate-800 leading-snug">{mainName}</span>
                                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">×{qty}</span>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <span className="text-slate-400">{row.itemsCount} item(s)</span>
                      )}
                    </td>
                    <td className="p-3.5">
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Completed</Badge>
                    </td>
                    <td className="p-3.5 text-right font-semibold text-slate-900">{formatPeso(row.amount)}</td>
                    <td className="p-3.5 pr-4 text-slate-500 whitespace-nowrap">{formatDateTime(row.date)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <Store className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    No retail sales records found for this period.
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
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredCurrentItems.length)} of {filteredCurrentItems.length} records
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
