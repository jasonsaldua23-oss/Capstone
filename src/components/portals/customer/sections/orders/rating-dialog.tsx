'use client'

import { motion } from 'framer-motion'
import { Loader2, Star, CheckCircle2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMemo, useState } from 'react'
import {
  DELIVERY_FEEDBACK_OPTIONS_BY_RATING as FEEDBACK_OPTIONS_BY_RATING,
  REPLACEMENT_FEEDBACK_OPTIONS_BY_RATING,
  OTHER_REASON_MAX_LENGTH,
  OTHER_FEEDBACK_REASON,
  OTHER_REASON_LABEL,
  OTHER_REASON_PLACEHOLDER,
  getFeedbackOptionsForRating,
  isOtherFeedbackReason,
} from '@shared/customer-logic/feedback-reasons'

export function CustomerRatingDialog(props: any) {
  const {
    ratingDialogOrder,
    setRatingDialogOrder,
    deliveryRatingValue,
    setDeliveryRatingValue,
    isSubmittingRating,
    submitRating,
    otherReasonText,
    setOtherReasonText,
  } = props

  const [showSuccess, setShowSuccess] = useState(false)
  const [selectedFeedbackOptions, setSelectedFeedbackOptions] = useState<string[]>([])
  const isReplacementReview = Boolean(ratingDialogOrder?.isReplacementReview)
  const visibleFeedbackOptions = useMemo(
    () => getFeedbackOptionsForRating(
      isReplacementReview ? REPLACEMENT_FEEDBACK_OPTIONS_BY_RATING : FEEDBACK_OPTIONS_BY_RATING,
      deliveryRatingValue
    ),
    [deliveryRatingValue, isReplacementReview]
  )

  const hasOtherSelected = selectedFeedbackOptions.some(isOtherFeedbackReason)
  const otherText = String(otherReasonText || '')
  // Describing the problem and ticking preset phrases are alternatives: a review that
  // says both cannot be attributed to either, so one disables the other.
  const canSubmitFeedback = hasOtherSelected
    ? otherText.trim().length > 0
    : selectedFeedbackOptions.length > 0

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
        <DialogContent showCloseButton={false} className="w-[95vw] max-h-[86vh] overflow-y-auto max-w-md p-3 md:w-full md:max-h-[92vh] md:p-6">
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="space-y-2.5 md:space-y-4"
          >
            {/* Close button */}
            <button
              type="button"
              aria-label="Close"
              onClick={() => setRatingDialogOrder(null)}
              className="absolute right-4 top-4 text-slate-400 transition-colors hover:text-slate-600 disabled:pointer-events-none disabled:opacity-50"
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
                  <h3 className="text-xs font-semibold text-slate-900 md:text-base">Review {isReplacementReview ? 'Replacement' : 'Order'} {ratingDialogOrder.orderNumber}</h3>
                  <p className="text-xs text-slate-500">Rate {isReplacementReview ? 'replacement handling' : 'delivery'}, then select feedback.</p>
                </div>
              </div>
            </div>

            {/* Rating Section */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-900 md:text-sm">{isReplacementReview ? 'Replacement Handling Rating' : 'Delivery Rating'}</Label>
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
              <Label className="text-xs font-semibold text-slate-900 md:text-sm">Select Feedback <span className="text-red-600">*</span></Label>
              <div className="grid grid-cols-1 gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-2.5">
                {visibleFeedbackOptions.map((option) => {
                  const isOther = isOtherFeedbackReason(option)
                  const checked = selectedFeedbackOptions.includes(option)
                  const blocked = isOther
                    ? selectedFeedbackOptions.length > 0 && !checked
                    : hasOtherSelected
                  return (
                    <label
                      key={option}
                      className={`flex items-start gap-2 text-xs md:text-sm ${blocked ? 'text-slate-400' : 'text-slate-700'}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                        checked={checked}
                        disabled={isSubmittingRating || blocked}
                        onChange={(event) => {
                          const isChecked = event.target.checked
                          setSelectedFeedbackOptions((prev) => {
                            if (!isChecked) return prev.filter((item) => item !== option)
                            // Other stands alone; picking it clears the preset phrases.
                            if (isOther) return [OTHER_FEEDBACK_REASON]
                            return [...prev.filter((item) => !isOtherFeedbackReason(item)), option]
                          })
                          if (isOther && !isChecked) setOtherReasonText?.('')
                        }}
                      />
                      <span className={isOther ? 'font-medium' : undefined}>{option}</span>
                    </label>
                  )
                })}
              </div>

              {hasOtherSelected ? (
                <div className="space-y-1.5">
                  <Label htmlFor="rating-other" className="text-xs font-medium md:text-sm">
                    {OTHER_REASON_LABEL} <span className="text-red-600">*</span>
                  </Label>
                  <Textarea
                    id="rating-other"
                    value={otherText}
                    onChange={(event) => setOtherReasonText?.(event.target.value)}
                    placeholder={OTHER_REASON_PLACEHOLDER}
                    maxLength={OTHER_REASON_MAX_LENGTH}
                    rows={3}
                    disabled={isSubmittingRating}
                    autoFocus
                    className="resize-none text-xs md:text-sm"
                  />
                  <p className="text-right text-[11px] text-gray-400">
                    {otherText.length}/{OTHER_REASON_MAX_LENGTH}
                  </p>
                </div>
              ) : null}

              {!canSubmitFeedback ? (
                <p className="text-xs text-red-600">
                  {hasOtherSelected
                    ? 'Describe what happened to submit your review.'
                    : 'Select at least one feedback option to submit your review.'}
                </p>
              ) : null}
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
                disabled={isSubmittingRating || deliveryRatingValue === 0 || !canSubmitFeedback}
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
