'use client'

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, CalendarDays, ClipboardList, Download, MapPin, Package, Phone, Store, User } from 'lucide-react'
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
  const receiptBodyRef = useRef<HTMLDivElement | null>(null)
  const receiptPreviewRef = useRef<HTMLDivElement | null>(null)
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
  const isOpen = Boolean(selectedOrder) && isReceiptDialogOpen

  useEffect(() => {
    if (!isOpen) return
    requestAnimationFrame(() => {
      receiptBodyRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    })
  }, [isOpen, selectedOrder?.id])

  return (
    <Dialog open={Boolean(selectedOrder) && isReceiptDialogOpen} onOpenChange={setIsReceiptDialogOpen}>
      {selectedOrder && isOrderDelivered(selectedOrder) ? (
        <DialogContent showCloseButton={false} className="h-[90vh] w-[96vw] max-w-[560px] p-0 overflow-hidden rounded-2xl border border-slate-200">
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="receipt-modal flex h-full min-h-0 flex-col overflow-hidden bg-white font-['Helvetica','Arial',sans-serif]"
          >
            <div className="receipt-modal-header flex h-[60px] items-center border-b border-slate-200 bg-white px-4">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsReceiptDialogOpen(false)}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <p className="flex-1 text-center text-lg font-semibold leading-none text-[#0f2347] md:text-xl">Receipt Preview</p>
              <div className="h-8 w-8" />
            </div>

            <div ref={receiptBodyRef} className="receipt-modal-body flex-1 overflow-y-auto px-4 py-4 pb-6">
              <div className="mx-auto w-full">
                <div ref={receiptPreviewRef} className="rounded-2xl border border-slate-200 bg-white p-3 text-[11px] leading-[1.35] text-[#1f2937] shadow-[0_12px_30px_rgba(15,35,71,0.08)] sm:p-5 sm:text-xs md:text-sm">
                <div className="grid grid-cols-[1.5fr_1fr] gap-2 border-b border-slate-200 pb-3 sm:grid-cols-[1.6fr_1fr] sm:items-start sm:gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <img
                      src="/aab-trading-shop.png"
                      alt="AAB TRADING SHOP"
                      className="h-12 w-12 rounded-full border border-slate-200 object-cover bg-white sm:h-16 sm:w-16"
                    />
                    <div className="min-w-0">
                    <p className="text-[14px] font-bold leading-tight tracking-[0.01em] text-[#0f2e6b] sm:text-base md:text-lg">AAB TRADING SHOP</p>
                    <p className="mt-1 text-[11px] text-slate-600 sm:text-xs md:text-sm">Official Delivery Receipt</p>
                    <p className="mt-1 text-[11px] text-slate-700 sm:text-xs md:text-sm">{sellerPhone}</p>
                    </div>
                  </div>
                  <div className="pt-1 sm:pl-2 sm:text-right">
                    <p className="text-[13px] font-bold leading-tight tracking-[0.01em] text-[#0f2e6b] sm:text-base md:text-lg">ORDER RECEIPT</p>
                    <span className="mt-2 block h-[2px] w-16 bg-[#1e8d40] sm:ml-auto sm:w-20 sm:h-[3px]" />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-0 overflow-hidden rounded-xl border border-[#c8d7ef] bg-[#f8fbff] text-[11px] text-[#1f2937] sm:text-xs md:text-sm">
                  <div className="flex items-center gap-2 border-b border-[#d7e3f6] px-3 py-3 sm:border-b-0 sm:border-r">
                    <ClipboardList className="h-4 w-4 text-[#0f2347] sm:h-5 sm:w-5" />
                    <p className="break-all">Receipt No. <span className="font-bold">{`RCT-${selectedOrder.orderNumber}`}</span></p>
                  </div>
                  <div className="flex items-center gap-2 border-l border-[#d7e3f6] px-3 py-3 sm:border-l-0">
                    <Package className="h-4 w-4 text-[#0f2347] sm:h-5 sm:w-5" />
                    <p>Order No. <span className="font-bold">{selectedOrder.orderNumber}</span></p>
                  </div>
                </div>

                <div className="mt-4 border-b border-slate-300 pb-4 text-[11px] sm:text-xs md:text-sm">
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div className="sm:pr-4 sm:border-r sm:border-slate-200">
                      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.03em] text-[#0f2347] md:text-xs">
                        <MapPin className="h-4 w-4 sm:h-5 sm:w-5" />
                        Delivery Address
                      </p>
                      <p className="mt-1 leading-5">{deliveryLines.join(', ') || '-'}</p>
                    </div>
                    <div className="sm:px-4 sm:border-r sm:border-slate-200">
                      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.03em] text-[#0f2347] md:text-xs">
                        <Store className="h-4 w-4 sm:h-5 sm:w-5" />
                        Sold By
                      </p>
                      <p className="mt-1 break-words">AAB TRADING SHOP</p>
                    </div>
                    <div className="sm:pl-4">
                      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.03em] text-[#0f2347] md:text-xs">
                        <CalendarDays className="h-4 w-4 sm:h-5 sm:w-5" />
                        Order Details
                      </p>
                      <p className="mt-1">Ordered: {orderDateLabel}</p>
                      <p className="mt-1">Delivered: {deliveredDateLabel}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-200 pt-3">
                    <div>
                      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.03em] text-[#0f2347] md:text-xs">
                        <User className="h-4 w-4 sm:h-5 sm:w-5" />
                        Recipient
                      </p>
                      <p className="mt-1">{selectedOrder.shippingName || '-'}</p>
                      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.03em] text-[#0f2347] md:text-xs">
                        <Phone className="h-4 w-4 sm:h-5 sm:w-5" />
                        Phone
                      </p>
                      <p className="mt-1">{selectedOrder.shippingPhone || '-'}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="grid items-center rounded-t-xl bg-[linear-gradient(120deg,#0f2347_0%,#0d2e61_48%,#0f2347_100%)] px-3 py-2 text-[11px] font-semibold text-white grid-cols-[1fr_56px_84px_92px] sm:px-4 sm:py-3 sm:text-sm sm:grid-cols-[1fr_64px_100px_110px]">
                    <p>Product</p>
                    <p className="text-center">Qty</p>
                    <p className="text-center">Unit Price</p>
                    <p className="text-right">Amount</p>
                  </div>
                  <div className="border border-slate-300 sm:border-t-0">
                    {selectedOrder.items?.map((item: any) => (
                      <div key={`receipt-mobile-${item.id}`}>
                        <div className="hidden border-b border-slate-200 px-3 py-2.5 text-sm sm:hidden">
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
                        <div className="grid min-h-[54px] grid-cols-[1fr_56px_84px_92px] items-center border-b border-slate-200 px-3 py-2 text-[11px] sm:min-h-[60px] sm:grid-cols-[1fr_64px_100px_110px] sm:px-4 sm:text-sm">
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

                <div className="mt-4 grid grid-cols-[1.2fr_1fr] overflow-hidden rounded-xl border border-[#b9e6ca] sm:grid-cols-[1.3fr_1fr]">
                  <div className="space-y-2 bg-white px-3 py-3 text-[11px] sm:px-4 sm:py-4 sm:text-xs md:text-sm">
                    <p className="flex justify-between">
                      <span className="font-semibold text-[#0f2347]">Subtotal</span>
                      <span className="font-semibold text-[#0f2347]">{formatPeso(orderSubtotal)}</span>
                    </p>
                    {orderDiscount > 0 ? (
                      <p className="flex justify-between border-t border-slate-200 pt-2 font-semibold text-[#16a34a]">
                        <span>Discount{orderDiscountPercent > 0 ? ` (${orderDiscountPercentLabel})` : ''}</span>
                        <span className="pl-4 text-right">-{formatPeso(orderDiscount)}</span>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-center justify-center border-l border-[#b9e6ca] bg-[#f1fbf4] px-3 py-3 sm:px-4 sm:py-4">
                    <p className="text-[11px] font-bold tracking-[0.04em] text-[#16a34a] sm:text-xs md:text-sm">TOTAL PRICE</p>
                    <p className="mt-1 text-[18px] font-black leading-none text-[#0f2347] sm:text-[22px] md:text-[26px]">{formatPeso(orderTotal)}</p>
                  </div>
                </div>

                <div className="mt-8 border-t-2 border-[#0f2347] pt-4 pb-4 text-center text-[9px] text-slate-500">
                  <p>This receipt serves as proof of payment and delivery.</p>
                  <p className="mt-1">Thank you for your purchase.</p>
                </div>
                </div>
              </div>
            </div>

            <div className="receipt-modal-footer shrink-0 border-t border-slate-200 bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              <Button
                type="button"
                className="h-[46px] w-full rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 sm:h-[48px] sm:text-base"
                onClick={() => downloadReceipt(selectedOrder, receiptPreviewRef.current)}
              >
                <Download className="mr-2 h-4 w-4" />
                Download Receipt
              </Button>
            </div>
          </motion.div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
