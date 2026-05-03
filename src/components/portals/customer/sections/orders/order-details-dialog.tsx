'use client'

import { motion } from 'framer-motion'
import { CalendarDays, CheckCircle2, Download, MapPin, Package, Wallet, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'

export function CustomerOrderDetailsDialog(props: any) {
  const {
    selectedOrder,
    setSelectedOrder,
    setIsReceiptDialogOpen,
    downloadReceipt,
    formatOrderStatus,
    orderStages,
    getOrderStageIndex,
    getProductImage,
    formatPeso,
    deliveryIssueRecords,
    getReplacementStatusLabel,
    getReplacementBadgeClass,
    isOrderDelivered,
  } = props

  const getReplacementQty = (record: any) => {
    const meta = typeof record?.notes === 'string' && record.notes.includes('Meta:')
      ? (() => {
          try {
            return JSON.parse(String(record.notes).slice(String(record.notes).lastIndexOf('Meta:') + 5).trim())
          } catch {
            return {}
          }
        })()
      : {}
    const value = Number(
      record?.quantityReplaced ??
      record?.replacementQuantity ??
      (meta as any)?.quantityReplaced ??
      (meta as any)?.replacementQuantity ??
      0
    )
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  }

  const getPodUrl = (order: any) =>
    String(
      order?.pod?.deliveryPhoto ||
      order?.progress?.pod?.deliveryPhoto ||
      order?.deliveryPhoto ||
      order?.deliveryProofUrl ||
      order?.proofOfDeliveryUrl ||
      ''
    ).trim()

  return (
    <Dialog
      open={!!selectedOrder}
      onOpenChange={(open) => {
        if (!open) {
          setSelectedOrder(null)
          setIsReceiptDialogOpen(false)
        }
      }}
    >
      {selectedOrder ? (
        <DialogContent
          showCloseButton={false}
          className="w-[95vw] max-h-[86vh] overflow-y-auto max-w-[760px] rounded-xl border border-slate-200 bg-white p-0 shadow-[0_30px_80px_rgba(2,6,23,0.30)] md:max-h-[92vh] md:rounded-2xl"
        >
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="p-2.5 md:p-5"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-600 md:h-11 md:w-11">
                  <Package className="h-4 w-4 md:h-5 md:w-5" />
                </div>
                <div>
                  <p className="text-[18px] font-semibold tracking-[-0.01em] text-slate-900 md:text-[28px]">{selectedOrder.orderNumber}</p>
                  <Badge className="mt-1 text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100 md:text-xs">
                    {formatOrderStatus(selectedOrder.status, selectedOrder.paymentStatus)}
                  </Badge>
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600 md:mt-2 md:text-sm">
                    <CalendarDays className="h-3.5 w-3.5 text-slate-500 md:h-4 md:w-4" />
                    Delivered on {new Date(selectedOrder.deliveredAt || selectedOrder.deliveryDate || selectedOrder.createdAt).toLocaleDateString()} |{' '}
                    {new Date(selectedOrder.deliveredAt || selectedOrder.deliveryDate || selectedOrder.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                onClick={() => setSelectedOrder(null)}
              >
                <X className="h-4 w-4 md:h-4.5 md:w-4.5" />
              </button>
            </div>

            <div className="mt-2.5 rounded-xl border border-slate-200 bg-white px-2 py-1.5 md:mt-5 md:px-4 md:py-3">
              <div className="grid grid-cols-4 gap-2">
                {orderStages.map((stage: string, idx: number) => {
                  const currentIndex = getOrderStageIndex(selectedOrder.status, selectedOrder.paymentStatus)
                  const done = idx <= currentIndex
                  return (
                    <div key={stage} className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <span className={`grid h-5 w-5 place-items-center rounded-full md:h-6 md:w-6 ${done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                          <CheckCircle2 className="h-3 w-3 md:h-3.5 md:w-3.5" />
                        </span>
                        {idx < orderStages.length - 1 ? (
                          <span className={`h-[2px] w-5 md:w-8 ${done ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                        ) : null}
                      </div>
                      <p className={`mt-1 text-[9px] md:text-[11px] ${done ? 'font-medium text-slate-900' : 'text-slate-500'}`}>{stage}</p>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-2.5 grid gap-2 md:mt-4 md:gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 md:p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <MapPin className="h-4 w-4" />
                  Delivery Address
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-900 md:text-sm">
                  {String(
                    selectedOrder.customerName ||
                    selectedOrder.customer?.name ||
                    selectedOrder.shippingName ||
                    selectedOrder.contactName ||
                    'Customer'
                  )}
                </p>
                <p className="mt-0.5 text-xs text-slate-600 md:text-sm">{selectedOrder.shippingAddress || 'No address provided'}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 md:p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <Wallet className="h-4 w-4" />
                  Total Amount
                </p>
                <p className="mt-1 text-2xl font-extrabold text-emerald-700 md:text-3xl">{formatPeso(selectedOrder.totalAmount)}</p>
              </div>
            </div>

            <div className="mt-2.5 rounded-xl border border-slate-200 md:mt-4">
              <div className="border-b border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-900 md:px-3 md:text-sm">
                Order Items ({selectedOrder.items?.length || 0} items)
              </div>
              <div className="grid grid-cols-[1fr_48px_74px_78px] md:grid-cols-[1fr_90px_110px_110px] border-b border-slate-200 px-2.5 py-2 text-[9px] md:px-3 md:text-[11px] font-semibold uppercase text-slate-500">
                <span>Product</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Unit Price</span>
                <span className="text-right">Subtotal</span>
              </div>
              <div className="max-h-[150px] overflow-y-auto md:max-h-[190px]">
                {(selectedOrder.items || []).map((item: any) => (
                  <div key={item.id} className="grid grid-cols-[1fr_48px_74px_78px] md:grid-cols-[1fr_90px_110px_110px] items-center px-2.5 py-2 text-xs md:px-3 md:py-2.5 md:text-sm">
                    <div className="flex items-center gap-2">
                      <img
                        src={getProductImage(item.product?.imageUrl)}
                        alt={item.product?.name || 'Product'}
                        className="h-6 w-6 rounded border border-slate-200 object-cover bg-white md:h-8 md:w-8"
                      />
                      <span className="truncate text-slate-800">{item.product?.name || 'Item'}</span>
                    </div>
                    <span className="text-right text-slate-700">{item.quantity}</span>
                    <span className="text-right text-slate-700">{formatPeso(item.unitPrice || 0)}</span>
                    <span className="text-right font-medium text-slate-900">{formatPeso((item.unitPrice || 0) * (item.quantity || 0))}</span>
                  </div>
                ))}
              </div>

              {deliveryIssueRecords.filter((record: any) => record.orderId === selectedOrder.id).length ? (
                <div className="border-t border-slate-200 px-3 py-3">
                  <p className="mb-1 text-xs font-semibold text-slate-700">Replacement Details</p>
                  {deliveryIssueRecords
                    .filter((record: any) => record.orderId === selectedOrder.id)
                    .map((record: any) => {
                      const label = getReplacementStatusLabel(record.status)
                      const qtyReplaced = getReplacementQty(record)
                      return (
                        <div key={record.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs">
                          <span className="text-slate-700">
                            {record.replacementProductName || record.originalProductName || 'Product replacement'}
                            {qtyReplaced > 0 ? ` x${qtyReplaced} replaced` : ''}
                          </span>
                          <Badge className={getReplacementBadgeClass(label)}>{label}</Badge>
                        </div>
                      )
                    })}
                </div>
              ) : (
                <div className="border-t border-slate-200 px-3 py-5 text-center">
                  <p className="text-sm font-semibold text-slate-700">No replacement case filed for this order.</p>
                  <p className="text-xs text-slate-500">All items were delivered successfully.</p>
                </div>
              )}
            </div>

            <div className="mt-2 md:mt-3">
              <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-700">Proof of Delivery (POD)</p>
                {getPodUrl(selectedOrder) ? (
                  <img
                    src={getPodUrl(selectedOrder)}
                    alt="Proof of delivery"
                    className="mt-2 h-52 w-full rounded-lg border border-slate-200 object-cover"
                  />
                ) : (
                  <p className="mt-2 text-xs text-slate-600">No POD uploaded yet</p>
                )}
              </div>
              <p className="text-xs font-semibold text-slate-700">Order Note</p>
              <div className="mt-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500 md:px-3 md:py-2 md:text-sm">
                {String(selectedOrder.notes || '').trim() || 'No note for this order.'}
              </div>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-1.5 md:mt-4 md:gap-2.5">
              <Button
                variant="outline"
                className="h-9 rounded-lg border-emerald-200 text-xs text-emerald-700 hover:bg-emerald-50 md:h-10 md:text-sm"
                onClick={() => downloadReceipt(selectedOrder)}
                disabled={!isOrderDelivered(selectedOrder)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5 md:h-4 md:w-4" />
                Download Receipt
              </Button>
              <Button className="h-9 rounded-lg bg-emerald-600 text-xs text-white hover:bg-emerald-500 md:h-10 md:text-sm" onClick={() => setSelectedOrder(null)}>
                Close
              </Button>
            </div>
          </motion.div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
