'use client'

import { useMemo, useState } from 'react'
import { Eye, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { buildOrderActionReason, OrderReasonCheckboxes, WAREHOUSE_ORDER_REASONS } from '@/components/portals/shared/order-reason-checkboxes'
import type { WarehouseOrdersViewProps } from '../shared/types'

type OrderAction = 'processing' | 'assign' | 'delivered' | 'completed' | 'cancel'

const orderBadgeClass: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  PROCESSING: 'bg-sky-100 text-sky-800 hover:bg-sky-100',
  READY_FOR_DELIVERY: 'bg-violet-100 text-violet-800 hover:bg-violet-100',
  FOR_DELIVERY: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-100',
  OUT_FOR_DELIVERY: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
  DELIVERED: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  COMPLETED: 'bg-emerald-200 text-emerald-950 hover:bg-emerald-200',
  CANCELLED: 'bg-slate-200 text-slate-700 hover:bg-slate-200',
}

function formatStage(value: string) {
  return String(value || 'APPROVED').replace(/_/g, ' ')
}

// Keep long database IDs readable in the table while exposing the full value on hover.
function formatTransactionId(value: unknown): string {
  const id = String(value || '').trim()
  return id.length > 20 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id
}

function getOrderStage(order: any): string {
  const explicit = String(order?.purchaseOrderStage || '').toUpperCase()
  if (explicit && explicit !== 'APPROVED') return explicit
  const status = String(order?.status || '').toUpperCase()
  if (status === 'PREPARING') return 'PROCESSING'
  if (status === 'OUT_FOR_DELIVERY') return 'OUT_FOR_DELIVERY'
  if (status === 'DELIVERED') return 'DELIVERED'
  if (status === 'CANCELLED' || status === 'REJECTED') return 'CANCELLED'
  return explicit || 'APPROVED'
}

function isApprovedPurchaseOrder(order: any): boolean {
  const requestStatus = String(order?.requestStatus || order?.request_status || '').trim().toUpperCase()
  const purchaseOrderStage = String(order?.purchaseOrderStage || order?.purchase_order_stage || '').trim()
  const purchaseOrderNumber = String(order?.purchaseOrderNumber || order?.purchase_order_number || '').trim()
  // Approval must create all PO workflow metadata before this record can enter the PO view.
  return requestStatus === 'APPROVED' && Boolean(purchaseOrderStage) && Boolean(purchaseOrderNumber)
}

function isMixedCaseItem(item: any) {
  return String(item?.itemType || item?.item_type || '').toUpperCase() === 'MIXED_CASE'
}

function formatProductNameWithSize(item: any): string {
  const name = String(item?.productName || item?.product?.name || 'Product').trim()
  const productSizes = Array.isArray(item?.product?.sizes)
    ? item.product.sizes.map((size: unknown) => String(size || '').trim()).filter(Boolean).join(' ')
    : ''
  const explicitSize = String(
    item?.sizeLabel || item?.productSize || item?.product?.sizeLabel || productSizes || ''
  ).trim()
  const unit = String(item?.productUnit || item?.product?.unit || '').trim()
  const size = explicitSize || (/\d\s*(ml|l|liter|litre|oz|cl|g|kg)\b/i.test(unit) ? unit : '')

  // Product sizes are appended once with plain spacing; parentheses are intentionally removed.
  const cleanName = name.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  const cleanSize = size.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()
  return cleanSize && !cleanName.toLowerCase().includes(cleanSize.toLowerCase())
    ? `${cleanName} ${cleanSize}`
    : cleanName
}

function formatOrderItemContents(item: any) {
  if (!isMixedCaseItem(item)) {
    const qty = Number(item?.quantity || 0)
    return `${formatProductNameWithSize(item)} x${qty}`
  }

  const caseCount = Number(item?.quantity || 1)
  const capacity = Number(item?.caseCapacity || 0)
  const rawComponents = Array.isArray(item?.components) ? item.components : []
  const components = rawComponents.map((component: any) => {
    const perCase = Number(component?.quantityPerCase || 0)
    const total = Number(component?.totalBaseUnits || perCase * caseCount)
    const label = String(component?.baseUnitLabel || 'unit').trim() || 'unit'
    return `${component?.productName || component?.product?.name || 'Product'} ${perCase} ${label}(s)/case (${total} total)`
  })
  return `Mixed Case (${capacity} units) x${caseCount}${components.length > 0 ? `: ${components.join('; ')}` : ''}`
}

