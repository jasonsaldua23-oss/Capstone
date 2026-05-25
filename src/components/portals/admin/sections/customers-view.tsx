'use client'

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { useAuth } from '@/app/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, Clock, CheckCircle, XCircle, MapPin, TrendingUp, UserCheck, MessageSquare, AlertTriangle, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, Database, FileText, Users, Star, Download, Pencil, Trash2 } from 'lucide-react'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, LineChart, Line, Tooltip, PieChart, Pie, Cell, Label, BarChart, Bar, ResponsiveContainer, Legend } from 'recharts'
import { resolveClientImageUrl } from '@/lib/client-image'
import {
  toArray,
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

export function CustomersView() {
  const { user } = useAuth()
  const [customers, setCustomers] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [feedback, setFeedback] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [ratingFilter, setRatingFilter] = useState('all')
  const [discountDialogOpen, setDiscountDialogOpen] = useState(false)
  const [isSavingDiscount, setIsSavingDiscount] = useState(false)
  const [discountTarget, setDiscountTarget] = useState<any | null>(null)
  const [discountOption, setDiscountOption] = useState('NO_DISCOUNT')
  const [discountStatus, setDiscountStatus] = useState('ACTIVE')
  const [discountPercent, setDiscountPercent] = useState('')

  const fetchCustomers = async () => {
    setIsLoading(true)
    try {
      const [customersResponse, ordersResult, feedbackResponse] = await Promise.all([
        fetch('/api/customers?page=1&pageSize=500'),
        fetchAllPaginatedCollection<any>(
          '/api/orders?includeItems=none',
          'orders',
          { cache: 'no-store' },
          { retries: 3, timeoutMs: 15000, pageSize: 200, maxPages: 100 }
        ),
        fetch('/api/feedback?page=1&pageSize=1000'),
      ])

      const customersData = customersResponse.ok ? await customersResponse.json().catch(() => ({})) : {}
      const feedbackData = feedbackResponse.ok ? await feedbackResponse.json().catch(() => ({})) : {}

      setCustomers(toArray<any>(customersData?.data ?? customersData?.customers ?? customersData))
      setOrders(ordersResult.ok ? getCollection<any>(ordersResult.data, ['orders']) : [])
      setFeedback(getCollection<any>(feedbackData, ['feedbacks']))
    } catch (error) {
      console.error('Failed to fetch customers:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchCustomers()
  }, [])

  const customerRows = useMemo(() => {
    const statsByCustomer = new Map<string, { orderCount: number; totalSpend: number; lastOrderNumber: string | null; lastOrderDate: string | null }>()
    const lastOrderByCustomer = new Map<string, { lastOrderNumber: string | null; lastOrderDate: string | null }>()
    const ratingByCustomer = new Map<string, { sum: number; count: number }>()
    const deliveredOrderIds = new Set<string>()

    for (const order of orders) {
      const customerId = String(order?.customerId || order?.customer_id || order?.customer?.id || '').trim()
      if (!customerId) continue
      const createdAtRaw = String(order?.createdAt || order?.created_at || '').trim() || null
      const createdAt = createdAtRaw ? new Date(createdAtRaw) : null
      const prevLast = lastOrderByCustomer.get(customerId) || { lastOrderNumber: null, lastOrderDate: null }
      const prevLastDate = prevLast.lastOrderDate ? new Date(prevLast.lastOrderDate) : null
      const isNewerLast = createdAt && !Number.isNaN(createdAt.getTime()) && (!prevLastDate || createdAt.getTime() > prevLastDate.getTime())
      if (isNewerLast) {
        lastOrderByCustomer.set(customerId, {
          lastOrderNumber: order?.orderNumber || order?.order_number || prevLast.lastOrderNumber,
          lastOrderDate: createdAtRaw || prevLast.lastOrderDate,
        })
      }

      const normalizedOrderStatus = String(order?.status || '').toUpperCase()
      const normalizedDeliveryStatus = String(order?.deliveryStatus || '').toUpperCase()
      const isSuccessfulDelivery = normalizedOrderStatus === 'DELIVERED' || normalizedDeliveryStatus === 'DELIVERED'
      if (!isSuccessfulDelivery) continue
      if (order?.id) deliveredOrderIds.add(String(order.id))
      const prev = statsByCustomer.get(customerId) || { orderCount: 0, totalSpend: 0, lastOrderNumber: null, lastOrderDate: null }
      const totalAmount = Number(order?.totalAmount ?? order?.total_amount ?? 0)
      const prevDate = prev.lastOrderDate ? new Date(prev.lastOrderDate) : null
      const isNewer = createdAt && !Number.isNaN(createdAt.getTime()) && (!prevDate || createdAt.getTime() > prevDate.getTime())

      statsByCustomer.set(customerId, {
        orderCount: prev.orderCount + 1,
        totalSpend: prev.totalSpend + (Number.isFinite(totalAmount) ? totalAmount : 0),
        lastOrderNumber: isNewer ? (order?.orderNumber || order?.order_number || prev.lastOrderNumber) : prev.lastOrderNumber,
        lastOrderDate: isNewer ? (createdAtRaw || prev.lastOrderDate) : prev.lastOrderDate,
      })
    }

    for (const item of feedback) {
      const feedbackOrderId = String(item?.orderId || item?.order_id || '').trim()
      if (feedbackOrderId && !deliveredOrderIds.has(feedbackOrderId)) continue

      const customerId = String(item?.customerId || item?.customer_id || item?.customer?.id || '').trim()
      if (!customerId) continue
      const rating = Number(item?.rating || 0)
      if (!Number.isFinite(rating) || rating <= 0) continue
      const prev = ratingByCustomer.get(customerId) || { sum: 0, count: 0 }
      ratingByCustomer.set(customerId, { sum: prev.sum + rating, count: prev.count + 1 })
    }

    return customers.map((customer) => {
      const orderStats = statsByCustomer.get(customer.id) || { orderCount: 0, totalSpend: 0, lastOrderNumber: null, lastOrderDate: null }
      const lastOrderStats = lastOrderByCustomer.get(customer.id) || { lastOrderNumber: null, lastOrderDate: null }
      const feedbackStats = ratingByCustomer.get(customer.id) || { sum: 0, count: 0 }
      const rating = feedbackStats.count > 0 ? Number((feedbackStats.sum / feedbackStats.count).toFixed(1)) : null
      return {
        ...customer,
        orderCount: orderStats.orderCount,
        totalSpend: orderStats.totalSpend,
        lastOrderNumber: lastOrderStats.lastOrderNumber,
        lastOrderDate: lastOrderStats.lastOrderDate,
        rating,
        ratingCount: feedbackStats.count,
      }
    })
  }, [customers, orders, feedback])

  const filteredRows = useMemo(() => {
    return customerRows.filter((row) => {
      const matchesSearch = !search.trim()
        || row.name?.toLowerCase().includes(search.toLowerCase())
        || row.email?.toLowerCase().includes(search.toLowerCase())
        || String(row.phone || '').toLowerCase().includes(search.toLowerCase())

      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'active'
            ? row.isActive
            : !row.isActive

      const matchesRating =
        ratingFilter === 'all'
          ? true
          : row.rating !== null && row.rating >= Number(ratingFilter)

      return matchesSearch && matchesStatus && matchesRating
    })
  }, [customerRows, search, statusFilter, ratingFilter])

  const totalClients = customerRows.length
  const activeClients = customerRows.filter((row) => row.isActive).length
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
    const headers = ['Name', 'Email', 'Phone', 'Address', 'Status', 'Orders', 'TotalSpend', 'LastOrder', 'LastOrderDate', 'Rating']
    const lines = filteredRows.map((row) => [
      row.name || '',
      row.email || '',
      row.phone || '',
      [row.address, row.city, row.province, row.zipCode].filter(Boolean).join(', '),
      row.isActive ? 'Active' : 'Inactive',
      row.orderCount,
      row.totalSpend,
      row.lastOrderNumber || '',
      row.lastOrderDate ? new Date(row.lastOrderDate).toISOString() : '',
      row.rating === null ? 'N/A' : row.rating,
    ])
    const csv = [headers, ...lines]
      .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
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
    const percentValue = Number(discountPercent || 0)
    const isOwner = String((user as any)?.role || '').toUpperCase() === 'SUPER_ADMIN'
    if (discountOption === 'OTHER' && percentValue > 25 && !isOwner) {
      toast.error('Only owner can apply custom discount above 25%')
      return
    }
    setIsSavingDiscount(true)
    try {
      const response = await fetch(`/api/customers/${discountTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discountOption,
          discountStatus: discountStatus === 'ACTIVE' ? 'ACTIVE' : 'REMOVED',
          discountPercent: Number(discountPercent || 0),
          discountAmountPerCase: 0,
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

  const getDiscountDisplay = (row: any) => {
    const status = String(row?.discountStatus || 'REMOVED').toUpperCase()
    const option = String(row?.discountOption || 'NO_DISCOUNT').toUpperCase()
    if (status === 'REMOVED' || status === 'CANCELLED' || option === 'NO_DISCOUNT') {
      return { label: 'No Discount', statusLabel: 'INACTIVE' }
    }
    if (option.startsWith('DISCOUNT_')) {
      const pct = option.replace('DISCOUNT_', '')
      return { label: `${pct}% Discount`, statusLabel: status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' }
    }
    if (option === 'OTHER') {
      const percent = Number(row?.discountPercent || 0)
      return { label: percent > 0 ? `${percent}% Discount` : 'Custom Discount', statusLabel: status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' }
    }
    return { label: option.replace(/_/g, ' '), statusLabel: status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Registered Customers</h1>
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
                <p className="text-xs text-gray-500">Active Clients</p>
                <p className="text-2xl leading-tight font-bold text-gray-900">{activeClients}</p>
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
          <div className="flex flex-row items-center gap-2">
            <Input
              placeholder="Search by client name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="lg:flex-1"
            />
            <select
              title="Customer status filter"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
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
            <Button className="gap-2" onClick={exportCsv}>
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
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No registered customers found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">Client</th>
                    <th className="text-left p-4 font-medium text-gray-600">Contact</th>
                    <th className="text-left p-4 font-medium text-gray-600">Location</th>
                    <th className="text-left p-4 font-medium text-gray-600">Successful Deliveries</th>
                    <th className="text-left p-4 font-medium text-gray-600">Last Order</th>
                    <th className="text-left p-4 font-medium text-gray-600">Satisfaction</th>
                    <th className="text-left p-4 font-medium text-gray-600">Status</th>
                    <th className="text-left p-4 font-medium text-gray-600">Discount</th>
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
                        <p className="text-sm font-medium text-gray-900">{row.lastOrderNumber || 'N/A'}</p>
                        <p className="text-sm text-gray-500">{row.lastOrderDate ? new Date(row.lastOrderDate).toLocaleDateString() : 'N/A'}</p>
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
                        <Badge className={row.isActive ? 'bg-green-100 text-green-800 hover:bg-green-100' : 'bg-gray-100 text-gray-700 hover:bg-gray-100'}>
                          {row.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <div className="space-y-1">
                          {(() => {
                            const discountView = getDiscountDisplay(row)
                            return (
                              <>
                                <CompactDiscountLine value={discountView.label} className="text-xs" />
                              </>
                            )
                          })()}
                          <Button size="sm" variant="outline" onClick={() => openDiscountDialog(row)}>Apply Discount</Button>
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
            <DialogTitle>Apply Discount</DialogTitle>
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
            <Button className="flex-1" disabled={isSavingDiscount} onClick={saveDiscount}>
              {isSavingDiscount ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Discount
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
