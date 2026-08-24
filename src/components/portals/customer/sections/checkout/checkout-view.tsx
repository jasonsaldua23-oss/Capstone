'use client'

import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CompactDiscountLine } from '@/components/shared/compact-discount-line'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { getMixedCaseDepositAmounts } from '@/components/portals/shared/mixed-case-deposit'

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
}: CustomerCheckoutViewProps) {
  const today = new Date()
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const minDeliveryDate = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`
  const effectiveDiscountPercent =
    selectedSubtotal > 0 && totalDiscount > 0
      ? (totalDiscount / selectedSubtotal) * 100
      : 0

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
                      return (
                        <>
                          <p className="truncate text-sm font-medium text-slate-800">
                            {item.itemType === 'MIXED_CASE'
                              ? 'Mixed Case'
                              : `${item.name} ${sizeLabel}`}
                          </p>
                          {categoryLabel ? (
                            <p className="text-xs text-slate-500">{categoryLabel}</p>
                          ) : null}
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
                          Quantity: {Math.max(1, Number(item.quantity || 1))}
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
                  <span className="font-medium text-emerald-600">Covers {formatPeso(selectedDepositRefunded)}</span>
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
    </section>
  )
}
