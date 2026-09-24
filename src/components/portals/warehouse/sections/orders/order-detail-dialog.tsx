'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DepositRefundRow, describeEmptiesShortfall, getEmptiesAdjustment, getOrderTotalWithEmpties } from '@/components/shared/empties-charge-note'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import type { WarehouseItem, WarehouseOrderItem } from '../../warehouse-portal-types'
import { formatPeso } from '../../warehouse-portal-utils'
import {
  PackageCheck,
  Truck,
  MapPin,
  Warehouse,
  Loader2,
  CircleCheck,
  ClipboardList,
  User,
  Mail,
  Phone,
  Building2,
  Clock,
  Route,
  Car,
  CalendarClock,
  Camera,
} from 'lucide-react'
import { CompactDiscountLine } from '@/components/shared/compact-discount-line'
import { PodImagePreview } from '@/components/shared/pod-image-preview'
import { getWarehouseOrderStatusTextClass, isWarehouseRescheduledOrder, formatScheduledDeliveryDate, formatWarehouseOrderAddress, getOrderItemSizeLabel } from '../../warehouse-order-helpers'
import type { MutableRefObject } from 'react'
import type { deriveOrderFulfillmentSummaryImpl } from '../../warehouse-order-helpers'

/**
 * Full order detail with fulfillment legs and the status actions a warehouse can take.
 */
