'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
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
    openRatingDialog,
    openReviewDetails,
    setSelectedOrder,
    isOrderTrackable,
    openTrackView,
    buyAgainFromOrder,
    getProductImage,
    formatPeso,
    openFilterDialog,
  } = props
  const PAGE_SIZE = 5
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedReplacementRecord, setSelectedReplacementRecord] = useState<any | null>(null)
  const isReplacementOrder = (order: any): boolean =>
    String(order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-') || Boolean(order?.isScheduledReplacement)
  const hasActiveReplacementCase = (order: any): boolean => {
    const issue = deliveryIssuesByOrderId?.[order?.id]
    const rawStatus = String(issue?.rawStatus || '').toUpperCase()
    if (!rawStatus) return false
    return !['COMPLETED', 'RESOLVED_ON_DELIVERY', 'REJECTED', 'CANCELLED'].includes(rawStatus)
  }
  const getReplacementRequestDisplay = (order: any): { qty: number; label: 'unit' | 'bottle' } | null => {
    if (!isReplacementOrder(order)) return null
    const notes = String(order?.notes || '')
    const replacementNumberMatch = notes.match(/\bRET-\d{4}-\d{4}\b/i)
    const replacementNumber = String(replacementNumberMatch?.[0] || '').trim().toUpperCase()
    if (!replacementNumber) return null
    const record = (Array.isArray(deliveryIssueRecords) ? deliveryIssueRecords : []).find(
      (entry: any) => String(entry?.replacementNumber || '').trim().toUpperCase() === replacementNumber
    )
    if (!record) return null
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
    const replacementNumberMatch = notes.match(/\bRET-\d{4}-\d{4}\b/i)
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
    if (rawStatus === 'CANCELLED' || orderStatus === 'CANCELLED') return 'Cancelled'
    if (rawStatus === 'REJECTED') return 'Rejected'
    return getReplacementStatusLabel(record?.status)
  }
  const formatQuantityWithUnit = (item: any): string => {
    const qty = Number(item?.quantity || 0)
    const rawUnit = String(item?.product?.unit || item?.productUnit || '').trim().toLowerCase()
    const isBottle = rawUnit.includes('bottle')
    const label = isBottle ? (qty === 1 ? 'bottle' : 'bottles') : (qty === 1 ? 'unit' : 'units')
    return `x${qty} ${label}`
  }
  const getItemDisplayNameWithSize = (item: any): string => {
    const baseName = String(item?.product?.name || 'Product').trim()
    const product = item?.product || {}
    const sizeFromArray = Array.isArray(product?.sizes) && product.sizes.length > 0
      ? product.sizes.map((s: any) => String(s).trim()).filter(Boolean).join(', ')
      : ''
    const sizeFromField = String(product?.size || product?.sizeLabel || item?.size || '').trim()
    const sizeLabel = sizeFromArray || sizeFromField
    return sizeLabel ? `${baseName} ${sizeLabel}` : baseName
  }
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
  const getReplacementDisplayQty = (record: any) => {
    const formatQty = (qty: number, kind: 'unit' | 'bottle') =>
      `${Math.floor(qty)} ${kind}${qty > 1 ? 's' : ''}`
    const description = String(record?.description || '')
    const qtyPerUnitMatch = description.match(/Qty\/(?:Unit|Case)\s*(\d+)/i)
    const qtyPerUnitFromDescription = Number(qtyPerUnitMatch?.[1] || 0)
    const qtyPerUnitFromRecord = Number(record?.quantityPerCase || 0)
    const qtyPerUnit =
      (Number.isFinite(qtyPerUnitFromDescription) && qtyPerUnitFromDescription > 0 ? qtyPerUnitFromDescription : 0) ||
      (Number.isFinite(qtyPerUnitFromRecord) && qtyPerUnitFromRecord > 0 ? qtyPerUnitFromRecord : 0) ||
      0
    const byUnit = description.match(/By\s*Unit:\s*(\d+)/i)
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
    const meta = parseReplacementMeta(record)
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

  const sanitizeReplacementText = (value: any): string => {
    const raw = String(value || '').trim()
    if (!raw) return 'N/A'
    return raw
      .replace(/driver\s+spare\s+products?/gi, 'replacement products')
      .replace(/\bspare\s+products?\b/gi, 'replacement products')
  }

  const replacementTabOrders = useMemo(() => {
    const base = Array.isArray(visibleOrders) && visibleOrders.length > 0 ? visibleOrders : orders
    return (Array.isArray(base) ? base : []).filter((order: any) => isReplacementOrder(order))
  }, [visibleOrders, orders])

  const totalPages = Math.max(1, Math.ceil(visibleOrders.length / PAGE_SIZE))
  const pagedOrders = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return visibleOrders.slice(start, start + PAGE_SIZE)
  }, [visibleOrders, currentPage])

  const startIndex = visibleOrders.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const endIndex = Math.min(currentPage * PAGE_SIZE, visibleOrders.length)

  useEffect(() => {
    setCurrentPage(1)
  }, [ordersSearch, ordersTab, visibleOrders.length])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  return (
    <section className="-mx-4 min-h-[calc(100dvh-7rem)] bg-[#f8fafc] pb-5 md:mx-0 md:rounded-2xl md:border md:border-slate-200 md:bg-white">
      <div className="border-b border-slate-200 px-3 py-3 md:px-4">
        <h2 className="text-[26px] font-extrabold tracking-[-0.02em] text-slate-900 md:text-[30px]">Purchase Request</h2>

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
        <div className="flex items-center justify-center py-14">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-700" />
        </div>
      ) : ordersTab === 'REPLACEMENT' ? (
        replacementTabOrders.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">No replacement orders found.</div>
        ) : (
          <div className="space-y-2.5 px-2.5 pt-2.5 md:px-4">
            {replacementTabOrders.map((o: any) => {
              const normalizedStatus = String(normalizeDeliveryStatus(o.status, o.paymentStatus))
              const orderItems = Array.isArray(o.items) ? o.items : []
              const replacementRequestDisplay = getReplacementRequestDisplay(o)
              const isDelivered = normalizedStatus === 'DELIVERED'
              const replacementRecord = getReplacementRecordForOrder(o)
              const replacementStatusLabel = replacementRecord ? getReplacementDisplayStatus(replacementRecord, o) : null
              const hasReplacementCase = Boolean(deliveryIssuesByOrderId[o.id])
              return (
                <div key={o.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm md:px-3.5 md:py-3.5">
                  <div className="grid gap-2.5 md:grid-cols-[1.35fr_1.05fr_0.72fr_0.8fr]">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                        <p className="text-[18px] font-semibold tracking-[-0.01em] text-slate-900">{o.orderNumber}</p>
                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Replacement</Badge>
                      </div>
                      <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                        <CalendarDays className="h-4 w-4" />
                        {normalizedStatus === 'DELIVERED' ? 'Delivered on ' : ''}
                        {new Date(o.deliveredAt || o.deliveryDate || o.createdAt).toLocaleDateString()} ·{' '}
                        {new Date(o.deliveredAt || o.deliveryDate || o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                      <p className="text-xs font-semibold text-slate-900">Order Items</p>
                      {orderItems.length > 0 ? (
                        <div className="space-y-1.5">
                          {orderItems.map((item: any, index: number) => (
                            <div key={`${o.id}-replacement-item-${item?.id || index}`} className="flex items-center gap-2">
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
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">No items</p>
                      )}
                      {isDelivered && !hasReplacementCase ? (
                        <p className="text-xs text-slate-500">No replacement case filed for this order.</p>
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
                      <p className="mt-1 text-xs text-slate-500">{formatOrderStatus(o.status, o.paymentStatus)}</p>
                    </div>

                    <div className="space-y-1.5 border-l border-slate-200 pl-2.5 md:pl-3">
                      <Button
                        variant="outline"
                        className="h-8 w-full rounded-md border-slate-300 text-[11px]"
                        onClick={() => {
                          const record = getReplacementRecordForOrder(o)
                          if (record) {
                            setSelectedReplacementRecord(record)
                            return
                          }
                          setSelectedOrder(o)
                        }}
                      >
                        View Details
                        <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                      {isOrderTrackable(o.status) && !isDelivered ? (
                        <Button
                          className="h-8 w-full rounded-md bg-emerald-600 text-[11px] text-white hover:bg-emerald-500"
                          onClick={() => openTrackView(o.id)}
                        >
                          <Truck className="mr-1 h-3.5 w-3.5" />
                          Track Replacement
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : visibleOrders.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">No orders found.</div>
      ) : (
        <div className="space-y-2.5 px-2.5 pt-2.5 md:px-4">
          {pagedOrders.map((o: any) => {
            const normalizedStatus = String(normalizeDeliveryStatus(o.status, o.paymentStatus))
            const orderItems = Array.isArray(o.items) ? o.items : []
            const replacementRequestDisplay = getReplacementRequestDisplay(o)
            const isDelivered = normalizedStatus === 'DELIVERED'
            const isReviewed = reviewedOrderIds.has(o.id)
            const shouldOpenReviewDirectly = ordersTab === 'TO_REVIEW' && isDelivered && !isReviewed && !isReplacementOrder(o)
            const submittedRating = Number(orderRatings[o.id] || 0)
            const hasSubmittedRating = submittedRating >= 1 && submittedRating <= 5
            const deliveryIssue = deliveryIssuesByOrderId[o.id]
            const hasActiveReplacement = hasActiveReplacementCase(o)
            const hasReplacementCase = Boolean(deliveryIssue)

            return (
              <div key={o.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm md:px-3.5 md:py-3.5">
                <div className="grid gap-2.5 md:grid-cols-[1.35fr_1.05fr_0.72fr_0.8fr]">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      <p className="text-[18px] font-semibold tracking-[-0.01em] text-slate-900">{o.orderNumber}</p>
                      {isReplacementOrder(o) ? (
                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Replacement</Badge>
                      ) : null}
                    </div>
                    <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                      <CalendarDays className="h-4 w-4" />
                      {normalizedStatus === 'DELIVERED' ? 'Delivered on ' : ''}
                      {new Date(o.deliveredAt || o.deliveryDate || o.createdAt).toLocaleDateString()} ·{' '}
                      {new Date(o.deliveredAt || o.deliveryDate || o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No items</p>
                    )}
                    {isDelivered && !hasReplacementCase ? (
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
                      <p className="mt-2 text-xs text-amber-700">
                        Rated: {'★'.repeat(submittedRating)}{'☆'.repeat(5 - submittedRating)}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-500">{formatOrderStatus(o.status, o.paymentStatus)}</p>
                  </div>

                  <div className="space-y-1.5 border-l border-slate-200 pl-2.5 md:pl-3">
                    <Button
                      variant="outline"
                      className="h-8 w-full rounded-md border-slate-300 text-[11px]"
                      onClick={() => {
                        if (isReplacementOrder(o)) {
                          const replacementRecord = getReplacementRecordForOrder(o)
                          if (replacementRecord) {
                            setSelectedReplacementRecord(replacementRecord)
                            return
                          }
                        }
                        if (shouldOpenReviewDirectly) {
                          openRatingDialog(o)
                          return
                        }
                        setSelectedOrder(o)
                      }}
                    >
                      {shouldOpenReviewDirectly ? 'Review' : 'View Details'}
                      <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                    {isOrderTrackable(o.status) && !(isDelivered && isReplacementOrder(o)) ? (
                      <Button
                        className="h-8 w-full rounded-md bg-emerald-600 text-[11px] text-white hover:bg-emerald-500"
                        onClick={() => {
                          if (isDelivered) {
                            buyAgainFromOrder?.(o)
                            return
                          }
                          openTrackView(o.id)
                        }}
                      >
                        <Truck className="mr-1 h-3.5 w-3.5" />
                        {isDelivered ? 'Buy Again' : isReplacementOrder(o) ? 'Track Replacement' : 'Track Order'}
                      </Button>
                    ) : isDelivered && !isReplacementOrder(o) ? (
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
                        {isReviewed ? 'Review Details' : 'Rate Order'}
                      </Button>
                    ) : null}
                    {isOrderCancellable(o.status, o.paymentStatus) ? (
                      <Button
                        variant="outline"
                        className="h-8 w-full rounded-md border-red-200 text-[11px] text-red-600 hover:bg-red-50"
                        onClick={() => void cancelOrder(o.id)}
                      >
                        Cancel Order
                      </Button>
                    ) : null}
                    {isDelivered && !isReplacementOrder(o) ? (
                      <Button
                        variant="outline"
                        className="h-8 w-full rounded-md border-emerald-200 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={hasActiveReplacement}
                        onClick={() => {
                          setSelectedOrder({ ...o, __openReplacementRequest: true })
                        }}
                      >
                        {hasActiveReplacement ? 'Replacement In Progress' : 'Request Replacement'}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}

          <div className="flex items-center justify-between px-1 pt-3 text-sm text-slate-600">
            <p>Showing {startIndex} to {endIndex} of {visibleOrders.length} orders</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" className="grid h-8 min-w-8 px-2 place-items-center rounded-md bg-emerald-100 font-semibold text-emerald-700">
                {currentPage}
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
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
          className="w-[95vw] max-h-[86vh] overflow-y-auto max-w-[760px] rounded-xl border border-slate-200 bg-white p-0 shadow-[0_30px_80px_rgba(2,6,23,0.30)]"
        >
        {selectedReplacementRecord ? (() => {
            const selectedOrder = orders.find((item: any) =>
              String(item?.id || '').trim() === String(selectedReplacementRecord?.orderId || '').trim() ||
              String(item?.orderNumber || '').trim().toUpperCase() === String(selectedReplacementRecord?.orderNumber || '').trim().toUpperCase()
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
            return (
              <>
                <DialogHeader className="px-4 py-3 md:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                        <Package2 className="h-5 w-5" />
                      </div>
                      <div>
                        <DialogTitle className="text-[20px] font-semibold tracking-[-0.01em] text-slate-900">
                          {selectedReplacementRecord?.replacementNumber || 'Replacement'}
                        </DialogTitle>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge className={getReplacementBadgeClass(statusLabel)}>{statusLabel}</Badge>
                        </div>
                        <DialogDescription className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                          <CalendarDays className="h-3.5 w-3.5 text-slate-500" />
                          {selectedReplacementRecord?.createdAt ? new Date(selectedReplacementRecord.createdAt).toLocaleString() : 'N/A'}
                        </DialogDescription>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                      onClick={() => setSelectedReplacementRecord(null)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </DialogHeader>
                <div className="space-y-3 px-4 pb-4 text-sm md:px-5 md:pb-5">
                  <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                    <p><span className="font-semibold text-slate-900">Order #:</span> {selectedReplacementRecord?.orderNumber || 'N/A'}</p>
                    <p><span className="font-semibold text-slate-900">Status:</span> {statusLabel}</p>
                    <p><span className="font-semibold text-slate-900">Product:</span> {selectedReplacementRecord?.originalProductName || selectedReplacementRecord?.replacementProductName || 'N/A'}</p>
                    <p><span className="font-semibold text-slate-900">Quantity:</span> {qtyLabel}</p>
                    <p className="md:col-span-2"><span className="font-semibold text-slate-900">Reason:</span> {sanitizeReplacementText(selectedReplacementRecord?.reason)}</p>
                    <p className="md:col-span-2"><span className="font-semibold text-slate-900">Description:</span> {sanitizeReplacementText(selectedReplacementRecord?.description)}</p>
                    <p><span className="font-semibold text-slate-900">Reported:</span> {selectedReplacementRecord?.createdAt ? new Date(selectedReplacementRecord.createdAt).toLocaleString() : 'N/A'}</p>
                    <p><span className="font-semibold text-slate-900">Updated:</span> {selectedReplacementRecord?.updatedAt ? new Date(selectedReplacementRecord.updatedAt).toLocaleString() : 'N/A'}</p>
                  </div>
                  {evidenceUrls.length > 0 ? (
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="mb-2 text-xs font-semibold text-slate-700">Evidence ({evidenceUrls.length})</p>
                      <div className="grid gap-2 md:grid-cols-2">
                        {evidenceUrls.map((url, index) => (
                          <img
                            key={`${url}-${index}`}
                            src={url}
                            alt={`Replacement evidence ${index + 1}`}
                            className="max-h-[320px] w-full rounded-md border object-contain"
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex justify-end pt-1">
                    <Button className="h-9 rounded-lg bg-emerald-600 text-xs text-white hover:bg-emerald-500 md:h-10 md:text-sm" onClick={() => setSelectedReplacementRecord(null)}>
                      Close
                    </Button>
                  </div>
                </div>
              </>
            )
          })() : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}
