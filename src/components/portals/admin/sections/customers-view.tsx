'use client'

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { useAuth } from '@/app/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function CustomersView() {
  const [customers, setCustomers] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [feedback, setFeedback] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [ratingFilter, setRatingFilter] = useState('all')

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
    const ratingByCustomer = new Map<string, { sum: number; count: number }>()
    const deliveredOrderIds = new Set<string>()

    for (const order of orders) {
      const normalizedOrderStatus = String(order?.status || '').toUpperCase()
      const normalizedDeliveryStatus = String(order?.deliveryStatus || '').toUpperCase()
      const isSuccessfulDelivery = normalizedOrderStatus === 'DELIVERED' || normalizedDeliveryStatus === 'DELIVERED'
      if (!isSuccessfulDelivery) continue
      if (order?.id) deliveredOrderIds.add(String(order.id))
      const customerId = String(order?.customerId || '')
      if (!customerId) continue
      const prev = statsByCustomer.get(customerId) || { orderCount: 0, totalSpend: 0, lastOrderNumber: null, lastOrderDate: null }
      const createdAt = order?.createdAt ? new Date(order.createdAt) : null
      const prevDate = prev.lastOrderDate ? new Date(prev.lastOrderDate) : null
      const isNewer = createdAt && !Number.isNaN(createdAt.getTime()) && (!prevDate || createdAt.getTime() > prevDate.getTime())

      statsByCustomer.set(customerId, {
        orderCount: prev.orderCount + 1,
        totalSpend: prev.totalSpend + Number(order?.totalAmount || 0),
        lastOrderNumber: isNewer ? (order?.orderNumber || prev.lastOrderNumber) : prev.lastOrderNumber,
        lastOrderDate: isNewer ? (order?.createdAt || prev.lastOrderDate) : prev.lastOrderDate,
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
      const feedbackStats = ratingByCustomer.get(customer.id) || { sum: 0, count: 0 }
      const rating = feedbackStats.count > 0 ? Number((feedbackStats.sum / feedbackStats.count).toFixed(1)) : null
      return {
        ...customer,
        orderCount: orderStats.orderCount,
        totalSpend: orderStats.totalSpend,
        lastOrderNumber: orderStats.lastOrderNumber,
        lastOrderDate: orderStats.lastOrderDate,
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
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
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
            <div className="flex items-center justify-center h-52">
              <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
            </div>
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
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4">
                        <p className="font-semibold text-gray-900">{row.name || 'N/A'}</p>
                        <p className="text-sm text-gray-500">Retail Customer</p>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
