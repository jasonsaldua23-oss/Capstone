'use client'

import { Search, Loader2, Truck, ChevronRight } from 'lucide-react'
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
    setSelectedOrder,
    isOrderTrackable,
    openTrackView,
    getProductImage,
    formatPeso,
  } = props

  return (
<section className="-mx-4 -mt-4 bg-white/55 pb-6 md:mx-0 md:mt-0 md:rounded-[1.6rem] md:border md:border-emerald-100/70 md:bg-white/75 md:pb-4 md:shadow-[0_18px_45px_rgba(5,150,105,0.10)] md:backdrop-blur-xl">
            <div className="border-b bg-white px-4 py-3 md:rounded-t-xl">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 shadow-[inset_0_1px_1px_rgba(15,23,42,0.04)]">
                <Search className="h-4 w-4 text-slate-500" />
                <Input
                  value={ordersSearch}
                  onChange={(e) => setOrdersSearch(e.target.value)}
                  placeholder="Search order"
                  className="h-auto border-0 bg-transparent p-0 text-sm text-slate-700 shadow-none focus-visible:ring-0 placeholder:text-slate-500"
                />
                {ordersSearch ? (
                  <button
                    type="button"
                    onClick={() => setOrdersSearch('')}
                    className="rounded-md px-2 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="mt-3 flex gap-5 overflow-x-auto text-sm">
                {ordersTabOptions.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setOrdersTab(tab.id)}
                    className={`whitespace-nowrap border-b-2 pb-2 ${
                      ordersTab === tab.id
                        ? 'border-sky-700 font-semibold text-sky-700'
                        : 'border-transparent text-slate-500'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-cyan-700" />
              </div>
            ) : ordersTab === 'REPLACEMENT' ? (
              visibleReplacementRecords.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">No replacement records found.</div>
              ) : (
                <div className="space-y-3 px-3 pt-3">
                  {visibleReplacementRecords.map((record) => {
                    const statusLabel = getReplacementStatusLabel(record.status)
                    const order = orders.find((item) => item.id === record.orderId) || null
                    const replacedQty = Number(record.replacementQuantity || 0)
                    const originalQty = Number(record.originalQuantity || 0)
                    const remainingQty = Number(record.remainingQuantity ?? Math.max(originalQty - replacedQty, 0))
                    const showRemaining = statusLabel === 'Partially Resolved' && remainingQty > 0
                    const replacedProduct =
                      String(record.replacementProductName || '').trim() ||
                      String(record.originalProductName || '').trim() ||
                      'N/A'

                    return (
                      <div
                        key={record.id}
                        onClick={() => {
                          if (order) setSelectedOrder(order)
                        }}
                        className="rounded-lg border border-slate-200/50 bg-white/95 shadow-[0_2px_6px_rgba(0,0,0,0.04)] transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_12px_rgba(0,0,0,0.08)]"
                      >
                        <div className="flex items-center justify-between border-b border-slate-200/70 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-800">{record.orderNumber || order?.orderNumber || 'Order'}</p>
                            {record.replacementNumber ? <p className="text-xs text-slate-500">{record.replacementNumber}</p> : null}
                          </div>
                          <Badge className={getReplacementBadgeClass(statusLabel)}>{statusLabel}</Badge>
                        </div>

                        <div className="px-3 py-3">
                          <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs">
                            <p className="text-slate-500">Product Replaced</p>
                            <p className="font-semibold text-slate-900">{replacedProduct}</p>
                          </div>
                          <div className={`grid gap-2 text-xs ${showRemaining ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                              <p className="text-slate-500">Quantity Replaced</p>
                              <p className="font-semibold text-slate-900">{replacedQty}</p>
                            </div>
                            {showRemaining ? (
                              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                                <p className="text-slate-500">Remaining</p>
                                <p className="font-semibold text-slate-900">{remainingQty}</p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            ) : visibleOrders.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">No orders found.</div>
            ) : (
              <div className="space-y-3 px-3 pt-3">
                {visibleOrders.map((o) => {
                  const normalizedStatus = String(normalizeDeliveryStatus(o.status, o.paymentStatus))
                  const deliveryIssue = deliveryIssuesByOrderId[o.id]
                  const firstItem = o.items?.[0]
                  const isDelivered = normalizedStatus === 'DELIVERED'
                  const isReviewed = reviewedOrderIds.has(o.id)
                  const shouldOpenReviewDirectly = ordersTab === 'TO_REVIEW' && isDelivered && !isReviewed
                  const submittedRating = Number(orderRatings[o.id] || 0)
                  const hasSubmittedRating = submittedRating >= 1 && submittedRating <= 5
                  const deliveryLabel = isDelivered
                    ? `${new Date(o.deliveredAt || o.deliveryDate || o.createdAt).toLocaleDateString()} Delivered`
                    : o.deliveryDate
                      ? `${new Date(o.deliveryDate).toLocaleDateString()} ${formatOrderStatus(o.status, o.paymentStatus)}`
                      : 'Delivery status updated'

                  return (
                    <div
                      key={o.id}
                      onClick={() => setSelectedOrder(o)}
                      className="rounded-lg border border-slate-200/50 bg-white/95 shadow-[0_2px_6px_rgba(0,0,0,0.04)] transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_12px_rgba(0,0,0,0.08)]"
                    >
                      <div className="flex items-center justify-between border-b border-slate-200/70 px-3 py-2 text-sm">
                        <div className="min-w-0 truncate font-medium text-slate-800">{o.orderNumber}</div>
                        <div className="ml-2 shrink-0 flex items-center gap-2 text-sm text-slate-700">
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
                          <span>{formatOrderStatus(o.status, o.paymentStatus).toLowerCase()}</span>
                        </div>
                      </div>

                      <div className="mx-3 mt-3 flex items-center justify-between rounded-full bg-slate-100/90 px-3 py-2 text-sm text-slate-700">
                        <div className="flex items-center gap-2">
                          <Truck className="h-4 w-4 text-slate-500" />
                          <span>{deliveryLabel}</span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </div>

                      <div className="flex items-start gap-3 px-3 py-3">
                        <img
                          src={getProductImage(firstItem?.product?.imageUrl)}
                          alt={firstItem?.product?.name || 'Product'}
                          className="h-12 w-12 rounded border border-slate-200 object-cover bg-white"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-900">{firstItem?.product?.name || 'Order items'}</p>
                          <p className="mt-1 text-xs text-slate-500">x{firstItem?.quantity || 0}</p>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">{formatPeso(o.totalAmount)}</p>
                      </div>

                      {isDelivered && hasSubmittedRating ? (
                        <div className="-mt-1 px-3 pb-2 text-xs text-amber-700">
                          Rated: {'★'.repeat(submittedRating)}{'☆'.repeat(5 - submittedRating)} ({submittedRating}/5)
                        </div>
                      ) : null}

                      <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
                        {isOrderCancellable(o.status, o.paymentStatus) ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 border-red-200 px-3 text-xs text-red-600 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation()
                              void cancelOrder(o.id)
                            }}
                          >
                            Cancel Order
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 border-slate-300 px-3 text-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (shouldOpenReviewDirectly) {
                              openRatingDialog(o)
                              return
                            }
                            setSelectedOrder(o)
                          }}
                        >
                          {shouldOpenReviewDirectly ? 'Review' : 'View details'}
                        </Button>
                        {isOrderTrackable(o.status) ? (
                          <Button
                            size="sm"
                            className="h-8 bg-teal-700 px-3 text-xs text-white hover:bg-teal-800"
                            onClick={(e) => {
                              e.stopPropagation()
                              openTrackView(o.id)
                            }}
                          >
                            Track
                          </Button>
                        ) : isDelivered ? (
                          <Button
                            size="sm"
                            className="h-8 bg-rose-600 px-3 text-xs text-white hover:bg-rose-700 disabled:opacity-70"
                            onClick={(e) => {
                              e.stopPropagation()
                              openRatingDialog(o)
                            }}
                            disabled={isReviewed}
                          >
                            {isReviewed ? 'Rated' : 'Rate order'}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
  )
}
