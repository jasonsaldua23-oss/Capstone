'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ProductOption, WarehouseItem } from '../../warehouse-portal-types'
import { getLocalDateInputValue } from '../../warehouse-portal-utils'
import { Warehouse, Loader2, Plus, Trash2 } from 'lucide-react'
import type { WarehouseStockIn } from './use-warehouse-stock-in'

/**
 * Bulk stock-in form: product rows with validation, CSV import, and submission.
 */
export type WarehouseAddStockDialogProps = {
  addStockInBatch: WarehouseStockIn['addStockInBatch']
  addStockOpen: WarehouseStockIn['addStockOpen']
  addStockRow: WarehouseStockIn['addStockRow']
  assignedWarehouse: WarehouseItem | null
  availableExistingProducts: WarehouseStockIn['availableExistingProducts']
  isSubmittingStockIn: WarehouseStockIn['isSubmittingStockIn']
  isWarehouseScopedUser: boolean
  products: ProductOption[]
  removeStockRow: WarehouseStockIn['removeStockRow']
  resetStockInForm: WarehouseStockIn['resetStockInForm']
  setAddStockOpen: WarehouseStockIn['setAddStockOpen']
  setStockInWarehouseId: Dispatch<SetStateAction<string>>
  stockInWarehouseId: string
  stockRows: WarehouseStockIn['stockRows']
  updateStockRow: WarehouseStockIn['updateStockRow']
  warehouses: WarehouseItem[]
}

