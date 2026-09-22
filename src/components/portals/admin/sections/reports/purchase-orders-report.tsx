'use client'

import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  FileCheck,
  Search,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Truck,
  PackageCheck,
  XCircle,
  TrendingUp,
  Calendar,
  Download,
  Printer,
  FileSpreadsheet,
} from 'lucide-react'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeSeriesMix, describeTrend, toPoints } from '@/lib/chart-interpretation'
import { formatPeso, formatDayKey, withinRange } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'
import { ReportKpiRow } from './report-kpi'
import { buildDailyChartSeries } from '@/lib/report-metrics'
import { resolveReportCutoff, formatReportTableDateTime } from '@/components/portals/admin/sections/report-date-utils'

interface PurchaseOrdersReportProps {
  orders: any[]
  warehouses?: any[]
}

export function PurchaseOrdersReport({ orders }: PurchaseOrdersReportProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [datePreset, setDatePreset] = useState<'all' | 'today' | '7' | '30' | '90' | '365' | 'custom'>('30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 15

  // Extract purchase orders from orders
  const rawPOList = useMemo(() => {
    return orders
      .filter((o) => {
        // Exclude retail-only POS sales
        const channel = String(o.salesChannel || '').toUpperCase()
        if (channel === 'RETAIL_POS') return false
        
        const reqStatus = String(o.requestStatus || '').toUpperCase()
        const poNumber = o.purchaseOrderNumber
        const poStage = o.purchaseOrderStage
        // Include if explicitly marked as approved PR / PO stage, or has PO number, or wholesale order
        return Boolean(poNumber || poStage || reqStatus === 'APPROVED' || o.status === 'DELIVERED' || o.status === 'PREPARING' || o.status === 'OUT_FOR_DELIVERY')
      })
      .map((o) => {
        const poNumber = o.purchaseOrderNumber || `PO-${o.orderNumber || o.id?.slice(-6)}`
        const prNumber = o.purchaseRequestNumber || o.requestId || `PR-${o.orderNumber || o.id?.slice(-6)}`
        const client = o.customer?.name || o.shippingName || o.walkInName || 'Wholesale Client'
        const clientEmail = o.customer?.email || ''
        const clientPhone = o.customer?.phone || o.shippingPhone || ''
        
        let stage = String(o.purchaseOrderStage || '').toUpperCase()
        if (!stage) {
          const normStatus = String(o.status || '').toUpperCase()
          if (normStatus === 'DELIVERED') stage = 'DELIVERED'
          else if (normStatus === 'OUT_FOR_DELIVERY') stage = 'OUT_FOR_DELIVERY'
          else if (normStatus === 'PREPARING') stage = 'PROCESSING'
          else if (normStatus === 'CANCELLED') stage = 'CANCELLED'
          else stage = 'APPROVED'
        }
        // Ready/for-delivery records are represented by the simpler Processing stage in reports.
        if (['READY_FOR_DELIVERY', 'FOR_DELIVERY'].includes(stage)) stage = 'PROCESSING'

        const date = o.createdAt || new Date().toISOString()
        const deliveredDate = o.timeline?.deliveredAt || (stage === 'DELIVERED' ? o.updatedAt : null)
        const amount = Number(o.totalAmount || o.subtotal || 0)

        return {
          id: o.id,
          poNumber,
          prNumber,
          orderNumber: o.orderNumber,
          client,
          clientEmail,
          clientPhone,
          stage,
          date,
          deliveredDate,
          amount,
        }
      })
  }, [orders])

  // Filter and Sort
  const filteredPOs = useMemo(() => {
    let list = rawPOList

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
        // Shared so every tab's window matches its chart; see resolveReportCutoff.
        const cutoff = resolveReportCutoff(datePreset)
        list = list.filter((item) => withinRange(item.date, cutoff))
      }
    }

    // Stage filter
    if (stageFilter !== 'all') {
      list = list.filter((item) => item.stage === stageFilter)
    }

    // Search term
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      list = list.filter(
        (item) =>
          item.poNumber.toLowerCase().includes(q) ||
          item.prNumber.toLowerCase().includes(q) ||
          item.orderNumber.toLowerCase().includes(q) ||
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
  }, [rawPOList, datePreset, dateFrom, dateTo, stageFilter, searchTerm, sortOrder])

  // KPIs
  const kpis = useMemo(() => {
    const total = filteredPOs.length
    const delivered = filteredPOs.filter((p) => p.stage === 'DELIVERED' || p.stage === 'COMPLETED').length
    const processing = filteredPOs.filter((p) => p.stage === 'PROCESSING').length
    const cancelled = filteredPOs.filter((p) => p.stage === 'CANCELLED').length
    // Cancelled and rejected orders remain auditable but do not contribute to purchase value.
    const totalValue = filteredPOs.reduce(
      (sum, order) => ['CANCELLED', 'REJECTED'].includes(order.stage) ? sum : sum + (order.amount || 0),
      0
    )

    return { total, delivered, processing, cancelled, totalValue }
  }, [filteredPOs])

  // Build a chronological time series so daily stage movement is easy to compare.
  const chartData = useMemo(() => {
    const map: Record<string, { date: string; total: number; delivered: number; processing: number; cancelled: number; other: number }> = {}
    filteredPOs.forEach((item) => {
      const d = new Date(item.date)
      const key = formatDayKey(d)
      if (!map[key]) {
        map[key] = {
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          total: 0,
          delivered: 0,
          processing: 0,
          cancelled: 0,
          other: 0,
        }
      }
      if (item.stage === 'DELIVERED' || item.stage === 'COMPLETED') {
        map[key].delivered += 1
      } else if (item.stage === 'CANCELLED') {
        map[key].cancelled += 1
      } else if (item.stage === 'PROCESSING') {
        map[key].processing += 1
      } else {
        // Approved, For Delivery and the rest used to count toward the total
        // while matching no plotted series, so the total line floated above the
        // others for a reason the chart never showed. The stack now accounts
        // for every order, which is what makes its height a real total.
        map[key].other += 1
      }
      map[key].total += 1
    })

    return buildDailyChartSeries(map, {
      days: 14,
      fillEmpty: (dateKey) => {
        const [, month, day] = dateKey.split('-')
        return { date: `${Number(month)}/${Number(day)}`, total: 0, delivered: 0, processing: 0, cancelled: 0, other: 0 }
      },
    })
  }, [filteredPOs])

  // The stack carries daily volume; the segments split it by stage, and every
  // order lands in exactly one segment so the two readings agree.
  const chartInterpretation = useMemo(() => {
    const day = (row: any) => row.date
    return `${describeTrend(toPoints(chartData, day, (row: any) => row.total), {
      noun: 'purchase orders',
      periodNoun: 'day',
    })} ${describeSeriesMix(
      [
        { name: 'Delivered', points: toPoints(chartData, day, (row: any) => row.delivered) },
        { name: 'Processing', points: toPoints(chartData, day, (row: any) => row.processing) },
        { name: 'Cancelled', points: toPoints(chartData, day, (row: any) => row.cancelled) },
        { name: 'Other stages', points: toPoints(chartData, day, (row: any) => row.other) },
      ],
      { noun: 'purchase orders', entityNoun: 'stage' }
    )}`
  }, [chartData])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredPOs.length / pageSize))
  const paginatedPOs = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredPOs.slice(start, start + pageSize)
  }, [filteredPOs, currentPage])

  const getStageBadge = (stage: string) => {
    switch (stage) {
      case 'DELIVERED':
      case 'COMPLETED':
        return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Delivered</Badge>
      case 'OUT_FOR_DELIVERY':
        return <Badge className="bg-purple-50 text-purple-700 border-purple-200">Out for Delivery</Badge>
      case 'PROCESSING':
        return <Badge className="bg-blue-50 text-blue-700 border-blue-200">Processing</Badge>
      case 'APPROVED':
        return <Badge className="bg-cyan-50 text-cyan-700 border-cyan-200">Approved PO</Badge>
      case 'CANCELLED':
        return <Badge className="bg-rose-50 text-rose-700 border-rose-200">Cancelled</Badge>
      default:
        return <Badge variant="outline">{stage}</Badge>
    }
  }

  const exportColumns: ExportColumn[] = [
    { header: 'PO Number', key: 'poNumber' },
    { header: 'PR Ref', key: 'prNumber' },
    { header: 'Order Ref', key: 'orderNumber' },
    { header: 'Client', key: 'client' },
    { header: 'PO Stage', key: 'stage' },
    { header: 'PO Total (PHP)', accessor: (r) => Number(r.amount || 0).toFixed(2) },
    { header: 'Created Date', accessor: (r) => formatReportTableDateTime(r.date) },
  ]

  const handleExportCsv = () => {
    exportToCsv(`purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`, exportColumns, filteredPOs)
  }

  const handleExportPdf = () => {
    exportReportPdf(
      `purchase-orders-${new Date().toISOString().slice(0, 10)}.pdf`,
      'Purchase Orders Report',
      exportColumns,
      filteredPOs,
      [
        `Total POs: ${kpis.total}`,
        `Delivered: ${kpis.delivered} | Processing: ${kpis.processing} | Cancelled: ${kpis.cancelled}`,
        `Total PO Value: ${formatPeso(kpis.totalValue)}`,
      ]
    )
  }

  const handlePrint = () => {
    printReportTable(
      'Purchase Orders Report',
      exportColumns,
      filteredPOs,
      [
        `Total POs: ${kpis.total}`,
        `Delivered: ${kpis.delivered} | Processing: ${kpis.processing} | Cancelled: ${kpis.cancelled}`,
        `Total PO Value: ${formatPeso(kpis.totalValue)}`,
      ]
    )
  }

  return (
    <div className="report-design-system space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Purchase Orders Report</h2>
          <p className="text-sm text-slate-500">Comprehensive overview of issued purchase orders and processing stages.</p>
        </div>

        {/* Export Buttons */}
        <div className="flex flex-wrap items-center gap-2">
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

      {/* Purchase value is the figure procurement is steering; the stage counts
          explain how that value is distributed. */}
      <ReportKpiRow
        headline={{
          label: 'Total Purchase Value',
          value: formatPeso(kpis.totalValue),
          hint: 'Excludes cancelled and rejected orders',
          tone: 'indigo',
        }}
        items={[
          { label: 'Purchase Orders', value: kpis.total, tone: 'blue' },
          {
            label: 'Delivered',
            value: kpis.delivered,
            hint: kpis.total > 0 ? `${((kpis.delivered / kpis.total) * 100).toFixed(1)}% fulfilled` : undefined,
            tone: 'emerald',
          },
          { label: 'Processing', value: kpis.processing, hint: 'Being prepared', tone: 'cyan' },
          { label: 'Cancelled', value: kpis.cancelled, hint: 'Before delivery', tone: 'rose' },
        ]}
      />

      {/* A composed time-series separates overall PO volume from each stage trend. */}
      {chartData.length > 0 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Daily Purchase Order Trend</CardTitle>
            <CardDescription className="text-xs text-slate-500">Total purchase order volume and stage movement over time</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', borderColor: '#e2e8f0', fontSize: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', color: '#64748b' }} />
                  {/* Stacked, so the column height IS the day's total. The old
                      chart drew the total as its own series on top of its parts,
                      which squashed the stages into the bottom of the plot and
                      put two near-identical blues in the legend. Counts are
                      discrete, so bars rather than smoothed curves. */}
                  <Bar dataKey="delivered" name="Delivered" fill="#10b981" stackId="po" />
                  <Bar dataKey="processing" name="Processing" fill="#3b82f6" stackId="po" />
                  <Bar dataKey="cancelled" name="Cancelled" fill="#f43f5e" stackId="po" />
                  <Bar dataKey="other" name="Other stages" fill="#8b5cf6" stackId="po" radius={[4, 4, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <ChartInterpretation text={chartInterpretation} />
          </CardContent>
        </Card>
      )}

      {/* Filter Bar */}
      <Card className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search PO / PR / Client..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-9 text-xs"
            />
          </div>

          {/* PO Stage Filter */}
          <div>
            <select
              value={stageFilter}
              onChange={(e) => {
                setStageFilter(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter by purchase order stage"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All PO Stages</option>
              <option value="APPROVED">Approved PO</option>
              <option value="PROCESSING">Processing</option>
              <option value="OUT_FOR_DELIVERY">Out for Delivery</option>
              <option value="DELIVERED">Delivered</option>
              <option value="COMPLETED">Completed</option>
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
              aria-label="Filter by purchase order date preset"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
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
              onClick={(event) => event.currentTarget.showPicker?.()}
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter PO from date"
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
              aria-label="Filter PO to date"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            />
          </div>
        )}
      </Card>

      {/* Detailed PO Table */}
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          <table className="stack-table w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3.5 pl-4">PO Number</th>
                <th className="p-3.5">PR Ref</th>
                <th className="p-3.5">Order Ref</th>
                <th className="p-3.5">Client / Customer</th>
                <th className="p-3.5">Stage</th>
                <th className="p-3.5 text-right">PO Total</th>
                <th className="p-3.5 pr-4">Created Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {paginatedPOs.length > 0 ? (
                paginatedPOs.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 pl-4 font-semibold text-indigo-600">{row.poNumber}</td>
                    <td className="p-3.5 text-slate-500">{row.prNumber}</td>
                    <td className="p-3.5 font-medium text-slate-900">{row.orderNumber}</td>
                    <td className="p-3.5">
                      <div className="font-medium text-slate-900">{row.client}</div>
                      {row.clientEmail && <div className="text-[11px] text-slate-400">{row.clientEmail}</div>}
                    </td>
                    <td className="p-3.5">{getStageBadge(row.stage)}</td>
                    <td className="p-3.5 text-right font-semibold text-slate-900">{formatPeso(row.amount)}</td>
                    <td className="p-3.5 pr-4 text-slate-500 whitespace-nowrap">{formatReportTableDateTime(row.date)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <FileCheck className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    No purchase order records match the selected filters.
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
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredPOs.length)} of {filteredPOs.length} records
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
