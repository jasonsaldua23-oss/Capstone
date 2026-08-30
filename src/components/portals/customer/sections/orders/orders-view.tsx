'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Filter,
  Hash,
  Loader2,
  MapPin,
  Package2,
  Search,
  Star,
  Truck,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PortalCardsSkeleton } from '@/components/portals/shared/loading-skeletons'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { PodImagePreview } from '@/components/shared/pod-image-preview'
import { isRescheduledOrder } from './order-status'
import { formatOrderedQuantityWithContainer } from './order-item-display'
import { getOrderItemDisplayName } from '@shared/customer-logic/item-display'

const PAGE_SIZE = 10

export function CustomerOrdersView(props: any) {
  const {
    ordersSearch,
    setOrdersSearch,
    ordersTabOptions,
    ordersTab,
    setOrdersTab,
    isLoading,
    visibleReplacementRecords,
    orders,
    getReplacementStatusLabel,
    getReplacementBadgeClass,
    visibleOrders,
    deliveryIssuesByOrderId,
    deliveryIssueRecords,
    normalizeDeliveryStatus,
    reviewedOrderIds,
    orderRatings,
    formatOrderStatus,
    isOrderCancellable,
    cancelOrder,
    requestCancelReplacement,
    openRatingDialog,
    openReviewDetails,
    openOrderDetail,
    setSelectedOrder,
    isOrderTrackable,
    openTrackView,
    buyAgainFromOrder,
    getProductImage,
    formatPeso,
    openFilterDialog,
    setIsReceiptDialogOpen,
  } = props
  const handleOpenOrderDetail = (o: any) => {
    if (typeof openOrderDetail === 'function') {
      openOrderDetail(o)
    } else if (typeof setSelectedOrder === 'function') {
      setSelectedOrder(o)
    }
  }
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedReplacementRecord, setSelectedReplacementRecord] = useState<any | null>(null)
  const formatOrderDateTime = (order: any, normalizedStatus: string): { date: string; time: string | null } => {
    const delivered = normalizedStatus === 'DELIVERED'
    const raw = String(
      delivered
        ? (order?.deliveredAt || order?.updatedAt || order?.deliveryDate || order?.createdAt || '')
        : (order?.createdAt || order?.updatedAt || order?.deliveryDate || '')
    ).trim()
    if (!raw) return { date: 'N/A', time: null }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const parsedDateOnly = new Date(`${raw}T00:00:00`)
      if (Number.isNaN(parsedDateOnly.getTime())) return { date: raw, time: null }
      return { date: parsedDateOnly.toLocaleDateString(), time: null }
    }

    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return { date: raw, time: null }
    return {
      date: parsed.toLocaleDateString(),
      time: parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
  }
  const isReplacementOrder = (order: any): boolean =>
    String(order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-') || Boolean(order?.isScheduledReplacement)
  const getReplacementRecordsForOrder = (order: any): any[] =>
    (Array.isArray(deliveryIssueRecords) ? deliveryIssueRecords : []).filter(
      (record: any) => String(record?.orderId || '') === String(order?.id || '')
    )
  const hasCompletedReplacementCase = (order: any): boolean => {
    return getReplacementRecordsForOrder(order).some((record: any) =>
      ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(String(record?.status || '').toUpperCase())
    )
  }
  const hasActiveReplacementCase = (order: any): boolean => {
    return getReplacementRecordsForOrder(order).some((record: any) =>
      ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REPORTED', 'IN_PROGRESS', 'NEEDS_FOLLOW_UP', 'FOR_PICKUP', 'FOR_DELIVERY']
        .includes(String(record?.status || '').toUpperCase())
    )
  }
  const getPendingReplacementCase = (order: any): any | null =>
    getReplacementRecordsForOrder(order).find(
      (record: any) => String(record?.status || '').toUpperCase() === 'PENDING'
    ) || null
  const getReplacementRequestDisplay = (order: any): { qty: number; label: 'unit' | 'bottle' } | null => {
    if (!isReplacementOrder(order)) return null
    const notes = String(order?.notes || '')
    const replacementNumberMatch = notes.match(/\b(?:RPL|RET)-\d{4}-\d{4}\b/i)
    const replacementNumber = String(replacementNumberMatch?.[0] || '').trim().toUpperCase()
    if (!replacementNumber) return null
    const record = (Array.isArray(deliveryIssueRecords) ? deliveryIssueRecords : []).find(
      (entry: any) => String(entry?.replacementNumber || '').trim().toUpperCase() === replacementNumber
    )
    if (!record) return null
    const meta = parseReplacementMeta(record)
    const rawLines =
      (Array.isArray(record?.replacementLines) && record.replacementLines.length ? record.replacementLines : null) ||
      (Array.isArray(meta?.replacementLines) && meta.replacementLines.length ? meta.replacementLines : null) ||
      (Array.isArray(record?.replacementItems) && record.replacementItems.length ? record.replacementItems : null) ||
      (Array.isArray(meta?.replacementItems) && meta.replacementItems.length ? meta.replacementItems : null) ||
      []
    if (rawLines.length !== 1) return null
    const description = String(record?.description || '')
    const byUnit = description.match(/By\s*Unit:\s*(\d+)/i)
    if (byUnit) {
      const qty = Number(byUnit[1] || 0)
      if (Number.isFinite(qty) && qty > 0) return { qty: Math.floor(qty), label: 'unit' }
    }
    const byBottle = description.match(/By\s*Bottle:\s*(\d+)/i)
    if (byBottle) {
      const qty = Number(byBottle[1] || 0)
      if (Number.isFinite(qty) && qty > 0) return { qty: Math.floor(qty), label: 'bottle' }
    }
    return null
  }
  const getReplacementRecordForOrder = (order: any): any | null => {
    if (!isReplacementOrder(order)) return null
    const notes = String(order?.notes || '')
    const replacementNumberMatch = notes.match(/\b(?:RPL|RET)-\d{4}-\d{4}\b/i)
    const replacementNumber = String(replacementNumberMatch?.[0] || '').trim().toUpperCase()
    if (!replacementNumber) return null
    const record = (Array.isArray(deliveryIssueRecords) ? deliveryIssueRecords : []).find(
      (entry: any) => String(entry?.replacementNumber || '').trim().toUpperCase() === replacementNumber
    )
    return record || null
  }
  const getReplacementDisplayStatus = (record: any, linkedOrder?: any | null) => {
    const rawStatus = String(record?.rawStatus || record?.status || '').trim().toUpperCase()
    const orderStatus = String(linkedOrder?.status || record?.orderStatus || '').trim().toUpperCase()
    if (['CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(rawStatus) || ['CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(orderStatus)) return 'Cancelled'
    if (rawStatus === 'REJECTED') return 'Rejected'
    if (rawStatus === 'APPROVED') return 'Verified'
    if (['IN_PROGRESS', 'NEEDS_FOLLOW_UP', 'FOR_PICKUP', 'FOR_DELIVERY'].includes(rawStatus)) return 'Assigned for Redelivery'
    return getReplacementStatusLabel(record?.status)
  }
  const formatQuantityWithUnit = (item: any): string => {
    return formatOrderedQuantityWithContainer(item)
  }
  const getItemDisplayNameWithSize = getOrderItemDisplayName
  const parseReplacementMeta = (record: any) => {
    const notes = String(record?.notes || '')
    const marker = notes.lastIndexOf('Meta:')
    if (marker < 0) return {}
    try {
      return JSON.parse(notes.slice(marker + 5).trim())
    } catch {
      return {}
    }
  }
  const getReplacementNumberFromRecord = (record: any, linkedOrder?: any | null) => {
    const direct = String(record?.replacementNumber || record?.replacement_number || '').trim()
    if (direct) return direct.toUpperCase()
    const orderNumber = String(record?.orderNumber || record?.order_number || '').trim()
    if (/^(RPL|RET)-\d{4}-\d{4}$/i.test(orderNumber)) return orderNumber.toUpperCase()
    const candidates = [record?.notes, record?.description, linkedOrder?.notes]
    for (const value of candidates) {
      const match = String(value || '').match(/\b(?:RPL|RET)-\d{4}-\d{4}\b/i)
      if (match) return String(match[0] || '').trim().toUpperCase()
    }
    return ''
  }
  const getReplacementLineQtyLabel = (line: any, record: any, meta?: any) => {
    const effectiveMeta = meta || parseReplacementMeta(record)
    const lineInputMode = String(line?.lineInputMode || line?.replacementInputMode || effectiveMeta?.replacementInputMode || effectiveMeta?.replacementMode || '').trim().toLowerCase()
    const unitHint = String(
      line?.productUnit ||
      line?.replacementProductUnit ||
      line?.originalProductUnit ||
      line?.unit ||
      ''
    ).trim().toLowerCase()
    const description = String(record?.description || '')
    const qtyPerUnitMatch = description.match(/Qty\/Unit:?\s*(\d+)/i)
    const qtyPerCaseMatch = description.match(/Qty\/Case:?\s*(\d+)/i)
    const qtyPerPackMatch = description.match(/Qty\/Pack:?\s*(\d+)/i)
    const qtyPerBundleMatch = description.match(/Qty\/Bundle:?\s*(\d+)/i)
    const qtyPerUnit = Number(
      line?.qtyPerUnit ??
      line?.quantityPerUnit ??
      line?.quantityPerCase ??
      effectiveMeta?.qtyPerUnit ??
      effectiveMeta?.quantityPerUnit ??
      effectiveMeta?.quantityPerCase ??
      qtyPerUnitMatch?.[1] ??
      qtyPerCaseMatch?.[1] ??
      qtyPerPackMatch?.[1] ??
      qtyPerBundleMatch?.[1] ??
      0
    )
    const unitLabel =
      unitHint.includes('pack') || lineInputMode === 'pack' ? 'pack(s)'
        : unitHint.includes('bundle') || lineInputMode === 'bundle' ? 'bundle(s)'
          : unitHint.includes('case') || lineInputMode === 'case' ? 'case(s)'
            : 'unit(s)'

    const bottleQty = Math.max(Number(line?.quantityToReplaceBottles ?? line?.damagedBottles ?? line?.replacementBottles ?? 0), 0)
    const caseLikeQty = Math.max(
      Number(
        line?.quantityToReplaceCases ??
        line?.damagedCases ??
        line?.replacementCases ??
        line?.quantityToReplaceUnits ??
        line?.unitsToReplace ??
        0
      ),
      0
    )
    const fallbackQty = Math.max(Number(line?.quantityToReplace ?? line?.damagedQuantity ?? record?.quantityToReplace ?? record?.replacementQuantity ?? 0), 0)

    if (lineInputMode === 'bottle') {
      const qty = bottleQty > 0 ? bottleQty : fallbackQty
      return qty > 0 ? `${Math.floor(qty)} bottle(s)` : '0 bottle(s)'
    }

    if (caseLikeQty > 0) return `${Math.floor(caseLikeQty)} ${unitLabel}`

    if (lineInputMode === 'unit' || lineInputMode === 'case' || lineInputMode === 'pack' || lineInputMode === 'bundle') {
      if (qtyPerUnit > 0 && fallbackQty > 0) {
        const converted = fallbackQty / qtyPerUnit
        const displayQty = Number.isInteger(converted) ? String(converted) : converted.toFixed(2).replace(/\.?0+$/, '')
        return `${displayQty} ${unitLabel}`
      }
      return `${Math.floor(fallbackQty)} ${unitLabel}`
    }

    if (bottleQty > 0) return `${Math.floor(bottleQty)} bottle(s)`
    if (qtyPerUnit > 0 && fallbackQty > 0 && fallbackQty % qtyPerUnit === 0) {
      const converted = fallbackQty / qtyPerUnit
      const displayQty = Number.isInteger(converted) ? String(converted) : converted.toFixed(2).replace(/\.?0+$/, '')
      return `${displayQty} ${unitLabel}`
    }
    return fallbackQty > 0 ? `${Math.floor(fallbackQty)} ${unitLabel}` : 'N/A'
  }
  const getReplacementItemsForRecord = (record: any) => {
    if (!record) return []
    const meta = parseReplacementMeta(record)
    const lines =
      (Array.isArray(record?.replacementLines) && record.replacementLines.length ? record.replacementLines : null) ||
      (Array.isArray(meta?.replacementLines) && meta.replacementLines.length ? meta.replacementLines : null) ||
      (Array.isArray(record?.replacementItems) && record.replacementItems.length ? record.replacementItems : null) ||
      (Array.isArray(meta?.replacementItems) && meta.replacementItems.length ? meta.replacementItems : null) ||
      []
    const formatName = (line: any) => {
      const baseName = String(
        line?.replacementProductName ||
        line?.originalProductName ||
        record?.replacementProductName ||
        record?.originalProductName ||
        'Replacement item'
      ).trim()
      const size = String(
        line?.replacementProductSize ||
        line?.originalProductSize ||
        record?.replacementProductSize ||
        record?.originalProductSize ||
        ''
      ).trim()
      return size ? `${baseName} ${size}` : baseName
    }
    if (lines.length > 0) {
      return lines.map((line: any, index: number) => ({
        key: String(line?.id || line?.replacementProductId || index),
        name: formatName(line),
        qtyLabel: getReplacementLineQtyLabel(line, record, meta),
        reason: String(line?.reason || record?.reason || 'N/A').trim(),
        imageUrl: String(line?.replacementProductImageUrl || line?.originalProductImageUrl || '').trim(),
      }))
    }
    return [{
      key: String(record?.id || 'replacement'),
      name: formatName(record),
      qtyLabel: getReplacementDisplayQty(record),
      reason: String(record?.reason || 'N/A').trim(),
      imageUrl: String(record?.replacementProductImageUrl || record?.originalProductImageUrl || '').trim(),
    }]
  }
  const getReplacementDisplayQty = (record: any) => {
    const meta = parseReplacementMeta(record)
    const lines =
      (Array.isArray(record?.replacementLines) && record.replacementLines.length ? record.replacementLines : null) ||
      (Array.isArray(meta?.replacementLines) && meta.replacementLines.length ? meta.replacementLines : null) ||
      (Array.isArray(record?.replacementItems) && record.replacementItems.length ? record.replacementItems : null) ||
      (Array.isArray(meta?.replacementItems) && meta.replacementItems.length ? meta.replacementItems : null) ||
      []
    if (lines.length > 0) {
      const labels = lines
        .map((line: any) => getReplacementLineQtyLabel(line, record, meta))
        .filter((label: string) => String(label || '').trim() && String(label || '').trim().toUpperCase() !== 'N/A')
      if (labels.length > 0) return labels.join(', ')
    }
    const formatQty = (qty: number, kind: 'unit' | 'bottle') =>
      `${Math.floor(qty)} ${kind}${qty > 1 ? 's' : ''}`
    const description = String(record?.description || '')
    const byUnit = description.match(/By\s*Unit:\s*(\d+)/i)
    const qtyPerUnitMatch = description.match(/Qty\/(?:Unit|Case)\s*(\d+)/i)
    const qtyPerUnitFromDescription = Number(qtyPerUnitMatch?.[1] || 0)
    const qtyPerUnitFromRecord = Number(record?.quantityPerCase || 0)
    const qtyPerUnit =
      (Number.isFinite(qtyPerUnitFromDescription) && qtyPerUnitFromDescription > 0 ? qtyPerUnitFromDescription : 0) ||
      (Number.isFinite(qtyPerUnitFromRecord) && qtyPerUnitFromRecord > 0 ? qtyPerUnitFromRecord : 0) ||
      0
    if (byUnit) {
      const qty = Number(byUnit[1] || 0)
      if (Number.isFinite(qty) && qty > 0) return formatQty(qty, 'unit')
    }
    const byCase = description.match(/By\s*Case:\s*(\d+)/i)
    if (byCase) {
      const qty = Number(byCase[1] || 0)
      if (Number.isFinite(qty) && qty > 0) return formatQty(qty, 'unit')
    }
    const byBottle = description.match(/By\s*Bottle:\s*(\d+)/i)
    if (byBottle) {
      const qty = Number(byBottle[1] || 0)
      if (Number.isFinite(qty) && qty > 0) return formatQty(qty, 'bottle')
    }
    const unitQty = Number(meta?.replacementCases ?? meta?.quantityToReplaceCases ?? 0)
    if (Number.isFinite(unitQty) && unitQty > 0) return formatQty(unitQty, 'unit')
    const bottleQty = Number(meta?.replacementBottles ?? meta?.quantityToReplaceBottles ?? 0)
    if (Number.isFinite(bottleQty) && bottleQty > 0) return formatQty(bottleQty, 'bottle')
    const fallback = Number(record?.quantityToReplace ?? meta?.quantityToReplace ?? record?.replacementQuantity ?? 0)
    if (Number.isFinite(fallback) && fallback > 0) {
      const mode = String(meta?.replacementInputMode || meta?.replacementMode || '').trim().toLowerCase()
      if (mode === 'case' || mode === 'unit') {
        if (qtyPerUnit > 0) {
          const units = Math.max(1, Math.round(fallback / qtyPerUnit))
          return formatQty(units, 'unit')
        }
        return formatQty(fallback, 'unit')
      }
      if (mode === 'bottle') return formatQty(fallback, 'bottle')
      if (qtyPerUnit > 0 && fallback % qtyPerUnit === 0) {
        const units = Math.max(1, Math.round(fallback / qtyPerUnit))
        return formatQty(units, 'unit')
      }
      return formatQty(fallback, 'unit')
    }
    return 'N/A'
  }

  const getReplacementTotalAmount = (record: any, linkedOrder: any | null): number => {
    if (!record) return 0
    const meta = parseReplacementMeta(record)
    const sourceLines =
      (Array.isArray(record?.replacementLines) && record.replacementLines.length ? record.replacementLines : null) ||
      (Array.isArray(meta?.replacementLines) && meta.replacementLines.length ? meta.replacementLines : null) ||
      (Array.isArray(record?.replacementItems) && record.replacementItems.length ? record.replacementItems : null) ||
      (Array.isArray(meta?.replacementItems) && meta.replacementItems.length ? meta.replacementItems : null) ||
      []
    if (!sourceLines.length) return 0
    const orderItems = Array.isArray(linkedOrder?.items) ? linkedOrder.items : []
    return sourceLines.reduce((sum: number, line: any) => {
      const matchedOrderItem = orderItems.find((orderItem: any) => {
        const srcOrderItemId = String(line?.orderItemId ?? line?.originalOrderItemId ?? '').trim()
        const oiId = String(orderItem?.id ?? '').trim()
        if (srcOrderItemId && oiId && srcOrderItemId === oiId) return true

        const srcProductId = String(
          line?.productId ??
          line?.originalProductId ??
          line?.replacementProductId ??
          ''
        ).trim()
        const oiProductId = String(orderItem?.product?.id ?? orderItem?.productId ?? '').trim()
        if (srcProductId && oiProductId && srcProductId === oiProductId) return true

        const srcName = String(line?.originalProductName ?? line?.replacementProductName ?? '').trim().toLowerCase()
        const oiName = String(orderItem?.product?.name ?? orderItem?.name ?? '').trim().toLowerCase()
        return Boolean(srcName && oiName && srcName === oiName)
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
        0
      )
      const qtyPerCase = Math.max(1, Number(line?.quantityPerCase ?? matchedOrderItem?.product?.quantityPerCase ?? matchedOrderItem?.product?.quantityPerUnit ?? 1))
      const effectiveUnit = String(
        line?.productUnit ??
        line?.replacementProductUnit ??
        line?.originalProductUnit ??
        matchedOrderItem?.product?.unit ??
        matchedOrderItem?.unit ??
        ''
      ).trim().toLowerCase()
      const isBottleUnit = effectiveUnit.includes('bottle')
      const qty = Math.max(Number(line?.quantityToReplace ?? line?.damagedQuantity ?? record?.quantityToReplace ?? record?.replacementQuantity ?? 0), 0)
      if (!qty || !Number.isFinite(unitPrice)) return sum
      const billedQty = isBottleUnit ? qty : (qty / qtyPerCase)
      return sum + (Number.isFinite(billedQty) ? billedQty * unitPrice : 0)
    }, 0)
  }

  const sanitizeReplacementText = (value: any): string => {
    const raw = String(value || '').trim()
    if (!raw) return 'N/A'
    return raw
      .replace(/driver\s+spare\s+products?/gi, 'replacement products')
      .replace(/\bspare\s+products?\b/gi, 'replacement products')
  }

  const getLinkedOrderForReplacementRecord = (record: any): any | null =>
    (Array.isArray(orders) ? orders : []).find(
      (order: any) =>
        String(order?.id || '').trim() === String(record?.linkedReplacementOrderId || '').trim() ||
        String(order?.orderNumber || '').trim().toUpperCase() === String(record?.linkedReplacementOrderNumber || '').trim().toUpperCase() ||
        String(order?.id || '').trim() === String(record?.replacementOrderId || '').trim() ||
        String(order?.orderNumber || '').trim().toUpperCase() === String(record?.replacementOrderNumber || '').trim().toUpperCase() ||
        String(order?.id || '').trim() === String(record?.orderId || '').trim() ||
        String(order?.orderNumber || '').trim().toUpperCase() === String(record?.orderNumber || '').trim().toUpperCase()
    ) || null

  const replacementTabRecords = useMemo(
    () => (Array.isArray(visibleReplacementRecords) ? visibleReplacementRecords : []),
    [visibleReplacementRecords]
  )

  const replacementTabOrders = useMemo(
    () =>
      replacementTabRecords.map((record: any, index: number) => {
        const linkedOrder = getLinkedOrderForReplacementRecord(record)
        const replacementNumber = getReplacementNumberFromRecord(record, linkedOrder)
        const displayReplacementNumber = replacementNumber.replace(/^RET-/i, 'RPL-')
        const trackingOrderId = String(
          record?.replacementOrderId ||
          linkedOrder?.id ||
          record?.orderId ||
          ''
        ).trim()
        return {
          ...(linkedOrder || {}),
          id: String(record?.id || linkedOrder?.id || `replacement-${index + 1}`),
          trackingOrderId,
          orderNumber: displayReplacementNumber || `Replacement ${index + 1}`,
          customerName:
            linkedOrder?.customerName ||
            linkedOrder?.customer?.name ||
            linkedOrder?.shippingName ||
            linkedOrder?.contactName ||
            'Customer',
          shippingAddress: linkedOrder?.shippingAddress || linkedOrder?.shipping_address || '',
          createdAt: record?.createdAt || linkedOrder?.createdAt || null,
          deliveryDate: record?.createdAt || linkedOrder?.deliveryDate || null,
          deliveredAt: null,
          status: record?.status || record?.rawStatus || 'PENDING',
          paymentStatus: linkedOrder?.paymentStatus || null,
          items: Array.isArray(linkedOrder?.items) ? linkedOrder.items : [],
          totalAmount: getReplacementTotalAmount(record, linkedOrder),
          feedbackOrderId: String(linkedOrder?.id || '').trim(),
          notes: displayReplacementNumber ? `Replacement request ${displayReplacementNumber}` : String(linkedOrder?.notes || ''),
          isScheduledReplacement: true,
          __replacementRecord: record,
        }
      }),
    [replacementTabRecords, orders]
  )

  const activeOrders = useMemo(
    () => (ordersTab === 'REPLACEMENT' ? replacementTabOrders : visibleOrders),
    [ordersTab, replacementTabOrders, visibleOrders]
  )

  const totalPages = Math.max(1, Math.ceil(activeOrders.length / PAGE_SIZE))
  const pagedOrders = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return activeOrders.slice(start, start + PAGE_SIZE)
  }, [activeOrders, currentPage])

  const startIndex = activeOrders.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const endIndex = Math.min(currentPage * PAGE_SIZE, activeOrders.length)

  useEffect(() => {
    setCurrentPage(1)
  }, [ordersSearch, ordersTab, activeOrders.length])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  return (
    <section className="-mx-4 min-h-[calc(100dvh-7rem)] bg-[#f8fafc] pb-5 md:mx-0 md:rounded-2xl md:border md:border-slate-200 md:bg-white">
      <div className="border-b border-slate-200 px-3 py-3 md:px-4">
        <h2 className="text-[26px] font-extrabold tracking-[-0.02em] text-slate-900 md:text-[30px]">Purchase Order</h2>

        <div className="mt-2.5 flex gap-4 overflow-x-auto">
          {ordersTabOptions.map((tab: any) => {
            const isActive = ordersTab === tab.id
            const icon =
              tab.id === 'DELIVERED' ? <Truck className="h-4 w-4" /> :
              tab.id === 'TO_REVIEW' ? <Star className="h-4 w-4" /> :
              tab.id === 'REPLACEMENT' ? <Package2 className="h-4 w-4" /> :
              <Package2 className="h-4 w-4" />

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setOrdersTab(tab.id)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-1.5 text-xs ${
                  isActive
                    ? 'border-emerald-600 font-semibold text-emerald-700'
                    : 'border-transparent text-slate-500'
                }`}
              >
                {icon}
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <Search className="h-4 w-4 text-slate-500" />
            <Input
              value={ordersSearch}
              onChange={(e) => setOrdersSearch(e.target.value)}
              placeholder="Search orders..."
              className="h-auto border-0 bg-transparent p-0 text-xs text-slate-700 shadow-none focus-visible:ring-0"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-md border-slate-200 px-2 md:px-2.5 text-[10px] md:text-[11px] shrink-0 text-slate-700"
            onClick={() => openFilterDialog?.()}
          >
            <Filter className="h-4 w-4 md:mr-1.5" />
            <span className="hidden md:inline">Filter</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <PortalCardsSkeleton cards={4} />
      ) : ordersTab === 'REPLACEMENT' ? (
        replacementTabOrders.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">No replacement requests found.</div>
        ) : (
          <div className="space-y-2.5 px-2.5 pt-2.5 md:px-4">
            {pagedOrders.map((o: any) => {
              const normalizedStatus = String(normalizeDeliveryStatus(o.status, o.paymentStatus))
              const record = o.__replacementRecord || null
              const replacementRecord = record || getReplacementRecordForOrder(o)
              const replacementStatusLabel = replacementRecord ? getReplacementDisplayStatus(replacementRecord, o) : null
              const replacementItems = replacementRecord ? getReplacementItemsForRecord(replacementRecord) : []
              const hasReplacementItems = replacementItems.length > 0
              // The note the customer typed when filing the claim was captured and stored
              // in the replacement meta, but never shown back to them.
              const claimNote = String(
                (replacementRecord ? parseReplacementMeta(replacementRecord) : {})?.customerNotes || ''
              ).trim()
              const replacementCreatedAt = replacementRecord?.createdAt || o.createdAt
              const dateTime = replacementCreatedAt
                ? {
                    date: new Date(replacementCreatedAt).toLocaleDateString(),
                    time: new Date(replacementCreatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  }
                : { date: 'N/A', time: null }
              const isRescheduled = isRescheduledOrder(o.status)
              const orderItems = Array.isArray(o.items) ? o.items : []
              const replacementRequestDisplay = getReplacementRequestDisplay(o)
              const isDelivered = normalizedStatus === 'DELIVERED'
              const hasReplacementCase = Boolean(deliveryIssuesByOrderId[o.id])
              const feedbackOrderId = String(o?.feedbackOrderId || '').trim()
              const canRateReplacement = replacementStatusLabel === 'Completed' && Boolean(feedbackOrderId)
              const replacementAlreadyRated = Boolean(feedbackOrderId && reviewedOrderIds?.has?.(feedbackOrderId))
              return (
                <div key={o.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm md:px-3.5 md:py-3.5">
                  <div className="grid gap-2.5 md:grid-cols-[1.35fr_1.05fr_0.72fr_0.8fr]">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Claim ID</p>
                          <p className="text-[18px] font-semibold tracking-[-0.01em] text-slate-900">{o.orderNumber}</p>
                        </div>
                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Replacement</Badge>
                        {isRescheduled ? (
                          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Rescheduled Order</Badge>
                        ) : null}
                      </div>
                      <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                        <CalendarDays className="h-4 w-4" />
                        Reported on {dateTime.date}
                        {dateTime.time ? ` · ${dateTime.time}` : ''}
                      </p>
                      <div className="flex items-start gap-1.5 text-xs text-slate-700">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                        <div>
                          <p className="font-semibold text-slate-800">
                            {String(
                              o.customerName ||
                              o.customer?.name ||
                              o.shippingName ||
                              o.contactName ||
                              'Customer'
                            )}
                          </p>
                          <p className="line-clamp-2 text-slate-600">{o.shippingAddress || 'No address provided'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-900">Product, Quantity &amp; Defect Reason</p>
                      {hasReplacementItems ? (
                        <div className="space-y-1.5">
                          {replacementItems.map((item: any) => (
                            <div key={`${o.id}-replacement-item-${item.key}`} className="flex items-center gap-2">
                              <img
                                src={getProductImage(item?.imageUrl)}
                                alt={item?.name || 'Replacement item'}
                                className="h-10 w-10 rounded-md border border-slate-200 bg-slate-50 object-cover"
                              />
                              <div>
                                 <p className="text-xs text-slate-800">{item.name}</p>
                                 <p className="text-xs text-slate-500">Quantity: {item.qtyLabel}</p>
                                 <p className="text-xs text-slate-500">Reason: {item.reason}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">No replacement items</p>
                      )}
                      {isDelivered && !isReplacementOrder(o) && !hasReplacementCase ? (
                        <p className="text-xs text-slate-500">No replacement case filed for this order.</p>
                      ) : null}
                      {claimNote ? (
                        <p className="text-xs text-slate-600">
                          <span className="font-semibold text-slate-800">Notes:</span> {claimNote}
                        </p>
                      ) : null}
                      {replacementStatusLabel ? (
                        <Badge className={getReplacementBadgeClass(replacementStatusLabel)}>{replacementStatusLabel}</Badge>
                      ) : null}
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-slate-900">Total Amount</p>
                      <p className="mt-1 text-[26px] font-extrabold leading-none tracking-[-0.02em] text-emerald-700">
                        {formatPeso(o.totalAmount)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">Current Status: {replacementStatusLabel || 'Reported'}</p>
                    </div>

                    <div className="space-y-1.5 border-l border-slate-200 pl-2.5 md:pl-3">
                      {isDelivered && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 w-full text-[11px] rounded-md border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => {
                            if (typeof setSelectedOrder === 'function') setSelectedOrder(o)
                            setIsReceiptDialogOpen?.(true)
                          }}
                        >
                          View Receipt
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="h-8 w-full rounded-md border-slate-300 text-[11px]"
                        onClick={() => {
                          const record = getReplacementRecordForOrder(o)
                          if (record) {
                            setSelectedReplacementRecord(record)
                            return
                          }
                          handleOpenOrderDetail(o)
                        }}
                      >
                        View Details
                        <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                      {isOrderTrackable(o.status) && !isDelivered ? (
                        <Button
                          className="h-8 w-full rounded-md bg-emerald-600 text-[11px] text-white hover:bg-emerald-500"
                          onClick={() => {
                            const trackId = String(o?.trackingOrderId || o?.id || '').trim()
                            if (!trackId) return
                            openTrackView(trackId)
                          }}
                        >
                          <Truck className="mr-1 h-3.5 w-3.5" />
                          Track Replacement
                        </Button>
                      ) : null}
                      {canRateReplacement ? (
                        <Button
                          className="h-8 w-full rounded-md bg-amber-500 text-[11px] text-white hover:bg-amber-600"
                          onClick={() => openRatingDialog({ ...o, id: feedbackOrderId, isReplacementReview: true })}
                        >
                          <Star className="mr-1 h-3.5 w-3.5" />
                          {replacementAlreadyRated ? 'View Replacement Rating' : 'Rate Replacement'}
                        </Button>
                      ) : null}
                    </div>
                
                  </div>
                </div>
              )
            })}

            <div className="flex items-center justify-between px-1 pt-3 text-sm text-slate-600">
              <p>Showing {startIndex} to {endIndex} of {activeOrders.length} replacement requests</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Previous page"
                  title="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="grid h-8 min-w-8 px-2 place-items-center rounded-md bg-emerald-100 font-semibold text-emerald-700"
                  aria-label={`Current page ${currentPage}`}
                  title={`Current page ${currentPage}`}
                >
                  {currentPage}
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Next page"
                  title="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )
      ) : visibleOrders.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">No orders found.</div>
      ) : (
        <div className="space-y-2.5 px-2.5 pt-2.5 md:px-4">
          {pagedOrders.map((o: any) => {
            const normalizedStatus = String(normalizeDeliveryStatus(o.status, o.paymentStatus))
            const rawStatus = String(o.status || '').toUpperCase()
            const rawRequestStatus = String(o.requestStatus || o.request_status || o.approvalStatus || '').toUpperCase()
            const isCancelled = ['CANCELLED', 'CANCELED'].includes(rawStatus) || ['CANCELLED', 'CANCELED'].includes(rawRequestStatus)
            const isRejected = rawStatus === 'REJECTED' || rawRequestStatus === 'REJECTED'
            const isFailed = isCancelled || isRejected
            const cancellationReasonText = String(
              o.cancellationReason ||
              o.cancellation_reason ||
              o.rejectionReason ||
              o.rejection_reason ||
              o.cancelReason ||
              o.cancel_reason ||
              (isFailed && typeof o.notes === 'string' && o.notes.trim() ? o.notes : '') ||
              ''
            ).trim()
            const dateTime = formatOrderDateTime(o, normalizedStatus)
            const isRescheduled = isRescheduledOrder(o.status)
            const orderItems = Array.isArray(o.items) ? o.items : []
            const replacementRequestDisplay = getReplacementRequestDisplay(o)
            const isDelivered = normalizedStatus === 'DELIVERED'
            const isReviewed = reviewedOrderIds.has(o.id)
            const shouldOpenReviewDirectly = ordersTab === 'TO_REVIEW' && isDelivered && !isReviewed && !isReplacementOrder(o)
            const submittedRating = Number(orderRatings[o.id] || 0)
            const hasSubmittedRating = submittedRating >= 1 && submittedRating <= 5
            const deliveryIssue = deliveryIssuesByOrderId[o.id]
            const hasCompletedReplacement = hasCompletedReplacementCase(o)
            const hasActiveReplacement = hasActiveReplacementCase(o)
            const pendingReplacement = getPendingReplacementCase(o)
            const hasReplacementCase = Boolean(deliveryIssue)

            return (
              <div key={o.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm md:px-3.5 md:py-3.5">
                <div className="grid gap-2.5 md:grid-cols-[1.35fr_1.05fr_0.72fr_0.8fr]">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${isFailed ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                      <button
                        type="button"
                        onClick={() => handleOpenOrderDetail(o)}
                        className={`text-[18px] font-semibold tracking-[-0.01em] transition-colors text-left ${isFailed ? 'text-slate-900 hover:text-rose-600' : 'text-slate-900 hover:text-emerald-700'}`}
                      >
                        {o.orderNumber}
                      </button>
                      {isCancelled ? (
                        <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 border border-rose-200 font-semibold">Cancelled</Badge>
                      ) : isRejected ? (
                        <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 border border-rose-200 font-semibold">Rejected</Badge>
                      ) : isReplacementOrder(o) ? (
                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Replacement</Badge>
                      ) : null}
                      {isRescheduled ? (
                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Rescheduled Order</Badge>
                      ) : null}
                    </div>
                    <p className={`flex items-center gap-1.5 text-xs ${isFailed ? 'text-rose-600 font-medium' : isDelivered ? 'text-emerald-700' : 'text-slate-600'}`}>
                      <CalendarDays className="h-4 w-4" />
                      {isCancelled ? 'Cancelled on ' : isRejected ? 'Rejected on ' : normalizedStatus === 'DELIVERED' ? 'Delivered on ' : ''}
                      {dateTime.date}
                      {dateTime.time ? ` · ${dateTime.time}` : ''}
                    </p>
                    <div className="flex items-start gap-1.5 text-xs text-slate-700">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      <div>
                        <p className="font-semibold text-slate-800">
                          {String(
                            o.customerName ||
                            o.customer?.name ||
                            o.shippingName ||
                            o.contactName ||
                            'Customer'
                          )}
                        </p>
                        <p className="line-clamp-2 text-slate-600">{o.shippingAddress || 'No address provided'}</p>
                      </div>
                    </div>
                    {isFailed ? (
                      <div className="rounded-lg bg-rose-50 border border-rose-200/80 px-2.5 py-2 text-xs text-rose-700 mt-2">
                        <span className="font-bold text-rose-800">
                          {isRejected ? 'Reason for Rejection:' : 'Reason for Cancellation:'}
                        </span>{' '}
                        <span className="text-rose-700">
                          {cancellationReasonText || (isRejected ? 'Request was rejected.' : 'Order was cancelled.')}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-900">Order Items</p>
                    {orderItems.length > 0 ? (
                      <div className="space-y-1.5">
                        {orderItems.map((item: any, index: number) => (
                          <div key={`${o.id}-preview-item-${item?.id || index}`} className="flex items-center gap-2">
                            <img
                              src={getProductImage(item?.product?.imageUrl)}
                              alt={item?.product?.name || 'Product'}
                              className="h-10 w-10 rounded-md border border-slate-200 bg-slate-50 object-cover"
                            />
                            <div>
                              <p className="text-xs text-slate-800">{getItemDisplayNameWithSize(item)}</p>
                              <p className="text-xs text-slate-500">
                                {replacementRequestDisplay
                                  ? `x${replacementRequestDisplay.qty} ${replacementRequestDisplay.label}${replacementRequestDisplay.qty > 1 ? 's' : ''}`
                                  : formatQuantityWithUnit(item)}
                              </p>
                              {item?.itemType === 'MIXED_CASE' ? <MixedCaseComponents item={item} compact /> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No items</p>
                    )}
                    {isDelivered && !isReplacementOrder(o) && !hasReplacementCase && ordersTab !== 'TO_REVIEW' ? (
                      <p className="text-xs text-slate-500">No replacement case filed for this order.</p>
                    ) : null}
                    {deliveryIssue ? (
                      <Badge
                        className={
                          deliveryIssue.label === 'Needs Follow-up'
                            ? 'bg-red-100 text-red-700 hover:bg-red-100'
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                        }
                      >
                        {deliveryIssue.label}
                      </Badge>
                    ) : null}
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-900">Total Amount</p>
                    <p className="mt-1 text-[26px] font-extrabold leading-none tracking-[-0.02em] text-emerald-700">
                      {formatPeso(o.totalAmount)}
                    </p>
                    {hasSubmittedRating ? (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex items-center gap-0.5">
                          {Array.from({ length: 5 }).map((_, index) => {
                            const value = index + 1
                            const isActive = value <= submittedRating
                            return (
                              <Star
                                key={`submitted-rating-${o.id}-${value}`}
                                className={`h-3.5 w-3.5 ${isActive ? 'fill-amber-500 text-amber-500' : 'text-slate-300'}`}
                              />
                            )
                          })}
                        </div>
                      </div>
                    ) : null}
                    {isDelivered && (
                      <div className="mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] rounded-md border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => {
                            if (typeof setSelectedOrder === 'function') setSelectedOrder(o)
                            setIsReceiptDialogOpen?.(true)
                          }}
                        >
                          View Receipt
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 border-l border-slate-200 pl-2.5 md:pl-3">
                    <Button
                      variant="outline"
                      className="h-8 w-full rounded-md border-slate-300 text-[11px]"
                      onClick={() => handleOpenOrderDetail(o)}
                    >
                      View Details
                      <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>

                    {isDelivered && !isReplacementOrder(o) ? (
                      <Button
                        className="h-8 w-full rounded-md bg-emerald-600 text-[11px] text-white hover:bg-emerald-500"
                        onClick={() => {
                          if (isReviewed) {
                            openReviewDetails(o)
                            return
                          }
                          openRatingDialog(o)
                        }}
                      >
                        <Star className="mr-1 h-3.5 w-3.5" />
                        {isReviewed ? 'Review Details' : 'Rate Order'}
                      </Button>
                    ) : isOrderTrackable(o.status) ? (
                      <Button
                        className="h-8 w-full rounded-md bg-emerald-600 text-[11px] text-white hover:bg-emerald-500"
                        onClick={() => openTrackView(o.id)}
                      >
                        <Truck className="mr-1 h-3.5 w-3.5" />
                        {isReplacementOrder(o) ? 'Track Replacement' : 'Track Order'}
                      </Button>
                    ) : null}

                    {isDelivered && ordersTab !== 'TO_REVIEW' && (
                      <Button
                        variant="outline"
                        className="h-8 w-full rounded-md border-emerald-300 text-[11px] text-emerald-700 hover:bg-emerald-50"
                        onClick={() => buyAgainFromOrder?.(o)}
                      >
                        <Truck className="mr-1 h-3.5 w-3.5" />
                        Buy Again
                      </Button>
                    )}

                    {isOrderCancellable(o.status, o.paymentStatus, o) ? (
                      <Button
                        variant="outline"
                        className="h-8 w-full rounded-md border-red-200 text-[11px] text-red-600 hover:bg-red-50"
                        onClick={() => void cancelOrder(o.id)}
                      >
                        Cancel Order
                      </Button>
                    ) : null}

                    {isDelivered && !isReplacementOrder(o) && ordersTab !== 'TO_REVIEW' ? (
                      <>
                        <Button
                          variant="outline"
                          className="h-8 w-full rounded-md border-emerald-200 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={hasCompletedReplacement || hasActiveReplacement}
                          onClick={() => {
                            handleOpenOrderDetail({ ...o, __openReplacementRequest: true })
                          }}
                        >
                          {hasCompletedReplacement ? 'Replacement Completed' : hasActiveReplacement ? 'Replacement In Progress' : 'Request Replacement'}
                        </Button>
                        {pendingReplacement ? (
                          <Button
                            variant="outline"
                            className="h-8 w-full rounded-md border-rose-200 text-[11px] text-rose-600 hover:bg-rose-50"
                            onClick={() => requestCancelReplacement?.(pendingReplacement)}
                          >
                            Cancel Replacement
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                
                </div>
              </div>
            )
          })}

          <div className="flex items-center justify-between px-1 pt-3 text-sm text-slate-600">
            <p>Showing {startIndex} to {endIndex} of {activeOrders.length} orders</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Previous page"
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="grid h-8 min-w-8 px-2 place-items-center rounded-md bg-emerald-100 font-semibold text-emerald-700"
                aria-label={`Current page ${currentPage}`}
                title={`Current page ${currentPage}`}
              >
                {currentPage}
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Next page"
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
      <Dialog open={!!selectedReplacementRecord} onOpenChange={(open) => !open && setSelectedReplacementRecord(null)}>
        <DialogContent
          showCloseButton={false}
          className="w-[97vw] max-h-[86vh] overflow-y-auto max-w-[1160px] rounded-xl border border-slate-200 bg-white p-0 shadow-[0_30px_80px_rgba(2,6,23,0.30)]"
        >
        {selectedReplacementRecord ? (() => {
            const selectedOrder = orders.find((item: any) =>
              String(item?.id || '').trim() === String(selectedReplacementRecord?.orderId || '').trim() ||
              String(item?.orderNumber || '').trim().toUpperCase() === String(selectedReplacementRecord?.orderNumber || '').trim().toUpperCase()
            ) || null
            const linkedReplacementOrder = orders.find((item: any) =>
              String(item?.id || '').trim() === String(selectedReplacementRecord?.linkedReplacementOrderId || selectedReplacementRecord?.replacementOrderId || '').trim() ||
              String(item?.orderNumber || '').trim().toUpperCase() === String(selectedReplacementRecord?.linkedReplacementOrderNumber || selectedReplacementRecord?.replacementOrderNumber || '').trim().toUpperCase()
            ) || null
            const statusLabel = getReplacementDisplayStatus(selectedReplacementRecord, selectedOrder)
            const meta = parseReplacementMeta(selectedReplacementRecord)
            const evidenceUrls = Array.from(new Set(
              [
                selectedReplacementRecord?.damagePhotoUrl,
                ...(Array.isArray(selectedReplacementRecord?.damagePhotoUrls) ? selectedReplacementRecord.damagePhotoUrls : []),
                meta?.damagePhotoUrl,
                ...(Array.isArray(meta?.damagePhotos) ? meta.damagePhotos : []),
              ]
                .map((value) => String(value || '').trim())
                .filter(Boolean)
            ))
            const qtyLabel = getReplacementDisplayQty(selectedReplacementRecord)
            const customerNotes = String(selectedReplacementRecord?.customerNotes || meta?.customerNotes || '').trim()
            const statusTimeline = (
              Array.isArray(selectedReplacementRecord?.statusTimeline)
                ? selectedReplacementRecord.statusTimeline
                : Array.isArray(meta?.statusTimeline)
                  ? meta.statusTimeline
                  : []
            ).filter((item: any) => item && item.status)
            const replacementPod = {
              ...(selectedReplacementRecord?.replacementDeliveryPod || {}),
              recipientName:
                selectedReplacementRecord?.replacementDeliveryPod?.recipientName ||
                linkedReplacementOrder?.pod?.recipientName ||
                linkedReplacementOrder?.progress?.pod?.recipientName ||
                '',
              deliveryPhoto:
                selectedReplacementRecord?.replacementDeliveryPod?.deliveryPhoto ||
                linkedReplacementOrder?.pod?.deliveryPhoto ||
                linkedReplacementOrder?.progress?.pod?.deliveryPhoto ||
                linkedReplacementOrder?.deliveryPhoto ||
                '',
              submittedAt:
                selectedReplacementRecord?.replacementDeliveryPod?.submittedAt ||
                linkedReplacementOrder?.pod?.submittedAt ||
                linkedReplacementOrder?.progress?.pod?.submittedAt ||
                '',
            }
            const showReplacementPod = Boolean(
              String(replacementPod.deliveryPhoto || '').trim() ||
              String(replacementPod.recipientName || '').trim() ||
              String(selectedReplacementRecord?.linkedReplacementOrderId || selectedReplacementRecord?.replacementOrderId || '').trim() ||
              String(selectedReplacementRecord?.linkedReplacementOrderNumber || selectedReplacementRecord?.replacementOrderNumber || '').trim()
            )
            return (
              <>
                <DialogHeader className="border-b border-slate-200 px-4 py-4 md:px-5 md:py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                        <Package2 className="h-7 w-7" />
                      </div>
                      <div className="pt-1">
                        <DialogTitle className="text-[22px] font-bold tracking-[-0.02em] text-slate-900 md:text-[24px]">
                          {selectedReplacementRecord?.replacementNumber || 'Replacement'}
                        </DialogTitle>
                        <div className="mt-2 flex items-center gap-2">
                          <Badge className={getReplacementBadgeClass(statusLabel)}>{statusLabel}</Badge>
                        </div>
                        <DialogDescription className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                          <CalendarDays className="h-4 w-4 text-slate-500" />
                          {selectedReplacementRecord?.createdAt ? new Date(selectedReplacementRecord.createdAt).toLocaleString() : 'N/A'}
                        </DialogDescription>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
                      onClick={() => setSelectedReplacementRecord(null)}
                      aria-label="Close replacement details dialog"
                      title="Close"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </DialogHeader>
                <div className="space-y-4 px-4 py-4 text-sm md:px-5 md:py-5">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-[18px] font-bold tracking-[-0.02em] text-slate-900">Replacement Details</p>
                    <div className="mt-4 grid gap-0 md:grid-cols-2">
                      <div className="space-y-0 md:pr-5">
                        <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-slate-200 py-4">
                          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                            <Hash className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold tracking-wide text-slate-500">Claim ID</p>
                            <p className="mt-1 text-[15px] font-semibold leading-6 text-slate-900 break-words">{selectedReplacementRecord?.replacementNumber || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-slate-200 py-4">
                          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                            <Boxes className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold tracking-wide text-slate-500">Product</p>
                            <p className="mt-1 text-[15px] font-semibold leading-6 text-slate-900 break-words">{selectedReplacementRecord?.originalProductName || selectedReplacementRecord?.replacementProductName || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-slate-200 py-4">
                          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                            <CircleAlert className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold tracking-wide text-slate-500">Reason</p>
                            <p className="mt-1 text-[15px] font-semibold leading-6 text-slate-900 break-words">{sanitizeReplacementText(selectedReplacementRecord?.reason)}</p>
                            {String(meta?.customerNotes || '').trim() ? (
                              <>
                                <p className="mt-3 text-[12px] font-semibold tracking-wide text-slate-500">Notes</p>
                                <p className="mt-1 text-[15px] leading-6 text-slate-700 break-words">
                                  {String(meta.customerNotes).trim()}
                                </p>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-0 md:border-l md:border-slate-200 md:pl-5">
                        <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-slate-200 py-4">
                          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                            <Package2 className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold tracking-wide text-slate-500">Status</p>
                            <p className="mt-1 flex items-center gap-2 text-[15px] font-semibold leading-6 text-slate-900 break-words">
                              <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                              {statusLabel}
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-slate-200 py-4">
                          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                            <Package2 className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold tracking-wide text-slate-500">Quantity</p>
                            <p className="mt-1 text-[15px] font-semibold leading-6 text-slate-900 break-words">{qtyLabel}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-slate-200 py-4">
                          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                            <Clock3 className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold tracking-wide text-slate-500">Reported</p>
                            <p className="mt-1 text-[15px] font-semibold leading-6 text-slate-900 break-words">
                              {selectedReplacementRecord?.createdAt ? new Date(selectedReplacementRecord.createdAt).toLocaleString() : 'N/A'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                   </div>
                   {customerNotes ? (
                     <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                       <p className="text-[18px] font-bold tracking-[-0.02em] text-slate-900">Notes</p>
                       <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{customerNotes}</p>
                     </div>
                   ) : null}
                   {statusTimeline.length > 0 ? (
                     <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                       <p className="text-[18px] font-bold tracking-[-0.02em] text-slate-900">Claim Timeline</p>
                       <div className="mt-3 space-y-3">
                         {statusTimeline.map((item: any, index: number) => (
                           <div key={`${item.status}-${item.at || index}`} className="flex items-start gap-3">
                             <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500" />
                             <div>
                               <p className="text-sm font-semibold text-slate-900">{getReplacementDisplayStatus({ status: item.status })}</p>
                               <p className="text-xs text-slate-500">{item.at ? new Date(item.at).toLocaleString() : 'Time unavailable'}</p>
                             </div>
                           </div>
                         ))}
                       </div>
                     </div>
                   ) : null}
                   {evidenceUrls.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-[18px] font-bold tracking-[-0.02em] text-slate-900">Evidence ({evidenceUrls.length})</p>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {evidenceUrls.map((url, index) => (
                          <PodImagePreview
                            key={`${url}-${index}`}
                            src={url}
                            alt={`Replacement evidence ${index + 1}`}
                            className="h-auto w-full rounded-xl border border-slate-200 bg-white object-contain p-2"
                            caption="Click to inspect full-size evidence"
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {showReplacementPod ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-[18px] font-bold tracking-[-0.02em] text-slate-900">Proof of Delivery (POD)</p>
                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        {(selectedReplacementRecord?.linkedReplacementOrderNumber || selectedReplacementRecord?.replacementOrderNumber) ? (
                          <p>
                            <span className="font-semibold text-slate-900">Replacement Order:</span>{' '}
                            {selectedReplacementRecord?.linkedReplacementOrderNumber || selectedReplacementRecord?.replacementOrderNumber}
                          </p>
                        ) : null}
                        {String(replacementPod.recipientName || '').trim() ? (
                          <p>
                            <span className="font-semibold text-slate-900">Received By:</span>{' '}
                            {replacementPod.recipientName}
                          </p>
                        ) : null}
                        {String(replacementPod.submittedAt || '').trim() ? (
                          <p>
                            <span className="font-semibold text-slate-900">Submitted At:</span>{' '}
                            {new Date(replacementPod.submittedAt).toLocaleString()}
                          </p>
                        ) : null}
                      </div>
                      {String(replacementPod.deliveryPhoto || '').trim() ? (
                        <div className="mt-4">
                          <img
                            src={String(replacementPod.deliveryPhoto || '')}
                            alt="Replacement proof of delivery"
                            className="max-h-[320px] w-full rounded-xl border border-slate-200 bg-white object-contain p-2"
                          />
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-slate-600">No POD uploaded yet.</p>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="flex justify-end gap-3 border-t border-slate-200 px-4 py-4 md:px-5">
                    {/* Fix: keep one footer action; both previous buttons performed the same close operation. */}
                    <Button className="h-10 rounded-xl bg-emerald-600 px-5 text-sm text-white hover:bg-emerald-500" onClick={() => setSelectedReplacementRecord(null)}>
                      Close
                    </Button>
                </div>
              </>
            )
          })() : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}

