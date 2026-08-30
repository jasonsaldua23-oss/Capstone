'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Loader2,
  MapPin,
  Package,
  Truck,
  Upload,
  Wallet,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { CompactDiscountLine } from '@/components/shared/compact-discount-line'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { isRescheduledOrder } from './order-status'
import { formatOrderedQuantityWithContainer } from './order-item-display'

const DAMAGE_REASON_OPTIONS = [
  'Broken seal',
  'Cracked bottle',
  'Leaking',
  'Expired',
  'Crushed case',
  'Other',
]
const MAX_EVIDENCE_PHOTOS = 2

export function CustomerOrderDetailPage(props: any) {
  const {
    order,
    onBack,
    setIsReceiptDialogOpen,
    setSelectedOrder,
    formatOrderStatus,
    orderStages,
    getOrderStageIndex,
    getProductImage,
    formatPeso,
    deliveryIssueRecords,
    getReplacementStatusLabel,
    getReplacementBadgeClass,
    isOrderDelivered,
    openRatingDialog,
    openTrackView,
    buyAgainFromOrder,
    isOrderTrackable,
    isOrderCancellable,
    cancelOrder,
    reviewedOrderIds,
    openReviewDetails,
    submitReplacementRequest,
    requestCancelReplacement,
  } = props

  const [isReplacementRequestOpen, setIsReplacementRequestOpen] = useState(false)
  const [replacementLines, setReplacementLines] = useState<
    Array<{
      key: string
      productId: string
      quantity: string
      inputMode: 'case' | 'bottle'
      reason: string
      description: string
    }>
  >([{ key: 'line-1', productId: '', quantity: '1', inputMode: 'case', reason: 'Broken seal', description: '' }])
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([])
  const [customerNotes, setCustomerNotes] = useState('')
  const [isSubmittingReplacement, setIsSubmittingReplacement] = useState(false)
  const [replacementError, setReplacementError] = useState('')

  const evidencePreviewUrls = useMemo(
    () => evidenceFiles.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })),
    [evidenceFiles]
  )
  useEffect(() => {
    return () => {
      for (const preview of evidencePreviewUrls) URL.revokeObjectURL(preview.url)
    }
  }, [evidencePreviewUrls])

  const selectedOrderReplacementRecords = useMemo(
    () => (Array.isArray(deliveryIssueRecords) ? deliveryIssueRecords : []).filter(
      (record: any) => record.orderId === order?.id
    ),
    [deliveryIssueRecords, order?.id]
  )
  const hasCompletedReplacementRequest = useMemo(
    () =>
      selectedOrderReplacementRecords.some((record: any) => {
        const rawStatus = String(record?.status || '').toUpperCase()
        return ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus)
      }),
    [selectedOrderReplacementRecords]
  )
  const hasActiveReplacementRequest = useMemo(
    () =>
      selectedOrderReplacementRecords.some((record: any) => {
        const rawStatus = String(record?.status || '').toUpperCase()
        return ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REPORTED', 'IN_PROGRESS', 'NEEDS_FOLLOW_UP', 'FOR_PICKUP', 'FOR_DELIVERY'].includes(rawStatus)
      }),
    [selectedOrderReplacementRecords]
  )

  // ── helpers ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Fix: honor the order-card action after navigating to the full-page order details.
    if (!(order as any)?.__openReplacementRequest) return
    if (hasCompletedReplacementRequest || hasActiveReplacementRequest) return
    setReplacementError('')
    setIsReplacementRequestOpen(true)
  }, [order, hasCompletedReplacementRequest, hasActiveReplacementRequest])

  const parseReplacementMeta = (record: any) => {
    const rawNotes = String(record?.notes || '')
    const marker = rawNotes.lastIndexOf('Meta:')
    if (marker < 0) return {}
    try {
      return JSON.parse(rawNotes.slice(marker + 5).trim())
    } catch {
      return {}
    }
  }

  const getLegacyReplacementQty = (record: any): { qty: number; label: 'unit' | 'bottle' } => {
    const meta =
      typeof record?.notes === 'string' && record.notes.includes('Meta:')
        ? parseReplacementMeta(record)
        : {}
    const descriptionText = String(record?.description || '')
    const byUnitMatch = descriptionText.match(/By\s*Unit:\s*(\d+)/i)
    const byBottleMatch = descriptionText.match(/By\s*Bottle:\s*(\d+)/i)
    if (byUnitMatch) {
      const qty = Number(byUnitMatch[1] || 0)
      return { qty: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0, label: 'unit' }
    }
    if (byBottleMatch) {
      const qty = Number(byBottleMatch[1] || 0)
      return { qty: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0, label: 'bottle' }
    }
    const unitQty = Number((meta as any)?.replacementCases ?? (meta as any)?.quantityToReplaceCases ?? 0)
    if (Number.isFinite(unitQty) && unitQty > 0) return { qty: Math.floor(unitQty), label: 'unit' }
    const bottleQty = Number((meta as any)?.replacementBottles ?? (meta as any)?.quantityToReplaceBottles ?? 0)
    if (Number.isFinite(bottleQty) && bottleQty > 0) return { qty: Math.floor(bottleQty), label: 'bottle' }
    const value = Number(
      record?.quantityReplaced ?? record?.replacementQuantity ??
      (meta as any)?.quantityReplaced ?? (meta as any)?.replacementQuantity ?? 0
    )
    return { qty: Number.isFinite(value) && value > 0 ? Math.floor(value) : 0, label: 'bottle' }
  }

  const getReplacementDisplayLines = (record: any) => {
    const meta = parseReplacementMeta(record)
    const rawLines =
      (Array.isArray(record?.replacementLines) && record.replacementLines.length ? record.replacementLines : null) ||
      (Array.isArray(meta?.replacementLines) && meta.replacementLines.length ? meta.replacementLines : null) ||
      (Array.isArray(record?.replacementItems) && record.replacementItems.length ? record.replacementItems : null) ||
      (Array.isArray(meta?.replacementItems) && meta.replacementItems.length ? meta.replacementItems : null) ||
      []
    if (!rawLines.length) {
      const fallbackQty = getLegacyReplacementQty(record)
      return [{ name: record?.replacementProductName || record?.originalProductName || 'Product replacement', qty: fallbackQty.qty, label: fallbackQty.label }]
    }
    return rawLines.map((line: any, index: number) => {
      const inputMode = String(line?.lineInputMode || line?.replacementInputMode || '').trim().toLowerCase()
      const unitQty = Number(line?.quantityToReplaceCases ?? line?.quantityToReplaceUnits ?? 0)
      const bottleQty = Number(line?.quantityToReplaceBottles ?? 0)
      const fallbackQty = Number(line?.quantityToReplace ?? 0)
      const qty =
        inputMode === 'bottle'
          ? Number.isFinite(bottleQty) && bottleQty > 0 ? Math.floor(bottleQty) : Math.floor(fallbackQty)
          : Number.isFinite(unitQty) && unitQty > 0 ? Math.floor(unitQty) : Math.floor(fallbackQty)
      const label: 'unit' | 'bottle' = inputMode === 'bottle' ? 'bottle' : 'unit'
      return {
        name: line?.replacementProductName || line?.originalProductName || record?.replacementProductName || record?.originalProductName || `Product ${index + 1}`,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 0,
        label,
      }
    })
  }

  const getPodUrl = (o: any) =>
    String(o?.pod?.deliveryPhoto || o?.progress?.pod?.deliveryPhoto || o?.deliveryPhoto || o?.deliveryProofUrl || o?.proofOfDeliveryUrl || '').trim()

  const selectableOrderItems = Array.isArray(order?.items) ? order.items : []
  const selectableReplacementItems = selectableOrderItems.flatMap((orderItem: any) => {
    if (orderItem?.itemType !== 'MIXED_CASE') {
      return [{ selectionId: String(orderItem?.id || ''), orderItem, component: null }]
    }
    return (orderItem?.components || []).map((component: any) => ({
      selectionId: `${orderItem.id}::${component.id || component.productId}`,
      orderItem,
      component,
    }))
  })

  const addReplacementLine = () =>
    setReplacementLines((prev) => [
      ...prev,
      { key: `line-${Date.now()}-${prev.length + 1}`, productId: '', quantity: '1', inputMode: 'case', reason: 'Broken seal', description: '' },
    ])

  const removeReplacementLine = (key: string) =>
    setReplacementLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev))

  const updateReplacementLine = (key: string, patch: any) =>
    setReplacementLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const getQuantityPerCaseForItem = (item: any) => {
    const value = Number(item?.quantityPerCase ?? item?.quantity_per_case ?? item?.product?.quantityPerCase ?? item?.product?.quantity_per_case ?? item?.product?.quantityPerUnit ?? item?.product?.quantity_per_unit ?? 1)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
  }
  const getOrderedCaseQtyForItem = (item: any) => {
    const value = Number(item?.quantity ?? item?.orderedQuantity ?? 0)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  }
  const getSelectedReplacementItem = (selectionId: string) =>
    selectableReplacementItems.find((entry: any) => entry.selectionId === String(selectionId || ''))
  const getMaxReplacementQtyForLine = (line: { productId: string; inputMode: 'case' | 'bottle' }) => {
    const selected = getSelectedReplacementItem(line.productId)
    if (!selected) return 0
    if (selected.component) return Math.max(0, Number(selected.component.totalBaseUnits || 0))
    const orderedCases = getOrderedCaseQtyForItem(selected.orderItem)
    if (line.inputMode === 'case') return orderedCases
    return orderedCases * getQuantityPerCaseForItem(selected.orderItem)
  }
  const getSelectableItemsForLine = (lineKey: string) => {
    const selectedByOtherLines = new Set(
      replacementLines.filter((l) => l.key !== lineKey).map((l) => l.productId).filter(Boolean)
    )
    return selectableReplacementItems.filter((entry: any) => !selectedByOtherLines.has(entry.selectionId))
  }
  const getReplacementOptionLabel = (entry: any) => {
    if (entry.component) {
      return `${entry.component.productName || 'Mixed Case component'} - ${entry.component.totalBaseUnits || 0} ${entry.component.baseUnitLabel || 'unit'}(s)`
    }
    const item = entry.orderItem
    const productName = String(item?.product?.name || item?.productName || 'Item').trim()
    const sizeText = Array.isArray(item?.product?.sizes) && item.product.sizes.length
      ? item.product.sizes.map((size: any) => String(size).trim()).filter(Boolean).join(', ')
      : String(item?.product?.sizeLabel || item?.product?.size || item?.product?.unit || '').trim()
    const categoryText = String(item?.product?.category?.name || item?.product?.category || '').trim()
    return [productName, sizeText, categoryText].filter(Boolean).join(' - ')
  }

  // ── derived values ───────────────────────────────────────────────────────────

  if (!order) return null

  const isDelivered = Boolean(isOrderDelivered?.(order))
  const rawStatus = String(order?.status || '').toUpperCase()
  const rawRequestStatus = String(order?.requestStatus || order?.request_status || order?.approvalStatus || '').toUpperCase()
  const isCancelled = ['CANCELLED', 'CANCELED'].includes(rawStatus) || ['CANCELLED', 'CANCELED'].includes(rawRequestStatus)
  const isRejected = rawStatus === 'REJECTED' || rawRequestStatus === 'REJECTED'
  const isFailed = isCancelled || isRejected
  const cancellationReasonText = String(
    order?.cancellationReason ||
    order?.cancellation_reason ||
    order?.rejectionReason ||
    order?.rejection_reason ||
    order?.cancelReason ||
    order?.cancel_reason ||
    (isFailed && typeof order?.notes === 'string' && order?.notes.trim() ? order.notes : '') ||
    ''
  ).trim()
  const isRescheduled = isRescheduledOrder(String(order?.status || ''))
  const isReplacementOrder = String(order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-') || Boolean(order?.isScheduledReplacement)
  const isReviewed = Boolean(reviewedOrderIds?.has?.(order.id))

  const orderSubtotal = Number(
    order?.subtotal ??
    (Array.isArray(order?.items)
      ? order.items.reduce((sum: number, item: any) => sum + Number(item?.totalPrice ?? Number(item?.unitPrice || 0) * Number(item?.quantity || 0)), 0)
      : 0)
  )
  const orderDiscount = Number(order?.discountDetails?.totalDiscount || order?.discount || 0)
  const orderTotal = Number(order?.totalAmount || 0)
  const orderDiscountPercent = (() => {
    const explicitPercent = Number(order?.discountDetails?.percent)
    if (Number.isFinite(explicitPercent) && explicitPercent > 0) return explicitPercent
    if (orderSubtotal > 0 && orderDiscount > 0) return (orderDiscount / orderSubtotal) * 100
    return 0
  })()

  const getOrderDisplayDateTime = (o: any) => {
    const deliveredAt = String(o?.deliveredAt || '').trim()
    if (deliveredAt) {
      const dt = new Date(deliveredAt)
      return { date: dt.toLocaleDateString(), time: dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
    }
    const createdAt = String(o?.createdAt || '').trim()
    if (createdAt) {
      const dt = new Date(createdAt)
      return { date: dt.toLocaleDateString(), time: dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
    }
    const deliveryDate = String(o?.deliveryDate || '').trim()
    if (deliveryDate) return { date: deliveryDate, time: 'N/A' }
    return { date: 'N/A', time: 'N/A' }
  }

  // Added: the scheduled delivery date is distinct from the ordered/delivered
  // date above, and the customer needs to see it on the purchase order.
  const scheduledDeliveryLabel = (() => {
    const raw = String(order?.deliveryDate || (order as any)?.timeline?.deliveryDate || '').trim()
    if (!raw) return ''
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw)
    if (Number.isNaN(parsed.getTime())) return raw
    return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  })()

  const dt = getOrderDisplayDateTime(order)
  const podUrl = getPodUrl(order)

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <section className="-mx-4 min-h-[calc(100dvh-7rem)] bg-[#f8fafc] pb-20 md:mx-0 md:rounded-2xl md:border md:border-slate-200 md:bg-white md:pb-8">
        {/* ── Back header ── */}
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3 md:px-5">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Purchase Orders
          </button>
          {isDelivered && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg border-emerald-200 text-xs text-emerald-700 hover:bg-emerald-50"
              onClick={() => {
                if (typeof setSelectedOrder === 'function') setSelectedOrder(order)
                setIsReceiptDialogOpen?.(true)
              }}
            >
              View Receipt
            </Button>
          )}
        </div>

        <div className="px-3 pt-4 pb-6 md:px-5 md:pt-5 space-y-4">
          {/* ── Title row ── */}
          <div className="flex flex-wrap items-start gap-3">
            <div className={`grid h-10 w-10 place-items-center rounded-full md:h-12 md:w-12 shrink-0 ${isFailed ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
              <Package className="h-5 w-5 md:h-6 md:w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-[22px] font-bold tracking-tight text-slate-900 md:text-[28px]">
                {order.orderNumber}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge className={`text-[10px] md:text-xs font-semibold ${isCancelled || isRejected ? 'bg-rose-100 text-rose-700 hover:bg-rose-100 border border-rose-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'}`}>
                  {isCancelled ? 'Cancelled' : isRejected ? 'Rejected' : formatOrderStatus(order.status, order.paymentStatus)}
                </Badge>
                {isRescheduled && (
                  <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100 md:text-xs">
                    Rescheduled Order
                  </Badge>
                )}
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600 md:text-sm">
                <CalendarDays className="h-3.5 w-3.5 text-slate-500 md:h-4 md:w-4" />
                {isCancelled ? 'Cancelled on ' : isRejected ? 'Rejected on ' : isDelivered ? 'Delivered on ' : 'Ordered on '}
                {dt.date}
                {dt.time !== 'N/A' ? ` | ${dt.time}` : ''}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-700 md:text-sm">
                <Truck className="h-3.5 w-3.5 text-emerald-600 md:h-4 md:w-4" />
                Scheduled delivery:{' '}
                <span className="font-semibold text-slate-900">
                  {scheduledDeliveryLabel || 'Not scheduled'}
                </span>
              </p>
            </div>
          </div>

          {/* ── Cancellation Banner (if cancelled or rejected) ── */}
          {isFailed && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/90 p-3.5 text-rose-800">
              <p className="text-xs font-bold uppercase tracking-wider text-rose-900">
                {isRejected ? 'Reason for Rejection' : 'Reason for Cancellation'}
              </p>
              <p className="mt-1 text-sm font-medium text-rose-700 leading-relaxed">
                {cancellationReasonText || (isRejected ? 'This purchase request was rejected.' : 'This order has been cancelled.')}
              </p>
            </div>
          )}

          {/* ── Progress stages ── */}
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
            <div className="grid grid-cols-4 gap-2">
              {(orderStages || []).map((stage: string, idx: number) => {
                const currentIndex = getOrderStageIndex?.(order.status, order.paymentStatus) ?? 0
                const done = idx <= currentIndex
                return (
                  <div key={stage} className="text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className={`grid h-5 w-5 place-items-center rounded-full md:h-6 md:w-6 ${done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                        <CheckCircle2 className="h-3 w-3 md:h-3.5 md:w-3.5" />
                      </span>
                      {idx < (orderStages?.length ?? 0) - 1 && (
                        <span className={`h-[2px] w-5 md:w-8 ${done ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                      )}
                    </div>
                    <p className={`mt-1 text-[9px] md:text-[11px] ${done ? 'font-medium text-slate-900' : 'text-slate-500'}`}>{stage}</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Address + Total ── */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <MapPin className="h-4 w-4" />
                Delivery Address
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-900 md:text-sm">
                {String(order.customerName || order.customer?.name || order.shippingName || order.contactName || 'Customer')}
              </p>
              <p className="mt-0.5 text-xs text-slate-600 md:text-sm">
                {order.shippingAddress || 'No address provided'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <Wallet className="h-4 w-4" />
                Total Amount
              </p>
              <p className="mt-1 text-2xl font-extrabold text-emerald-700 md:text-3xl">
                {formatPeso(orderTotal)}
              </p>
              {orderDiscount > 0 && (
                <CompactDiscountLine
                  value={formatPeso(orderDiscount)}
                  percent={orderDiscountPercent}
                  className="mt-1 text-xs font-semibold text-[#2b4f83] md:text-sm"
                />
              )}
            </div>
          </div>

          {/* ── Order items table ── */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-900 md:px-4 md:text-sm">
              Order Items ({order.items?.length || 0} items)
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_56px_86px_98px] md:grid-cols-[minmax(0,1fr)_90px_120px_130px] border-b border-slate-200 px-3 py-2 text-[9px] md:px-4 md:text-[11px] font-semibold uppercase text-slate-500">
              <span>Product</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit Price</span>
              <span className="text-right">Subtotal</span>
            </div>
            <div>
              {(order.items || []).map((item: any) => (
                <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_56px_86px_98px] md:grid-cols-[minmax(0,1fr)_90px_120px_130px] items-center border-b border-slate-100 last:border-0 px-3 py-2.5 text-xs md:px-4 md:py-3 md:text-sm">
                  <div className="flex items-center gap-2">
                    <img
                      src={getProductImage?.(item.product?.imageUrl)}
                      alt={item.product?.name || 'Product'}
                      className="h-7 w-7 rounded border border-slate-200 object-cover bg-white md:h-9 md:w-9 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-slate-800 break-words leading-snug">
                        {item.itemType === 'MIXED_CASE'
                          ? `Mixed Case — ${item.caseCapacity || 0} units`
                          : `${item.product?.name || 'Item'} ${String(item.product?.sizeLabel || item.product?.size || '').trim()}`}
                      </p>
                      {item.itemType === 'MIXED_CASE' && (
                        <MixedCaseComponents item={item} compact />
                      )}
                      {String(item.product?.category?.name || item.product?.category || '').trim() && (
                        <p className="text-[9px] text-slate-500 md:text-[10px] break-words leading-snug">
                          {String(item.product?.category?.name || item.product?.category || '').trim()}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="text-right text-slate-700">{formatOrderedQuantityWithContainer(item, false)}</span>
                  <span className="text-right text-slate-700">{formatPeso(item.unitPrice || 0)}</span>
                  <span className="text-right font-medium text-slate-900">
                    {formatPeso((item.unitPrice || 0) * (item.quantity || 0))}
                  </span>
                </div>
              ))}
            </div>

            {/* Totals footer */}
            <div className="border-t border-slate-200 bg-slate-50/70 px-3 py-3 text-xs md:px-4 md:text-sm">
              <div className="ml-auto w-full max-w-[220px] space-y-1">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span>{formatPeso(orderSubtotal)}</span>
                </div>
                {orderDiscount > 0 && (
                  <div className="flex items-center justify-between text-[#2b4f83]">
                    <span>
                      Discount
                      {orderDiscountPercent > 0
                        ? ` (${Number.isInteger(orderDiscountPercent) ? orderDiscountPercent : orderDiscountPercent.toFixed(2).replace(/\.?0+$/, '')}%)`
                        : ''}
                    </span>
                    <span>-{formatPeso(orderDiscount)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
                  <span>Total</span>
                  <span>{formatPeso(orderTotal)}</span>
                </div>
              </div>
            </div>

            {/* Replacement records */}
            {selectedOrderReplacementRecords.length > 0 ? (
              <div className="border-t border-slate-200 px-3 py-3 md:px-4">
                <p className="mb-2 text-xs font-semibold text-slate-700">Replacement Details</p>
                {(hasCompletedReplacementRequest || hasActiveReplacementRequest) && (
                  <p className="mb-2 text-[11px] font-medium text-amber-700">
                    A replacement request for this order already exists. You cannot submit another one yet.
                  </p>
                )}
                <div className="space-y-2">
                  {selectedOrderReplacementRecords.map((record: any) => {
                    const label = getReplacementStatusLabel?.(record.status)
                    const isCompleted = label === 'Completed' || label === 'Resolved on Delivery'
                    const qtyVerb = isCompleted ? 'replaced' : 'requested'
                    const displayLines = getReplacementDisplayLines(record)
                    return (
                      <div key={record.id} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 text-slate-700">
                            {displayLines.map((line: any, li: number) => (
                              <p key={`${record.id}-line-${li}`}>
                                {line.name}
                                {line.qty > 0 ? ` x${line.qty} ${line.label}${line.qty > 1 ? 's' : ''} ${qtyVerb}` : ''}
                              </p>
                            ))}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <Badge className={getReplacementBadgeClass?.(label)}>{label}</Badge>
                            {String(record?.status || '').toUpperCase() === 'PENDING' ? (
                              <button
                                type="button"
                                className="text-[11px] font-medium text-rose-600 hover:text-rose-700 hover:underline"
                                onClick={() => requestCancelReplacement?.(record)}
                              >
                                Cancel Replacement
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="border-t border-slate-200 px-3 py-5 text-center md:px-4">
                <p className="text-sm font-semibold text-slate-700">No replacement case filed for this order.</p>
                <p className="text-xs text-slate-500">
                  {isDelivered ? 'All items were delivered successfully.' : 'No replacement request has been submitted.'}
                </p>
              </div>
            )}
          </div>

          {/* ── POD + Notes ── */}
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">Proof of Delivery (POD)</p>
              {podUrl ? (
                <img src={podUrl} alt="Proof of delivery" className="mt-2 h-52 w-full rounded-lg border border-slate-200 object-cover" />
              ) : (
                <p className="mt-2 text-xs text-slate-600">No POD uploaded yet</p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-700">Order Note</p>
              <div className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 md:text-sm">
                {String(order.notes || '').trim() || 'No note for this order.'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Replacement request dialog (small sub-form, stays as dialog) ── */}
      <Dialog
        open={isReplacementRequestOpen}
        onOpenChange={(open) => {
          setIsReplacementRequestOpen(open)
          if (!open) setReplacementError('')
        }}
      >
        <DialogContent className="w-[95vw] max-w-[720px] rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-base font-semibold text-slate-900">Request Replacement</p>
          <p className="mt-1 text-xs text-slate-600">Select one or more products and set reason per product.</p>
          {(hasCompletedReplacementRequest || hasActiveReplacementRequest) && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
              A replacement request is already in progress or completed for this order.
            </p>
          )}
          {replacementError ? (
            <p role="alert" className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-medium text-rose-700">
              {replacementError}
            </p>
          ) : null}
          <div className="mt-3 space-y-2">
            {replacementLines.map((line, index) => (
              <div key={line.key} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-800">Product #{index + 1}</p>
                  <button
                    type="button"
                    className="text-[11px] text-rose-600 disabled:opacity-40"
                    disabled={replacementLines.length <= 1}
                    onClick={() => removeReplacementLine(line.key)}
                  >
                    Remove
                  </button>
                </div>
                <div className="mb-2 inline-flex h-9 overflow-hidden rounded-md border border-slate-300 bg-white">
                  <button
                    type="button"
                    disabled={Boolean(getSelectedReplacementItem(line.productId)?.component)}
                    className={`px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${line.inputMode === 'case' ? 'bg-emerald-600 text-white' : 'text-slate-700'}`}
                    onClick={() => updateReplacementLine(line.key, { inputMode: 'case' })}
                  >
                    By Unit
                  </button>
                  <button
                    type="button"
                    className={`px-3 text-xs font-semibold ${line.inputMode === 'bottle' ? 'bg-emerald-600 text-white' : 'text-slate-700'}`}
                    onClick={() => updateReplacementLine(line.key, { inputMode: 'bottle' })}
                  >
                    By Bottle
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-slate-600">Product</p>
                    <select
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                      value={line.productId}
                      onChange={(e) => {
                        const selected = getSelectedReplacementItem(e.target.value)
                        updateReplacementLine(line.key, {
                          productId: e.target.value,
                          inputMode: selected?.component ? 'bottle' : line.inputMode,
                          quantity: '1',
                        })
                      }}
                      aria-label={`Replacement product ${index + 1}`}
                    >
                      <option value="">Select product</option>
                      {getSelectableItemsForLine(line.key).map((entry: any) => (
                        <option key={entry.selectionId} value={entry.selectionId}>
                          {getReplacementOptionLabel(entry)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-slate-600">Quantity</p>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(getMaxReplacementQtyForLine(line), 1)}
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                      value={line.quantity}
                      onChange={(e) => {
                        const next = e.target.value
                        if (!next) { updateReplacementLine(line.key, { quantity: '' }); return }
                        const maxQty = getMaxReplacementQtyForLine(line)
                        const parsed = Number(next)
                        if (!Number.isFinite(parsed)) return
                        updateReplacementLine(line.key, { quantity: String(Math.min(Math.max(Math.floor(parsed), 1), Math.max(maxQty, 1))) })
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-slate-600">Reason</p>
                    <select
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs"
                      value={line.reason}
                      onChange={(e) => updateReplacementLine(line.key, { reason: e.target.value })}
                      aria-label={`Replacement reason ${index + 1}`}
                    >
                      {DAMAGE_REASON_OPTIONS.map((reason) => (
                        <option key={reason}>{reason}</option>
                      ))}
                    </select>
                  </div>
                  {line.reason === 'Other' && (
                    <textarea
                      className="min-h-[68px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs md:col-span-3"
                      value={line.description}
                      onChange={(e) => updateReplacementLine(line.key, { description: e.target.value })}
                      placeholder="Describe the issue for this product"
                    />
                  )}
                </div>
              </div>
            ))}
            <Button variant="outline" className="h-9 text-xs" onClick={addReplacementLine}>
              Add Product
            </Button>
            <label className="space-y-1 text-xs font-medium text-slate-700">
              Notes
              <textarea
                value={customerNotes}
                onChange={(event) => setCustomerNotes(event.target.value)}
                maxLength={500}
                className="mt-1 min-h-[72px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-normal"
                placeholder="Example: 5 bottles shattered inside the crate upon unloading."
              />
            </label>
            <label className="flex h-9 cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-white text-xs text-slate-700">
              <Upload className="h-3.5 w-3.5" />
              Upload Evidence (Photo)
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files || [])
                    .filter((file) => file.type.startsWith('image/'))
                    .slice(0, MAX_EVIDENCE_PHOTOS)
                  setEvidenceFiles(files)
                }}
              />
            </label>
            <p className="text-[11px] text-slate-500">
              {evidenceFiles.length} / {MAX_EVIDENCE_PHOTOS} photo(s) selected
            </p>
            {evidencePreviewUrls.length > 0 && (
              <div className="grid grid-cols-3 gap-2 rounded-md border border-slate-200 bg-white p-2 md:grid-cols-4">
                {evidencePreviewUrls.map((preview) => (
                  <img key={preview.url} src={preview.url} alt={preview.name} className="h-20 w-full rounded-md border object-cover" />
                ))}
              </div>
            )}
            <Button
              className="h-9 rounded-md bg-emerald-600 text-xs text-white hover:bg-emerald-500"
              disabled={isSubmittingReplacement || hasCompletedReplacementRequest || hasActiveReplacementRequest}
              onClick={async () => {
                if (hasCompletedReplacementRequest || hasActiveReplacementRequest) return
                const validLines = replacementLines.filter((l) => l.productId && Number(l.quantity) > 0)
                if (validLines.length === 0) {
                  setReplacementError('Add at least one valid damaged product line')
                  return
                }
                setReplacementError('')
                setIsSubmittingReplacement(true)
                try {
                  const submittedLines = validLines.map((line) => {
                    const selected = getSelectedReplacementItem(line.productId)
                    const selectedItem = selected?.orderItem
                    const component = selected?.component
                    const product = component?.product || selectedItem?.product || {}
                    const productName = component?.productName || product?.name || selectedItem?.productName || 'Product'
                    const quantityPerCase = component ? 1 : getQuantityPerCaseForItem(selectedItem)
                    const inputQty = Math.max(Number(line.quantity || 0), 0)
                    const orderedCases = getOrderedCaseQtyForItem(selectedItem)
                    const effectiveInputMode = component ? 'bottle' : line.inputMode
                    const maxInputQty = component
                      ? Number(component.totalBaseUnits || 0)
                      : effectiveInputMode === 'case' ? orderedCases : orderedCases * quantityPerCase
                    if (inputQty > maxInputQty) {
                      throw new Error(`${productName}: replacement quantity cannot be higher than ordered quantity (${maxInputQty} ${effectiveInputMode === 'case' ? 'unit(s)' : 'base unit(s)'})`)
                    }
                    const quantityToReplace = effectiveInputMode === 'case' ? inputQty * quantityPerCase : inputQty
                    const sizeLabel = Array.isArray(product?.sizes) && product.sizes.length
                      ? product.sizes.map((size: any) => String(size).trim()).filter(Boolean).join(', ')
                      : String(product?.size || '').trim()
                    return {
                      originalOrderItemId: String(selectedItem?.id || line.productId),
                      mixedCaseComponentId: component?.id ? String(component.id) : undefined,
                      originalProductId: String(component?.productId || product?.id || selectedItem?.productId || '').trim() || undefined,
                      replacementProductId: String(component?.productId || product?.id || selectedItem?.productId || '').trim() || undefined,
                      originalProductName: productName,
                      originalProductSku: String(component?.productSku || product?.sku || selectedItem?.productSku || '').trim() || undefined,
                      originalProductSize: sizeLabel || undefined,
                      replacementProductName: productName,
                      replacementProductSku: String(component?.productSku || product?.sku || selectedItem?.productSku || '').trim() || undefined,
                      replacementProductSize: sizeLabel || undefined,
                      inputMode: effectiveInputMode,
                      lineInputMode: effectiveInputMode,
                      quantityPerCase,
                      qtyPerUnit: quantityPerCase,
                      quantityToReplace,
                      quantityToReplaceCases: effectiveInputMode === 'case' ? inputQty : undefined,
                      quantityToReplaceUnits: effectiveInputMode === 'case' ? inputQty : undefined,
                      quantityToReplaceBottles: effectiveInputMode === 'bottle' ? inputQty : undefined,
                      reason: line.reason,
                      description: line.description || undefined,
                    }
                  })
                  const totalDamagedItems = submittedLines.reduce((sum, l) => sum + Math.max(Number(l.quantityToReplace || 0), 0), 0)
                  const distinctReasons = Array.from(new Set(submittedLines.map((l) => String(l.reason || '').trim()).filter(Boolean)))
                  const combinedReason = distinctReasons.length === 1 ? distinctReasons[0] : 'Multiple issues'
                  const combinedDescription = submittedLines.map((l) => {
                    const modeText = l.lineInputMode === 'case'
                      ? `By Unit: ${l.quantityToReplaceCases || 0} unit(s), Qty/Unit ${l.quantityPerCase || 1}`
                      : `By Bottle: ${l.quantityToReplaceBottles || 0} bottle(s), Qty/Unit ${l.quantityPerCase || 1}`
                    const lineDetail = l.description ? `. ${l.description}` : ''
                    return `[${l.originalProductName || 'Product'}] ${modeText}. Reason: ${l.reason}${lineDetail}`
                  }).join('; ')
                  await submitReplacementRequest?.(order.id, totalDamagedItems, combinedReason, combinedDescription, evidenceFiles, submittedLines, customerNotes)
                  setReplacementLines([{ key: 'line-1', productId: '', quantity: '1', inputMode: 'case', reason: 'Broken seal', description: '' }])
                  setEvidenceFiles([])
                  setCustomerNotes('')
                  setReplacementError('')
                  setIsReplacementRequestOpen(false)
                } catch (error: any) {
                  setReplacementError(error?.message || 'Failed to submit replacement request')
                } finally {
                  setIsSubmittingReplacement(false)
                }
              }}
            >
              {isSubmittingReplacement ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Submit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
