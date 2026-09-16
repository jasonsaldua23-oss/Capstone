'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { StockBatchItem } from '../../warehouse-portal-types'
import { getLocalDateInputValue } from '../../warehouse-portal-utils'
import { Loader2 } from 'lucide-react'

/**
 * Edits the quantity and dates of one stock batch.
 */
export type WarehouseEditBatchDialogProps = {
  editBatchExpiryDate: string
  editBatchManufacturedDate: string
  editBatchQuantity: string
  editingBatch: StockBatchItem | null
  isSavingBatchQty: boolean
  saveStockBatchChanges: () => Promise<void>
  setEditBatchExpiryDate: Dispatch<SetStateAction<string>>
  setEditBatchManufacturedDate: Dispatch<SetStateAction<string>>
  setEditBatchQuantity: Dispatch<SetStateAction<string>>
  setEditingBatch: Dispatch<SetStateAction<StockBatchItem | null>>
}

export function WarehouseEditBatchDialog({
  editBatchExpiryDate,
  editBatchManufacturedDate,
  editBatchQuantity,
  editingBatch,
  isSavingBatchQty,
  saveStockBatchChanges,
  setEditBatchExpiryDate,
  setEditBatchManufacturedDate,
  setEditBatchQuantity,
  setEditingBatch,
}: WarehouseEditBatchDialogProps) {
  return (
    <Dialog open={!!editingBatch} onOpenChange={(open) => !open && setEditingBatch(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Stock Batch</DialogTitle>
          <DialogDescription>
            Update the quantity and dates for batch {editingBatch?.batchNumber || ''}. Inventory totals will sync automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="edit-batch-quantity">Quantity</Label>
            <Input
              id="edit-batch-quantity"
              type="number"
              min="0"
              step="1"
              value={editBatchQuantity}
              onChange={(e) => setEditBatchQuantity(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="edit-batch-manufactured-date">Manufactured Date</Label>
              <Input
                id="edit-batch-manufactured-date"
                type="date"
                value={editBatchManufacturedDate}
                onChange={(e) => setEditBatchManufacturedDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-batch-expiry-date">Expiry Date</Label>
              <Input
                id="edit-batch-expiry-date"
                type="date"
                min={getLocalDateInputValue()}
                value={editBatchExpiryDate}
                onChange={(e) => setEditBatchExpiryDate(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button className="flex-1 bg-blue-600 text-white hover:bg-blue-700" onClick={saveStockBatchChanges} disabled={isSavingBatchQty}>
              {isSavingBatchQty ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
