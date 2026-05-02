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
          fetchAllPaginatedCollection<any>('/api/orders?includeItems=none', 'orders', undefined, {
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
    return replacementsData
      .filter((item) => withinRange(item.createdAt, rangeStart))
      .map((item) => {
        const relatedOrder = orders.find((order) => order.id === item.order)
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
          orderNumber: relatedOrder?.orderNumber || 'N/A',
          customer: relatedOrder?.customer?.name || 'N/A',
          status: normalizedStatus,
          replacementMode: item.replacementMode ? String(item.replacementMode).replace(/_/g, ' ') : 'N/A',
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

  const orderStatusTotal = useMemo(() => {
    return orderStatusChart.reduce((sum, row) => sum + Number(row.count || 0), 0)
  }, [orderStatusChart])

  const transportStatusChart = useMemo(() => {
    const counts = new Map<string, number>()
    transportRows.forEach((row) => {
      const key = String(row.status || 'UNKNOWN')
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return Array.from(counts.entries()).map(([status, count]) => ({ status, count }))
  }, [transportRows])

  const inventoryMovementChart = useMemo(() => {
    const grouped = new Map<string, { day: string; inQty: number; outQty: number }>()
    inventoryMovementRows.forEach((row) => {
      const day = formatDayLabel(row.createdAt)
      const current = grouped.get(day) || { day, inQty: 0, outQty: 0 }
      if (String(row.type || '').toUpperCase() === 'IN') current.inQty += Number(row.quantity || 0)
      if (String(row.type || '').toUpperCase() === 'OUT') current.outQty += Number(row.quantity || 0)
      grouped.set(day, current)
    })
    return Array.from(grouped.values()).slice(-12)
  }, [inventoryMovementRows])

  const replacementStatusChart = useMemo(() => {
    const counts = new Map<string, number>()
    replacementRows.forEach((row) => {
      const key = String(row.status || 'UNKNOWN')
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return Array.from(counts.entries()).map(([status, count]) => ({ status, count }))
  }, [replacementRows])

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

  const warehouseComplianceKpi = useMemo(() => {
    const total = warehouseDispatchRows.length
    const checklistComplete = warehouseDispatchRows.filter((row) => row.checklistComplete === 'YES').length
    return { total, checklistComplete }
  }, [warehouseDispatchRows])

  const warehouseComplianceTrend = useMemo(() => {
    const grouped = new Map<string, { day: string; compliant: number; nonCompliant: number }>()
    warehouseDispatchRows.forEach((row) => {
      const key = formatDayLabel(row.createdAt)
      const current = grouped.get(key) || { day: key, compliant: 0, nonCompliant: 0 }
      const isCompliant = row.checklistComplete === 'YES'
      if (isCompliant) {
        current.compliant += 1
      } else {
        current.nonCompliant += 1
      }
      grouped.set(key, current)
    })
    return Array.from(grouped.values()).slice(-14)
  }, [warehouseDispatchRows])

  const replacementKpi = useMemo(() => {
    const total = replacementRows.length
    const completed = replacementRows.filter((row) => row.status === 'COMPLETED' || row.status === 'RESOLVED_ON_DELIVERY').length
    const open = replacementRows.filter((row) => row.status === 'REPORTED' || row.status === 'IN_PROGRESS' || row.status === 'NEEDS_FOLLOW_UP').length
    return { total, completed, open }
  }, [replacementRows])

  const feedbackKpi = useMemo(() => {
    const total = feedbackRows.length
    const ratings = feedbackRows
      .map((row) => Number(row.rating))
      .filter((rating) => Number.isFinite(rating))
    const avgRating = ratings.length > 0 ? ratings.reduce((acc, rating) => acc + rating, 0) / ratings.length : 0
    const open = feedbackRows.filter((row) => String(row.status).toUpperCase() === 'OPEN').length
    return { total, avgRating, open }
  }, [feedbackRows])

  const reportChartPalette = ['#0ea5b7', '#c7d619', '#6b7280', '#8b5cf6', '#2563eb']

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
  }: {
    title: string
    statusLabel: string
    statusOptions: string[]
    statusValue: string
    onStatusChange: (value: string) => void
    showWarehouse?: boolean
    showDriver?: boolean
  }) => (
    <div className="rounded-xl border border-sky-100 bg-white/80 p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
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
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
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
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
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
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
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
        <Button variant="outline" className="gap-2" onClick={resetFilters}>
          Reset Filters
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => void exportCurrentPdf()} disabled={isLoading}>
          <Download className="h-4 w-4" />
          Export {title} PDF
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
            .signatures { margin-top: 24px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
            .signature-line { margin-top: 32px; border-top: 1px solid #111; padding-top: 6px; font-size: 11px; }
          </style>
        </head>
        <body>
          <h1>${reportBranding.companyName}</h1>
          <h2>${reportBranding.subtitle}</h2>
          <p><strong>${report.title}</strong></p>
          <p>Generated at ${new Date().toLocaleString()} | Date range: last ${rangeDays} days | Prepared by: ${reportBranding.preparedBy}</p>
          <table>
            <thead>
              <tr>${columns.map((column) => `<th>${column}</th>`).join('')}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
          <p className="text-gray-500">Order, transport, warehouse, replacement, and feedback reports</p>
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
          <div className="rounded-xl border border-sky-100 bg-white/80 p-3 shadow-sm">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-2 p-1 md:grid-cols-5">
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="transport">Transport</TabsTrigger>
              <TabsTrigger value="warehouse">Warehouse/Inventory</TabsTrigger>
              <TabsTrigger value="replacement">Replacement</TabsTrigger>
              <TabsTrigger value="feedback">Feedback</TabsTrigger>
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Card><CardHeader><CardDescription>Total Orders</CardDescription><CardTitle>{orderKpi.total}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Delivered</CardDescription><CardTitle>{orderKpi.delivered}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Fulfillment Rate</CardDescription><CardTitle>{orderKpi.fulfillmentRate}%</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Delivered Revenue</CardDescription><CardTitle>{formatPeso(orderKpi.deliveredRevenue)}</CardTitle></CardHeader></Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Orders by Status</CardTitle>
                <CardDescription>Status distribution for selected period</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {orderStatusChart.length === 0 ? (
                    <p className="py-8 text-center text-gray-500">No order status data for this range</p>
                  ) : (
                    orderStatusChart
                      .slice()
                      .sort((a, b) => Number(b.count) - Number(a.count))
                      .map((item) => {
                        const count = Number(item.count || 0)
                        const percent = orderStatusTotal > 0 ? Math.round((count / orderStatusTotal) * 100) : 0
                        return (
                          <div key={item.status} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium text-gray-800">{item.status}</span>
                              <span className="text-gray-600">{count} ({percent}%)</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
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
                      {previewRows(orderRows).map((row, index) => (
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
                  {orderRows.length === 0 ? <p className="py-8 text-center text-gray-500">No orders found for this range</p> : null}
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Card><CardHeader><CardDescription>Total Trips</CardDescription><CardTitle>{transportKpi.total}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Completed Trips</CardDescription><CardTitle>{transportKpi.completed}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>In Progress</CardDescription><CardTitle>{transportKpi.inProgress}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Average Completion</CardDescription><CardTitle>{transportKpi.averageCompletion}%</CardTitle></CardHeader></Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Transport Status Distribution</CardTitle>
                <CardDescription>Trips by current status</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  {transportStatusChart.length === 0 ? (
                    <p className="py-8 text-center text-gray-500">No transport status data for this range</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={transportStatusChart.slice().sort((a, b) => Number(b.count) - Number(a.count))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="status" />
                        <YAxis allowDecimals={false} />
                        <Tooltip formatter={(value: any) => [Number(value).toLocaleString(), 'Trips']} />
                        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                          {transportStatusChart.map((entry, index) => (
                            <Cell key={entry.status} fill={reportChartPalette[index % reportChartPalette.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <Card><CardHeader><CardDescription>Total SKUs</CardDescription><CardTitle>{inventoryKpi.totalSkus}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Low Stock SKUs</CardDescription><CardTitle>{inventoryKpi.lowStock}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Total On Hand</CardDescription><CardTitle>{inventoryKpi.totalQuantity}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Stock In</CardDescription><CardTitle>{inventoryKpi.stockIn}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Stock Out</CardDescription><CardTitle>{inventoryKpi.stockOut}</CardTitle></CardHeader></Card>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card><CardHeader><CardDescription>Dispatch Candidates</CardDescription><CardTitle>{warehouseComplianceKpi.total}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Checklist Complete</CardDescription><CardTitle>{warehouseComplianceKpi.checklistComplete}</CardTitle></CardHeader></Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Stock In vs Stock Out Trend</CardTitle>
                <CardDescription>Movement by day</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  {inventoryMovementChart.length === 0 ? (
                    <p className="py-8 text-center text-gray-500">No movement trend data for this range</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={inventoryMovementChart}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="day" />
                        <YAxis allowDecimals={false} />
                        <Tooltip formatter={(value: any) => [Number(value).toLocaleString(), 'Qty']} />
                        <Area type="monotone" dataKey="inQty" name="Stock In" stroke="#0ea5b7" fill="#99f6e4" fillOpacity={0.85} />
                        <Area type="monotone" dataKey="outQty" name="Stock Out" stroke="#c7d619" fill="#ecfccb" fillOpacity={0.8} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
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

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Warehouse Dispatch Compliance Report</CardTitle>
                  <CardDescription>Checklist visibility for load/dispatch</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Order</th>
                        <th className="p-3 text-left">Stage</th>
                        <th className="p-3 text-left">Checklist</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(warehouseDispatchRows).map((row, index) => (
                        <tr key={`${row.orderNumber}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.orderNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.warehouseStage || 'N/A')}</td>
                          <td className="p-3">{String(row.checklistComplete || 'NO')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {warehouseDispatchRows.length === 0 ? <p className="py-8 text-center text-gray-500">No warehouse dispatch compliance records for this range</p> : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Dispatch Compliance Trend</CardTitle>
                <CardDescription>Daily compliant vs non-compliant dispatch records</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  {warehouseComplianceTrend.length === 0 ? (
                    <p className="py-8 text-center text-gray-500">No dispatch compliance trend data for this range</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={warehouseComplianceTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="day" />
                        <YAxis allowDecimals={false} />
                        <Tooltip formatter={(value: any) => [Number(value).toLocaleString(), 'Orders']} />
                        <Line type="monotone" dataKey="compliant" stroke="#0ea5b7" strokeWidth={3} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="nonCompliant" stroke="#6b7280" strokeWidth={2.5} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
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
            })}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card><CardHeader><CardDescription>Total Cases</CardDescription><CardTitle>{replacementKpi.total}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Processed</CardDescription><CardTitle>{replacementKpi.completed}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Open Cases</CardDescription><CardTitle>{replacementKpi.open}</CardTitle></CardHeader></Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Replacement Case Status</CardTitle>
                <CardDescription>Status distribution of replacement cases</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  {replacementStatusChart.length === 0 ? (
                    <p className="py-8 text-center text-gray-500">No replacement status data for this range</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={replacementStatusChart.slice().sort((a, b) => Number(b.count) - Number(a.count))}
                          dataKey="count"
                          nameKey="status"
                          innerRadius={55}
                          outerRadius={95}
                          paddingAngle={2}
                        >
                          {replacementStatusChart.map((entry, index) => (
                            <Cell key={entry.status} fill={reportChartPalette[index % reportChartPalette.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: any, name: any) => [Number(value).toLocaleString(), String(name)]} />
                        <Legend verticalAlign="bottom" height={36} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
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
                        <th className="p-3 text-left">Status</th>
                        <th className="p-3 text-left">Mode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(replacementRows).map((row, index) => (
                        <tr key={`${row.replacementNumber}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.replacementNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.orderNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.customer || 'N/A')}</td>
                          <td className="p-3">{String(row.status || 'N/A')}</td>
                          <td className="p-3">{String(row.replacementMode || 'N/A')}</td>
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
            })}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card><CardHeader><CardDescription>Total Feedback</CardDescription><CardTitle>{feedbackKpi.total}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Average Rating</CardDescription><CardTitle>{feedbackKpi.avgRating.toFixed(2)}</CardTitle></CardHeader></Card>
              <Card><CardHeader><CardDescription>Open Items</CardDescription><CardTitle>{feedbackKpi.open}</CardTitle></CardHeader></Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Ratings Distribution</CardTitle>
                <CardDescription>Client rating spread from 1 to 5</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  {feedbackRatingTotal === 0 ? (
                    <p className="py-8 text-center text-gray-500">No feedback rating data for this range</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={feedbackRatingChart}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="rating" />
                        <YAxis allowDecimals={false} />
                        <Tooltip formatter={(value: any) => [Number(value).toLocaleString(), 'Ratings']} />
                        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                          {feedbackRatingChart.map((entry, index) => (
                            <Cell key={entry.rating} fill={reportChartPalette[index % reportChartPalette.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
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
                        <th className="p-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(feedbackRows).map((row, index) => (
                        <tr key={`${row.createdAt}-${index}`} className="border-b last:border-0">
                          <td className="p-3">{formatDateTime(row.createdAt)}</td>
                          <td className="p-3">{String(row.customer || 'N/A')}</td>
                          <td className="p-3">{String(row.type || 'N/A')}</td>
                          <td className="p-3">{String(row.rating || 'N/A')}</td>
                          <td className="p-3">{String(row.status || 'N/A')}</td>
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
