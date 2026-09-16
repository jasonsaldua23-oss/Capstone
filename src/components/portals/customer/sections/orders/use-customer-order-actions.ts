import { useCallback } from 'react'
import { emitDataSync } from '@/lib/data-sync'
import { toast } from 'sonner'
import { buildOrderActionReason } from '@/components/portals/shared/order-reason-checkboxes'
import { cancelCustomerReplacementRequest, cancelCustomerOrder, submitCustomerReplacementRequest, uploadReplacementEvidence } from './orders-api'
import { submitOrderFeedback } from '../feedback/feedback-api'
import type { DeliveryIssueRecord, Order } from '../shared/customer-types'
import type { Dispatch, SetStateAction } from 'react'
import type { CustomerPortalState } from '../layout/portal-state'
import type { AuthUser } from '@/types'

/**
 * Actions a customer takes on an order after checkout: replacement requests, cancellations (order and replacement), delivery ratings, and tracking navigation.
 */
export type CustomerOrderActionsInputs = {
  deliveryRatingValue: CustomerPortalState['deliveryRatingValue']
  fetchOrderMeta: () => Promise<void>
  notes: CustomerPortalState['notes']
  orders: CustomerPortalState['orders']
  otherCancellationReason: string
  pendingCancelOrder: { id: string; orderNumber: string } | null
  pendingCancelReplacement: { id: string; replacementNumber: string } | null
  ratingDialogOrder: CustomerPortalState['ratingDialogOrder']
  reviewedOrderIds: CustomerPortalState['reviewedOrderIds']
  selectedCancellationReasons: string[]
  selectedOrder: CustomerPortalState['selectedOrder']
  setActiveView: CustomerPortalState['setActiveView']
  setDeliveryIssueRecords: CustomerPortalState['setDeliveryIssueRecords']
  setDeliveryRatingValue: CustomerPortalState['setDeliveryRatingValue']
  setIsCancellingOrder: Dispatch<SetStateAction<boolean>>
  setIsCancellingReplacement: Dispatch<SetStateAction<boolean>>
  setIsSubmittingRating: CustomerPortalState['setIsSubmittingRating']
  setOrders: CustomerPortalState['setOrders']
  setOtherCancellationReason: Dispatch<SetStateAction<string>>
  setPendingCancelOrder: Dispatch<SetStateAction<{ id: string; orderNumber: string } | null>>
  setPendingCancelReplacement: Dispatch<SetStateAction<{ id: string; replacementNumber: string } | null>>
  setRatingComment: CustomerPortalState['setRatingComment']
  setRatingDialogOrder: CustomerPortalState['setRatingDialogOrder']
  setReviewDetailsOrder: Dispatch<SetStateAction<Order | null>>
  setReviewedOrderIds: CustomerPortalState['setReviewedOrderIds']
  setSelectedCancellationReasons: Dispatch<SetStateAction<string[]>>
  setSelectedOrder: CustomerPortalState['setSelectedOrder']
  setSelectedTrackingOrderId: CustomerPortalState['setSelectedTrackingOrderId']
}