export function WarehouseAddStockDialog({
  addStockInBatch,
  addStockOpen,
  addStockRow,
  assignedWarehouse,
  availableExistingProducts,
  isSubmittingStockIn,
  isWarehouseScopedUser,
  products,
  removeStockRow,
  resetStockInForm,
  setAddStockOpen,
  setStockInWarehouseId,
  stockInWarehouseId,
  stockRows,
  updateStockRow,
  warehouses,
}: WarehouseAddStockDialogProps) {
  return (
    <Dialog
      open={addStockOpen}
      onOpenChange={(open) => {
        setAddStockOpen(open)
        if (open) {
          if (isWarehouseScopedUser && assignedWarehouse?.id) {
            setStockInWarehouseId(assignedWarehouse.id)
          } else if (!stockInWarehouseId && warehouses[0]?.id) {
            setStockInWarehouseId(warehouses[0].id)
          }
          return
        }
        resetStockInForm()
      }}
    >
      <DialogContent className="flex h-[86vh] w-[95vw] max-w-[800px] flex-col overflow-hidden p-3 sm:max-w-[800px] sm:p-6">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-3xl font-bold">Add Stock</DialogTitle>
          <DialogDescription className="text-lg mt-2">Add multiple stock entries by batch</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 pr-1">
          {!(isWarehouseScopedUser && assignedWarehouse?.id) ? (
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse</label>
              <select
                id="stock-warehouse"
                title="Select Warehouse"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={stockInWarehouseId}
                onChange={(e) => setStockInWarehouseId(e.target.value)}
              >
                <option value="">Select warehouse</option>
                {warehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>{wh.name} ({wh.code})</option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Stock Rows Table */}
          <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-md border">
            <div className="min-w-[700px]">
              {/* Sticky Header */}
              <div className="sticky top-0 z-20 grid grid-cols-[minmax(160px,1.7fr)_minmax(72px,0.65fr)_minmax(120px,0.95fr)_minmax(120px,0.95fr)_24px] gap-1.5 border-b bg-gray-100 px-2.5 py-3 text-sm font-semibold text-gray-700">
                <div className="px-2.5">Product</div>
                <div className="px-2.5">Quantity</div>
                <div className="px-2.5">Manufactured Date</div>
                <div className="px-2.5">Expiry Date</div>
                <div></div>
              </div>

              {/* Rows */}
              <div className="max-h-[50vh] overflow-y-auto">
              {stockRows.map((row, idx) => (
                <div key={row.id} className="grid grid-cols-[minmax(160px,1.7fr)_minmax(72px,0.65fr)_minmax(120px,0.95fr)_minmax(120px,0.95fr)_24px] items-start gap-1.5 border-b bg-white px-2.5 py-3 transition hover:bg-gray-50">
                  {/* Product Select */}
                  <div className="min-w-0 space-y-1">
                    {(() => {
                      const selectedProductMeta = availableExistingProducts.find((p) => p.id === row.productId)
                      const statusToneClass =
                        selectedProductMeta?.inventoryStatus === 'overstocked' ? 'text-blue-700' :
                        selectedProductMeta?.inventoryStatus === 'critical' || selectedProductMeta?.inventoryStatus === 'out_of_stock' ? 'text-red-700' :
                        selectedProductMeta?.inventoryStatus === 'low' ? 'text-amber-700' :
                        'text-slate-900'
                      const statusLabel =
                        selectedProductMeta?.inventoryStatus === 'overstocked' ? 'Overstocked' :
                        selectedProductMeta?.inventoryStatus === 'critical' ? 'Critical' :
                        selectedProductMeta?.inventoryStatus === 'out_of_stock' ? 'Out of Stock' :
                        selectedProductMeta?.inventoryStatus === 'low' ? 'Low' :
                        selectedProductMeta?.inventoryStatus === 'healthy' ? 'Healthy' :
                        ''
                      return (
                    <>
                    <select
                      title="Select Product"
                      className={`h-10 min-w-0 w-full rounded-md border px-2 py-1.5 text-sm font-medium ${statusToneClass} ${row.validationErrors.productId ? 'border-red-500 bg-red-50' : 'border-input bg-white'}`}
                      value={row.productId}
                      onChange={(e) => updateStockRow(row.id, 'productId', e.target.value)}
                    >
                      <option value="">Select product</option>
                      {availableExistingProducts.map((product) => {
                        const selectedInAnotherRow = stockRows.some(
                          (r) => r.id !== row.id && r.productId === product.id
                        )
                        const sizeString = product.sizes && product.sizes.length > 0
                          ? ` (${product.sizes.join(', ')})`
                          : ''
                        const categoryLabel = String((product as any)?.category?.name || (product as any)?.category || '').trim()
                        return (
                          <option key={product.id} value={product.id} disabled={selectedInAnotherRow || Boolean(product.isOverstocked)}>
                            {/* Added: place the SKU before the name so products are easier to identify while adding stock. */}
                            {product.sku ? `${product.sku} - ` : ''}{product.name}{sizeString}{categoryLabel ? ` - ${categoryLabel}` : ''}{product.isOverstocked ? ' (Overstocked - blocked)' : ''}
                          </option>
                        )
                      })}
                    </select>
                    {statusLabel ? (
                      <p className={`px-0.5 text-[11px] font-semibold ${statusToneClass}`}>
                        {statusLabel}
                      </p>
                    ) : null}
                    </>
                      )
                    })()}
                    {row.validationErrors.productId && (
                      <p className="text-xs text-red-600">{row.validationErrors.productId}</p>
                    )}
                    {!row.validationErrors.productId && availableExistingProducts.some((p) => p.isOverstocked) && (
                      <p className="text-xs text-amber-700">
                        Some products are blocked: overstocked (latest stock-in reached at least 10x threshold).
                      </p>
                    )}
                  </div>

                  {/* Quantity Input */}
                  <div className="min-w-0 space-y-1">
                    <Input
                      id={`qty-${row.id}`}
                      type="number"
                      placeholder="0"
                      className={`h-10 min-w-0 text-sm px-2 ${row.validationErrors.quantity ? 'border-red-500 bg-red-50' : ''}`}
                      value={row.quantity}
                      onChange={(e) => updateStockRow(row.id, 'quantity', e.target.value)}
                    />
                    {row.validationErrors.quantity && (
                      <p className="text-xs text-red-600">{row.validationErrors.quantity}</p>
                    )}
                  </div>

                  {/* Manufactured Date Input */}
                  <div className="min-w-0 space-y-1">
                    <Input
                      id={`mfg-${row.id}`}
                      type="date"
                      className={`h-10 min-w-0 text-sm px-2 ${row.validationErrors.manufacturedDate ? 'border-red-500 bg-red-50' : ''}`}
                      value={row.manufacturedDate}
                      onChange={(e) => updateStockRow(row.id, 'manufacturedDate', e.target.value)}
                    />
                    {row.validationErrors.manufacturedDate && (
                      <p className="text-xs text-red-600">{row.validationErrors.manufacturedDate}</p>
                    )}
                  </div>

                  {/* Expiry Date Input */}
                  <div className="min-w-0 space-y-1">
                    <Input
                      id={`expiry-${row.id}`}
                      type="date"
                      min={getLocalDateInputValue()}
                      className={`h-10 min-w-0 text-sm px-2 ${row.validationErrors.expiryDate ? 'border-red-500 bg-red-50' : ''}`}
                      value={row.expiryDate}
                      onChange={(e) => updateStockRow(row.id, 'expiryDate', e.target.value)}
                    />
                    {row.validationErrors.expiryDate && (
                      <p className="text-xs text-red-600">{row.validationErrors.expiryDate}</p>
                    )}
                  </div>

                  {/* Remove Button */}
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`mt-0.5 h-10 w-7 ${stockRows.length === 1 ? 'cursor-not-allowed text-gray-400 opacity-50' : 'text-red-600 hover:bg-red-50 hover:text-red-700'}`}
                    onClick={() => removeStockRow(row.id)}
                    disabled={stockRows.length === 1}
                    title={stockRows.length === 1 ? 'Cannot remove last row' : 'Remove row'}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              </div>
            </div>
          </div>

          </div>
          {/* Bottom Actions */}
          <div className="mt-3 shrink-0 space-y-3 border-t bg-white pt-3">
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed text-xs py-2"
              onClick={addStockRow}
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              Add Row
            </Button>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 text-base py-3"
                onClick={() => setAddStockOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 text-white hover:bg-blue-700 text-base py-3"
                onClick={addStockInBatch}
                disabled={isSubmittingStockIn}
              >
                {isSubmittingStockIn ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : null}
                Add Stock ({stockRows.length} {stockRows.length === 1 ? 'item' : 'items'})
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
