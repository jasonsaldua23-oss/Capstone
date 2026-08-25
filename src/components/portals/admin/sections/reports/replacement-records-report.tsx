'use client'

import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  RotateCcw,
  Search,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Package,
  User,
  Calendar,
  Building2,
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
import { formatDateTime, formatDayKey, withinRange } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'

interface ReplacementRecordsReportProps {
  replacements: any[]
  orders?: any[]
}

export function ReplacementRecordsReport({ replacements, orders = [] }: ReplacementRecordsReportProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [reasonFilter, setReasonFilter] = useState('all')
  const [datePreset, setDatePreset] = useState<'all' | '7' | '30' | '90' | '365' | 'custom'>('30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 15

  // Map orders for cross-referencing
  const ordersMap = useMemo(() => {
    const map = new Map<string, any>()
    orders.forEach((o) => {
      if (o.id) map.set(o.id, o)
      if (o.orderNumber) map.set(o.orderNumber, o)
    })
    return map
  }, [orders])

  // Normalized replacements rows
  const rawReplacementsList = useMemo(() => {
    return replacements.map((rep) => {
      const repNumber = rep.replacementNumber || `REP-${rep.id?.slice(-6)}`
      const orderRef = rep.order?.orderNumber || rep.orderNumber || rep.order?.id || rep.orderId || 'Direct / Counter'
      const matchedOrder = ordersMap.get(rep.order?.id || rep.orderId || rep.orderNumber)

      const client = rep.customer?.name || matchedOrder?.customer?.name || matchedOrder?.shippingName || 'Customer'
      const clientEmail = rep.customer?.email || matchedOrder?.customer?.email || ''

      const originalProduct = rep.originalProductName || rep.productName || rep.originalOrderItem?.productName || 'Beverage Case'
      const replacementProduct = rep.replacementProductName || rep.productName || 'Direct Replacement'
      const quantity = Number(rep.replacementQuantity || rep.quantity || rep.quantityReplaced || 1)

      const reason = String(rep.reason || 'Damaged in transit / Defective seal').trim()
      const description = rep.description || rep.notes || ''
      const status = String(rep.status || 'REPORTED').toUpperCase()
      const processedBy = rep.processedBy || (status === 'RESOLVED' || status === 'CLOSED' ? 'Warehouse Ops' : null)

      const date = rep.createdAt || new Date().toISOString()
      const processedDate = rep.processedAt || rep.pickupCompleted || null

      return {
        id: rep.id,
        repNumber,
        orderRef,
        client,
        clientEmail,
        originalProduct,
        replacementProduct,
        quantity,
        reason,
        description,
        status,
        processedBy,
        date,
        processedDate,
      }
    })
  }, [replacements, ordersMap])

  // Extract distinct reasons for filter dropdown
  const distinctReasons = useMemo(() => {
    const set = new Set<string>()
    rawReplacementsList.forEach((r) => {
      if (r.reason) set.add(r.reason)
    })
    return Array.from(set)
  }, [rawReplacementsList])

  // Filter and Sort
  const filteredReplacements = useMemo(() => {
    let list = rawReplacementsList

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

    // Reason filter
    if (reasonFilter !== 'all') {
      list = list.filter((item) => item.reason === reasonFilter)
    }

    // Search term (searches Rep #, Order, Client, Product, Reason, Processed By)
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      list = list.filter(
        (item) =>
          item.repNumber.toLowerCase().includes(q) ||
          item.orderRef.toLowerCase().includes(q) ||
          item.client.toLowerCase().includes(q) ||
          item.originalProduct.toLowerCase().includes(q) ||
          item.replacementProduct.toLowerCase().includes(q) ||
          item.reason.toLowerCase().includes(q) ||
          (item.processedBy && item.processedBy.toLowerCase().includes(q))
      )
    }

    // Sorting
    list = [...list].sort((a, b) => {
      const timeA = new Date(a.date).getTime()
      const timeB = new Date(b.date).getTime()
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB
    })

    return list
  }, [rawReplacementsList, datePreset, dateFrom, dateTo, statusFilter, reasonFilter, searchTerm, sortOrder])

  // KPIs
  const kpis = useMemo(() => {
    const total = filteredReplacements.length
    const resolved = filteredReplacements.filter((r) => r.status === 'RESOLVED' || r.status === 'CLOSED').length
    const inProgress = filteredReplacements.filter((r) => r.status === 'IN_PROGRESS' || r.status === 'NEEDS_FOLLOW_UP').length
    const pending = filteredReplacements.filter((r) => r.status === 'REPORTED').length
    const totalUnits = filteredReplacements.reduce((sum, r) => sum + r.quantity, 0)

    return { total, resolved, inProgress, pending, totalUnits }
  }, [filteredReplacements])

  // Trend Chart Data
  const chartData = useMemo(() => {
    const map: Record<string, { date: string; resolved: number; pending: number }> = {}
    filteredReplacements.forEach((item) => {
      const d = new Date(item.date)
      const key = formatDayKey(d)
      if (!map[key]) {
        map[key] = {
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          resolved: 0,
          pending: 0,
        }
      }
      if (item.status === 'RESOLVED' || item.status === 'CLOSED') {
        map[key].resolved += 1
      } else {
        map[key].pending += 1
      }
    })

    return Object.values(map).slice(-14)
  }, [filteredReplacements])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredReplacements.length / pageSize))
  const paginatedReplacements = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredReplacements.slice(start, start + pageSize)
  }, [filteredReplacements, currentPage])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RESOLVED':
      case 'CLOSED':
        return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Resolved</Badge>
      case 'IN_PROGRESS':
        return <Badge className="bg-blue-50 text-blue-700 border-blue-200">In Progress</Badge>
      case 'NEEDS_FOLLOW_UP':
        return <Badge className="bg-purple-50 text-purple-700 border-purple-200">Needs Follow-Up</Badge>
      case 'REPORTED':
        return <Badge className="bg-amber-50 text-amber-700 border-amber-200">Reported</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const exportColumns: ExportColumn[] = [
    { header: 'Replacement ID', key: 'repNumber' },
    { header: 'Order Ref', key: 'orderRef' },
    { header: 'Client', key: 'client' },
    { header: 'Original Product', key: 'originalProduct' },
    { header: 'Qty', key: 'quantity' },
    { header: 'Reason', key: 'reason' },
    { header: 'Status', key: 'status' },
    { header: 'Processed By', accessor: (r) => r.processedBy || 'Unassigned' },
    { header: 'Reported Date', accessor: (r) => formatDateTime(r.date) },
  ]

  const handleExportCsv = () => {
    exportToCsv(`replacement-records-${new Date().toISOString().slice(0, 10)}.csv`, exportColumns, filteredReplacements)
  }

  const handleExportPdf = () => {
    exportReportPdf(
      `replacement-records-${new Date().toISOString().slice(0, 10)}.pdf`,
      'Replacement Records Report',
      exportColumns,
      filteredReplacements,
      [
        `Total Replacements: ${kpis.total}`,
        `Resolved: ${kpis.resolved} | In-Progress: ${kpis.inProgress} | Pending: ${kpis.pending}`,
        `Total Units Replaced: ${kpis.totalUnits}`,
      ]
    )
  }

  const handlePrint = () => {
    printReportTable(
      'Replacement Records Report',
      exportColumns,
      filteredReplacements,
      [
        `Total Replacements: ${kpis.total}`,
        `Resolved: ${kpis.resolved} | In-Progress: ${kpis.inProgress} | Pending: ${kpis.pending}`,
        `Total Units Replaced: ${kpis.totalUnits}`,
      ]
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Replacement Records Report</h2>
          <p className="text-sm text-slate-500">Dedicated log of item damages, replacements, return processing, and approval audit trails.</p>
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="rounded-2xl border border-blue-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-blue-600">Total Replacements</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{kpis.total}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">100% of reported records</CardContent>
        </Card>

        <Card className="rounded-2xl border border-emerald-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-emerald-600">Resolved / Replaced</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-700">{kpis.resolved}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">
            {kpis.total > 0 ? ((kpis.resolved / kpis.total) * 100).toFixed(1) : 0}% resolution rate
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-blue-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-blue-600">In Investigation</CardDescription>
            <CardTitle className="text-2xl font-bold text-blue-700">{kpis.inProgress}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Being inspected or routed</CardContent>
        </Card>

        <Card className="rounded-2xl border border-amber-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-amber-600">Pending Action</CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-700">{kpis.pending}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Awaiting customer service triage</CardContent>
        </Card>

        <Card className="rounded-2xl border border-indigo-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-indigo-600">Total Units Replaced</CardDescription>
            <CardTitle className="text-2xl font-bold text-indigo-700">{kpis.totalUnits}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Cumulative items exchanged</CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      {chartData.length > 0 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Replacement Request & Resolution Trend</CardTitle>
            <CardDescription className="text-xs text-slate-500">Daily breakdown of reported vs resolved replacements</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', borderColor: '#e2e8f0', fontSize: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="resolved" name="Resolved" fill="#10b981" radius={[4, 4, 0, 0]} stackId="a" />
                  <Bar dataKey="pending" name="Open / In-Progress" fill="#f59e0b" radius={[4, 4, 0, 0]} stackId="a" />
                </BarChart>
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
              placeholder="Search Rep # / Client / Item..."
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
              aria-label="Filter by replacement status"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Replacement Statuses</option>
              <option value="RESOLVED">Resolved / Replaced</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="NEEDS_FOLLOW_UP">Needs Follow-Up</option>
              <option value="REPORTED">Reported / Pending</option>
            </select>
          </div>

          {/* Reason Filter */}
          <div>
            <select
              value={reasonFilter}
              onChange={(e) => {
                setReasonFilter(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter by replacement reason"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Reasons</option>
              {distinctReasons.map((r) => (
                <option key={r} value={r}>
                  {r.length > 30 ? `${r.slice(0, 30)}...` : r}
                </option>
              ))}
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
              aria-label="Filter by replacement date preset"
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
              aria-label="Filter replacement from date"
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
              aria-label="Filter replacement to date"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            />
          </div>
        )}
      </Card>

      {/* Replacement Records Table */}
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3.5 pl-4">Rep ID</th>
                <th className="p-3.5">Order Ref</th>
                <th className="p-3.5">Client / Customer</th>
                <th className="p-3.5">Original Item</th>
                <th className="p-3.5 text-center">Qty</th>
                <th className="p-3.5">Reason & Description</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Processed By</th>
                <th className="p-3.5 pr-4">Reported Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {paginatedReplacements.length > 0 ? (
                paginatedReplacements.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 pl-4 font-semibold text-rose-600">{row.repNumber}</td>
                    <td className="p-3.5 font-medium text-slate-900">{row.orderRef}</td>
                    <td className="p-3.5">
                      <div className="font-medium text-slate-900">{row.client}</div>
                      {row.clientEmail && <div className="text-[11px] text-slate-400">{row.clientEmail}</div>}
                    </td>
                    <td className="p-3.5">
                      <div className="font-medium text-slate-800">{row.originalProduct}</div>
                    </td>
                    <td className="p-3.5 text-center font-bold text-slate-900">{row.quantity}</td>
                    <td className="p-3.5 max-w-xs">
                      <div className="font-medium text-slate-800">{row.reason}</div>
                      {row.description && <div className="text-[11px] text-slate-400 line-clamp-1">{row.description}</div>}
                    </td>
                    <td className="p-3.5">{getStatusBadge(row.status)}</td>
                    <td className="p-3.5 text-slate-600">
                      {row.processedBy ? (
                        <span className="font-medium text-emerald-700">✓ {row.processedBy}</span>
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="p-3.5 pr-4 text-slate-500 whitespace-nowrap">{formatDateTime(row.date)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <RotateCcw className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    No replacement records match the selected filters.
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
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredReplacements.length)} of {filteredReplacements.length} records
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