export function WarehouseOrdersView({
  loadingOrders,
  purchaseOrders,
  formatPeso,
  openOrderDetail,
  updateWarehouseOrderStatus,
  updatingOrderId,
  onOpenTransportation,
}: WarehouseOrdersViewProps) {
  const [search, setSearch] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('all')
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')
  const [dateApprovedFilter, setDateApprovedFilter] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [actionState, setActionState] = useState<{ order: any; action: OrderAction } | null>(null)
  const [selectedCancelReasons, setSelectedCancelReasons] = useState<string[]>([])
  const [otherCancelReason, setOtherCancelReason] = useState('')

  const warehouseOptions = useMemo(() => {
    return Array.from(
      new Set(
        purchaseOrders
          .filter(isApprovedPurchaseOrder)
          .map((order) => String(order?.warehouseName || order?.warehouseCode || 'Unassigned').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b))
  }, [purchaseOrders])

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase()
    const min = Number(minAmount)
    const max = Number(maxAmount)
    return purchaseOrders.filter((order) => {
      if (!isApprovedPurchaseOrder(order)) return false
      const purchaseOrderStage = getOrderStage(order)
      const warehouseLabel = String(order?.warehouseName || order?.warehouseCode || 'Unassigned').trim()
      const amount = Number(order?.totalAmount || 0)
      const dateApproved = String(order?.dateApproved || order?.approvedAt || '').slice(0, 10)
      const productText = Array.isArray(order?.items)
        ? order.items.map((item: any) => [
            formatOrderItemContents(item),
            ...(Array.isArray(item?.components)
              ? item.components.flatMap((component: any) => [component?.productName, component?.productSku])
              : []),
          ].join(' ')).join(' ')
        : ''

      if (orderStatusFilter !== 'all' && purchaseOrderStage !== orderStatusFilter) return false
      if (dateApprovedFilter && dateApproved !== dateApprovedFilter) return false
      if (minAmount.trim() && Number.isFinite(min) && amount < min) return false
      if (maxAmount.trim() && Number.isFinite(max) && amount > max) return false
      if (!query) return true

      return [
        order?.orderNumber,
        order?.purchaseRequestNumber,
        order?.customer?.name,
        warehouseLabel,
        purchaseOrderStage,
        productText,
      ].some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [purchaseOrders, search, orderStatusFilter, dateApprovedFilter, minAmount, maxAmount])

  const submitAction = async () => {
    if (!actionState) return
    const { order, action } = actionState
    const cancelReason = buildOrderActionReason(selectedCancelReasons, otherCancelReason)

    // Required: cancellations must include a reason before the status is updated.
    if (action === 'cancel' && !cancelReason) return

    if (action === 'assign' && !order?.assignedTripId && !order?.progress?.trip?.id) {
      onOpenTransportation()
      setActionState(null)
      setSelectedCancelReasons([])
      setOtherCancelReason('')
      return
    }

    const nextStatus =
      action === 'processing'
        ? 'PREPARING'
        : action === 'assign'
            ? 'FOR_DELIVERY'
            : action === 'delivered'
              ? 'DELIVERED'
              : action === 'completed'
                ? 'COMPLETED'
                : 'CANCELLED'

    await updateWarehouseOrderStatus(order.id, nextStatus, action === 'cancel' ? cancelReason : undefined)
    setActionState(null)
    setSelectedCancelReasons([])
    setOtherCancelReason('')
  }

  return (
    <>
      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl text-slate-900">Purchase Orders</CardTitle>
          <CardDescription>View approved purchase orders and fulfillment status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search PO, request, customer, product..." />
            <select value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)} className="h-10 rounded-md border border-input bg-white px-3 text-sm">
              <option value="all">All order statuses</option>
              <option value="APPROVED">Approved</option>
              <option value="PROCESSING">Processing</option>
              <option value="READY_FOR_DELIVERY">Ready for Delivery</option>
              <option value="FOR_DELIVERY">For Delivery</option>
              <option value="OUT_FOR_DELIVERY">Out for Delivery</option>
              <option value="DELIVERED">Delivered</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <Input type="date" value={dateApprovedFilter} onChange={(event) => setDateApprovedFilter(event.target.value)} />
            <Input type="number" min="0" step="0.01" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="Minimum amount" />
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input type="number" min="0" step="0.01" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="Maximum amount" />
            <Button
              variant="outline"
              onClick={() => {
                setSearch('')
                setOrderStatusFilter('all')
                setDateApprovedFilter('')
                setMinAmount('')
                setMaxAmount('')
              }}
            >
              Reset Filters
            </Button>
          </div>

          {loadingOrders ? (
            <PortalTableSkeleton rows={5} columns={8} className="border-0 shadow-none" />
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center">
              <p className="text-base font-semibold text-slate-700">No purchase orders found.</p>
              <p className="mt-1 text-sm text-slate-500">Approved purchase requests will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-[980px] w-full">
                <thead className="bg-slate-50 text-left text-sm text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Purchase Order ID</th>
                    <th className="px-4 py-3 font-semibold">Transaction ID</th>
                    <th className="px-4 py-3 font-semibold">Customer Name</th>
                    <th className="px-4 py-3 font-semibold">Products</th>
                    <th className="px-4 py-3 font-semibold">Quantity Ordered</th>
                    <th className="px-4 py-3 font-semibold">Total Amount</th>
                    <th className="px-4 py-3 font-semibold">Order Status</th>
                    <th className="px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const stage = getOrderStage(order)
                    const isAssignedToDelivery = Boolean(
                      order?.assignedTripId ||
                      order?.progress?.trip?.id ||
                      order?.tripId ||
                      order?.deliveryTripId ||
                      order?.assignedDriver ||
                      order?.driverId ||
                      ['READY_FOR_DELIVERY', 'FOR_DELIVERY', 'IN_TRANSIT', 'DISPATCHED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'].includes(String(order?.status || '').toUpperCase()) ||
                      ['READY_FOR_DELIVERY', 'FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'].includes(stage)
                    )
                    const orderItems = Array.isArray(order?.items) ? order.items : []
                    const transactionIds = Array.isArray(order?.inventoryTransactionIds)
                      ? order.inventoryTransactionIds.filter((id: unknown) => String(id || '').trim())
                      : String(order?.inventoryTransactionId || '').trim()
                        ? [order.inventoryTransactionId]
                        : []
                    return (
                      <tr key={order.id} className="border-t border-slate-200 align-top text-sm">
                        <td className="px-4 py-3 font-semibold text-slate-900">{order.orderNumber}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {transactionIds.length > 0
                            ? transactionIds.map((id: unknown) => {
                                const fullId = String(id)
                                return (
                                  <p key={fullId} title={fullId} className="whitespace-nowrap font-mono text-xs">
                                    {formatTransactionId(fullId)}
                                  </p>
                                )
                              })
                            : '----'}
                        </td>
                        <td className="px-4 py-3">{order.customer?.name || order.shippingName || 'N/A'}</td>
                        <td className="max-w-[260px] px-4 py-3 text-slate-600">
                          <div className="space-y-1">
                            {orderItems.length > 0
                              ? orderItems.map((item: any, index: number) => (
                                  <div key={`${order.id}-product-${item?.id || index}`} className="min-h-12">
                                    <p>{item?.itemType === 'MIXED_CASE' ? 'Mixed Case' : formatProductNameWithSize(item)}</p>
                                    {item?.itemType === 'MIXED_CASE' ? <MixedCaseComponents item={item} compact showImages={false} /> : null}
                                  </div>
                                ))
                              : <p>No products</p>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {/* Match each order product slot so wrapped names keep quantities aligned. */}
                            {orderItems.length > 0
                              ? orderItems.map((item: any, index: number) => (
                                  <div key={`${order.id}-quantity-${item?.id || index}`} className={`min-h-12 ${item?.itemType === 'MIXED_CASE' ? 'pt-0.5' : ''}`}>
                                    <p>{Number(item?.quantity || 0)}</p>
                                    {item?.itemType === 'MIXED_CASE' && Array.isArray(item?.components) ? item.components.map((_: any, ci: number) => (
                                      <p key={ci} className="text-[11px] text-slate-400">&nbsp;</p>
                                    )) : null}
                                  </div>
                                ))
                              : <p>0</p>}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold">{formatPeso(order.totalAmount || 0)}</td>
                        <td className="px-4 py-3">
                          <Badge className={orderBadgeClass[stage] || 'bg-slate-100 text-slate-700 hover:bg-slate-100'}>{formatStage(stage)}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => void openOrderDetail(order)}>
                              <Eye className="mr-2 h-4 w-4" />
                              View Details
                            </Button>
                            {stage === 'APPROVED' ? (
                              <Button size="sm" className="bg-violet-600 hover:bg-violet-700" disabled={updatingOrderId === order.id} onClick={() => setActionState({ order, action: 'processing' })}>
                                {updatingOrderId === order.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Start Processing
                              </Button>
                            ) : null}
                            {stage === 'PROCESSING' || stage === 'READY_FOR_DELIVERY' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-blue-200 text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                                disabled={updatingOrderId === order.id || isAssignedToDelivery}
                                onClick={() => setActionState({ order, action: 'assign' })}
                                title={isAssignedToDelivery ? 'Order is already assigned to a delivery trip' : undefined}
                              >
                                {isAssignedToDelivery ? 'Assigned' : 'Assign Delivery'}
                              </Button>
                            ) : null}
                            {stage !== 'COMPLETED' && stage !== 'CANCELLED' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-rose-200 text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                                disabled={updatingOrderId === order.id || isAssignedToDelivery || !['APPROVED', 'PROCESSING', 'PREPARING', 'READY_FOR_DELIVERY'].includes(stage)}
                                onClick={() => setActionState({ order, action: 'cancel' })}
                                title={isAssignedToDelivery ? 'Cannot cancel order because it is already assigned to delivery' : undefined}
                              >
                                Cancel Order
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!actionState} onOpenChange={(open) => !open && updatingOrderId !== actionState?.order?.id && (setActionState(null), setSelectedCancelReasons([]), setOtherCancelReason(''))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionState?.action === 'processing'
                ? 'Start Purchase Order Processing'
                : actionState?.action === 'assign'
                  ? 'Assign Delivery'
                  : 'Cancel Purchase Order'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionState?.action === 'processing'
                ? `Are you sure you want to move order ${actionState?.order?.orderNumber || ''} into processing? This will prepare it for warehouse picking and packing.`
                : actionState?.action === 'assign'
                  ? (!actionState?.order?.assignedTripId && !actionState?.order?.progress?.trip?.id
                    ? 'This order needs a transportation trip assignment. Proceed to the Transportation module to assign a vehicle and driver.'
                    : `Confirm delivery assignment for order ${actionState?.order?.orderNumber || ''}?`)
                  : `Are you sure you want to cancel order ${actionState?.order?.orderNumber || ''}? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionState?.action === 'cancel' ? (
            <OrderReasonCheckboxes
              options={WAREHOUSE_ORDER_REASONS}
              selectedReasons={selectedCancelReasons}
              otherReason={otherCancelReason}
              onSelectedReasonsChange={setSelectedCancelReasons}
              onOtherReasonChange={setOtherCancelReason}
              label="Cancellation reason (required)"
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={updatingOrderId === actionState?.order?.id}
              onClick={() => {
                setActionState(null)
                setSelectedCancelReasons([])
                setOtherCancelReason('')
              }}
            >
              {actionState?.action === 'cancel' ? 'No, Keep Order' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={updatingOrderId === actionState?.order?.id || (actionState?.action === 'cancel' && !buildOrderActionReason(selectedCancelReasons, otherCancelReason))}
              onClick={(event) => {
                event.preventDefault()
                void submitAction()
              }}
              className={
                actionState?.action === 'processing'
                  ? 'bg-violet-600 hover:bg-violet-700'
                  : actionState?.action === 'cancel'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-blue-600 hover:bg-blue-700'
              }
            >
              {updatingOrderId === actionState?.order?.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {updatingOrderId === actionState?.order?.id
                ? actionState?.action === 'processing'
                  ? 'Starting...'
                  : actionState?.action === 'cancel'
                    ? 'Cancelling...'
                    : 'Assigning...'
                : actionState?.action === 'processing'
                  ? 'Start Processing'
                  : actionState?.action === 'cancel'
                    ? 'Cancel Order'
                    : (!actionState?.order?.assignedTripId && !actionState?.order?.progress?.trip?.id ? 'Go to Transportation' : 'Assign Delivery')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
