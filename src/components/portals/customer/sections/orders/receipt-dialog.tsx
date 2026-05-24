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
  const normalizeToken = (value: string) =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
  const addressTokens = String(selectedOrder?.shippingAddress || '')
    .split(',')
    .map((token: string) => token.trim())
    .filter(Boolean)
  const tokenSet = new Set(addressTokens.map((token: string) => normalizeToken(token)))
  const extras = [
    selectedOrder?.shippingCity,
    selectedOrder?.shippingProvince,
    selectedOrder?.shippingZipCode,
    selectedOrder?.shippingCountry || 'Philippines',
  ]
    .map((part: any) => String(part || '').trim())
    .filter(Boolean)
    .filter((part: string) => {
      const key = normalizeToken(part)
      if (!key || tokenSet.has(key)) return false
      tokenSet.add(key)
      return true
    })
  const deliveryLines = [...addressTokens, ...extras]
  const sellerPhone = String(
    selectedOrder?.sellerPhone ||
    selectedOrder?.adminPhone ||
    selectedOrder?.ownerPhone ||
    selectedOrder?.warehousePhone ||
    '+63 9460056944'
  ).trim()
  const orderSubtotal = Number(
    selectedOrder?.subtotal ??
    (Array.isArray(selectedOrder?.items)
      ? selectedOrder.items.reduce((sum: number, item: any) => sum + Number(item?.totalPrice ?? Number(item?.unitPrice || 0) * Number(item?.quantity || 0)), 0)
      : 0)
  )
  const orderDiscount = Number(selectedOrder?.discountDetails?.totalDiscount || selectedOrder?.discount || 0)
  const orderTotal = Number(selectedOrder?.totalAmount || 0)
  const orderDiscountPercent = (() => {
    const explicitPercent = Number(selectedOrder?.discountDetails?.percent)
    if (Number.isFinite(explicitPercent) && explicitPercent > 0) return explicitPercent
    if (orderSubtotal > 0 && orderDiscount > 0) return (orderDiscount / orderSubtotal) * 100
    return 0
  })()
  const orderDiscountPercentLabel =
    Number.isInteger(orderDiscountPercent)
      ? `${orderDiscountPercent}%`
      : `${orderDiscountPercent.toFixed(2).replace(/\.?0+$/, '')}%`

  return (
    <Dialog open={Boolean(selectedOrder) && isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
      {selectedOrder && isOrderDelivered(selectedOrder) ? (
        <DialogContent showCloseButton={false} className="w-[95vw] max-w-2xl h-[90vh] p-0 overflow-hidden rounded-2xl border border-emerald-100">
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="flex h-full flex-col bg-gradient-to-b from-emerald-50 via-white to-slate-50"
          >
            <div className="flex items-center border-b border-emerald-100 bg-white px-3 py-3">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsReceiptDialogOpen(false)}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <p className="flex-1 text-center text-2xl font-semibold text-slate-900">Receipt</p>
              <div className="h-8 w-8" />
            </div>

            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              <div className="mx-auto w-full max-w-[760px] rounded-xl border border-emerald-100 bg-white p-4 text-[11px] shadow-sm shadow-emerald-100/50 md:p-6 md:text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <img
                      src="/ann-anns-logo.png"
                      alt="Ann Ann's Beverages Trading"
                      className="h-9 w-9 rounded-md border border-slate-200 object-cover bg-white"
                    />
                    <div>
                    <p className="font-bold text-slate-900 leading-tight">Ann Ann&apos;s Beverages Trading</p>
                    <p className="text-[10px] text-slate-500">Official Delivery Receipt</p>
                    <p className="text-[10px] text-slate-600">Phone: {sellerPhone}</p>
                    </div>
                  </div>
                  <p className="text-[10px] font-semibold text-slate-700">Order Receipt</p>
                </div>

                <div className="mt-3 rounded-md bg-emerald-50 px-2 py-1.5 text-[10px] text-slate-600 md:text-xs">
                  Receipt No: {`RCT-${selectedOrder.orderNumber}`} | Order No: {selectedOrder.orderNumber}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 text-[10px] md:grid-cols-3 md:gap-4 md:text-xs">
                  <div>
                    <p className="font-semibold text-slate-500">Delivery Details</p>
                    <p className="mt-1 leading-4 text-slate-700 break-words">{deliveryLines.join(', ') || '-'}</p>
                    {selectedOrder.shippingName ? (
                      <p className="mt-1 text-slate-700">Recipient: {selectedOrder.shippingName}</p>
                    ) : null}
                    {selectedOrder.shippingPhone ? (
                      <p className="text-slate-700">Phone: {selectedOrder.shippingPhone}</p>
                    ) : null}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-500">Sold By</p>
                    <p className="mt-1 leading-4 text-slate-700">Ann Ann&apos;s Beverages Trading</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-500">Order Details</p>
                    <p className="mt-1 text-slate-700">Ordered: {new Date(selectedOrder.createdAt).toLocaleDateString()}</p>
                    <p className="text-slate-700">Delivered: {new Date(selectedOrder.deliveredAt || selectedOrder.deliveryDate || selectedOrder.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="mt-4 border-t border-emerald-100 pt-3">
                  <div className="grid grid-cols-[1fr_auto] text-[10px] font-semibold text-slate-600 md:text-xs">
                    <p>Item Description</p>
                    <p>Qty</p>
                  </div>
                  <div className="mt-1 space-y-1">
                    {selectedOrder.items?.map((item: any) => (
                      <div key={`receipt-mobile-${item.id}`} className="grid grid-cols-[1fr_auto] gap-2 text-[10px] text-slate-700 md:text-xs">
                        <p className="leading-4 break-words">
                          {item.product?.name || 'Item'} ({item.product?.unit || 'unit'}) - {formatPeso(item.unitPrice)}
                        </p>
                        <p>{item.quantity}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 ml-auto w-full max-w-[220px] space-y-1 text-[10px] text-slate-700 md:text-xs">
                  <p className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatPeso(orderSubtotal)}</span>
                  </p>
                  {orderDiscount > 0 ? (
                    <p className="flex justify-between text-[#2b4f83]">
                      <span>Discount{orderDiscountPercent > 0 ? ` (${orderDiscountPercentLabel})` : ''}</span>
                      <span>-{formatPeso(orderDiscount)}</span>
                    </p>
                  ) : null}
                  <p className="flex justify-between border-t border-emerald-100 pt-1 font-semibold text-slate-900">
                    <span>Total Price</span>
                    <span>{formatPeso(orderTotal)}</span>
                  </p>
                </div>

                <p className="mt-6 text-center text-[9px] text-slate-500 md:text-[11px]">
                  This receipt serves as proof of payment and delivery. Thank you for your purchase.
                </p>
              </div>
            </div>

            <div className="border-t border-emerald-100 bg-white p-3">
              <Button
                type="button"
                className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-500"
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
