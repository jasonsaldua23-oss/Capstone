import { useMemo } from 'react'
import { toArray, normalizeTripStatus, toIsoDateTime, formatDayLabel, withinRange, getWarehouseIdFromRow } from '../shared'
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
import { formatPesoCompact, formatReportDateOnly } from './report-pdf'
import { formatReportDateRangeLabel, type ReportDatePreset } from '../report-date-utils'

/**
 * Every dataset, chart series, KPI and export row the admin Reports screen derives
 * from its raw collections and filters. Pure derivation: nothing here fetches or
 * sets state, so the screen stays responsible for loading and the user's filters.
 */
export type ReportDatasetsInputs = {
  drivers: any[]
  feedback: any[]
  feedbackDateFrom: string
  feedbackDatePreset: ReportDatePreset
  feedbackDateTo: string
  inventory: any[]
  inventoryTransactions: any[]
  orders: any[]
  rangeDays: 'today' | '7' | '30' | '90'
  replacementsData: any[]
  selectedDriver: string
  selectedDriverRating: 'all' | '4_up' | '3_up' | 'below_3'
  selectedDriverTripVolume: 'all' | 'with_trips' | '10_plus'
  selectedMovementType: string
  selectedOrderStatus: string
  selectedReplacementStatus: string
  selectedTripStatus: string
  stockBatches: any[]
  trips: any[]
  warehouseDateFrom: string
  warehouseDatePreset: ReportDatePreset
  warehouseDateTo: string
  warehouses: any[]
}

