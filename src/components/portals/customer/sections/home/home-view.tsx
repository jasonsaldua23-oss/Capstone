'use client'

import { Fragment, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PortalProductGridSkeleton } from '@/components/portals/shared/loading-skeletons'
import { WelcomePopup } from '@/components/portals/shared/welcome-popup'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { Layers3, Loader2, Package, Search, ShoppingCart } from 'lucide-react'

type CustomerHomeViewProps = {
  customerName: string
  productSearch: string
  setProductSearch: (value: string) => void
  productCategoryFilter: string
  setProductCategoryFilter: (value: string) => void
  productCategoryOptions: string[]
  isProductsLoading: boolean
  filteredProducts: any[]
  getAvailableQty: (product: any) => number
  addToCartDirect: (product: any, qty: number) => void
  getProductImage: (imageUrl?: string | null) => string
  formatPeso: (value: number) => string
  cart: any[]
  onOpenCart: () => void
  onOpenMixedCase: () => void
}

export function CustomerHomeView({
  customerName,
  productSearch,
  setProductSearch,
  productCategoryFilter,
  setProductCategoryFilter,
  productCategoryOptions,
  isProductsLoading,
  filteredProducts,
  getAvailableQty,
  addToCartDirect,
  getProductImage,
  formatPeso,
  cart,
  onOpenCart,
  onOpenMixedCase,
}: CustomerHomeViewProps) {
  const [welcomeState] = useState(() => {
    const normalizedName = String(customerName || '').trim()
    const fallbackBack = normalizedName ? `Welcome back, ${normalizedName}.` : 'Welcome back!'
    if (typeof window === 'undefined') return { open: false, message: fallbackBack }
    try {
      const raw = window.sessionStorage.getItem('customer_welcome_state')
      if (!raw) return { open: false, message: fallbackBack }
      const parsed = JSON.parse(raw) as { mode?: 'existing' | 'new'; name?: string; ts?: number }
      const storedName = String(parsed?.name || '').trim() || normalizedName
      const isNewAccount = parsed?.mode === 'new'
      window.sessionStorage.removeItem('customer_welcome_state')
      return {
        open: true,
        message: isNewAccount
          ? (storedName ? `Welcome, ${storedName}.` : 'Welcome!')
          : (storedName ? `Welcome back, ${storedName}.` : 'Welcome back!'),
      }
    } catch {
      return { open: false, message: fallbackBack }
    }
  })
  const [showWelcomePopup, setShowWelcomePopup] = useState(welcomeState.open)
  const [cardQtyByProductId, setCardQtyByProductId] = useState<Record<string, number>>({})
  const totalUnits = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const estimatedTotal = cart.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
    0
  )

  const getCardQty = (productId: string, maxQty?: number) => {
    const raw = Number(cardQtyByProductId[productId])
    // Customer quantity is a case count, not the number of units packed inside it.
    const base = Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.floor(raw)) : 1
    const safeMaxQty = Number.isFinite(Number(maxQty)) && Number(maxQty) > 0 ? Math.floor(Number(maxQty)) : null
    return safeMaxQty ? Math.min(base, safeMaxQty) : base
  }

  const setCardQty = (productId: string, next: number, maxQty: number) => {
    const safeMaxQty = Number.isFinite(Number(maxQty)) && Number(maxQty) > 0 ? Math.floor(Number(maxQty)) : 100
    const safeNext = Number.isFinite(Number(next)) ? Math.floor(Number(next)) : 1
    const clamped = Math.max(1, Math.min(Math.max(1, safeMaxQty), safeNext))
    setCardQtyByProductId((prev) => ({ ...prev, [productId]: clamped }))
  }

  // Sold-out products stay in the catalog but sink below everything buyable.
  const { sortedProducts, firstSoldOutKey } = useMemo(() => {
    const inStock: any[] = []
    const soldOut: any[] = []
    for (const product of filteredProducts) {
      if (product && getAvailableQty(product) <= 0) soldOut.push(product)
      else inStock.push(product)
    }
    return {
      sortedProducts: [...inStock, ...soldOut],
      firstSoldOutKey: soldOut.length > 0 ? String(soldOut[0]?.id ?? '') : null,
    }
  }, [filteredProducts, getAvailableQty])

  return (
    <section className="-mx-4 min-h-[calc(100dvh-7rem)] bg-[#f5f8f6] pb-5 md:mx-0 md:min-h-[calc(100dvh-9rem)] md:pb-4">
      <WelcomePopup
        open={showWelcomePopup}
        message={welcomeState.message}
        subtitle="Place your order and we will deliver it to your store."
        onClose={() => setShowWelcomePopup(false)}
        overlayClassName="bg-black/70"
        panelClassName="border-emerald-200 bg-[#eaf8f1]"
        titleClassName="text-slate-900"
        subtitleClassName="text-slate-600"
        buttonClassName="bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
      />
      <div className="grid gap-4 px-3 pt-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div className="rounded-2xl border border-emerald-100 bg-white p-3">
            {/* Fix: balance both filters on phones while keeping the category compact on wider screens. */}
            <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_170px]">
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-[#f9fbfa] px-3 py-2">
                <Search className="h-4 w-4 text-slate-500" />
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search products..."
                  className="h-auto border-0 bg-transparent p-0 text-sm text-slate-700 shadow-none focus-visible:ring-0 placeholder:text-slate-400"
                />
              </div>
              <select
                value={productCategoryFilter}
                onChange={(e) => setProductCategoryFilter(e.target.value)}
                className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-[#f9fbfa] px-3 text-sm text-slate-700"
                title="Filter by category"
              >
                {productCategoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category === 'ALL' ? 'All categories' : category}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[1.55rem] font-extrabold leading-tight tracking-[-0.02em] text-slate-900 md:text-xl">
                  Product Catalog
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Place your order and we&apos;ll deliver it to your store.
                </p>
              </div>
              <Button
                type="button"
                onClick={onOpenMixedCase}
                className="rounded-xl bg-sky-600 text-white hover:bg-sky-500"
              >
                <Layers3 className="mr-2 h-4 w-4" />
                Build Mixed Case
              </Button>
            </div>

          </div>

          {isProductsLoading ? (
            <PortalProductGridSkeleton cards={6} />
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
              {sortedProducts.map((p, index) => {
                const availableQty = p ? getAvailableQty(p) : 0
                const sizeLabel = p
                  ? (() => {
                    const sizes = Array.isArray((p as any).sizes)
                      ? (p as any).sizes.map((s: any) => String(s).trim()).filter(Boolean)
                      : []
                    if (sizes.length > 0) return sizes.join(', ')
                    return String((p as any).sizeLabel || (p as any).size || '').trim() || 'N/A'
                  })()
                  : 'N/A'
                const quantityPerUnit = p
                  ? Number((p as any).quantityPerUnit ?? (p as any).quantity_per_unit ?? 0)
                  : 0
                const categoryLabel = p
                  ? String((p as any)?.category?.name || (p as any)?.category || '').trim()
                  : ''
                const currentQty = p ? getCardQty(p.id, availableQty) : 1
                const isSoldOut = Boolean(p) && availableQty <= 0
                const startsSoldOutGroup = firstSoldOutKey !== null && String(p?.id ?? '') === firstSoldOutKey
                return (
                  <Fragment key={p?.id || `placeholder-${index}`}>
                  {startsSoldOutGroup ? (
                    <h3 className="col-span-full mt-2 text-sm font-semibold text-slate-700 md:text-base">Sold Out</h3>
                  ) : null}
                  <Card
                    className={`overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-[0_8px_20px_rgba(16,24,40,0.08)] transition-all duration-200 md:rounded-2xl ${
                      isSoldOut
                        ? 'opacity-75'
                        : 'hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(16,24,40,0.12)]'
                    }`}
                  >
                    <CardContent className="relative p-1.5 pb-5 md:p-6 md:pb-10">
                      <div className="flex gap-1.5 md:gap-5">
                        <div className="relative w-[48%] shrink-0 overflow-hidden rounded-lg bg-[#f3f8f3] p-0 md:w-[46%] md:rounded-xl md:p-1.5">
                          {p?.imageUrl ? (
                            <img
                              src={getProductImage(p.imageUrl)}
                              alt={p.name}
                              className="h-[92px] w-full rounded-md object-cover md:h-[160px] md:rounded-lg md:object-cover"
                            />
                          ) : (
                            <div className="grid h-[92px] w-full place-items-center rounded-md bg-[#edf7ef] md:h-[160px] md:rounded-lg">
                              <Package className="h-8 w-8 text-slate-400/60 md:h-12 md:w-12" />
                            </div>
                          )}
                          {isSoldOut ? (
                            <div className="absolute inset-0 grid place-items-center rounded-lg bg-white/45 md:rounded-xl">
                              <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-900/70 text-center text-[10px] font-semibold leading-tight text-white md:h-20 md:w-20 md:text-xs">
                                Sold Out
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <div className="min-w-0 flex-1 space-y-0.5 leading-tight">
                          <p className="text-[1rem] font-semibold leading-tight text-slate-900 md:text-[1.45rem] md:font-semibold">
                            {p?.name || 'Product Name'}
                          </p>
                          <p className="text-[0.95rem] font-bold leading-tight text-slate-900 md:text-[1.35rem] md:font-bold md:text-slate-900">
                            {p ? formatPeso(p.price || 0) : '$ Price'}
                          </p>
                          <p className="text-[11px] font-semibold text-slate-900 md:text-[14px]">Size: {sizeLabel}</p>
                          <p className="text-[11px] text-slate-500 md:text-[14px]">
                            Qty/Unit: {quantityPerUnit > 0 ? quantityPerUnit : 'N/A'}
                          </p>
                          {categoryLabel ? (
                            <p className="line-clamp-3 break-words text-[11px] font-semibold leading-snug text-slate-900 md:line-clamp-2 md:text-[14px]">{categoryLabel}</p>
                          ) : null}
                          <p className="text-[11px] font-medium text-emerald-700 md:text-[14px]">
                            {availableQty > 0 ? `${availableQty} available` : 'Out of stock'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-0.5 pt-0.5">
                        <p className="mb-1 text-[11px] font-semibold text-slate-700 md:text-xs">Quantity (cases)</p>
                        <div className="mb-0.5 flex items-center justify-between rounded-md border border-emerald-100 bg-white px-1 py-0.5">
                          <button
                            type="button"
                            className="px-1.5 text-emerald-700 disabled:opacity-40"
                            disabled={!p || availableQty <= 0}
                            onClick={() => p && setCardQty(p.id, currentQty - 1, availableQty)}
                          >
                            −
                          </button>
                          <span className="text-[11px] font-semibold text-slate-900">{currentQty}</span>
                          <button
                            type="button"
                            className="px-1.5 text-emerald-700 disabled:opacity-40"
                            disabled={!p || availableQty <= 0}
                            onClick={() => p && setCardQty(p.id, currentQty + 1, availableQty)}
                          >
                            +
                          </button>
                        </div>
                        <div className="relative z-10 mb-0.5 grid grid-cols-4 gap-1">
                          {['1', '2', '3', '4'].map((qty) => {
                            const parsed = Number(qty)
                            const isActive = currentQty === parsed
                            const exceedsAvailable = parsed > Math.max(0, Number(availableQty || 0))
                            const isDisabledPreset = !p || availableQty <= 0 || exceedsAvailable
                            return (
                              <button
                                type="button"
                                key={qty}
                                disabled={isDisabledPreset}
                                onClick={() => {
                                  if (!p || isDisabledPreset) return
                                  setCardQty(p.id, parsed, availableQty)
                                }}
                                className={`pointer-events-auto rounded px-0.5 py-1 text-center text-[10px] font-medium md:text-[11px] ${isActive
                                    ? 'bg-emerald-600 text-white'
                                    : exceedsAvailable
                                      ? 'bg-slate-100 text-slate-400'
                                      : 'bg-slate-100 text-slate-600'
                                  } disabled:cursor-not-allowed disabled:opacity-50`}
                                title={exceedsAvailable ? `Not enough stock (only ${availableQty} available)` : undefined}
                              >
                                {qty}
                              </button>
                            )
                          })}
                        </div>
                        <Button
                          size="sm"
                          className="h-7 w-full rounded-md bg-emerald-600 px-1.5 text-[10px] font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 md:h-10 md:text-[13px]"
                          disabled={!p || availableQty <= 0}
                          onClick={() => p && addToCartDirect(p, currentQty)}
                        >
                          <ShoppingCart className="mr-1 h-3 w-3 md:h-4 md:w-4" />
                          {availableQty > 0 ? 'Add to Order' : 'Out of Stock'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                  </Fragment>
                )
              })}
            </div>
          )}
        </div>

        <aside className="hidden h-fit rounded-xl border border-emerald-100 bg-white p-4 lg:block">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Current Order ({cart.length} items)</h3>
            <button
              type="button"
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
              onClick={onOpenCart}
            >
              Edit
            </button>
          </div>
          <div className="space-y-3">
            {cart.length === 0 ? (
              <p className="text-sm text-slate-500">No items yet</p>
            ) : (
              cart.slice(0, 8).map((item) => (
                <div key={item.productId} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {item.itemType === 'MIXED_CASE'
                        ? 'Mixed Case'
                        : item.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.quantity} x {formatPeso(item.unitPrice || 0)}
                    </p>
                    {item.itemType !== 'MIXED_CASE' ? (
                      <p className="text-xs text-slate-500">Size: {String(item.sizeLabel || item.unit || '').trim() || 'case'}</p>
                    ) : null}
                    {item.itemType === 'MIXED_CASE' ? (
                      <div>
                        <MixedCaseComponents item={item} compact />
                      </div>
                    ) : null}
                  </div>
                  <p className="text-sm font-semibold text-slate-900">
                    {formatPeso((item.quantity || 0) * (item.unitPrice || 0))}
                  </p>
                </div>
              ))
            )}
          </div>
          <div className="mt-4 border-t pt-3">
            <p className="text-xs text-slate-500">Total items</p>
            <p className="text-sm font-semibold text-slate-900">{totalUnits} units</p>
            <p className="mt-2 text-xs text-slate-500">Estimated Total</p>
            <p className="text-2xl font-bold text-emerald-700">{formatPeso(estimatedTotal)}</p>
            <Button
              className="mt-3 h-10 w-full rounded-md bg-emerald-600 text-white hover:bg-emerald-500"
              onClick={onOpenCart}
            >
              Continue to Checkout
            </Button>
          </div>
        </aside>
      </div>
    </section>
  )
}
