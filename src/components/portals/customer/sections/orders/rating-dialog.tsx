'use client'

import { motion } from 'framer-motion'
import { Loader2, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function CustomerRatingDialog(props: any) {
  const {
    ratingDialogOrder,
    setRatingDialogOrder,
    deliveryRatingValue,
    setDeliveryRatingValue,
    ratingComment,
    setRatingComment,
    isSubmittingRating,
    submitRating,
  } = props

  return (
    <Dialog open={!!ratingDialogOrder} onOpenChange={(open) => !open && setRatingDialogOrder(null)}>
      {ratingDialogOrder && (
        <DialogContent>
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <DialogHeader>
              <DialogTitle>Review Order {ratingDialogOrder.orderNumber}</DialogTitle>
              <DialogDescription>Rate delivery, then leave feedback.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Delivery Rating</Label>
                <div className="flex items-center gap-1 text-amber-500">
                  {Array.from({ length: 5 }).map((_, index) => {
                    const value = index + 1
                    const isActive = value <= deliveryRatingValue
                    return (
                      <button
                        key={`delivery-${value}`}
                        type="button"
                        onClick={() => setDeliveryRatingValue(value)}
                        className={`rounded p-1 ${isActive ? 'text-amber-500' : 'text-gray-300'}`}
                        title={`${value} star${value > 1 ? 's' : ''}`}
                      >
                        <Star className="h-6 w-6 fill-current" />
                      </button>
                    )
                  })}
                  <span className="ml-2 text-sm font-medium text-slate-700">{deliveryRatingValue}/5</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rating-message">Feedback</Label>
                <Textarea
                  id="rating-message"
                  placeholder="Add your comment..."
                  value={ratingComment}
                  onChange={(e) => setRatingComment(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => setRatingDialogOrder(null)} disabled={isSubmittingRating}>
                  Cancel
                </Button>
                <Button onClick={() => void submitRating()} disabled={isSubmittingRating}>
                  {isSubmittingRating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Submit Review
                </Button>
              </div>
            </div>
          </motion.div>
        </DialogContent>
      )}
    </Dialog>
  )
}