export function useCustomerOrderActions(inputs: CustomerOrderActionsInputs) {
  const {
    deliveryRatingValue,
    fetchOrderMeta,
    notes,
    orders,
    otherCancellationReason,
    pendingCancelOrder,
    pendingCancelReplacement,
    ratingDialogOrder,
    reviewedOrderIds,
    selectedCancellationReasons,
    selectedOrder,
    setActiveView,
    setDeliveryIssueRecords,
    setDeliveryRatingValue,
    setIsCancellingOrder,
    setIsCancellingReplacement,
    setIsSubmittingRating,
    setOrders,
    setOtherCancellationReason,
    setPendingCancelOrder,
    setPendingCancelReplacement,
    setRatingComment,
    setRatingDialogOrder,
    setReviewDetailsOrder,
    setReviewedOrderIds,
    setSelectedCancellationReasons,
    setSelectedOrder,
    setSelectedTrackingOrderId,
  } = inputs

  const submitReplacementRequest = useCallback(async (
    orderId: string,
    numberDamagedItems: number,
    damageType: string,
    description: string,
    files: File[],
    replacementLines?: Array<{
      originalOrderItemId: string
      originalProductId?: string
      replacementProductId?: string
      originalProductName?: string
      originalProductSku?: string
      originalProductSize?: string
      replacementProductName?: string
      replacementProductSku?: string
      replacementProductSize?: string
      inputMode?: 'case' | 'bottle'
      lineInputMode?: 'case' | 'bottle'
      quantityPerCase?: number
      qtyPerUnit?: number
      quantityToReplace: number
      quantityToReplaceCases?: number
      quantityToReplaceUnits?: number
      quantityToReplaceBottles?: number
      reason: string
      description?: string
    }>,
    customerNotes = '',
  ) => {
    if (!damageType.trim()) throw new Error('Reason / type of damage is required')
    if (!files.length) throw new Error('At least one evidence file is required')
    const uploaded: string[] = []
    for (const file of files) {
      const { response, data } = await uploadReplacementEvidence(file)
      if (!response.ok || data?.success === false || !data?.fileUrl) {
        throw new Error(data?.error || 'Failed to upload replacement evidence')
      }
      uploaded.push(String(data.fileUrl))
    }
    const { response, data } = await submitCustomerReplacementRequest({
      orderId,
      numberDamagedItems: Math.floor(numberDamagedItems),
      damageType: damageType.trim(),
      description: description.trim(),
      notes: customerNotes.trim(),
      evidence: uploaded,
      replacementLines,
    })
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || 'Failed to submit replacement request')
    }
    await fetchOrderMeta()
    emitDataSync(['replacements'])
    toast.success('Replacement request submitted')
  }, [fetchOrderMeta])

  const requestCancelReplacement = useCallback((replacement: DeliveryIssueRecord) => {
    const replacementId = String(replacement?.id || '').trim()
    if (!replacementId) {
      toast.error('Unable to identify this replacement request')
      return
    }
    setPendingCancelReplacement({
      id: replacementId,
      replacementNumber: String(replacement?.replacementNumber || 'this replacement request'),
    })
  }, [])

  const confirmCancelReplacement = useCallback(async () => {
    const replacementId = pendingCancelReplacement?.id
    if (!replacementId) return
    setIsCancellingReplacement(true)
    try {
      const { response, data } = await cancelCustomerReplacementRequest(replacementId)
      if (!response.ok || data?.success === false) {
        if (response.status === 409) {
          // Fix: refresh immediately if admin moved the request to Under Review first.
          await fetchOrderMeta()
          setPendingCancelReplacement(null)
        }
        throw new Error(data?.error || 'Failed to cancel replacement request')
      }
      const cancelled = data?.replacement as DeliveryIssueRecord | undefined
      if (cancelled?.id) {
        setDeliveryIssueRecords((previous) =>
          previous.map((record) => (record.id === cancelled.id ? { ...record, ...cancelled } : record))
        )
      }
      await fetchOrderMeta()
      emitDataSync(['replacements'])
      toast.success('Replacement request cancelled')
      setPendingCancelReplacement(null)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to cancel replacement request')
    } finally {
      setIsCancellingReplacement(false)
    }
  }, [fetchOrderMeta, pendingCancelReplacement?.id])
  const openTrackView = (orderId: string) => {
    setSelectedTrackingOrderId(orderId)
    setActiveView('track')
  }

  const openRatingDialog = (order: Order, initialDeliveryRating = 5) => {
    if (reviewedOrderIds.has(order.id)) {
      setReviewDetailsOrder(order)
      return
    }
    setRatingDialogOrder(order)
    setDeliveryRatingValue(Math.max(1, Math.min(5, Math.round(initialDeliveryRating))))
    setRatingComment('')
  }
  const submitRating = async (selectedFeedbackOptions: string[] = []) => {
    if (!ratingDialogOrder?.id) return false
    if (deliveryRatingValue === 0) {
      toast.error('Please select a rating')
      return false
    }
    const selectedReasons = Array.from(
      new Set(
        selectedFeedbackOptions
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    )
    // Added: a star rating cannot be submitted without meaningful feedback.
    if (selectedReasons.length === 0) {
      toast.error('Please select at least one feedback option')
      return false
    }
    if (reviewedOrderIds.has(ratingDialogOrder.id)) {
      toast.info('You already rated this order')
      setRatingDialogOrder(null)
      return false
    }

    setIsSubmittingRating(true)
    try {
      const overallRating = Math.max(1, Math.min(5, Math.round(deliveryRatingValue)))
      const composedMessage = selectedReasons.map((reason) => `- ${reason}`).join('\n')
      const { response, payload } = await submitOrderFeedback({
        orderId: ratingDialogOrder.id,
        rating: overallRating,
        type: overallRating <= 2 ? 'COMPLAINT' : overallRating === 3 ? 'SUGGESTION' : 'COMPLIMENT',
        subject: `${ratingDialogOrder?.isReplacementReview ? 'Replacement Review' : 'Order Review'} - ${ratingDialogOrder.orderNumber}`,
        message: composedMessage,
      })
      if (response.status === 409) {
        setReviewedOrderIds((prev) => {
          const next = new Set(prev)
          next.add(ratingDialogOrder.id)
          return next
        })
        void fetchOrderMeta()
        toast.info('This order is already rated')
        setRatingDialogOrder(null)
        setRatingComment('')
        setDeliveryRatingValue(5)
        return true
      }

      if (!response.ok || payload?.success === false) {
        const backendMessage = String(payload?.error || payload?.message || '').trim()
        const statusHint = response?.status ? ` (${response.status})` : ''
        throw new Error((backendMessage || 'Failed to submit rating') + statusHint)
      }

      setReviewedOrderIds((prev) => {
        const next = new Set(prev)
        next.add(ratingDialogOrder.id)
        return next
      })
      void fetchOrderMeta()
      toast.success('Review submitted successfully')
      setRatingDialogOrder(null)
      setRatingComment('')
      setDeliveryRatingValue(5)
      return true
    } catch (error: any) {
      toast.error(error?.message || 'Failed to submit rating')
      return false
    } finally {
      setIsSubmittingRating(false)
    }
  }

  const requestCancelOrder = (orderId: string) => {
    const source = orders.find((item) => item.id === orderId) || (selectedOrder?.id === orderId ? selectedOrder : null)
    const orderNumber = String(source?.orderNumber || 'this order')
    setSelectedCancellationReasons([])
    setOtherCancellationReason('')
    setPendingCancelOrder({ id: orderId, orderNumber })
  }

  const confirmCancelOrder = async () => {
    const orderId = pendingCancelOrder?.id
    if (!orderId) return
    const reason = buildOrderActionReason(selectedCancellationReasons, otherCancellationReason)
    // Required: do not send a cancellation without an explanation.
    if (!reason) {
      toast.error('A cancellation reason is required')
      return
    }
    setIsCancellingOrder(true)
    try {
      const { response, payload } = await cancelCustomerOrder(orderId, reason)
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to cancel order')
      }
      const updatedOrder = payload?.order || { id: orderId, status: 'CANCELLED', paymentStatus: 'cancelled' }
      setOrders((prev) =>
        prev.map((order) => (order.id === orderId ? { ...order, ...updatedOrder, status: 'CANCELLED', paymentStatus: 'cancelled' } : order))
      )
      setSelectedOrder((prev) =>
        prev?.id === orderId ? { ...prev, ...updatedOrder, status: 'CANCELLED', paymentStatus: 'cancelled' } : prev
      )
      toast.success('Order cancelled successfully')
      // Refresh once in background via shared sync channel.
      emitDataSync(['orders'])
      setPendingCancelOrder(null)
      setSelectedCancellationReasons([])
      setOtherCancellationReason('')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to cancel order')
    } finally {
      setIsCancellingOrder(false)
    }
  }

  return {
    confirmCancelOrder,
    confirmCancelReplacement,
    openRatingDialog,
    openTrackView,
    requestCancelOrder,
    requestCancelReplacement,
    submitRating,
    submitReplacementRequest,
  }
}
