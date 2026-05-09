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
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
        visibleReplacementRecords.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">No replacement records found.</div>
        ) : (
          <div className="space-y-3 px-3 pt-4 md:px-6">
            {visibleReplacementRecords.map((record: any) => {
              const statusLabel = getReplacementStatusLabel(record.status)
              const order = orders.find((item: any) => item.id === record.orderId) || null
              return (
                <div
                  key={record.id}
                  onClick={() => {
                    if (order) setSelectedOrder(order)
                  }}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-900">{record.orderNumber || order?.orderNumber || 'Order'}</p>
                    <Badge className={getReplacementBadgeClass(statusLabel)}>{statusLabel}</Badge>
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
            const isDelivered = normalizedStatus === 'DELIVERED'
            const isReviewed = reviewedOrderIds.has(o.id)
            const shouldOpenReviewDirectly = ordersTab === 'TO_REVIEW' && isDelivered && !isReviewed
            const submittedRating = Number(orderRatings[o.id] || 0)
            const hasSubmittedRating = submittedRating >= 1 && submittedRating <= 5
            const deliveryIssue = deliveryIssuesByOrderId[o.id]
            const hasReplacementCase = Boolean(deliveryIssue)

            return (
              <div key={o.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm md:px-3.5 md:py-3.5">
                <div className="grid gap-2.5 md:grid-cols-[1.35fr_1.05fr_0.72fr_0.8fr]">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      <p className="text-[18px] font-semibold tracking-[-0.01em] text-slate-900">{o.orderNumber}</p>
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
                              <p className="text-xs text-slate-800">{item?.product?.name || 'Product'}</p>
                              <p className="text-xs text-slate-500">x{item?.quantity || 0}</p>
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
                    {isOrderTrackable(o.status) ? (
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
                        {isDelivered ? 'Buy Again' : 'Track Order'}
                      </Button>
                    ) : isDelivered ? (
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
                    {isDelivered ? (
                      <Button
                        variant="outline"
                        className="h-8 w-full rounded-md border-emerald-200 text-[11px] text-emerald-700 hover:bg-emerald-50"
                        onClick={() => setSelectedOrder({ ...o, __openReplacementRequest: true })}
                      >
                        Request Replacement
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
    </section>
  )
}
