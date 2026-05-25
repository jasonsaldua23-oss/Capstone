'use client'

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { useAuth } from '@/app/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PortalCardsSkeleton } from '@/components/portals/shared/loading-skeletons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
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
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, Clock, CheckCircle, XCircle, MapPin, UserCheck, MessageSquare, AlertTriangle, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, Database, FileText, Users, User, Star, Download, Pencil, Trash2, CalendarDays } from 'lucide-react'
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

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function FeedbackView() {
  const [feedbacks, setFeedbacks] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [ratingFilter, setRatingFilter] = useState('all')

  useEffect(() => {
    async function fetchFeedbacks() {
      try {
        const [feedbackResult, ordersResult] = await Promise.all([
          fetchAllPaginatedCollection<any>(
            '/api/feedback',
            'feedbacks',
            { cache: 'no-store' },
            { retries: 3, timeoutMs: 15000, pageSize: 200, maxPages: 100 }
          ),
          fetchAllPaginatedCollection<any>(
            '/api/orders?includeItems=none',
            'orders',
            { cache: 'no-store' },
            { retries: 3, timeoutMs: 15000, pageSize: 200, maxPages: 100 }
          ),
        ])

        setFeedbacks(feedbackResult.ok ? getCollection<any>(feedbackResult.data, ['feedbacks']) : [])

        setOrders(ordersResult.ok ? getCollection<any>(ordersResult.data, ['orders']) : [])
      } catch (error) {
        console.error('Failed to fetch feedback:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchFeedbacks()
  }, [])

  const deliveredOrderIds = new Set(
    orders
      .filter((order) => {
        const orderStatus = String(order?.status || '').toUpperCase()
        const deliveryStatus = String(order?.deliveryStatus || '').toUpperCase()
        return orderStatus === 'DELIVERED' || deliveryStatus === 'DELIVERED'
      })
      .map((order) => String(order?.id || '').trim())
      .filter(Boolean)
  )
  const feedbackOrderIds = new Set(
    feedbacks
      .map((item) => String(item?.orderId || item?.order_id || item?.order?.id || '').trim())
      .filter((id) => id && deliveredOrderIds.has(id))
  )
  const responseRate = deliveredOrderIds.size > 0
    ? Math.round((feedbackOrderIds.size / deliveredOrderIds.size) * 100)
    : 0
  const deliveredFeedbacks = feedbacks.filter((item) => {
    const orderId = String(item?.orderId || item?.order_id || item?.order?.id || '').trim()
    return orderId ? deliveredOrderIds.has(orderId) : true
  })
  const rated = deliveredFeedbacks.filter((item) => typeof item.rating === 'number' && item.rating > 0)
  const avgRating = rated.length > 0
    ? rated.reduce((sum, item) => sum + item.rating, 0) / rated.length
    : 0
  const ratingDistribution = [5, 4, 3, 2, 1].map((score) => ({
    label: `${score} Star${score > 1 ? 's' : ''}`,
    value: rated.filter((item) => item.rating === score).length,
  }))

  const satisfactionTrend = useMemo(() => {
    const now = new Date()
    const months = Array.from({ length: 6 }).map((_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      return {
        key,
        label: date.toLocaleString('en-US', { month: 'short' }),
      }
    })

    return months.map((month) => {
      const monthRatings = rated
        .filter((item) => {
          if (!item?.createdAt) return false
          const createdAt = new Date(String(item.createdAt))
          if (Number.isNaN(createdAt.getTime())) return false
          const itemKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`
          return itemKey === month.key
        })
        .map((item) => Number(item.rating || 0))
        .filter((value) => Number.isFinite(value) && value > 0)

      const avgScore = monthRatings.length
        ? Number((monthRatings.reduce((sum, value) => sum + value, 0) / monthRatings.length).toFixed(2))
        : null

      return {
        month: month.label,
        avgScore,
      }
    })
  }, [rated])

  const filteredFeedbacks = feedbacks.filter((item) => {
    const search = searchTerm.trim().toLowerCase()
    const matchesSearch =
      search.length === 0 ||
      String(item.customer?.name || '').toLowerCase().includes(search) ||
      String(item.order?.orderNumber || '').toLowerCase().includes(search)
    const matchesRating = ratingFilter === 'all' || Number(item.rating || 0) === Number(ratingFilter)
    return matchesSearch && matchesRating
  })

  const renderStars = (rating: number) => {
    const rounded = Math.max(0, Math.min(5, Math.round(Number(rating || 0))))
    return (
      <span className="flex items-center gap-0.5" aria-label={`${Number(rating || 0).toFixed(1)} out of 5`}>
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
    <div className="space-y-6">
      <div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Client Feedback</h1>
          <p className="text-gray-500">Monitor customer satisfaction and improve service quality</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-amber-50 flex items-center justify-center">
                <Star className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Avg Rating</p>
                <p className="text-3xl font-bold">{avgRating.toFixed(1)}/5.0</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-blue-50 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Feedback</p>
                <p className="text-3xl font-bold">{feedbacks.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-green-50 flex items-center justify-center">
                <CircleCheck className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Response Rate</p>
                <p className="text-3xl font-bold">{responseRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Rating Distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ratingDistribution} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="4 4" horizontal={true} vertical={true} />
                <XAxis type="category" dataKey="label" />
                <YAxis type="number" allowDecimals={false} domain={[0, 'auto']} />
                <Tooltip />
                <Bar dataKey="value" fill="#3b82f6" radius={[2, 2, 2, 2]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Satisfaction Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={satisfactionTrend} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="4 4" />
                <XAxis dataKey="month" />
                <YAxis domain={[0, 5]} ticks={[0, 2, 5]} allowDecimals={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="avgScore"
                  name="Avg Score"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 4, strokeWidth: 2, fill: '#ffffff' }}
                  connectNulls
                />
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <label className="text-sm font-medium text-gray-700">Feedback Search and Filter</label>
          <div className="flex flex-row gap-3">
            <div className="relative flex-1">
              {/* Search icon removed */}
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by customer or order ID..."
                className="pl-10"
              />
            </div>
            <Button variant="outline" size="icon">
              {/* <Filter className="h-4 w-4" /> */}
            </Button>
            <select
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              title="Filter Rating"
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value)}
            >
              <option value="all">All Ratings</option>
              <option value="5">5 Stars</option>
              <option value="4">4 Stars</option>
              <option value="3">3 Stars</option>
              <option value="2">2 Stars</option>
              <option value="1">1 Star</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-[1.25rem] border border-slate-200/80 bg-white/95 shadow-[0_12px_28px_rgba(148,163,184,0.12)]">
        <CardContent className="space-y-2.5 p-2.5 md:p-3">
          {isLoading ? (
            <PortalCardsSkeleton cards={4} />
          ) : filteredFeedbacks.length === 0 ? (
            <div className="py-12 text-center">
              <MessageSquare className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No customer feedback found</p>
            </div>
          ) : (
            filteredFeedbacks.map((item: any) => {
              const feedbackOrderId = String(item?.orderId || item?.order_id || item?.order?.id || '').trim()
              const feedbackOrderNumber = String(item?.order?.orderNumber || item?.orderNumber || '').trim()
              const matchedOrder = orders.find((order) => {
                const orderId = String(order?.id || '').trim()
                const orderNumber = String(order?.orderNumber || '').trim()
                return (feedbackOrderId && orderId === feedbackOrderId) || (feedbackOrderNumber && orderNumber === feedbackOrderNumber)
              }) || null
              const assignedDriverName =
                matchedOrder?.progress?.trip?.driver?.user?.name ||
                matchedOrder?.progress?.trip?.driver?.name ||
                matchedOrder?.assignedDriverName ||
                matchedOrder?.driverName ||
                item?.order?.driver?.name ||
                item?.order?.assignedDriver?.name ||
                item?.order?.assignedDriverName ||
                item?.order?.driverName ||
                item?.order?.trip?.driver?.name ||
                item?.trip?.driver?.name ||
                null
              const customerName = String(item.customer?.name || 'Customer')
              const customerAvatarUrl = resolveClientImageUrl(item?.customer?.avatar)
              const orderNumber = String(item.order?.orderNumber || item.orderNumber || 'No Order')
              const createdDate = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-US') : 'N/A'
              const feedbackMessage = String(item.message || item.subject || 'No message')
                .replace(/\s*\n+\s*/g, ' - ')
                .trim()
              return (
                <article
                  key={item.id}
                  className="rounded-[1rem] border border-slate-200/80 bg-white px-2.5 py-2.5 shadow-[0_8px_18px_rgba(148,163,184,0.09)] md:px-3 md:py-3"
                >
                  <div className="flex flex-col gap-2.5">
                    <div className="flex flex-col gap-2.5 md:flex-row md:items-start">
                      <Avatar className="h-14 w-14 shrink-0 border border-[#d6e3ff] shadow-[0_8px_18px_rgba(148,163,184,0.16)]">
                        {customerAvatarUrl ? <AvatarImage src={customerAvatarUrl} alt={customerName} className="object-cover" /> : null}
                        <AvatarFallback className="bg-[linear-gradient(145deg,#e6ecff_0%,#dfe8ff_52%,#d9e4ff_100%)] text-[#4f7ef4]">
                          {String(customerName || 'CU')
                            .trim()
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part[0]?.toUpperCase() || '')
                            .join('') || 'CU'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-bold tracking-tight text-slate-900 md:text-[1.4rem]">{customerName}</h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.82rem] text-slate-500 md:text-[0.88rem]">
                          <FileText className="h-3.5 w-3.5 text-[#5b84f5]" strokeWidth={2} />
                          <span>Order</span>
                          <span className="text-[1rem] font-semibold leading-none tracking-wide text-[#2047a8] md:text-[1.15rem]">
                            {orderNumber}
                          </span>
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-slate-500">
                          {renderStars(Number(item.rating || 0))}
                          <span className="hidden h-5 w-px bg-slate-200 md:block" />
                          <div className="flex items-center gap-1 text-[0.82rem] md:text-[0.88rem]">
                            <CalendarDays className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.8} />
                            <span>{createdDate}</span>
                          </div>
                          <span className="hidden h-5 w-px bg-slate-200 md:block" />
                          <Badge className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[0.7rem] font-semibold text-emerald-700 hover:bg-emerald-50">
                            <Truck className="mr-1 h-3 w-3" strokeWidth={2.1} />
                            Delivery
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="h-px w-full bg-slate-200" />
                    <div className="flex flex-wrap items-center gap-1.5 text-[0.82rem] md:text-[0.88rem]">
                      <User className="h-4 w-4 text-[#4f7ef4]" strokeWidth={1.9} />
                      <span className="text-slate-500">Assigned Driver:</span>
                      <span className="font-semibold text-slate-900">{assignedDriverName || 'Unassigned'}</span>
                    </div>
                    <div className="rounded-[0.9rem] border border-[#d6e3ff] bg-[#fbfdff] px-2.5 py-2.5 md:px-3 md:py-3">
                      <div className="flex items-start gap-2">
                        <span className="text-[1.6rem] font-bold leading-none text-[#355fca]">“</span>
                        <p className="pt-0.5 text-[0.82rem] leading-[1.55] text-slate-900 md:text-[0.9rem]">
                          {feedbackMessage}
                        </p>
                      </div>
                    </div>
                  </div>
                </article>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}

