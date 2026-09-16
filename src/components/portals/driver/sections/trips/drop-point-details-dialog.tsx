'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DepositRefundRow } from '@/components/shared/empties-charge-note'
import { DropPoint, stripPhilippinesFromAddress } from './trip-detail-helpers'
import { Phone } from 'lucide-react'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { formatCurrency, formatDateTime, getItemDisplayNameWithSize, getOrderQtyWithUnitLabel, getDisplayOrderTotal } from './trip-detail-format'

/**
 * Read-only detail sheet for one drop point.
 */
export type DropPointDetailsDialogProps = {
  selectedDropPointForDetails: DropPoint | null
  setSelectedDropPointForDetails: Dispatch<SetStateAction<DropPoint | null>>
}

export function DropPointDetailsDialog({
  selectedDropPointForDetails,
  setSelectedDropPointForDetails,
}: DropPointDetailsDialogProps) {
  return (
    <Dialog
      open={Boolean(selectedDropPointForDetails)}
      onOpenChange={(open) => {
        if (!open) setSelectedDropPointForDetails(null)
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white p-0 sm:max-w-2xl">
        <DialogHeader>
          <div className="border-b border-slate-200 px-5 pb-3 pt-5">
            <DialogTitle className="text-xl font-black tracking-[-0.02em] text-slate-900">
              {selectedDropPointForDetails?.order?.orderNumber || 'Purchase Order Details'}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-slate-600">
              Customer and purchase order information for this drop point.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="max-h-[calc(100dvh-11rem)] space-y-4 overflow-y-auto px-5 pb-5 pt-4 text-sm">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Customer Details</p>
            <div className="mt-2 space-y-1 text-slate-700">
              <p><span className="font-medium text-slate-900">Name:</span> {selectedDropPointForDetails?.locationName || selectedDropPointForDetails?.contactName || 'Not set'}</p>
              <p><span className="font-medium text-slate-900">Phone:</span> {selectedDropPointForDetails?.contactPhone || 'Not set'}</p>
              <p><span className="font-medium text-slate-900">Address:</span> {stripPhilippinesFromAddress(selectedDropPointForDetails?.address) || 'Not set'}</p>
              <p><span className="font-medium text-slate-900">Coordinates:</span> {selectedDropPointForDetails?.latitude && selectedDropPointForDetails?.longitude ? `${selectedDropPointForDetails.latitude}, ${selectedDropPointForDetails.longitude}` : 'Not set'}</p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Purchase Order</p>
            <div className="mt-2 space-y-1 text-slate-700">
              <p><span className="font-medium text-slate-900">PO Number:</span> {selectedDropPointForDetails?.order?.orderNumber || 'Not set'}</p>
              <p><span className="font-medium text-slate-900">Order Status:</span> {selectedDropPointForDetails?.order?.status || 'Not set'}</p>
              <p><span className="font-medium text-slate-900">Created At:</span> {formatDateTime(selectedDropPointForDetails?.order?.createdAt)}</p>
              <p>
                <span className="font-medium text-slate-900">Total Amount:</span>{' '}
                {(() => {
                  const orderNumberKey = String(selectedDropPointForDetails?.order?.orderNumber || '').trim().toUpperCase()
                  const isReplacementOrder = Boolean((selectedDropPointForDetails?.order as any)?.isScheduledReplacement) || orderNumberKey.startsWith('RPL-')
                  if (isReplacementOrder) {
                    return '₱0.00 (Replacement Delivery • No Collection)'
                  }
                  return formatCurrency(getDisplayOrderTotal(selectedDropPointForDetails?.order))
                })()}
              </p>
              <DepositRefundRow order={selectedDropPointForDetails?.order} className="pt-1 text-xs" />
            </div>

            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2.5">
              <p className="text-xs font-semibold text-slate-700">Ordered Items</p>
              <div className="mt-2 space-y-1.5">
                {(selectedDropPointForDetails?.order?.items || []).length > 0 ? (
                  (selectedDropPointForDetails?.order?.items || []).map((item: any, index: number) => (
                    <div key={`detail-po-item-${index}`} className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
                      <p className="font-medium text-slate-900">{getItemDisplayNameWithSize(item)}</p>
                      {item?.itemType === 'MIXED_CASE' ? (
                        <MixedCaseComponents item={item} showImages={false} compact />
                      ) : null}
                      <p>Quantity: {getOrderQtyWithUnitLabel(item, selectedDropPointForDetails?.order)}</p>
                      <p>Price: {(() => {
                        const isRepl = String(selectedDropPointForDetails?.order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-') || Boolean(selectedDropPointForDetails?.order?.isScheduledReplacement)
                        if (isRepl) return '₱0.00 (Replacement)'
                        return formatCurrency(Number(item?.price || item?.unitPrice || 0))
                      })()}</p>
                      <p>Subtotal: {(() => {
                        const isRepl = String(selectedDropPointForDetails?.order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-') || Boolean(selectedDropPointForDetails?.order?.isScheduledReplacement)
                        if (isRepl) return '₱0.00'
                        return formatCurrency(Number(item?.subtotal || (Number(item?.quantity || 0) * Number(item?.price || item?.unitPrice || 0))))
                      })()}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500">No order items available.</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setSelectedDropPointForDetails(null)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
