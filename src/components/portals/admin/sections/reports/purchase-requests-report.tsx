'use client'

import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  FileText,
  Search,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  TrendingUp,
  Calendar,
  Building2,
  User,
  Filter,
  Download,
  Printer,
  FileSpreadsheet,
} from 'lucide-react'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { formatPeso, formatDateTime, formatDayKey, withinRange, toIsoDateTime } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'

interface PurchaseRequestsReportProps {
  orders: any[]
  warehouses?: any[]
}

export function PurchaseRequestsReport({ orders }: PurchaseRequestsReportProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [datePreset, setDatePreset] = useState<'all' | '7' | '30' | '90' | '365' | 'custom'>('30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 15

  // Extract purchase requests from orders (wholesale orders with PR number or request status)
  const rawPRList = useMemo(() => {
    return orders
      .filter((o) => {
        // Exclude retail-only counter sales if they don't have PR lifecycle
        const channel = String(o.salesChannel || '').toUpperCase()
        return channel !== 'RETAIL_POS'
      })
      .map((o) => {
        const prNumber = o.purchaseRequestNumber || o.requestId || `PR-${o.orderNumber || o.id?.slice(-6)}`
        const requester = o.customer?.name || o.shippingName || o.walkInName || 'Customer / Requester'
        const status = String(o.requestStatus || (o.status === 'CANCELLED' || o.status === 'REJECTED' ? 'REJECTED' : o.status === 'PENDING' ? 'PENDING_APPROVAL' : 'APPROVED')).toUpperCase()
        const approver = o.approvedByName || (status === 'APPROVED' ? 'Operations Admin' : null)
        const rejector = o.rejectedByName || (status === 'REJECTED' ? 'Operations Admin' : null)
        const reason = o.rejectionReason || o.cancellationReason || ''
        const date = o.createdAt || o.updatedAt || new Date().toISOString()
        const amount = Number(o.totalAmount || o.subtotal || 0)
        const warehouseId = o.warehouseId || o.warehouse_id || o.warehouse?.id || ''
        const warehouseName = o.warehouseName || o.warehouse?.name || 'Central Distribution'

        return {
          id: o.id,
          prNumber,
          orderNumber: o.orderNumber,
          requester,
          customerEmail: o.customer?.email || '',
          customerPhone: o.customer?.phone || o.shippingPhone || '',
          status,
          approver,
          rejector,
          reason,
          amount,
          date,
          warehouseId,
          warehouseName,
          itemsCount: Array.isArray(o.items) ? o.items.length : 0,
        }
      })
  }, [orders])

  // Filter and Sort
  const filteredPRs = useMemo(() => {
    let list = rawPRList

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

    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter((item) => item.status === statusFilter)
    }

    // Search term
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      list = list.filter(
        (item) =>
          item.prNumber.toLowerCase().includes(q) ||
          (item.orderNumber && item.orderNumber.toLowerCase().includes(q)) ||
          item.requester.toLowerCase().includes(q) ||
          item.customerEmail.toLowerCase().includes(q)
      )
    }

    // Sorting
    list = [...list].sort((a, b) => {
      const timeA = new Date(a.date).getTime()
      const timeB = new Date(b.date).getTime()
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB
    })

    return list
  }, [rawPRList, datePreset, dateFrom, dateTo, statusFilter, searchTerm, sortOrder])

  // KPIs
  const kpis = useMemo(() => {
    const total = filteredPRs.length
    const approved = filteredPRs.filter((p) => p.status === 'APPROVED').length
    const pending = filteredPRs.filter((p) => p.status === 'PENDING_APPROVAL' || p.status === 'PENDING').length
    const rejected = filteredPRs.filter((p) => p.status === 'REJECTED' || p.status === 'CANCELLED').length
    // Cancelled and rejected requests remain auditable but do not contribute to requested value.
    const totalValue = filteredPRs.reduce(
      (sum, request) => ['REJECTED', 'CANCELLED'].includes(request.status) ? sum : sum + (request.amount || 0),
      0
    )

    return { total, approved, pending, rejected, totalValue }
  }, [filteredPRs])

  // Trend Chart Data (by Day)
  const chartData = useMemo(() => {
    const map: Record<string, { date: string; approved: number; pending: number; rejected: number; total: number }> = {}
    filteredPRs.forEach((item) => {
      const d = new Date(item.date)
      const key = formatDayKey(d)
      if (!map[key]) {
        map[key] = {
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          approved: 0,
          pending: 0,
          rejected: 0,
          total: 0,
        }
      }
      map[key].total += 1
      if (item.status === 'APPROVED') map[key].approved += 1
      else if (item.status === 'REJECTED' || item.status === 'CANCELLED') map[key].rejected += 1
      else map[key].pending += 1
    })

    // Keep the time-series chronological so the chart communicates an actual daily trend.
    return Object.entries(map)
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .slice(-14)
      .map(([, values]) => values)
  }, [filteredPRs])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredPRs.length / pageSize))
  const paginatedPRs = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredPRs.slice(start, start + pageSize)
  }, [filteredPRs, currentPage])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Approved</Badge>
      case 'PENDING_APPROVAL':
      case 'PENDING':
        return <Badge className="bg-amber-50 text-amber-700 border-amber-200">Pending Approval</Badge>
      case 'REJECTED':
        return <Badge className="bg-rose-50 text-rose-700 border-rose-200">Rejected</Badge>
      case 'CANCELLED':
        return <Badge className="bg-slate-100 text-slate-700 border-slate-200">Cancelled</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const exportColumns: ExportColumn[] = [
    { header: 'PR Number', key: 'prNumber' },
    { header: 'Order Ref', key: 'orderNumber' },
    { header: 'Requester', key: 'requester' },
    { header: 'Warehouse Hub', key: 'warehouseName' },
    { header: 'Status', key: 'status' },
    {
      header: 'Reason',
      accessor: (r) => r.reason || '—',
    },
    { header: 'Amount (PHP)', accessor: (r) => Number(r.amount || 0).toFixed(2) },
    { header: 'Date & Time', accessor: (r) => formatDateTime(r.date) },
  ]

  const handleExportCsv = () => {
    exportToCsv(`purchase-requests-${new Date().toISOString().slice(0, 10)}.csv`, exportColumns, filteredPRs)
  }

  const handleExportPdf = () => {
    exportReportPdf(
      `purchase-requests-${new Date().toISOString().slice(0, 10)}.pdf`,
      'Purchase Requests Report',
      exportColumns,
      filteredPRs,
      [
        `Total Requests: ${kpis.total}`,
        `Approved: ${kpis.approved} | Pending: ${kpis.pending} | Rejected: ${kpis.rejected}`,
        `Total Requested Value: ${formatPeso(kpis.totalValue)}`,
      ]
    )
  }

  const handlePrint = () => {
    printReportTable(
      'Purchase Requests Report',
      exportColumns,
      filteredPRs,
      [
        `Total Requests: ${kpis.total}`,
        `Approved: ${kpis.approved} | Pending: ${kpis.pending} | Rejected: ${kpis.rejected}`,
        `Total Requested Value: ${formatPeso(kpis.totalValue)}`,
      ]
    )
  }

  return (
    <div className="report-design-system space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Purchase Requests Report</h2>
          <p className="text-sm text-slate-500">Centralized log of all purchase requests, approval records, and valuation.</p>
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="rounded-2xl border border-blue-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-blue-600">Total Requests</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{kpis.total}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">100% of filtered requests</CardContent>
        </Card>

        <Card className="rounded-2xl border border-emerald-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-emerald-600">Approved PRs</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-700">{kpis.approved}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">
            {kpis.total > 0 ? ((kpis.approved / kpis.total) * 100).toFixed(1) : 0}% approval rate
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-amber-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-amber-600">Pending Review</CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-700">{kpis.pending}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Awaiting management action</CardContent>
        </Card>

        <Card className="rounded-2xl border border-rose-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-rose-600">Rejected / Cancelled</CardDescription>
            <CardTitle className="text-2xl font-bold text-rose-700">{kpis.rejected}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Denied or withdrawn</CardContent>
        </Card>

        <Card className="rounded-2xl border border-indigo-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-indigo-600">Total Requested Value</CardDescription>
            <CardTitle className="text-2xl font-bold text-indigo-700">{formatPeso(kpis.totalValue)}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Excludes rejected and cancelled requests</CardContent>
        </Card>
      </div>

      {/* A composed time-series separates total volume from individual request statuses. */}
      {chartData.length > 0 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Daily Purchase Request Trend</CardTitle>
            <CardDescription className="text-xs text-slate-500">Total request volume and status movement over time</CardDescription>
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
                  <Area type="monotone" dataKey="total" name="Total Requests" stroke="#2563eb" strokeWidth={2} fill="#dbeafe" fillOpacity={0.7} />
                  <Line type="monotone" dataKey="approved" name="Approved" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="pending" name="Pending" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="rejected" name="Rejected" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
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
              placeholder="Search PR / Order / Requester..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              className="pl-9 text-xs"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter by request status"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Request Statuses</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
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
              aria-label="Filter by date range preset"
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
          <div className="flex gap-2">
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
              aria-label="Filter from date"
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
              aria-label="Filter to date"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            />
          </div>
        )}
      </Card>

      {/* Detailed Records Table */}
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3.5 pl-4">PR Number</th>
                <th className="p-3.5">Order Ref</th>
                <th className="p-3.5">Requester / Client</th>
                <th className="p-3.5">Warehouse Hub</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Reason</th>
                <th className="p-3.5 text-right">Amount</th>
                <th className="p-3.5 pr-4">Date & Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {paginatedPRs.length > 0 ? (
                paginatedPRs.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 pl-4 font-semibold text-blue-600">{row.prNumber}</td>
                    <td className="p-3.5 font-medium text-slate-900">{row.orderNumber || 'N/A'}</td>
                    <td className="p-3.5">
                      <div className="font-medium text-slate-900">{row.requester}</div>
                      {row.customerEmail && <div className="text-[11px] text-slate-400">{row.customerEmail}</div>}
                    </td>
                    <td className="p-3.5 text-slate-600">{row.warehouseName}</td>
                    <td className="p-3.5">{getStatusBadge(row.status)}</td>
                    <td className="p-3.5">
                      {row.reason ? (
                        <span className="text-slate-700">{row.reason}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="p-3.5 text-right font-semibold text-slate-900">{formatPeso(row.amount)}</td>
                    <td className="p-3.5 pr-4 text-slate-500 whitespace-nowrap">{formatDateTime(row.date)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <FileText className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    No purchase request records match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 bg-slate-50/50">
            <span className="text-xs text-slate-500">
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredPRs.length)} of {filteredPRs.length} records
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
