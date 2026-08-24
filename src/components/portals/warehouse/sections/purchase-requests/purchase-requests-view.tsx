'use client'

import { useMemo, useState } from 'react'
import { Eye, Check, XCircle, X, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import type { WarehousePurchaseRequestsViewProps } from '../shared/types'

type RequestActionState = {
  order: any
  action: 'approve' | 'reject' | 'cancel'
}

const requestBadgeClass: Record<string, string> = {
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  APPROVED: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  REJECTED: 'bg-rose-100 text-rose-700 hover:bg-rose-100',
  CANCELLED: 'bg-slate-200 text-slate-700 hover:bg-slate-200',
}

function formatRequestStatus(value: string) {
  return String(value || 'PENDING_APPROVAL').replace(/_/g, ' ')
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

export function WarehousePurchaseRequestsView({
  loadingOrders,
  purchaseRequests,
  formatPeso,
  openOrderDetail,
  updateWarehouseOrderStatus,
}: WarehousePurchaseRequestsViewProps) {
  const [search, setSearch] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [actionState, setActionState] = useState<RequestActionState | null>(null)
  const [reason, setReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const warehouseOptions = useMemo(() => {
    return Array.from(
      new Set(
        purchaseRequests
          .map((order) => String(order?.warehouseName || order?.warehouseCode || 'Unassigned').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b))
  }, [purchaseRequests])

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLowerCase()
    const min = Number(minAmount)
    const max = Number(maxAmount)
    return purchaseRequests.filter((order) => {
      const requestStatus = String(order?.requestStatus || 'PENDING_APPROVAL').toUpperCase()
      const warehouseLabel = String(order?.warehouseName || order?.warehouseCode || 'Unassigned').trim()
      const amount = Number(order?.totalAmount || 0)
      const dateRequested = String(order?.dateRequested || order?.createdAt || '').slice(0, 10)
      const productText = Array.isArray(order?.items)
        ? order.items.map((item: any) => String(item?.productName || item?.product?.name || '').trim()).join(' ')
        : ''

      if (statusFilter !== 'all' && requestStatus !== statusFilter) return false
      if (dateFilter && dateRequested !== dateFilter) return false
      if (minAmount.trim() && Number.isFinite(min) && amount < min) return false
      if (maxAmount.trim() && Number.isFinite(max) && amount > max) return false
      if (!query) return true

      return [
        order?.orderNumber,
        order?.customer?.name,
        warehouseLabel,
        requestStatus,
        productText,
      ].some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [purchaseRequests, search, statusFilter, dateFilter, minAmount, maxAmount])

  const handleAction = async () => {
    if (!actionState) return
    const { order, action } = actionState
    const nextStatus = action === 'approve' ? 'CONFIRMED' : action === 'reject' ? 'REJECTED' : 'CANCELLED'
    const nextReason = action === 'approve' ? undefined : reason.trim() || undefined
    try {
      setBusyId(order.id)
      const updated = await updateWarehouseOrderStatus(order.id, nextStatus, nextReason)
      if (updated !== false) {
        setActionState(null)
        setReason('')
      }
    } finally {
      setBusyId(null)
    }
  }

  const isActionLoading = Boolean(actionState && busyId === actionState.order.id)

  return (
    <>
      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl text-slate-900">Purchase Requests</CardTitle>
          <CardDescription>Review and manage customer purchase requests before approval.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search request, customer, product..." />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-input bg-white px-3 text-sm">
              <option value="all">All request statuses</option>
              <option value="PENDING_APPROVAL">Pending Approval</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <Input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} />
            <Input type="number" min="0" step="0.01" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="Minimum amount" />
            <Input type="number" min="0" step="0.01" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="Maximum amount" />
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setSearch('')
                setStatusFilter('all')
                setDateFilter('')
                setMinAmount('')
                setMaxAmount('')
              }}
            >
              Reset Filters
            </Button>
          </div>

          {loadingOrders ? (
            <PortalTableSkeleton rows={5} columns={8} className="border-0 shadow-none" />
          ) : filteredRequests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center">
              <p className="text-base font-semibold text-slate-700">No purchase requests found.</p>
              <p className="mt-1 text-sm text-slate-500">New customer purchase requests will appear here once submitted.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-[1060px] w-full">
                <thead className="bg-slate-50 text-left text-sm text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Request ID</th>
                    <th className="px-4 py-3 font-semibold">Customer Name</th>
                    <th className="px-4 py-3 font-semibold">Products</th>
                    <th className="px-4 py-3 font-semibold">Quantity Ordered</th>
                    <th className="px-4 py-3 font-semibold">Total Amount</th>
                    <th className="px-4 py-3 font-semibold">Date Requested</th>
                    <th className="px-4 py-3 font-semibold">Request Status</th>
                    <th className="px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((order) => {
                    const requestStatus = String(order?.requestStatus || 'PENDING_APPROVAL').toUpperCase()
                    const orderItems = Array.isArray(order?.items) ? order.items : []
                    const isPending = requestStatus === 'PENDING_APPROVAL' || requestStatus === 'PENDING'
                    return (
                      <tr key={order.id} className="border-t border-slate-200 align-top text-sm">
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {/* Keep the original PR identity in PR history even after a PO is created. */}
                          {order.purchaseRequestNumber || order.purchase_request_number || order.orderNumber}
                        </td>
                        <td className="px-4 py-3">{order.customer?.name || order.shippingName || 'N/A'}</td>
                        <td className="max-w-[280px] px-4 py-3 text-slate-600">
                          {/* Each line aligns with the same-position quantity in the next column. */}
                          <div className="space-y-1">
                            {orderItems.length > 0
                              ? orderItems.map((item: any, index: number) => (
                                  <div key={`${order.id}-product-${item?.id || index}`}>
                                    <p>{item?.itemType === 'MIXED_CASE' ? 'Mixed Case' : formatProductNameWithSize(item)}</p>
                                    {/* Keep table rows text-only; product photos belong in View Details. */}
                                    {item?.itemType === 'MIXED_CASE' ? <MixedCaseComponents item={item} compact showImages={false} /> : null}
                                  </div>
                                ))
                              : <p>No products</p>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {orderItems.length > 0
                              ? orderItems.map((item: any, index: number) => (
                                  <p key={`${order.id}-quantity-${item?.id || index}`}>{Number(item?.quantity || 0)}</p>
                                ))
                              : <p>0</p>}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold">{formatPeso(order.totalAmount || 0)}</td>
                        <td className="px-4 py-3">{new Date(order.dateRequested || order.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <Badge className={requestBadgeClass[requestStatus] || 'bg-slate-100 text-slate-700 hover:bg-slate-100'}>
                            {formatRequestStatus(requestStatus)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              onClick={() => void openOrderDetail(order)}
                              title="View Details"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              className="h-8 w-8 bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40"
                              disabled={!isPending || busyId === order.id}
                              onClick={() => setActionState({ order, action: 'approve' })}
                              title="Approve Request"
                            >
                              {busyId === order.id && actionState?.action === 'approve' ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8 border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                              disabled={!isPending || busyId === order.id}
                              onClick={() => setActionState({ order, action: 'reject' })}
                              title="Reject Request"
                            >
                              <X className="h-4 w-4" />
                            </Button>
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

      <AlertDialog open={!!actionState} onOpenChange={(open) => !open && !isActionLoading && setActionState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionState?.action === 'approve'
                ? 'Approve Purchase Request'
                : actionState?.action === 'reject'
                  ? 'Reject Purchase Request'
                  : 'Cancel Purchase Request'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionState?.action === 'approve'
                ? 'Are you sure you want to approve this purchase request? Once approved, this request will become an official purchase order.'
                : actionState?.action === 'reject'
                  ? 'Please enter the reason for rejecting this purchase request.'
                  : 'Are you sure you want to cancel this purchase request? This action will prevent the request from becoming a purchase order.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionState?.action !== 'approve' ? (
            <textarea
              className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder={actionState?.action === 'reject' ? 'Reason for rejection' : 'Optional cancellation reason'}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading} onClick={() => { setActionState(null); setReason('') }}>
              {actionState?.action === 'cancel' ? 'No, Keep Request' : 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isActionLoading}
              onClick={(event) => {
                // Keep the dialog visible so staff can see approval progress and cannot submit twice.
                event.preventDefault()
                void handleAction()
              }}
              className={actionState?.action === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : actionState?.action === 'reject' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-900 hover:bg-slate-800'}
            >
              {isActionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isActionLoading
                ? actionState?.action === 'approve' ? 'Approving...' : actionState?.action === 'reject' ? 'Rejecting...' : 'Cancelling...'
                : actionState?.action === 'approve' ? 'Approve Request' : actionState?.action === 'reject' ? 'Reject Request' : 'Cancel Request'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
