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
  Building2,
  Calendar,
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
import { formatPeso, formatDateTime, formatDayKey, withinRange } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'

interface PurchaseOrdersReportProps {
  orders: any[]
  warehouses?: any[]
}

export function PurchaseOrdersReport({ orders, warehouses = [] }: PurchaseOrdersReportProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [warehouseFilter, setWarehouseFilter] = useState('all')
  const [datePreset, setDatePreset] = useState<'all' | '7' | '30' | '90' | '365' | 'custom'>('30')
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

        const date = o.createdAt || new Date().toISOString()
        const deliveredDate = o.timeline?.deliveredAt || (stage === 'DELIVERED' ? o.updatedAt : null)
        const amount = Number(o.totalAmount || o.subtotal || 0)
        const warehouseId = o.warehouseId || o.warehouse_id || o.warehouse?.id || ''
        const warehouseName = o.warehouseName || o.warehouse?.name || 'Central Distribution'
        const itemsCount = Array.isArray(o.items) ? o.items.length : 0

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
          warehouseId,
          warehouseName,
          itemsCount,
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
        const days = Number(datePreset)
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - days)
        cutoff.setHours(0, 0, 0, 0)
        list = list.filter((item) => withinRange(item.date, cutoff))
      }
    }

    // Stage filter
    if (stageFilter !== 'all') {
      list = list.filter((item) => item.stage === stageFilter)
    }

    // Warehouse filter
    if (warehouseFilter !== 'all') {
      list = list.filter((item) => item.warehouseId === warehouseFilter)
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
  }, [rawPOList, datePreset, dateFrom, dateTo, stageFilter, warehouseFilter, searchTerm, sortOrder])

  // KPIs
  const kpis = useMemo(() => {
    const total = filteredPOs.length
    const delivered = filteredPOs.filter((p) => p.stage === 'DELIVERED' || p.stage === 'COMPLETED').length
    const inFulfillment = filteredPOs.filter((p) =>
      ['PROCESSING', 'READY_FOR_DELIVERY', 'FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'APPROVED'].includes(p.stage)
    ).length
    const cancelled = filteredPOs.filter((p) => p.stage === 'CANCELLED').length
    const totalValue = filteredPOs.reduce((sum, p) => sum + (p.amount || 0), 0)

    return { total, delivered, inFulfillment, cancelled, totalValue }
  }, [filteredPOs])

  // Trend Chart Data (by Stage Breakdown)
  const chartData = useMemo(() => {
    const map: Record<string, { date: string; delivered: number; inFlight: number; cancelled: number }> = {}
    filteredPOs.forEach((item) => {
      const d = new Date(item.date)
      const key = formatDayKey(d)
      if (!map[key]) {
        map[key] = {
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          delivered: 0,
          inFlight: 0,
          cancelled: 0,
        }
      }
      if (item.stage === 'DELIVERED' || item.stage === 'COMPLETED') {
        map[key].delivered += 1
      } else if (item.stage === 'CANCELLED') {
        map[key].cancelled += 1
      } else {
        map[key].inFlight += 1
      }
    })

    return Object.values(map).slice(-14)
  }, [filteredPOs])

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
      case 'READY_FOR_DELIVERY':
      case 'FOR_DELIVERY':
        return <Badge className="bg-blue-50 text-blue-700 border-blue-200">In Fulfillment</Badge>
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
    { header: 'Warehouse Hub', key: 'warehouseName' },
    { header: 'PO Stage', key: 'stage' },
    { header: 'PO Total (PHP)', accessor: (r) => Number(r.amount || 0).toFixed(2) },
    { header: 'Created Date', accessor: (r) => formatDateTime(r.date) },
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
        `Delivered: ${kpis.delivered} | In Fulfillment: ${kpis.inFulfillment} | Cancelled: ${kpis.cancelled}`,
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
        `Delivered: ${kpis.delivered} | In Fulfillment: ${kpis.inFulfillment} | Cancelled: ${kpis.cancelled}`,
        `Total PO Value: ${formatPeso(kpis.totalValue)}`,
      ]
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Purchase Orders Report</h2>
          <p className="text-sm text-slate-500">Comprehensive overview of issued purchase orders, execution stages, and fulfillment status.</p>
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
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-blue-600">Total Purchase Orders</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{kpis.total}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">100% of filtered POs</CardContent>
        </Card>

        <Card className="rounded-2xl border border-emerald-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-emerald-600">Delivered / Fulfilled</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-700">{kpis.delivered}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">
            {kpis.total > 0 ? ((kpis.delivered / kpis.total) * 100).toFixed(1) : 0}% completion rate
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-cyan-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-cyan-600">Active in Fulfillment</CardDescription>
            <CardTitle className="text-2xl font-bold text-cyan-700">{kpis.inFulfillment}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Preparing or in dispatch</CardContent>
        </Card>

        <Card className="rounded-2xl border border-rose-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-rose-600">Cancelled Orders</CardDescription>
            <CardTitle className="text-2xl font-bold text-rose-700">{kpis.cancelled}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Cancelled before delivery</CardContent>
        </Card>

        <Card className="rounded-2xl border border-indigo-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-indigo-600">Total Purchase Value</CardDescription>
            <CardTitle className="text-2xl font-bold text-indigo-700">{formatPeso(kpis.totalValue)}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Gross order value</CardContent>
        </Card>
      </div>

      {/* Trend Chart */}
      {chartData.length > 0 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Purchase Order Fulfillment Volume</CardTitle>
            <CardDescription className="text-xs text-slate-500">Daily creation and fulfillment status</CardDescription>
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
                  <Bar dataKey="delivered" name="Delivered" fill="#10b981" radius={[4, 4, 0, 0]} stackId="a" />
                  <Bar dataKey="inFlight" name="In Fulfillment" fill="#3b82f6" radius={[4, 4, 0, 0]} stackId="a" />
                  <Bar dataKey="cancelled" name="Cancelled" fill="#f43f5e" radius={[4, 4, 0, 0]} stackId="a" />
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
              <option value="PROCESSING">Processing / Preparing</option>
              <option value="READY_FOR_DELIVERY">Ready for Delivery</option>
              <option value="OUT_FOR_DELIVERY">Out for Delivery</option>
              <option value="DELIVERED">Delivered</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* Warehouse Filter */}
          <div>
            <select
              value={warehouseFilter}
              onChange={(e) => {
                setWarehouseFilter(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter by fulfillment warehouse"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Fulfillment Hubs</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name || w.code}
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
              aria-label="Filter by purchase order date preset"
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
              aria-label="Filter PO from date"
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
              aria-label="Filter PO to date"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            />
          </div>
        )}
      </Card>

      {/* Detailed PO Table */}
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3.5 pl-4">PO Number</th>
                <th className="p-3.5">PR Ref</th>
                <th className="p-3.5">Order Ref</th>
                <th className="p-3.5">Client / Customer</th>
                <th className="p-3.5">Hub / Warehouse</th>
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
                    <td className="p-3.5 text-slate-600">{row.warehouseName}</td>
                    <td className="p-3.5">{getStageBadge(row.stage)}</td>
                    <td className="p-3.5 text-right font-semibold text-slate-900">{formatPeso(row.amount)}</td>
                    <td className="p-3.5 pr-4 text-slate-500 whitespace-nowrap">{formatDateTime(row.date)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
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
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 bg-slate-50/50">
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
