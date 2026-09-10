'use client'

import { Archive, Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import type { WarehouseInventoryViewProps } from '../shared/types'
import { formatLooseQuantity, getBeverageCategorySpec } from '@/lib/beverage-category-specs'
import { getInventoryLooseRemainder } from '@/lib/report-metrics'

export function WarehouseInventoryView({
  openAddStockDialog,
  loadingInventory,
  scopedInventory,
  getStockStatus,
  getAvailableQty,
  formatPeso,
  openEditDialog,
  openRegisterProductDialog,
  openArchivedProductsPage,
}: WarehouseInventoryViewProps) {
  const [inventorySearch, setInventorySearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  // Added: filter choices use only products within the staff member's warehouse scope.
  const sizesFor = (item: any): string[] => Array.isArray(item.product?.sizes)
    ? item.product.sizes.map((size: any) => String(size).trim()).filter(Boolean) : []
  const categoryFor = (item: any) => String(item.product?.category?.name || item.product?.category || '').trim()
  const sizeOptions = Array.from(new Set(scopedInventory.flatMap(sizesFor)))
  const categoryOptions = Array.from(new Set(scopedInventory.map(categoryFor).filter(Boolean)))

  const query = inventorySearch.trim().toLowerCase()
  // Added: search and all filters apply together without sorting or altering stock data.
  const filteredInventory = scopedInventory.filter((item) =>
    [item.id, item.product?.name, item.product?.sku, sizesFor(item).join(' ')].some((value) => String(value || '').toLowerCase().includes(query))
    && (!statusFilter || getStockStatus(item) === statusFilter)
    && (!sizeFilter || sizesFor(item).includes(sizeFilter))
    && (!categoryFilter || categoryFor(item) === categoryFilter)
  )

  const getThresholdValue = (item: any) =>
    Math.max(0, Number(item?.minStock ?? item?.threshold ?? item?.min_stock ?? 0) || 0)
  const getReservedQty = (item: any) => Number(item?.reservedQuantity ?? item?.reserved_quantity ?? 0)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Inventory</CardTitle>
              <CardDescription>Warehouse staff can edit product details and add stock by batch.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={openRegisterProductDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Register Product
              </Button>
              <Button type="button" variant="outline" onClick={openArchivedProductsPage}>
                <Archive className="mr-2 h-4 w-4" />
                Archived Products
              </Button>
              <Button onClick={openAddStockDialog} className="bg-blue-600 text-white hover:bg-blue-700">
                <Plus className="mr-2 h-4 w-4" />
                Add Stock
              </Button>
            </div>
          </div>
        </CardHeader>
        {/* Toolbar: Search and Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center px-6 pb-4">
          <Input aria-label="Search inventory" placeholder="Search inventory…" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} className="h-10 w-full sm:max-w-[280px] text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Filter by stock status" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option><option value="healthy">Healthy</option><option value="overstocked">Overstocked</option><option value="restock">Needs Restocking</option><option value="out_of_stock">Out of Stock</option>
            </select>
            <select aria-label="Filter by size" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={sizeFilter} onChange={(event) => setSizeFilter(event.target.value)}>
              <option value="">All sizes</option>{sizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            <select aria-label="Filter by category" className="h-10 max-w-full rounded-md border border-input bg-background px-3 text-sm" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">All categories</option>{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            {(statusFilter || sizeFilter || categoryFilter) && <Button type="button" variant="ghost" onClick={() => { setStatusFilter(''); setSizeFilter(''); setCategoryFilter('') }}>Clear filters</Button>}
          </div>
        </div>
        <CardContent className="p-0">
        {loadingInventory ? (
          <PortalTableSkeleton rows={6} columns={6} className="border-0 shadow-none" />
        ) : filteredInventory.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-500">No inventory records found</div>
          ) : (
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">SKU</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap min-w-[190px]">Product</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Weight</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Price</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Threshold</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Qty Per Case/Pack</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Loose Quantity</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Available</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Reserved</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Status</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map((item) => {
                    const status = getStockStatus(item)
                    const availableQty = getAvailableQty(item)
                    const reservedQty = getReservedQty(item)
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
                    const looseBottles = getInventoryLooseRemainder(item)
                    const sizes = Array.isArray(item.product?.sizes) ? item.product.sizes.filter(Boolean) : []
                    const sizeLabel = sizes.length > 0 ? sizes.join(', ') : 'No size'
                    const categoryLabel = String(item.product?.category?.name || item.product?.category || '').trim()
                    const looseUnit = item.looseUnit || item.product?.looseUnit || getBeverageCategorySpec(categoryLabel)?.looseUnit || 'Container'
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
                              <p className="text-xs text-gray-500">{sizeLabel} • {looseUnit}</p>
                              {categoryLabel ? <p className="text-[11px] text-gray-400">{categoryLabel}</p> : null}
                            </div>
                          </div>
                        </td>
                        {/* Added: show the product's registered case/order-unit weight in inventory. */}
                        <td className="p-2.5 text-center font-semibold text-gray-900">
                          {typeof item.product?.weight === 'number' && Number.isFinite(item.product.weight) && item.product.weight > 0
                            ? `${item.product.weight.toLocaleString()} kg`
                            : 'N/A'}
                        </td>
                        <td className="p-2.5 text-center font-medium text-indigo-600">{formatPeso(item.product?.price ?? 0)}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{getThresholdValue(item)}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">x{quantityPerCase}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{formatLooseQuantity(looseBottles, looseUnit)}</td>
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
    </div>
  )
}
