'use client'

import { motion } from 'framer-motion'
import { ArrowLeft, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'

export function CustomerReceiptDialog(props: any) {
  const {
    selectedOrder,
    isReceiptDialogOpen,
    setIsReceiptDialogOpen,
    isOrderDelivered,
    formatPeso,
    downloadReceipt,
  } = props

  return (
    <Dialog open={Boolean(selectedOrder) && isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
      {selectedOrder && isOrderDelivered(selectedOrder) ? (
        <DialogContent showCloseButton={false} className="w-[95vw] max-w-sm h-[90vh] p-0 overflow-hidden">
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="flex h-full flex-col bg-slate-100"
          >
            <div className="flex items-center border-b bg-white px-3 py-3">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsReceiptDialogOpen(false)}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <p className="flex-1 text-center text-2xl font-semibold text-slate-900">Receipt</p>
              <div className="h-8 w-8" />
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="mx-auto max-w-[320px] rounded-lg border border-slate-200/50 bg-white/95 p-4 text-[11px] shadow-sm shadow-slate-200/30">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900">AnnShop</p>
                    <p className="text-[10px] text-slate-500">Official Delivery Receipt</p>
                  </div>
                  <p className="text-[10px] font-semibold text-slate-700">Order Receipt</p>
                </div>

                <div className="mt-3 rounded bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                  Receipt No: {`RCT-${selectedOrder.orderNumber}`} | Order No: {selectedOrder.orderNumber}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
                  <div>
                    <p className="font-semibold text-slate-500">Delivery Details</p>
                    <p className="mt-1 leading-4 text-slate-700 break-words">
                      {[
                        selectedOrder.shippingAddress,
                        selectedOrder.shippingCity,
                        selectedOrder.shippingProvince,
                        selectedOrder.shippingZipCode,
                        selectedOrder.shippingCountry || 'Philippines',
                      ]
                        .filter(Boolean)
                        .join(', ') || '-'}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-500">Sold By</p>
                    <p className="mt-1 leading-4 text-slate-700">AnnShop</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-500">Order Details</p>
                    <p className="mt-1 text-slate-700">{new Date(selectedOrder.createdAt).toLocaleDateString()}</p>
                    <p className="text-slate-700">{new Date(selectedOrder.deliveredAt || selectedOrder.deliveryDate || selectedOrder.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="mt-3 border-t border-slate-200 pt-2">
                  <div className="grid grid-cols-[1fr_auto] text-[10px] font-semibold text-slate-600">
                    <p>Item Description</p>
                    <p>Qty</p>
                  </div>
                  <div className="mt-1 space-y-1">
                    {selectedOrder.items?.map((item: any) => (
                      <div key={`receipt-mobile-${item.id}`} className="grid grid-cols-[1fr_auto] gap-2 text-[10px] text-slate-700">
                        <p className="leading-4 break-words">
                          {item.product?.name || 'Item'} ({item.product?.sku || '-'}) - {formatPeso(item.unitPrice)}
                        </p>
                        <p>{item.quantity}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 ml-auto w-[170px] space-y-1 text-[10px] text-slate-700">
                  <p className="flex justify-between border-t border-slate-300 pt-1 font-semibold text-slate-900">
                    <span>Total Price</span>
                    <span>{formatPeso(Number(selectedOrder.totalAmount || 0))}</span>
                  </p>
                </div>

                <p className="mt-6 text-center text-[9px] text-slate-500">
                  This receipt serves as proof of payment and delivery. Thank you for your purchase.
                </p>
              </div>
            </div>

            <div className="border-t bg-white p-3">
              <Button
                type="button"
                className="h-11 w-full bg-rose-500 text-white hover:bg-rose-600"
                onClick={() => downloadReceipt(selectedOrder)}
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </motion.div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
