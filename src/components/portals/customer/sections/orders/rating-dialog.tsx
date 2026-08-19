'use client'

import { motion } from 'framer-motion'
import { Loader2, Star, CheckCircle2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useMemo, useState } from 'react'

const FEEDBACK_OPTIONS_BY_RATING: Record<number, string[]> = {
  1: ['Missing items', 'Damaged unit', 'Wrong order', 'Poor driver attitude'],
  2: ['Packaging issue', 'Incomplete order', 'Hard to contact driver', 'Item condition problem'],
  3: ['Minor packaging issue', 'Communication could improve', 'Acceptable service', 'Minor inconvenience'],
  4: ['Friendly driver', 'Good unit', 'Accurate order', 'Smooth transaction'],
  5: ['Professional driver', 'Perfect packaging', 'Complete order', 'Great overall experience'],
}

export function CustomerRatingDialog(props: any) {
  const {
    ratingDialogOrder,
    setRatingDialogOrder,
    deliveryRatingValue,
    setDeliveryRatingValue,
    isSubmittingRating,
    submitRating,
  } = props

  const [showSuccess, setShowSuccess] = useState(false)
  const [selectedFeedbackOptions, setSelectedFeedbackOptions] = useState<string[]>([])
  const visibleFeedbackOptions = useMemo(
    () => FEEDBACK_OPTIONS_BY_RATING[Math.max(1, Math.min(5, Math.round(deliveryRatingValue || 0)))] || [],
    [deliveryRatingValue]
  )

  const handleSubmit = async () => {
    const submitted = await submitRating(selectedFeedbackOptions)
    if (!submitted) return
    setShowSuccess(true)
    setTimeout(() => {
      setShowSuccess(false)
      setRatingDialogOrder(null)
    }, 1500)
  }

  const getRatingLabel = (rating: number) => {
    const labels: Record<number, string> = {
      1: 'Poor',
      2: 'Fair',
      3: 'Good',
      4: 'Very Good',
      5: 'Excellent!',
    }
    return labels[rating] || ''
  }

  return (
    <Dialog open={!!ratingDialogOrder} onOpenChange={(open) => !open && setRatingDialogOrder(null)}>
      {ratingDialogOrder && (
        <DialogContent className="w-[95vw] max-h-[86vh] overflow-y-auto max-w-md p-3 md:w-full md:max-h-[92vh] md:p-6">
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="space-y-2.5 md:space-y-4"
          >
            {/* Close button */}
            <button
              onClick={() => setRatingDialogOrder(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600"
              disabled={isSubmittingRating}
            >
              <X className="h-4 w-4 md:h-5 md:w-5" />
            </button>

            {/* Header */}
            <div className="pr-8">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-emerald-100 p-1.5 md:p-2">
                  <Star className="h-4 w-4 text-emerald-600 md:h-5 md:w-5" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-900 md:text-base">Review Order {ratingDialogOrder.orderNumber}</h3>
                  <p className="text-xs text-slate-500">Rate delivery, then leave feedback.</p>
                </div>
              </div>
            </div>

            {/* Rating Section */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-900 md:text-sm">Delivery Rating</Label>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, index) => {
                      const value = index + 1
                      const isActive = value <= deliveryRatingValue
                      return (
                        <button
                          key={`delivery-${value}`}
                          type="button"
                          onClick={() => {
                            setDeliveryRatingValue(value)
                            setSelectedFeedbackOptions([])
                          }}
                          disabled={isSubmittingRating}
                          className={`transition-transform hover:scale-110 ${isActive ? 'text-amber-500' : 'text-gray-300'}`}
                          title={`${value} star${value > 1 ? 's' : ''}`}
                        >
                          <Star className="h-4.5 w-4.5 fill-current md:h-6 md:w-6" />
                        </button>
                      )
                    })}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-amber-500 md:text-lg">{deliveryRatingValue}/5</p>
                    <p className="text-xs text-slate-500">{getRatingLabel(deliveryRatingValue)}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-900 md:text-sm">Select Feedback (Optional)</Label>
              <div className="grid grid-cols-1 gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-2.5">
                {visibleFeedbackOptions.map((option) => {
                  const checked = selectedFeedbackOptions.includes(option)
                  return (
                    <label key={option} className="flex items-start gap-2 text-xs text-slate-700 md:text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                        checked={checked}
                        disabled={isSubmittingRating}
                        onChange={(event) => {
                          const isChecked = event.target.checked
                          setSelectedFeedbackOptions((prev) => {
                            if (isChecked) return [...prev, option]
                            return prev.filter((item) => item !== option)
                          })
                        }}
                      />
                      <span>{option}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Success message */}
            {showSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded-lg bg-emerald-50 p-2.5 text-emerald-700 md:p-3"
              >
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                <p className="text-xs font-medium md:text-sm">Your feedback helps us improve our service</p>
              </motion.div>
            )}

            {/* Buttons */}
            <div className="flex gap-1.5 pt-1.5">
              <Button
                variant="outline"
                onClick={() => setRatingDialogOrder(null)}
                disabled={isSubmittingRating}
                className="h-9 flex-1 text-xs md:h-10 md:text-sm"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleSubmit()}
                disabled={isSubmittingRating || deliveryRatingValue === 0}
                className="h-9 flex-1 bg-emerald-600 text-xs hover:bg-emerald-700 md:h-10 md:text-sm"
              >
                {isSubmittingRating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Submit Review
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        </DialogContent>
      )}
    </Dialog>
  )
}
