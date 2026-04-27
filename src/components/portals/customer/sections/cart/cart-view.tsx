'use client'

import { ArrowLeft, CheckCircle, Minus, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MapPin } from 'lucide-react'

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
  allCartSelected: boolean
  selectedCount: number
  selectedSubtotal: number
  formatPeso: (value: number) => string
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
    allCartSelected,
    selectedCount,
    selectedSubtotal,
    formatPeso,
  } = props

  return (
<section className="-mx-4 -mt-4 min-h-[calc(100dvh-9.5rem)] bg-[linear-gradient(180deg,#f5f8fc_0%,#ebf3fb_55%,#e9f0f6_100%)] pb-28 md:mx-0 md:mt-0 md:rounded-[1.6rem] md:border md:border-emerald-100/70 md:pb-4 md:shadow-[0_14px_32px_rgba(5,150,105,0.08)] md:backdrop-blur-md">
            <div className="border-b border-slate-200/70 bg-white/92 px-4 py-3 backdrop-blur md:rounded-t-[1.6rem]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100" onClick={() => setActiveView('home')}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <h2 className="text-[1.15rem] font-bold tracking-tight text-slate-900">Shopping cart ({cart.length})</h2>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  onClick={() => setIsAddressDialogOpen(true)}
                  title="Edit delivery address"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-2 flex items-start gap-2 pl-10">
                <MapPin className="mt-0.5 h-4 w-4 text-slate-500" />
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">Delivery address</p>
                  <p className="truncate text-sm text-slate-700">{shippingBarangay || 'Barangay'}, {shippingCity || 'City'}, {shippingProvince || 'Province'}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3 px-3 pt-3">
              {cart.map((item) => {
                const selected = selectedCartIds.has(item.productId)
                return (
                  <Card key={item.productId} className="rounded-3xl border border-white/80 bg-[linear-gradient(120deg,#f6f2e8_0%,#edf5fd_65%,#e9f2fc_100%)] shadow-[0_12px_28px_rgba(15,23,42,0.12)]">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCartIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(item.productId)) next.delete(item.productId)
                              else next.add(item.productId)
                              return next
                            })
                          }}
                          className={`grid h-6 w-6 place-items-center rounded-full border transition-all ${selected ? 'border-emerald-600 bg-emerald-600 text-white shadow-[0_4px_10px_rgba(5,150,105,0.32)]' : 'border-slate-300 bg-white text-transparent'}`}
                          title="Select item"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                        </button>
                        <img
                          src={getProductImage(item.imageUrl)}
                          alt={item.name}
                          className="h-[96px] w-[96px] rounded-2xl border border-white/90 object-cover bg-white shadow-[0_8px_16px_rgba(15,23,42,0.10)]"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="truncate text-[1.05rem] font-semibold text-slate-900">{item.name}</p>
                          <p className="inline-block max-w-full truncate rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">{item.unit}</p>
                          <p className="text-[2rem] font-bold leading-none text-emerald-700">{formatPeso(item.unitPrice)}</p>
                          <div className="pt-0.5">
                            <div className="inline-flex items-center rounded-full border border-sky-100 bg-sky-50/80 px-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full text-sky-700 hover:bg-sky-100" onClick={() => updateCartQty(item.productId, item.quantity - 1)}>
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                              <div className="min-w-[2.2rem] px-1 text-center text-base font-medium text-slate-800">{item.quantity}</div>
                              <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full text-sky-700 hover:bg-sky-100" onClick={() => updateCartQty(item.productId, item.quantity + 1)}>
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}

              {cart.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-slate-500">Your cart is empty.</div>
              )}
            </div>

            {cart.length > 0 ? (
              <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200/70 bg-white/95 px-3 py-2 backdrop-blur md:static md:mt-3 md:rounded-b-2xl md:border md:border-slate-200">
                <div className="flex items-center gap-2 rounded-2xl bg-[#f3efe4] px-2 py-2 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                  <button
                    type="button"
                    className={`grid h-6 w-6 place-items-center rounded-full border transition-all ${allCartSelected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}
                    onClick={() => {
                      setSelectedCartIds(allCartSelected ? new Set() : new Set(cart.map((item) => item.productId)))
                    }}
                    title="Select all"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                  </button>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="text-sm font-medium text-slate-700">All selected</p>
                    <p className="text-xs text-slate-500">({selectedCount} item{selectedCount > 1 ? 's' : ''})</p>
                  </div>
                  <div className="pr-1 text-right leading-tight">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-slate-500">Sub-total</p>
                    <p className="text-xl font-bold text-slate-900">{formatPeso(selectedSubtotal)}</p>
                  </div>
                  {selectedCount > 0 ? (
                    <Button
                      className="h-11 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-500 px-6 text-white shadow-[0_8px_18px_rgba(244,63,94,0.36)] hover:from-rose-700 hover:to-rose-600"
                      onClick={() => setActiveView('checkout')}
                    >
                      Check out
                    </Button>
                  ) : (
                    <Button
                      disabled
                      className="h-11 rounded-2xl bg-slate-300 px-6 text-white"
                    >
                      Check out
                    </Button>
                  )}
                </div>
              </div>
            ) : null}
          </section>
  )
}
