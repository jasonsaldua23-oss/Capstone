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
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeSeriesMix, describeTrend, toPoints } from '@/lib/chart-interpretation'
import { formatDayKey } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'
import { ReportKpiRow } from './report-kpi'
import { buildReportDateWindow, matchesReportDateWindow, formatReportTableDateTime } from '@/components/portals/admin/sections/report-date-utils'
import { buildDailyChartSeries, formatReportProductNameForExport } from '@/lib/report-metrics'

interface ReplacementRecordsReportProps {
  replacements: any[]
  orders?: any[]
}

export function ReplacementRecordsReport({ replacements, orders = [] }: ReplacementRecordsReportProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [reasonFilter, setReasonFilter] = useState('all')
  const [datePreset, setDatePreset] = useState<'all' | 'today' | '7' | '30' | '90' | '365' | 'custom'>('30')
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

      const _originalProductName = rep.originalProductName || rep.productName || rep.originalOrderItem?.productName || 'Beverage Case'
      const _originalProductSize = rep.originalProductSize || ''
      const originalProduct = _originalProductSize ? `${_originalProductName} ${_originalProductSize}` : _originalProductName
      const replacementProduct = rep.replacementProductName || rep.productName || 'Direct Replacement'

      // Parse structured meta from notes if available
      let meta: any = {}
      try {
        if (typeof rep.notes === 'string' && rep.notes.trim().startsWith('{')) {
          meta = JSON.parse(rep.notes)
        }
      } catch {}

      const reason = String(rep.reason || 'Damaged in transit / Defective seal').trim()
      const description = rep.description || rep.notes || ''
      const rawStatus = String(rep.status || 'REPORTED').toUpperCase()
      const isResolved = ['RESOLVED', 'CLOSED', 'COMPLETED', 'RESOLVED_ON_DELIVERY', 'REPLACED'].includes(rawStatus)
      const status = isResolved ? 'RESOLVED' : rawStatus

      const contextText = `${String(description)} ${String(reason)} ${String(rep.notes || '')}`.toLowerCase()
      const isByBottle = /\bby\s*bottle\b/.test(contextText)
      const isByUnit = /\bby\s*unit\b/.test(contextText) || /\bby\s*case\b/.test(contextText)
      const isByPack = /\bby\s*pack\b/.test(contextText)
      const isByBundle = /\bby\s*bundle\b/.test(contextText)

      // Qty/Unit parsing from description or line
      const qtyPerUnitMatch = contextText.match(/qty\s*\/\s*(?:unit|case|pack|bundle)\s*[:\-]?\s*(\d+)/i)
      const qtyPerUnitFromText = qtyPerUnitMatch ? Number(qtyPerUnitMatch[1]) : NaN

      // Matched Order Item & Pricing
      let matchedItem: any = null
      if (matchedOrder?.items && Array.isArray(matchedOrder.items)) {
        const origName = (_originalProductName || '').toLowerCase().trim()
        matchedItem = matchedOrder.items.find((item: any) => {
          const iName = (item.productName || item.product?.name || item.name || '').toLowerCase().trim()
          return origName && iName && (iName.includes(origName.split(' ')[0]) || origName.includes(iName.split(' ')[0]))
        }) || matchedOrder.items[0]
      }

      const unitPrice = Number(
        matchedItem?.unitPrice ??
        matchedItem?.unit_price ??
        matchedItem?.price ??
        matchedItem?.product?.price ??
        0
      )
      const qtyPerCase = Math.max(
        1,
        Number.isFinite(qtyPerUnitFromText) && qtyPerUnitFromText > 0
          ? qtyPerUnitFromText
          : Number(matchedItem?.product?.quantityPerCase || matchedItem?.product?.quantityPerUnit || matchedItem?.caseCapacity || 24)
      )

      const rawBottleQuantity = Number(
        rep.replacementQuantity ??
        rep.quantity ??
        rep.quantityReplaced ??
        meta.quantityReplaced ??
        meta.quantityToReplace ??
        1
      )

      const unitMatch = contextText.match(/by\s*unit\s*[:\-]?\s*(\d+)/i) || contextText.match(/by\s*case\s*[:\-]?\s*(\d+)/i)
      const directUnits = unitMatch
        ? Number(unitMatch[1])
        : Number(meta.quantityToReplaceCases || meta.quantityReplacedCases || meta.damagedCases || NaN)

      let quantity = rawBottleQuantity
      let unitLabel = 'units'
      let loss = 0

      if (isByBottle) {
        quantity = rawBottleQuantity
        unitLabel = 'bottles'
        const replacedQtyInBillingUnit = rawBottleQuantity / qtyPerCase
        loss = replacedQtyInBillingUnit * unitPrice
      } else if (isByUnit) {
        const caseCount = Number.isFinite(directUnits) && directUnits > 0
          ? directUnits
          : (rawBottleQuantity > 0 ? Math.max(1, Math.round(rawBottleQuantity / qtyPerCase)) : 1)
        quantity = caseCount
        unitLabel = isByPack ? 'packs' : isByBundle ? 'bundles' : 'cases'
        loss = caseCount * unitPrice
      } else {
        // Default detection
        if (Number.isFinite(directUnits) && directUnits > 0) {
          quantity = directUnits
          unitLabel = 'cases'
          loss = directUnits * unitPrice
        } else if (rawBottleQuantity >= qtyPerCase && rawBottleQuantity % qtyPerCase === 0) {
          const caseCount = rawBottleQuantity / qtyPerCase
          quantity = caseCount
          unitLabel = 'cases'
          loss = caseCount * unitPrice
        } else {
          quantity = rawBottleQuantity
          unitLabel = 'bottles'
          loss = (rawBottleQuantity / qtyPerCase) * unitPrice
        }
      }

      // Fix: missing timestamps must not appear as records created today.
      const date = rep.createdAt || ''
      const processedDate = rep.processedAt || rep.pickupCompleted || null

      // Build per-product lines for the table
      const rawLines: any[] =
        (Array.isArray(rep.replacementLines) && rep.replacementLines.length > 0 ? rep.replacementLines : null) ??
        (Array.isArray(rep.replacementItems) && rep.replacementItems.length > 0 ? rep.replacementItems : null) ??
        (Array.isArray(meta.replacementLines) && meta.replacementLines.length > 0 ? meta.replacementLines : null) ??
        (Array.isArray(meta.replacementItems) && meta.replacementItems.length > 0 ? meta.replacementItems : null) ??
        []

      type LineEntry = { productName: string; qty: number; unitLabel: string; reason: string }

      let lines: LineEntry[] = []
      if (rawLines.length > 0) {
        lines = rawLines.map((line: any) => {
          const pName = String(
            line.originalProductName ?? line.productName ?? line.replacementProductName ?? 'Product'
          ).trim()
          const productName = formatReportProductNameForExport({
            ...(line.product || {}),
            ...line,
            name: pName,
            sizeLabel:
              line.originalProductSize ??
              line.productSize ??
              line.replacementProductSize ??
              line.sizeLabel ??
              matchedItem?.sizeLabel ??
              matchedItem?.product?.sizeLabel ??
              matchedItem?.product?.size ??
              _originalProductSize,
          })
          const rawQty = Math.max(Number(line.quantityToReplace ?? line.quantity ?? line.quantityReplaced ?? 0), 0)
          const lineUnit = String(
            line.productUnit ?? line.replacementProductUnit ?? line.originalProductUnit ?? line.unit ?? ''
          ).trim().toLowerCase()

          let lineLabel = 'bottles'
          let lineQty = rawQty
          if (lineUnit.includes('case')) { lineLabel = 'cases' }
          else if (lineUnit.includes('pack')) { lineLabel = 'packs' }
          else if (lineUnit.includes('bundle')) { lineLabel = 'bundles' }
          else if (lineUnit.includes('bottle')) { lineLabel = 'bottles' }

          // If display hint is available prefer it
          if (line.quantityToReplaceDisplay) {
            const m = String(line.quantityToReplaceDisplay).match(/^(\d+(?:\.\d+)?)\s*(\w+)?$/)
            if (m) {
              lineQty = Number(m[1])
              if (m[2]) lineLabel = m[2].toLowerCase()
            }
          }

          const lineReason = String(line.reason || rep.reason || 'N/A').trim()

          return { productName, qty: lineQty, unitLabel: lineLabel, reason: lineReason }
        })
      }

      // Fallback single-line when no structured lines
      if (lines.length === 0) {
        lines = [{
          productName: formatReportProductNameForExport({
            name: _originalProductName,
            sizeLabel:
              _originalProductSize ||
              matchedItem?.sizeLabel ||
              matchedItem?.product?.sizeLabel ||
              matchedItem?.product?.size,
          }),
          qty: quantity,
          unitLabel,
          reason,
        }]
      }

      return {
        id: rep.id,
        repNumber,
        orderRef,
        client,
        clientEmail,
        originalProduct,
        replacementProduct,
        quantity,
        rawBottleQuantity,
        unitLabel,
        unitPrice,
        loss,
        reason,
        description,
        status,
        date,
        processedDate,
        lines,
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
    // Fix: use both calendar boundaries for presets and inclusive custom ranges.
    const dateWindow = buildReportDateWindow(datePreset, dateFrom, dateTo)
    list = list.filter((item) => matchesReportDateWindow(item.date, dateWindow))

    // Status filter
    if (statusFilter !== 'all') {
      list = list.filter((item) => item.status === statusFilter)
    }

    // Reason filter
    if (reasonFilter !== 'all') {
      list = list.filter((item) => item.reason === reasonFilter)
    }

    // Search term (searches Rep #, Order, Client, Product, Reason)
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      list = list.filter(
        (item) =>
          item.repNumber.toLowerCase().includes(q) ||
          item.orderRef.toLowerCase().includes(q) ||
          item.client.toLowerCase().includes(q) ||
          item.originalProduct.toLowerCase().includes(q) ||
          item.replacementProduct.toLowerCase().includes(q) ||
          item.reason.toLowerCase().includes(q)
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
    const pending = filteredReplacements.filter((r) => r.status === 'REPORTED' || r.status === 'PENDING').length
    const totalUnits = filteredReplacements.reduce((sum, r) => sum + (r.rawBottleQuantity || r.quantity), 0)

    return { total, resolved, inProgress, pending, totalUnits }
  }, [filteredReplacements])

  // Trend Chart Data (Chronological daily breakdown with full continuous date range)
  const chartData = useMemo(() => {
    // Fix: build the trend from the filtered dates, including historical custom ranges.
    const map: Record<string, { dateKey: string; date: string; total: number; resolved: number; pending: number }> = {}

    filteredReplacements.forEach((item) => {
      const d = new Date(item.date)
      const key = formatDayKey(d)
      if (!map[key]) {
        map[key] = {
          dateKey: key,
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          total: 0,
          resolved: 0,
          pending: 0,
        }
      }
      map[key].total += 1
      if (item.status === 'RESOLVED' || item.status === 'CLOSED') {
        map[key].resolved += 1
      } else {
        map[key].pending += 1
      }
    })

    return buildDailyChartSeries(map, {
      days: 14,
      fillEmpty: (dateKey) => {
        const [, month, day] = dateKey.split('-')
        return { dateKey, date: `${Number(month)}/${Number(day)}`, total: 0, resolved: 0, pending: 0 }
      },
    })
  }, [filteredReplacements])

  // Reported volume first, then how much of it has actually been closed out.
  const chartInterpretation = useMemo(() => {
    const day = (row: any) => row.date
    const reported = chartData.reduce((sum: number, row: any) => sum + Number(row.total || 0), 0)
    const resolved = chartData.reduce((sum: number, row: any) => sum + Number(row.resolved || 0), 0)
    const resolutionRate = reported > 0 ? ((resolved / reported) * 100).toFixed(1) : '0.0'
    return `${describeTrend(toPoints(chartData, day, (row: any) => row.total), {
      noun: 'replacement reports',
      periodNoun: 'day',
    })} ${resolved.toLocaleString('en-US')} of the ${reported.toLocaleString('en-US')} reported cases are resolved, a ${resolutionRate}% resolution rate.`
  }, [chartData])

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
      case 'COMPLETED':
      case 'RESOLVED_ON_DELIVERY':
      case 'REPLACED':
        return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Resolved / Replaced</Badge>
      case 'IN_PROGRESS':
        return <Badge className="bg-blue-50 text-blue-700 border-blue-200">In Progress</Badge>
      case 'NEEDS_FOLLOW_UP':
        return <Badge className="bg-purple-50 text-purple-700 border-purple-200">Needs Follow-Up</Badge>
      case 'REPORTED':
      case 'PENDING':
        return <Badge className="bg-amber-50 text-amber-700 border-amber-200">Reported</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const exportColumns: ExportColumn[] = [
    { header: 'Replacement ID', key: 'repNumber' },
    { header: 'Order Ref', key: 'orderRef' },
    { header: 'Client', key: 'client' },
    {
      header: 'Original Item',
      key: 'lineProductName',
    },
    {
      header: 'Qty',
      accessor: (r) => `${r.lineQty} ${r.lineUnitLabel}`,
    },
    {
      header: 'Reason',
      key: 'lineReason',
    },
    {
      header: 'Status',
      accessor: (r) =>
        ['RESOLVED', 'CLOSED', 'COMPLETED', 'RESOLVED_ON_DELIVERY', 'REPLACED'].includes(r.status)
          ? 'Resolved / Replaced'
          : r.status === 'IN_PROGRESS'
          ? 'In Progress'
          : r.status === 'NEEDS_FOLLOW_UP'
          ? 'Needs Follow-Up'
          : 'Reported',
    },
    { header: 'Loss (₱)', accessor: (r) => r.loss > 0 ? `₱${r.loss.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—' },
    { header: 'Reported Date', accessor: (r) => formatReportTableDateTime(r.date) },
  ]

  // Each replaced item gets its own exported row so its quantity and reason stay aligned.
  const replacementExportRows = useMemo(() => filteredReplacements.flatMap((replacement) =>
    replacement.lines.map((line: { productName: string; qty: number; unitLabel: string; reason: string }) => ({
      ...replacement,
      lineProductName: line.productName,
      lineQty: line.qty,
      lineUnitLabel: line.unitLabel,
      lineReason: line.reason,
    }))
  ), [filteredReplacements])

  const handleExportCsv = () => {
    exportToCsv(`replacement-records-${new Date().toISOString().slice(0, 10)}.csv`, exportColumns, replacementExportRows)
  }

  const handleExportPdf = () => {
    exportReportPdf(
      `replacement-records-${new Date().toISOString().slice(0, 10)}.pdf`,
      'Replacement Records Report',
      exportColumns,
      replacementExportRows,
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
      replacementExportRows,
      [
        `Total Replacements: ${kpis.total}`,
        `Resolved: ${kpis.resolved} | In-Progress: ${kpis.inProgress} | Pending: ${kpis.pending}`,
        `Total Units Replaced: ${kpis.totalUnits}`,
      ]
    )
  }

  return (
    <div className="report-design-system flex flex-col gap-6">
      {/* Header */}
      <div className="order-[-2] flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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

      {/* What matters on a replacements desk is how much of the queue is closed,
          so the resolved share leads and the open buckets explain the rest. */}
      <ReportKpiRow
        headline={{
          label: 'Resolved / Replaced',
          value: kpis.total > 0 ? `${((kpis.resolved / kpis.total) * 100).toFixed(1)}%` : '0.0%',
          hint: `${kpis.resolved} of ${kpis.total} reported records closed`,
          tone: 'emerald',
        }}
        items={[
          { label: 'Reported', value: kpis.total, tone: 'blue' },
          { label: 'In Investigation', value: kpis.inProgress, hint: 'Being inspected', tone: 'cyan' },
          { label: 'Pending Action', value: kpis.pending, hint: 'Awaiting triage', tone: 'amber' },
          { label: 'Units Replaced', value: kpis.totalUnits, hint: 'Items exchanged', tone: 'indigo' },
        ]}
      />

      {/* Trend Chart */}
      {chartData.length > 0 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Replacement Request & Resolution Trend</CardTitle>
            <CardDescription className="text-xs text-slate-500">Daily breakdown of total reported vs resolved replacements over time</CardDescription>
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
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', color: '#64748b', paddingTop: '4px' }} />
                  <Area type="monotone" dataKey="total" name="Total Reported" stroke="#6366f1" strokeWidth={2} fill="#e0e7ff" fillOpacity={0.35} />
                  <Line type="monotone" dataKey="resolved" name="Resolved / Replaced" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3.5, fill: '#10b981' }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="pending" name="Open / In-Progress" stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="4 4" dot={{ r: 3.5, fill: '#f59e0b' }} activeDot={{ r: 6 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <ChartInterpretation text={chartInterpretation} />
          </CardContent>
        </Card>
      )}

      {/* Filter Bar */}
      <Card className="order-[-1] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
              max={dateTo || undefined} value={dateFrom}
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
              onClick={(event) => event.currentTarget.showPicker?.()}
              min={dateFrom || undefined} value={dateTo}
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
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          <table className="stack-table w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3.5 pl-4">Rep ID</th>
                <th className="p-3.5">Order Ref</th>
                <th className="p-3.5">Client / Customer</th>
                <th className="p-3.5">Original Item</th>
                <th className="p-3.5">Qty</th>
                <th className="p-3.5">Reason & Description</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Loss (₱)</th>
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
                      <div className="space-y-1">
                        {row.lines.map((line: { productName: string; qty: number; unitLabel: string }, i: number) => (
                          <div key={i} className="font-medium text-slate-800 leading-tight">{line.productName}</div>
                        ))}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <div className="space-y-1">
                        {row.lines.map((line: { productName: string; qty: number; unitLabel: string }, i: number) => (
                          <div key={i} className="whitespace-nowrap">
                            <span className="font-bold text-slate-900">{line.qty}</span>
                            <span className="ml-1 text-[11px] text-slate-400 font-normal">{line.unitLabel}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="p-3.5 max-w-xs">
                      <div className="space-y-1">
                        {row.lines.map((line: { productName: string; qty: number; unitLabel: string; reason: string }, i: number) => (
                          <div key={i} className="font-medium text-slate-800 leading-tight">{line.reason}</div>
                        ))}
                      </div>
                      {row.description && <div className="mt-1 text-[11px] text-slate-400 line-clamp-1">{row.description}</div>}
                    </td>
                    <td className="p-3.5">{getStatusBadge(row.status)}</td>
                    <td className="p-3.5">
                      {row.loss > 0 ? (
                        <span className="font-semibold text-rose-600">₱{row.loss.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="p-3.5 pr-4 text-slate-500 whitespace-nowrap">{formatReportTableDateTime(row.date)}</td>
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
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-slate-100 px-4 py-3 bg-slate-50/50">
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
