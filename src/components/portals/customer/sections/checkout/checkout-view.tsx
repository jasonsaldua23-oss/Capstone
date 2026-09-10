'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2, WalletCards } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CompactDiscountLine } from '@/components/shared/compact-discount-line'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { getMixedCaseDepositAmounts } from '@/components/portals/shared/mixed-case-deposit'
import { getCheckoutQuantityLabel } from '@shared/customer-logic/item-display'

export type DepositRefundOption = {
  productId: string
  productName: string
  containerTypeId: string
  containerTypeName: string
  depositPerContainer: number
  maxQuantity: number
}

export type DepositRefundLine = DepositRefundOption & {
  quantity: number
}

type CustomerCheckoutViewProps = {
  setActiveView: (view: any) => void
  selectedCartItems: any[]
  shippingName: string
  setIsAddressDialogOpen: (open: boolean) => void
  shippingPhone: string
  composedShippingAddress: string
  getProductImage: (imageUrl?: string | null) => string
  formatPeso: (value: number) => string
  selectedSubtotal: number
  selectedDepositCharged: number
  selectedDepositRefunded: number
  depositCreditAmount: number
  depositRefundLines: DepositRefundLine[]
  setDepositRefundLines: (value: DepositRefundLine[]) => void
  depositRefundOptions: DepositRefundOption[]
  discountName: string
  discountType: string
  discountPercent: number
  discountAmountPerCase: number
  discountPerCase: number
  discountCasesAffected: number
  totalDiscount: number
  finalTotal: number
  notes: string
  setNotes: (value: string) => void
  deliveryDate: string
  setDeliveryDate: (value: string) => void
  placeOrder: () => void
  isPlacingOrder: boolean
  canPlaceOrder: boolean
  insufficientStockItems: any[]
}

