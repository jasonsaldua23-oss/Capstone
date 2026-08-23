'use client'

import { useMemo, useState } from 'react'
import { Eye, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
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

function isMixedCaseItem(item: any) {
  return String(item?.itemType || item?.item_type || '').toUpperCase() === 'MIXED_CASE'
}

function formatOrderItemContents(item: any) {
  if (!isMixedCaseItem(item)) {
    const name = String(item?.productName || item?.product?.name || 'Product')
    const qty = Number(item?.quantity || 0)
    const size = Array.isArray(item?.product?.sizes) && item.product.sizes.length > 0
      ? ` (${item.product.sizes.join(', ')})`
      : item?.product?.sizeLabel
        ? ` (${item.product.sizeLabel})`
        : ''
    return `${name}${size}${qty > 0 ? ` x${qty}` : ''}`
  }
  const caseCount = Math.max(0, Number(item?.quantity || 0))
  const capacity = Math.max(0, Number(item?.caseCapacity || item?.case_capacity || 0))
  const components = (Array.isArray(item?.components) ? item.components : []).map((component: any) => {
    const perCase = Math.max(0, Number(component?.quantityPerCase || 0))
    const total = Math.max(0, Number(component?.totalBaseUnits ?? perCase * caseCount))
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

  const warehouseOptions = useMemo(() => {
    return Array.from(
      new Set(
        purchaseOrders
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
      const purchaseOrderStage = String(order?.purchaseOrderStage || 'APPROVED').toUpperCase()
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
        order?.purchaseOrderNumber,
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

    if (action === 'assign' && !order?.assignedTripId && !order?.progress?.trip?.id) {
      onOpenTransportation()
      setActionState(null)
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

    await updateWarehouseOrderStatus(order.id, nextStatus)
    setActionState(null)
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
            <PortalTableSkeleton rows={5} columns={9} className="border-0 shadow-none" />
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
                    <th className="px-4 py-3 font-semibold">Request ID</th>
                    <th className="px-4 py-3 font-semibold">Customer Name</th>
                    <th className="px-4 py-3 font-semibold">Products</th>
                    <th className="px-4 py-3 font-semibold">Total Quantity</th>
                    <th className="px-4 py-3 font-semibold">Total Amount</th>
                    <th className="px-4 py-3 font-semibold">Order Status</th>
                    <th className="px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const stage = String(order?.purchaseOrderStage || 'APPROVED').toUpperCase()
                    const totalQuantity = Array.isArray(order?.items)
                      ? order.items.reduce((sum: number, item: any) => sum + Number(item?.quantity || 0), 0)
                      : 0
                    const productLabel = Array.isArray(order?.items) && order.items.length > 0
                      ? order.items.map((item: any) => formatOrderItemContents(item)).join(', ')
                      : 'No products'
                    return (
                      <tr key={order.id} className="border-t border-slate-200 align-top text-sm">
                        <td className="px-4 py-3 font-semibold text-slate-900">{order.purchaseOrderNumber || 'Pending PO ID'}</td>
                        <td className="px-4 py-3">{order.purchaseRequestNumber || order.orderNumber}</td>
                        <td className="px-4 py-3">{order.customer?.name || order.shippingName || 'N/A'}</td>
                        <td className="px-4 py-3 max-w-[260px] text-slate-600">{productLabel}</td>
                        <td className="px-4 py-3">{totalQuantity}</td>
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
                            {stage === 'READY_FOR_DELIVERY' ? (
                              <Button size="sm" variant="outline" disabled={updatingOrderId === order.id} onClick={() => setActionState({ order, action: 'assign' })}>
                                Assign Delivery
                              </Button>
                            ) : null}
                            {stage !== 'COMPLETED' && stage !== 'CANCELLED' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-rose-200 text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                                disabled={updatingOrderId === order.id || !['APPROVED', 'PROCESSING', 'PREPARING', 'READY_FOR_DELIVERY'].includes(stage)}
                                onClick={() => setActionState({ order, action: 'cancel' })}
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

      <AlertDialog open={!!actionState} onOpenChange={(open) => !open && setActionState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionState?.action === 'processing' && 'Start Purchase Order Processing'}
              {actionState?.action === 'assign' && 'Assign Delivery'}
              {actionState?.action === 'cancel' && 'Cancel Purchase Order'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionState?.action === 'processing' && 'Move this approved purchase order into processing.'}
              {actionState?.action === 'assign' && (!actionState?.order?.assignedTripId && !actionState?.order?.progress?.trip?.id
                ? 'This purchase order still needs a transportation assignment. Continue to the Transportation module to assign delivery.'
                : 'Confirm delivery assignment for this purchase order.' )}
              {actionState?.action === 'cancel' && 'Cancel this purchase order and stop further delivery processing.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submitAction()}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
