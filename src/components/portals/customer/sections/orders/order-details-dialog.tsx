'use client'

import { motion } from 'framer-motion'
import { CheckCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function CustomerOrderDetailsDialog(props: any) {
  const {
    selectedOrder,
    setSelectedOrder,
    setIsReceiptDialogOpen,
    formatOrderStatus,
    orderStages,
    getOrderStageIndex,
    getProductImage,
    formatPeso,
    deliveryIssueRecords,
    getReplacementStatusLabel,
    getReplacementBadgeClass,
    isOrderTrackable,
    openTrackView,
    isOrderCancellable,
    cancelOrder,
    isOrderDelivered,
  } = props

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
      {selectedOrder && (
        <DialogContent className="max-w-[360px] rounded-3xl border border-white/70 bg-white/55 p-4 shadow-[0_22px_56px_rgba(15,23,42,0.24)] backdrop-blur-3xl backdrop-saturate-125 sm:max-w-[420px]">
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <DialogHeader className="space-y-0.5 text-center">
              <DialogTitle className="text-[1.9rem] font-bold tracking-tight text-slate-900">{selectedOrder.orderNumber}</DialogTitle>
              <DialogDescription className="text-[1.05rem] text-slate-700">
                Status: <span className="font-semibold uppercase text-[#0f4f8f]">{formatOrderStatus(selectedOrder.status, selectedOrder.paymentStatus)}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="relative mt-4 space-y-2.5 pl-1">
              {orderStages.map((stage: string, idx: number) => {
                const currentIndex = getOrderStageIndex(selectedOrder.status, selectedOrder.paymentStatus)
                const isCompleted = idx <= currentIndex
                const isCurrent = idx === currentIndex
                const stageLabel = stage === 'Loaded' ? 'Loaded' : stage
                return (
                  <div key={stage} className="relative flex items-center gap-3">
                    {idx < orderStages.length - 1 ? (
                      <span className={`absolute left-3 top-6 h-8 w-[2px] ${isCompleted ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                    ) : null}
                    <span
                      className={`relative z-[1] grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
                        isCompleted ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {isCompleted ? <CheckCircle className="h-4 w-4" /> : idx + 1}
                    </span>
                    <p className={`text-[1.05rem] ${isCurrent ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{stageLabel}</p>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200/80 bg-white/90 p-2.5">
              {selectedOrder.items?.slice(0, 1).map((item: any) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <img
                      src={getProductImage(item.product.imageUrl)}
                      alt={item.product.name}
                      className="h-9 w-9 rounded-md border border-slate-200 object-cover bg-white"
                    />
                    <span className="truncate text-[1rem] text-slate-900">{item.product.name} x {item.quantity}</span>
                  </div>
                  <span className="shrink-0 text-[1rem] font-medium text-slate-900">{formatPeso(item.unitPrice * item.quantity)}</span>
                </div>
              ))}
            </div>

            <p className="mt-3 text-[1.15rem] font-semibold text-slate-900">Total: {formatPeso(selectedOrder.totalAmount)}</p>

            {deliveryIssueRecords.filter((record: any) => record.orderId === selectedOrder.id).length ? (
              <div className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-semibold">Replacement Details</p>
                {deliveryIssueRecords
                  .filter((record: any) => record.orderId === selectedOrder.id)
                  .map((record: any) => {
                    const label = getReplacementStatusLabel(record.status)
                    const replacedProduct =
                      String(record.replacementProductName || '').trim() ||
                      String(record.originalProductName || '').trim() ||
                      'N/A'
                    const remainingQty = Number(record.remainingQuantity ?? 0)
                    return (
                      <div key={record.id} className="rounded-md bg-white/70 px-2 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-slate-900">Status</p>
                          <Badge className={getReplacementBadgeClass(label)}>{label}</Badge>
                        </div>
                        <p className="mt-1 text-slate-700">
                          Product replaced: <span className="font-semibold">{replacedProduct}</span>
                        </p>
                        <p className="mt-1 text-slate-700">
                          Quantity replaced: <span className="font-semibold">{Number(record.replacementQuantity || 0)}</span>
                          {label === 'Partially Resolved' && remainingQty > 0 ? ` | Remaining: ${remainingQty}` : ''}
                        </p>
                      </div>
                    )
                  })}
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                No replacement case filed for this order.
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              {isOrderDelivered(selectedOrder) ? (
                <Button
                  variant="outline"
                  className="h-11 rounded-xl border-slate-300 bg-white/70 text-slate-700 hover:bg-slate-100"
                  onClick={() => setIsReceiptDialogOpen(true)}
                >
                  Receipt
                </Button>
              ) : isOrderTrackable(selectedOrder.status) && String(selectedOrder.paymentStatus || '').toLowerCase() !== 'pending_approval' ? (
                <Button
                  variant="outline"
                  className="h-11 rounded-xl border-slate-300 bg-white/70 text-slate-600 hover:bg-slate-100"
                  onClick={() => {
                    setSelectedOrder(null)
                    openTrackView(selectedOrder.id)
                  }}
                >
                  Track
                </Button>
              ) : isOrderCancellable(selectedOrder.status, selectedOrder.paymentStatus) ? (
                <Button
                  variant="outline"
                  className="h-11 rounded-xl border-red-200 bg-white/70 text-red-600 hover:bg-red-50"
                  onClick={() => void cancelOrder(selectedOrder.id)}
                >
                  Cancel
                </Button>
              ) : (
                <Button variant="outline" className="h-11 rounded-xl border-slate-300 bg-white/60 text-slate-400" disabled>
                  Not Available
                </Button>
              )}
              <Button className="h-11 rounded-xl bg-[#174f97] text-white shadow-[0_8px_18px_rgba(23,79,151,0.35)] hover:bg-[#123f79]" onClick={() => setSelectedOrder(null)}>
                Close
              </Button>
            </div>
          </motion.div>
        </DialogContent>
      )}
    </Dialog>
  )
}
