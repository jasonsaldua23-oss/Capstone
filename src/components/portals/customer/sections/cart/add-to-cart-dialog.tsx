'use client'

import { motion } from 'framer-motion'
import { ArrowLeft, Minus, Plus, ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'

export function CustomerAddToCartDialog(props: any) {
  const {
    isAddToCartDialogOpen,
    setIsAddToCartDialogOpen,
    pendingCartProduct,
    setPendingCartProduct,
    pendingCartQty,
    adjustPendingCartQty,
    getAvailableQty,
    confirmAddToCart,
  } = props

  return (
    <Dialog
      open={isAddToCartDialogOpen}
      onOpenChange={(open) => {
        setIsAddToCartDialogOpen(open)
        if (!open) setPendingCartProduct(null)
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-[272px] max-w-[272px] sm:max-w-[272px] rounded-2xl border border-slate-200 bg-white p-0 shadow-[0_20px_48px_rgba(15,23,42,0.25)]"
      >
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          className="space-y-2.5 p-3"
        >
          <div className="flex items-center">
            <button
              type="button"
              className="h-7 w-7 rounded-full text-slate-500 hover:bg-slate-100"
              onClick={() => {
                setIsAddToCartDialogOpen(false)
                setPendingCartProduct(null)
              }}
              aria-label="Back"
            >
              <ArrowLeft className="mx-auto h-3.5 w-3.5" />
            </button>
          </div>

          <div className="rounded-xl bg-slate-50 p-2">
            {pendingCartProduct?.imageUrl ? (
              <img
                src={pendingCartProduct.imageUrl}
                alt={pendingCartProduct?.name || 'Product'}
                className="mx-auto aspect-square w-full rounded-xl object-contain"
              />
            ) : null}
          </div>

          <div className="space-y-0.5">
            <p className="text-[1.9rem] font-bold leading-none text-slate-900">{pendingCartProduct?.name || 'Product'}</p>
            <p className="text-lg font-semibold text-slate-900">
              {new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(pendingCartProduct?.price || 0))}
            </p>
            <p className="text-xs text-slate-500">Available: {pendingCartProduct ? getAvailableQty(pendingCartProduct) : 0}</p>
          </div>

          <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-10 rounded-none text-slate-600 hover:bg-slate-100"
              onClick={() => adjustPendingCartQty(-1)}
              disabled={!pendingCartProduct || Number(pendingCartQty || 1) <= 1}
              aria-label="Decrease quantity"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <div className="flex h-9 flex-1 items-center justify-center text-lg font-semibold text-slate-900">
              {Math.max(1, Math.floor(Number(pendingCartQty || 1) || 1))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-10 rounded-none text-emerald-600 hover:bg-emerald-50"
              onClick={() => adjustPendingCartQty(1)}
              disabled={
                !pendingCartProduct ||
                Number(pendingCartQty || 1) >= (pendingCartProduct ? getAvailableQty(pendingCartProduct) : 1)
              }
              aria-label="Increase quantity"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Button
            className="h-9 w-full rounded-lg bg-sky-600 text-white hover:bg-sky-500"
            onClick={confirmAddToCart}
          >
            <ShoppingCart className="mr-2 h-3.5 w-3.5" />
            Add to Cart
          </Button>

          <div className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
            {pendingCartProduct ? `${pendingCartProduct.name} ready to add` : 'Ready to add'}
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
