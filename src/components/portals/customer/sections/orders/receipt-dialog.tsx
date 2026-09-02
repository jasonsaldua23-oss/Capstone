'use client'

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, CalendarDays, ClipboardList, Download, MapPin, Package, Phone, Store, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'

const RECEIPT_BUSINESS_NAME = "Ann Ann's Beverages Trading"

function resolveReceiptSellerPhone(order: any) {
  const candidates = [
    order?.sellerPhone,
    order?.adminPhone,
    order?.admin?.phone,
    order?.adminUser?.phone,
    order?.handledBy?.phone,
    order?.processedBy?.phone,
    order?.ownerPhone,
    order?.warehousePhone,
  ]

  return String(candidates.find((value) => String(value || '').trim()) || '').trim()
}

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
  const sellerPhone = resolveReceiptSellerPhone(selectedOrder)
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
        <DialogContent showCloseButton={false} className="h-[90vh] w-[98vw] max-w-[760px] p-0 overflow-hidden rounded-2xl border border-slate-200">
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="receipt-modal flex h-full min-h-0 flex-col overflow-hidden bg-white font-['Helvetica','Arial',sans-serif]"
          >
            <div className="receipt-modal-header flex h-[60px] items-center border-b border-slate-200 bg-white px-4">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsReceiptDialogOpen(false)} aria-label="Close receipt preview">
                <ArrowLeft aria-hidden="true" className="h-5 w-5" />
              </Button>
              <p className="flex-1 text-center text-lg font-semibold leading-none text-[#0f2347]">Receipt Preview</p>
              <div className="h-8 w-8" />
            </div>

            <div ref={receiptBodyRef} className="receipt-modal-body flex-1 overflow-y-auto px-4 py-4 pb-6">
              <div className="mx-auto w-full">
                <div ref={receiptPreviewRef} className="rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-[1.35] text-[#1f2937] shadow-[0_12px_30px_rgba(15,35,71,0.08)] sm:p-5">

                <div className="grid grid-cols-[1.6fr_1fr] items-start gap-4 border-b border-slate-200 pb-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <img
                      src="/aab-trading-shop.png"
                      alt={RECEIPT_BUSINESS_NAME}
                      className="h-16 w-16 rounded-full border border-slate-200 object-cover bg-white"
                    />
                    <div className="min-w-0">
                      <p className="text-base font-bold leading-tight tracking-[0.01em] text-[#0f2e6b]">{RECEIPT_BUSINESS_NAME}</p>
                      <p className="mt-1 text-xs text-slate-600">Official Delivery Receipt</p>
                      {sellerPhone ? <p className="mt-1 text-xs text-slate-700">{sellerPhone}</p> : null}
                    </div>
                  </div>
                  <div className="pl-2 text-right">
                    <p className="text-sm font-bold leading-tight tracking-[0.01em] text-[#0f2e6b]">ORDER RECEIPT</p>
                    <span className="mt-2 ml-auto block h-[3px] w-20 bg-[#1e8d40]" />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-0 overflow-hidden rounded-xl border border-[#c8d7ef] bg-[#f8fbff] text-xs text-[#1f2937]">
                  <div className="flex items-center gap-2 border-r border-[#d7e3f6] px-3 py-3">
                    <ClipboardList className="h-5 w-5 text-[#0f2347]" />
                    <p className="break-all">Receipt No. <span className="font-bold">{`RCT-${selectedOrder.orderNumber}`}</span></p>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-3">
                    <Package className="h-5 w-5 text-[#0f2347]" />
                    <p>Order No. <span className="font-bold">{selectedOrder.orderNumber}</span></p>
                  </div>
                </div>

                <div className="mt-4 border-b border-slate-300 pb-4 text-xs">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="pr-4 border-r border-slate-200">
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.03em] text-[#0f2347]">
                        <MapPin className="h-5 w-5" />
                        Delivery Address
                      </p>
                      <p className="mt-1 leading-5">{deliveryLines.join(', ') || '-'}</p>
                    </div>
                    <div className="px-4 border-r border-slate-200">
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.03em] text-[#0f2347]">
                        <Store className="h-5 w-5" />
                        Sold By
                      </p>
                      <p className="mt-1 break-words">{RECEIPT_BUSINESS_NAME}</p>
                    </div>
                    <div className="pl-4">
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.03em] text-[#0f2347]">
                        <CalendarDays className="h-5 w-5" />
                        Order Details
                      </p>
                      <p className="mt-1">Ordered: {orderDateLabel}</p>
                      <p className="mt-1">Delivered: {deliveredDateLabel}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
                    <div>
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.03em] text-[#0f2347]">
                        <User className="h-5 w-5" />
                        Recipient
                      </p>
                      <p className="mt-1">{selectedOrder.shippingName || '-'}</p>
                    </div>
                    <div>
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.03em] text-[#0f2347]">
                        <Phone className="h-5 w-5" />
                        Phone
                      </p>
                      <p className="mt-1">{selectedOrder.shippingPhone || '-'}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <div data-receipt-items-header className="grid grid-cols-[minmax(0,1fr)_30px_60px_68px] items-center rounded-t-xl bg-[#0f2347] px-2 py-3 text-[10px] font-semibold text-white sm:grid-cols-[minmax(0,1fr)_50px_90px_95px] sm:px-4 sm:text-xs">
                    <p>Product</p>
                    <p className="text-center">Qty</p>
                    <p className="text-center">Unit Price</p>
                    <p className="text-right">Amount</p>
                  </div>
                  <div className="border border-slate-300">
                    {selectedOrder.items?.map((item: any) => (
                      <div key={`receipt-item-${item.id}`}>
                        <div data-receipt-item-row className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_30px_60px_68px] items-start border-b border-slate-200 text-[10px] sm:grid-cols-[minmax(0,1fr)_50px_90px_95px] sm:text-xs">
                          <div data-receipt-product-cell className="min-w-0 border-r border-slate-200 px-2 py-2 sm:px-3">
                            <p className="font-medium text-[#1f2937]">{item.itemType === 'MIXED_CASE' ? `Mixed Case — ${item.caseCapacity || 0} units` : `${item.product?.name || 'Item'} ${getProductMeta(item).size !== '-' ? getProductMeta(item).size : ''}`}</p>
                            {item.itemType === 'MIXED_CASE' ? (
                              <div>
                                <MixedCaseComponents item={item} compact />
                              </div>
                            ) : null}
                            {getProductMeta(item).category !== '-' ? (
                              <p className="mt-0.5 text-[9px] text-slate-500">{getProductMeta(item).category}</p>
                            ) : null}
                          </div>
                          <p className="self-center border-r border-slate-200 py-2 text-center">{item.quantity}</p>
                          <p className="self-center whitespace-nowrap border-r border-slate-200 py-2 text-center">{formatPeso(item.unitPrice)}</p>
                          <p data-receipt-amount-cell className="self-center whitespace-nowrap px-1 py-2 text-right sm:px-2">{formatPeso(Number(item.totalPrice ?? Number(item.unitPrice || 0) * Number(item.quantity || 0)))}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-[1fr_auto] overflow-hidden rounded-xl border border-[#b9e6ca]">
                  <div className="space-y-1 bg-white px-4 py-4 text-xs">
                    <p className="font-semibold text-[#0f2347]">Subtotal</p>
                    <p className="font-semibold text-[#0f2347]">{formatPeso(orderSubtotal)}</p>
                    {orderDiscount > 0 ? (
                      <>
                        <p className="mt-2 font-semibold text-[#16a34a]">
                          Discount{orderDiscountPercent > 0 ? ` (${orderDiscountPercentLabel})` : ''}
                        </p>
                        <p className="font-semibold text-[#16a34a]">-{formatPeso(orderDiscount)}</p>
                      </>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-center justify-center border-l border-[#b9e6ca] bg-[#f1fbf4] px-4 py-4">
                    <p className="text-xs font-bold tracking-[0.04em] text-[#16a34a]">TOTAL PRICE</p>
                    <p className="mt-1 text-[22px] font-black leading-none text-[#0f2347]">{formatPeso(orderTotal)}</p>
                  </div>
                </div>

                <div className="mt-8 border-t-2 border-[#0f2347] pt-4 pb-4 text-center text-[10px] text-slate-500">
                  <p>This receipt serves as proof of payment and delivery.</p>
                  <p className="mt-1">Thank you for your purchase.</p>
                </div>
                </div>
              </div>
            </div>

            <div className="receipt-modal-footer shrink-0 border-t border-slate-200 bg-white px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              <Button
                type="button"
                className="h-[46px] w-full rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500"
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
