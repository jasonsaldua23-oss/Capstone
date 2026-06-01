'use client'

import { Loader2, Pencil, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import type { WarehouseInventoryViewProps } from '../shared/types'

export function WarehouseInventoryView({
  openAddStockDialog,
  loadingInventory,
  scopedInventory,
  getStockStatus,
  getAvailableQty,
  formatPeso,
  openEditDialog,
  transactionDateFrom,
  setTransactionDateFrom,
  transactionDatePreset,
  setTransactionDatePreset,
  transactionTypeFilter,
  setTransactionTypeFilter,
  availableInventoryTransactionTypes,
  loadingInventoryTransactions,
  filteredInventoryTransactions,
}: WarehouseInventoryViewProps) {
  const getThresholdValue = (item: any) =>
    Math.max(0, Number(item?.minStock ?? item?.threshold ?? item?.min_stock ?? 0) || 0)
  const getReservedQty = (item: any) => Number(item?.reservedQuantity ?? item?.reserved_quantity ?? 0)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Inventory</CardTitle>
              <CardDescription>Warehouse staff can edit product details and add stock by batch.</CardDescription>
            </div>
            <Button onClick={openAddStockDialog} className="bg-blue-600 text-white hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              Add Stock
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
        {loadingInventory ? (
          <PortalTableSkeleton rows={6} columns={6} className="border-0 shadow-none" />
        ) : scopedInventory.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-500">No inventory records found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1060px] text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">SKU</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap min-w-[190px]">Product</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Category</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Price</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Threshold</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Qty Per Case</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Loose Bottles</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Available</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Reserved</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Status</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedInventory.map((item) => {
                    const status = getStockStatus(item)
                    const availableQty = getAvailableQty(item)
                    const reservedQty = getReservedQty(item)
                    const caseQty = Math.max(Number(item.quantity ?? 0), 0)
                    const quantityPerCase = Math.max(
                      Number(
                        item.quantityPerCase ??
                        item.product?.quantityPerCase ??
                        item.product?.quantityPerUnit ??
                        item.product?.quantity_per_unit ??
                        0
                      ),
                      0
                    )
                    const looseBottles = Math.max(Number(item.looseBottles ?? item.loose_bottles ?? 0), 0)
                    const sizes = Array.isArray(item.product?.sizes) ? item.product.sizes.filter(Boolean) : []
                    const sizeLabel = sizes.length > 0 ? sizes.join(', ') : 'No size'
                    return (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-2.5 text-center font-medium text-gray-900">{item.product?.sku ?? 'N/A'}</td>
                        <td className="p-2.5">
                          <div className="flex items-center justify-center gap-3">
                            <img
                              src={item.product?.imageUrl || '/logo.svg'}
                              alt={item.product?.name || 'Product'}
                              className="h-10 w-10 rounded-md object-cover border bg-white"
                              onError={(event) => {
                                const target = event.currentTarget
                                if (target.src.endsWith('/logo.svg')) return
                                target.src = '/logo.svg'
                              }}
                            />
                            <div className="text-center">
                              <p className="font-semibold text-gray-900">{item.product?.name ?? 'N/A'}</p>
                              <p className="text-xs text-gray-500">{sizeLabel} • {item.product?.unit || 'case'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-2.5 text-center text-gray-600">
                          {item.product?.category?.name || item.product?.category || 'N/A'}
                        </td>
                        <td className="p-2.5 text-center font-medium text-indigo-600">{formatPeso(item.product?.price ?? 0)}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{getThresholdValue(item)}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{quantityPerCase}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{looseBottles}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{availableQty}</td>
                        <td className="p-2.5 text-center font-semibold text-orange-600">{reservedQty}</td>
                        <td className="p-2.5 text-center">
                          {status === 'healthy' && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Healthy</Badge>}
                          {status === 'overstocked' && <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Overstocked</Badge>}
                          {status === 'restock' && <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Needs Restocking</Badge>}
                        </td>
                        <td className="p-2.5 text-center">
                          <Button size="icon" variant="ghost" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => openEditDialog(item)}>
                            <Pencil className="h-5 w-5" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-end justify-between gap-3">
            <div>
              <CardTitle>Inventory Transactions</CardTitle>
              <CardDescription>All inventory movement records for this warehouse.</CardDescription>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input
                type="date"
                value={transactionDateFrom}
                onChange={(event) => {
                  setTransactionDateFrom(event.target.value)
                  setTransactionDatePreset('custom')
                }}
                className="h-9"
              />
              <select
                aria-label="Transaction date range preset"
                value={transactionDatePreset}
                onChange={(event) => setTransactionDatePreset(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="custom">Custom range</option>
                <option value="past_7_days">Past 7 days</option>
                <option value="past_14_days">Past 14 days</option>
                <option value="past_1_month">Past 1 month</option>
                <option value="past_3_months">Past 3 months</option>
                <option value="past_6_months">Past 6 months</option>
                <option value="past_1_year">Past 1 year</option>
              </select>
              <select
                aria-label="Transaction type filter"
                value={transactionTypeFilter}
                onChange={(event) => setTransactionTypeFilter(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All types</option>
                {availableInventoryTransactionTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
        {loadingInventoryTransactions ? (
          <PortalTableSkeleton rows={4} columns={5} className="border-0 shadow-none" />
        ) : filteredInventoryTransactions.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-500">No inventory transactions found</div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b sticky top-0 z-10">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">Date</th>
                    <th className="text-left p-4 font-medium text-gray-600">Type</th>
                    <th className="text-left p-4 font-medium text-gray-600">Product</th>
                    <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                    <th className="text-left p-4 font-medium text-gray-600">Qty</th>
                    <th className="text-left p-4 font-medium text-gray-600">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventoryTransactions.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4">{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'N/A'}</td>
                      <td className="p-4">
                        <Badge variant="outline">{String(entry.type || 'N/A').replace(/_/g, ' ')}</Badge>
                      </td>
                      <td className="p-4">{entry.product?.name || 'N/A'}</td>
                      <td className="p-4">{entry.product?.sku || 'N/A'}</td>
                      <td className="p-4 font-semibold">{Number(entry.quantity || 0).toLocaleString()}</td>
                      <td className="p-4 text-gray-600">
                        {entry.referenceType || 'N/A'}
                        {entry.referenceId ? ` #${entry.referenceId}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
