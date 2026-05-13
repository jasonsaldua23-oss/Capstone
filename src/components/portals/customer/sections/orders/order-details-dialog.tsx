'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, CheckCircle2, Download, Loader2, MapPin, Package, Upload, Wallet, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'

const DAMAGE_REASON_OPTIONS = ['Broken seal', 'Cracked bottle', 'Leaking', 'Expired', 'Crushed case', 'Other']
const MAX_EVIDENCE_PHOTOS = 2

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
    submitReplacementRequest,
  } = props
  const [isReplacementRequestOpen, setIsReplacementRequestOpen] = useState(false)
  const [replacementLines, setReplacementLines] = useState<Array<{
    key: string
    productId: string
    quantity: string
    inputMode: 'case' | 'bottle'
    reason: string
    description: string
  }>>([
    { key: 'line-1', productId: '', quantity: '1', inputMode: 'case', reason: 'Broken seal', description: '' },
  ])
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([])
  const [isSubmittingReplacement, setIsSubmittingReplacement] = useState(false)
  const evidencePreviewUrls = useMemo(
    () => evidenceFiles.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })),
    [evidenceFiles]
  )
  useEffect(() => {
    return () => {
      for (const preview of evidencePreviewUrls) URL.revokeObjectURL(preview.url)
    }
  }, [evidencePreviewUrls])
  const selectedOrderReplacementRecords = useMemo(
    () => deliveryIssueRecords.filter((record: any) => record.orderId === selectedOrder?.id),
    [deliveryIssueRecords, selectedOrder?.id],
  )
  const hasActiveReplacementRequest = useMemo(() => {
    return selectedOrderReplacementRecords.some((record: any) => {
      const rawStatus = String(record?.status || '').toUpperCase()
      return !['COMPLETED', 'RESOLVED_ON_DELIVERY', 'REJECTED', 'CANCELLED'].includes(rawStatus)
    })
  }, [selectedOrderReplacementRecords])

  const getReplacementQty = (record: any): { qty: number; label: 'unit' | 'bottle' } => {
    const meta = typeof record?.notes === 'string' && record.notes.includes('Meta:')
      ? (() => {
          try {
            return JSON.parse(String(record.notes).slice(String(record.notes).lastIndexOf('Meta:') + 5).trim())
          } catch {
            return {}
          }
        })()
      : {}
    const descriptionText = String(record?.description || '')
    const byUnitMatch = descriptionText.match(/By\s*Unit:\s*(\d+)/i)
    const byBottleMatch = descriptionText.match(/By\s*Bottle:\s*(\d+)/i)

    if (byUnitMatch) {
      const qty = Number(byUnitMatch[1] || 0)
      return { qty: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0, label: 'unit' }
    }
    if (byBottleMatch) {
      const qty = Number(byBottleMatch[1] || 0)
      return { qty: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0, label: 'bottle' }
    }

    const unitQty = Number((meta as any)?.replacementCases ?? (meta as any)?.quantityToReplaceCases ?? 0)
    if (Number.isFinite(unitQty) && unitQty > 0) {
      return { qty: Math.floor(unitQty), label: 'unit' }
    }

    const bottleQty = Number((meta as any)?.replacementBottles ?? (meta as any)?.quantityToReplaceBottles ?? 0)
    if (Number.isFinite(bottleQty) && bottleQty > 0) {
      return { qty: Math.floor(bottleQty), label: 'bottle' }
    }

    const value = Number(
      record?.quantityReplaced ??
      record?.replacementQuantity ??
      (meta as any)?.quantityReplaced ??
      (meta as any)?.replacementQuantity ??
      0
    )
    return {
      qty: Number.isFinite(value) && value > 0 ? Math.floor(value) : 0,
      label: 'bottle',
    }
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
  const selectedOrderIsDelivered = Boolean(selectedOrder && isOrderDelivered(selectedOrder))
  const getOrderDisplayDateTime = (order: any) => {
    const deliveredAt = String(order?.deliveredAt || '').trim()
    if (deliveredAt) {
      const dt = new Date(deliveredAt)
      return {
        date: dt.toLocaleDateString(),
        time: dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
    }

    const createdAt = String(order?.createdAt || '').trim()
    if (createdAt) {
      const dt = new Date(createdAt)
      return {
        date: dt.toLocaleDateString(),
        time: dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
    }

    // If only a date (YYYY-MM-DD) exists, avoid timezone-shifted fake times like 08:00 AM.
    const deliveryDate = String(order?.deliveryDate || '').trim()
    if (deliveryDate) {
      return {
        date: deliveryDate,
        time: 'N/A',
      }
    }

    return { date: 'N/A', time: 'N/A' }
  }

  useEffect(() => {
    if (!selectedOrder) return
    const shouldOpenReplacement = Boolean((selectedOrder as any)?.__openReplacementRequest)
    if (shouldOpenReplacement && hasActiveReplacementRequest) {
      setIsReplacementRequestOpen(false)
      return
    }
    setIsReplacementRequestOpen(shouldOpenReplacement)
  }, [selectedOrder, hasActiveReplacementRequest])

  const selectableOrderItems = Array.isArray(selectedOrder?.items) ? selectedOrder.items : []
  const addReplacementLine = () => {
    setReplacementLines((prev) => [
      ...prev,
      { key: `line-${Date.now()}-${prev.length + 1}`, productId: '', quantity: '1', inputMode: 'case', reason: 'Broken seal', description: '' },
    ])
  }
  const removeReplacementLine = (key: string) => {
    setReplacementLines((prev) => (prev.length > 1 ? prev.filter((line) => line.key !== key) : prev))
  }
  const updateReplacementLine = (key: string, patch: Partial<{ productId: string; quantity: string; inputMode: 'case' | 'bottle'; reason: string; description: string }>) => {
    setReplacementLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }
  const getQuantityPerCaseForItem = (item: any) => {
    const value = Number(
      item?.quantityPerCase ??
      item?.quantity_per_case ??
      item?.product?.quantityPerCase ??
      item?.product?.quantity_per_case ??
      item?.product?.quantityPerUnit ??
      item?.product?.quantity_per_unit ??
      1
    )
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
  }
  const getSelectableItemsForLine = (lineKey: string) => {
    const selectedByOtherLines = new Set(
      replacementLines
        .filter((line) => line.key !== lineKey)
        .map((line) => line.productId)
        .filter(Boolean)
    )
    return selectableOrderItems.filter((item: any) => !selectedByOtherLines.has(String(item.id || '')))
  }

  return (
    <>
    <Dialog
      open={!!selectedOrder && !isReplacementRequestOpen}
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
                    {selectedOrderIsDelivered ? 'Delivered on ' : 'Ordered on '}
                    {getOrderDisplayDateTime(selectedOrder).date} |{' '}
                    {getOrderDisplayDateTime(selectedOrder).time}
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

              {selectedOrderReplacementRecords.length ? (
                <div className="border-t border-slate-200 px-3 py-3">
                  <p className="mb-1 text-xs font-semibold text-slate-700">Replacement Details</p>
                  {hasActiveReplacementRequest ? (
                    <p className="mb-2 text-[11px] font-medium text-amber-700">
                      A replacement request for this order is already in progress. You cannot submit another one yet.
                    </p>
                  ) : null}
                  {selectedOrderReplacementRecords.map((record: any) => {
                      const label = getReplacementStatusLabel(record.status)
                      const qtyReplaced = getReplacementQty(record)
                      return (
                        <div key={record.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs">
                          <span className="text-slate-700">
                            {record.replacementProductName || record.originalProductName || 'Product replacement'}
                            {qtyReplaced.qty > 0 ? ` x${qtyReplaced.qty} ${qtyReplaced.label}${qtyReplaced.qty > 1 ? 's' : ''} replaced` : ''}
                          </span>
                          <Badge className={getReplacementBadgeClass(label)}>{label}</Badge>
                        </div>
                      )
                    })}
                </div>
              ) : (
                <div className="border-t border-slate-200 px-3 py-5 text-center">
                  <p className="text-sm font-semibold text-slate-700">No replacement case filed for this order.</p>
                  <p className="text-xs text-slate-500">
                    {selectedOrderIsDelivered ? 'All items were delivered successfully.' : 'No replacement request has been submitted.'}
                  </p>
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
                onClick={() => setIsReceiptDialogOpen(true)}
                disabled={!isOrderDelivered(selectedOrder)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5 md:h-4 md:w-4" />
                View Receipt
              </Button>
              <Button className="h-9 rounded-lg bg-emerald-600 text-xs text-white hover:bg-emerald-500 md:h-10 md:text-sm" onClick={() => setSelectedOrder(null)}>
                Close
              </Button>
            </div>
          </motion.div>
        </DialogContent>
      ) : null}
    </Dialog>
    <Dialog
      open={isReplacementRequestOpen}
      onOpenChange={(open) => {
        setIsReplacementRequestOpen(open)
        if (!open) {
          setSelectedOrder(null)
        }
      }}
    >
      <DialogContent className="w-[95vw] max-w-[720px] rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-base font-semibold text-slate-900">Request Replacement</p>
        <p className="mt-1 text-xs text-slate-600">Select one or more products and set reason per product.</p>
        {hasActiveReplacementRequest ? (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
            A replacement request is already in progress for this order.
          </p>
        ) : null}
        <div className="mt-3 space-y-2">
          {replacementLines.map((line, index) => (
            <div key={line.key} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-800">Product #{index + 1}</p>
                <button type="button" className="text-[11px] text-rose-600 disabled:opacity-40" disabled={replacementLines.length <= 1} onClick={() => removeReplacementLine(line.key)}>
                  Remove
                </button>
              </div>
              <div className="mb-2 inline-flex h-9 overflow-hidden rounded-md border border-slate-300 bg-white">
                <button type="button" className={`px-3 text-xs font-semibold ${line.inputMode === 'case' ? 'bg-emerald-600 text-white' : 'text-slate-700'}`} onClick={() => updateReplacementLine(line.key, { inputMode: 'case' })}>
                  By Unit
                </button>
                <button type="button" className={`px-3 text-xs font-semibold ${line.inputMode === 'bottle' ? 'bg-emerald-600 text-white' : 'text-slate-700'}`} onClick={() => updateReplacementLine(line.key, { inputMode: 'bottle' })}>
                  By Bottle
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-slate-600">Product</p>
                  <select className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs" value={line.productId} onChange={(e) => updateReplacementLine(line.key, { productId: e.target.value })}>
                    <option value="">Select product</option>
                    {getSelectableItemsForLine(line.key).map((item: any) => (
                      <option key={item.id} value={item.id}>{item.product?.name || 'Item'}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-slate-600">Quantity</p>
                  <input type="number" min={1} className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs" value={line.quantity} onChange={(e) => updateReplacementLine(line.key, { quantity: e.target.value })} placeholder={line.inputMode === 'case' ? 'Damaged units' : 'Damaged bottles'} />
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-medium text-slate-600">Reason</p>
                  <select className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs" value={line.reason} onChange={(e) => updateReplacementLine(line.key, { reason: e.target.value })}>
                    {DAMAGE_REASON_OPTIONS.map((reason) => <option key={reason}>{reason}</option>)}
                  </select>
                </div>
                {line.reason === 'Other' ? (
                  <textarea className="min-h-[68px] rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs md:col-span-3" value={line.description} onChange={(e) => updateReplacementLine(line.key, { description: e.target.value })} placeholder="Describe the issue for this product" />
                ) : null}
              </div>
            </div>
          ))}
          <Button variant="outline" className="h-9 text-xs" onClick={addReplacementLine}>Add Product</Button>
          <label className="flex h-9 cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-white text-xs text-slate-700">
            <Upload className="h-3.5 w-3.5" />
            Upload Evidence (Photo)
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files || [])
                  .filter((file) => file.type.startsWith('image/'))
                  .slice(0, MAX_EVIDENCE_PHOTOS)
                setEvidenceFiles(files)
              }}
            />
          </label>
          <p className="text-[11px] text-slate-500">{evidenceFiles.length} / {MAX_EVIDENCE_PHOTOS} photo(s) selected</p>
          {evidencePreviewUrls.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 rounded-md border border-slate-200 bg-white p-2 md:grid-cols-4">
              {evidencePreviewUrls.map((preview) => (
                <img
                  key={preview.url}
                  src={preview.url}
                  alt={preview.name}
                  className="h-20 w-full rounded-md border object-cover"
                />
              ))}
            </div>
          ) : null}
          <Button
            className="h-9 rounded-md bg-emerald-600 text-xs text-white hover:bg-emerald-500"
            disabled={isSubmittingReplacement || hasActiveReplacementRequest}
            onClick={async () => {
              if (hasActiveReplacementRequest) return
              const validLines = replacementLines.filter((line) => line.productId && Number(line.quantity) > 0)
              if (validLines.length === 0) return alert('Add at least one valid damaged product line')
              setIsSubmittingReplacement(true)
              try {
                for (const line of validLines) {
                  const selectedItem = selectableOrderItems.find((item: any) => item.id === line.productId)
                  const productName = selectedItem?.product?.name || 'Product'
                  const quantityPerCase = getQuantityPerCaseForItem(selectedItem)
                  const inputQty = Math.max(Number(line.quantity || 0), 0)
                  const submittedBottleQty = line.inputMode === 'case'
                    ? inputQty * quantityPerCase
                    : inputQty
                  const modeNotes = line.inputMode === 'case'
                    ? `By Unit: ${inputQty} unit(s), Qty/Unit ${quantityPerCase}`
                    : `By Bottle: ${inputQty} bottle(s), Qty/Unit ${quantityPerCase}`
                  await submitReplacementRequest(
                    selectedOrder.id,
                    submittedBottleQty,
                    line.reason,
                    `[${productName}] ${modeNotes}. ${line.description || line.reason}`,
                    evidenceFiles,
                  )
                }
                setReplacementLines([{ key: 'line-1', productId: '', quantity: '1', inputMode: 'case', reason: 'Broken seal', description: '' }])
                setEvidenceFiles([])
                setIsReplacementRequestOpen(false)
              } catch (error: any) {
                alert(error?.message || 'Failed to submit replacement request')
              } finally {
                setIsSubmittingReplacement(false)
              }
            }}
          >
            {isSubmittingReplacement ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Submit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
