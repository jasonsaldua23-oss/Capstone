'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import { Archive, ArrowLeft, Download, Loader2, RotateCcw } from 'lucide-react'
import { getCollection, getWarehouseIdFromRow, formatPeso, safeFetchJson } from './shared'
import {
  getInventoryAlertLevel,
  getInventoryAvailableQty,
  getInventoryLooseRemainder,
  getInventoryReservedBaseUnits,
  getInventoryUnitsPerCase,
} from '@/lib/report-metrics'
import { formatLooseQuantity, getBeverageCategorySpec } from '@/lib/beverage-category-specs'
import {
  ADMIN_INVENTORY_CACHE_KEY,
  PORTAL_CACHE_TTL_MS,
  invalidateInventoryStockCaches,
  isPortalCacheFresh,
  readPortalCache,
  writePortalCache,
} from '@/lib/portal-data-cache'

export function InventoryView() {
  const [inventorySearch, setInventorySearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [inventory, setInventory] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('all')
  const [products, setProducts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showArchivedProducts, setShowArchivedProducts] = useState(false)
  const [archivedProducts, setArchivedProducts] = useState<any[]>([])
  const [archivedSearch, setArchivedSearch] = useState('')
  const [loadingArchivedProducts, setLoadingArchivedProducts] = useState(false)
  const [restoringProductId, setRestoringProductId] = useState<string | null>(null)
  const cacheAtRef = useRef(0)
  const refreshInFlightRef = useRef<Promise<void> | null>(null)

  const fetchInventory = async (showLoading = true): Promise<any[] | null> => {
    if (showLoading) setIsLoading(true)
    try {
      const result = await safeFetchJson('/api/inventory?page=1&pageSize=1000', { cache: 'no-store' })
      if (!result.ok) {
        return null
      }
      const list = getCollection<any>(result.data, ['inventory'])
      setInventory(list)
      return list
    } catch (error) {
      console.error(error)
      return null
    } finally {
      if (showLoading) setIsLoading(false)
    }
  }

  const fetchWarehouses = async (): Promise<any[] | null> => {
    try {
      const result = await safeFetchJson('/api/warehouses?page=1&pageSize=200', { cache: 'no-store' })
      if (!result.ok) {
        return null
      }
      const list = getCollection<any>(result.data, ['warehouses'])
      const activeWarehouses = list.filter((warehouse) => warehouse?.isActive !== false)
      setWarehouses(activeWarehouses)
      if (selectedWarehouseId !== 'all' && !activeWarehouses.some((warehouse) => warehouse?.id === selectedWarehouseId)) {
        setSelectedWarehouseId('all')
      }
      return activeWarehouses
    } catch (error) {
      console.error(error)
      return null
    }
  }

  const fetchProducts = async (): Promise<any[] | null> => {
    try {
      const result = await safeFetchJson('/api/products?page=1&pageSize=500', { cache: 'no-store' })
      if (!result.ok) {
        return null
      }
      const list = getCollection<any>(result.data, ['products'])
      setProducts(list)
      return list
    } catch (error) {
      console.error(error)
      return null
    }
  }

  useEffect(() => {
    const refreshSharedData = (showLoading = false) => {
      if (refreshInFlightRef.current) return refreshInFlightRef.current
      const refresh = (async () => {
        const [nextInventory, nextWarehouses, nextProducts] = await Promise.all([
          fetchInventory(showLoading),
          fetchWarehouses(),
          fetchProducts(),
        ])
        if (nextInventory && nextWarehouses && nextProducts) {
          writePortalCache(ADMIN_INVENTORY_CACHE_KEY, {
            inventory: nextInventory,
            warehouses: nextWarehouses,
            products: nextProducts,
          })
          cacheAtRef.current = Date.now()
        }
      })().finally(() => {
        refreshInFlightRef.current = null
      })
      refreshInFlightRef.current = refresh
      return refresh
    }

    const cached = readPortalCache<{ inventory: any[]; warehouses: any[]; products: any[] }>(ADMIN_INVENTORY_CACHE_KEY)
    if (cached) {
      setInventory(Array.isArray(cached.data.inventory) ? cached.data.inventory : [])
      setWarehouses(Array.isArray(cached.data.warehouses) ? cached.data.warehouses : [])
      setProducts(Array.isArray(cached.data.products) ? cached.data.products : [])
      setIsLoading(false)
      cacheAtRef.current = cached.cachedAt
    }
    if (!isPortalCacheFresh(cached)) {
      void refreshSharedData(!cached)
    }

    const unsubscribe = subscribeDataSync((message) => {
      const shouldRefresh = message.scopes.some((scope) =>
        ['inventory', 'products', 'stock-batches', 'warehouses'].includes(scope)
      )
      if (shouldRefresh) {
        invalidateInventoryStockCaches()
        void refreshSharedData(false)
      }
    })

    const refreshIfStale = () => {
      if (Date.now() - cacheAtRef.current >= PORTAL_CACHE_TTL_MS) {
        void refreshSharedData(false)
      }
    }
    const onFocus = () => refreshIfStale()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshIfStale()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const getReservedQty = (item: any) => Number(item.reservedQuantity ?? item.reserved_quantity ?? 0)
  const getAvailableQty = (item: any) => getInventoryAvailableQty(item)
  const getReservedBaseQty = (item: any) => getInventoryReservedBaseUnits(item)
  const getQuantityPerCase = (item: any) => getInventoryUnitsPerCase(item)
  const getBaseUnitLabel = (item: any) => String(
    item?.product?.looseUnit ||
    getBeverageCategorySpec(item?.product?.category)?.looseUnit ||
    'unit'
  ).trim() || 'unit'
  const getOrderFormatLabel = (item: any, quantity: number) => {
    const unit = String(item?.product?.unit || item?.productUnit || item?.product_unit || 'case').trim().toLowerCase() || 'case'
    // Use the product's actual ordering format instead of labeling every row as a case.
    return `${unit}${quantity === 1 ? '' : 's'}`
  }
  const getThreshold = (item: any) => Number(item.threshold ?? item.minStock ?? item.min_stock ?? 0)
  const getStockStatus = (item: any) => {
    const level = getInventoryAlertLevel(item)
    // Fix: keep zero available stock distinct from positive stock that needs restocking.
    if (level === 'out_of_stock') return 'out_of_stock'
    if (level === 'overstocked') return 'overstocked'
    return level === 'healthy' ? 'healthy' : 'restock'
  }
  // Added: derive filter options from actual inventory, including multi-size products.
  const filterOptions = useMemo(() => ({
    sizes: Array.from(new Set<string>(inventory.flatMap((item) =>
      Array.isArray(item.product?.sizes) ? item.product.sizes.map((size: any) => String(size).trim()).filter(Boolean) : []
    ))),
    categories: Array.from(new Set<string>(inventory.map((item) =>
      String(item.product?.category?.name || item.product?.category || '').trim()
    ).filter(Boolean))),
  }), [inventory])

  const filteredInventory = useMemo(() => {
    // Added: combine search and filters without reordering or changing stock data.
    const query = inventorySearch.trim().toLowerCase()
    return inventory.filter((item) => {
      const sizes = Array.isArray(item.product?.sizes) ? item.product.sizes.map((size: any) => String(size).trim()) : []
      const category = String(item.product?.category?.name || item.product?.category || '').trim()
      const level = getInventoryAlertLevel(item)
      const status = level === 'out_of_stock'
        ? 'out_of_stock'
        : level === 'overstocked' ? 'overstocked' : level === 'healthy' ? 'healthy' : 'restock'
      return [item.id, item.product?.name, item.product?.sku, sizes.join(' ')].some((value) => String(value || '').toLowerCase().includes(query))
        && (!statusFilter || status === statusFilter)
        && (!sizeFilter || sizes.includes(sizeFilter))
        && (!categoryFilter || category === categoryFilter)
    })
  }, [inventory, inventorySearch, statusFilter, sizeFilter, categoryFilter])

  const exportInventoryCsv = () => {
    if (filteredInventory.length === 0) {
      toast.error('No inventory records to export')
      return
    }

    const escapeCsv = (value: any) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const headers = [
      'SKU',
      'Product',
      'Category',
      'Unit',
      'Sizes',
      'Weight (kg)',
      'Price',
      'Threshold',
      'Qty Per Case/Pack',
      'Loose Base Units',
      'Available Order Units',
      'Reserved Order Units',
      'Reserved Base Units',
      'Base Unit Label',
      'Warehouse',
      'Status',
    ]

    const rows = filteredInventory.map((item) => {
      const status = getStockStatus(item)
      const sizes = Array.isArray(item.product?.sizes) && item.product.sizes.length > 0
        ? item.product.sizes.map((size: any) => String(size).trim()).filter(Boolean).join(', ')
        : 'N/A'
      return [
        item.product?.sku ?? '',
        item.product?.name ?? '',
        String(item.product?.category?.name || item.product?.category || '').trim(),
        item.product?.looseUnit || getBeverageCategorySpec(item.product?.category)?.looseUnit || item.product?.unit || 'case',
        sizes,
        item.product?.weight ?? '',
        item.product?.price ?? 0,
        getThreshold(item),
        getQuantityPerCase(item),
        getInventoryLooseRemainder(item),
        getAvailableQty(item),
        getReservedQty(item),
        getReservedBaseQty(item),
        getBaseUnitLabel(item),
        item.warehouse?.name || item.warehouse?.code || 'N/A',
        status.replace(/_/g, ' ').replace(/\b\w/g, (char: string) => char.toUpperCase()),
      ]
    })

    const csv = [headers, ...rows]
      .map((line) => line.map(escapeCsv).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const warehouseLabel = (warehouses[0]?.name || warehouses[0]?.code || 'warehouse').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    link.href = url
    link.download = `inventory-${warehouseLabel}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const openArchivedProducts = async () => {
    setShowArchivedProducts(true)
    setLoadingArchivedProducts(true)
    try {
      const result = await safeFetchJson('/api/products?archived=true&pageSize=1000', { cache: 'no-store' })
      if (!result.ok) throw new Error(result.data?.error || 'Failed to load archived products')
      setArchivedProducts(getCollection<any>(result.data, ['products']))
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load archived products')
    } finally {
      setLoadingArchivedProducts(false)
    }
  }

  const restoreArchivedProduct = async (product: any) => {
    const productId = String(product?.id || '')
    if (!productId || restoringProductId) return
    setRestoringProductId(productId)
    try {
      const result = await safeFetchJson(`/api/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      })
      if (!result.ok) throw new Error(result.data?.error || 'Failed to restore product')
      setArchivedProducts((current) => current.filter((item) => String(item.id) !== productId))
      invalidateInventoryStockCaches()
      emitDataSync(['inventory', 'products', 'stock-batches'])
      toast.success(`${product.name || 'Product'} restored successfully`)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to restore product')
    } finally {
      setRestoringProductId(null)
    }
  }

  const archivedQuery = archivedSearch.trim().toLowerCase()
  const filteredArchivedProducts = archivedProducts.filter((product) =>
    [product?.name, product?.sku, product?.category, ...(Array.isArray(product?.sizes) ? product.sizes : [])]
      .some((value) => String(value || '').toLowerCase().includes(archivedQuery))
  )

  if (showArchivedProducts) {
    return (
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" onClick={() => setShowArchivedProducts(false)} aria-label="Back to inventory">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <CardTitle>Archived Products</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Restore products to return them to active inventory.</p>
            </div>
          </div>
          <Input
            aria-label="Search archived products"
            placeholder="Search archived products…"
            value={archivedSearch}
            onChange={(event) => setArchivedSearch(event.target.value)}
            className="w-full sm:max-w-xs"
          />
        </CardHeader>
        <CardContent className="p-0">
          {loadingArchivedProducts ? (
            <div className="flex h-40 items-center justify-center text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading archived products…
            </div>
          ) : filteredArchivedProducts.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-slate-500">
              {archivedQuery ? 'No archived products match your search.' : 'No archived products.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-y bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-3 text-left font-medium">Product</th>
                    <th className="p-3 text-left font-medium">SKU</th>
                    <th className="p-3 text-left font-medium">Category</th>
                    <th className="p-3 text-left font-medium">Size</th>
                    <th className="p-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArchivedProducts.map((product) => (
                    <tr key={product.id} className="border-b last:border-0">
                      <td className="p-3 font-semibold text-slate-900">{product.name || 'Product'}</td>
                      <td className="p-3 text-slate-600">{product.sku || 'N/A'}</td>
                      <td className="p-3 text-slate-600">{product.category || 'N/A'}</td>
                      <td className="p-3 text-slate-600">{Array.isArray(product.sizes) && product.sizes.length ? product.sizes.join(', ') : 'N/A'}</td>
                      <td className="p-3 text-right">
                        <Button type="button" variant="outline" onClick={() => void restoreArchivedProduct(product)} disabled={restoringProductId === String(product.id)}>
                          {restoringProductId === String(product.id) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                          Restore
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4">
          <div>
            <CardTitle>Inventory</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="shrink-0 whitespace-nowrap border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => void openArchivedProducts()}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archived Products
            </Button>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 whitespace-nowrap border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={exportInventoryCsv}
              disabled={filteredInventory.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        {/* Toolbar: Search and Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center px-6 pb-4">
          <Input
            aria-label="Search inventory"
            placeholder="Search inventory…"
            value={inventorySearch}
            onChange={(event) => setInventorySearch(event.target.value)}
            className="h-10 w-full sm:max-w-[280px] text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Filter by stock status" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              <option value="healthy">Healthy</option>
              <option value="overstocked">Overstocked</option>
              <option value="restock">Needs Restocking</option>
              <option value="out_of_stock">Out of Stock</option>
            </select>
            <select aria-label="Filter by size" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={sizeFilter} onChange={(event) => setSizeFilter(event.target.value)}>
              <option value="">All sizes</option>
              {filterOptions.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            <select aria-label="Filter by category" className="h-10 max-w-full rounded-md border border-input bg-background px-3 text-sm" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="">All categories</option>
              {filterOptions.categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            {(statusFilter || sizeFilter || categoryFilter) && (
              <Button type="button" variant="ghost" onClick={() => { setStatusFilter(''); setSizeFilter(''); setCategoryFilter('') }}>Clear filters</Button>
            )}
          </div>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <PortalTableSkeleton rows={6} columns={7} className="border-0 shadow-none" />
          ) : filteredInventory.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-500">No inventory records found</div>
          ) : (
            <div className="w-full max-w-full overflow-x-auto overscroll-x-contain pb-1">
              <table className="w-full min-w-[1120px] text-sm">
                {/* Fix: headers remain plain table cells; filtering is handled above the table. */}
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">
                      SKU
                    </th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap min-w-[190px]">
                      Product
                    </th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">
                      Weight
                    </th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">
                      Price
                    </th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">
                      Threshold
                    </th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Qty Per Case/Pack</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Loose Base Units</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">
                      Available
                    </th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Reserved</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">
                      Status
                    </th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">
                      Size
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map((item) => {
                    const status = getStockStatus(item)
                    const reservedQty = getReservedQty(item)
                    const reservedBaseQty = getReservedBaseQty(item)
                    const availableQty = getAvailableQty(item)
                    const quantityPerCase = getQuantityPerCase(item)
                    const looseBottles = getInventoryLooseRemainder(item)
                    const baseUnitLabel = getBaseUnitLabel(item)
                    const availableOrderFormat = getOrderFormatLabel(item, availableQty)
                    const reservedOrderFormat = getOrderFormatLabel(item, reservedQty)
                    const categoryLabel = String(item.product?.category?.name || item.product?.category || '').trim()
                    return (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-2.5 text-center font-medium text-gray-900">{item.product?.sku ?? 'N/A'}</td>
                        <td className="p-2.5">
                          <div className="flex items-center justify-center gap-2">
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
                              <p className="text-xs text-gray-500">
                                {(Array.isArray(item.product?.sizes) && item.product.sizes.length > 0
                                  ? item.product.sizes.map((s: any) => String(s).trim()).filter(Boolean).join(', ')
                                  : 'N/A')
                                } • {item.product?.looseUnit || getBeverageCategorySpec(item.product?.category)?.looseUnit || item.product?.unit || 'case'}
                              </p>
                              {categoryLabel ? <p className="text-[11px] text-gray-400">{categoryLabel}</p> : null}
                            </div>
                          </div>
                        </td>
                        {/* Added: inventory exposes the registered product case/order-unit weight. */}
                        <td className="p-2.5 text-center font-semibold text-gray-900">
                          {typeof item.product?.weight === 'number' && Number.isFinite(item.product.weight) && item.product.weight > 0
                            ? `${item.product.weight.toLocaleString()} kg`
                            : 'N/A'}
                        </td>
                        <td className="p-2.5 text-center font-medium text-indigo-600">{formatPeso(item.product?.price ?? 0)}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{getThreshold(item)}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">x{quantityPerCase}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{formatLooseQuantity(looseBottles, baseUnitLabel)}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{availableQty} {availableOrderFormat}</td>
                        <td className="p-2.5 text-center font-semibold text-orange-600">
                          <p>{reservedQty} {reservedOrderFormat}</p>
                          <p className="text-[11px] font-medium text-orange-500">{formatLooseQuantity(reservedBaseQty, baseUnitLabel)}</p>
                        </td>
                        <td className="p-2.5 text-center">
                          {status === 'healthy' && <Badge className="whitespace-nowrap bg-green-100 text-green-800 hover:bg-green-100">Healthy</Badge>}
                          {status === 'overstocked' && <Badge className="whitespace-nowrap bg-blue-100 text-blue-800 hover:bg-blue-100">Overstocked</Badge>}
                          {status === 'restock' && <Badge className="whitespace-nowrap bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Needs Restocking</Badge>}
                          {status === 'out_of_stock' && <Badge className="whitespace-nowrap bg-red-100 text-red-800 hover:bg-red-100">Out of Stock</Badge>}
                        </td>
                        {/* Fix: Size is the final column after removing Category and Access. */}
                        <td className="p-2.5 text-center text-gray-600">
                          {Array.isArray(item.product?.sizes) && item.product.sizes.length > 0
                            ? item.product.sizes.map((size: any) => String(size).trim()).filter(Boolean).join(', ')
                            : 'N/A'}
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
