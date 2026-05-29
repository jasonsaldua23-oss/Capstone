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
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, Clock, CheckCircle, XCircle, MapPin, TrendingUp, UserCheck, MessageSquare, AlertTriangle, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, Database, FileText, Users, Star, Download, Pencil, Trash2, ClipboardList, User, Mail, Phone, PackageCheck, Route, Car, CalendarClock, Camera } from 'lucide-react'
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
  deriveOrderFulfillmentSummary,
} from './shared'
import { CompactDiscountLine } from '@/components/shared/compact-discount-line'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function OrdersView({ onOpenTransportation, globalSearchQuery = '' }: { onOpenTransportation?: () => void; globalSearchQuery?: string } = {}) {
  const ORDERS_CACHE_KEY = 'admin_orders_cache_v2'
  const [orders, setOrders] = useState<any[]>([])
  const [warehouseDirectory, setWarehouseDirectory] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [orderDetailsById, setOrderDetailsById] = useState<Record<string, any>>({})
  const hydrationInFlightRef = useRef<Record<string, boolean>>({})
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
  const [orderSearchQuery, setOrderSearchQuery] = useState('')
  const latestOrderMarkerRef = useRef('')
  const latestOrderUpdatedAtRef = useRef('')

  useEffect(() => {
    setOrderSearchQuery(String(globalSearchQuery || ''))
  }, [globalSearchQuery])

  const getItemSizeLabel = (item: any): string => {
    const fromProductSizes = Array.isArray(item?.product?.sizes) ? item.product.sizes.filter(Boolean) : []
    if (fromProductSizes.length > 0) return fromProductSizes.map((v: any) => String(v).trim()).filter(Boolean).join(' ')
    const fromUnit = String(item?.product?.unit || item?.productUnit || '').trim()
    return fromUnit
  }

  const formatOrderItemPreview = (item: any): string => {
    const name = String(item?.product?.name || item?.productName || 'Product').trim()
    const size = getItemSizeLabel(item)
    const qty = Number(item?.quantity || 0)
    const normalizedSize = size.trim()
    const sizeSuffix = !normalizedSize
      ? ''
      : /[()]/.test(normalizedSize)
        ? ` ${normalizedSize}`
        : ` (${normalizedSize})`
    return `${name}${sizeSuffix} x${qty}`
  }

  const isReplacementOrder = (order: any): boolean => {
    const orderNumber = String(order?.orderNumber || order?.order_number || '').trim().toUpperCase()
    return Boolean(order?.isScheduledReplacement) || orderNumber.startsWith('RPL-')
  }

  useEffect(() => {
    let isMounted = true
    let isFetchingOrders = false

    const loadCachedOrders = () => {
      try {
        const raw = localStorage.getItem(ORDERS_CACHE_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw)
        const cached = Array.isArray(parsed) ? parsed : []
        if (cached.length > 0 && isMounted) {
          setOrders(cached)
          latestOrderUpdatedAtRef.current = getMaxUpdatedAt(cached)
        }
      } catch {
        // ignore corrupted cache
      }
    }

    const saveCachedOrders = (rows: any[]) => {
      try {
        localStorage.setItem(ORDERS_CACHE_KEY, JSON.stringify(rows))
      } catch {
        // best effort only
      }
    }

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

    const fetchWarehouses = async () => {
      const result = await safeFetchJson('/api/warehouses?page=1&pageSize=200', { cache: 'no-store' }, { retries: 2, timeoutMs: 12000 })
      if (!result.ok) return
      const list = getCollection<any>(result.data, ['warehouses'])
      if (isMounted) {
        setWarehouseDirectory(list.filter((warehouse) => warehouse?.isActive !== false))
      }
    }

    async function fetchOrdersFull(silent = false) {
      if (isFetchingOrders) return
      isFetchingOrders = true
      try {
        const result = await fetchAllPaginatedCollection<any>(
          '/api/orders?includeItems=preview&includeFulfillments=true&includeWarehouseAllocations=true',
          'orders',
          { cache: 'no-store' },
          { retries: 3, timeoutMs: 15000, pageSize: 200, maxPages: 100 }
        )

        if (!result.ok) {
          // Fallback: try a simpler single-page request before failing.
          const fallback = await safeFetchJson('/api/orders?page=1&pageSize=200&includeFulfillments=true&includeWarehouseAllocations=true', { cache: 'no-store' }, { retries: 2, timeoutMs: 12000 })
          if (fallback.ok && isMounted) {
            const fallbackOrders = getCollection<any>(fallback.data, ['orders'])
            if (fallbackOrders.length > 0) {
              setOrders(fallbackOrders)
              latestOrderUpdatedAtRef.current = getMaxUpdatedAt(fallbackOrders)
              saveCachedOrders(fallbackOrders)
              return
            }
          }

          if (result.status === 401 || result.status === 403) {
            clearTabAuthToken()
          }
          // Keep current/cached orders visible instead of clearing table.
          if (!silent) {
            console.error('Failed to fetch orders:', result.data?.error || 'Request failed')
          }
          return
        }

        if (isMounted) {
          const fullOrders = getCollection<any>(result.data, ['orders'])
          setOrders(fullOrders)
          latestOrderUpdatedAtRef.current = getMaxUpdatedAt(fullOrders)
          saveCachedOrders(fullOrders)
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
          includeFulfillments: 'true',
          includeWarehouseAllocations: 'true',
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

    loadCachedOrders()
    void fetchWarehouses()
    void fetchOrdersFull()

    const unsubscribe = subscribeDataSync((message) => {
      if (message.scopes.includes('orders') || message.scopes.includes('trips')) {
        void fetchOrdersFull(true)
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
    return () => {
      isMounted = false
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const openOrderDetail = async (order: any) => {
    setSelectedOrder(order)
    setLoadingOrderDetail(true)
    try {
      const response = await fetch(`/api/orders/${order.id}`, { credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false || !payload?.order) return
      const fullOrder = payload.order
      setSelectedOrder(fullOrder)
      if (fullOrder?.id) {
        setOrderDetailsById((prev) => ({ ...prev, [String(fullOrder.id)]: fullOrder }))
        setOrders((prev) => prev.map((row) => (String(row?.id) === String(fullOrder.id) ? { ...row, ...fullOrder } : row)))
      }
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

  const getDisplayOrderStatus = (order: any) => {
    const summary = deriveOrderFulfillmentSummary(order)
    if (summary.totalLegs > 1) {
      if (summary.fulfillmentStatus === 'PARTIALLY_FULFILLED') return 'PARTIALLY FULFILLED'
      if (summary.fulfillmentStatus === 'FULFILLED') return 'FULFILLED'
      if (summary.fulfillmentStatus === 'IN_PROGRESS') return 'IN PROGRESS'
    }
    return formatOrderStatus(order?.status, order?.paymentStatus)
  }
  const getOrderStatusTextClass = (status: string) => {
    const value = String(status || '').trim().toUpperCase()
    if (value === 'PENDING') return 'text-yellow-700'
    if (value === 'PREPARING') return 'text-lime-700'
    if (value === 'CANCELLED') return 'text-red-700'
    if (value === 'DELIVERED') return 'text-emerald-700'
    return 'text-slate-700'
  }
  const getOrderStatusBadgeClass = (status: string) => {
    const value = String(status || '').trim().toUpperCase()
    if (value === 'PENDING') return 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100'
    if (value === 'PREPARING') return 'bg-lime-100 text-lime-800 hover:bg-lime-100'
    if (value === 'CANCELLED') return 'bg-red-100 text-red-700 hover:bg-red-100'
    if (value === 'DELIVERED') return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
    return 'bg-slate-100 text-slate-700 hover:bg-slate-100'
  }

  const getOrderWarehouseMeta = (order: any) => {
    const idSet = new Set<string>()
    const nameSet = new Set<string>()

    const add = (idLike: unknown, nameLike: unknown) => {
      const id = String(idLike || '').trim()
      const name = String(nameLike || '').trim()
      if (id) idSet.add(id)
      if (name && name.toLowerCase() !== 'unassigned') nameSet.add(name)
    }
    const parseMaybeList = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean)
      if (typeof value !== 'string') return []
      const raw = value.trim()
      if (!raw) return []
      if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) return parsed.map((entry) => String(entry || '').trim()).filter(Boolean)
        } catch {
          // fallback to csv
        }
      }
      return raw.split(',').map((entry) => entry.trim()).filter(Boolean)
    }

    const summary = deriveOrderFulfillmentSummary(order)
    summary.legs.forEach((leg: any) => add(leg?.warehouseId, leg?.warehouseName))

    add(order?.warehouseId ?? order?.warehouse_id, order?.warehouseName ?? order?.warehouseCode)

    parseMaybeList(order?.warehouseIds).forEach((id) => add(id, ''))
    toArray<any>(order?.warehouses).forEach((warehouse) =>
      add(warehouse?.id ?? warehouse?.warehouseId ?? warehouse?.warehouse_id, warehouse?.name ?? warehouse?.code ?? warehouse?.warehouseName)
    )
    toArray<any>(order?.allocations).forEach((allocation) =>
      add(allocation?.warehouseId ?? allocation?.warehouse_id ?? allocation?.warehouse?.id, allocation?.warehouseName ?? allocation?.warehouse?.name ?? allocation?.warehouse?.code)
    )
    toArray<any>(order?.warehouseAllocations).forEach((allocation) =>
      add(allocation?.warehouseId ?? allocation?.warehouse_id ?? allocation?.warehouse?.id, allocation?.warehouseName ?? allocation?.warehouse?.name ?? allocation?.warehouse?.code)
    )

    toArray<any>(order?.items).forEach((item) => {
      add(item?.warehouseId ?? item?.warehouse_id ?? item?.warehouse?.id, item?.warehouseName ?? item?.warehouse?.name ?? item?.warehouse?.code)
      toArray<any>(item?.allocations).forEach((allocation) =>
        add(allocation?.warehouseId ?? allocation?.warehouse_id ?? allocation?.warehouse?.id, allocation?.warehouseName ?? allocation?.warehouse?.name ?? allocation?.warehouse?.code)
      )
      toArray<any>(item?.warehouseAllocations).forEach((allocation) =>
        add(allocation?.warehouseId ?? allocation?.warehouse_id ?? allocation?.warehouse?.id, allocation?.warehouseName ?? allocation?.warehouse?.name ?? allocation?.warehouse?.code)
      )
    })

    const ids = Array.from(idSet.values())
    const names = Array.from(nameSet.values())
    return { ids, names, hasMultipleWarehouses: ids.length > 1 || names.length > 1 }
  }

  const getOrderWarehouseIds = (order: any): string[] => {
    const meta = getOrderWarehouseMeta(order)
    if (meta.ids.length > 0) return meta.ids
    const fallbackId = String(getWarehouseIdFromRow(order) || '').trim()
    return fallbackId ? [fallbackId] : []
  }

  const getOrderWarehouseNames = (order: any): string[] => {
    const meta = getOrderWarehouseMeta(order)
    if (meta.names.length > 0) return meta.names
    const fallbackName = String(order?.warehouseName || order?.warehouseCode || '').trim()
    return fallbackName ? [fallbackName] : []
  }

  const needsWarehouseHydration = (order: any) => {
    const meta = getOrderWarehouseMeta(order)
    if (meta.ids.length > 0 || meta.names.length > 0) return false
    const key = String(order?.id || '')
    if (!key) return false
    return !orderDetailsById[key]
  }

  const warehouseFilterOptions = useMemo(() => {
    const map = new Map<string, string>()
    warehouseDirectory.forEach((warehouse) => {
      const warehouseId = String(warehouse?.id || '').trim()
      if (!warehouseId) return
      const label = String(warehouse?.name || warehouse?.code || warehouseId).trim()
      if (!map.has(warehouseId)) {
        map.set(warehouseId, label)
      }
    })
    orders.forEach((order) => {
      if (isReplacementOrder(order)) return
      const summary = deriveOrderFulfillmentSummary(order)
      summary.legs.forEach((leg: any) => {
        const warehouseId = String(leg?.warehouseId || '').trim()
        if (!warehouseId) return
        const label =
          String(leg?.warehouseName || '').trim() ||
          String(order?.warehouseName || '').trim() ||
          String(order?.warehouseCode || '').trim() ||
          warehouseId
        if (!map.has(warehouseId)) {
          map.set(warehouseId, label)
        }
      })
      const meta = getOrderWarehouseMeta(order)
      meta.ids.forEach((warehouseId) => {
        if (!warehouseId) return
        if (!map.has(warehouseId)) {
          const fallbackLabel = meta.names[0] || warehouseId
          map.set(warehouseId, fallbackLabel)
        }
      })
    })
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [orders, warehouseDirectory])

  const orderStatusOptions = useMemo(() => {
    const statuses = new Set<string>()
    statuses.add('PARTIALLY FULFILLED')
    orders.forEach((order) => {
      if (isReplacementOrder(order)) return
      statuses.add(getDisplayOrderStatus(order))
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
      if (isReplacementOrder(order)) return false

      const search = orderSearchQuery.trim().toLowerCase()
      if (search) {
        const haystack = [
          order?.orderNumber,
          order?.customer?.name,
          order?.customer?.email,
          order?.shippingName,
          order?.shippingCity,
          order?.shippingProvince,
          order?.shippingPhone,
        ]
          .map((value) => String(value || '').toLowerCase())
          .join(' ')
        if (!haystack.includes(search)) return false
      }

      if (warehouseFilterId !== 'all') {
        const warehouseIds = getOrderWarehouseIds(order)
        if (!warehouseIds.includes(warehouseFilterId)) return false
      }

      const normalizedStatus = getDisplayOrderStatus(order)
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
  }, [orders, warehouseFilterId, orderStatusFilter, orderDatePreset, orderCustomDateFilter, orderMinPriceFilter, orderMaxPriceFilter, orderSearchQuery])

  const fulfillmentAlerts = useMemo(() => {
    let unallocated = 0
    let missingTrips = 0
    let splitOrders = 0
    filteredOrders.forEach((order) => {
      const summary = deriveOrderFulfillmentSummary(order)
      if (summary.needsSplit) splitOrders += 1
      if (summary.unassignedTripCount > 0) missingTrips += 1
      const allocated = summary.legs.reduce((sum: number, leg: any) => sum + Number(leg.allocatedQty || 0), 0)
      const required = toArray<any>(order.items).reduce((sum: number, item: any) => sum + Number(item?.quantity || 0), 0)
      if (allocated < required) unallocated += 1
    })
    return { unallocated, missingTrips, splitOrders }
  }, [filteredOrders])

  useEffect(() => {
    const candidates = orders
      .filter((order) => needsWarehouseHydration(order))
      .slice(0, 8)

    if (candidates.length === 0) return

    candidates.forEach((order) => {
      const id = String(order?.id || '')
      if (!id || hydrationInFlightRef.current[id]) return
      hydrationInFlightRef.current[id] = true

      void (async () => {
        try {
          const response = await fetch(`/api/orders/${id}`, { credentials: 'include', cache: 'no-store' })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok || payload?.success === false || !payload?.order) return
          const fullOrder = payload.order
          const fullId = String(fullOrder?.id || id)
          setOrderDetailsById((prev) => ({ ...prev, [fullId]: fullOrder }))
          setOrders((prev) => prev.map((row) => (String(row?.id) === fullId ? { ...row, ...fullOrder } : row)))
        } catch {
          // best effort enrichment only
        } finally {
          hydrationInFlightRef.current[id] = false
        }
      })()
    })
  }, [orders, orderDetailsById])

  useEffect(() => {
    if (warehouseFilterId === 'all') return
    const exists = warehouseFilterOptions.some((warehouse) => warehouse.id === warehouseFilterId)
    if (!exists) {
      setWarehouseFilterId('all')
    }
  }, [warehouseFilterId, warehouseFilterOptions])

  const isWarehouseChecklistComplete = (order: any) =>
    ['LOADED', 'DISPATCHED'].includes(String(order?.warehouseStage || '').toUpperCase())

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
    status: 'PREPARING' | 'RESCHEDULED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'REJECTED',
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
    stage: 'READY_TO_LOAD' | 'LOADED' | 'DISPATCHED'
  ) => {
    setUpdatingOrderId(orderId)
    try {
      const response = await fetch(`/api/orders/${orderId}/warehouse-stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseStage: stage,
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
          <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-gray-700">View customer purchase orders and fulfillment status</p>
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
        <CardHeader className="pb-0">
          <CardTitle className="text-base">Purchase Orders</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <PortalTableSkeleton rows={6} columns={6} className="border-0 shadow-none" />
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
                    <th className="text-left p-4 font-semibold text-gray-800">ORDER ID</th>
                    <th className="text-left p-4 font-semibold text-gray-800">CUSTOMER</th>
                    <th className="text-left p-4 font-semibold text-gray-800">WAREHOUSE</th>
                    <th className="text-left p-4 font-semibold text-gray-800">DELIVERY DATE</th>
                    <th className="text-left p-4 font-semibold text-gray-800">VALUE</th>
                    <th className="text-left p-4 font-semibold text-gray-800">STATUS</th>
                    <th className="text-left p-4 font-semibold text-gray-800">Actions</th>
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
                        <p className="text-sm text-gray-700">{order.shippingCity || order.shippingProvince || 'N/A'}</p>
                      </td>
                      <td className="p-4">
                        {(() => {
                          const enrichedOrder =
                            orderDetailsById[String(order.id)] ||
                            (selectedOrder?.id === order.id ? selectedOrder : null) ||
                            order
                          const summary = deriveOrderFulfillmentSummary(enrichedOrder)
                          const warehouseMeta = getOrderWarehouseMeta(enrichedOrder)
                          const warehouseNames = getOrderWarehouseNames(enrichedOrder)
                          const warehouseText = warehouseNames.length > 0
                            ? warehouseNames.slice(0, 2).join(', ')
                            : warehouseMeta.hasMultipleWarehouses
                              ? 'Multiple warehouses'
                              : 'Pending warehouse allocation'
                          const extraWarehouseCount = warehouseNames.length > 2 ? warehouseNames.length - 2 : 0
                          return (
                            <div className="space-y-1">
                              <p className="font-medium text-gray-900">
                                {warehouseText}
                                {extraWarehouseCount > 0 ? ` +${extraWarehouseCount} more` : ''}
                              </p>
                              {summary.totalLegs > 1 && (
                                <p className="text-xs text-gray-700">
                                  Legs: {summary.deliveredLegs}/{summary.totalLegs} delivered
                                  {summary.unassignedTripCount > 0 ? ` | ${summary.unassignedTripCount} without trip` : ''}
                                  {!warehouseMeta.hasMultipleWarehouses && warehouseNames.length === 0 ? ' | awaiting warehouse assignment' : ''}
                                </p>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="p-4 text-gray-600">
                        {order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString() : new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 font-semibold text-gray-900">{formatPeso(order.totalAmount || 0)}</td>
                      <td className="p-4">
                        {(() => {
                          const displayStatus = getDisplayOrderStatus(order)
                          return <Badge className={getOrderStatusBadgeClass(displayStatus)}>{displayStatus}</Badge>
                        })()}
                      </td>
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
        <DialogContent className="flex max-h-[92vh] w-[95vw] max-w-[980px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
          {selectedOrder && (
            <>
              <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-4 sm:px-7">
                <DialogTitle className="flex items-center gap-3 text-[0.98rem] font-bold tracking-tight text-slate-900 sm:text-[1.3rem]">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100 sm:h-11 sm:w-11">
                    <ClipboardList className="h-5 w-5 sm:h-6 sm:w-6" />
                  </span>
                  <span>Order Progress - {selectedOrder.orderNumber}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-7 sm:py-6">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/45 p-3.5 sm:p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-600">Order Status</p>
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700 sm:h-11 sm:w-11">
                        <Truck className="h-5 w-5" />
                      </div>
                    </div>
                    {(() => {
                      const displayStatus = getDisplayOrderStatus(selectedOrder)
                      return (
                        <p className={`text-[0.8rem] font-bold leading-tight sm:text-[0.98rem] ${getOrderStatusTextClass(displayStatus)}`}>
                          {displayStatus}
                        </p>
                      )
                    })()}
                  </div>
                  <div className="rounded-2xl border border-blue-200 bg-blue-50/45 p-3.5 sm:p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-600">Warehouse Stage</p>
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-blue-100 text-blue-700 sm:h-11 sm:w-11">
                        <Building2 className="h-5 w-5" />
                      </div>
                    </div>
                    <p className="text-[0.8rem] font-bold leading-tight text-blue-700 sm:text-[0.98rem]">{formatWarehouseStage(selectedOrder.warehouseStage)}</p>
                    {selectedOrder.isDriverAssigned ? (
                      <p className="mt-1 text-sm text-slate-700">
                        Driver: {selectedOrder.assignedDriverName || 'Assigned'}
                      </p>
                    ) : (
                      <div className="mt-2 inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                        Driver not assigned
                      </div>
                    )}
                  </div>
                </div>

                {(() => {
                  const summary = deriveOrderFulfillmentSummary(selectedOrder)
                  const isMultiWarehouse = summary.totalLegs > 1
                  if (!isMultiWarehouse) return null
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                      <p className="mb-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">Fulfillment Legs</p>
                      <div className="space-y-2">
                        {summary.legs.map((leg: any) => (
                          <div key={leg.id} className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-slate-900">{leg.warehouseName || 'Unassigned Warehouse'}</p>
                              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                                {String(leg.status || 'PENDING').replace(/_/g, ' ')}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">
                              Trip: {leg.tripNumber || leg.tripId || 'Not assigned'}{` | Allocated Qty: ${Number(leg.allocatedQty || 0)}`}
                            </p>
                            {!leg.tripId && !leg.tripNumber ? (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <p className="text-xs font-medium text-amber-700">Needs trip assignment.</p>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 rounded-md px-2 text-[11px]"
                                  onClick={() => {
                                    try {
                                      window.sessionStorage.setItem(
                                        'admin_transport_focus',
                                        JSON.stringify({
                                          orderId: String(selectedOrder?.id || ''),
                                          orderNumber: String(selectedOrder?.orderNumber || ''),
                                          warehouseId: String(leg?.warehouseId || ''),
                                          at: Date.now(),
                                        })
                                      )
                                    } catch {
                                      // best effort only
                                    }
                                    setSelectedOrder(null)
                                    onOpenTransportation?.()
                                  }}
                                >
                                  Open in Transportation
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <p className="mb-3 flex items-center gap-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-indigo-50 text-indigo-600">
                      <User className="h-5 w-5" />
                    </span>
                    Client Information
                  </p>
                  <div className="space-y-2 text-slate-700">
                    <p className="flex items-center gap-3 text-sm sm:text-base"><User className="h-5 w-5 text-slate-500" />{selectedOrder.customer?.name || selectedOrder.shippingName || 'N/A'}</p>
                    <p className="flex items-center gap-3 text-sm text-blue-700 sm:text-base"><Mail className="h-5 w-5 text-slate-500" />{selectedOrder.customer?.email || 'N/A'}</p>
                    <p className="flex items-center gap-3 text-sm sm:text-base"><Phone className="h-5 w-5 text-slate-500" />{selectedOrder.shippingPhone || selectedOrder.customer?.phone || 'N/A'}</p>
                    <p className="flex items-start gap-3 text-sm sm:text-base"><MapPin className="mt-1 h-5 w-5 shrink-0 text-slate-500" />{formatOrderAddress(selectedOrder)}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <p className="mb-3 flex items-center gap-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                      <PackageCheck className="h-5 w-5" />
                    </span>
                    Order Details
                  </p>
                  <div className="space-y-2.5">
                    {(selectedOrder.items || []).map((item: any) => (
                      <div key={item.id} className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                            {item?.product?.imageUrl ? (
                              <img
                                src={String(item.product.imageUrl)}
                                alt={String(item?.product?.name || 'Product')}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <div className="grid h-full w-full place-items-center text-[10px] text-slate-400">No image</div>
                            )}
                          </div>
                          <div className="min-w-0 pt-0.5">
                            <p className="text-sm text-slate-800 sm:text-[1.02rem]">
                              {item.product?.name || 'Product'}
                              {getItemSizeLabel(item) ? ` ${getItemSizeLabel(item)}` : ''}
                              {' '}x{item.quantity}
                            </p>
                            {String(item?.product?.category?.name || item?.product?.category || '').trim() ? (
                              <p className="mt-0.5 text-xs text-slate-500">
                                {String(item?.product?.category?.name || item?.product?.category || '').trim()}
                              </p>
                            ) : null}
                            <CompactDiscountLine
                              value={formatPeso(Number(selectedOrder?.discountDetails?.totalDiscount || selectedOrder?.discount || 0))}
                              percent={(() => {
                                const explicitPercent = Number(selectedOrder?.discountDetails?.percent)
                                if (Number.isFinite(explicitPercent) && explicitPercent > 0) return explicitPercent
                                const subtotal = Number(selectedOrder?.subtotal || 0)
                                const discount = Number(selectedOrder?.discountDetails?.totalDiscount || selectedOrder?.discount || 0)
                                if (subtotal > 0 && discount > 0) return (discount / subtotal) * 100
                                return 0
                              })()}
                              className="mt-1 text-sm font-semibold text-[#2b4f83]"
                            />
                          </div>
                        </div>
                        <span className="pt-1 text-sm font-semibold text-slate-900 sm:text-[1.05rem]">{formatPeso((item.totalPrice ?? item.quantity * item.unitPrice) || 0)}</span>
                      </div>
                    ))}
                    <div className="h-px bg-slate-200" />
                    <p className="text-right text-[1.08rem] font-bold leading-tight text-slate-900 sm:text-[1.35rem]">Total: <span className="text-emerald-700">{formatPeso(selectedOrder.totalAmount || 0)}</span></p>
                  </div>
                </div>

                {(() => {
                  const hasTrip = selectedOrder.progress?.trip || selectedOrder.assignedTripId || selectedOrder.tripId
                  if (!hasTrip) return null
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="flex items-center gap-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-violet-50 text-violet-600">
                            <Clock className="h-5 w-5" />
                          </span>
                          Progress
                        </p>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-700">
                          {selectedOrder.progress?.dropPoint?.status
                            ? String(selectedOrder.progress.dropPoint.status).replace(/_/g, ' ')
                            : 'No trip progress yet'}
                          <CircleCheck className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <div className="space-y-1.5 text-sm text-slate-700 sm:text-base">
                        <p className="flex items-center gap-3"><Route className="h-5 w-5 text-slate-500" />Trip: {selectedOrder.progress?.trip?.tripNumber || 'Not assigned yet'}</p>
                        <p className="flex items-center gap-3"><User className="h-5 w-5 text-slate-500" />Driver: {selectedOrder.progress?.trip?.driver?.user?.name || selectedOrder.assignedDriverName || 'Not assigned yet'}</p>
                        <p className="flex items-center gap-3"><Car className="h-5 w-5 text-slate-500" />Vehicle: {selectedOrder.progress?.trip?.vehicle?.licensePlate || 'Not assigned yet'}</p>
                        <p>
                          <span className="inline-flex items-center gap-3"><MapPin className="h-5 w-5 text-slate-500" />Drop Point Status: {selectedOrder.progress?.dropPoint?.status
                            ? String(selectedOrder.progress.dropPoint.status).replace(/_/g, ' ')
                            : 'Pending'}</span>
                        </p>
                        <p>
                          <span className="inline-flex items-center gap-3"><CalendarClock className="h-5 w-5 text-slate-500" />Arrival: {selectedOrder.progress?.pod?.actualArrival ? new Date(selectedOrder.progress.pod.actualArrival).toLocaleString() : 'N/A'}</span>
                        </p>
                        <p>
                          <span className="inline-flex items-center gap-3"><LogOut className="h-5 w-5 text-slate-500" />Departure: {selectedOrder.progress?.pod?.actualDeparture ? new Date(selectedOrder.progress.pod.actualDeparture).toLocaleString() : 'N/A'}</span>
                        </p>
                      </div>
                    </div>
                  )
                })()}

                {(() => {
                  const hasTrip = selectedOrder.progress?.trip || selectedOrder.assignedTripId || selectedOrder.tripId
                  const orderStatus = String(selectedOrder.status || '').toUpperCase()
                  const dropPointStatus = String(selectedOrder.progress?.dropPoint?.status || '').toUpperCase()
                  const isDelivered = ['DELIVERED', 'COMPLETED', 'FULFILLED'].includes(orderStatus)
                    || ['DELIVERED', 'COMPLETED', 'FULFILLED'].includes(dropPointStatus)
                  if (!hasTrip || !isDelivered) return null
                  return (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                      <p className="mb-3 flex items-center gap-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-50 text-amber-600">
                          <Camera className="h-5 w-5" />
                        </span>
                        Proof Of Delivery
                      </p>
                      {(() => {
                        const podUrl = String(
                          selectedOrder.progress?.pod?.deliveryPhoto ||
                          selectedOrder.deliveryPhoto ||
                          selectedOrder.deliveryProofUrl ||
                          selectedOrder.proofOfDeliveryUrl ||
                          ''
                        ).trim()
                        if (!podUrl) return <p className="mt-1 text-base italic text-slate-500">No POD uploaded yet.</p>
                        return (
                          <img
                            src={podUrl}
                            alt="Proof of delivery"
                            className="mt-2 h-64 w-full rounded-xl border border-slate-200 object-cover"
                          />
                        )
                      })()}
                    </div>
                  )
                })()}

                <div className="bg-white py-1">
                  <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setSelectedOrder(null)} className="h-11 flex-1 rounded-xl text-lg font-semibold">
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
                          <p>
                            {item.product?.name || 'Product'}
                            {getItemSizeLabel(item) ? ` ${getItemSizeLabel(item)}` : ''}
                            {' '}x{item.quantity}
                          </p>
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
                  const done = await updateWarehouseStage(selectedOrder.id, 'LOADED')
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
                      const orderStatus = String(rejectOrder?.status || '').toUpperCase()
                      const paymentStatus = String(rejectOrder?.paymentStatus || '').toLowerCase()
                      const canReject = paymentStatus === 'pending_approval' || orderStatus === 'PENDING'
                      if (!canReject) {
                        toast.error('Only not-yet-approved orders can be rejected')
                        return
                      }
                      await updateOrderStatus(rejectOrder.id, 'REJECTED', rejectReason.trim())
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
