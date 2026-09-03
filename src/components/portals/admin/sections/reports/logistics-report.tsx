'use client'

import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Truck,
  Search,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  MapPin,
  User,
  ShieldCheck,
  Calendar,
  AlertCircle,
  TrendingUp,
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
import { formatDateTime, formatDayKey, withinRange, normalizeTripStatus, toArray } from '../shared'
import { exportToCsv, exportReportPdf, printReportTable, ExportColumn } from './export-utils'

interface LogisticsReportProps {
  trips: any[]
  drivers?: any[]
  warehouses?: any[]
}

function getDropPointBarangay(address: unknown, city: unknown) {
  const addressParts = String(address || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  const explicitBarangay = addressParts.find((part) => /\b(barangay|brgy\.?|poblacion)\b/i.test(part))
  if (explicitBarangay) {
    return explicitBarangay.replace(/\bbrgy\.?/i, 'Barangay').replace(/\s+/g, ' ').trim()
  }

  // Customer addresses are stored in locality order, with barangay immediately before the city.
  const normalizeLocality = (value: unknown) => String(value || '').toLowerCase().replace(/\bcity\b/g, '').replace(/[^a-z0-9]/g, '')
  const normalizedCity = normalizeLocality(city)
  const cityIndex = addressParts.findIndex((part) => normalizedCity && normalizeLocality(part) === normalizedCity)
  if (cityIndex > 0) {
    const barangayCandidate = addressParts[cityIndex - 1]
    if (normalizeLocality(barangayCandidate) !== normalizedCity) return barangayCandidate
  }

  return 'Barangay not specified'
}

export function LogisticsReport({ trips, drivers = [], warehouses = [] }: LogisticsReportProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [driverFilter, setDriverFilter] = useState('all')
  const [datePreset, setDatePreset] = useState<'all' | '7' | '30' | '90' | '365' | 'custom'>('30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 15

  // Map trips to normalized logistics delivery rows
  const rawLogisticsList = useMemo(() => {
    return trips.map((trip) => {
      const tripNumber = trip.tripNumber || `TRIP-${trip.id?.slice(-6)}`
      const driverName = trip.driver?.user?.name || trip.driver?.name || 'Unassigned Driver'
      const driverId = String(trip.driver?.id || trip.driverId || '')
      const vehiclePlate = trip.vehicle?.licensePlate || trip.vehicle?.plate || 'Unassigned'
      const vehicleModel = trip.vehicle?.model ? `${trip.vehicle?.brand || ''} ${trip.vehicle?.model}`.trim() : ''
      const status = normalizeTripStatus(trip.status)

      const dropPoints = toArray<any>(trip.dropPoints)
      const totalDrops = Number(trip.totalDropPoints || dropPoints.length)
      const completedDrops = Number(trip.completedDropPoints || dropPoints.filter((dp) => dp.status === 'COMPLETED').length)
      const completionRate = totalDrops > 0 ? Math.round((completedDrops / totalDrops) * 100) : 0

      // Show delivery barangays instead of repeating the broader destination city.
      const destinationsList = dropPoints.map((dp) => getDropPointBarangay(dp.address, dp.city))
      const destinationSummary = destinationsList.length > 0 ? destinationsList.slice(0, 2).join(', ') + (destinationsList.length > 2 ? ` +${destinationsList.length - 2} more` : '') : 'Multiple Drop Points'

      const date = trip.createdAt || trip.plannedStartAt || new Date().toISOString()
      const departureTime = trip.actualStartAt || trip.plannedStartAt
      const completionTime = trip.actualEndAt

      return {
        id: trip.id,
        tripNumber,
        driverName,
        driverId,
        vehiclePlate,
        vehicleModel,
        status,
        totalDrops,
        completedDrops,
        completionRate,
        destinationSummary,
        date,
        departureTime,
        completionTime,
      }
    })
  }, [trips])

  // Filter and Sort
  const filteredLogistics = useMemo(() => {
    let list = rawLogisticsList

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

    // Driver filter
    if (driverFilter !== 'all') {
      list = list.filter((item) => item.driverId === driverFilter)
    }

    // Search term
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim()
      list = list.filter(
        (item) =>
          item.tripNumber.toLowerCase().includes(q) ||
          item.driverName.toLowerCase().includes(q) ||
          item.vehiclePlate.toLowerCase().includes(q) ||
          item.destinationSummary.toLowerCase().includes(q)
      )
    }

    // Sorting
    list = [...list].sort((a, b) => {
      const timeA = new Date(a.date).getTime()
      const timeB = new Date(b.date).getTime()
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB
    })

    return list
  }, [rawLogisticsList, datePreset, dateFrom, dateTo, statusFilter, driverFilter, searchTerm, sortOrder])

  // KPIs
  const kpis = useMemo(() => {
    const totalTrips = filteredLogistics.length
    const completedTrips = filteredLogistics.filter((t) => t.status === 'COMPLETED').length
    const inProgressTrips = filteredLogistics.filter((t) => t.status === 'IN_PROGRESS' || t.status === 'IN_TRANSIT').length
    const plannedTrips = filteredLogistics.filter((t) => t.status === 'PLANNED').length
    const totalDrops = filteredLogistics.reduce((sum, t) => sum + t.totalDrops, 0)
    const completedDrops = filteredLogistics.reduce((sum, t) => sum + t.completedDrops, 0)
    const overallDropRate = totalDrops > 0 ? ((completedDrops / totalDrops) * 100).toFixed(1) : '0.0'

    return { totalTrips, completedTrips, inProgressTrips, plannedTrips, totalDrops, completedDrops, overallDropRate }
  }, [filteredLogistics])

  // Trend Chart Data
  const chartData = useMemo(() => {
    const map: Record<string, { date: string; completed: number; inProgress: number; planned: number }> = {}
    filteredLogistics.forEach((item) => {
      const d = new Date(item.date)
      const key = formatDayKey(d)
      if (!map[key]) {
        map[key] = {
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          completed: 0,
          inProgress: 0,
          planned: 0,
        }
      }
      if (item.status === 'COMPLETED') map[key].completed += 1
      else if (item.status === 'IN_PROGRESS' || item.status === 'IN_TRANSIT') map[key].inProgress += 1
      else map[key].planned += 1
    })

    return Object.values(map).slice(-14)
  }, [filteredLogistics])

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredLogistics.length / pageSize))
  const paginatedLogistics = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredLogistics.slice(start, start + pageSize)
  }, [filteredLogistics, currentPage])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Completed</Badge>
      case 'IN_PROGRESS':
      case 'IN_TRANSIT':
        return <Badge className="bg-purple-50 text-purple-700 border-purple-200">In Transit</Badge>
      case 'PLANNED':
        return <Badge className="bg-blue-50 text-blue-700 border-blue-200">Planned</Badge>
      case 'CANCELLED':
        return <Badge className="bg-rose-50 text-rose-700 border-rose-200">Cancelled</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const exportColumns: ExportColumn[] = [
    { header: 'Trip Number', key: 'tripNumber' },
    { header: 'Driver', key: 'driverName' },
    { header: 'Vehicle Plate', key: 'vehiclePlate' },
    { header: 'Barangays / Stops', key: 'destinationSummary' },
    {
      header: 'Fulfillment',
      accessor: (r) => `${r.completedDrops}/${r.totalDrops} drops (${r.completionRate}%)`,
    },
    { header: 'Status', key: 'status' },
    { header: 'Departure', accessor: (r) => (r.departureTime ? formatDateTime(r.departureTime) : 'N/A') },
    { header: 'Completion', accessor: (r) => (r.completionTime ? formatDateTime(r.completionTime) : 'In Progress') },
    { header: 'Trip Date', accessor: (r) => formatDateTime(r.date) },
  ]

  const handleExportCsv = () => {
    exportToCsv(`logistics-records-${new Date().toISOString().slice(0, 10)}.csv`, exportColumns, filteredLogistics)
  }

  const handleExportPdf = () => {
    exportReportPdf(
      `logistics-records-${new Date().toISOString().slice(0, 10)}.pdf`,
      'Logistics & Delivery Records',
      exportColumns,
      filteredLogistics,
      [
        `Total Trips: ${kpis.totalTrips}`,
        `Completed: ${kpis.completedTrips} | In Transit: ${kpis.inProgressTrips} | Planned: ${kpis.plannedTrips}`,
        `Drop Point Success: ${kpis.completedDrops} of ${kpis.totalDrops} (${kpis.overallDropRate}%)`,
      ]
    )
  }

  const handlePrint = () => {
    printReportTable(
      'Logistics & Delivery Records',
      exportColumns,
      filteredLogistics,
      [
        `Total Trips: ${kpis.totalTrips}`,
        `Completed: ${kpis.completedTrips} | In Transit: ${kpis.inProgressTrips} | Planned: ${kpis.plannedTrips}`,
        `Drop Point Success: ${kpis.completedDrops} of ${kpis.totalDrops} (${kpis.overallDropRate}%)`,
      ]
    )
  }

  return (
    <div className="report-design-system space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Logistics & Delivery Records</h2>
          <p className="text-sm text-slate-500">Fleet dispatch tracking, assigned vehicles, drivers, drop point success, and route milestones.</p>
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
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-blue-600">Total Trips Dispatched</CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">{kpis.totalTrips}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">100% of filtered routes</CardContent>
        </Card>

        <Card className="rounded-2xl border border-emerald-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-emerald-600">Completed Trips</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-700">{kpis.completedTrips}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">
            {kpis.totalTrips > 0 ? ((kpis.completedTrips / kpis.totalTrips) * 100).toFixed(1) : 0}% success rate
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-purple-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-purple-600">Active In-Transit</CardDescription>
            <CardTitle className="text-2xl font-bold text-purple-700">{kpis.inProgressTrips}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Currently on the road</CardContent>
        </Card>

        <Card className="rounded-2xl border border-cyan-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-cyan-600">Planned Dispatch</CardDescription>
            <CardTitle className="text-2xl font-bold text-cyan-700">{kpis.plannedTrips}</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">Scheduled for route</CardContent>
        </Card>

        <Card className="rounded-2xl border border-indigo-100 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide text-indigo-600">Drop Point Fulfillment</CardDescription>
            <CardTitle className="text-2xl font-bold text-indigo-700">{kpis.overallDropRate}%</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-slate-500">
            {kpis.completedDrops} of {kpis.totalDrops} total stops
          </CardContent>
        </Card>
      </div>

      {/* Daily Trips Trend */}
      {chartData.length > 0 && (
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Dispatch & Delivery Volume</CardTitle>
            <CardDescription className="text-xs text-slate-500">Daily logistics trip completion status</CardDescription>
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
                  <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[4, 4, 0, 0]} stackId="a" />
                  <Bar dataKey="inProgress" name="In Transit" fill="#a855f7" radius={[4, 4, 0, 0]} stackId="a" />
                  <Bar dataKey="planned" name="Planned" fill="#3b82f6" radius={[4, 4, 0, 0]} stackId="a" />
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
              placeholder="Search Trip # / Driver / Vehicle..."
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
              aria-label="Filter by delivery status"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Delivery Statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="IN_PROGRESS">In Progress / In Transit</option>
              <option value="PLANNED">Planned</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* Driver Filter */}
          <div>
            <select
              value={driverFilter}
              onChange={(e) => {
                setDriverFilter(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter by assigned driver"
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Assigned Drivers</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.user?.name || d.name || d.email}
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
              aria-label="Filter by logistics trip date preset"
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
              onClick={(event) => event.currentTarget.showPicker?.()}
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                setCurrentPage(1)
              }}
              aria-label="Filter logistics from date"
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
              aria-label="Filter logistics to date"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
            />
          </div>
        )}
      </Card>

      {/* Logistics Records Table */}
      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3.5 pl-4">Trip Number</th>
                <th className="p-3.5">Assigned Driver</th>
                <th className="p-3.5">Vehicle</th>
                <th className="p-3.5">Barangays / Stops</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Departure Time</th>
                <th className="p-3.5">Completion Time</th>
                <th className="p-3.5 pr-4">Trip Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {paginatedLogistics.length > 0 ? (
                paginatedLogistics.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 pl-4 font-semibold text-purple-700">{row.tripNumber}</td>
                    <td className="p-3.5">
                      <div className="font-medium text-slate-900">{row.driverName}</div>
                    </td>
                    <td className="p-3.5">
                      <div className="font-semibold text-slate-800">{row.vehiclePlate}</div>
                      {row.vehicleModel && <div className="text-[11px] text-slate-400">{row.vehicleModel}</div>}
                    </td>
                    <td className="p-3.5">
                      <div className="font-medium text-slate-900">{row.destinationSummary}</div>
                      <div className="text-[11px] text-slate-400">
                        {row.completedDrops} / {row.totalDrops} stops ({row.completionRate}%)
                      </div>
                    </td>
                    <td className="p-3.5">{getStatusBadge(row.status)}</td>
                    <td className="p-3.5 text-slate-600 whitespace-nowrap">{row.departureTime ? formatDateTime(row.departureTime) : 'Not departed'}</td>
                    <td className="p-3.5 text-slate-600 whitespace-nowrap">{row.completionTime ? formatDateTime(row.completionTime) : 'In progress'}</td>
                    <td className="p-3.5 pr-4 text-slate-500 whitespace-nowrap">{formatDateTime(row.date)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Truck className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    No logistics delivery records match the selected filters.
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
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredLogistics.length)} of {filteredLogistics.length} records
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
