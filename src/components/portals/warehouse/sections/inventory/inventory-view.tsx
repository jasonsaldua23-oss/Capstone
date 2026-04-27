'use client'

import { Loader2, Pencil, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Inventory</CardTitle>
              <CardDescription>Warehouse staff can edit product details and add stock by batch.</CardDescription>
            </div>
            <Button onClick={openAddStockDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Add Stock
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingInventory ? (
            <div className="h-64 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
          ) : scopedInventory.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-500">No inventory records found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                    <th className="text-left p-4 font-medium text-gray-600">Product</th>
                    <th className="text-left p-4 font-medium text-gray-600">Unit</th>
                    <th className="text-left p-4 font-medium text-gray-600">Price</th>
                    <th className="text-left p-4 font-medium text-gray-600">Threshold</th>
                    <th className="text-left p-4 font-medium text-gray-600">Available</th>
                    <th className="text-left p-4 font-medium text-gray-600">Location</th>
                    <th className="text-left p-4 font-medium text-gray-600">Status</th>
                    <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedInventory.map((item) => {
                    const status = getStockStatus(item)
                    const availableQty = getAvailableQty(item)
                    return (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-4 font-medium text-gray-900">{item.product?.sku ?? 'N/A'}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
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
                            <div>
                              <p className="font-semibold text-gray-900">{item.product?.name ?? 'N/A'}</p>
                              <p className="text-xs text-gray-500">{item.product?.category?.name || 'General'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 font-medium text-gray-900">{item.product?.unit || 'case'}</td>
                        <td className="p-4 font-medium text-indigo-600">{formatPeso(item.product?.price ?? 0)}</td>
                        <td className="p-4 font-semibold text-gray-900">{item.minStock ?? 0}</td>
                        <td className="p-4 font-semibold text-gray-900">{availableQty}</td>
                        <td className="p-4 text-gray-600">
                          {item.warehouse?.name || item.warehouse?.code || 'N/A'}
                        </td>
                        <td className="p-4">
                          {status === 'healthy' && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Healthy</Badge>}
                          {status === 'restock' && <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Needs Restocking</Badge>}
                        </td>
                        <td className="p-4">
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
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle>Inventory Transactions</CardTitle>
              <CardDescription>All inventory movement records for this warehouse.</CardDescription>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
            <div className="h-40 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
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
