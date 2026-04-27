'use client'

import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type PaymentMethod = 'COD' | 'CARD' | 'GCASH' | 'MAYA'

type CustomerCheckoutViewProps = {
  setActiveView: (view: any) => void
  selectedCartItems: any[]
  shippingName: string
  setIsAddressDialogOpen: (open: boolean) => void
  shippingPhone: string
  composedShippingAddress: string
  getProductImage: (imageUrl?: string | null) => string
  formatPeso: (value: number) => string
  selectedPaymentMethod: string
  paymentMethod: PaymentMethod
  setPaymentMethod: (method: PaymentMethod) => void
  selectedSubtotal: number
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
  selectedPaymentMethod,
  paymentMethod,
  setPaymentMethod,
  selectedSubtotal,
  notes,
  setNotes,
  deliveryDate,
  setDeliveryDate,
  placeOrder,
  isPlacingOrder,
  canPlaceOrder,
}: CustomerCheckoutViewProps) {
  return (
    <section className="-mx-4 -mt-4 bg-white/55 pb-28 md:mx-0 md:mt-0 md:rounded-[1.6rem] md:border md:border-white/70 md:bg-white/75 md:pb-4 md:shadow-[0_18px_45px_rgba(15,23,42,0.08)] md:backdrop-blur-xl">
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
                  <img
                    src={getProductImage(item.imageUrl)}
                    alt={item.name}
                    className="h-[74px] w-[74px] rounded-md border object-cover bg-white"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800">{item.name}</p>
                    <p className="mt-1 inline-block max-w-full truncate rounded border bg-gray-50 px-2 py-1 text-xs text-gray-600">{item.unit}</p>
                    <p className="mt-1 text-xl font-semibold text-emerald-700">{formatPeso(item.unitPrice)}</p>
                    <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-slate-200/90 bg-[#f8fafc] shadow-none">
            <CardContent className="space-y-2 p-3 md:space-y-2.5 md:p-3.5">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-semibold text-slate-800 md:text-sm">Payment method</Label>
                <p className="text-[9px] font-semibold tracking-[0.08em] text-slate-500 md:text-[10px]">
                  {selectedPaymentMethod.replace(/_/g, ' ')}
                </p>
              </div>
              <div className="grid gap-2">
                {(['COD', 'CARD', 'GCASH', 'MAYA'] as PaymentMethod[]).map((m) => {
                  const label = String(m).replace(/_/g, ' ')
                  const iconSrc =
                    m === 'COD'
                      ? '/icons/payment/cod.svg'
                      : m === 'GCASH'
                        ? '/icons/payment/gcash.svg'
                        : m === 'MAYA'
                          ? '/icons/payment/maya.svg'
                          : '/icons/payment/bank-transfer.svg'

                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={`flex items-center justify-between rounded-xl border px-3 py-1.5 text-[13px] font-medium transition-all md:py-2 md:text-sm ${
                        paymentMethod === m ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50/30'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-md border border-slate-200 bg-white md:h-8 md:w-8">
                          <img src={iconSrc} alt={label} className="h-full w-full object-contain" />
                        </span>
                        <span>{label}</span>
                      </span>
                      <span className={`h-3.5 w-3.5 rounded-full border md:h-4 md:w-4 ${paymentMethod === m ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-white'}`} />
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-slate-200/90 bg-[#f8fafc] shadow-none">
            <CardContent className="space-y-2 p-3 md:space-y-2.5 md:p-3.5">
              <div className="flex items-center justify-between text-[13px] md:text-sm">
                <span className="text-slate-600">Subtotal</span>
                <span className="font-medium text-slate-800">{formatPeso(selectedSubtotal)}</span>
              </div>
              <div className="h-px bg-slate-100" />
              <div className="flex items-center justify-between text-[15px] font-semibold text-slate-900 md:text-base">
                <span>Total ({selectedCartItems.length} item{selectedCartItems.length > 1 ? 's' : ''})</span>
                <span className="text-emerald-600">{formatPeso(selectedSubtotal)}</span>
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
                min={new Date().toISOString().split('T')[0]}
                onChange={e => setDeliveryDate(e.target.value)}
                className="h-10 rounded-xl border-slate-200 bg-white text-[13px] text-slate-700 focus-visible:ring-emerald-500 md:h-11 md:text-sm"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {selectedCartItems.length > 0 ? (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-white px-3 py-2 md:static md:mt-3 md:rounded-b-xl md:border md:border-slate-200">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-500">Total ({selectedCartItems.length} item{selectedCartItems.length > 1 ? 's' : ''})</p>
              <p className="text-2xl font-semibold text-emerald-700">{formatPeso(selectedSubtotal)}</p>
            </div>
            <Button
              className="h-11 rounded-xl bg-rose-500 px-8 text-white hover:bg-rose-600"
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

