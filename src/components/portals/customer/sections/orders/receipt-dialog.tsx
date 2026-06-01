'use client'

import { motion } from 'framer-motion'
import { ArrowLeft, CalendarDays, ClipboardList, MapPin, Phone, Store, User } from 'lucide-react'
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
  const orderTax = Number(selectedOrder?.tax || 0)
  const orderShippingCost = Number(selectedOrder?.shippingCost || 0)
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
  const orderDateLabel = selectedOrder?.createdAt
    ? new Date(selectedOrder.createdAt).toLocaleDateString()
    : '-'
  const deliveredDateLabel = (selectedOrder?.deliveredAt || selectedOrder?.deliveryDate || selectedOrder?.createdAt)
    ? new Date(selectedOrder.deliveredAt || selectedOrder.deliveryDate || selectedOrder.createdAt).toLocaleDateString()
    : '-'
  const getProductMeta = (item: any) => {
    const size = String(item?.product?.size || item?.size || '-').trim()
    const category =
      String(
        item?.product?.category?.name ||
        item?.product?.categoryName ||
        item?.product?.category ||
        item?.categoryName ||
        '-'
      ).trim()
    return { size, category }
  }

  return (
    <Dialog open={Boolean(selectedOrder) && isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
      {selectedOrder && isOrderDelivered(selectedOrder) ? (
        <DialogContent showCloseButton={false} className="h-[92vh] w-[96vw] max-w-[760px] p-0 overflow-hidden rounded-2xl border border-slate-200">
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="flex h-full min-h-0 flex-col bg-white font-['Helvetica','Arial',sans-serif]"
          >
            <div className="flex items-center border-b border-slate-200 bg-white px-3 py-3">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsReceiptDialogOpen(false)}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <p className="flex-1 text-center text-2xl font-semibold text-slate-900">Receipt</p>
              <div className="h-8 w-8" />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 pb-24">
              <div className="mx-auto w-full max-w-[680px]">
                <div className="mx-auto w-full max-w-[520px] border border-slate-200 bg-white p-3 text-[12px] leading-[1.3] text-[#1f2937] sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="flex items-start gap-3">
                    <img
                      src="/aab-trading-shop.png"
                      alt="AAB TRADING SHOP"
                      className="h-14 w-14 rounded-full border border-slate-200 object-cover bg-white sm:h-16 sm:w-16"
                    />
                    <div className="min-w-0">
                    <p className="text-[24px] font-bold leading-tight text-[#0f2347]">AAB TRADING SHOP</p>
                    <p className="mt-1 text-[18px] text-slate-600">Official Delivery Receipt</p>
                    <p className="mt-1 text-[18px] text-slate-700">{sellerPhone}</p>
                    </div>
                  </div>
                  <div className="pt-1 sm:text-right">
                    <p className="text-[20px] font-bold tracking-[0.03em] text-[#0f2347] sm:text-[22px]">ORDER RECEIPT</p>
                    <span className="mt-2 block h-[2px] w-16 bg-[#1e8d40] sm:ml-auto sm:w-20 sm:h-[3px]" />
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-2 border border-[#7384a0] px-3 py-3 text-[14px] text-[#1f2937] sm:text-[18px]">
                  <div className="flex items-start gap-2 sm:items-center">
                    <ClipboardList className="mt-0.5 h-4 w-4 text-[#0f2347] sm:mt-0 sm:h-5 sm:w-5" />
                    <p className="break-all">Receipt No: <span className="font-bold">{`RCT-${selectedOrder.orderNumber}`}</span></p>
                  </div>
                  <p className="pl-6">Order No: <span className="font-bold">{selectedOrder.orderNumber}</span></p>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 border-b border-slate-300 pb-5 text-[13px] sm:grid-cols-2 sm:text-[15px]">
                  <div className="space-y-4 sm:space-y-5 sm:border-r sm:border-slate-300 sm:pr-5">
                    <div>
                      <p className="flex items-center gap-2 font-bold uppercase tracking-[0.03em] text-[#0f2347]">
                        <MapPin className="h-4 w-4 sm:h-5 sm:w-5" />
                        Delivery Address
                      </p>
                      <p className="mt-1 leading-6">{deliveryLines.join(', ') || '-'}</p>
                    </div>
                    <div>
                      <p className="flex items-center gap-2 font-bold uppercase tracking-[0.03em] text-[#0f2347]">
                        <User className="h-4 w-4 sm:h-5 sm:w-5" />
                        Recipient
                      </p>
                      <p className="mt-1">{selectedOrder.shippingName || '-'}</p>
                    </div>
                    <div>
                      <p className="flex items-center gap-2 font-bold uppercase tracking-[0.03em] text-[#0f2347]">
                        <Phone className="h-4 w-4 sm:h-5 sm:w-5" />
                        Phone
                      </p>
                      <p className="mt-1">{selectedOrder.shippingPhone || '-'}</p>
                    </div>
                  </div>
                  <div className="space-y-4 sm:space-y-5">
                    <p className="flex items-center gap-2 font-bold uppercase tracking-[0.03em] text-[#0f2347]">
                      <Store className="h-4 w-4 sm:h-5 sm:w-5" />
                      Sold By
                    </p>
                    <p className="mt-1 break-words">AAB TRADING SHOP</p>
                    <p className="flex items-center gap-2 font-bold uppercase tracking-[0.03em] text-[#0f2347]">
                      <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5" />
                      Order Details
                    </p>
                    <p className="mt-1">Ordered: {orderDateLabel}</p>
                    <p className="mt-1">Delivered: {deliveredDateLabel}</p>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="hidden items-center bg-[linear-gradient(120deg,#0f2347_0%,#0d2e61_48%,#0f2347_100%)] px-4 py-3 text-sm font-semibold text-white sm:grid sm:grid-cols-[1fr_64px_100px_110px]">
                    <p>Item Description</p>
                    <p className="text-center">Qty</p>
                    <p className="text-center">Unit Price</p>
                    <p className="text-right">Amount</p>
                  </div>
                  <div className="border border-slate-300 sm:border-t-0">
                    {selectedOrder.items?.map((item: any) => (
                      <div key={`receipt-mobile-${item.id}`}>
                        <div className="border-b border-slate-200 px-3 py-3 text-sm sm:hidden">
                          <p className="font-semibold text-[#0f2347]">
                            {item.product?.name || 'Item'} {getProductMeta(item).size !== '-' ? getProductMeta(item).size : ''}
                          </p>
                          {getProductMeta(item).category !== '-' ? (
                            <p className="mt-1 text-[10px] text-slate-600">{getProductMeta(item).category}</p>
                          ) : null}
                          <div className="mt-2 grid grid-cols-3 gap-2 text-[12px] text-slate-700">
                            <p>Qty: {item.quantity}</p>
                            <p>Unit: {formatPeso(item.unitPrice)}</p>
                            <p className="text-right">Amount: {formatPeso(Number(item.unitPrice || 0) * Number(item.quantity || 0))}</p>
                          </div>
                        </div>
                        <div className="hidden grid-cols-[1fr_64px_100px_110px] items-center border-b border-slate-200 px-4 py-3 text-sm sm:grid">
                          <div>
                            <p>{item.product?.name || 'Item'} {getProductMeta(item).size !== '-' ? getProductMeta(item).size : ''}</p>
                            {getProductMeta(item).category !== '-' ? (
                              <p className="text-[9px] text-slate-600">{getProductMeta(item).category}</p>
                            ) : null}
                          </div>
                          <p className="text-center">{item.quantity}</p>
                          <p className="text-center">{formatPeso(item.unitPrice)}</p>
                          <p className="text-right">{formatPeso(Number(item.unitPrice || 0) * Number(item.quantity || 0))}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 ml-auto w-full max-w-[280px] border-t border-b border-slate-400 py-3 text-[12px] sm:max-w-[320px]">
                  <p className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatPeso(orderSubtotal)}</span>
                  </p>
                  <p className="mt-1 flex justify-between md:mt-2">
                    <span>Tax</span>
                    <span>{formatPeso(orderTax)}</span>
                  </p>
                  <p className="mt-1 flex justify-between md:mt-2">
                    <span>Shipping</span>
                    <span>{formatPeso(orderShippingCost)}</span>
                  </p>
                  {orderDiscount > 0 ? (
                    <p className="mt-1 flex justify-between text-[#1f4d8a] md:mt-2">
                      <span>Discount{orderDiscountPercent > 0 ? ` (${orderDiscountPercentLabel})` : ''}</span>
                      <span>-{formatPeso(orderDiscount)}</span>
                    </p>
                  ) : null}
                </div>
                <div className="ml-auto w-full max-w-[280px] border-b-2 border-[#1e8d40] py-2 sm:max-w-[320px]">
                  <p className="flex justify-between text-xl font-bold text-[#0f2347]">
                    <span>TOTAL PRICE</span>
                    <span>{formatPeso(orderTotal)}</span>
                  </p>
                </div>

                <div className="mt-8 border-t-2 border-[#0f2347] pt-3 text-center text-[10px] text-slate-600">
                  <p>This receipt serves as proof of payment and delivery.</p>
                  <p className="mt-1">Thank you for your purchase.</p>
                </div>
                  <div className="mt-4 border-b border-slate-300" />
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 z-10 border-t border-slate-200 bg-white/98 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-sm">
              <Button
                type="button"
                className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-500"
                onClick={() => downloadReceipt(selectedOrder)}
              >
                Download Receipt
              </Button>
            </div>
          </motion.div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
