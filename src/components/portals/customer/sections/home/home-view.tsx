'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Loader2, Package, Search, ShoppingCart } from 'lucide-react'

type CustomerHomeViewProps = {
  productSearch: string
  setProductSearch: (value: string) => void
  isProductsLoading: boolean
  filteredProducts: any[]
  getAvailableQty: (product: any) => number
  openAddToCartDialog: (product: any) => void
  getProductImage: (imageUrl?: string | null) => string
  formatPeso: (value: number) => string
}

export function CustomerHomeView({
  productSearch,
  setProductSearch,
  isProductsLoading,
  filteredProducts,
  getAvailableQty,
  openAddToCartDialog,
  getProductImage,
  formatPeso,
}: CustomerHomeViewProps) {
  return (
    <section className="-mx-4 -mt-0 min-h-[calc(100dvh-9.5rem)] bg-[linear-gradient(180deg,#d8edf7_0%,#d9eef8_38%,#dce8dc_100%)] pb-6 md:mx-0 md:mt-0 md:rounded-[1.2rem] md:border md:border-slate-200/70 md:pb-4">
      <div className="border-b border-slate-200/70 bg-[#f1f3f6]/95 px-3 py-2.5 md:rounded-t-[1.2rem]">
        <div className="flex items-center gap-2 rounded-2xl border border-slate-300/85 bg-[#eef0f4] px-3 py-2.5 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)]">
          <Search className="h-4 w-4 text-slate-500" />
          <Input
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Search products"
            className="h-auto border-0 bg-transparent p-0 text-sm text-slate-700 shadow-none focus-visible:ring-0 placeholder:text-slate-500"
          />
        </div>
      </div>
      <div className="mx-4 mt-3 rounded-[1.15rem] bg-[#d8edf7]/95 px-0.5 pb-0.5 pt-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
        <div className="relative h-[76px] overflow-hidden rounded-[1rem]">
          <div className="absolute inset-x-0 top-0 grid h-10 grid-cols-5 [clip-path:polygon(4%_0,96%_0,100%_100%,0_100%)]">
            <div className="bg-[#ea8580]" />
            <div className="bg-[#f0cf73]" />
            <div className="bg-[#a8d46c]" />
            <div className="bg-[#72d2df]" />
            <div className="bg-[#88a9d8]" />
          </div>
          <div className="absolute inset-x-0 top-7 grid h-10 grid-cols-5">
            <div className="rounded-b-full bg-[#ea8580]" />
            <div className="rounded-b-full bg-[#f0cf73]" />
            <div className="rounded-b-full bg-[#a8d46c]" />
            <div className="rounded-b-full bg-[#72d2df]" />
            <div className="rounded-b-full bg-[#88a9d8]" />
          </div>
        </div>
      </div>

      {isProductsLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-cyan-700" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 px-4 pb-2 pt-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filteredProducts.map((p, index) => {
            const availableQty = p ? getAvailableQty(p) : 0
            return (
              <Card
                key={p?.id || `placeholder-${index}`}
                className={`overflow-hidden rounded-[1.15rem] border border-white/75 bg-[#f1f6fc]/92 shadow-[0_10px_22px_rgba(15,23,42,0.14)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(15,23,42,0.18)] ${p ? 'cursor-pointer' : ''}`}
                onClick={() => {
                  if (p) openAddToCartDialog(p)
                }}
              >
                <div className="relative m-2.5 rounded-xl bg-[#dbead9] p-3">
                  {p?.imageUrl ? (
                    <img
                      src={getProductImage(p.imageUrl)}
                      alt={p.name}
                      className="aspect-[11/10] w-full rounded-lg object-contain"
                    />
                  ) : (
                    <div className="grid aspect-[11/10] w-full place-items-center rounded-lg bg-[#dcebd8]">
                      <Package className="h-16 w-16 text-slate-400/60" />
                    </div>
                  )}
                </div>

                <CardContent className="space-y-1 px-4 pb-4 pt-1">
                  <p className="line-clamp-1 text-[1.05rem] font-medium leading-tight tracking-[-0.01em] text-slate-900">{p?.name || 'Product Name'}</p>
                  <p className="text-[0.98rem] font-medium leading-tight text-slate-500">{p ? formatPeso(p.price || 0) : '$ Price'}</p>
                  <p className="text-xs text-slate-500">{availableQty > 0 ? `${availableQty} available` : 'Out of stock'}</p>
                  <div className="flex items-center justify-end pt-1">
                    <Button
                      size="sm"
                      className="h-7 rounded-full bg-sky-600 px-3 text-[11px] font-semibold text-white shadow-sm shadow-sky-700/20 transition-all hover:bg-sky-500 hover:shadow-md hover:shadow-sky-700/30"
                      disabled={!p || availableQty <= 0}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (p) openAddToCartDialog(p)
                      }}
                    >
                      <ShoppingCart className="mr-1 h-3 w-3" />
                      {availableQty > 0 ? 'Add to Cart' : 'Out of Stock'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}