export function useReportDatasets(inputs: ReportDatasetsInputs) {
  const {
    drivers,
    feedback,
    feedbackDateFrom,
    feedbackDatePreset,
    feedbackDateTo,
    inventory,
    inventoryTransactions,
    orders,
    rangeDays,
    replacementsData,
    selectedDriver,
    selectedDriverRating,
    selectedDriverTripVolume,
    selectedMovementType,
    selectedOrderStatus,
    selectedReplacementStatus,
    selectedTripStatus,
    stockBatches,
    trips,
    warehouseDateFrom,
    warehouseDatePreset,
    warehouseDateTo,
    warehouses,
  } = inputs

  const rangeStart = useMemo(() => {
    const start = new Date()
    // Today starts at local midnight so earlier records from this calendar day remain visible.
    if (rangeDays !== 'today') start.setDate(start.getDate() - Number(rangeDays))
    start.setHours(0, 0, 0, 0)
    return start
  }, [rangeDays])
  const standardDateRangeLabel = useMemo(() => {
    const start = new Date(rangeStart)
    start.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    return formatReportDateRangeLabel(start, end)
  }, [rangeStart])

  const feedbackDateWindow = useMemo(() => {
    if (feedbackDatePreset === 'all') return { start: null, end: null, label: 'All Time' }
    if (feedbackDatePreset === 'custom') {
      const start = feedbackDateFrom ? new Date(`${feedbackDateFrom}T00:00:00`) : null
      const end = feedbackDateTo ? new Date(`${feedbackDateTo}T23:59:59.999`) : null
      return {
        start,
        end,
        label: feedbackDateFrom || feedbackDateTo
          ? `${feedbackDateFrom || 'Start'} to ${feedbackDateTo || 'Today'}`
          : 'Custom Date Range',
      }
    }

    const end = new Date()
    end.setHours(23, 59, 59, 999)
    const start = new Date()
    if (feedbackDatePreset !== 'today') start.setDate(start.getDate() - Number(feedbackDatePreset))
    start.setHours(0, 0, 0, 0)
    return {
      start,
      end,
      label: feedbackDatePreset === 'today' ? 'Today' : feedbackDatePreset === '365' ? 'Past 1 Year' : `Past ${feedbackDatePreset} Days`,
    }
  }, [feedbackDatePreset, feedbackDateFrom, feedbackDateTo])

  const warehouseDateWindow = useMemo(() => {
    const today = new Date()
    const end = new Date(today)
    end.setHours(23, 59, 59, 999)

    const start = new Date(today)
    start.setHours(0, 0, 0, 0)

    const startFromPreset = (daysBack: number) => {
      const value = new Date(start)
      value.setDate(value.getDate() - daysBack)
      return value
    }

    if (warehouseDatePreset === 'all') return { start: new Date(0), end, label: 'All Time' }
    if (warehouseDatePreset === 'custom') {
      const customStart = warehouseDateFrom ? new Date(`${warehouseDateFrom}T00:00:00`) : startFromPreset(6)
      const customEnd = warehouseDateTo ? new Date(`${warehouseDateTo}T23:59:59.999`) : end
      if (Number.isNaN(customStart.getTime()) || Number.isNaN(customEnd.getTime()) || customEnd.getTime() < customStart.getTime()) {
        const fallbackStart = startFromPreset(6)
        return { start: fallbackStart, end, label: formatReportDateRangeLabel(fallbackStart, end) }
      }
      return {
        start: customStart,
        end: customEnd,
        label: formatReportDateRangeLabel(customStart, customEnd),
      }
    }
    const presetStart = startFromPreset(warehouseDatePreset === 'today' ? 0 : Math.max(0, Number(warehouseDatePreset) - 1))
    return {
      start: presetStart,
      end,
      label: warehouseDatePreset === 'today' ? 'Today' : warehouseDatePreset === '365' ? 'Past 1 Year' : `Past ${warehouseDatePreset} Days`,
    }
  }, [warehouseDatePreset, warehouseDateFrom, warehouseDateTo])

  // The order report uses a single normalized row model so cards, charts, exports, and the table stay in sync.
  const orderRows = useMemo(() => {
    return buildOrderReportRows(orders, {
      rangeStart,
      selectedOrderStatus,
      getWarehouseIdFromRow,
    })
  }, [orders, rangeStart, selectedOrderStatus])

  const transportRows = useMemo(() => {
    return trips
      .filter((trip) => withinRange(trip.createdAt || trip.plannedStartAt, rangeStart))
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
  }, [trips, rangeStart, selectedDriver, selectedTripStatus])

  const inventoryMovementRows = useMemo(() => {
    return buildInventoryMovementRows(inventoryTransactions, {
      rangeStart,
      selectedMovementType,
      getWarehouseIdFromRow,
    })
  }, [inventoryTransactions, rangeStart, selectedMovementType])

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
        const replacementContextText = `${String(item?.description || '')} ${String(item?.notes || '')}`.toLowerCase()
        const replacementByBottle = /\bby\s*bottle\b/.test(replacementContextText) || /\bbottle(?:s)?\b/.test(replacementContextText)
        const totalLossFromLines = sourceLines.reduce((sum: number, line: any) => {
          const replacedQty = Math.max(Number(line?.quantityReplaced ?? line?.replacedQuantity ?? 0), 0)
          const requestedQty = Math.max(Number(line?.quantityToReplace ?? line?.quantity ?? item?.replacementQuantity ?? 0), 0)
          const qty = replacedQty > 0 ? replacedQty : requestedQty
          const matchedOrderItem = orderItems.find((orderItem: any) => {
            const srcOrderItemId = String(line?.orderItemId ?? line?.originalOrderItemId ?? '').trim()
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
          const isBottleUnit = effectiveUnit.includes('bottle') || (!effectiveUnit && replacementByBottle)
          const replacedQtyInBillingUnit = isBottleUnit ? qty : (qty / qtyPerCase)
          return sum + (replacedQtyInBillingUnit * basePrice)
        }, 0)
        const fallbackQty = Math.max(Number(item?.replacementQuantity ?? item?.quantityReplaced ?? 0), 0)
        const orderItemPrices = orderItems
          .map((orderItem: any) => Number(orderItem?.unitPrice ?? orderItem?.price ?? orderItem?.product?.price ?? 0))
          .filter((price: number) => Number.isFinite(price) && price > 0)
        const fallbackUnitPrice = orderItemPrices.length > 0 ? (orderItemPrices.reduce((a, b) => a + b, 0) / orderItemPrices.length) : 0
        const fallbackQtyPerCase = Math.max(
          1,
          Number(
            orderItems[0]?.product?.quantityPerCase ??
            orderItems[0]?.product?.quantityPerUnit ??
            1
          )
        )
        const fallbackQtyInBillingUnit = replacementByBottle ? (fallbackQty / fallbackQtyPerCase) : fallbackQty
        const totalLossRaw = totalLossFromLines > 0
          ? totalLossFromLines
          : fallbackQtyInBillingUnit > 0 && fallbackUnitPrice > 0
            ? fallbackQtyInBillingUnit * fallbackUnitPrice
            : 0
        const totalLoss = Math.max(0, Number(totalLossRaw) || 0)

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
    const getDriverNameFromTrip = (trip: any) => (
      trip?.driver?.user?.name ||
      trip?.driver?.name ||
      trip?.assignedDriverName ||
      trip?.assignedDriver?.name ||
      ''
    )

    const findDriverByOrderId = (orderId: string) => {
      if (!orderId) return ''
      for (const trip of trips) {
        const dropPoints = Array.isArray(trip?.dropPoints)
          ? trip.dropPoints
          : Array.isArray(trip?.drop_points)
            ? trip.drop_points
            : []
        const hasOrder = dropPoints.some((dp: any) => {
          const dpOrderId = String(dp?.orderId || dp?.order_id || dp?.order?.id || '').trim()
          return dpOrderId && dpOrderId === orderId
        })
        if (hasOrder) {
          return String(getDriverNameFromTrip(trip) || '').trim()
        }
      }
      return ''
    }

    return feedback
      .filter((item) => {
        const itemTime = new Date(item.createdAt).getTime()
        if (!Number.isFinite(itemTime)) return false
        if (feedbackDateWindow.start && itemTime < feedbackDateWindow.start.getTime()) return false
        if (feedbackDateWindow.end && itemTime > feedbackDateWindow.end.getTime()) return false
        return true
      })
      .map((item) => {
        const orderRef = item.order
        const orderId = String(
          (typeof orderRef === 'object' && orderRef !== null
            ? (orderRef as any).id
            : orderRef) || item.orderId || ''
        ).trim()
        const relatedOrder = orders.find((order) => String(order?.id || '').trim() === orderId)
        const relatedOrderNumber = String(
          (typeof orderRef === 'object' && orderRef !== null
            ? (orderRef as any).orderNumber || (orderRef as any).order_number
            : '') || item.orderNumber || ''
        ).trim()
        const fallbackOrderByNumber = relatedOrderNumber
          ? orders.find((order) => String(order?.orderNumber || '').trim() === relatedOrderNumber)
          : null
        const tripDriverName = findDriverByOrderId(orderId)
        return {
          createdAt: item.createdAt,
          customer: item.customer?.name || 'N/A',
          orderId: orderId || 'N/A',
          driver:
            relatedOrder?.driver?.name ||
            relatedOrder?.assignedDriverName ||
            relatedOrder?.assignedDriver?.name ||
            relatedOrder?.trip?.driver?.name ||
            fallbackOrderByNumber?.driver?.name ||
            fallbackOrderByNumber?.assignedDriverName ||
            fallbackOrderByNumber?.assignedDriver?.name ||
            fallbackOrderByNumber?.trip?.driver?.name ||
            tripDriverName ||
            item?.driverName ||
            item?.driver?.name ||
            'N/A',
          type: item.type || 'N/A',
          rating: item.rating === null || item.rating === undefined ? 'N/A' : Number(item.rating),
          subject: item.subject || 'N/A',
        }
      })
  }, [feedback, orders, trips, feedbackDateWindow])

  // Batch expiry stays under inventory reporting so stock age is reviewed alongside movement and low-stock risks.
  const stockExpiryRows = useMemo(() => {
    const now = new Date()
    return stockBatches
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
  }, [stockBatches])

  // Driver Performance Report Rows - tracks driver metrics
  const driverPerformanceRows = useMemo(() => {
    const tripStats = new Map<string, { total: number; completed: number; dropPointsTotal: number; deliveredDropPoints: number }>()
    trips.forEach((trip) => {
      const driverId = trip.driver?.id
      if (!driverId) return
      const stats = tripStats.get(driverId) || { total: 0, completed: 0, dropPointsTotal: 0, deliveredDropPoints: 0 }
      const dropPoints = toArray<any>(trip.dropPoints)
      const dropPointsTotal = Number(trip.totalDropPoints || dropPoints.length || 0)
      const deliveredDropPoints = Number(
        trip.completedDropPoints ??
        dropPoints.filter((point) => ['DELIVERED', 'COMPLETED'].includes(String(point?.status || '').toUpperCase())).length ??
        0
      )
      stats.total++
      if (normalizeTripStatus(trip.status) === 'COMPLETED') stats.completed++
      stats.dropPointsTotal += dropPointsTotal
      stats.deliveredDropPoints += deliveredDropPoints
      tripStats.set(driverId, stats)
    })

    return drivers.map((driver) => {
      const stats = tripStats.get(driver.id) || { total: 0, completed: 0, dropPointsTotal: 0, deliveredDropPoints: 0 }
      const completionRate = stats.dropPointsTotal > 0 ? Math.round((stats.deliveredDropPoints / stats.dropPointsTotal) * 100) : 0
      const profileDeliveries = Number(
        (driver as any).totalDeliveries ??
        (driver as any).total_deliveries ??
        (driver as any).user?.totalDeliveries ??
        (driver as any).user?.total_deliveries ??
        0
      ) || 0
      const totalDeliveries = Math.max(profileDeliveries, Number(stats.deliveredDropPoints || 0))

      return {
        driverId: String(driver.id || ''),
        driverName: driver.user?.name || driver.name || 'N/A',
        rating: Number(driver.rating || 0).toFixed(1),
        totalDeliveries,
        totalTrips: stats.total,
        completedTrips: stats.completed,
        dropPointsTotal: stats.dropPointsTotal,
        deliveredDropPoints: stats.deliveredDropPoints,
        completionRate: `${completionRate}%`,
        isActive: driver.isActive ? 'Active' : 'Inactive',
      }
    }).sort((a, b) => Number(b.totalTrips) - Number(a.totalTrips))
  }, [drivers, trips])

  const driverPerformanceStatusOptions = useMemo(() => {
    return Array.from(new Set(driverPerformanceRows.map((row) => String(row.isActive || '').trim())))
      .filter(Boolean)
      .sort()
  }, [driverPerformanceRows])

  const transportDriverRows = useMemo(() => {
    return driverPerformanceRows
      .filter((row) => selectedDriver === 'all' || String(row.driverId || '') === selectedDriver)
      .filter((row) => selectedTripStatus === 'all' || String(row.isActive || '') === selectedTripStatus)
      .filter((row) => {
        const rating = Number(row.rating || 0)
        if (selectedDriverRating === '4_up') return rating >= 4
        if (selectedDriverRating === '3_up') return rating >= 3
        if (selectedDriverRating === 'below_3') return rating < 3
        return true
      })
      .filter((row) => {
        const totalTrips = Number(row.totalTrips || 0)
        if (selectedDriverTripVolume === 'with_trips') return totalTrips > 0
        if (selectedDriverTripVolume === '10_plus') return totalTrips >= 10
        return true
      })
  }, [driverPerformanceRows, selectedDriver, selectedTripStatus, selectedDriverRating, selectedDriverTripVolume])

  // Low Stock Alert Rows - tracks products below minimum stock levels
  const lowStockRows = useMemo(() => {
    return inventory
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
  }, [inventory])

  const transportStatusOptions = useMemo(() => {
    return Array.from(
      new Set(
        trips
          .filter((trip) => withinRange(trip.createdAt || trip.plannedStartAt, rangeStart))
          .filter((trip) => selectedDriver === 'all' || String(trip.driver?.id || '') === selectedDriver)
          .map((row) => String(normalizeTripStatus(row.status) || '').toUpperCase())
      )
    )
      .filter(Boolean)
      .sort()
  }, [trips, rangeStart, selectedDriver])

  const inventoryMovementTypeOptions = useMemo(() => {
    return buildInventoryMovementTypeOptions(inventoryTransactions, {
      rangeStart,
      getWarehouseIdFromRow,
    })
  }, [inventoryTransactions, rangeStart])

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

  const orderStatusOptions = useMemo(() => buildOrderReportStatusOptions(
    buildOrderReportRows(orders, {
      rangeStart,
      selectedOrderStatus: 'all',
      getWarehouseIdFromRow,
    })
  ), [orders, rangeStart])

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
      getWarehouseIdFromRow,
    })
  }, [warehouses, inventory])

  const warehouseCapacityTrendPoints = useMemo(() => {
    const scopedWarehouses = warehouses
    const scopedWarehouseIds = new Set(scopedWarehouses.map((warehouse) => String(warehouse?.id || '')).filter(Boolean))
    const scopedInventoryItems = inventory.filter((item) => scopedWarehouseIds.has(String(item?.warehouse?.id || item?.warehouseId || '')))
    const currentUsedUnits = scopedInventoryItems.reduce((sum, item) => sum + Math.max(0, Number(getInventoryQuantity(item) || 0)), 0)
    const configuredCapacity = scopedWarehouses.reduce((sum, warehouse) => sum + Math.max(0, Number(warehouse?.capacity || 0)), 0)
    const totalCapacity = configuredCapacity > 0 ? configuredCapacity : Math.max(1000, currentUsedUnits + 250)

    const movements = inventoryTransactions
      .map((transaction) => {
        const warehouseId = String(transaction?.warehouse?.id || transaction?.warehouseId || '').trim()
        const movementType = String(transaction?.type || '').toUpperCase()
        const quantity = Math.max(0, Number(transaction?.quantity || 0))
        const createdAt = new Date(String(transaction?.createdAt || transaction?.created_at || ''))
        if (!warehouseId || !scopedWarehouseIds.has(warehouseId)) return null
        if (!['IN', 'OUT'].includes(movementType)) return null
        if (Number.isNaN(createdAt.getTime()) || quantity <= 0) return null
        return { createdAt, quantity, movementType }
      })
      .filter((entry): entry is { createdAt: Date; quantity: number; movementType: string } => Boolean(entry))

    const points: Array<{ date: string; usedUnits: number; totalCapacity: number; utilizationPercent: number }> = []
    const cursor = new Date(warehouseDateWindow.start)
    cursor.setHours(0, 0, 0, 0)
    const endDate = new Date(warehouseDateWindow.end)
    endDate.setHours(23, 59, 59, 999)

    while (cursor.getTime() <= endDate.getTime()) {
      const endOfDay = new Date(cursor)
      endOfDay.setHours(23, 59, 59, 999)
      const netChangeAfterDay = movements.reduce((sum, movement) => {
        if (movement.createdAt.getTime() <= endOfDay.getTime()) return sum
        return sum + (movement.movementType === 'IN' ? movement.quantity : -movement.quantity)
      }, 0)
      const usedUnits = Math.max(0, currentUsedUnits - netChangeAfterDay)
      const utilizationPercent = totalCapacity > 0
        ? Math.min(100, Number(((usedUnits / totalCapacity) * 100).toFixed(1)))
        : 0
      points.push({
        date: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        usedUnits,
        totalCapacity,
        utilizationPercent,
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    return points
  }, [warehouses, inventory, inventoryTransactions, warehouseDateWindow])

  const warehouseCapacityTrendSummaryLines = useMemo(() => {
    if (warehouseCapacityTrendPoints.length === 0) {
      return [
        `Capacity Range: ${warehouseDateWindow.label}`,
        'No capacity trend data available for the selected filters.',
      ]
    }
    const first = warehouseCapacityTrendPoints[0]
    const last = warehouseCapacityTrendPoints[warehouseCapacityTrendPoints.length - 1]
    const peak = warehouseCapacityTrendPoints.reduce((max, point) => point.utilizationPercent > max.utilizationPercent ? point : max, warehouseCapacityTrendPoints[0])
    const lowest = warehouseCapacityTrendPoints.reduce((min, point) => point.utilizationPercent < min.utilizationPercent ? point : min, warehouseCapacityTrendPoints[0])
    const average = warehouseCapacityTrendPoints.reduce((sum, point) => sum + point.utilizationPercent, 0) / Math.max(1, warehouseCapacityTrendPoints.length)
    const delta = Number((last.utilizationPercent - first.utilizationPercent).toFixed(1))

    return [
      `Capacity Range: ${warehouseDateWindow.label}`,
      `Current Capacity Usage: ${last.usedUnits.toLocaleString()} / ${last.totalCapacity.toLocaleString()} (${last.utilizationPercent.toFixed(1)}%)`,
      `Average Utilization: ${average.toFixed(1)}%`,
      `Peak Utilization: ${peak.utilizationPercent.toFixed(1)}% on ${peak.date}`,
      `Lowest Utilization: ${lowest.utilizationPercent.toFixed(1)}% on ${lowest.date}`,
      `Trend Change: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} percentage points`,
    ]
  }, [warehouseCapacityTrendPoints, warehouseDateWindow])

  const scopedInventory = useMemo(() => {
    return inventory
  }, [inventory])

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
      .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5)
    const avgRating = ratings.length > 0 ? ratings.reduce((acc, rating) => acc + rating, 0) / ratings.length : 0
    // Added: expose the rating mix without introducing a feedback response workflow.
    const rateFor = (minimum: number, maximum: number) => ratings.length > 0
      ? Math.round((ratings.filter((rating) => rating >= minimum && rating <= maximum).length / ratings.length) * 100)
      : 0
    return {
      total,
      avgRating,
      positiveRate: rateFor(4, 5),
      neutralRate: rateFor(3, 3),
      negativeRate: rateFor(1, 2),
    }
  }, [feedbackRows])

  const driverPerformanceKpi = useMemo(() => {
    const total = transportDriverRows.length
    const active = transportDriverRows.filter((row) => row.isActive === 'Active').length
    const avgRating = transportDriverRows.length > 0
      ? transportDriverRows.reduce((acc, row) => acc + Number(row.rating), 0) / transportDriverRows.length
      : 0
    const totalTrips = transportDriverRows.reduce((acc, row) => acc + Number(row.totalTrips || 0), 0)
    return { total, active, avgRating: avgRating.toFixed(1), totalTrips }
  }, [transportDriverRows])

  const transportCompletionBandChart = useMemo(() => {
    const bands = [
      { name: '0-39%', key: '0_39', count: 0, color: '#ef4444' },
      { name: '40-69%', key: '40_69', count: 0, color: '#f59e0b' },
      { name: '70-89%', key: '70_89', count: 0, color: '#3b82f6' },
      { name: '90-100%', key: '90_100', count: 0, color: '#22c55e' },
    ]

    transportDriverRows.forEach((row) => {
      const rate = Number(String(row.completionRate || '0').replace('%', ''))
      if (rate >= 90) bands[3].count += 1
      else if (rate >= 70) bands[2].count += 1
      else if (rate >= 40) bands[1].count += 1
      else bands[0].count += 1
    })

    return bands
  }, [transportDriverRows])

  const transportTopDrivers = useMemo(() => {
    return [...transportDriverRows]
      .sort((a, b) => {
        const completionDelta = Number(String(b.completionRate || '0').replace('%', '')) - Number(String(a.completionRate || '0').replace('%', ''))
        if (completionDelta !== 0) return completionDelta
        return Number(b.totalTrips || 0) - Number(a.totalTrips || 0)
      })
      .slice(0, 8)
      .map((row) => ({
        name: String(row.driverName || 'N/A'),
        completionRate: Number(String(row.completionRate || '0').replace('%', '')),
        totalTrips: Number(row.totalTrips || 0),
      }))
  }, [transportDriverRows])

  const transportRatingVsTripsScatter = useMemo(() => {
    return transportDriverRows.map((row) => ({
      name: String(row.driverName || 'N/A'),
      rating: Number(row.rating || 0),
      trips: Number(row.totalTrips || 0),
      completionRate: Number(String(row.completionRate || '0').replace('%', '')),
    }))
  }, [transportDriverRows])

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
      productNameWithSize: (row as any).productNameWithSize || row.itemSummary,
      productCategory: (row as any).productCategory || 'Uncategorized',
      totalQuantity: row.totalQuantity,
      orderDate: row.orderDateLabel,
      orderStatus: formatOrderReportStatus(row.normalizedReportStatus),
      totalAmount: formatPesoCompact(Number(row.amount || 0)),
    }))
  }, [orderRows])

  const transportExportRows = useMemo(() => {
    return transportDriverRows.map((row) => ({
      driverName: row.driverName,
      rating: row.rating,
      totalTrips: row.totalTrips,
      deliveredDropPoints: `${row.deliveredDropPoints || 0}/${row.dropPointsTotal || 0}`,
      completionRate: row.completionRate,
      status: row.isActive,
    }))
  }, [transportDriverRows])

  const inventoryExportRows = useMemo(() => {
    return inventoryMovementRows.map((row) => ({
      createdAt: row.createdAt,
      product: row.product,
      type: row.sourceType || row.type,
      quantity: row.quantity,
    }))
  }, [inventoryMovementRows])

  const feedbackExportRows = useMemo(() => {
    const toDateOnly = (value: unknown) => {
      const iso = toIsoDateTime(value)
      if (!iso) return 'N/A'
      return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
    }
    return feedbackRows.map((row: any) => ({
      createdAt: toDateOnly(row.createdAt),
      customer: row.customer,
      driver: row.driver,
      type: row.sourceType || row.type,
      rating: row.rating,
    }))
  }, [feedbackRows])

  const orderSummaryLines = useMemo(() => ([
    `Total Orders: ${orderKpi.totalOrders}`,
    `Delivered: ${orderKpi.deliveredOrders}`,
    `Pending: ${orderKpi.pendingOrders}`,
    `Cancelled: ${orderKpi.cancelledOrders}`,
    `Total Quantity: ${orderKpi.totalQuantity}`,
    `Total Revenue: PHP ${orderKpi.totalRevenue.toLocaleString()} (delivered orders only)`,
  ]), [orderKpi])

  const transportSummaryLines = useMemo(() => ([
    `Total Drivers: ${driverPerformanceKpi.total}`,
    `Active Drivers: ${driverPerformanceKpi.active}`,
    `Average Rating: ${driverPerformanceKpi.avgRating}`,
    `Total Trips: ${driverPerformanceKpi.totalTrips}`,
    `Delivered Drop Points: ${transportDriverRows.reduce((acc, row) => acc + Number(row.deliveredDropPoints || 0), 0)}/${transportDriverRows.reduce((acc, row) => acc + Number(row.dropPointsTotal || 0), 0)}`,
  ]), [driverPerformanceKpi, transportDriverRows])

  const warehouseSummaryLines = useMemo(() => {
    return [
      `Warehouse: ${warehouses[0]?.name || warehouses[0]?.code || 'Not registered'}`,
      `Registration: ${warehouses.length === 1 ? 'Complete' : 'Required'}`,
      `Utilization Data Points: ${warehouseCapacityTrendPoints.length}`,
      ...warehouseCapacityTrendSummaryLines,
    ]
  }, [warehouses, warehouseCapacityTrendPoints.length, warehouseCapacityTrendSummaryLines])

  const warehouseCapacityTrendExportRows = useMemo(() => {
    if (warehouseCapacityTrendPoints.length === 0) return []
    if (warehouseCapacityTrendPoints.length <= 24) {
      return warehouseCapacityTrendPoints.map((point) => ({
        date: point.date,
        usedUnits: point.usedUnits.toLocaleString(),
        totalCapacity: point.totalCapacity.toLocaleString(),
        remainingCapacity: Math.max(0, point.totalCapacity - point.usedUnits).toLocaleString(),
        utilizationPercent: `${point.utilizationPercent.toFixed(1)}%`,
      }))
    }
    const step = Math.max(1, Math.floor(warehouseCapacityTrendPoints.length / 24))
    return warehouseCapacityTrendPoints
      .filter((_, index) => index % step === 0)
      .slice(0, 24)
      .map((point) => ({
        date: point.date,
        usedUnits: point.usedUnits.toLocaleString(),
        totalCapacity: point.totalCapacity.toLocaleString(),
        remainingCapacity: Math.max(0, point.totalCapacity - point.usedUnits).toLocaleString(),
        utilizationPercent: `${point.utilizationPercent.toFixed(1)}%`,
      }))
  }, [warehouseCapacityTrendPoints])

  const warehouseUtilizationRowsForExport = useMemo(() => (
    warehouseCapacityTrendExportRows.length > 0
      ? warehouseCapacityTrendExportRows
      : [{ note: `No warehouse utilization rows for ${warehouseDateWindow.label}.` }]
  ), [warehouseCapacityTrendExportRows, warehouseDateWindow])

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
    `Positive Ratings (4-5 stars): ${feedbackKpi.positiveRate}%`,
    `Neutral Ratings (3 stars): ${feedbackKpi.neutralRate}%`,
    `Negative Ratings (1-2 stars): ${feedbackKpi.negativeRate}%`,
  ]), [feedbackKpi])

  const driverPerformanceSummaryLines = useMemo(() => ([
    `Total Drivers: ${driverPerformanceKpi.total}`,
    `Active Drivers: ${driverPerformanceKpi.active}`,
    `Average Rating: ${driverPerformanceKpi.avgRating}`,
    `Total Trips: ${driverPerformanceKpi.totalTrips}`,
  ]), [driverPerformanceKpi])

  return {
    driverPerformanceKpi,
    driverPerformanceStatusOptions,
    feedbackDateWindow,
    feedbackExportRows,
    feedbackKpi,
    feedbackRatingChart,
    feedbackRatingTotal,
    feedbackRows,
    feedbackSummaryLines,
    inventoryExportRows,
    inventoryKpi,
    inventoryMovementByProductChart,
    inventoryMovementChart,
    inventoryMovementRows,
    inventoryMovementSummary,
    inventoryMovementTypeOptions,
    inventorySummaryLines,
    lowStockKpi,
    lowStockRows,
    orderExportRows,
    orderKpi,
    orderOutcomeTrendChart,
    orderRows,
    orderStatusChart,
    orderStatusOptions,
    orderSummaryLines,
    replacementKpi,
    replacementLossTrendChart,
    replacementRows,
    replacementStatusOptions,
    replacementSummaryLines,
    standardDateRangeLabel,
    stockExpiryKpi,
    stockExpiryRows,
    stockTrendSummary,
    transportCompletionBandChart,
    transportDriverRows,
    transportExportRows,
    transportSummaryLines,
    transportTopDrivers,
    warehouseCapacityTrendSummaryLines,
    warehouseCapacityVsUsedChart,
    warehouseDateWindow,
    warehouseSummaryLines,
    warehouseUtilizationRowsForExport,
  }
}

/** Everything the hook derives, for tabs that receive a subset as props. */
export type ReportDatasets = ReturnType<typeof useReportDatasets>
