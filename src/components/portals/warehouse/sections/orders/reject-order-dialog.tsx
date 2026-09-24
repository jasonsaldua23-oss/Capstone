'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { buildOrderActionReason, OrderReasonCheckboxes, WAREHOUSE_ORDER_REASONS } from '@/components/portals/shared/order-reason-checkboxes'
import type { WarehouseOrderItem } from '../../warehouse-portal-types'

/**
 * Collects rejection reasons before an order is rejected.
 */
export type WarehouseRejectOrderDialogProps = {
  otherRejectReason: string
  rejectOrder: WarehouseOrderItem | null
  selectedRejectReasons: string[]
  setOtherRejectReason: Dispatch<SetStateAction<string>>
  setRejectOrder: Dispatch<SetStateAction<WarehouseOrderItem | null>>
  setSelectedRejectReasons: Dispatch<SetStateAction<string[]>>
  updateWarehouseOrderStatus: (orderId: string, status: 'APPROVED' | 'PREPARING' | 'RESCHEDULED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'REJECTED', reason?: string, deliveryDate?: string) => Promise<boolean>
  updatingOrderId: string | null
}

export function WarehouseRejectOrderDialog({
  otherRejectReason,
  rejectOrder,
  selectedRejectReasons,
  setOtherRejectReason,
  setRejectOrder,
  setSelectedRejectReasons,
  updateWarehouseOrderStatus,
  updatingOrderId,
}: WarehouseRejectOrderDialogProps) {
  return (
    <Dialog open={!!rejectOrder} onOpenChange={(open) => {
      if (!open) {
        setRejectOrder(null)
        setSelectedRejectReasons([])
        setOtherRejectReason('')
      }
    }}>
      <DialogContent>
        {rejectOrder && (
          <>
            <DialogHeader>
              <DialogTitle>Reject Order</DialogTitle>
              <DialogDescription>Please provide a reason for rejecting order {rejectOrder.orderNumber}.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <OrderReasonCheckboxes
                options={WAREHOUSE_ORDER_REASONS}
                selectedReasons={selectedRejectReasons}
                otherReason={otherRejectReason}
                onSelectedReasonsChange={setSelectedRejectReasons}
                onOtherReasonChange={setOtherRejectReason}
                label="Rejection reason (required)"
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setRejectOrder(null); setSelectedRejectReasons([]); setOtherRejectReason('') }}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 bg-red-600 hover:bg-red-700"
                  onClick={async () => {
                    const rejectReason = buildOrderActionReason(selectedRejectReasons, otherRejectReason)
                    if (!rejectReason) {
                      toast.error('Rejection reason is required')
                      return
                    }
                    const orderStatus = String(rejectOrder?.status || '').toUpperCase()
                    const paymentStatus = String(rejectOrder?.paymentStatus || '').toLowerCase()
                    const canReject = paymentStatus === 'pending_approval' || orderStatus === 'PENDING'
                    if (!canReject) {
                      toast.error('Only not-yet-approved orders can be rejected.')
                      return
                    }
                    await updateWarehouseOrderStatus(rejectOrder.id, 'REJECTED', rejectReason)
                    setRejectOrder(null)
                    setSelectedRejectReasons([])
                    setOtherRejectReason('')
                  }}
                  disabled={updatingOrderId === rejectOrder.id || !buildOrderActionReason(selectedRejectReasons, otherRejectReason)}
                >
                  Confirm
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
