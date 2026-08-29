'use client'

import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, CheckCircle, Minus, Pencil, Plus, Recycle, MapPin, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { getMixedCaseDepositAmounts } from '@/components/portals/shared/mixed-case-deposit'

type CustomerCartViewProps = {
  setActiveView: (view: any) => void
  cart: any[]
  setIsAddressDialogOpen: (open: boolean) => void
  shippingBarangay: string
  shippingCity: string
  shippingProvince: string
  selectedCartIds: Set<string>
  setSelectedCartIds: (updater: any) => void
  getProductImage: (imageUrl?: string | null) => string
  updateCartQty: (productId: string, qty: number) => void
  removeFromCart: (productId: string) => void
  removeSelectedFromCart: () => void
  getCartItemAvailable: (item: any) => number | null
  allCartSelected: boolean
  selectedCount: number
  selectedSubtotal: number
  formatPeso: (value: number) => string
  onEditMixedCase: (item: any) => void
}

export function CustomerCartView(props: CustomerCartViewProps) {
  const {
    setActiveView,
    cart,
    setIsAddressDialogOpen,
    shippingBarangay,
    shippingCity,
    shippingProvince,
    selectedCartIds,
    setSelectedCartIds,
    getProductImage,
    updateCartQty,
    removeFromCart,
    removeSelectedFromCart,
    getCartItemAvailable,
    allCartSelected,
    selectedCount,
    selectedSubtotal,
    formatPeso,
    onEditMixedCase: _onEditMixedCase,
  } = props
  // Keep the body portal hydration-safe without introducing an extra effect render.
  const isMounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  )

  const formattedAddress =
    [shippingBarangay, shippingCity, shippingProvince].filter(Boolean).join(', ') ||
    'Select delivery address'

  const checkoutBarContent = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`grid h-5 w-5 place-items-center rounded-full border transition-all ${
            allCartSelected
              ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
              : 'border-slate-300 bg-white text-transparent hover:border-slate-400'
          }`}
          onClick={() => {
            setSelectedCartIds(allCartSelected ? new Set() : new Set(cart.map((item) => item.productId)))
          }}
          title="Select all"
        >
          <CheckCircle className="h-3.5 w-3.5" />
        </button>
        <div className="leading-tight">
          <p className="text-xs font-semibold text-slate-800">All ({cart.length})</p>
          <p className="text-[10px] text-slate-500">{selectedCount} selected</p>
        </div>

      </div>

      <div className="flex items-center gap-3">
        <div className="text-right leading-tight">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total</p>
          <p className="text-base font-bold text-slate-900 sm:text-lg">{formatPeso(selectedSubtotal)}</p>
        </div>

        <Button
          disabled={selectedCount === 0}
          className="h-10 rounded-xl bg-emerald-600 px-5 text-xs font-bold text-white shadow-xs hover:bg-emerald-500 disabled:bg-slate-200 disabled:text-slate-400"
        >
          Check out ({selectedCount})
        </Button>
      </div>
    </div>
  )

  return (
    <section className="-mx-4 -mt-4 flex min-h-[calc(100dvh-9.5rem)] flex-col bg-[#f8fafc] pb-40 md:mx-0 md:mt-0 md:rounded-2xl md:border md:border-slate-200 md:bg-white md:pb-6">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 px-4 py-3.5 backdrop-blur-md md:rounded-t-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8.5 w-8.5 rounded-full border border-slate-200 bg-white text-slate-700 shadow-2xs hover:bg-slate-50"
              onClick={() => setActiveView('home')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-base font-bold tracking-tight text-slate-900">
              Shopping Cart <span className="font-normal text-slate-400">({cart.length})</span>
            </h2>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-xl border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900"
            onClick={() => setIsAddressDialogOpen(true)}
            title="Edit delivery address"
          >
            <Pencil className="h-3.5 w-3.5 text-slate-500" />
            <span>Edit Address</span>
          </Button>
        </div>

        <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <p className="truncate text-xs text-slate-600">
            <span className="font-medium text-slate-800">Deliver to: </span>
            {formattedAddress}
          </p>
        </div>
      </div>

      {/* Cart Items List */}
      <div className="flex-1 space-y-3 px-3 pt-3 sm:px-4">
        {cart.map((item) => {
          const selected = selectedCartIds.has(item.productId)
          return (
            <Card
              key={item.productId}
              className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xs transition-shadow hover:shadow-xs"
            >
              <CardContent className="p-3.5 sm:p-4">
                <div className="flex items-start gap-3">
                  {/* Select Checkbox */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCartIds((prev: Set<string>) => {
                        const next = new Set(prev)
                        if (next.has(item.productId)) next.delete(item.productId)
                        else next.add(item.productId)
                        return next
                      })
                    }}
                    className={`mt-5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-all ${
                      selected
                        ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                        : 'border-slate-300 bg-white text-transparent hover:border-slate-400'
                    }`}
                    title="Select item"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                  </button>

                  {/* Product Image Thumbnail */}
                  {item.itemType === 'MIXED_CASE' ? (
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-100 bg-slate-50 p-1">
                      <div className="grid h-full w-full grid-cols-2 gap-0.5">
                        {(item.components || []).slice(0, 2).map((component: any) => (
                          <img
                            key={component.productId}
                            src={getProductImage(component.product?.imageUrl)}
                            alt={component.productName || 'Mixed case product'}
                            className="h-full w-full object-contain"
                            onError={(e) => {
                              e.currentTarget.src = '/ann-anns-logo.png'
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-100 bg-slate-50 p-1">
                      <img
                        src={getProductImage(item.imageUrl)}
                        alt={item.name}
                        className="h-full w-full object-contain"
                        onError={(e) => {
                          e.currentTarget.src = '/ann-anns-logo.png'
                        }}
                      />
                    </div>
                  )}

                  {/* Info & Price Column */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="line-clamp-1 text-sm font-bold text-slate-900 leading-snug">
                      {item.itemType === 'MIXED_CASE'
                        ? 'Mixed Case'
                        : item.name}
                    </p>

                    <p className={item.itemType === 'MIXED_CASE' ? 'hidden' : 'text-[11px] text-slate-900 font-semibold line-clamp-1'}>
                      {String((item as any)?.category || '').trim() ? `${String((item as any).category).trim()} · ` : ''}
                      <span className="font-semibold text-slate-900">
                        {String(item.sizeLabel || item.unit || '').trim() || 'case'}
                      </span>
                    </p>
                    {item.itemType === 'MIXED_CASE' ? <MixedCaseComponents item={item} compact /> : null}

                    {/* Price and Quantity Stepper Row */}
                    <div className="flex items-center justify-between pt-1.5">
                      <p className="text-base font-bold text-emerald-700 leading-none">
                        {formatPeso(item.unitPrice)}
                      </p>

                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50/90 p-0.5 shadow-2xs">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6.5 w-6.5 rounded-lg text-slate-600 hover:bg-white hover:text-slate-900"
                            onClick={() => updateCartQty(item.productId, item.quantity - 1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="min-w-[1.8rem] text-center text-xs font-bold text-slate-900">
                            {item.quantity}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6.5 w-6.5 rounded-lg text-slate-600 hover:bg-white hover:text-slate-900"
                            onClick={() => updateCartQty(item.productId, item.quantity + 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        {/* Added: explicit per-item remove, so customers are not forced
                            to step the quantity down to clear a line. */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          onClick={() => removeFromCart(item.productId)}
                          title="Remove from cart"
                          aria-label={`Remove ${item.itemType === 'MIXED_CASE' ? 'mixed case' : item.name} from cart`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stock shortfall is named on the line so the customer can fix it
                    here instead of discovering it when the order is rejected. */}
                {(() => {
                  const available = getCartItemAvailable(item)
                  if (available === null || (available > 0 && item.quantity <= available)) return null
                  const unitLabel = String(item.unit || 'case').trim() || 'case'
                  return (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-2">
                      <p className="text-[11px] font-semibold text-rose-700">
                        {available <= 0
                          ? 'Out of stock — remove this item to check out.'
                          : `Only ${available} ${unitLabel}${available !== 1 ? 's' : ''} available.`}
                      </p>
                      {available > 0 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 rounded-lg border-rose-300 bg-white px-2 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                          onClick={() => updateCartQty(item.productId, available)}
                        >
                          Use {available}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 rounded-lg border-rose-300 bg-white px-2 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                          onClick={() => removeFromCart(item.productId)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  )
                })()}

                {/* Returnable Empty Bottles / Deposit Box (Glass Bottles Only) */}
                {(() => {
                  if (item.itemType === 'MIXED_CASE') {
                    const deposit = getMixedCaseDepositAmounts(item)
                    if (deposit.charged <= 0) return null
                    return (
                      <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/80 p-2.5 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-700">
                            <Recycle className="h-3.5 w-3.5 text-emerald-600" />
                            Mixed-case bottle deposit
                          </span>
                          <strong className="text-emerald-700">+{formatPeso(deposit.charged)}</strong>
                        </div>
                      </div>
                    )
                  }
                  const isReturnable = item.packagingType === 'RETURNABLE' && !item.depositExempt
                  const hasDeposit = Number(item.caseDepositAmount || item.depositAmount || 0) > 0
                  const isGlass =
                    item.containerPackagingType === 'Glass Bottle' ||
                    String(item.category || '').toLowerCase().includes('glass') ||
                    String(item.containerTypeName || '').toLowerCase().includes('glass') ||
                    String(item.looseUnit || '').toLowerCase().includes('glass') ||
                    Boolean(item.containerTypeId)

                  if (!isReturnable || !hasDeposit || !isGlass) return null

                  const isCase = item.itemType === 'MIXED_CASE' || String(item.unit || '').trim().toLowerCase() === 'case'
                  const containersPerCase = Math.max(1, Number(item.containersPerCase || 1))
                  // Case products display full case balances and case credits;
                  // bottle counts are reserved for genuinely loose products.
                  const availableEmptyQuantity = isCase
                    ? Math.floor(Number(item.availableEmptyBottles || 0) / containersPerCase)
                    : Number(item.availableEmptyBottles || 0)
                  const appliedEmptyQuantity = isCase
                    ? Math.floor(Number(item.emptyReturnedQuantity || 0) / containersPerCase)
                    : Number(item.emptyReturnedQuantity || 0)
                  const emptyUnitLabel = isCase ? 'case' : 'loose bottle'

                  return (
                    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/80 p-2.5 text-xs space-y-1.5">
                      <div className="flex items-center justify-between font-medium">
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-700">
                          <Recycle className="h-3.5 w-3.5 text-emerald-600" />
                          {item.looseUnit || item.containerTypeName || 'Glass Bottle'} Returnable
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Available Empties: <strong className="text-slate-900">{availableEmptyQuantity} {emptyUnitLabel}{availableEmptyQuantity !== 1 ? 's' : ''}</strong>
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-200/60 pt-1.5 text-[11px] text-slate-600">
                        <span>Deposit per {isCase ? 'case' : 'bottle'}: <strong className="text-emerald-700">{formatPeso(isCase ? item.caseDepositAmount || 0 : item.depositAmount || 0)}</strong></span>
                        <span className={`font-medium ${(item.emptyReturnedQuantity || 0) > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {(item.emptyReturnedQuantity || 0) > 0
                            ? `${appliedEmptyQuantity} ${emptyUnitLabel}${appliedEmptyQuantity !== 1 ? 's' : ''} applied`
                            : 'New deposit will apply'}
                        </span>
                      </div>
                    </div>
                  )
                })()}
              </CardContent>
            </Card>
          )
        })}

        {cart.length === 0 && (
          <div className="px-4 py-16 text-center text-sm text-slate-500">Your cart is empty.</div>
        )}
      </div>

      {/* Floating Bottom Checkout Bar */}
      {cart.length > 0 && isMounted
        ? createPortal(
            <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+3.75rem)] left-0 right-0 z-30 border-t border-slate-200/80 bg-white/95 px-4 py-2.5 backdrop-blur-md shadow-[0_-4px_20px_rgba(15,23,42,0.06)] md:hidden">
              {checkoutBarContent}
            </div>,
            document.body
          )
        : null}
      {cart.length > 0 ? (
        <div className="mt-auto hidden rounded-b-2xl border border-slate-200 px-4 py-2.5 md:block">
          {checkoutBarContent}
        </div>
      ) : null}
    </section>
  )
}
