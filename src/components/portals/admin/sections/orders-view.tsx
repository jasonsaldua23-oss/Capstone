'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { useAuth } from '@/app/page'
import { clearTabAuthToken } from '@/lib/client-auth'
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

export function OrdersView() {
  const [orders, setOrders] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false)
  const [rejectOrder, setRejectOrder] = useState<any | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)
  const [loadChecklistOpen, setLoadChecklistOpen] = useState(false)
  const [loadChecklist, setLoadChecklist] = useState<Record<string, boolean>>({})
  const [warehouseFilterId, setWarehouseFilterId] = useState('all')
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')
  const [orderDatePreset, setOrderDatePreset] = useState('all')
  const [orderCustomDateFilter, setOrderCustomDateFilter] = useState('')
  const [orderMinPriceFilter, setOrderMinPriceFilter] = useState('')
  const [orderMaxPriceFilter, setOrderMaxPriceFilter] = useState('')
  const latestOrderMarkerRef = useRef('')
  const latestOrderUpdatedAtRef = useRef('')

  useEffect(() => {
    let isMounted = true
    let isFetchingOrders = false

    const getMaxUpdatedAt = (rows: any[]) =>
      rows.reduce((latest, row) => {
        const candidate = String(row?.updatedAt || row?.createdAt || '')
        if (!candidate) return latest
        if (!latest) return candidate
        const candidateMs = new Date(candidate).getTime()
        const latestMs = new Date(latest).getTime()
        if (Number.isNaN(candidateMs)) return latest
        if (Number.isNaN(latestMs) || candidateMs > latestMs) return candidate
        return latest
      }, '')

    const mergeOrders = (current: any[], incoming: any[]) => {
      const byId = new Map<string, any>()
      current.forEach((row) => {
        if (!row?.id) return
        byId.set(String(row.id), row)
      })
      incoming.forEach((row) => {
        if (!row?.id) return
        const key = String(row.id)
        byId.set(key, { ...(byId.get(key) || {}), ...row })
      })
      return Array.from(byId.values()).sort((a, b) => {
        const left = new Date(String(a?.createdAt || 0)).getTime()
        const right = new Date(String(b?.createdAt || 0)).getTime()
        return (Number.isNaN(right) ? 0 : right) - (Number.isNaN(left) ? 0 : left)
      })
    }

    const fetchOrderMarker = async () => {
      const markerResult = await safeFetchJson('/api/orders?limit=1&pageSize=1&includeItems=none&sort=updated_at', { cache: 'no-store' }, { retries: 2, timeoutMs: 12000 })
      if (!markerResult.ok) {
        if (markerResult.status === 401 || markerResult.status === 403) {
          clearTabAuthToken()
        }
        throw new Error('Failed to fetch order marker')
      }
      const markerList = getCollection<any>(markerResult.data, ['orders'])
      const top = markerList[0]
      const marker = `${Number((markerResult.data as any)?.total || 0)}::${top?.id || ''}::${top?.updatedAt || ''}`
      return marker
    }

    async function fetchOrdersFull(silent = false) {
      if (isFetchingOrders) return
      isFetchingOrders = true
      try {
        const result = await fetchAllPaginatedCollection<any>(
          '/api/orders?includeItems=preview',
          'orders',
          { cache: 'no-store' },
          { retries: 3, timeoutMs: 15000, pageSize: 200, maxPages: 100 }
        )

        if (!result.ok) {
          if (result.status === 401 || result.status === 403) {
            clearTabAuthToken()
          }
          if (isMounted) {
            setOrders([])
          }
          if (!silent) {
            console.error('Failed to fetch orders:', result.data?.error || 'Request failed')
          }
          return
        }

        if (isMounted) {
          const fullOrders = getCollection<any>(result.data, ['orders'])
          setOrders(fullOrders)
          latestOrderUpdatedAtRef.current = getMaxUpdatedAt(fullOrders)
        }
      } catch (error) {
        if (!silent) {
          console.error('Failed to fetch orders:', error)
        }
      } finally {
        isFetchingOrders = false
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    async function fetchOrdersDeltaIfChanged(silent = true) {
      if (isFetchingOrders) return
      isFetchingOrders = true
      try {
        const marker = await fetchOrderMarker()
        if (latestOrderMarkerRef.current && marker === latestOrderMarkerRef.current) {
          return
        }

        const updatedAfter = latestOrderUpdatedAtRef.current
        if (!updatedAfter) {
          isFetchingOrders = false
          await fetchOrdersFull(silent)
          return
        }

        const params = new URLSearchParams({
          includeItems: 'preview',
          sort: 'updated_at',
          page: '1',
          pageSize: '200',
          updatedAfter,
        })
        const deltaResult = await safeFetchJson(`/api/orders?${params.toString()}`, { cache: 'no-store' }, { retries: 2, timeoutMs: 12000 })
        if (!deltaResult.ok) {
          isFetchingOrders = false
          await fetchOrdersFull(silent)
          return
        }

        if (isMounted) {
          const incoming = getCollection<any>(deltaResult.data, ['orders'])
          if (incoming.length > 0) {
            setOrders((prev) => {
              const merged = mergeOrders(prev, incoming)
              latestOrderUpdatedAtRef.current = getMaxUpdatedAt(merged)
              return merged
            })
          }
          latestOrderMarkerRef.current = marker
        }
      } catch (error) {
        if (!silent) {
          console.error('Failed to refresh orders:', error)
        }
      } finally {
        isFetchingOrders = false
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void fetchOrdersFull()

    const unsubscribe = subscribeDataSync((message) => {
      if (message.scopes.includes('orders') || message.scopes.includes('trips')) {
        void fetchOrdersDeltaIfChanged(true)
      }
    })

    const onFocus = () => {
      void fetchOrdersFull(true)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchOrdersFull(true)
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const quickIntervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchOrdersDeltaIfChanged(true)
      }
    }, 5000)
    const fullIntervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchOrdersFull(true)
      }
    }, 30000)

    return () => {
      isMounted = false
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(quickIntervalId)
      window.clearInterval(fullIntervalId)
    }
  }, [])

  const openOrderDetail = async (order: any) => {
    setSelectedOrder(order)
    setLoadingOrderDetail(true)
    try {
      const response = await fetch(`/api/orders/${order.id}`, { credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false || !payload?.order) return
      setSelectedOrder(payload.order)
    } catch (error) {
      console.error('Failed to load full order details:', error)
    } finally {
      setLoadingOrderDetail(false)
    }
  }

  const formatOrderStatus = (status: string, paymentStatus?: string) => {
    if (String(paymentStatus || '').toLowerCase() === 'pending_approval') {
      return 'PENDING'
    }
    const raw = String(status || '').toUpperCase()
    if (['CONFIRMED', 'PROCESSING', 'PACKED', 'READY_FOR_PICKUP'].includes(raw)) return 'PREPARING'
    if (raw === 'UNAPPROVED') return 'PENDING'
    if (['DISPATCHED', 'IN_TRANSIT'].includes(raw)) return 'OUT FOR DELIVERY'
    if (raw === 'FAILED_DELIVERY') return 'CANCELLED'
    return raw.replace(/_/g, ' ')
  }

  const formatWarehouseStage = (stage: string | null | undefined) => {
    const value = String(stage || 'READY_TO_LOAD').toUpperCase()
    return value.replace(/_/g, ' ')
  }

  const warehouseFilterOptions = useMemo(() => {
    const map = new Map<string, string>()
    orders.forEach((order) => {
      const warehouseId = String(getWarehouseIdFromRow(order) || '').trim()
      if (!warehouseId) return
      const label =
        String(order?.warehouseName || '').trim() ||
        String(order?.warehouseCode || '').trim() ||
        warehouseId
      if (!map.has(warehouseId)) {
        map.set(warehouseId, label)
      }
    })
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [orders])

  const orderStatusOptions = useMemo(() => {
    const statuses = new Set<string>()
    orders.forEach((order) => {
      statuses.add(formatOrderStatus(order?.status, order?.paymentStatus))
    })
    return Array.from(statuses.values()).sort((a, b) => a.localeCompare(b))
  }, [orders])

  const filteredOrders = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000
    const datePresetDays: Record<string, number> = {
      past_7_days: 7,
      past_14_days: 14,
      past_1_month: 30,
      past_3_months: 90,
      past_6_months: 180,
      past_1_year: 365,
    }
    const minPrice = Number(orderMinPriceFilter)
    const maxPrice = Number(orderMaxPriceFilter)
    const hasMinPrice = orderMinPriceFilter.trim() !== '' && Number.isFinite(minPrice)
    const hasMaxPrice = orderMaxPriceFilter.trim() !== '' && Number.isFinite(maxPrice)

    return orders.filter((order) => {
      if (warehouseFilterId !== 'all' && String(getWarehouseIdFromRow(order) || '').trim() !== warehouseFilterId) {
        return false
      }

      const normalizedStatus = formatOrderStatus(order?.status, order?.paymentStatus)
      if (orderStatusFilter !== 'all' && normalizedStatus !== orderStatusFilter) return false

      const rawDate = String(order?.deliveryDate || order?.createdAt || '')
      if (orderDatePreset === 'custom') {
        if (orderCustomDateFilter && !rawDate.startsWith(orderCustomDateFilter)) return false
      } else if (orderDatePreset !== 'all') {
        const thresholdDays = datePresetDays[orderDatePreset]
        const parsedDate = new Date(rawDate)
        if (!Number.isFinite(thresholdDays) || Number.isNaN(parsedDate.getTime())) return false
        if (parsedDate.getTime() < Date.now() - thresholdDays * dayMs) return false
      }

      const amount = Number(order?.totalAmount || 0)
      if (hasMinPrice && amount < minPrice) return false
      if (hasMaxPrice && amount > maxPrice) return false

      return true
    })
  }, [orders, warehouseFilterId, orderStatusFilter, orderDatePreset, orderCustomDateFilter, orderMinPriceFilter, orderMaxPriceFilter])

  useEffect(() => {
    if (warehouseFilterId === 'all') return
    const exists = warehouseFilterOptions.some((warehouse) => warehouse.id === warehouseFilterId)
    if (!exists) {
      setWarehouseFilterId('all')
    }
  }, [warehouseFilterId, warehouseFilterOptions])

  const isWarehouseChecklistComplete = (order: any) =>
    Boolean(order?.checklistQuantityVerified)

  const mergeOrderState = (orderId: string, updatedOrder: any, fallbackStatus?: string) => {
    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId
          ? {
              ...order,
              ...(updatedOrder || {}),
              status: updatedOrder?.status || fallbackStatus || order.status,
            }
          : order
      )
    )
    setSelectedOrder((prev) =>
      prev && prev.id === orderId
        ? {
            ...prev,
            ...(updatedOrder || {}),
            status: updatedOrder?.status || fallbackStatus || prev.status,
          }
        : prev
    )
  }

  const formatOrderAddress = (order: any) => {
    const address = String(order?.shippingAddress || '').trim()
    const city = String(order?.shippingCity || '').trim()
    const province = String(order?.shippingProvince || '').trim()
    const zipCode = String(order?.shippingZipCode || '').trim()

    const normalize = (value: string) =>
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim()

    const addressTokens = address
      .split(',')
      .map((token: string) => token.trim())
      .filter(Boolean)

    const existingTokenSet = new Set(addressTokens.map((token: string) => normalize(token)))
    const extras = [city, province, zipCode].filter((part) => {
      if (!part) return false
      const key = normalize(part)
      if (!key) return false
      if (existingTokenSet.has(key)) return false
      existingTokenSet.add(key)
      return true
    })

    const combined = [address, ...extras].filter(Boolean).join(', ')
    return combined || 'N/A'
  }

  const updateOrderStatus = async (
    orderId: string,
    status: 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED',
    reason?: string
  ) => {
    setUpdatingOrderId(orderId)
    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reason }),
      })
      const responseText = await response.text()
      let payload: any = {}
      if (responseText) {
        try {
          payload = JSON.parse(responseText)
        } catch {
          payload = { raw: responseText }
        }
      }
      if (!response.ok || payload?.success === false) {
        const backendError =
          payload?.error ||
          payload?.message ||
          (typeof payload?.raw === 'string' ? payload.raw.replace(/<[^>]*>/g, ' ').trim().slice(0, 180) : '')
        throw new Error(
          backendError
            ? `Failed to update status (HTTP ${response.status}): ${backendError}`
            : `Failed to update status (HTTP ${response.status})`
        )
      }

      const updatedOrder = payload?.order
      mergeOrderState(orderId, updatedOrder, status)
      emitDataSync(['orders', 'trips'])
      toast.success('Order status updated')
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update order status')
      return false
    } finally {
      setUpdatingOrderId(null)
    }
  }

  const updateWarehouseStage = async (
    orderId: string,
    stage: 'READY_TO_LOAD' | 'LOADED' | 'DISPATCHED',
    payload: {
      quantityVerified?: boolean
    } = {}
  ) => {
    setUpdatingOrderId(orderId)
    try {
      const response = await fetch(`/api/orders/${orderId}/warehouse-stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseStage: stage,
          checklist: {
            quantityVerified: payload.quantityVerified,
          },
        }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error || 'Failed to update warehouse stage')
      }

      mergeOrderState(orderId, result?.order)
      emitDataSync(['orders', 'trips'])
      toast.success(result?.message || `Warehouse stage moved to ${stage.replace(/_/g, ' ')}`)
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update warehouse stage')
      return false
    } finally {
      setUpdatingOrderId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-gray-500">Manage customer orders and fulfillment</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
            <select
              aria-label="Filter orders by warehouse"
              title="Filter by warehouse"
              value={warehouseFilterId}
              onChange={(event) => setWarehouseFilterId(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
            >
              <option value="all">All warehouses</option>
              {warehouseFilterOptions.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter orders by status"
              value={orderStatusFilter}
              onChange={(event) => setOrderStatusFilter(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
            >
              <option value="all">All statuses</option>
              {orderStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter orders by date range"
              value={orderDatePreset}
              onChange={(event) => setOrderDatePreset(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
            >
              <option value="all">All dates</option>
              <option value="past_7_days">Past 7 days</option>
              <option value="past_14_days">Past 14 days</option>
              <option value="past_1_month">Past 1 month</option>
              <option value="past_3_months">Past 3 months</option>
              <option value="past_6_months">Past 6 months</option>
              <option value="past_1_year">Past 1 year</option>
              <option value="custom">Custom date</option>
            </select>
            <Input
              type="date"
              value={orderCustomDateFilter}
              onChange={(event) => setOrderCustomDateFilter(event.target.value)}
              disabled={orderDatePreset !== 'custom'}
              className="h-10"
            />
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="Min price"
              value={orderMinPriceFilter}
              onChange={(event) => setOrderMinPriceFilter(event.target.value)}
              className="h-10"
            />
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="Max price"
              value={orderMaxPriceFilter}
              onChange={(event) => setOrderMaxPriceFilter(event.target.value)}
              className="h-10"
            />
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={() => {
                setWarehouseFilterId('all')
                setOrderStatusFilter('all')
                setOrderDatePreset('all')
                setOrderCustomDateFilter('')
                setOrderMinPriceFilter('')
                setOrderMaxPriceFilter('')
              }}
            >
              Reset Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12">
              {/* <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" /> */}
              <p className="text-gray-500">No orders found</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No orders match the selected filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">ORDER ID</th>
                    <th className="text-left p-4 font-medium text-gray-600">CUSTOMER</th>
                    <th className="text-left p-4 font-medium text-gray-600">PRODUCTS</th>
                    <th className="text-left p-4 font-medium text-gray-600">WAREHOUSE</th>
                    <th className="text-left p-4 font-medium text-gray-600">DELIVERY</th>
                    <th className="text-left p-4 font-medium text-gray-600">VALUE</th>
                    <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order: any) => (
                    <tr key={order.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {/* <Package className="h-4 w-4 text-gray-400" /> */}
                          <span className="font-semibold text-gray-900">{order.orderNumber}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="font-semibold text-gray-900">{order.customer?.name || order.shippingName || 'N/A'}</p>
                        <p className="text-sm text-gray-500">{order.shippingCity || order.shippingProvince || 'N/A'}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-medium text-gray-900">
                          {toArray<any>(order.items)
                            .slice(0, 2)
                            .map((item) => `${item.product?.name || 'Product'} x${item.quantity}`)
                            .join(', ') || 'No items'}
                          {Number(order.itemCount || toArray<any>(order.items).length) > 2
                            ? ` +${Number(order.itemCount || toArray<any>(order.items).length) - 2} more`
                            : ''}
                        </p>
                        <p className="text-sm text-gray-500">
                          {order.priority === 'high' || order.priority === 'urgent' ? 'Express' : 'Standard'}
                        </p>
                      </td>
                      <td className="p-4">
                        <p className="font-medium text-gray-900">{order.warehouseName || order.warehouseCode || 'Unassigned'}</p>
                        <p className="text-sm text-gray-500">{order.warehouseCity || order.warehouseProvince || 'N/A'}</p>
                      </td>
                      <td className="p-4 text-gray-600">
                        {order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 font-semibold text-gray-900">{formatPeso(order.totalAmount || 0)}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            onClick={() => void openOrderDetail(order)}
                            title="View order progress"
                          >
                            <Eye className="h-4 w-4" />
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

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="flex max-h-[90vh] w-[92vw] max-w-3xl flex-col overflow-hidden">
          {selectedOrder && (
            <>
              <DialogHeader className="shrink-0">
                <DialogTitle>Order Progress - {selectedOrder.orderNumber}</DialogTitle>
              </DialogHeader>
              <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-gray-500">Order Status</p>
                  <p className="font-semibold">{formatOrderStatus(selectedOrder.status, selectedOrder.paymentStatus)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-gray-500">Warehouse Stage</p>
                  <p className="font-semibold">{formatWarehouseStage(selectedOrder.warehouseStage)}</p>
                  {selectedOrder.isDriverAssigned ? (
                    <p className="text-xs text-gray-600">
                      Driver: {selectedOrder.assignedDriverName || 'Assigned'}
                    </p>
                  ) : (
                    <div className="mt-2 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 shadow-[0_6px_14px_rgba(239,68,68,0.14)]">
                      Driver not assigned
                    </div>
                  )}
                  {(selectedOrder.exceptionHoldReason || selectedOrder.exceptionShortLoadQty || selectedOrder.exceptionDamagedOnLoadingQty) ? (
                    <p className="text-xs text-red-600">
                      Exceptions: short load {Number(selectedOrder.exceptionShortLoadQty || 0)}, damaged {Number(selectedOrder.exceptionDamagedOnLoadingQty || 0)}
                      {selectedOrder.exceptionHoldReason ? `, hold: ${selectedOrder.exceptionHoldReason}` : ''}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-md border p-3 space-y-1">
                  <p className="font-medium">Client Information</p>
                  <p className="text-sm text-gray-700">{selectedOrder.customer?.name || selectedOrder.shippingName || 'N/A'}</p>
                  <p className="text-sm text-gray-600">{selectedOrder.customer?.email || 'N/A'}</p>
                  <p className="text-sm text-gray-600">{selectedOrder.shippingPhone || selectedOrder.customer?.phone || 'N/A'}</p>
                  <p className="text-sm text-gray-600">
                    {formatOrderAddress(selectedOrder)}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="font-medium mb-2">Order Details</p>
                  <div className="space-y-1">
                    {(selectedOrder.items || []).map((item: any) => (
                      <div key={item.id} className="flex justify-between gap-3 text-sm">
                        <div>
                          <p>{item.product?.name || 'Product'} x{item.quantity}</p>
                          {item.spareProducts ? (
                            <div className="mt-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                              <p>Spare products: {Number(item.spareProducts.recommendedQuantity || 0)}</p>
                              <p>Total load {Number(item.spareProducts.totalLoadQuantity || item.quantity || 0)} | Policy {Number(item.spareProducts.minPercent || 0)}-{Number(item.spareProducts.maxPercent || 0)}%</p>
                            </div>
                          ) : null}
                        </div>
                        <span>{formatPeso((item.totalPrice ?? item.quantity * item.unitPrice) || 0)}</span>
                      </div>
                    ))}
                    <p className="text-right font-semibold pt-2">Total: {formatPeso(selectedOrder.totalAmount || 0)}</p>
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-medium">Progress</p>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                      {selectedOrder.progress?.dropPoint?.status
                        ? String(selectedOrder.progress.dropPoint.status).replace(/_/g, ' ')
                        : 'No trip progress yet'}
                    </span>
                  </div>
                  <div className="space-y-1 text-sm text-gray-700">
                    <p>Trip: {selectedOrder.progress?.trip?.tripNumber || 'Not assigned yet'}</p>
                    <p>Driver: {selectedOrder.progress?.trip?.driver?.user?.name || selectedOrder.assignedDriverName || 'Not assigned yet'}</p>
                    <p>Vehicle: {selectedOrder.progress?.trip?.vehicle?.licensePlate || 'Not assigned yet'}</p>
                    <p>
                      Drop Point Status: {selectedOrder.progress?.dropPoint?.status
                        ? String(selectedOrder.progress.dropPoint.status).replace(/_/g, ' ')
                        : 'Pending'}
                    </p>
                    <p>
                      Arrival: {selectedOrder.progress?.pod?.actualArrival ? new Date(selectedOrder.progress.pod.actualArrival).toLocaleString() : 'N/A'}
                    </p>
                    <p>
                      Departure: {selectedOrder.progress?.pod?.actualDeparture ? new Date(selectedOrder.progress.pod.actualDeparture).toLocaleString() : 'N/A'}
                    </p>
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <p className="mb-2 font-medium">Proof Of Delivery</p>
                  {selectedOrder.progress?.pod?.deliveryPhoto ? (
                    <img
                      src={selectedOrder.progress.pod.deliveryPhoto}
                      alt="Proof of delivery"
                      className="mt-3 h-56 w-full rounded-md border border-slate-200 object-cover"
                    />
                  ) : (
                    <p className="mt-3 text-sm text-gray-500">No POD uploaded yet.</p>
                  )}
                </div>
                <div className="sticky bottom-0 bg-white pb-1 pt-1">
                  <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setSelectedOrder(null)} className="flex-1">
                    Close
                  </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={loadChecklistOpen} onOpenChange={setLoadChecklistOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Checklist</DialogTitle>
            <DialogDescription>Complete every product before marking this order as loaded.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
                  <div className="space-y-2 text-sm">
                    {(selectedOrder?.items || []).map((item: any) => (
                      <label key={item.id} className="flex items-center gap-3 rounded border p-3">
                        <input
                          type="checkbox"
                    checked={Boolean(loadChecklist[String(item.id)])}
                    onChange={(event) =>
                      setLoadChecklist((prev) => ({
                        ...prev,
                        [String(item.id)]: event.target.checked,
                            }))
                          }
                        />
                        <div>
                          <p>{item.product?.name || 'Product'} x{item.quantity}</p>
                          {item.spareProducts ? (
                            <div className="mt-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                              <p>Spare products: {Number(item.spareProducts.recommendedQuantity || 0)}</p>
                              <p>Total load {Number(item.spareProducts.totalLoadQuantity || item.quantity || 0)}</p>
                            </div>
                          ) : null}
                        </div>
                      </label>
                    ))}
                  </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setLoadChecklistOpen(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-amber-600 hover:bg-amber-700"
                onClick={async () => {
                  if (!selectedOrder?.id) return
                  if (!selectedOrder.isDriverAssigned) {
                    toast.error('Assign this order to a driver first.')
                    return
                  }
                  const checklistEntries = Object.values(loadChecklist)
                  if (checklistEntries.length === 0 || checklistEntries.some((value) => !value)) {
                    toast.error('Complete the checklist first.')
                    return
                  }
                  const done = await updateWarehouseStage(selectedOrder.id, 'LOADED', {
                    quantityVerified: true,
                  })
                  if (done) {
                    setLoadChecklistOpen(false)
                  }
                }}
                disabled={updatingOrderId === selectedOrder?.id}
              >
                Confirm Loaded
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectOrder} onOpenChange={(open) => !open && setRejectOrder(null)}>
        <DialogContent>
          {rejectOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Reject Order</DialogTitle>
                <DialogDescription>Please provide a reason for rejecting order {rejectOrder.orderNumber}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Rejection Reason</label>
                <textarea
                  className="w-full min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="Enter rejection reason..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setRejectOrder(null)}>
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 bg-red-600 hover:bg-red-700"
                    onClick={async () => {
                      if (!rejectReason.trim()) {
                        toast.error('Rejection reason is required')
                        return
                      }
                      if (!['PREPARING'].includes(rejectOrder.status)) {
                        toast.error('You can only update eligible delivery orders')
                        return
                      }
                      await updateOrderStatus(rejectOrder.id, 'PREPARING', rejectReason.trim())
                      setRejectOrder(null)
                    }}
                    disabled={updatingOrderId === rejectOrder.id}
                  >
                    Confirm
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
