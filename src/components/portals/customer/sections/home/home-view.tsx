'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Heart, Loader2, Package, Search, ShoppingCart } from 'lucide-react'

type CustomerHomeViewProps = {
  customerName: string
  productSearch: string
  setProductSearch: (value: string) => void
  isProductsLoading: boolean
  filteredProducts: any[]
  getAvailableQty: (product: any) => number
  addToCartDirect: (product: any, qty: number) => void
  getProductImage: (imageUrl?: string | null) => string
  formatPeso: (value: number) => string
  cart: any[]
  onOpenCart: () => void
}

export function CustomerHomeView({
  customerName,
  productSearch,
  setProductSearch,
  isProductsLoading,
  filteredProducts,
  getAvailableQty,
  addToCartDirect,
  getProductImage,
  formatPeso,
  cart,
  onOpenCart,
}: CustomerHomeViewProps) {
  const [welcomeMessage, setWelcomeMessage] = useState('Welcome back!')
  const [cardQtyByProductId, setCardQtyByProductId] = useState<Record<string, number>>({})
  const [favoriteProductIds, setFavoriteProductIds] = useState<Record<string, true>>({})
  const totalUnits = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const estimatedTotal = cart.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
    0
  )

  const getCardQty = (productId: string, maxQty?: number) => {
    const raw = Number(cardQtyByProductId[productId])
    const base = Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.floor(raw)) : 24
    const safeMaxQty = Number.isFinite(Number(maxQty)) && Number(maxQty) > 0 ? Math.floor(Number(maxQty)) : null
    return safeMaxQty ? Math.min(base, safeMaxQty) : base
  }

  const setCardQty = (productId: string, next: number, maxQty: number) => {
    const safeMaxQty = Number.isFinite(Number(maxQty)) && Number(maxQty) > 0 ? Math.floor(Number(maxQty)) : 100
    const safeNext = Number.isFinite(Number(next)) ? Math.floor(Number(next)) : 1
    const clamped = Math.max(1, Math.min(Math.max(1, safeMaxQty), safeNext))
    setCardQtyByProductId((prev) => ({ ...prev, [productId]: clamped }))
  }

  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      const aFav = Boolean(a?.id && favoriteProductIds[a.id])
      const bFav = Boolean(b?.id && favoriteProductIds[b.id])
      if (aFav === bFav) return 0
      return aFav ? -1 : 1
    })
  }, [filteredProducts, favoriteProductIds])

  const toggleFavorite = (productId: string) => {
    setFavoriteProductIds((prev) => {
      if (prev[productId]) {
        const next = { ...prev }
        delete next[productId]
        return next
      }
      return { ...prev, [productId]: true }
    })
  }

  useEffect(() => {
    const normalizedName = String(customerName || '').trim()
    const fallbackBack = normalizedName ? `Welcome back, ${normalizedName}` : 'Welcome back!'
    if (typeof window === 'undefined') {
      setWelcomeMessage(fallbackBack)
      return
    }

    try {
      const raw = window.sessionStorage.getItem('customer_welcome_state')
      if (!raw) {
        setWelcomeMessage(fallbackBack)
        return
      }

      const parsed = JSON.parse(raw) as { mode?: string; name?: string; ts?: number }
      const mode = String(parsed?.mode || '').toLowerCase()
      const storedName = String(parsed?.name || '').trim() || normalizedName
      if (mode === 'new') {
        setWelcomeMessage(storedName ? `Welcome, ${storedName}` : 'Welcome!')
      } else {
        setWelcomeMessage(storedName ? `Welcome back, ${storedName}` : 'Welcome back!')
      }
      window.sessionStorage.removeItem('customer_welcome_state')
    } catch {
      setWelcomeMessage(fallbackBack)
    }
  }, [customerName])

  return (
    <section className="-mx-4 min-h-[calc(100dvh-7rem)] bg-[#f5f8f6] pb-5 md:mx-0 md:min-h-[calc(100dvh-9rem)] md:pb-4">
      <div className="grid gap-4 px-3 pt-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <div className="rounded-2xl border border-emerald-100 bg-white p-3">
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-[#f9fbfa] px-3 py-2">
                <Search className="h-4 w-4 text-slate-500" />
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search products..."
                  className="h-auto border-0 bg-transparent p-0 text-sm text-slate-700 shadow-none focus-visible:ring-0 placeholder:text-slate-400"
                />
              </div>
            </div>

            <div className="mt-3">
              <p className="text-[1.55rem] font-extrabold leading-tight tracking-[-0.02em] text-slate-900 md:text-xl">
                {welcomeMessage}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Place your order and we&apos;ll deliver it to your store.
              </p>
            </div>

          </div>

          {isProductsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-700" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
              {sortedProducts.map((p, index) => {
                const availableQty = p ? getAvailableQty(p) : 0
                const sizeLabel = p
                  ? (Array.isArray(p.sizes) && p.sizes.length > 0
                      ? p.sizes.map((s: any) => String(s).trim()).filter(Boolean).join(', ')
                      : 'N/A')
                  : 'N/A'
                const quantityPerUnit = p
                  ? Number((p as any).quantityPerUnit ?? (p as any).quantity_per_unit ?? 0)
                  : 0
                const currentQty = p ? getCardQty(p.id, availableQty) : 24
                const isFavorite = Boolean(p?.id && favoriteProductIds[p.id])

                return (
                  <Card
                    key={p?.id || `placeholder-${index}`}
                    className="overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-[0_8px_20px_rgba(16,24,40,0.08)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(16,24,40,0.12)] md:rounded-2xl"
                  >
                    <CardContent className="p-1 md:p-6">
                      <div className="mb-1 flex justify-end md:mb-2">
                        <button
                          type="button"
                          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                          onClick={() => p?.id && toggleFavorite(p.id)}
                          className={`rounded-full p-1 transition-colors ${
                            isFavorite
                              ? 'text-rose-500 hover:text-rose-600'
                              : 'text-slate-400 hover:text-emerald-600'
                          }`}
                        >
                          <Heart className={`h-4 w-4 ${isFavorite ? 'fill-current' : ''}`} />
                        </button>
                      </div>
                      <div className="flex gap-1.5 md:gap-5">
                        <div className="relative w-[42%] shrink-0 rounded-lg bg-[#f3f8f3] p-0.5 md:rounded-xl md:p-3">
                          {p?.imageUrl ? (
                            <img
                              src={getProductImage(p.imageUrl)}
                              alt={p.name}
                              className="h-[88px] w-full rounded-md object-contain md:h-[160px] md:rounded-lg md:object-contain"
                            />
                          ) : (
                            <div className="grid h-[88px] w-full place-items-center rounded-md bg-[#edf7ef] md:h-[160px] md:rounded-lg">
                              <Package className="h-8 w-8 text-slate-400/60 md:h-12 md:w-12" />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1 space-y-0.5 leading-tight">
                          <p className="line-clamp-1 text-[1.05rem] font-semibold leading-tight text-slate-900 md:text-[1.45rem] md:font-semibold">
                            {p?.name || 'Product Name'}
                          </p>
                          <p className="text-[1rem] font-bold leading-tight text-slate-900 md:text-[1.35rem] md:font-bold md:text-slate-900">
                            {p ? formatPeso(p.price || 0) : '$ Price'}
                          </p>
                          <p className="text-[12px] text-slate-500 md:text-[14px]">Size: {sizeLabel}</p>
                          <p className="text-[12px] text-slate-500 md:text-[14px]">
                            Qty/Unit: {quantityPerUnit > 0 ? quantityPerUnit : 'N/A'}
                          </p>
                          <p className="text-[12px] font-medium text-emerald-700 md:text-[14px]">
                            {availableQty > 0 ? `${availableQty} available` : 'Out of stock'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-0.5 pt-0">
                        <p className="mb-0.5 text-[8px] font-medium text-slate-500">Quantity</p>
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
                          {['24', '48', '72', '100'].map((qty) => {
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
                                className={`pointer-events-auto rounded px-0.5 py-1 text-center text-[10px] font-medium md:text-[11px] ${
                                  isActive
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
                    <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
                    <p className="text-xs text-slate-500">
                      {item.quantity} x {formatPeso(item.unitPrice || 0)}
                    </p>
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
