'use client'

import { motion } from 'framer-motion'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

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
      <DialogContent className="max-w-[360px] rounded-3xl border border-white/70 bg-white/50 p-4 shadow-[0_22px_56px_rgba(15,23,42,0.24)] backdrop-blur-3xl backdrop-saturate-125 sm:max-w-[540px] sm:p-7">
        <DialogHeader className="text-center">
          <DialogTitle className="text-3xl font-bold leading-none tracking-tight text-slate-900 sm:text-5xl">Add to Cart</DialogTitle>
          <DialogDescription className="pt-1 text-lg text-slate-700 sm:text-[1.75rem]">
            {pendingCartProduct ? `Set quantity for ${pendingCartProduct.name}` : 'Set quantity'}
          </DialogDescription>
        </DialogHeader>
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          className="space-y-4 sm:space-y-5"
        >
          <div className="space-y-2 sm:space-y-3">
            <Label className="text-xl font-semibold text-slate-900 sm:text-2xl">Quantity</Label>
            <div className="flex items-center overflow-hidden rounded-full border border-emerald-100/90 bg-white/95 shadow-[0_8px_20px_rgba(5,150,105,0.12)]">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-12 w-12 rounded-none border-r border-emerald-100 text-emerald-700 transition-all hover:bg-emerald-50 active:scale-95 sm:h-14 sm:w-16"
                onClick={() => adjustPendingCartQty(-1)}
                disabled={!pendingCartProduct || Number(pendingCartQty || 1) <= 1}
                aria-label="Decrease quantity"
              >
                <Minus className="h-5 w-5 sm:h-6 sm:w-6" />
              </Button>
              <div className="flex h-12 flex-1 items-center justify-center text-3xl font-semibold leading-none text-slate-900 sm:h-14 sm:text-4xl">
                {Math.max(1, Math.floor(Number(pendingCartQty || 1) || 1))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-12 w-12 rounded-none border-l border-emerald-100 text-emerald-700 transition-all hover:bg-emerald-50 active:scale-95 sm:h-14 sm:w-16"
                onClick={() => adjustPendingCartQty(1)}
                disabled={
                  !pendingCartProduct ||
                  Number(pendingCartQty || 1) >= (pendingCartProduct ? getAvailableQty(pendingCartProduct) : 1)
                }
                aria-label="Increase quantity"
              >
                <Plus className="h-5 w-5 sm:h-6 sm:w-6" />
              </Button>
            </div>
            <p className="text-base text-emerald-700/70 sm:text-xl">
              Max available: {pendingCartProduct ? getAvailableQty(pendingCartProduct) : 0}
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <Button
              variant="ghost"
              className="h-10 rounded-xl px-4 text-xl font-medium text-slate-700 hover:bg-emerald-50 sm:h-12 sm:px-5 sm:text-2xl"
              onClick={() => {
                setIsAddToCartDialogOpen(false)
                setPendingCartProduct(null)
              }}
            >
              Cancel
            </Button>
            <motion.div whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.02 }}>
              <Button className="h-10 rounded-xl bg-emerald-600 px-5 text-xl font-semibold text-white shadow-[0_10px_24px_rgba(5,150,105,0.34)] transition-all hover:bg-emerald-500 sm:h-12 sm:px-6 sm:text-2xl" onClick={confirmAddToCart}>
                Add to Cart
              </Button>
            </motion.div>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
