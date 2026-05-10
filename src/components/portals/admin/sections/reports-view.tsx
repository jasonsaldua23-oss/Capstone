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
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, LineChart, Line, Tooltip, Cell, BarChart, Bar, ResponsiveContainer, Legend, ScatterChart, Scatter, ZAxis, LabelList } from 'recharts'
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

export function ReportsView() {
  const { user } = useAuth()
  const [activeReportTab, setActiveReportTab] = useState('orders')
  const [rangeDays, setRangeDays] = useState<'7' | '30' | '90'>('30')
  const [selectedWarehouse, setSelectedWarehouse] = useState('all')
  const [selectedDriver, setSelectedDriver] = useState('all')
  const [selectedOrderStatus, setSelectedOrderStatus] = useState('all')
  const [selectedTripStatus, setSelectedTripStatus] = useState('all')
  const [selectedMovementType, setSelectedMovementType] = useState('all')
  const [selectedReplacementStatus, setSelectedReplacementStatus] = useState('all')
  const [selectedFeedbackStatus, setSelectedFeedbackStatus] = useState('all')
  const [isLoading, setIsLoading] = useState(true)
  const [orders, setOrders] = useState<any[]>([])
  const [trips, setTrips] = useState<any[]>([])
  const [drivers, setDrivers] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [inventory, setInventory] = useState<any[]>([])
  const [inventoryTransactions, setInventoryTransactions] = useState<any[]>([])
  const [replacementsData, setReplacementsData] = useState<any[]>([])
  const [feedback, setFeedback] = useState<any[]>([])
  const reportBranding = {
    companyName: "Ann Ann's Beverages Trading",
    subtitle: 'Logistics Management System - Report Pack',
    preparedBy: String(user?.name || user?.email || 'System Administrator'),
  }
  useEffect(() => {
    let isMounted = true

    async function fetchReportsPack() {
      setIsLoading(true)
      try {
        const [ordersRes, tripsRes, driversRes, warehousesRes, inventoryRes, transactionsRes, replacementsRes, feedbackRes] = await Promise.all([
          fetchAllPaginatedCollection<any>('/api/orders', 'orders', undefined, {
            retries: 5,
            timeoutMs: 20000,
            pageSize: 200,
            maxPages: 100,
          }),
          safeFetchJson('/api/trips?limit=1000', undefined, { retries: 5, timeoutMs: 20000 }),
          safeFetchJson('/api/drivers?limit=500&includeSample=true', undefined, { retries: 5, timeoutMs: 20000 }),
          safeFetchJson('/api/warehouses?limit=200', undefined, { retries: 5, timeoutMs: 20000 }),
          safeFetchJson('/api/inventory?limit=1000', undefined, { retries: 5, timeoutMs: 20000 }),
          safeFetchJson('/api/inventory-transactions?limit=1000', undefined, { retries: 5, timeoutMs: 20000 }),
          safeFetchJson('/api/replacements?limit=1000', undefined, { retries: 5, timeoutMs: 20000 }),
          safeFetchJson('/api/feedback?limit=1000', undefined, { retries: 5, timeoutMs: 20000 }),
        ])

        if (!isMounted) return

        setOrders(ordersRes.ok ? getCollection<any>(ordersRes.data, ['orders']) : [])
        setTrips(tripsRes.ok ? getCollection<any>(tripsRes.data, ['trips']) : [])
        setDrivers(driversRes.ok ? getCollection<any>(driversRes.data, ['drivers']) : [])
        setWarehouses(warehousesRes.ok ? getCollection<any>(warehousesRes.data, ['warehouses']) : [])
        setInventory(inventoryRes.ok ? getCollection<any>(inventoryRes.data, ['inventory']) : [])
        setInventoryTransactions(transactionsRes.ok ? getCollection<any>(transactionsRes.data, ['transactions']) : [])
        const fallbackReplacements = ordersRes.ok ? getCollection<any>(ordersRes.data, ['replacements']) : []
        setReplacementsData(replacementsRes.ok ? getCollection<any>(replacementsRes.data, ['replacements']) : fallbackReplacements)
        setFeedback(feedbackRes.ok ? getCollection<any>(feedbackRes.data, ['feedback']) : [])
      } catch (error) {
        console.error('Failed to load reports pack:', error)
        if (isMounted) {
          setOrders([])
          setTrips([])
          setDrivers([])
          setWarehouses([])
          setInventory([])
          setInventoryTransactions([])
          setReplacementsData([])
          setFeedback([])
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    fetchReportsPack()

    const unsubscribe = subscribeDataSync((message) => {
      if (
        message.scopes.includes('orders') ||
        message.scopes.includes('trips') ||
        message.scopes.includes('inventory') ||
        message.scopes.includes('stocks') ||
        message.scopes.includes('feedback') ||
        message.scopes.includes('replacements')
      ) {
        void fetchReportsPack()
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const rangeStart = useMemo(() => {
    const days = Number(rangeDays)
    const start = new Date()
    start.setDate(start.getDate() - days)
    return start
  }, [rangeDays])

  const orderRows = useMemo(() => {
    return orders
      .filter((order) => withinRange(order.createdAt, rangeStart))
      .filter((order) => selectedWarehouse === 'all' || getWarehouseIdFromRow(order) === selectedWarehouse)
      .filter((order) => selectedOrderStatus === 'all' || String(order.status || '').toUpperCase() === selectedOrderStatus)
      .map((order) => {
        const checklistComplete = Boolean(
          order.checklistQuantityVerified
        )
        const shortLoadQty = Number(order.exceptionShortLoadQty || 0)
        const damagedOnLoadingQty = Number(order.exceptionDamagedOnLoadingQty || 0)
        const holdReason = String(order.exceptionHoldReason || '').trim()
        return {
          orderNumber: order.orderNumber,
          customer: order.customer?.name || 'N/A',
          status: String(order.status || ''),
          warehouseStage: String(order.warehouseStage || 'READY_TO_LOAD'),
          checklistComplete,
          dispatchSignedOffBy: order.dispatchSignedOffBy || 'N/A',
          dispatchSignedOffAt: order.dispatchSignedOffAt || null,
          shortLoadQty,
          damagedOnLoadingQty,
          holdReason: holdReason || 'N/A',
          hasExceptions: shortLoadQty > 0 || damagedOnLoadingQty > 0 || holdReason.length > 0,
          amount: Number(order.totalAmount || 0),
          createdAt: order.createdAt,
          deliveredAt: order.timeline?.deliveredAt || order.deliveredAt,
        }
      })
  }, [orders, rangeStart, selectedWarehouse, selectedOrderStatus])

  const warehouseDispatchRows = useMemo(() => {
    return orderRows
      .map((row) => {
        const rawStatus = String(row.status || '').toUpperCase()
        const normalizedOrderStatus =
          ['PROCESSING', 'PACKED', 'READY_FOR_PICKUP', 'UNAPPROVED'].includes(rawStatus)
            ? 'PREPARING'
            : ['DISPATCHED', 'IN_TRANSIT'].includes(rawStatus)
              ? 'OUT_FOR_DELIVERY'
              : rawStatus === 'FAILED_DELIVERY'
                ? 'CANCELLED'
                : rawStatus
        return {
          ...row,
          normalizedOrderStatus,
        }
      })
      .filter(
        (row) =>
          ['OUT_FOR_DELIVERY', 'DELIVERED'].includes(String(row.normalizedOrderStatus || '')) ||
          ['LOADED', 'DISPATCHED'].includes(String(row.warehouseStage || '').toUpperCase())
      )
      .map((row) => ({
        orderNumber: row.orderNumber,
        customer: row.customer,
        createdAt: row.createdAt,
        warehouseStage: row.warehouseStage,
        orderStatus: row.normalizedOrderStatus,
        checklistComplete: row.checklistComplete ? 'YES' : 'NO',
        dispatchSignedOffBy: row.dispatchSignedOffBy,
        dispatchSignedOffAt: row.dispatchSignedOffAt ? formatDateTime(row.dispatchSignedOffAt) : 'N/A',
        shortLoadQty: row.shortLoadQty,
        damagedOnLoadingQty: row.damagedOnLoadingQty,
        holdReason: row.holdReason,
        hasExceptions: row.hasExceptions ? 'YES' : 'NO',
      }))
  }, [orderRows])

  const transportRows = useMemo(() => {
    return trips
      .filter((trip) => withinRange(trip.createdAt || trip.plannedStartAt, rangeStart))
      .filter((trip) => selectedWarehouse === 'all' || getWarehouseIdFromRow(trip) === selectedWarehouse)
      .filter((trip) => selectedDriver === 'all' || String(trip.driver?.id || '') === selectedDriver)
      .filter((trip) => selectedTripStatus === 'all' || normalizeTripStatus(trip.status) === selectedTripStatus)
      .map((trip) => {
        const dropPointsTotal = Number(trip.totalDropPoints || toArray<any>(trip.dropPoints).length)
        const dropPointsCompleted = Number(trip.completedDropPoints || 0)
        const completionRate = dropPointsTotal > 0 ? Math.round((dropPointsCompleted / dropPointsTotal) * 100) : 0

        return {
          tripNumber: trip.tripNumber,
          status: normalizeTripStatus(trip.status),
          driver: trip.driver?.user?.name || 'Unassigned',
          vehicle: trip.vehicle?.licensePlate || 'Unassigned',
          dropPointsTotal,
          dropPointsCompleted,
          completionRate,
          plannedStartAt: trip.plannedStartAt,
          actualEndAt: trip.actualEndAt,
        }
      })
  }, [trips, rangeStart, selectedWarehouse, selectedDriver, selectedTripStatus])

  const inventoryMovementRows = useMemo(() => {
    return inventoryTransactions
      .filter((transaction) => withinRange(transaction.createdAt, rangeStart))
      .filter((transaction) => selectedWarehouse === 'all' || getWarehouseIdFromRow(transaction) === selectedWarehouse)
      .filter((transaction) => selectedMovementType === 'all' || String(transaction.type || '').toUpperCase() === selectedMovementType)
      .map((transaction) => ({
        createdAt: transaction.createdAt,
        warehouse: transaction.warehouse?.name || 'N/A',
        product: transaction.product?.name || 'N/A',
        type: String(transaction.type || '').toUpperCase(),
        quantity: Number(transaction.quantity || 0),
        referenceType: transaction.referenceType || 'N/A',
        referenceId: transaction.referenceId || 'N/A',
      }))
  }, [inventoryTransactions, rangeStart, selectedWarehouse, selectedMovementType])

  const replacementRows = useMemo(() => {
    const ordersById = new Map<string, any>()
    const ordersByNumber = new Map<string, any>()
    orders.forEach((order) => {
      const id = String(order?.id ?? '').trim()
      const number = String(order?.orderNumber ?? '').trim().toUpperCase()
      if (id) ordersById.set(id, order)
      if (number) ordersByNumber.set(number, order)
    })

    return replacementsData
      .filter((item) => withinRange(item.createdAt, rangeStart))
      .map((item) => {
        const rawOrderRef = item?.order
        const orderIdRef =
          rawOrderRef && typeof rawOrderRef === 'object'
            ? String((rawOrderRef as any).id ?? '').trim()
            : String(rawOrderRef ?? '').trim()
        const orderNumberRef =
          rawOrderRef && typeof rawOrderRef === 'object'
            ? String((rawOrderRef as any).orderNumber ?? '').trim().toUpperCase()
            : String(item?.orderNumber ?? '').trim().toUpperCase()

        const relatedOrder =
          (orderIdRef ? ordersById.get(orderIdRef) : undefined) ||
          (orderNumberRef ? ordersByNumber.get(orderNumberRef) : undefined)
        const sourceLines = Array.isArray(item?.replacementLines) && item.replacementLines.length
          ? item.replacementLines
          : Array.isArray(item?.replacementItems) && item.replacementItems.length
            ? item.replacementItems
            : []
        const orderItems = Array.isArray(relatedOrder?.items) ? relatedOrder.items : []
        const totalLossFromLines = sourceLines.reduce((sum: number, line: any) => {
          const qty = Math.max(Number(line?.quantityReplaced ?? line?.replacedQuantity ?? line?.quantity ?? item?.replacementQuantity ?? 0), 0)
          const unitPrice =
            Number(line?.unitPrice ?? line?.price ?? line?.sellingPrice ?? line?.replacementUnitPrice ?? line?.originalUnitPrice ?? NaN)

          if (Number.isFinite(unitPrice)) return sum + unitPrice * qty

          const matchedOrderItem = orderItems.find((orderItem: any) => {
            const srcOrderItemId = String(line?.orderItemId ?? '').trim()
            const oiId = String(orderItem?.id ?? '').trim()
            if (srcOrderItemId && oiId && srcOrderItemId === oiId) return true
            const srcProductId = String(line?.productId ?? line?.originalProductId ?? line?.replacementProductId ?? '').trim()
            const oiProductId = String(orderItem?.product?.id ?? orderItem?.productId ?? '').trim()
            return Boolean(srcProductId && oiProductId && srcProductId === oiProductId)
          })

          const fallbackPrice = Number(matchedOrderItem?.unitPrice ?? matchedOrderItem?.price ?? matchedOrderItem?.product?.price ?? 0)
          return sum + (Number.isFinite(fallbackPrice) ? fallbackPrice : 0) * qty
        }, 0)
        const fallbackQty = Math.max(Number(item?.replacementQuantity ?? item?.quantityReplaced ?? 0), 0)
        const orderItemPrices = orderItems
          .map((orderItem: any) => Number(orderItem?.unitPrice ?? orderItem?.price ?? orderItem?.product?.price ?? 0))
          .filter((price: number) => Number.isFinite(price) && price > 0)
        const fallbackUnitPrice = orderItemPrices.length > 0 ? (orderItemPrices.reduce((a, b) => a + b, 0) / orderItemPrices.length) : 0
        const totalLoss = totalLossFromLines > 0
          ? totalLossFromLines
          : fallbackQty > 0 && fallbackUnitPrice > 0
            ? fallbackQty * fallbackUnitPrice
            : 0

        const rawStatus = String(item.status || '').toUpperCase()
        const normalizedStatus =
          rawStatus === 'REQUESTED'
            ? 'REPORTED'
            : ['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)
              ? 'IN_PROGRESS'
              : rawStatus === 'REJECTED'
                ? 'NEEDS_FOLLOW_UP'
                : rawStatus === 'PROCESSED'
                  ? 'COMPLETED'
                  : rawStatus
        return {
          replacementNumber: item.replacementNumber,
          orderNumber: relatedOrder?.orderNumber || item?.orderNumber || (orderIdRef || 'N/A'),
          customer: relatedOrder?.customer?.name || item?.customer?.name || 'N/A',
          assignedDriver:
            relatedOrder?.driver?.name ||
            relatedOrder?.assignedDriverName ||
            relatedOrder?.assignedDriver?.name ||
            relatedOrder?.trip?.driver?.name ||
            item?.driverName ||
            item?.assignedDriverName ||
            'N/A',
          status: normalizedStatus,
          totalLoss,
          reason: item.reason || 'N/A',
          createdAt: item.createdAt,
        }
      })
      .filter((item) => selectedReplacementStatus === 'all' || String(item.status || '').toUpperCase() === selectedReplacementStatus)
  }, [orders, replacementsData, rangeStart, selectedReplacementStatus])

  const feedbackRows = useMemo(() => {
    return feedback
      .filter((item) => withinRange(item.createdAt, rangeStart))
      .filter((item) => selectedFeedbackStatus === 'all' || String(item.status || '').toUpperCase() === selectedFeedbackStatus)
      .map((item) => ({
        createdAt: item.createdAt,
        customer: item.customer?.name || 'N/A',
        orderId: item.order || 'N/A',
        type: item.type || 'N/A',
        rating: item.rating === null || item.rating === undefined ? 'N/A' : Number(item.rating),
        status: item.status || 'N/A',
        subject: item.subject || 'N/A',
      }))
  }, [feedback, rangeStart, selectedFeedbackStatus])

  const orderStatusOptions = useMemo(() => {
    return Array.from(
      new Set(
        orders
          .filter((order) => withinRange(order.createdAt, rangeStart))
          .filter((order) => selectedWarehouse === 'all' || getWarehouseIdFromRow(order) === selectedWarehouse)
          .map((row) => String(row.status || '').toUpperCase())
      )
    )
      .filter(Boolean)
      .sort()
  }, [orders, rangeStart, selectedWarehouse])

  const transportStatusOptions = useMemo(() => {
    return Array.from(
      new Set(
        trips
          .filter((trip) => withinRange(trip.createdAt || trip.plannedStartAt, rangeStart))
          .filter((trip) => selectedWarehouse === 'all' || getWarehouseIdFromRow(trip) === selectedWarehouse)
          .filter((trip) => selectedDriver === 'all' || String(trip.driver?.id || '') === selectedDriver)
          .map((row) => String(normalizeTripStatus(row.status) || '').toUpperCase())
      )
    )
      .filter(Boolean)
      .sort()
  }, [trips, rangeStart, selectedWarehouse, selectedDriver])

  const inventoryMovementTypeOptions = useMemo(() => {
    return Array.from(
      new Set(
        inventoryTransactions
          .filter((transaction) => withinRange(transaction.createdAt, rangeStart))
          .filter((transaction) => selectedWarehouse === 'all' || getWarehouseIdFromRow(transaction) === selectedWarehouse)
          .map((row) => String(row.type || '').toUpperCase())
      )
    )
      .filter(Boolean)
      .sort()
  }, [inventoryTransactions, rangeStart, selectedWarehouse])

  const replacementStatusOptions = useMemo(() => {
    return Array.from(
      new Set(
        replacementsData
          .filter((item) => withinRange(item.createdAt, rangeStart))
          .map((item) => {
            const rawStatus = String(item.status || '').toUpperCase()
            if (rawStatus === 'REQUESTED') return 'REPORTED'
            if (['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)) return 'IN_PROGRESS'
            if (rawStatus === 'REJECTED') return 'NEEDS_FOLLOW_UP'
            if (rawStatus === 'PROCESSED') return 'COMPLETED'
            return rawStatus
          })
      )
    )
      .filter(Boolean)
      .sort()
  }, [replacementsData, rangeStart])

  const feedbackStatusOptions = useMemo(() => {
    return Array.from(
      new Set(
        feedback
          .filter((item) => withinRange(item.createdAt, rangeStart))
          .map((row) => String(row.status || '').toUpperCase())
      )
    )
      .filter(Boolean)
      .sort()
  }, [feedback, rangeStart])

  const orderStatusChart = useMemo(() => {
    const counts = new Map<string, number>()
    orderRows.forEach((row) => {
      const key = String(row.status || 'UNKNOWN')
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return Array.from(counts.entries()).map(([status, count]) => ({ status, count }))
  }, [orderRows])

  const inventoryMovementChart = useMemo(() => {
    const grouped = new Map<string, { key: string; label: string; sortDate: Date; inQty: number; outQty: number }>()
    const granularity: 'day' | 'week' | 'month' = rangeDays === '7' ? 'day' : rangeDays === '30' ? 'week' : 'month'
    inventoryMovementRows.forEach((row) => {
      const date = new Date(String(row.createdAt || ''))
      if (Number.isNaN(date.getTime())) return
      let key = ''
      let label = ''
      let sortDate = new Date(date)

      if (granularity === 'day') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        sortDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      } else if (granularity === 'week') {
        const weekStart = new Date(date)
        const diff = (weekStart.getDay() + 6) % 7
        weekStart.setDate(weekStart.getDate() - diff)
        weekStart.setHours(0, 0, 0, 0)
        const yearStart = new Date(weekStart.getFullYear(), 0, 1)
        const week = Math.ceil((((weekStart.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
        key = `${weekStart.getFullYear()}-W${String(week).padStart(2, '0')}`
        label = `W${week} ${weekStart.getFullYear()}`
        sortDate = weekStart
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        label = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        sortDate = new Date(date.getFullYear(), date.getMonth(), 1)
      }

      const current = grouped.get(key) || { key, label, sortDate, inQty: 0, outQty: 0 }
      if (String(row.type || '').toUpperCase() === 'IN') current.inQty += Number(row.quantity || 0)
      if (String(row.type || '').toUpperCase() === 'OUT') current.outQty += Number(row.quantity || 0)
      grouped.set(key, current)
    })

    const start = new Date(rangeStart)
    const end = new Date()
    start.setHours(0, 0, 0, 0)
    end.setHours(0, 0, 0, 0)

    const points: Array<{ key: string; label: string; sortDate: Date; inQty: number; outQty: number }> = []

    if (granularity === 'day') {
      const cursor = new Date(start)
      while (cursor.getTime() <= end.getTime()) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
        const label = cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const existing = grouped.get(key)
        points.push(existing || { key, label, sortDate: new Date(cursor), inQty: 0, outQty: 0 })
        cursor.setDate(cursor.getDate() + 1)
      }
    } else if (granularity === 'week') {
      const cursor = new Date(start)
      const startDiff = (cursor.getDay() + 6) % 7
      cursor.setDate(cursor.getDate() - startDiff)
      while (cursor.getTime() <= end.getTime()) {
        const yearStart = new Date(cursor.getFullYear(), 0, 1)
        const week = Math.ceil((((cursor.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
        const key = `${cursor.getFullYear()}-W${String(week).padStart(2, '0')}`
        const label = `W${week} ${cursor.getFullYear()}`
        const existing = grouped.get(key)
        points.push(existing || { key, label, sortDate: new Date(cursor), inQty: 0, outQty: 0 })
        cursor.setDate(cursor.getDate() + 7)
      }
    } else {
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1)
      while (cursor.getTime() <= endMonth.getTime()) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
        const label = cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        const existing = grouped.get(key)
        points.push(existing || { key, label, sortDate: new Date(cursor), inQty: 0, outQty: 0 })
        cursor.setMonth(cursor.getMonth() + 1)
      }
    }

    return points
  }, [inventoryMovementRows, rangeDays])

  const feedbackRatingChart = useMemo(() => {
    const counts = new Map<string, number>()
    feedbackRows.forEach((row) => {
      const rating = Number(row.rating)
      if (!Number.isFinite(rating)) return
      const key = `${Math.max(1, Math.min(5, Math.round(rating)))}`
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return ['1', '2', '3', '4', '5'].map((rating) => ({ rating, count: counts.get(rating) || 0 }))
  }, [feedbackRows])

  const feedbackRatingTotal = useMemo(() => {
    return feedbackRatingChart.reduce((sum, row) => sum + Number(row.count || 0), 0)
  }, [feedbackRatingChart])

  const orderOutcomeTrendChart = useMemo(() => {
    const grouped = new Map<string, { key: string; label: string; sortDate: Date; delivered: number; cancelled: number; rescheduled: number }>()
    const granularity: 'day' | 'week' | 'month' = rangeDays === '7' ? 'day' : rangeDays === '30' ? 'week' : 'month'

    orderRows.forEach((row) => {
      const rawStatus = String(row.status || '').toUpperCase()
      const status =
        rawStatus === 'FAILED_DELIVERY'
          ? 'CANCELLED'
          : ['CANCELED', 'REJECTED', 'SKIPPED', 'FAILED'].includes(rawStatus)
            ? 'CANCELLED'
            : rawStatus

      const date = new Date(String(row.createdAt || ''))
      if (Number.isNaN(date.getTime())) return

      let key = ''
      let label = ''
      let sortDate = new Date(date)

      if (granularity === 'day') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        sortDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      } else if (granularity === 'week') {
        const weekStart = new Date(date)
        const diff = (weekStart.getDay() + 6) % 7
        weekStart.setDate(weekStart.getDate() - diff)
        weekStart.setHours(0, 0, 0, 0)
        const yearStart = new Date(weekStart.getFullYear(), 0, 1)
        const week = Math.ceil((((weekStart.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
        key = `${weekStart.getFullYear()}-W${String(week).padStart(2, '0')}`
        label = `W${week} ${weekStart.getFullYear()}`
        sortDate = weekStart
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        label = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        sortDate = new Date(date.getFullYear(), date.getMonth(), 1)
      }

      const current = grouped.get(key) || { key, label, sortDate, delivered: 0, cancelled: 0, rescheduled: 0 }
      if (status === 'DELIVERED') current.delivered += 1
      if (status === 'CANCELLED') current.cancelled += 1
      if (status === 'RESCHEDULED') current.rescheduled += 1
      grouped.set(key, current)
    })

    const start = new Date(rangeStart)
    const end = new Date()
    start.setHours(0, 0, 0, 0)
    end.setHours(0, 0, 0, 0)

    const points: Array<{ key: string; label: string; sortDate: Date; delivered: number; cancelled: number; rescheduled: number }> = []

    if (granularity === 'day') {
      const cursor = new Date(start)
      while (cursor.getTime() <= end.getTime()) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
        const label = cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const existing = grouped.get(key)
        points.push(existing || { key, label, sortDate: new Date(cursor), delivered: 0, cancelled: 0, rescheduled: 0 })
        cursor.setDate(cursor.getDate() + 1)
      }
    } else if (granularity === 'week') {
      const cursor = new Date(start)
      const startDiff = (cursor.getDay() + 6) % 7
      cursor.setDate(cursor.getDate() - startDiff)
      while (cursor.getTime() <= end.getTime()) {
        const yearStart = new Date(cursor.getFullYear(), 0, 1)
        const week = Math.ceil((((cursor.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
        const key = `${cursor.getFullYear()}-W${String(week).padStart(2, '0')}`
        const label = `W${week} ${cursor.getFullYear()}`
        const existing = grouped.get(key)
        points.push(existing || { key, label, sortDate: new Date(cursor), delivered: 0, cancelled: 0, rescheduled: 0 })
        cursor.setDate(cursor.getDate() + 7)
      }
    } else {
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1)
      while (cursor.getTime() <= endMonth.getTime()) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
        const label = cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        const existing = grouped.get(key)
        points.push(existing || { key, label, sortDate: new Date(cursor), delivered: 0, cancelled: 0, rescheduled: 0 })
        cursor.setMonth(cursor.getMonth() + 1)
      }
    }

    return points
  }, [orderRows, rangeDays, rangeStart])

  const transportTrendChart = useMemo(() => {
    const grouped = new Map<string, { day: string; completed: number; inProgress: number; cancelled: number }>()
    transportRows.forEach((row) => {
      const key = formatDayLabel(row.plannedStartAt || row.actualEndAt)
      const current = grouped.get(key) || { day: key, completed: 0, inProgress: 0, cancelled: 0 }
      const status = String(row.status || '').toUpperCase()
      if (status === 'COMPLETED') current.completed += 1
      else if (status === 'IN_PROGRESS') current.inProgress += 1
      else if (status === 'CANCELLED' || status === 'FAILED' || status === 'SKIPPED') current.cancelled += 1
      grouped.set(key, current)
    })
    return Array.from(grouped.values()).slice(-12)
  }, [transportRows])

  const transportBubbleChart = useMemo(() => {
    return transportRows.map((row) => ({
      trip: row.tripNumber || 'N/A',
      completionRate: Number(row.completionRate || 0),
      dropPointsTotal: Number(row.dropPointsTotal || 0),
      dropPointsCompleted: Number(row.dropPointsCompleted || 0),
    }))
  }, [transportRows])

  const inventoryMovementByProductChart = useMemo(() => {
    const grouped = new Map<string, { name: string; inQty: number; outQty: number; total: number }>()
    inventoryMovementRows.forEach((row) => {
      const product = String(row.product || 'Unknown Product')
      const current = grouped.get(product) || { name: product, inQty: 0, outQty: 0, total: 0 }
      const qty = Math.abs(Number(row.quantity || 0))
      if (String(row.type || '').toUpperCase() === 'IN') current.inQty += qty
      if (String(row.type || '').toUpperCase() === 'OUT') current.outQty += qty
      current.total += qty
      grouped.set(product, current)
    })
    return Array.from(grouped.entries())
      .map(([, item]) => item)
      .sort((a, b) => b.total - a.total)
      .slice(0, 12)
  }, [inventoryMovementRows])

  const stockTrendSummary = useMemo(() => {
    const totalIn = inventoryMovementChart.reduce((sum, item) => sum + Number(item.inQty || 0), 0)
    const totalOut = inventoryMovementChart.reduce((sum, item) => sum + Number(item.outQty || 0), 0)

    const previous = inventoryMovementChart.slice(0, 6)
    const current = inventoryMovementChart.slice(6)

    const prevIn = previous.reduce((sum, item) => sum + Number(item.inQty || 0), 0)
    const currIn = current.reduce((sum, item) => sum + Number(item.inQty || 0), 0)
    const prevOut = previous.reduce((sum, item) => sum + Number(item.outQty || 0), 0)
    const currOut = current.reduce((sum, item) => sum + Number(item.outQty || 0), 0)

    const inChangePercent = prevIn > 0 ? ((currIn - prevIn) / prevIn) * 100 : (currIn > 0 ? 100 : 0)
    const outChangePercent = prevOut > 0 ? ((currOut - prevOut) / prevOut) * 100 : (currOut > 0 ? 100 : 0)

    return { totalIn, totalOut, inChangePercent, outChangePercent }
  }, [inventoryMovementChart])

  const warehouseCapacityVsUsedChart = useMemo(() => {
    const scopedWarehouses = warehouses.filter((warehouse) => selectedWarehouse === 'all' || String(warehouse?.id || '') === selectedWarehouse)
    return scopedWarehouses.map((warehouse) => {
      const warehouseId = String(warehouse?.id || '')
      const capacity = Number(warehouse?.capacity || 0)
      const usedUnits = inventory
        .filter((item) => getWarehouseIdFromRow(item) === warehouseId)
        .reduce((sum, item) => sum + Number(item?.quantity || 0), 0)
      const usedPercent = capacity > 0 ? Math.min(100, Math.round((usedUnits / capacity) * 100)) : 0
      return {
        name: String(warehouse?.code || warehouse?.name || warehouseId || 'Warehouse'),
        capacityPercent: 100,
        usedPercent,
      }
    })
  }, [warehouses, selectedWarehouse, inventory])

  const scopedInventory = useMemo(() => {
    return inventory.filter((item) => selectedWarehouse === 'all' || getWarehouseIdFromRow(item) === selectedWarehouse)
  }, [inventory, selectedWarehouse])

  const orderKpi = useMemo(() => {
    const delivered = orderRows.filter((row) => row.status === 'DELIVERED').length
    const total = orderRows.length
    const deliveredRevenue = orderRows
      .filter((row) => row.status === 'DELIVERED')
      .reduce((acc, row) => acc + Number(row.amount || 0), 0)

    return {
      total,
      delivered,
      pending: total - delivered,
      fulfillmentRate: total > 0 ? Math.round((delivered / total) * 100) : 0,
      deliveredRevenue,
    }
  }, [orderRows])

  const fulfillmentReportRows = useMemo(() => {
    return orderRows
      .map((row) => {
        const rawStatus = String(row.status || '').toUpperCase()
        const normalizedStatus =
          rawStatus === 'FAILED_DELIVERY'
            ? 'CANCELLED'
            : ['CANCELED', 'REJECTED', 'SKIPPED', 'FAILED'].includes(rawStatus)
              ? 'CANCELLED'
              : rawStatus
        return { ...row, status: normalizedStatus }
      })
      .filter((row) => ['DELIVERED', 'RESCHEDULED', 'CANCELLED'].includes(String(row.status || '').toUpperCase()))
  }, [orderRows])

  const transportKpi = useMemo(() => {
    const total = transportRows.length
    const completed = transportRows.filter((row) => row.status === 'COMPLETED').length
    const inProgress = transportRows.filter((row) => row.status === 'IN_PROGRESS').length
    const averageCompletion =
      total > 0 ? Math.round(transportRows.reduce((acc, row) => acc + Number(row.completionRate || 0), 0) / total) : 0

    return { total, completed, inProgress, averageCompletion }
  }, [transportRows])

  const inventoryKpi = useMemo(() => {
    const totalSkus = scopedInventory.length
    const lowStock = scopedInventory.filter((item) => Number(item.quantity || 0) <= Number(item.minStock || 0)).length
    const totalQuantity = scopedInventory.reduce((acc, item) => acc + Number(item.quantity || 0), 0)
    const stockIn = inventoryMovementRows
      .filter((row) => row.type === 'IN')
      .reduce((acc, row) => acc + Number(row.quantity || 0), 0)
    const stockOut = inventoryMovementRows
      .filter((row) => row.type === 'OUT')
      .reduce((acc, row) => acc + Number(row.quantity || 0), 0)

    return { totalSkus, lowStock, totalQuantity, stockIn, stockOut }
  }, [scopedInventory, inventoryMovementRows])

  const replacementKpi = useMemo(() => {
    const total = replacementRows.length
    const completed = replacementRows.filter((row) => row.status === 'COMPLETED' || row.status === 'RESOLVED_ON_DELIVERY').length
    const open = replacementRows.filter((row) => row.status === 'REPORTED' || row.status === 'IN_PROGRESS' || row.status === 'NEEDS_FOLLOW_UP').length
    return { total, completed, open }
  }, [replacementRows])

  const replacementLossTrendChart = useMemo(() => {
    const grouped = new Map<string, { key: string; label: string; sortDate: Date; loss: number }>()
    const granularity: 'day' | 'week' | 'month' = rangeDays === '7' ? 'day' : rangeDays === '30' ? 'week' : 'month'

    replacementRows.forEach((row) => {
      const date = new Date(String(row.createdAt || ''))
      if (Number.isNaN(date.getTime())) return

      let key = ''
      let label = ''
      let sortDate = new Date(date)

      if (granularity === 'day') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        sortDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      } else if (granularity === 'week') {
        const weekStart = new Date(date)
        const diff = (weekStart.getDay() + 6) % 7
        weekStart.setDate(weekStart.getDate() - diff)
        weekStart.setHours(0, 0, 0, 0)
        const yearStart = new Date(weekStart.getFullYear(), 0, 1)
        const week = Math.ceil((((weekStart.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
        key = `${weekStart.getFullYear()}-W${String(week).padStart(2, '0')}`
        label = `W${week} ${weekStart.getFullYear()}`
        sortDate = weekStart
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        label = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        sortDate = new Date(date.getFullYear(), date.getMonth(), 1)
      }

      const current = grouped.get(key) || { key, label, sortDate, loss: 0 }
      current.loss += Number(row.totalLoss || 0)
      grouped.set(key, current)
    })

    const start = new Date(rangeStart)
    const end = new Date()
    start.setHours(0, 0, 0, 0)
    end.setHours(0, 0, 0, 0)

    const points: Array<{ key: string; label: string; sortDate: Date; loss: number }> = []

    if (granularity === 'day') {
      const cursor = new Date(start)
      while (cursor.getTime() <= end.getTime()) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
        const label = cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const existing = grouped.get(key)
        points.push(existing || { key, label, sortDate: new Date(cursor), loss: 0 })
        cursor.setDate(cursor.getDate() + 1)
      }
    } else if (granularity === 'week') {
      const cursor = new Date(start)
      const startDiff = (cursor.getDay() + 6) % 7
      cursor.setDate(cursor.getDate() - startDiff)
      while (cursor.getTime() <= end.getTime()) {
        const yearStart = new Date(cursor.getFullYear(), 0, 1)
        const week = Math.ceil((((cursor.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
        const key = `${cursor.getFullYear()}-W${String(week).padStart(2, '0')}`
        const label = `W${week} ${cursor.getFullYear()}`
        const existing = grouped.get(key)
        points.push(existing || { key, label, sortDate: new Date(cursor), loss: 0 })
        cursor.setDate(cursor.getDate() + 7)
      }
    } else {
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1)
      while (cursor.getTime() <= endMonth.getTime()) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
        const label = cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        const existing = grouped.get(key)
        points.push(existing || { key, label, sortDate: new Date(cursor), loss: 0 })
        cursor.setMonth(cursor.getMonth() + 1)
      }
    }

    return points
  }, [replacementRows, rangeDays, rangeStart])

  const feedbackKpi = useMemo(() => {
    const total = feedbackRows.length
    const ratings = feedbackRows
      .map((row) => Number(row.rating))
      .filter((rating) => Number.isFinite(rating))
    const avgRating = ratings.length > 0 ? ratings.reduce((acc, rating) => acc + rating, 0) / ratings.length : 0
    const open = feedbackRows.filter((row) => String(row.status).toUpperCase() === 'OPEN').length
    return { total, avgRating, open }
  }, [feedbackRows])

  const chartCardClassName = 'rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden'
  const chartTooltipStyle = {
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '12px',
    boxShadow: '0 12px 30px rgba(15, 23, 42, 0.22)',
  }
  const buildReportSummaryLines = (rows: Array<Record<string, unknown>>, maxRows: number, headers: string[]) => {
    const summaryLines: string[] = []
    summaryLines.push(`Total records: ${rows.length}`)
    summaryLines.push(`Included in this page: ${maxRows}`)
    const lowerHeaders = headers.map((header) => header.toLowerCase())
    const statusHeader = headers.find((header, index) => lowerHeaders[index].includes('status'))
    const amountHeader = headers.find((header, index) =>
      ['amount', 'total', 'value', 'cost'].some((token) => lowerHeaders[index].includes(token))
    )
    if (statusHeader) {
      const statusCounts = new Map<string, number>()
      rows.forEach((row) => {
        const key = String(row[statusHeader] || 'UNKNOWN').trim() || 'UNKNOWN'
        statusCounts.set(key, (statusCounts.get(key) || 0) + 1)
      })
      const topStatuses = Array.from(statusCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([status, count]) => `${status}: ${count}`)
      if (topStatuses.length > 0) summaryLines.push(`Status summary: ${topStatuses.join(' | ')}`)
    }
    if (amountHeader) {
      const amounts = rows.map((row) => Number(row[amountHeader])).filter((value) => Number.isFinite(value))
      if (amounts.length > 0) {
        const totalAmount = amounts.reduce((acc, value) => acc + value, 0)
        const avgAmount = totalAmount / amounts.length
        summaryLines.push(`Amount summary: Total ${formatPeso(totalAmount)} | Avg ${formatPeso(avgAmount)}`)
      }
    }
    return summaryLines
  }

  const downloadPdf = async (
    filename: string,
    title: string,
    rows: Array<Record<string, unknown>>,
    options?: { companyName?: string; subtitle?: string; preparedBy?: string }
  ) => {
    if (!rows.length) {
      toast.error(`No data to export for ${filename}`)
      return
    }
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([842, 595])
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    const companyName = options?.companyName || "Ann Ann's Beverages Trading"
    const subtitle = options?.subtitle || 'Logistics Management System'
    const preparedBy = options?.preparedBy || 'System Administrator'
    const margin = 28
    const usableWidth = 842 - margin * 2
    const lineHeight = 14
    const maxRows = Math.min(rows.length, 180)
    const headers = Object.keys(rows[0]).slice(0, 8)
    const colWidth = usableWidth / Math.max(1, headers.length)
    const ellipsize = (value: string, maxChars: number) => {
      const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
      if (normalized.length <= maxChars) return normalized
      return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`
    }
    let y = 560
    page.drawText(companyName, { x: margin, y, size: 16, font: boldFont, color: rgb(0.08, 0.08, 0.08) })
    y -= 16
    page.drawText(subtitle, { x: margin, y, size: 10, font, color: rgb(0.25, 0.25, 0.25) })
    y -= 18
    page.drawText(title, { x: margin, y, size: 14, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
    y -= 14
    page.drawText(`Generated: ${new Date().toLocaleString()} | Prepared by: ${preparedBy}`, {
      x: margin, y, size: 9, font, color: rgb(0.35, 0.35, 0.35),
    })
    y -= 18
    const summaryLines = buildReportSummaryLines(rows, maxRows, headers)
    const summaryHeight = summaryLines.length * 12 + 12
    page.drawRectangle({ x: margin, y: y - summaryHeight, width: usableWidth, height: summaryHeight, color: rgb(0.96, 0.98, 1), borderColor: rgb(0.82, 0.88, 0.96), borderWidth: 1 })
    page.drawText('Summary', { x: margin + 8, y: y - 12, size: 10, font: boldFont, color: rgb(0.12, 0.22, 0.36) })
    let summaryY = y - 24
    summaryLines.forEach((line) => {
      page.drawText(line, { x: margin + 8, y: summaryY, size: 8.5, font, color: rgb(0.24, 0.3, 0.4), maxWidth: usableWidth - 16 })
      summaryY -= 12
    })
    y = y - summaryHeight - 12
    headers.forEach((header, index) => {
      page.drawText(header, { x: margin + index * colWidth, y, size: 9, font: boldFont, color: rgb(0.15, 0.15, 0.15), maxWidth: colWidth - 8 })
    })
    y -= lineHeight
    for (let i = 0; i < maxRows; i += 1) {
      const row = rows[i]
      headers.forEach((header, index) => {
        const rawValue = String(row[header] ?? '')
        const value = ellipsize(rawValue, Math.max(10, Math.floor((colWidth - 10) / 4.7)))
        page.drawText(value, { x: margin + index * colWidth, y, size: 8, font, color: rgb(0.25, 0.25, 0.25), maxWidth: colWidth - 8 })
      })
      y -= lineHeight
      if (y < 30) break
    }
    const footerSummaryY = 44
    const footerSummaryText = summaryLines.join(' | ')
    page.drawRectangle({ x: margin, y: footerSummaryY - 8, width: usableWidth, height: 14, color: rgb(0.97, 0.98, 1), borderColor: rgb(0.84, 0.89, 0.96), borderWidth: 1 })
    page.drawText(`Bottom Summary: ${ellipsize(footerSummaryText, 180)}`, { x: margin + 6, y: footerSummaryY - 2, size: 8, font, color: rgb(0.23, 0.3, 0.4), maxWidth: usableWidth - 12 })
    page.drawText('Prepared by: ____________________', { x: margin, y: 26, size: 9, font, color: rgb(0.25, 0.25, 0.25) })
    page.drawText('Reviewed by: ____________________', { x: margin + 240, y: 26, size: 9, font, color: rgb(0.25, 0.25, 0.25) })
    page.drawText('Approved by: ____________________', { x: margin + 480, y: 26, size: 9, font, color: rgb(0.25, 0.25, 0.25) })
    const bytes = await pdfDoc.save()
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const exportAllPdf = async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    await downloadPdf(`orders-report-${stamp}.pdf`, 'Order Fulfillment Report', orderRows, reportBranding)
    await downloadPdf(`transport-report-${stamp}.pdf`, 'Transportation & Delivery Status Report', transportRows, reportBranding)
    await downloadPdf(`warehouse-inventory-report-${stamp}.pdf`, 'Warehouse & Inventory Movement Report', inventoryMovementRows, reportBranding)
    await downloadPdf(`warehouse-dispatch-compliance-report-${stamp}.pdf`, 'Warehouse Dispatch Compliance Report', warehouseDispatchRows, reportBranding)
    await downloadPdf(`replacement-report-${stamp}.pdf`, 'Replacement Handling Report', replacementRows, reportBranding)
    await downloadPdf(`feedback-report-${stamp}.pdf`, 'Client Feedback & Service Evaluation Report', feedbackRows, reportBranding)
    toast.success('All PDF reports exported')
  }

  const resetFilters = () => {
    setRangeDays('30')
    setSelectedWarehouse('all')
    setSelectedDriver('all')
    setSelectedOrderStatus('all')
    setSelectedTripStatus('all')
    setSelectedMovementType('all')
    setSelectedReplacementStatus('all')
    setSelectedFeedbackStatus('all')
  }

  const reportToolbar = ({
    title,
    statusLabel,
    statusOptions,
    statusValue,
    onStatusChange,
    showWarehouse = false,
    showDriver = false,
    showStatus = true,
  }: {
    title: string
    statusLabel: string
    statusOptions: string[]
    statusValue: string
    onStatusChange: (value: string) => void
    showWarehouse?: boolean
    showDriver?: boolean
    showStatus?: boolean
  }) => (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          value={rangeDays}
          onChange={(event) => setRangeDays(event.target.value as '7' | '30' | '90')}
          title="Select report date range"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        {showWarehouse ? (
          <select
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            value={selectedWarehouse}
            onChange={(event) => setSelectedWarehouse(event.target.value)}
            title="Filter by warehouse"
          >
            <option value="all">All Warehouses</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name || warehouse.code || warehouse.id}
              </option>
            ))}
          </select>
        ) : null}
        {showDriver ? (
          <select
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            value={selectedDriver}
            onChange={(event) => setSelectedDriver(event.target.value)}
            title="Filter by driver"
          >
            <option value="all">All Drivers</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver?.user?.name || driver.name || driver.id}
              </option>
            ))}
          </select>
        ) : null}
        {showStatus ? (
          <select
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            value={statusValue}
            onChange={(event) => onStatusChange(event.target.value)}
            title={`Filter by ${statusLabel.toLowerCase()}`}
          >
            <option value="all">All {statusLabel}</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        ) : null}
        <Button variant="outline" className="gap-2 rounded-lg border-slate-200" onClick={resetFilters}>
          Reset Filters
        </Button>
        <Button variant="outline" className="gap-2 rounded-lg border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => void exportCurrentPdf()} disabled={isLoading}>
          <Download className="h-4 w-4" />
          {title === 'Warehouse' ? 'Export Warehouse PDF' : `Export ${title} PDF`}
        </Button>
      </div>
    </div>
  )

  const exportCurrentPdf = async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    if (activeReportTab === 'orders') {
      await downloadPdf(`orders-report-${stamp}.pdf`, 'Order Fulfillment Report', orderRows, reportBranding)
      return
    }
    if (activeReportTab === 'transport') {
      await downloadPdf(`transport-report-${stamp}.pdf`, 'Transportation & Delivery Status Report', transportRows, reportBranding)
      return
    }
    if (activeReportTab === 'warehouse') {
      await downloadPdf(
        `warehouse-inventory-report-${stamp}.pdf`,
        'Warehouse & Inventory Movement Report',
        inventoryMovementRows,
        reportBranding
      )
      return
    }
    if (activeReportTab === 'replacement') {
      await downloadPdf(`replacement-report-${stamp}.pdf`, 'Replacement Handling Report', replacementRows, reportBranding)
      return
    }
    await downloadPdf(`feedback-report-${stamp}.pdf`, 'Client Feedback & Service Evaluation Report', feedbackRows, reportBranding)
  }

  const printCurrentReport = () => {
    const reportMap: Record<string, { title: string; rows: Array<Record<string, unknown>> }> = {
      orders: { title: 'Order Fulfillment Report', rows: orderRows },
      transport: { title: 'Transportation & Delivery Status Report', rows: transportRows },
      warehouse: { title: 'Warehouse & Inventory Movement Report', rows: inventoryMovementRows },
      replacement: { title: 'Replacement Handling Report', rows: replacementRows },
      feedback: { title: 'Client Feedback & Service Evaluation Report', rows: feedbackRows },
    }

    const report = reportMap[activeReportTab]
    if (!report || report.rows.length === 0) {
      toast.error('No report data to print')
      return
    }

    const columns = Object.keys(report.rows[0])
    const summaryLines = buildReportSummaryLines(report.rows, Math.min(report.rows.length, 300), columns)
    const bodyRows = report.rows
      .slice(0, 300)
      .map((row) => `<tr>${columns.map((column) => `<td>${String(row[column] ?? '').replace(/</g, '&lt;')}</td>`).join('')}</tr>`)
      .join('')

    const html = `
      <html>
        <head>
          <title>${report.title}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
            h1 { margin: 0 0 2px 0; font-size: 20px; }
            h2 { margin: 0 0 12px 0; font-size: 12px; color: #4b5563; font-weight: 500; }
            p { margin: 0 0 12px 0; color: #444; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }
            th { background: #f5f5f5; }
            .summary-box { margin: 10px 0 12px; border: 1px solid #bfdbfe; background: #eff6ff; padding: 8px 10px; }
            .summary-title { font-weight: 700; margin-bottom: 4px; color: #1e3a8a; }
            .summary-line { font-size: 11px; color: #334155; margin: 0 0 2px 0; }
            .bottom-summary { margin-top: 12px; border: 1px solid #cbd5e1; background: #f8fafc; padding: 8px 10px; font-size: 11px; color: #334155; }
            .signatures { margin-top: 24px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
            .signature-line { margin-top: 32px; border-top: 1px solid #111; padding-top: 6px; font-size: 11px; }
          </style>
        </head>
        <body>
          <h1>${reportBranding.companyName}</h1>
          <h2>${reportBranding.subtitle}</h2>
          <p><strong>${report.title}</strong></p>
          <p>Generated at ${new Date().toLocaleString()} | Date range: last ${rangeDays} days | Prepared by: ${reportBranding.preparedBy}</p>
          <div class="summary-box">
            <div class="summary-title">Summary</div>
            ${summaryLines.map((line) => `<p class="summary-line">${line}</p>`).join('')}
          </div>
          <table>
            <thead>
              <tr>${columns.map((column) => `<th>${column}</th>`).join('')}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
          <div class="bottom-summary">Bottom Summary: ${summaryLines.join(' | ')}</div>
          <div class="signatures">
            <div>
              <div class="signature-line">Prepared by</div>
            </div>
            <div>
              <div class="signature-line">Reviewed by</div>
            </div>
            <div>
              <div class="signature-line">Approved by</div>
            </div>
          </div>
        </body>
      </html>
    `

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast.error('Unable to open print window')
      return
    }
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const previewRows = <T extends Record<string, unknown>>(rows: T[]) => rows.slice(0, 8)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-[34px] leading-tight font-bold text-slate-800">Reports & Analytics</h1>
          <p className="text-sm text-slate-500">Order, transport, warehouse, replacement, and feedback reports</p>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="h-52 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </CardContent>
        </Card>
      ) : (
        <Tabs value={activeReportTab} onValueChange={setActiveReportTab} className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 md:grid-cols-5">
              <TabsTrigger value="orders" className="h-11 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><FileText className="h-4 w-4" />Orders</TabsTrigger>
              <TabsTrigger value="transport" className="h-11 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Truck className="h-4 w-4" />Transport</TabsTrigger>
              <TabsTrigger value="warehouse" className="h-11 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Building2 className="h-4 w-4" />Warehouse/Inventory</TabsTrigger>
              <TabsTrigger value="replacement" className="h-11 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Package className="h-4 w-4" />Replacement</TabsTrigger>
              <TabsTrigger value="feedback" className="h-11 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><MessageSquare className="h-4 w-4" />Feedback</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="orders" className="space-y-4">
            {reportToolbar({
              title: 'Orders',
              statusLabel: 'Order Statuses',
              statusOptions: orderStatusOptions,
              statusValue: selectedOrderStatus,
              onStatusChange: setSelectedOrderStatus,
              showWarehouse: true,
            })}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total Orders</CardDescription><CardTitle className="text-[30px] leading-none">{orderKpi.total}</CardTitle><p className="text-[11px] text-slate-400">-- 0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Delivered</CardDescription><CardTitle className="text-[30px] leading-none">{orderKpi.delivered}</CardTitle><p className="text-[11px] text-emerald-600">+0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Fulfillment Rate</CardDescription><CardTitle className="text-[30px] leading-none">{orderKpi.fulfillmentRate}%</CardTitle><p className="text-[11px] text-slate-400">-- 0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Delivered Revenue</CardDescription><CardTitle className="text-[30px] leading-none">{formatPeso(orderKpi.deliveredRevenue)}</CardTitle><p className="text-[11px] text-emerald-600">+0% vs prev {rangeDays} days</p></CardHeader></Card>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <Card className={chartCardClassName}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Delivered vs Cancelled vs Rescheduled (Line)</CardTitle>
                  <CardDescription>Order outcome trend based on current filters</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={orderOutcomeTrendChart} margin={{ top: 12, right: 20, left: 0, bottom: 26 }}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={chartTooltipStyle} />
                        <Legend verticalAlign="top" wrapperStyle={{ fontSize: '12px', color: '#64748b' }} />
                        <Line type="monotone" dataKey="delivered" name="Delivered" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                        <Line type="monotone" dataKey="cancelled" name="Cancelled" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                        <Line type="monotone" dataKey="rescheduled" name="Rescheduled" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
            <Card className="rounded-2xl border border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Order Fulfillment Report</CardTitle>
                  <CardDescription>Latest orders within selected date range</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Order</th>
                        <th className="p-3 text-left">Customer</th>
                        <th className="p-3 text-left">Status</th>
                        <th className="p-3 text-left">Amount</th>
                        <th className="p-3 text-left">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(fulfillmentReportRows).map((row, index) => (
                        <tr key={`${row.orderNumber}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.orderNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.customer || 'N/A')}</td>
                          <td className="p-3">{String(row.status || 'N/A')}</td>
                          <td className="p-3">{formatPeso(Number(row.amount || 0))}</td>
                          <td className="p-3">{formatDateTime(row.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {fulfillmentReportRows.length === 0 ? <p className="py-8 text-center text-gray-500">No matching orders found for this range</p> : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transport" className="space-y-4">
            {reportToolbar({
              title: 'Transport',
              statusLabel: 'Trip Statuses',
              statusOptions: transportStatusOptions,
              statusValue: selectedTripStatus,
              onStatusChange: setSelectedTripStatus,
              showWarehouse: true,
              showDriver: true,
            })}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total Trips</CardDescription><CardTitle className="text-[30px] leading-none">{transportKpi.total}</CardTitle><p className="text-[11px] text-slate-400">-- 0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Completed Trips</CardDescription><CardTitle className="text-[30px] leading-none">{transportKpi.completed}</CardTitle><p className="text-[11px] text-emerald-600">+0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">In Progress</CardDescription><CardTitle className="text-[30px] leading-none">{transportKpi.inProgress}</CardTitle><p className="text-[11px] text-slate-400">-- 0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Average Completion</CardDescription><CardTitle className="text-[30px] leading-none">{transportKpi.averageCompletion}%</CardTitle><p className="text-[11px] text-emerald-600">+0% vs prev {rangeDays} days</p></CardHeader></Card>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className={chartCardClassName}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Trip Status Trend (Area)</CardTitle>
                  <CardDescription>Completion and in-progress movement over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={transportTrendChart} margin={{ top: 12, right: 20, left: 0, bottom: 26 }}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={chartTooltipStyle} />
                        <Legend verticalAlign="top" wrapperStyle={{ fontSize: '12px', color: '#64748b' }} />
                        <Area type="monotone" dataKey="completed" stackId="1" stroke="#16a34a" fill="#86efac" />
                        <Area type="monotone" dataKey="inProgress" stackId="1" stroke="#2563eb" fill="#93c5fd" />
                        <Area type="monotone" dataKey="cancelled" stackId="1" stroke="#ef4444" fill="#fca5a5" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card className={chartCardClassName}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Completion vs Load (Bubble)</CardTitle>
                  <CardDescription>Relationship: drop points vs completion rate</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 12, right: 20, left: 8, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                        <XAxis dataKey="dropPointsTotal" name="Drop Points" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <YAxis dataKey="completionRate" name="Completion %" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <ZAxis dataKey="dropPointsCompleted" range={[40, 260]} />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={chartTooltipStyle} />
                        <Scatter data={transportBubbleChart} fill="#0ea5e9" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
            <Card className="rounded-2xl border border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Transportation & Delivery Status Report</CardTitle>
                  <CardDescription>Trip assignment and completion details</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Trip</th>
                        <th className="p-3 text-left">Driver</th>
                        <th className="p-3 text-left">Vehicle</th>
                        <th className="p-3 text-left">Status</th>
                        <th className="p-3 text-left">Completion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(transportRows).map((row, index) => (
                        <tr key={`${row.tripNumber}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.tripNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.driver || 'N/A')}</td>
                          <td className="p-3">{String(row.vehicle || 'N/A')}</td>
                          <td className="p-3">{String(row.status || 'N/A')}</td>
                          <td className="p-3">{String(row.dropPointsCompleted || 0)}/{String(row.dropPointsTotal || 0)} ({String(row.completionRate || 0)}%)</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {transportRows.length === 0 ? <p className="py-8 text-center text-gray-500">No trips found for this range</p> : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="warehouse" className="space-y-4">
            {reportToolbar({
              title: 'Warehouse',
              statusLabel: 'Movement Types',
              statusOptions: inventoryMovementTypeOptions,
              statusValue: selectedMovementType,
              onStatusChange: setSelectedMovementType,
              showWarehouse: true,
            })}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total SKUs</CardDescription><CardTitle className="text-[30px] leading-none">{inventoryKpi.totalSkus}</CardTitle><p className="text-[11px] text-slate-400">-- 0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Low Stock SKUs</CardDescription><CardTitle className="text-[30px] leading-none">{inventoryKpi.lowStock}</CardTitle><p className="text-[11px] text-slate-400">-- 0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total On Hand</CardDescription><CardTitle className="text-[30px] leading-none">{inventoryKpi.totalQuantity}</CardTitle><p className="text-[11px] text-emerald-600">+12.5% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Stock In</CardDescription><CardTitle className="text-[30px] leading-none text-blue-600">{inventoryKpi.stockIn}</CardTitle><p className="text-[11px] text-emerald-600">+28.3% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Stock Out</CardDescription><CardTitle className="text-[30px] leading-none text-amber-600">{inventoryKpi.stockOut}</CardTitle><p className="text-[11px] text-emerald-600">+15.4% vs prev {rangeDays} days</p></CardHeader></Card>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className={chartCardClassName}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Warehouse Capacity vs Used</CardTitle>
                  <CardDescription>Utilization percentage per warehouse</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    {warehouseCapacityVsUsedChart.length === 0 ? (
                      <p className="py-8 text-center text-gray-500">No warehouse capacity data available</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={warehouseCapacityVsUsedChart} margin={{ top: 15, right: 20, left: 0, bottom: 40 }}>
                          <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} domain={[0, 100]} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                          <Tooltip
                            contentStyle={chartTooltipStyle}
                            formatter={(value: any, name: any) => [`${Number(value).toLocaleString()}%`, name === 'capacityPercent' ? 'Capacity' : 'Used']}
                          />
                          <Legend wrapperStyle={{ paddingTop: '14px', color: '#475569' }} />
                          <Bar dataKey="capacityPercent" name="Capacity" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="usedPercent" name="Used" fill="#10b981" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card className={chartCardClassName}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">Inventory Movement by Product</CardTitle>
                      <CardDescription>Top products by movement volume</CardDescription>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                      Top 5 Products
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    {inventoryMovementByProductChart.length === 0 ? (
                      <p className="py-8 text-center text-gray-500">No product movement data for this range</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={inventoryMovementByProductChart.slice(0, 5)} margin={{ top: 10, right: 20, left: 0, bottom: 26 }} barGap={8}>
                          <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                          <YAxis
                            allowDecimals={false}
                            tick={{ fontSize: 11, fill: '#6b7280' }}
                            axisLine={false}
                            tickLine={false}
                            tickCount={5}
                          />
                          <Legend
                            verticalAlign="top"
                            align="center"
                            wrapperStyle={{ paddingBottom: '8px', color: '#64748b', fontSize: '12px' }}
                            iconType="rect"
                          />
                          <Tooltip
                            contentStyle={chartTooltipStyle}
                            formatter={(value: any, name: any) => [`${Number(value).toLocaleString()} units`, name]}
                          />
                          <Bar dataKey="inQty" name="Stock In" fill="#38bdf8" radius={[4, 4, 0, 0]} maxBarSize={22}>
                            <LabelList dataKey="inQty" position="top" fill="#0f172a" fontSize={11} />
                          </Bar>
                          <Bar dataKey="outQty" name="Stock Out" fill="#fbbf24" radius={[4, 4, 0, 0]} maxBarSize={22}>
                            <LabelList dataKey="outQty" position="top" fill="#0f172a" fontSize={11} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
            <Card className={chartCardClassName}>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="text-3xl font-bold tracking-tight text-slate-800">Stock In vs Stock Out Trend</CardTitle>
                    <CardDescription>Track stock movement over time</CardDescription>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500">
                    {inventoryMovementChart[0]?.label || 'N/A'} - {inventoryMovementChart[inventoryMovementChart.length - 1]?.label || 'N/A'}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {inventoryMovementChart.length === 0 ? (
                  <p className="py-8 text-center text-gray-500">No movement trend data for this range</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-2">
                      <div className="rounded-2xl border border-blue-100 bg-slate-50 p-5">
                        <p className="text-sm font-medium text-slate-600">Total Stock In</p>
                        <p className="text-4xl font-bold text-blue-600 mt-1">{stockTrendSummary.totalIn.toLocaleString()}</p>
                        <p className="text-sm text-slate-500">units</p>
                        <p className="mt-2 inline-block rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                          {stockTrendSummary.inChangePercent >= 0 ? '+' : ''}{stockTrendSummary.inChangePercent.toFixed(1)}% vs previous period
                        </p>
                      </div>
                      <div className="rounded-2xl border border-amber-100 bg-amber-50/40 p-5">
                        <p className="text-sm font-medium text-slate-600">Total Stock Out</p>
                        <p className="text-4xl font-bold text-amber-600 mt-1">{stockTrendSummary.totalOut.toLocaleString()}</p>
                        <p className="text-sm text-slate-500">units</p>
                        <p className="mt-2 inline-block rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                          {stockTrendSummary.outChangePercent >= 0 ? '+' : ''}{stockTrendSummary.outChangePercent.toFixed(1)}% vs previous period
                        </p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="h-[360px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={inventoryMovementChart} margin={{ top: 24, right: 22, left: 8, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} />
                          <Tooltip
                            contentStyle={chartTooltipStyle}
                            labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
                            formatter={(value: any, name: any) => [`${Number(value).toLocaleString()} units`, name]}
                          />
                          <Legend wrapperStyle={{ paddingTop: '8px', color: '#475569' }} iconType="circle" verticalAlign="top" height={24} />
                          <Line type="monotone" dataKey="inQty" name="Stock In" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4, fill: '#2563eb' }} animationDuration={1000} isAnimationActive>
                            <LabelList dataKey="inQty" position="top" style={{ fill: '#2563eb', fontSize: 11, fontWeight: 700 }} />
                          </Line>
                          <Line type="monotone" dataKey="outQty" name="Stock Out" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 4, fill: '#f59e0b' }} animationDuration={1000} isAnimationActive>
                            <LabelList dataKey="outQty" position="bottom" style={{ fill: '#d97706', fontSize: 11, fontWeight: 700 }} />
                          </Line>
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-2xl border border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Warehouse & Inventory Movement Report</CardTitle>
                  <CardDescription>Stock transactions and movement history</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Date</th>
                        <th className="p-3 text-left">Warehouse</th>
                        <th className="p-3 text-left">Product</th>
                        <th className="p-3 text-left">Type</th>
                        <th className="p-3 text-left">Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(inventoryMovementRows).map((row, index) => (
                        <tr key={`${row.createdAt}-${index}`} className="border-b last:border-0">
                          <td className="p-3">{formatDateTime(row.createdAt)}</td>
                          <td className="p-3">{String(row.warehouse || 'N/A')}</td>
                          <td className="p-3">{String(row.product || 'N/A')}</td>
                          <td className="p-3">{String(row.type || 'N/A')}</td>
                          <td className="p-3">{String(row.quantity || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {inventoryMovementRows.length === 0 ? <p className="py-8 text-center text-gray-500">No inventory movement found for this range</p> : null}
                </div>
              </CardContent>
            </Card>

          </TabsContent>

          <TabsContent value="replacement" className="space-y-4">
            {reportToolbar({
              title: 'Replacement',
              statusLabel: 'Replacement Statuses',
              statusOptions: replacementStatusOptions,
              statusValue: selectedReplacementStatus,
              onStatusChange: setSelectedReplacementStatus,
              showWarehouse: true,
              showStatus: false,
            })}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total Cases</CardDescription><CardTitle className="text-[30px] leading-none">{replacementKpi.total}</CardTitle><p className="text-[11px] text-slate-400">-- 0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Processed</CardDescription><CardTitle className="text-[30px] leading-none">{replacementKpi.completed}</CardTitle><p className="text-[11px] text-emerald-600">+0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Open Cases</CardDescription><CardTitle className="text-[30px] leading-none">{replacementKpi.open}</CardTitle><p className="text-[11px] text-slate-400">-- 0% vs prev {rangeDays} days</p></CardHeader></Card>
            </div>
            <Card className={chartCardClassName}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Replacement Loss Trend (Line)</CardTitle>
                <CardDescription>Total replacement loss over time based on current filters</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72 w-full">
                  {replacementLossTrendChart.length === 0 ? (
                    <p className="py-8 text-center text-gray-500">No loss trend data for this range</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={replacementLossTrendChart} margin={{ top: 12, right: 20, left: 0, bottom: 26 }}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(value: any) => formatPeso(Number(value || 0))}
                        />
                        <Tooltip
                          contentStyle={chartTooltipStyle}
                          labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
                          formatter={(value: any) => [`- ${formatPeso(Number(value || 0))}`, 'Total Loss']}
                        />
                        <Legend verticalAlign="top" wrapperStyle={{ fontSize: '12px', color: '#64748b' }} />
                        <Line type="monotone" dataKey="loss" name="Total Loss" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 4, fill: '#ef4444' }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Returned or Damaged Products Report</CardTitle>
                  <CardDescription>Replacement handling and case tracking</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Replacement #</th>
                        <th className="p-3 text-left">Order #</th>
                        <th className="p-3 text-left">Customer</th>
                        <th className="p-3 text-left">Assigned Driver</th>
                        <th className="p-3 text-left">Status</th>
                        <th className="p-3 text-left">Total Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(replacementRows).map((row, index) => (
                        <tr key={`${row.replacementNumber}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.replacementNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.orderNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.customer || 'N/A')}</td>
                          <td className="p-3">{String(row.assignedDriver || 'N/A')}</td>
                          <td className="p-3">{String(row.status || 'N/A')}</td>
                          <td className="p-3 font-semibold text-red-600">- {formatPeso(Number(row.totalLoss || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {replacementRows.length === 0 ? <p className="py-8 text-center text-gray-500">No replacement records found for this range</p> : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="feedback" className="space-y-4">
            {reportToolbar({
              title: 'Feedback',
              statusLabel: 'Feedback Statuses',
              statusOptions: feedbackStatusOptions,
              statusValue: selectedFeedbackStatus,
              onStatusChange: setSelectedFeedbackStatus,
              showStatus: false,
            })}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total Feedback</CardDescription><CardTitle className="text-[30px] leading-none">{feedbackKpi.total}</CardTitle><p className="text-[11px] text-slate-400">-- 0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Average Rating</CardDescription><CardTitle className="text-[30px] leading-none">{feedbackKpi.avgRating.toFixed(2)}</CardTitle><p className="text-[11px] text-emerald-600">+0% vs prev {rangeDays} days</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Open Items</CardDescription><CardTitle className="text-[30px] leading-none">{feedbackKpi.open}</CardTitle><p className="text-[11px] text-slate-400">-- 0% vs prev {rangeDays} days</p></CardHeader></Card>
            </div>
            <Card className={chartCardClassName}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Ratings Distribution</CardTitle>
                <CardDescription>Client rating spread from 1 to 5</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72 w-full">
                  {feedbackRatingTotal === 0 ? (
                    <p className="py-8 text-center text-gray-500">No feedback rating data for this range</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={feedbackRatingChart} margin={{ top: 15, right: 30, left: 0, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                        <XAxis
                          dataKey="rating"
                          tick={{ fontSize: 14, fill: '#64748b', fontWeight: 'bold' }}
                          axisLine={false}
                          tickLine={false}
                          label={{ value: 'Star Rating', position: 'insideBottom', offset: -10, style: { fontSize: 12 } }}
                        />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <Tooltip
                          cursor={false}
                          contentStyle={chartTooltipStyle}
                          labelStyle={{ color: '#e2e8f0', fontWeight: 600 }}
                          formatter={(value: any) => [`${Number(value).toLocaleString()} ratings`, 'Count']}
                        />
                        <Bar dataKey="count" radius={[8, 8, 0, 0]} animationDuration={800} maxBarSize={42}>
                          {feedbackRatingChart.map((entry) => {
                            const rating = Number(entry.rating)
                            let color = '#ef4444'
                            if (rating === 5) color = '#22c55e'
                            else if (rating === 4) color = '#3b82f6'
                            else if (rating === 3) color = '#fbbf24'
                            else if (rating === 2) color = '#f97316'
                            return <Cell key={entry.rating} fill={color} />
                          })}
                          <LabelList
                            dataKey="count"
                            position="top"
                            fill="#0f172a"
                            fontSize={11}
                            formatter={(value: any) => (Number(value) > 0 ? String(value) : '')}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Client Feedback & Service Evaluation Report</CardTitle>
                  <CardDescription>Customer ratings and evaluation records</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Date</th>
                        <th className="p-3 text-left">Customer</th>
                        <th className="p-3 text-left">Type</th>
                        <th className="p-3 text-left">Rating</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(feedbackRows).map((row, index) => (
                        <tr key={`${row.createdAt}-${index}`} className="border-b last:border-0">
                          <td className="p-3">{formatDateTime(row.createdAt)}</td>
                          <td className="p-3">{String(row.customer || 'N/A')}</td>
                          <td className="p-3">{String(row.type || 'N/A')}</td>
                          <td className="p-3">{String(row.rating || 'N/A')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {feedbackRows.length === 0 ? <p className="py-8 text-center text-gray-500">No feedback records found for this range</p> : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}