export function CustomerCheckoutView({
  setActiveView,
  selectedCartItems,
  shippingName,
  setIsAddressDialogOpen,
  shippingPhone,
  composedShippingAddress,
  getProductImage,
  formatPeso,
  selectedSubtotal,
  selectedDepositCharged,
  selectedDepositRefunded,
  depositCreditAmount,
  depositRefundLines,
  setDepositRefundLines,
  depositRefundOptions,
  discountName,
  discountType,
  discountPercent,
  discountAmountPerCase,
  discountPerCase,
  discountCasesAffected,
  totalDiscount,
  finalTotal,
  notes,
  setNotes,
  deliveryDate,
  setDeliveryDate,
  placeOrder,
  isPlacingOrder,
  canPlaceOrder,
  insufficientStockItems,
}: CustomerCheckoutViewProps) {
  const [refundDialogOpen, setRefundDialogOpen] = useState(false)
  const [refundDraft, setRefundDraft] = useState<DepositRefundLine[]>([])
  const today = new Date()
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const minDeliveryDate = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`
  const effectiveDiscountPercent =
    selectedSubtotal > 0 && totalDiscount > 0
      ? (totalDiscount / selectedSubtotal) * 100
      : 0
  const payableBeforeRefund = Math.max(0, selectedSubtotal - totalDiscount + selectedDepositCharged - selectedDepositRefunded)
  const availableByContainer = new Map<string, number>()
  depositRefundOptions.forEach((option) => {
    availableByContainer.set(
      option.containerTypeId,
      Math.max(availableByContainer.get(option.containerTypeId) || 0, option.maxQuantity * option.depositPerContainer)
    )
  })
  const availableDepositCredit = Array.from(availableByContainer.values()).reduce((total, amount) => total + amount, 0)
  // Keep the client request within both the verified balance and this order's payable total.
  const maximumDepositCredit = Math.min(
    Math.max(0, availableDepositCredit),
    payableBeforeRefund
  )

  const normalizeRefundLines = (lines: DepositRefundLine[]) => {
    let remainingOrderValue = payableBeforeRefund
    const remainingByContainer = new Map<string, number>()
    depositRefundOptions.forEach((option) => {
      remainingByContainer.set(
        option.containerTypeId,
        Math.max(remainingByContainer.get(option.containerTypeId) || 0, option.maxQuantity)
      )
    })
    return depositRefundOptions.flatMap((option) => {
      const requested = lines.find(
        (line) => line.productId === option.productId && line.containerTypeId === option.containerTypeId
      )?.quantity || 0
      const affordableQuantity = option.depositPerContainer > 0
        ? Math.floor((remainingOrderValue + 0.000001) / option.depositPerContainer)
        : 0
      const quantity = Math.max(0, Math.min(
        Math.floor(requested),
        option.maxQuantity,
        remainingByContainer.get(option.containerTypeId) || 0,
        affordableQuantity
      ))
      if (quantity <= 0) return []
      remainingByContainer.set(option.containerTypeId, (remainingByContainer.get(option.containerTypeId) || 0) - quantity)
      remainingOrderValue -= quantity * option.depositPerContainer
      return [{ ...option, quantity }]
    })
  }

  // Keep an existing request valid when the cart, balance, or discount changes.
  useEffect(() => {
    const normalized = normalizeRefundLines(depositRefundLines)
    const currentShape = depositRefundLines.map(({ productId, containerTypeId, quantity }) => ({ productId, containerTypeId, quantity }))
    const nextShape = normalized.map(({ productId, containerTypeId, quantity }) => ({ productId, containerTypeId, quantity }))
    if (JSON.stringify(currentShape) !== JSON.stringify(nextShape)) setDepositRefundLines(normalized)
  }, [depositRefundLines, depositRefundOptions, payableBeforeRefund, setDepositRefundLines])

  const openDepositRefund = () => {
    setRefundDraft(depositRefundLines.map((line) => ({ ...line })))
    setRefundDialogOpen(true)
  }

  const applyDepositRefund = () => {
    setDepositRefundLines(normalizeRefundLines(refundDraft))
    setRefundDialogOpen(false)
  }
  const refundDraftAmount = refundDraft.reduce(
    (total, line) => total + (line.quantity * line.depositPerContainer),
    0
  )

  const updateRefundQuantity = (option: DepositRefundOption, rawQuantity: number) => {
    const nextQuantity = Math.max(0, Math.min(Math.floor(rawQuantity || 0), option.maxQuantity))
    const remainingLines = refundDraft.filter(
      (line) => !(line.productId === option.productId && line.containerTypeId === option.containerTypeId)
    )
    const nextLines = nextQuantity > 0
      ? [...remainingLines, { ...option, quantity: nextQuantity }]
      : remainingLines
    setRefundDraft(normalizeRefundLines(nextLines))
  }

  return (
    <section className="-mx-4 -mt-4 bg-white/55 pb-20 md:mx-0 md:mt-0 md:rounded-[1.6rem] md:border md:border-white/70 md:bg-white/75 md:pb-4 md:shadow-[0_18px_45px_rgba(15,23,42,0.08)] md:backdrop-blur-xl">
      <div className="border-b bg-white px-3 py-3 md:rounded-t-xl">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setActiveView('cart')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold">Checkout</h2>
        </div>
      </div>

      {selectedCartItems.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          No selected items. Go back to cart and select item(s) to checkout.
        </div>
      ) : (
        <div className="space-y-2 p-2.5 md:space-y-3 md:p-3">
          <Card className="border-0 shadow-none">
            <CardContent className="space-y-1 p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">{shippingName || 'No recipient name set'}</p>
                <Button variant="ghost" size="sm" onClick={() => setIsAddressDialogOpen(true)}>Edit</Button>
              </div>
              <p className="text-sm text-slate-600">{shippingPhone || 'No phone number set'}</p>
              <p className="text-sm text-slate-700">
                {composedShippingAddress || 'No delivery address set yet'}
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-none">
            <CardContent className="space-y-3 p-4">
              {selectedCartItems.map((item) => (
                <div key={item.productId} className="flex gap-3">
                  {item.itemType === 'MIXED_CASE' ? (
                    <div className="grid h-[74px] w-[74px] shrink-0 grid-cols-2 overflow-hidden rounded-md border bg-white">
                      {/* Show the two products that make up this mixed case. */}
                      {(item.components || []).slice(0, 2).map((component: any) => (
                        <img
                          key={component.productId}
                          src={getProductImage(component.product?.imageUrl)}
                          alt={component.productName || 'Mixed case product'}
                          className="h-full w-full min-w-0 object-cover"
                        />
                      ))}
                    </div>
                  ) : (
                    <img
                      src={getProductImage(item.imageUrl)}
                      alt={item.name}
                      className="h-[74px] w-[74px] rounded-md border object-cover bg-white"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    {(() => {
                      const sizeLabel = String(item.sizeLabel || item.unit || '').trim() || 'case'
                      const categoryLabel = String((item as any)?.category?.name || (item as any)?.category || '').trim()
                      const quantityLabel = getCheckoutQuantityLabel(item)
                      return (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-medium text-slate-800">
                              {item.itemType === 'MIXED_CASE'
                                ? 'Mixed Case'
                                : `${item.name} ${sizeLabel}`}
                            </p>
                            <p className="shrink-0 text-sm font-semibold text-slate-900">
                              {formatPeso(Number(item.quantity || 1) * Number(item.unitPrice || 0))}
                            </p>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-900">{categoryLabel || 'Beverage'}</span>
                            <span className="text-slate-500">{quantityLabel} × {formatPeso(item.unitPrice)}</span>
                          </div>
                        </>
                      )
                    })()}
                    {(() => {
                      if (item.itemType === 'MIXED_CASE') {
                        const deposit = getMixedCaseDepositAmounts(item)
                        const netDeposit = Math.max(0, deposit.charged - deposit.refunded)
                        if (deposit.charged <= 0) return null
                        return (
                          <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs">
                            {deposit.refunded > 0 ? (
                              <p className="text-emerald-700">Empty-container credit applied: {formatPeso(deposit.refunded)}</p>
                            ) : null}
                            <p className="mt-0.5 text-slate-600">New deposit charged: +{formatPeso(netDeposit)}</p>
                          </div>
                        )
                      }
                      const isReturnable = item.packagingType === 'RETURNABLE' && !item.depositExempt
                      const hasDeposit = Number(item.caseDepositAmount || item.depositAmount || 0) > 0
                      const isGlass =
                        item.containerPackagingType === 'Glass Bottle' ||
                        String(item.category || '').toLowerCase().includes('glass') ||
                        String(item.containerTypeName || '').toLowerCase().includes('glass') ||
                        Boolean(item.containerTypeId)

                      if (!isReturnable || !hasDeposit || !isGlass) return null

                      const isCase = item.itemType === 'MIXED_CASE' || String(item.unit || '').trim().toLowerCase() === 'case'
                      const containersPerCase = Math.max(1, Number(item.containersPerCase || 1))
                      const grossDeposit = item.quantity * Number(isCase ? item.caseDepositAmount || 0 : item.depositAmount || 0)
                      const depositCredit = isCase
                        ? Math.floor(Number(item.emptyReturnedQuantity || 0) / containersPerCase) * Number(item.caseDepositAmount || 0)
                        : Number(item.emptyReturnedQuantity || 0) * Number(item.depositAmount || 0)
                      const newDeposit = Math.max(0, grossDeposit - depositCredit)
                      // Case purchases display full cases and case credits;
                      // bottle wording is reserved for genuinely loose items.
                      const availableEmptyQuantity = isCase
                        ? Math.floor(Number(item.availableEmptyBottles || 0) / containersPerCase)
                        : Number(item.availableEmptyBottles || 0)
                      const appliedEmptyQuantity = isCase
                        ? Math.floor(Number(item.emptyReturnedQuantity || 0) / containersPerCase)
                        : Number(item.emptyReturnedQuantity || 0)
                      const emptyUnitLabel = isCase ? 'case' : 'loose bottle'
                      return (
                        <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs">
                          <p className="font-medium text-slate-700">
                            {item.looseUnit || item.containerTypeName || 'Glass Bottle'} — Empty Containers: {availableEmptyQuantity} {emptyUnitLabel}{availableEmptyQuantity !== 1 ? 's' : ''} — Deposit Balance: {formatPeso(item.availableDepositBalance || 0)}
                          </p>
                          <p className={(item.emptyReturnedQuantity || 0) > 0 ? 'mt-1 text-emerald-700' : 'mt-1 text-amber-700'}>
                            {(item.emptyReturnedQuantity || 0) > 0
                              ? `${appliedEmptyQuantity} existing ${emptyUnitLabel}${appliedEmptyQuantity !== 1 ? 's' : ''} will be used.`
                              : 'No existing empties are available.'}
                          </p>
                          {newDeposit > 0 ? <p className="mt-0.5 text-slate-600">New deposit charged: +{formatPeso(newDeposit)}</p> : null}
                        </div>
                      )
                    })()}
                    {item.itemType === 'MIXED_CASE' ? (
                      <div className="mt-2 rounded-lg bg-sky-50 p-2 text-xs text-sky-800">
                        <p className="font-semibold">
                          Quantity: {Math.max(1, Number(item.quantity || 1))} case{Number(item.quantity || 1) === 1 ? '' : 's'}
                        </p>
                        <MixedCaseComponents item={item} compact />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-slate-200/90 bg-[#f8fafc] shadow-none">
            <CardContent className="space-y-2 p-3 md:space-y-2.5 md:p-3.5">
              <div className="flex items-center justify-between text-[13px] md:text-sm">
                <span className="text-slate-600">Subtotal</span>
                <span className="font-medium text-slate-800">{formatPeso(selectedSubtotal)}</span>
              </div>
              {selectedDepositRefunded > 0 && (
                <div className="flex items-center justify-between text-[13px] md:text-sm">
                  <span className="text-slate-600">Existing empty deposits applied</span>
                  <span className="font-semibold text-emerald-600">- Covers {formatPeso(selectedDepositRefunded)}</span>
                </div>
              )}
              {maximumDepositCredit > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-start gap-2.5">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                      <WalletCards className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-emerald-950">Empty-container refund</p>
                      <p className="mt-0.5 text-[11px] leading-4 text-emerald-800">
                        You can apply up to {formatPeso(maximumDepositCredit)} from your available empties to this order.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2.5 h-9 w-full border-emerald-300 bg-white text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                    onClick={openDepositRefund}
                  >
                    {depositCreditAmount > 0 ? 'Change Deposit Refund' : 'Request Deposit Refund'}
                  </Button>
                </div>
              )}
              {depositCreditAmount > 0 && (
                <div className="flex items-center justify-between gap-3 text-[13px] md:text-sm">
                  <span className="text-slate-600">Deposit refund applied to this order</span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-emerald-600">- {formatPeso(depositCreditAmount)}</span>
                    <button type="button" className="text-xs font-medium text-rose-600 hover:underline" onClick={() => setDepositRefundLines([])}>
                      Remove
                    </button>
                  </div>
                </div>
              )}
              {selectedDepositCharged - selectedDepositRefunded > 0 && (
                <div className="flex items-center justify-between text-[13px] md:text-sm">
                  <span className="text-slate-600">New returnable-container deposit</span>
                  <span className="font-medium text-slate-800">+{formatPeso(selectedDepositCharged - selectedDepositRefunded)}</span>
                </div>
              )}
              <CompactDiscountLine value={formatPeso(totalDiscount)} percent={effectiveDiscountPercent || discountPercent} />
              <p className="text-[11px] text-slate-500">Discounts apply to orders totaling 50 cases or packs.</p>
              <div className="h-px bg-slate-100" />
              <div className="flex items-center justify-between text-[15px] font-semibold text-slate-900 md:text-base">
                <span>Total ({selectedCartItems.length} item{selectedCartItems.length > 1 ? 's' : ''})</span>
                <span className="text-emerald-600">{formatPeso(finalTotal)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-slate-200/90 bg-[#f8fafc] shadow-none">
            <CardContent className="space-y-2 p-3 md:space-y-2.5 md:p-3.5">
              <Label className="text-[13px] font-semibold text-slate-800 md:text-sm">Order note (optional)</Label>
              <Textarea
                placeholder="Add note for delivery"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[64px] rounded-xl border-slate-200 bg-white text-[13px] text-slate-700 placeholder:text-slate-400 focus-visible:ring-emerald-500 md:min-h-[72px] md:text-sm"
              />
              <Label className="text-[13px] font-semibold text-slate-800 md:text-sm">Delivery date</Label>
              <Input
                type="date"
                value={deliveryDate}
                min={minDeliveryDate}
                onChange={e => setDeliveryDate(e.target.value)}
                className="h-10 rounded-xl border-slate-200 bg-white text-[13px] text-slate-700 focus-visible:ring-emerald-500 md:h-11 md:text-sm"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {selectedCartItems.length > 0 ? (
        /* Fix: keep the action bar in the checkout flow so the animated page container cannot position it over the product list. */
        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mt-2 border-t bg-white px-2.5 py-1 md:static md:mt-3 md:rounded-b-xl md:border md:border-slate-200 md:py-2">
          {/* Say why the order is blocked instead of letting the server reject it. */}
          {insufficientStockItems.length > 0 ? (
            <div className="mb-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5">
              <p className="text-[11px] font-semibold text-rose-700 md:text-xs">
                {insufficientStockItems.length === 1
                  ? `${insufficientStockItems[0]?.name || 'One item'} no longer has enough stock.`
                  : `${insufficientStockItems.length} items no longer have enough stock.`}{' '}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => setActiveView('cart')}
                >
                  Review your cart
                </button>{' '}
                to continue.
              </p>
            </div>
          ) : null}
          <div className="flex items-center gap-2 md:gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500 md:text-sm">Total ({selectedCartItems.length} item{selectedCartItems.length > 1 ? 's' : ''})</p>
              <p className="text-lg font-semibold text-emerald-700 md:text-2xl">{formatPeso(finalTotal)}</p>
            </div>
            <Button
              className="h-8 rounded-xl bg-rose-500 px-4 text-[11px] text-white hover:bg-rose-600 md:h-11 md:px-8 md:text-sm"
              onClick={placeOrder}
              disabled={isPlacingOrder || !canPlaceOrder}
            >
              {isPlacingOrder ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Place order
            </Button>
          </div>
        </div>
      ) : null}

      {/* The customer chooses how much verified empty value to attach to this order. */}
      <Dialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle>Apply Deposit Refund</DialogTitle>
            <DialogDescription>
              Apply the value of your available empty containers to reduce this order&apos;s amount due.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm">
              <div>
                <p className="text-xs text-emerald-700">Available to apply</p>
                <p className="mt-1 font-semibold text-emerald-950">{formatPeso(maximumDepositCredit)}</p>
              </div>
              <div>
                <p className="text-xs text-emerald-700">Order before refund</p>
                <p className="mt-1 font-semibold text-emerald-950">{formatPeso(finalTotal + depositCreditAmount)}</p>
              </div>
            </div>
            <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
              {depositRefundOptions.map((option) => {
                const quantity = refundDraft.find(
                  (line) => line.productId === option.productId && line.containerTypeId === option.containerTypeId
                )?.quantity || 0
                return (
                  <div key={`${option.productId}-${option.containerTypeId}`} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{option.productName}</p>
                        <p className="text-xs text-slate-500">{option.containerTypeName} · {formatPeso(option.depositPerContainer)} each</p>
                        <p className="mt-1 text-xs text-emerald-700">Up to {option.maxQuantity} empties available</p>
                      </div>
                      <div className="w-24 shrink-0">
                        <Label htmlFor={`refund-${option.productId}`} className="sr-only">Empty quantity</Label>
                        <Input
                          id={`refund-${option.productId}`}
                          type="number"
                          min="0"
                          max={option.maxQuantity}
                          step="1"
                          value={quantity || ''}
                          onChange={(event) => updateRefundQuantity(option, Number(event.target.value || 0))}
                          placeholder="Qty"
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
              <p className="text-xs text-slate-500">The driver will collect these exact empties when this order is delivered.</p>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-600">Refund applied</span>
              <span className="font-semibold text-emerald-700">-{formatPeso(refundDraftAmount)}</span>
            </div>
            <div className="flex gap-2 border-t border-slate-100 pt-4">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setRefundDialogOpen(false)}>Cancel</Button>
              <Button type="button" className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700" disabled={refundDraftAmount <= 0} onClick={applyDepositRefund}>
                Apply to This Order
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
