'use client'

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
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
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, Clock, CheckCircle, XCircle, MapPin, TrendingUp, UserCheck, MessageSquare, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, Database, FileText, Users, Star, Download, Pencil, Trash2 } from 'lucide-react'
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, LineChart, Line, Tooltip, Cell, BarChart, Bar, ResponsiveContainer, Legend, ScatterChart, Scatter, ZAxis, LabelList, PieChart, Pie } from 'recharts'
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
import {
  buildOrderReportRows,
  buildOrderReportStatusBreakdown,
  buildOrderReportStatusOptions,
  buildOrderReportVolumeChart,
  buildInventoryMovementChart,
  buildInventoryMovementRows,
  buildInventoryMovementTypeOptions,
  buildWarehouseCapacityVsUsedChart,
  formatOrderReportStatus,
  formatReportProductName,
  getInventoryAvailableQty,
  getInventoryQuantity,
  getInventoryThreshold,
  summarizeOrderReportRows,
  summarizeInventoryMovementRows,
  summarizeInventoryMovementTrend,
  summarizeStockHealth,
} from '@/lib/report-metrics'

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
  const [stockBatches, setStockBatches] = useState<any[]>([])
  const reportBranding = {
    companyName: "Ann Ann's Beverages Trading",
  }
  useEffect(() => {
    let isMounted = true

    async function fetchReportsPack() {
      setIsLoading(true)
      try {
        const [ordersRes, tripsRes, driversRes, warehousesRes, inventoryRes, transactionsRes, replacementsRes, feedbackRes, stockBatchesRes] = await Promise.all([
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
          safeFetchJson('/api/stock-batches?page=1&pageSize=2000', undefined, { retries: 5, timeoutMs: 20000 }),
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
        // The stock batches endpoint returns `stockBatches`, not `batches`, so read the real collection key first.
        setStockBatches(stockBatchesRes.ok ? getCollection<any>(stockBatchesRes.data, ['stockBatches', 'batches']) : [])
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
          setStockBatches([])
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

  // The order report uses a single normalized row model so cards, charts, exports, and the table stay in sync.
  const orderRows = useMemo(() => {
    return buildOrderReportRows(orders, {
      rangeStart,
      selectedWarehouse,
      selectedOrderStatus,
      getWarehouseIdFromRow,
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
    return buildInventoryMovementRows(inventoryTransactions, {
      rangeStart,
      selectedWarehouse,
      selectedMovementType,
      getWarehouseIdFromRow,
    })
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
          const matchedOrderItem = orderItems.find((orderItem: any) => {
            const srcOrderItemId = String(line?.orderItemId ?? '').trim()
            const oiId = String(orderItem?.id ?? '').trim()
            if (srcOrderItemId && oiId && srcOrderItemId === oiId) return true
            const srcProductId = String(line?.productId ?? line?.originalProductId ?? line?.replacementProductId ?? '').trim()
            const oiProductId = String(orderItem?.product?.id ?? orderItem?.productId ?? '').trim()
            return Boolean(srcProductId && oiProductId && srcProductId === oiProductId)
          })

          const unitPrice = Number(
            line?.unitPrice ??
            line?.price ??
            line?.sellingPrice ??
            line?.replacementUnitPrice ??
            line?.originalUnitPrice ??
            matchedOrderItem?.unitPrice ??
            matchedOrderItem?.price ??
            matchedOrderItem?.product?.price ??
            NaN
          )
          const basePrice = Number.isFinite(unitPrice) ? unitPrice : 0
          if (basePrice <= 0 || qty <= 0) return sum

          const qtyPerCase = Math.max(
            1,
            Number(
              line?.quantityPerCase ??
              matchedOrderItem?.product?.quantityPerCase ??
              matchedOrderItem?.product?.quantityPerUnit ??
              1
            )
          )
          const effectiveUnit = String(
            line?.productUnit ??
            line?.replacementProductUnit ??
            line?.originalProductUnit ??
            matchedOrderItem?.product?.unit ??
            matchedOrderItem?.unit ??
            ''
          ).trim().toLowerCase()
          const isBottleUnit = effectiveUnit.includes('bottle')
          const replacedQtyInBillingUnit = isBottleUnit ? qty : (qty / qtyPerCase)
          return sum + (replacedQtyInBillingUnit * basePrice)
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

  // Batch expiry stays under inventory reporting so stock age is reviewed alongside movement and low-stock risks.
  const stockExpiryRows = useMemo(() => {
    const now = new Date()
    return stockBatches
      .filter((batch) => selectedWarehouse === 'all' || String(batch.inventory?.warehouse?.id || '') === selectedWarehouse)
      .map((batch) => {
        // The backend persists manufactured date in `receipt_date`, so the report exposes it with the correct business label.
        const manufacturedDateValue = batch.manufacturedDate || batch.manufactured_date || batch.receiptDate || batch.receipt_date || batch.createdAt || null
        const expiryDateValue = batch.expiryDate || batch.expiry_date || null
        const expiryDate = expiryDateValue ? new Date(expiryDateValue) : null
        const manufacturedDate = manufacturedDateValue ? new Date(manufacturedDateValue) : null
        const daysUntilExpiry = expiryDate ? Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null
        return {
          batchNumber: batch.batchNumber || batch.batch_number || 'N/A',
          product: formatReportProductName(batch.inventory?.product, 'N/A'),
          sku: batch.inventory?.product?.sku || 'N/A',
          warehouse: batch.inventory?.warehouse?.name || 'N/A',
          quantity: Number(batch.quantity || 0),
          manufacturedDate: manufacturedDate ? formatReportDateOnly(manufacturedDateValue) : 'N/A',
          expiryDate: expiryDate ? formatReportDateOnly(expiryDateValue) : 'N/A',
          daysUntilExpiry: daysUntilExpiry !== null ? daysUntilExpiry : 'N/A',
          status: daysUntilExpiry !== null
            ? daysUntilExpiry < 0 ? 'EXPIRED'
              : daysUntilExpiry <= 30 ? 'CRITICAL'
                : daysUntilExpiry <= 60 ? 'WARNING'
                  : 'GOOD'
            : 'N/A',
        }
      })
      .filter((row) => row.status !== 'N/A')
      .sort((a, b) => {
        const aDays = typeof a.daysUntilExpiry === 'number' ? a.daysUntilExpiry : Infinity
        const bDays = typeof b.daysUntilExpiry === 'number' ? b.daysUntilExpiry : Infinity
        return aDays - bDays
      })
  }, [selectedWarehouse, stockBatches])

  // Driver Performance Report Rows - tracks driver metrics
  const driverPerformanceRows = useMemo(() => {
    const tripStats = new Map<string, { total: number; completed: number; onTime: number }>()
    trips.forEach((trip) => {
      const driverId = trip.driver?.id
      if (!driverId) return
      const stats = tripStats.get(driverId) || { total: 0, completed: 0, onTime: 0 }
      stats.total++
      if (normalizeTripStatus(trip.status) === 'COMPLETED') stats.completed++
      if (trip.actualEndAt && trip.plannedEndAt) {
        const actual = new Date(trip.actualEndAt).getTime()
        const planned = new Date(trip.plannedEndAt).getTime()
        if (actual <= planned) stats.onTime++
      }
      tripStats.set(driverId, stats)
    })

    return drivers.map((driver) => {
      const stats = tripStats.get(driver.id) || { total: 0, completed: 0, onTime: 0 }
      const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0
      const onTimeRate = stats.total > 0 ? Math.round((stats.onTime / stats.total) * 100) : 0
      const licenseExpiry = driver.licenseExpiry ? new Date(driver.licenseExpiry) : null
      const daysUntilExpiry = licenseExpiry ? Math.ceil((licenseExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null

      return {
        driverName: driver.user?.name || driver.name || 'N/A',
        licenseNumber: driver.licenseNumber || 'N/A',
        licenseType: driver.licenseType || 'N/A',
        licenseStatus: daysUntilExpiry !== null
          ? daysUntilExpiry < 0 ? 'EXPIRED'
            : daysUntilExpiry <= 30 ? 'EXPIRING_SOON'
              : 'VALID'
          : 'N/A',
        licenseExpiry: licenseExpiry ? formatDateTime(driver.licenseExpiry) : 'N/A',
        rating: Number(driver.rating || 0).toFixed(1),
        totalDeliveries: Number(driver.totalDeliveries || 0),
        totalTrips: stats.total,
        completedTrips: stats.completed,
        completionRate: `${completionRate}%`,
        onTimeRate: `${onTimeRate}%`,
        isActive: driver.isActive ? 'Active' : 'Inactive',
      }
    }).sort((a, b) => Number(b.totalTrips) - Number(a.totalTrips))
  }, [drivers, trips])

  // Low Stock Alert Rows - tracks products below minimum stock levels
  const lowStockRows = useMemo(() => {
    return inventory
      .filter((item) => selectedWarehouse === 'all' || String(item.warehouse?.id) === selectedWarehouse)
      .map((item) => {
        // Low-stock reporting needs to use available stock after reservations or the report hides real shortages.
        const quantity = getInventoryAvailableQty(item)
        const minStock = getInventoryThreshold(item)
        const reorderPoint = Math.max(minStock, Number(item.reorderPoint || item.reorder_point || minStock))
        const maxStock = Number(item.maxStock || 100)
        const shortage = Math.max(0, reorderPoint - quantity)
        const stockPercent = maxStock > 0 ? Math.round((quantity / maxStock) * 100) : 0

        return {
          warehouse: item.warehouse?.name || 'N/A',
          // Low-stock labels need the same visible size suffix as orders and movement rows.
          product: formatReportProductName(item.product, 'N/A'),
          sku: item.product?.sku || 'N/A',
          currentStock: quantity,
          minStock,
          reorderPoint,
          maxStock,
          shortage,
          stockPercent,
          status: quantity <= 0 ? 'OUT_OF_STOCK'
            : quantity < minStock ? 'CRITICAL'
              : quantity < reorderPoint ? 'LOW'
                : 'OK',
          suggestedReorder: shortage > 0 ? Math.ceil(shortage * 1.2) : 0,
        }
      })
      .filter((row) => row.status !== 'OK')
      .sort((a, b) => a.currentStock - b.currentStock)
  }, [inventory, selectedWarehouse])

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
    return buildInventoryMovementTypeOptions(inventoryTransactions, {
      rangeStart,
      selectedWarehouse,
      getWarehouseIdFromRow,
    })
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

  const orderStatusOptions = useMemo(() => buildOrderReportStatusOptions(
    buildOrderReportRows(orders, {
      rangeStart,
      selectedWarehouse,
      selectedOrderStatus: 'all',
      getWarehouseIdFromRow,
    })
  ), [orders, rangeStart, selectedWarehouse])

  const orderStatusChart = useMemo(() => {
    return buildOrderReportStatusBreakdown(orderRows)
  }, [orderRows])

  const inventoryMovementChart = useMemo(() => {
    return buildInventoryMovementChart(inventoryMovementRows, {
      rangeDays,
      rangeStart,
    })
  }, [inventoryMovementRows, rangeDays, rangeStart])

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

  // This chart intentionally tracks total order intake volume instead of outcome lines to match the report layout.
  const orderOutcomeTrendChart = useMemo(() => {
    return buildOrderReportVolumeChart(orderRows, {
      rangeDays,
      rangeStart,
    })
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

  const inventoryMovementSummary = useMemo(() => summarizeInventoryMovementRows(inventoryMovementRows), [inventoryMovementRows])

  const stockTrendSummary = useMemo(() => summarizeInventoryMovementTrend(inventoryMovementChart), [inventoryMovementChart])

  const warehouseCapacityVsUsedChart = useMemo(() => {
    return buildWarehouseCapacityVsUsedChart(warehouses, inventory, {
      selectedWarehouse,
      getWarehouseIdFromRow,
    })
  }, [warehouses, selectedWarehouse, inventory])

  const scopedInventory = useMemo(() => {
    return inventory.filter((item) => selectedWarehouse === 'all' || getWarehouseIdFromRow(item) === selectedWarehouse)
  }, [inventory, selectedWarehouse])

  const scopedInventoryHealth = useMemo(() => summarizeStockHealth(scopedInventory), [scopedInventory])

  const orderKpi = useMemo(() => summarizeOrderReportRows(orderRows), [orderRows])

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
    const lowStock = scopedInventoryHealth.belowThreshold
    const totalQuantity = scopedInventory.reduce((acc, item) => acc + getInventoryQuantity(item), 0)
    return {
      totalSkus,
      lowStock,
      totalQuantity,
      stockIn: inventoryMovementSummary.stockIn,
      stockOut: inventoryMovementSummary.stockOut,
    }
  }, [scopedInventory, scopedInventoryHealth, inventoryMovementSummary])

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

  const driverPerformanceKpi = useMemo(() => {
    const total = driverPerformanceRows.length
    const active = driverPerformanceRows.filter((row) => row.isActive === 'Active').length
    const avgRating = driverPerformanceRows.length > 0
      ? driverPerformanceRows.reduce((acc, row) => acc + Number(row.rating), 0) / driverPerformanceRows.length
      : 0
    const licenseIssues = driverPerformanceRows.filter((row) => ['EXPIRED', 'EXPIRING_SOON'].includes(String(row.licenseStatus))).length
    return { total, active, avgRating: avgRating.toFixed(1), licenseIssues }
  }, [driverPerformanceRows])

  const lowStockKpi = useMemo(() => {
    const critical = lowStockRows.filter((row) => row.status === 'CRITICAL').length
    const outOfStock = lowStockRows.filter((row) => row.status === 'OUT_OF_STOCK').length
    return { total: lowStockRows.length, critical, outOfStock }
  }, [lowStockRows])

  const stockExpiryKpi = useMemo(() => {
    const critical = stockExpiryRows.filter((row) => row.status === 'CRITICAL').length
    const warning = stockExpiryRows.filter((row) => row.status === 'WARNING').length
    const expired = stockExpiryRows.filter((row) => row.status === 'EXPIRED').length
    return { total: stockExpiryRows.length, critical, warning, expired }
  }, [stockExpiryRows])

  // Keep exported order columns aligned with the redesigned on-screen table instead of leaking internal helper fields.
  const orderExportRows = useMemo(() => {
    return orderRows.map((row) => ({
      orderNumber: row.orderNumber,
      customer: row.customer,
      itemSummary: row.itemSummary,
      totalQuantity: row.totalQuantity,
      orderDate: row.orderDateLabel,
      orderStatus: formatOrderReportStatus(row.normalizedReportStatus),
      totalAmount: formatPeso(Number(row.amount || 0)),
    }))
  }, [orderRows])

  const orderSummaryLines = useMemo(() => ([
    `Total Orders: ${orderKpi.totalOrders}`,
    `Delivered: ${orderKpi.deliveredOrders}`,
    `Pending: ${orderKpi.pendingOrders}`,
    `Cancelled: ${orderKpi.cancelledOrders}`,
    `Total Quantity: ${orderKpi.totalQuantity}`,
    `Total Revenue: PHP ${orderKpi.totalRevenue.toLocaleString()} (delivered orders only)`,
  ]), [orderKpi])

  const transportSummaryLines = useMemo(() => ([
    `Total Trips: ${transportRows.length}`,
    `Completed: ${transportRows.filter((row) => row.status === 'COMPLETED').length}`,
    `In Progress: ${transportRows.filter((row) => row.status === 'IN_PROGRESS').length}`,
  ]), [transportRows])

  const warehouseSummaryLines = useMemo(() => ([
    `Total Warehouses: ${warehouses.length}`,
    `Dispatch Orders: ${warehouseDispatchRows.length}`,
    `Compliant Dispatches: ${warehouseDispatchRows.filter((row) => row.checklistComplete === 'YES').length}`,
  ]), [warehouses.length, warehouseDispatchRows])

  const inventorySummaryLines = useMemo(() => ([
    `Total Movements: ${inventoryMovementSummary.totalMovements}`,
    `Stock In: ${inventoryMovementSummary.stockIn} units`,
    `Stock Out: ${inventoryMovementSummary.stockOut} units`,
    `Low Stock Items: ${lowStockKpi.total} (${lowStockKpi.critical} critical, ${lowStockKpi.outOfStock} out of stock)`,
    `Expiring Batches: ${stockExpiryKpi.total} (${stockExpiryKpi.critical} critical, ${stockExpiryKpi.expired} expired, ${stockExpiryKpi.warning} warning)`,
  ]), [inventoryMovementSummary, lowStockKpi, stockExpiryKpi])

  const replacementSummaryLines = useMemo(() => ([
    `Total Cases: ${replacementKpi.total}`,
    `Completed: ${replacementKpi.completed}`,
    `Open Cases: ${replacementKpi.open}`,
  ]), [replacementKpi])

  const feedbackSummaryLines = useMemo(() => ([
    `Total Feedback: ${feedbackKpi.total}`,
    `Average Rating: ${feedbackKpi.avgRating.toFixed(2)}`,
    `Open Items: ${feedbackKpi.open}`,
  ]), [feedbackKpi])

  const driverPerformanceSummaryLines = useMemo(() => ([
    `Total Drivers: ${driverPerformanceKpi.total}`,
    `Active Drivers: ${driverPerformanceKpi.active}`,
    `Average Rating: ${driverPerformanceKpi.avgRating}`,
    `License Issues: ${driverPerformanceKpi.licenseIssues}`,
  ]), [driverPerformanceKpi])

  const chartCardClassName = 'rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden'
  const chartTooltipStyle = {
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '12px',
    boxShadow: '0 12px 30px rgba(15, 23, 42, 0.22)',
    color: '#e2e8f0',
  }
  const chartTooltipLabelStyle = { color: '#f8fafc', fontWeight: 700 }
  const chartTooltipItemStyle = { color: '#cbd5e1' }
  // Keep order-count copy readable and grammatically correct inside the custom-styled report tooltips.
  const formatOrderCountLabel = (value: unknown) => {
    const count = Number(value || 0)
    const safeCount = Number.isFinite(count) ? count : 0
    return `${safeCount.toLocaleString()} ${safeCount === 1 ? 'order' : 'orders'}`
  }
  // Inventory batch aging is easier to scan with calendar dates only, so time-of-day is intentionally suppressed here.
  function formatReportDateOnly(value: unknown) {
    if (!value) return 'N/A'
    const parsed = new Date(String(value))
    if (Number.isNaN(parsed.getTime())) return 'N/A'
    return parsed.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })
  }
  // Helper to sanitize text for PDF (WinAnsi encoding only supports Latin-1)
  const sanitizeForPdf = (text: string): string => {
    return text
      .replace(/₱/g, 'PHP ')
      .replace(/[€£¥]/g, '')
  }

  const downloadPdf = async (
    filename: string,
    title: string,
    rows: Array<Record<string, unknown>>,
    options?: { companyName?: string; summaryLines?: string[] }
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
    const margin = 28
    const usableWidth = 842 - margin * 2
    const lineHeight = 14
    const maxRows = Math.min(rows.length, 180)
    const headers = Object.keys(rows[0]).slice(0, 10)
    const colWidth = usableWidth / Math.max(1, headers.length)
    const ellipsize = (value: string, maxChars: number) => {
      // Replace Peso symbol with PHP for PDF compatibility (WinAnsi encoding)
      const sanitized = String(value ?? '').replace(/₱/g, 'PHP ').replace(/\s+/g, ' ').trim()
      if (sanitized.length <= maxChars) return sanitized
      return `${sanitized.slice(0, Math.max(0, maxChars - 3))}...`
    }
    let y = 550
    // Add logo on left side
    try {
      const logoResponse = await fetch('/ann-anns-logo.png')
      if (logoResponse.ok) {
        const logoBytes = await logoResponse.arrayBuffer()
        const logoImage = await pdfDoc.embedPng(logoBytes)
        const logoWidth = 45
        const logoHeight = (logoImage.height / logoImage.width) * logoWidth
        page.drawImage(logoImage, {
          x: margin,
          y: 535,
          width: logoWidth,
          height: logoHeight,
        })
      }
    } catch {
      // Logo failed to load, continue without it
    }

    page.drawText(companyName, { x: margin + 55, y: 550, size: 16, font: boldFont, color: rgb(0.08, 0.08, 0.08) })
    page.drawText(title, { x: margin, y: 520, size: 14, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
    page.drawText(`Generated: ${new Date().toLocaleString()}`, {
      x: margin, y: 500, size: 9, font, color: rgb(0.35, 0.35, 0.35),
    })
    y = 480
    // Format headers to be human-readable
    const formatHeader = (header: string): string => {
      return header
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (str) => str.toUpperCase())
        .trim()
        .replace(/_/g, ' ')
    }
    headers.forEach((header, index) => {
      page.drawText(formatHeader(header), { x: margin + index * colWidth, y, size: 9, font: boldFont, color: rgb(0.15, 0.15, 0.15), maxWidth: colWidth - 8 })
    })
    y -= lineHeight
    for (let i = 0; i < maxRows; i += 1) {
      const row = rows[i]
      headers.forEach((header, index) => {
        const rawValue = String(row[header] ?? '')
        const value = ellipsize(rawValue, Math.max(10, Math.floor((colWidth - 10) / 4.7)))
        page.drawText(value, { x: margin + index * colWidth, y, size: 7, font, color: rgb(0.25, 0.25, 0.25), maxWidth: colWidth - 6 })
      })
      y -= lineHeight
      if (y < 50) break
    }
    // Summary at bottom
    y -= 8
    const summaryLines = options?.summaryLines && options.summaryLines.length > 0
      ? options.summaryLines
      : [`Total records: ${rows.length}`]
    summaryLines.forEach((line) => {
      page.drawText(sanitizeForPdf(line), { x: margin, y, size: 9, font, color: rgb(0.35, 0.35, 0.35) })
      y -= 12
    })
    const bytes = await pdfDoc.save()
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
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
    await downloadPdf(`orders-report-${stamp}.pdf`, 'Order Report', orderExportRows, {
      ...reportBranding,
      summaryLines: orderSummaryLines,
    })
    await downloadPdf(`transport-report-${stamp}.pdf`, 'Transportation & Delivery Status Report', transportRows, {
      ...reportBranding,
      summaryLines: transportSummaryLines,
    })
    await downloadPdf(`warehouse-report-${stamp}.pdf`, 'Warehouse Operations Report', warehouseDispatchRows, {
      ...reportBranding,
      summaryLines: warehouseSummaryLines,
    })
    await downloadPdf(`inventory-report-${stamp}.pdf`, 'Inventory Movement Report', inventoryMovementRows, {
      ...reportBranding,
      summaryLines: inventorySummaryLines,
    })
    await downloadPdf(`replacement-report-${stamp}.pdf`, 'Replacement Handling Report', replacementRows, {
      ...reportBranding,
      summaryLines: replacementSummaryLines,
    })
    await downloadPdf(`feedback-report-${stamp}.pdf`, 'Client Feedback & Service Evaluation Report', feedbackRows, {
      ...reportBranding,
      summaryLines: feedbackSummaryLines,
    })
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
        {title === 'Warehouse' ? (
          <>
            <Button variant="outline" className="gap-2 rounded-lg border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => void exportWarehousePdf(new Date().toISOString().slice(0, 10))} disabled={isLoading}>
              <Download className="h-4 w-4" />
              Export Warehouse PDF
            </Button>
            <Button variant="outline" className="gap-2 rounded-lg border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => void exportInventoryPdf(new Date().toISOString().slice(0, 10))} disabled={isLoading}>
              <Download className="h-4 w-4" />
              Export Inventory PDF
            </Button>
          </>
        ) : (
          <Button variant="outline" className="gap-2 rounded-lg border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => void exportCurrentPdf()} disabled={isLoading}>
            <Download className="h-4 w-4" />
            {`Export ${title} PDF`}
          </Button>
        )}
      </div>
    </div>
  )

  const exportWarehousePdf = async (stamp: string) => {
    await downloadPdf(
      `warehouse-report-${stamp}.pdf`,
      'Warehouse Operations Report',
      warehouseDispatchRows,
      {
        ...reportBranding,
        summaryLines: warehouseSummaryLines,
      }
    )
  }

  const exportInventoryPdf = async (stamp: string) => {
    await downloadPdf(
      `inventory-report-${stamp}.pdf`,
      'Inventory Movement Report',
      inventoryMovementRows,
      {
        ...reportBranding,
        summaryLines: inventorySummaryLines,
      }
    )
  }

  const exportCurrentPdf = async () => {
    const stamp = new Date().toISOString().slice(0, 10)
    if (activeReportTab === 'orders') {
      await downloadPdf(`orders-report-${stamp}.pdf`, 'Order Report', orderExportRows, {
        ...reportBranding,
        summaryLines: orderSummaryLines,
      })
      return
    }
    if (activeReportTab === 'transport') {
      await downloadPdf(`transport-report-${stamp}.pdf`, 'Transportation & Delivery Status Report', transportRows, {
        ...reportBranding,
        summaryLines: transportSummaryLines,
      })
      return
    }
    if (activeReportTab === 'warehouse') {
      await exportWarehousePdf(stamp)
      return
    }
    if (activeReportTab === 'inventory') {
      await exportInventoryPdf(stamp)
      return
    }
    if (activeReportTab === 'replacement') {
      await downloadPdf(`replacement-report-${stamp}.pdf`, 'Replacement Handling Report', replacementRows, {
        ...reportBranding,
        summaryLines: replacementSummaryLines,
      })
      return
    }
    if (activeReportTab === 'drivers') {
      await downloadPdf(`driver-performance-report-${stamp}.pdf`, 'Driver Performance Report', driverPerformanceRows, {
        ...reportBranding,
        summaryLines: driverPerformanceSummaryLines,
      })
      return
    }
    await downloadPdf(`feedback-report-${stamp}.pdf`, 'Client Feedback & Service Evaluation Report', feedbackRows, {
      ...reportBranding,
      summaryLines: feedbackSummaryLines,
    })
  }

  const printCurrentReport = () => {
    const reportMap: Record<string, { title: string; rows: Array<Record<string, unknown>>; summaryLines: string[] }> = {
      orders: { title: 'Order Report', rows: orderExportRows, summaryLines: orderSummaryLines },
      transport: { title: 'Transportation & Delivery Status Report', rows: transportRows, summaryLines: transportSummaryLines },
      warehouse: { title: 'Warehouse Operations Report', rows: warehouseDispatchRows, summaryLines: warehouseSummaryLines },
      inventory: { title: 'Inventory Movement Report', rows: inventoryMovementRows, summaryLines: inventorySummaryLines },
      replacement: { title: 'Replacement Handling Report', rows: replacementRows, summaryLines: replacementSummaryLines },
      feedback: { title: 'Client Feedback & Service Evaluation Report', rows: feedbackRows, summaryLines: feedbackSummaryLines },
      drivers: { title: 'Driver Performance Report', rows: driverPerformanceRows, summaryLines: driverPerformanceSummaryLines },
    }

    const report = reportMap[activeReportTab]
    if (!report || report.rows.length === 0) {
      toast.error('No report data to print')
      return
    }

    const columns = Object.keys(report.rows[0])
    const summaryLines = report.summaryLines
    const bodyRows = report.rows
      .slice(0, 300)
      .map((row) => `<tr>${columns.map((column) => `<td>${String(row[column] ?? '').replace(/</g, '&lt;')}</td>`).join('')}</tr>`)
      .join('')

    const html = `
      <html>
        <head>
          <title>${report.title}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 24px; color: #111; }
            h1 { margin: 0 0 2px 0; font-size: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
            p { margin: 0 0 12px 0; color: #444; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
            th, td { border: 1px solid #ddd; padding: 6px; text-align: left; vertical-align: top; }
            th { background: #f5f5f5; font-weight: 600; }
            .summary { margin: 16px 0 0 0; }
            .summary-line { font-size: 12px; color: #444; margin: 0 0 4px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
          </style>
        </head>
        <body>
          <h1>${reportBranding.companyName}</h1>
          <p><strong>${report.title}</strong></p>
          <p>Generated at ${new Date().toLocaleString()} | Date range: last ${rangeDays} days</p>
          <table>
            <thead>
              <tr>${columns.map((column) => `<th>${column.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()).trim()}</th>`).join('')}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
          <div class="summary">
            ${summaryLines.map((line) => `<p class="summary-line">${line}</p>`).join('')}
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
      <div className="flex items-center justify-between gap-2">
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
            <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 md:grid-cols-6">
              <TabsTrigger value="orders" className="h-11 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><FileText className="h-4 w-4" />Orders</TabsTrigger>
              <TabsTrigger value="transport" className="h-11 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Truck className="h-4 w-4" />Transport</TabsTrigger>
              <TabsTrigger value="warehouse" className="h-11 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Building2 className="h-4 w-4" />Warehouse/Inventory</TabsTrigger>
              <TabsTrigger value="drivers" className="h-11 gap-2 rounded-xl text-[13px] font-semibold data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Users className="h-4 w-4" />Drivers</TabsTrigger>
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
            {/* Report-style hero keeps the orders tab feeling like a generated business report instead of a plain list. */}
            <Card className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-white via-sky-50/40 to-blue-100/50 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
              <CardContent className="flex flex-col gap-3 px-6 py-7 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-600">Ann Ann&apos;s Beverages Trading</p>
                  <h2 className="mt-3 text-4xl font-black tracking-tight text-slate-900">Order Report</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    Generated on {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm backdrop-blur">
                  {selectedWarehouse === 'all'
                    ? 'All warehouses included'
                    : `Warehouse filter applied: ${warehouses.find((warehouse) => String(warehouse.id) === selectedWarehouse)?.name || selectedWarehouse}`}
                </div>
              </CardContent>
            </Card>

            {/* These KPI cards mirror the exported summary so the report headline numbers never drift. */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Card className="rounded-3xl border border-blue-100 bg-white shadow-sm"><CardHeader className="p-5"><CardDescription className="text-xs uppercase tracking-wide text-blue-500">Total Orders</CardDescription><CardTitle className="mt-2 text-[34px] leading-none text-slate-900">{orderKpi.totalOrders}</CardTitle><p className="mt-2 text-sm text-slate-500">100% of filtered orders</p></CardHeader></Card>
              <Card className="rounded-3xl border border-emerald-100 bg-white shadow-sm"><CardHeader className="p-5"><CardDescription className="text-xs uppercase tracking-wide text-emerald-500">Delivered Orders</CardDescription><CardTitle className="mt-2 text-[34px] leading-none text-emerald-700">{orderKpi.deliveredOrders}</CardTitle><p className="mt-2 text-sm text-slate-500">{orderKpi.totalOrders > 0 ? ((orderKpi.deliveredOrders / orderKpi.totalOrders) * 100).toFixed(1) : '0.0'}% of filtered orders</p></CardHeader></Card>
              <Card className="rounded-3xl border border-amber-100 bg-white shadow-sm"><CardHeader className="p-5"><CardDescription className="text-xs uppercase tracking-wide text-amber-500">Pending Orders</CardDescription><CardTitle className="mt-2 text-[34px] leading-none text-amber-600">{orderKpi.pendingOrders}</CardTitle><p className="mt-2 text-sm text-slate-500">{orderKpi.totalOrders > 0 ? ((orderKpi.pendingOrders / orderKpi.totalOrders) * 100).toFixed(1) : '0.0'}% of filtered orders</p></CardHeader></Card>
              <Card className="rounded-3xl border border-rose-100 bg-white shadow-sm"><CardHeader className="p-5"><CardDescription className="text-xs uppercase tracking-wide text-rose-500">Cancelled Orders</CardDescription><CardTitle className="mt-2 text-[34px] leading-none text-rose-600">{orderKpi.cancelledOrders}</CardTitle><p className="mt-2 text-sm text-slate-500">{orderKpi.totalOrders > 0 ? ((orderKpi.cancelledOrders / orderKpi.totalOrders) * 100).toFixed(1) : '0.0'}% of filtered orders</p></CardHeader></Card>
              <Card className="rounded-3xl border border-cyan-100 bg-white shadow-sm"><CardHeader className="p-5"><CardDescription className="text-xs uppercase tracking-wide text-cyan-500">Total Revenue</CardDescription><CardTitle className="mt-2 text-[34px] leading-none text-cyan-700">{formatPeso(orderKpi.totalRevenue)}</CardTitle><p className="mt-2 text-sm text-slate-500">Revenue from delivered orders only</p></CardHeader></Card>
            </div>

            {/* The chart row tells the report story at a glance: volume first, outcome mix second. */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
              <Card className={chartCardClassName}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg text-blue-700">Orders by Day</CardTitle>
                  <CardDescription>Filtered order volume over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={orderOutcomeTrendChart} margin={{ top: 16, right: 20, left: 0, bottom: 16 }}>
                        <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={chartTooltipStyle}
                          labelStyle={chartTooltipLabelStyle}
                          itemStyle={chartTooltipItemStyle}
                          formatter={(value: any) => [formatOrderCountLabel(value), 'Orders']}
                        />
                        <Bar dataKey="orders" name="Orders" fill="#2563eb" radius={[8, 8, 0, 0]}>
                          <LabelList dataKey="orders" position="top" fill="#0f172a" fontSize={11} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className={chartCardClassName}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg text-blue-700">Order Status Breakdown</CardTitle>
                  <CardDescription>Delivered, pending, and cancelled mix</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={orderStatusChart}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={58}
                          outerRadius={94}
                          paddingAngle={2}
                        >
                          {orderStatusChart.map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={chartTooltipStyle}
                          labelStyle={chartTooltipLabelStyle}
                          itemStyle={chartTooltipItemStyle}
                          formatter={(value: any, _name: any, details: any) => {
                            const percentage = Number(details?.payload?.percentage || 0)
                            return [formatOrderCountLabel(value), `${details?.payload?.name} (${percentage.toFixed(1)}%)`]
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                    {orderStatusChart.map((entry) => (
                      <div key={entry.key} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                          <span className="font-medium text-slate-700">{entry.name}</span>
                        </div>
                        <span className="text-slate-600">{entry.value} ({entry.percentage.toFixed(1)}%)</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-sm font-semibold text-slate-900">
                      <span>Total</span>
                      <span>{orderKpi.totalOrders} (100%)</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* The table keeps richer order detail visible without introducing payment-specific columns the user excluded. */}
            <Card className="rounded-2xl border border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Order Report</CardTitle>
                  <CardDescription>Filtered order list with item summaries and normalized status labels</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Order ID</th>
                        <th className="p-3 text-left">Customer</th>
                        <th className="p-3 text-left">Product / Items</th>
                        <th className="p-3 text-left">Quantity</th>
                        <th className="p-3 text-left">Order Date</th>
                        <th className="p-3 text-left">Order Status</th>
                        <th className="p-3 text-left">Total Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(orderRows).map((row, index) => (
                        <tr key={`${row.orderNumber}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.orderNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.customer || 'N/A')}</td>
                          <td className="p-3 text-slate-600">{String(row.itemSummary || 'N/A')}</td>
                          <td className="p-3">{Number(row.totalQuantity || 0).toLocaleString()}</td>
                          <td className="p-3">{String(row.orderDateLabel || 'N/A')}</td>
                          <td className="p-3">
                            <Badge
                              className={
                                row.normalizedReportStatus === 'DELIVERED'
                                  ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
                                  : row.normalizedReportStatus === 'CANCELLED'
                                    ? 'bg-rose-100 text-rose-700 hover:bg-rose-100'
                                    : 'bg-amber-100 text-amber-800 hover:bg-amber-100'
                              }
                            >
                              {formatOrderReportStatus(row.normalizedReportStatus)}
                            </Badge>
                          </td>
                          <td className="p-3">{formatPeso(Number(row.amount || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {orderRows.length === 0 ? <p className="py-8 text-center text-gray-500">No matching orders found for this range</p> : null}
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Card className="rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"><CardContent className="flex items-center justify-between p-5"><p className="text-sm font-medium text-slate-600">Total Orders</p><p className="text-2xl font-black text-blue-700">{orderKpi.totalOrders}</p></CardContent></Card>
              <Card className="rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"><CardContent className="flex items-center justify-between p-5"><p className="text-sm font-medium text-slate-600">Total Quantity</p><p className="text-2xl font-black text-slate-900">{orderKpi.totalQuantity.toLocaleString()}</p></CardContent></Card>
              <Card className="rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"><CardContent className="flex items-center justify-between p-5"><p className="text-sm font-medium text-slate-600">Total Revenue</p><p className="text-2xl font-black text-cyan-700">{formatPeso(orderKpi.totalRevenue)}</p></CardContent></Card>
            </div>
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
            <div className="grid grid-cols-2 gap-4">
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
                        <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} />
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
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} />
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

            <div className="grid grid-cols-2 gap-4">
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
                            labelStyle={chartTooltipLabelStyle}
                            itemStyle={chartTooltipItemStyle}
                            formatter={(value: any, name: any) => [
                              `${Number(value).toLocaleString()}%`,
                              String(name || ''),
                            ]}
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
                            labelStyle={chartTooltipLabelStyle}
                            itemStyle={chartTooltipItemStyle}
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
                <div className="flex items-center justify-between gap-3">
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
                            labelStyle={chartTooltipLabelStyle}
                            itemStyle={chartTooltipItemStyle}
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

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mt-4">
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Low Stock Items</CardDescription><CardTitle className="text-[30px] leading-none text-amber-600">{lowStockKpi.total}</CardTitle><p className="text-[11px] text-amber-600">Below reorder point</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Critical Stock</CardDescription><CardTitle className="text-[30px] leading-none text-red-600">{lowStockKpi.critical}</CardTitle><p className="text-[11px] text-red-600">Below minimum stock</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Out of Stock</CardDescription><CardTitle className="text-[30px] leading-none text-red-700">{lowStockKpi.outOfStock}</CardTitle><p className="text-[11px] text-red-700">Immediate reorder needed</p></CardHeader></Card>
            </div>

            <Card className="rounded-2xl border border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Low Stock Alert Report</CardTitle>
                  <CardDescription>Products requiring replenishment attention</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Warehouse</th>
                        <th className="p-3 text-left">Product</th>
                        <th className="p-3 text-left">SKU</th>
                        <th className="p-3 text-left">Current Stock</th>
                        <th className="p-3 text-left">Min Stock</th>
                        <th className="p-3 text-left">Reorder Point</th>
                        <th className="p-3 text-left">Stock %</th>
                        <th className="p-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(lowStockRows).map((row, index) => (
                        <tr key={`${row.sku}-${index}`} className="border-b last:border-0">
                          <td className="p-3">{String(row.warehouse || 'N/A')}</td>
                          <td className="p-3 font-medium">{String(row.product || 'N/A')}</td>
                          <td className="p-3">{String(row.sku || 'N/A')}</td>
                          <td className="p-3">{String(row.currentStock || 0)}</td>
                          <td className="p-3">{String(row.minStock || 0)}</td>
                          <td className="p-3">{String(row.reorderPoint || 0)}</td>
                          <td className="p-3">{String(row.stockPercent || 0)}%</td>
                          <td className="p-3">
                            <Badge variant={
                              row.status === 'OUT_OF_STOCK' ? 'destructive' :
                              row.status === 'CRITICAL' ? 'destructive' : 'secondary'
                            }>{String(row.status || 'N/A')}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lowStockRows.length === 0 ? <p className="py-8 text-center text-gray-500">All stock levels are healthy</p> : null}
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mt-4">
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Tracked Batches</CardDescription><CardTitle className="text-[30px] leading-none">{stockExpiryKpi.total}</CardTitle><p className="text-[11px] text-slate-400">Inventory batches with expiry dates</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Critical (&lt;30 days)</CardDescription><CardTitle className="text-[30px] leading-none text-red-600">{stockExpiryKpi.critical}</CardTitle><p className="text-[11px] text-red-600">Immediate action needed</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Expired</CardDescription><CardTitle className="text-[30px] leading-none text-red-700">{stockExpiryKpi.expired}</CardTitle><p className="text-[11px] text-red-700">Write-off required</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Warning (30-60 days)</CardDescription><CardTitle className="text-[30px] leading-none text-amber-600">{stockExpiryKpi.warning}</CardTitle><p className="text-[11px] text-amber-600">Plan usage first</p></CardHeader></Card>
            </div>

            <Card className="rounded-2xl border border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Stock Batch Expiry Report</CardTitle>
                  <CardDescription>Batches nearing expiration sorted by urgency</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Batch #</th>
                        <th className="p-3 text-left">Product</th>
                        <th className="p-3 text-left">SKU</th>
                        <th className="p-3 text-left">Warehouse</th>
                        <th className="p-3 text-left">Quantity</th>
                        <th className="p-3 text-left">Manufacture Date</th>
                        <th className="p-3 text-left">Expiry Date</th>
                        <th className="p-3 text-left">Days Left</th>
                        <th className="p-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(stockExpiryRows).map((row, index) => (
                        <tr key={`${row.batchNumber}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.batchNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.product || 'N/A')}</td>
                          <td className="p-3">{String(row.sku || 'N/A')}</td>
                          <td className="p-3">{String(row.warehouse || 'N/A')}</td>
                          <td className="p-3">{String(row.quantity || 0)}</td>
                          <td className="p-3">{String(row.manufacturedDate || 'N/A')}</td>
                          <td className="p-3">{String(row.expiryDate || 'N/A')}</td>
                          <td className="p-3">{typeof row.daysUntilExpiry === 'number' ? row.daysUntilExpiry : 'N/A'}</td>
                          <td className="p-3">
                            <Badge variant={
                              row.status === 'EXPIRED' ? 'destructive' :
                              row.status === 'CRITICAL' ? 'destructive' :
                              row.status === 'WARNING' ? 'secondary' : 'default'
                            }>{String(row.status || 'N/A')}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {stockExpiryRows.length === 0 ? <p className="py-8 text-center text-gray-500">No batch expiry data available</p> : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="inventory" className="space-y-4">
            {reportToolbar({
              title: 'Inventory',
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

            <div className="grid grid-cols-2 gap-4">
              <Card className={chartCardClassName}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">Inventory Movement by Product</CardTitle>
                      <CardDescription>Top products by movement volume</CardDescription>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">Top 5 Products</div>
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
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} tickCount={5} />
                          <Legend verticalAlign="top" align="center" wrapperStyle={{ paddingBottom: '8px', color: '#64748b', fontSize: '12px' }} iconType="rect" />
                          <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} formatter={(value: any, name: any) => [`${Number(value).toLocaleString()} units`, name]} />
                          <Bar dataKey="inQty" name="Stock In" fill="#38bdf8" radius={[4, 4, 0, 0]} maxBarSize={22}><LabelList dataKey="inQty" position="top" fill="#0f172a" fontSize={11} /></Bar>
                          <Bar dataKey="outQty" name="Stock Out" fill="#fbbf24" radius={[4, 4, 0, 0]} maxBarSize={22}><LabelList dataKey="outQty" position="top" fill="#0f172a" fontSize={11} /></Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card className={chartCardClassName}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Low Stock Alerts</CardTitle>
                  <CardDescription>Products below minimum stock levels</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    {lowStockRows.length === 0 ? (
                      <p className="py-8 text-center text-gray-500">All stock levels are healthy</p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={lowStockRows.slice(0, 5)} margin={{ top: 10, right: 20, left: 0, bottom: 26 }}>
                          <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="product" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} itemStyle={chartTooltipItemStyle} />
                          <Bar dataKey="currentStock" name="Current" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={30} />
                          <Bar dataKey="reorderPoint" name="Reorder Point" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={30} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-2xl border border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Inventory Movement Report</CardTitle>
                  <CardDescription>Warehouse stock movements within selected range</CardDescription>
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

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mt-4">
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Low Stock Items</CardDescription><CardTitle className="text-[30px] leading-none text-amber-600">{lowStockKpi.total}</CardTitle><p className="text-[11px] text-amber-600">Below reorder point</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Critical Stock</CardDescription><CardTitle className="text-[30px] leading-none text-red-600">{lowStockKpi.critical}</CardTitle><p className="text-[11px] text-red-600">Below minimum stock</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Out of Stock</CardDescription><CardTitle className="text-[30px] leading-none text-red-700">{lowStockKpi.outOfStock}</CardTitle><p className="text-[11px] text-red-700">Immediate reorder needed</p></CardHeader></Card>
            </div>

            <Card className="rounded-2xl border border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Low Stock Alert Report</CardTitle>
                  <CardDescription>Products requiring replenishment attention</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Warehouse</th>
                        <th className="p-3 text-left">Product</th>
                        <th className="p-3 text-left">SKU</th>
                        <th className="p-3 text-left">Current Stock</th>
                        <th className="p-3 text-left">Min Stock</th>
                        <th className="p-3 text-left">Reorder Point</th>
                        <th className="p-3 text-left">Stock %</th>
                        <th className="p-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(lowStockRows).map((row, index) => (
                        <tr key={`${row.sku}-${index}`} className="border-b last:border-0">
                          <td className="p-3">{String(row.warehouse || 'N/A')}</td>
                          <td className="p-3 font-medium">{String(row.product || 'N/A')}</td>
                          <td className="p-3">{String(row.sku || 'N/A')}</td>
                          <td className="p-3">{String(row.currentStock || 0)}</td>
                          <td className="p-3">{String(row.minStock || 0)}</td>
                          <td className="p-3">{String(row.reorderPoint || 0)}</td>
                          <td className="p-3">{String(row.stockPercent || 0)}%</td>
                          <td className="p-3">
                            <Badge variant={row.status === 'OUT_OF_STOCK' ? 'destructive' : row.status === 'CRITICAL' ? 'destructive' : 'secondary'}>{String(row.status || 'N/A')}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lowStockRows.length === 0 ? <p className="py-8 text-center text-gray-500">All stock levels are healthy</p> : null}
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
                          labelStyle={chartTooltipLabelStyle}
                          itemStyle={chartTooltipItemStyle}
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
                          labelStyle={chartTooltipLabelStyle}
                          itemStyle={chartTooltipItemStyle}
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

          <TabsContent value="drivers" className="space-y-4">
            {reportToolbar({
              title: 'Driver Performance',
              statusLabel: 'Driver Status',
              statusOptions: ['Active', 'Inactive'],
              statusValue: 'all',
              onStatusChange: () => {},
              showStatus: false,
            })}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Total Drivers</CardDescription><CardTitle className="text-[30px] leading-none">{driverPerformanceKpi.total}</CardTitle><p className="text-[11px] text-slate-400">Registered drivers</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Active Drivers</CardDescription><CardTitle className="text-[30px] leading-none text-emerald-600">{driverPerformanceKpi.active}</CardTitle><p className="text-[11px] text-emerald-600">Currently active</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">Avg Rating</CardDescription><CardTitle className="text-[30px] leading-none">{driverPerformanceKpi.avgRating}</CardTitle><p className="text-[11px] text-slate-400">Out of 5.0</p></CardHeader></Card>
              <Card className="rounded-2xl border border-slate-200 shadow-sm"><CardHeader className="p-4"><CardDescription className="text-xs text-slate-500">License Issues</CardDescription><CardTitle className="text-[30px] leading-none text-red-600">{driverPerformanceKpi.licenseIssues}</CardTitle><p className="text-[11px] text-red-600">Expired/Expiring soon</p></CardHeader></Card>
            </div>
            <Card className="rounded-2xl border border-slate-200 shadow-sm">
              <CardHeader>
                <div>
                  <CardTitle>Driver Performance Report</CardTitle>
                  <CardDescription>Driver metrics and performance indicators</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="p-3 text-left">Driver Name</th>
                        <th className="p-3 text-left">License #</th>
                        <th className="p-3 text-left">Type</th>
                        <th className="p-3 text-left">License Status</th>
                        <th className="p-3 text-left">Rating</th>
                        <th className="p-3 text-left">Total Deliveries</th>
                        <th className="p-3 text-left">Total Trips</th>
                        <th className="p-3 text-left">Completed</th>
                        <th className="p-3 text-left">Completion %</th>
                        <th className="p-3 text-left">On-Time %</th>
                        <th className="p-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows(driverPerformanceRows).map((row, index) => (
                        <tr key={`${row.driverName}-${index}`} className="border-b last:border-0">
                          <td className="p-3 font-medium">{String(row.driverName || 'N/A')}</td>
                          <td className="p-3">{String(row.licenseNumber || 'N/A')}</td>
                          <td className="p-3">{String(row.licenseType || 'N/A')}</td>
                          <td className="p-3">
                            <Badge variant={
                              row.licenseStatus === 'EXPIRED' ? 'destructive' :
                              row.licenseStatus === 'EXPIRING_SOON' ? 'secondary' : 'default'
                            }>{String(row.licenseStatus || 'N/A')}</Badge>
                          </td>
                          <td className="p-3">{String(row.rating || 'N/A')}</td>
                          <td className="p-3">{String(row.totalDeliveries || 0)}</td>
                          <td className="p-3">{String(row.totalTrips || 0)}</td>
                          <td className="p-3">{String(row.completedTrips || 0)}</td>
                          <td className="p-3">{String(row.completionRate || '0%')}</td>
                          <td className="p-3">{String(row.onTimeRate || '0%')}</td>
                          <td className="p-3">{String(row.isActive || 'N/A')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {driverPerformanceRows.length === 0 ? <p className="py-8 text-center text-gray-500">No driver performance data available</p> : null}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}