export type WarehouseOrderDetailDialogProps = {
  assignedWarehouse: WarehouseItem | null
  deriveOrderFulfillmentSummary: (order: any) => ReturnType<typeof deriveOrderFulfillmentSummaryImpl>
  getWarehouseDisplayOrderStatus: (order: any) => string
  loadingOrderDetail: boolean
  orderDetailRequestRef: MutableRefObject<number>
  orders: WarehouseOrderItem[]
  selectedOrder: WarehouseOrderItem | null
  setSelectedOrder: Dispatch<SetStateAction<WarehouseOrderItem | null>>
  updateWarehouseOrderStatus: (orderId: string, status: 'APPROVED' | 'PREPARING' | 'RESCHEDULED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'REJECTED', reason?: string, deliveryDate?: string) => Promise<boolean>
  updatingOrderId: string | null
}

export function WarehouseOrderDetailDialog({
  assignedWarehouse,
  deriveOrderFulfillmentSummary,
  getWarehouseDisplayOrderStatus,
  loadingOrderDetail,
  orderDetailRequestRef,
  orders,
  selectedOrder,
  setSelectedOrder,
  updateWarehouseOrderStatus,
  updatingOrderId,
}: WarehouseOrderDetailDialogProps) {
  return (
    <Dialog open={!!selectedOrder} onOpenChange={(open) => { if (!open) { orderDetailRequestRef.current += 1; setSelectedOrder(null) } }}>
      <DialogContent className="flex max-h-[92vh] w-[95vw] max-w-[980px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
        {selectedOrder && (
          <>
            {(() => {
              const isReplacementOrderInDetails =
                Boolean((selectedOrder as any)?.isScheduledReplacement) ||
                String((selectedOrder as any)?.orderNumber || '').trim().toUpperCase().startsWith('RPL-')
              const isRescheduledOrderInDetails = isWarehouseRescheduledOrder(selectedOrder)
              return (
                <>
            <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-4 sm:px-7">
              <DialogTitle className="flex items-center gap-3 text-[0.98rem] font-bold tracking-tight text-slate-900 sm:text-[1.3rem]">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100 sm:h-11 sm:w-11">
                  <ClipboardList className="h-5 w-5 sm:h-6 sm:w-6" />
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span>Order Details - {selectedOrder.orderNumber}</span>
                  {isRescheduledOrderInDetails ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Rescheduled Order</span>
                  ) : null}
                </span>
              </DialogTitle>
              <DialogDescription>{loadingOrderDetail ? 'Loading latest order details...' : undefined}</DialogDescription>
            </DialogHeader>
            <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4 sm:space-y-4 sm:px-7 sm:py-5">
              <div className="grid gap-3 sm:gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/45 p-3.5 sm:p-4.5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-600">Order Status</p>
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700 sm:h-11 sm:w-11">
                      <Truck className="h-5 w-5" />
                    </div>
                  </div>
                  {(() => {
                    const displayStatus = getWarehouseDisplayOrderStatus(selectedOrder)
                    return (
                      <p className={`text-[0.8rem] font-bold leading-tight sm:text-[0.98rem] ${getWarehouseOrderStatusTextClass(displayStatus)}`}>
                        {displayStatus}
                      </p>
                    )
                  })()}
                </div>
                <div className="rounded-2xl border border-blue-200 bg-blue-50/45 p-3.5 sm:p-4.5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-600">Driver Assignment</p>
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-blue-100 text-blue-700 sm:h-11 sm:w-11">
                      <Building2 className="h-5 w-5" />
                    </div>
                  </div>
                  {selectedOrder.isDriverAssigned ? (
                    <p className="text-[0.8rem] font-bold leading-tight text-blue-700 sm:text-[0.98rem]">{selectedOrder.assignedDriverName || 'Assigned'}</p>
                  ) : (
                    <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                      Not Assigned
                    </div>
                  )}
                </div>
                {/* Added: the customer's scheduled delivery date belongs on the PO
                    so warehouse staff know when the order is expected out. */}
                <div className="rounded-2xl border border-violet-200 bg-violet-50/45 p-3.5 sm:p-4.5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-600">Scheduled Delivery</p>
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-violet-100 text-violet-700 sm:h-11 sm:w-11">
                      <CalendarClock className="h-5 w-5" />
                    </div>
                  </div>
                  {formatScheduledDeliveryDate(selectedOrder) ? (
                    <p className="text-[0.8rem] font-bold leading-tight text-violet-700 sm:text-[0.98rem]">
                      {formatScheduledDeliveryDate(selectedOrder)}
                    </p>
                  ) : (
                    <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                      Not Scheduled
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
                            <p className="mt-1 text-xs font-medium text-amber-700">Needs trip assignment.</p>
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
                  <p className="flex items-start gap-3 text-sm sm:text-base"><MapPin className="mt-1 h-5 w-5 shrink-0 text-slate-500" />{formatWarehouseOrderAddress(selectedOrder)}</p>
                </div>
              </div>
              {(() => {
                const summary = deriveOrderFulfillmentSummary(selectedOrder)
                const isMultiWarehouse = summary.totalLegs > 1
                const assignedWarehouseId = String(assignedWarehouse?.id || '').trim()
                const orderItems = Array.isArray(selectedOrder.items) ? selectedOrder.items : []
                const getItemAllocatedForWarehouse = (item: any) => {
                  const allocs = Array.isArray(item?.warehouseAllocations) ? item.warehouseAllocations : []
                  const fromItem = allocs
                    .filter((entry: any) => String(entry?.warehouseId || entry?.warehouse_id || '').trim() === assignedWarehouseId)
                    .reduce((sum: number, entry: any) => sum + Number(entry?.allocatedQty || entry?.quantity || 0), 0)
                  if (fromItem > 0) return fromItem
                  const orderHasAllocationData = Array.isArray(selectedOrder?.warehouseAllocations) && selectedOrder.warehouseAllocations.length > 0
                  if (orderHasAllocationData) return 0
                  return Number(item?.quantity || 0)
                }
                const warehouseScopedTotal = orderItems.reduce((sum: number, item: any) => {
                  const allocatedQty = getItemAllocatedForWarehouse(item)
                  const unitPrice = Number(item?.unitPrice ?? item?.unit_price ?? 0)
                  const lineTotal = Number(item?.totalPrice ?? item?.total_price ?? 0)
                  const safeLineTotal = lineTotal > 0 ? lineTotal : unitPrice * Number(item?.quantity || 0)
                  const qty = Number(item?.quantity || 0)
                  const ratio = qty > 0 ? allocatedQty / qty : 0
                  return sum + (ratio > 0 ? safeLineTotal * ratio : 0)
                }, 0)
            
                return (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <p className="mb-3 flex items-center gap-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                        <PackageCheck className="h-5 w-5" />
                      </span>
                      Order Details
                    </p>
                    <div className="space-y-2">
                      {orderItems.map((item: any) => {
                        const isMixedCase = item?.itemType === 'MIXED_CASE'
                        return (
                        <div key={item.id} className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-2.5">
                            {!isMixedCase ? <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                              {item?.product?.imageUrl ? (
                                <img
                                  src={String(item.product.imageUrl)}
                                  alt={String(item?.product?.name || 'Product')}
                                  className="h-full w-full object-contain"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none'
                                    if (e.currentTarget.parentElement) {
                                      const fallback = document.createElement('div')
                                      fallback.className = 'grid h-full w-full place-items-center text-[10px] text-slate-400'
                                      fallback.textContent = 'No image'
                                      e.currentTarget.parentElement.appendChild(fallback)
                                    }
                                  }}
                                />
                              ) : (
                                <div className="grid h-full w-full place-items-center text-[10px] text-slate-400">No image</div>
                              )}
                            </div> : null}
                            <div className="min-w-0 pt-0.5">
                              <p className="text-sm text-slate-800 sm:text-[1.02rem]">
                                {isMixedCase ? 'Mixed Case' : item.product?.name || 'Product'}
                                {!isMixedCase && getOrderItemSizeLabel(item) ? ` ${getOrderItemSizeLabel(item)}` : ''}
                                {' '}x{item.quantity}
                              </p>
                              {/* Mixed-case component photos are intentionally shown only in View Details. */}
                              {isMixedCase ? <MixedCaseComponents item={item} compact /> : null}
                              {String(item?.product?.category?.name || item?.product?.category || '').trim() ? (
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {String(item?.product?.category?.name || item?.product?.category || '').trim()}
                                </p>
                              ) : null}
                              {isMultiWarehouse && (
                                <p className="mt-1 text-sm font-semibold text-slate-900">
                                  Allocated for this warehouse: {getItemAllocatedForWarehouse(item)}
                                </p>
                              )}
                              <CompactDiscountLine
                                value={formatPeso(Number((selectedOrder as any)?.discountDetails?.totalDiscount || (selectedOrder as any)?.discount || 0))}
                                percent={(() => {
                                  const explicitPercent = Number((selectedOrder as any)?.discountDetails?.percent)
                                  if (Number.isFinite(explicitPercent) && explicitPercent > 0) return explicitPercent
                                  const subtotal = Number((selectedOrder as any)?.subtotal || 0)
                                  const discount = Number((selectedOrder as any)?.discountDetails?.totalDiscount || (selectedOrder as any)?.discount || 0)
                                  if (subtotal > 0 && discount > 0) return (discount / subtotal) * 100
                                  return 0
                                })()}
                                className="mt-1 text-sm font-semibold text-[#2b4f83]"
                              />
                            </div>
                          </div>
                          <span className="pt-1 text-sm font-semibold text-slate-900 sm:text-[1.05rem]">{formatPeso((item.totalPrice ?? item.quantity * item.unitPrice) || 0)}</span>
                        </div>
                        )
                      })}
                      <div className="h-px bg-slate-200" />
                      <DepositRefundRow order={selectedOrder} className="text-xs" />
                      {isMultiWarehouse ? (
                        <p className="text-right text-[1.08rem] font-bold leading-tight text-slate-900 sm:text-[1.35rem]">
                          Warehouse scoped total: <span className="text-emerald-700">{formatPeso(warehouseScopedTotal || 0)}</span>
                        </p>
                      ) : (
                        <>
                          {getEmptiesAdjustment(selectedOrder) ? (
                            <div className="text-right text-[12px] leading-4 text-[#8a7135]">
                              <p className="font-semibold text-[#7a5c15]">
                                Order total {formatPeso(selectedOrder.totalAmount || 0)} + empties deposit {formatPeso(Number(getEmptiesAdjustment(selectedOrder)?.amount || 0))}
                              </p>
                              <p>{describeEmptiesShortfall(getEmptiesAdjustment(selectedOrder))}</p>
                            </div>
                          ) : null}
                          <p className="text-right text-[1.08rem] font-bold leading-tight text-slate-900 sm:text-[1.35rem]">
                            Order total: <span className="text-emerald-700">{formatPeso(getOrderTotalWithEmpties(selectedOrder))}</span>
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                )
              })()}
              {(() => {
                const hasTrip =
                  String(selectedOrder.status || '').trim().toUpperCase() !== 'RESCHEDULED' &&
                  Boolean(selectedOrder.progress?.trip || selectedOrder.assignedTripId || selectedOrder.tripId)
                if (!hasTrip) return null
                return (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="mb-2 flex items-center justify-between gap-3">
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
                      <p className="flex items-center gap-3"><User className="h-5 w-5 text-slate-500" />Driver: {selectedOrder.progress?.trip?.driver?.user?.name || selectedOrder.progress?.trip?.driver?.name || selectedOrder.assignedDriverName || 'Not assigned yet'}</p>
                      <p className="flex items-center gap-3"><Car className="h-5 w-5 text-slate-500" />Vehicle: {selectedOrder.progress?.trip?.vehicle?.licensePlate || 'Not assigned yet'}</p>
                      <p><span className="inline-flex items-center gap-3"><CalendarClock className="h-5 w-5 text-slate-500" />Arrival: {selectedOrder.progress?.pod?.actualArrival ? new Date(selectedOrder.progress.pod.actualArrival).toLocaleString() : 'N/A'}</span></p>
                      <p><span className="inline-flex items-center gap-3"><CalendarClock className="h-5 w-5 text-slate-500" />Departure: {selectedOrder.progress?.pod?.actualDeparture ? new Date(selectedOrder.progress.pod.actualDeparture).toLocaleString() : 'N/A'}</span></p>
                    </div>
                    {(() => {
                      const trip = selectedOrder.progress?.trip
                      const points = Array.isArray(trip?.dropPoints) ? trip.dropPoints : []
                      const selectedSchedule = String(
                        selectedOrder.deliveryDate || trip?.tripSchedule || ''
                      )
                        .trim()
                        .slice(0, 10)
                      const scheduledOrders = points
                        .map((point: any) => point?.order)
                        .filter((order: any) => order && String(order.id || '').trim())
                        .filter((order: any) => {
                          if (!selectedSchedule) return true
                          return String(order.deliveryDate || '').trim().slice(0, 10) === selectedSchedule
                        })
                        .filter(
                          (order: any, index: number, rows: any[]) =>
                            rows.findIndex((candidate: any) => String(candidate.id) === String(order.id)) === index
                        )

                      return (
                        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                          <p className="text-xs font-medium text-slate-500">Scheduled Orders On This Trip</p>
                          {scheduledOrders.length === 0 ? (
                            <p className="mt-1 text-sm text-slate-600">No scheduled orders found for this trip date.</p>
                          ) : (
                            <div className="mt-1 space-y-1">
                              {scheduledOrders.map((order: any) => {
                                const rawStatus = String(order.status || 'N/A').toUpperCase()
                                const rawScheduleDate = String(order.deliveryDate || order.timeline?.deliveryDate || '').trim()
                                const parsedScheduleDate = rawScheduleDate ? new Date(rawScheduleDate) : null
                                const hasValidScheduleDate = Boolean(parsedScheduleDate && !Number.isNaN(parsedScheduleDate.getTime()))
                                const scheduleLabel = hasValidScheduleDate
                                  ? parsedScheduleDate!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                  : null

                                return (
                                  <div key={String(order.id)} className="flex items-center justify-between text-sm text-slate-700">
                                    <span className="inline-flex items-center gap-2">
                                      <span>{String(order.orderNumber || order.id || 'Order')}</span>
                                      {isWarehouseRescheduledOrder(order) ? (
                                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Rescheduled Order</span>
                                      ) : null}
                                      {(Boolean((order as any)?.isScheduledReplacement) || String(order?.orderNumber || '').toUpperCase().startsWith('RPL-')) ? (
                                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Scheduled Replacement</span>
                                      ) : null}
                                    </span>
                                    <span className="text-xs uppercase text-slate-500">
                                      {rawStatus.replace(/_/g, ' ')}
                                      {rawStatus === 'RESCHEDULED' && scheduleLabel ? ` • ${scheduleLabel}` : ''}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}
              {(() => {
                const hasTrip =
                  String(selectedOrder.status || '').trim().toUpperCase() !== 'RESCHEDULED' &&
                  Boolean(selectedOrder.progress?.trip || selectedOrder.assignedTripId || selectedOrder.tripId)
                if (!hasTrip) return null
                return (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                    <p className="mb-3 flex items-center gap-3 text-[1.05rem] font-bold tracking-tight text-slate-900 sm:text-[1.2rem]">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-50 text-amber-600">
                        <Camera className="h-5 w-5" />
                      </span>
                      Proof Of Delivery
                    </p>
                    {selectedOrder.progress?.pod?.deliveryPhoto ? (
                      <PodImagePreview
                        src={selectedOrder.progress.pod.deliveryPhoto}
                        alt="Proof of delivery"
                        className="mt-2 h-64 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain"
                      />
                    ) : (
                      <p className="mt-1 text-base italic text-slate-500">No POD uploaded yet.</p>
                    )}
                  </div>
                )
              })()}
              {(() => {
                const selectedOrderStatus = String(selectedOrder.status || '').toUpperCase()
                const isPendingApproval = String(selectedOrder.paymentStatus || '').toLowerCase() === 'pending_approval'
                const isAlreadyApproved = selectedOrderStatus === 'APPROVED'
                const isUpdatingSelectedOrder = updatingOrderId === selectedOrder.id
                return (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {isAlreadyApproved ? (
                      <Button variant="outline" disabled>
                        Order Approved
                      </Button>
                    ) : isPendingApproval || selectedOrderStatus === 'PENDING' ? (
                      <Button
                        className="bg-emerald-600 text-white hover:bg-emerald-700"
                        // PR approval must generate its PO before preparation starts.
                        onClick={() => void updateWarehouseOrderStatus(selectedOrder.id, 'APPROVED')}
                        disabled={isUpdatingSelectedOrder}
                        aria-busy={isUpdatingSelectedOrder}
                      >
                        {/* Fix: make the approval request visible while duplicate clicks are blocked. */}
                        {isUpdatingSelectedOrder ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {isUpdatingSelectedOrder ? 'Approving Order...' : 'Approve Order'}
                      </Button>
                    ) : selectedOrderStatus === 'RESCHEDULED' ? (
                      <Button variant="outline" disabled>
                        {/* Fix: a new delivery date alone must not start warehouse processing. */}
                        Order Rescheduled
                      </Button>
                    ) : (
                      <Button variant="outline" disabled>
                        No Action
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => { orderDetailRequestRef.current += 1; setSelectedOrder(null) }}>
                      Close
                    </Button>
                  </div>
                )
              })()}
            </div>
                </>
              )
            })()}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
