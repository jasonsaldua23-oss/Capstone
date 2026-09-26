'use client'

import React, { useEffect, useMemo, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, CheckCircle, MapPin, TrendingUp, UserCheck, MessageSquare, AlertTriangle, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, Database, FileText, Users, Star, Download, Pencil, Trash2 } from 'lucide-react'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, LineChart, Line, Tooltip, PieChart, Pie, Cell, Label, BarChart, Bar, ResponsiveContainer, Legend } from 'recharts'
import { resolveClientImageUrl } from '@/lib/client-image'
import {
  getCollection,
  getDefaultRouteDate,
  normalizeTripStatus,
  formatPeso,
  formatDayKey,
  toIsoDateTime,
  formatDateTime,
  formatDayLabel,
  withinRange,
  getWarehouseIdFromRow,
  formatRoleLabel,
  fetchAllPaginatedCollection,
  safeFetchJson,
} from './shared'
import { CompactDiscountLine } from '@/components/shared/compact-discount-line'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function CustomersView({ globalSearchQuery = '' }: { globalSearchQuery?: string } = {}) {
  const [customers, setCustomers] = useState<any[]>([])
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [ratingFilter, setRatingFilter] = useState('all')
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false)
  const [isSavingDiscount, setIsSavingDiscount] = useState(false)
  const [discountTarget, setDiscountTarget] = useState<any | null>(null)
  const [discountOption, setDiscountOption] = useState('NO_DISCOUNT')
  const [discountStatus, setDiscountStatus] = useState('ACTIVE')
  const [discountPercent, setDiscountPercent] = useState('')

  useEffect(() => {
    setSearch(String(globalSearchQuery || ''))
  }, [globalSearchQuery])

  const customerRefreshRef = useRef(false)
  const fetchCustomers = async (showLoading = true) => {
    if (customerRefreshRef.current) return
    customerRefreshRef.current = true
    if (showLoading) setIsLoading(true)
    try {
      // Fix: the directory supplies complete delivery/rating aggregates; fetching
      // all order details here made a short client list wait for the slowest page.
      const result = await fetchAllPaginatedCollection<any>(
        '/api/customers',
        'customers',
        { cache: 'no-store' },
        { retries: 2, timeoutMs: 15000, pageSize: 500, maxPages: 100 }
      )
      if (!result.ok) throw new Error(result.data?.error || 'Failed to load clients')
      setCustomers(getCollection<any>(result.data, ['customers']))
      setLoadingError(null)
    } catch (error) {
      // Preserve last-known rows and distinguish an unavailable directory from an empty one.
      const message = error instanceof Error ? error.message : 'Failed to load clients'
      setLoadingError(message)
      toast.error(message)
      console.error('Failed to fetch customers:', error)
    } finally {
      customerRefreshRef.current = false
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchCustomers()
    const refresh = () => { if (document.visibilityState === 'visible') void fetchCustomers(false) }
    // Sync events now carry other devices' changes too (see lib/sync-hub.ts), so
    // the timer is only a safety net for an unreachable stamp endpoint.
    const unsubscribe = subscribeDataSync(({ scopes }) => {
      if (scopes.includes('customers') || scopes.includes('orders') || scopes.includes('feedback')) refresh()
    })
    const timer = window.setInterval(refresh, 60000)
    return () => { unsubscribe(); window.clearInterval(timer) }
  }, [])

  const customerRows = useMemo(() => {
    return customers.map((customer) => ({
      ...customer,
      // Keep the same one-decimal rating display/filter semantics using server aggregates.
      orderCount: Number(customer.successfulDeliveries),
      totalSpend: Number(customer.successfulDeliverySpend),
      rating: customer.rating == null ? null : Number(Number(customer.rating).toFixed(1)),
      ratingCount: Number(customer.ratingCount),
    }))
  }, [customers])

  const filteredRows = useMemo(() => {
    return customerRows.filter((row) => {
      const matchesSearch = !search.trim()
        || row.name?.toLowerCase().includes(search.toLowerCase())
        || row.email?.toLowerCase().includes(search.toLowerCase())
        || String(row.phone || '').toLowerCase().includes(search.toLowerCase())

      const matchesRating =
        ratingFilter === 'all'
          ? true
          : row.rating !== null && row.rating >= Number(ratingFilter)

      return matchesSearch && matchesRating
    })
  }, [customerRows, search, ratingFilter])

  const totalClients = customerRows.length
  const customersWithDiscounts = customerRows.filter((row) => {
    const option = String(row?.discountOption || 'NO_DISCOUNT').toUpperCase()
    const status = String(row?.discountStatus || 'REMOVED').toUpperCase()
    return option !== 'NO_DISCOUNT' && status === 'ACTIVE'
  }).length
  const currentMonth = new Date().getMonth()
  const currentYear = new Date().getFullYear()
  const newClients = customerRows.filter((row) => {
    const date = row.createdAt ? new Date(row.createdAt) : null
    return date && !Number.isNaN(date.getTime()) && date.getMonth() === currentMonth && date.getFullYear() === currentYear
  }).length
  const ratedCustomerRows = customerRows.filter((row) => row.rating !== null)
  const avgSatisfaction = ratedCustomerRows.length > 0
    ? Number((ratedCustomerRows.reduce((sum, row) => sum + Number(row.rating), 0) / ratedCustomerRows.length).toFixed(1))
    : null
  const exportCsv = () => {
    // Keep the export aligned with the visible client table instead of exposing
    // raw order references and timestamps that are not part of this view.
    const headers = [
      'Client',
      'Email',
      'Phone',
      'Location',
      'Successful Deliveries',
      'Total Spend (₱)',
      'Satisfaction',
      'Discount',
    ]
    const lines = filteredRows.map((row) => [
      row.name || '',
      row.email || '',
      // Excel otherwise converts long phone numbers to scientific notation.
      row.phone ? `="${String(row.phone).replace(/"/g, '""')}"` : '',
      [
        Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))
          ? `${Number(row.latitude).toFixed(6)} ${Number(row.longitude).toFixed(6)}`
          : '',
        [row.city, row.province].filter(Boolean).join(', '),
      ].filter(Boolean).join(' | '),
      row.orderCount,
      formatPeso(Number(row.totalSpend || 0)),
      row.rating === null ? 'N/A' : `${Number(row.rating).toFixed(1)} / 5`,
      getDiscountDisplay(row),
    ])
    const csv = '\uFEFF' + [headers, ...lines]
      .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', 'registered-customers.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const openDiscountDialog = (row: any) => {
    setDiscountTarget(row)
    setDiscountOption(String(row.discountOption || 'NO_DISCOUNT').toUpperCase())
    const normalizedStatus = String(row.discountStatus || 'ACTIVE').toUpperCase()
    setDiscountStatus(normalizedStatus === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE')
    setDiscountPercent(String(Number(row.discountPercent || 0) || ''))
    setDiscountDialogOpen(true)
  }

  const saveDiscount = async () => {
    if (!discountTarget?.id) return
    setIsSavingDiscount(true)
    try {
      const response = await fetch(`/api/customers/${discountTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discountOption,
          discountStatus: discountStatus === 'ACTIVE' ? 'ACTIVE' : 'REMOVED',
          discountPercent: Number(discountPercent || 0),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to save discount')
      }
      toast.success('Customer discount updated')
      setDiscountDialogOpen(false)
      await fetchCustomers()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save discount')
    } finally {
      setIsSavingDiscount(false)
    }
  }

  const renderStars = (rating: number | null) => {
    if (rating === null || !Number.isFinite(Number(rating))) {
      return <span className="text-sm text-gray-500">N/A</span>
    }

    const rounded = Math.max(0, Math.min(5, Math.round(Number(rating))))
    return (
      <span className="flex items-center gap-0.5" aria-label={`${Number(rating).toFixed(1)} out of 5`}>
        {Array.from({ length: 5 }, (_, index) => (
          <Star
            key={index}
            className={`h-4 w-4 ${index < rounded ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`}
          />
        ))}
      </span>
    )
  }

  const customerHasDiscount = (row: any) => {
    // A configured inactive discount still exists and should reopen as an edit.
    const option = String(row?.discountOption || 'NO_DISCOUNT').toUpperCase()
    const status = String(row?.discountStatus || 'REMOVED').toUpperCase()
    return option !== 'NO_DISCOUNT' && status !== 'REMOVED' && status !== 'CANCELLED'
  }

  const getDiscountDisplay = (row: any) => {
    const status = String(row?.discountStatus || 'REMOVED').toUpperCase()
    const option = String(row?.discountOption || 'NO_DISCOUNT').toUpperCase()
    if (status === 'REMOVED' || status === 'CANCELLED' || option === 'NO_DISCOUNT') return 'No Discount'
    if (option.startsWith('DISCOUNT_')) return `${option.replace('DISCOUNT_', '')}% Discount`
    if (option === 'OTHER') {
      const percent = Number(row?.discountPercent || 0)
      return percent > 0 ? `${percent}% Discount` : 'Custom Discount'
    }
    return option.replace(/_/g, ' ')
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Registered Clients</h1>
        <p className="text-gray-500">Customer insights, activity, and profile information</p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-blue-50 p-1.5"><Users className="h-3.5 w-3.5 text-blue-600" /></div>
              <div>
                <p className="text-xs text-gray-500">Total Clients</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{totalClients}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-emerald-50 p-1.5"><CheckCircle className="h-3.5 w-3.5 text-emerald-600" /></div>
              <div>
                <p className="text-xs text-gray-500">Customers with Discounts</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{customersWithDiscounts}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-violet-50 p-1.5"><TrendingUp className="h-3.5 w-3.5 text-violet-600" /></div>
              <div>
                <p className="text-xs text-gray-500">New Clients</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{newClients}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-amber-50 p-1.5"><Star className="h-3.5 w-3.5 text-amber-600" /></div>
              <div>
                <p className="text-xs text-gray-500">Avg Satisfaction</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{avgSatisfaction === null ? 'N/A' : avgSatisfaction}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex flex-row flex-wrap items-center gap-2">
            <Input
              placeholder="Search by client name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-[12rem] flex-1"
            />
            <select
              title="Customer rating filter"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value)}
            >
              <option value="all">All Ratings</option>
              <option value="5">5.0</option>
              <option value="4">4.0+</option>
              <option value="3">3.0+</option>
            </select>
            <Button className="gap-2 bg-blue-600 text-white hover:bg-blue-700" onClick={exportCsv}>
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <PortalTableSkeleton rows={5} columns={5} className="border-0 shadow-none" />
          ) : loadingError && customers.length === 0 ? (
            <div className="text-center py-12 text-gray-500" role="alert">{loadingError}</div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No registered clients found</div>
          ) : (
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="stack-table w-full min-w-[900px]">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">Client</th>
                    <th className="text-left p-4 font-medium text-gray-600">Contact</th>
                    <th className="text-left p-4 font-medium text-gray-600">Location</th>
                    <th className="text-left p-4 font-medium text-gray-600">Successful Deliveries</th>
                    <th className="text-left p-4 font-medium text-gray-600">Satisfaction</th>
                    <th className="text-left p-4 font-medium text-gray-600">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10 border border-slate-200">
                            {resolveClientImageUrl(row.avatar) ? (
                              <AvatarImage
                                src={resolveClientImageUrl(row.avatar) || undefined}
                                alt={row.name || 'Customer avatar'}
                                className="object-cover"
                              />
                            ) : null}
                            <AvatarFallback className="bg-blue-100 text-blue-700 font-semibold">
                              {String(row.name || row.email || 'CU')
                                .trim()
                                .split(/\s+/)
                                .slice(0, 2)
                                .map((part) => part[0]?.toUpperCase() || '')
                                .join('') || 'CU'}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold text-gray-900">{row.name || 'N/A'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="text-sm text-gray-700">{row.email || 'N/A'}</p>
                        <p className="text-sm text-gray-500">{row.phone || 'No phone'}</p>
                      </td>
                      <td className="p-4">
                        <p className="text-xs text-gray-500">
                          {typeof row.latitude === 'number' && typeof row.longitude === 'number'
                            ? `${Number(row.latitude).toFixed(6)} ${Number(row.longitude).toFixed(6)}`
                            : 'No coordinates'}
                        </p>
                        <p className="text-sm text-gray-700">
                          {[row.city, row.province].filter(Boolean).join(', ') || 'No city/province'}
                        </p>
                      </td>
                      <td className="p-4">
                        <p className="font-semibold text-gray-900">{row.orderCount}</p>
                        <p className="text-sm text-gray-500">{formatPeso(row.totalSpend || 0)}</p>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1 text-sm">
                          {renderStars(row.rating)}
                          {row.rating === null ? null : (
                            <span className="font-semibold text-emerald-600">{Number(row.rating).toFixed(1)}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        {/* Keep every row action in one aligned group in the stacked mobile card. */}
                        <div className="customer-row-actions">
                          <CompactDiscountLine value={getDiscountDisplay(row)} className="text-xs" />
                          <Button size="sm" variant="outline" className="w-full" onClick={() => openDiscountDialog(row)}>
                            {customerHasDiscount(row) ? 'Edit Discount' : 'Apply Discount'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={discountDialogOpen} onOpenChange={setDiscountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{discountTarget && customerHasDiscount(discountTarget) ? 'Edit Discount' : 'Apply Discount'}</DialogTitle>
            <DialogDescription>
              {discountTarget ? `Customer: ${discountTarget.name || discountTarget.email}` : 'Select discount rule'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Discount Option</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={discountOption} onChange={(e) => setDiscountOption(e.target.value)}>
                <option value="NO_DISCOUNT">No Discount</option>
                <option value="DISCOUNT_5">5% Discount - courtesy discount</option>
                <option value="DISCOUNT_10">10% Discount - regular customer discount</option>
                <option value="DISCOUNT_15">15% Discount - loyal customer discount</option>
                <option value="DISCOUNT_20">20% Discount - bulk order discount</option>
                <option value="DISCOUNT_25">25% Discount - maximum recommended discount</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            {discountOption === 'OTHER' ? (
              <div className="grid grid-cols-1 gap-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Custom %</label>
                  <Input type="number" min="0" step="0.01" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} />
                </div>
              </div>
            ) : null}
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Discount Status</label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={discountStatus} onChange={(e) => setDiscountStatus(e.target.value)}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setDiscountDialogOpen(false)}>Cancel</Button>
            <Button className="flex-1 bg-blue-600 text-white hover:bg-blue-700" disabled={isSavingDiscount} onClick={saveDiscount}>
              {isSavingDiscount ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Discount
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}
