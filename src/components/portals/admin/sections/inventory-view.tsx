'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2, Pencil } from 'lucide-react'

const PRODUCT_UNIT_OPTIONS = [
  { value: 'case', label: 'case' },
  { value: 'pack(bundle)', label: 'pack(bundle)' },
]

function getCollection<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>

  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[]
  }

  if (Array.isArray(record.data)) return record.data as T[]
  return []
}

function getWarehouseIdFromRow(row: any) {
  const value = row?.warehouseId ?? row?.warehouse_id ?? row?.warehouse?.id ?? row?.warehouse
  return typeof value === 'object' && value !== null ? String(value.id || '') : String(value || '')
}

function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

async function safeFetchJson(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; data: any }> {
  const timeoutMs = options.timeoutMs ?? 12000
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(input, {
      cache: 'no-store',
      credentials: 'include',
      ...init,
      signal: controller.signal,
    })

    const text = await response.text()
    const data = text ? JSON.parse(text) : {}
    return { ok: response.ok && data?.success !== false, status: response.status, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    return { ok: false, status: 0, data: { error: message } }
  } finally {
    window.clearTimeout(timer)
  }
}

export function InventoryView() {
  const [inventory, setInventory] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('all')
  const [products, setProducts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingItem, setEditingItem] = useState<any | null>(null)
  const [editName, setEditName] = useState('')
  const [editSku, setEditSku] = useState('')
  const [editUnit, setEditUnit] = useState('case')
  const [editPrice, setEditPrice] = useState('')
  const [editThreshold, setEditThreshold] = useState('')
  const [editQuantity, setEditQuantity] = useState('')
  const [editImageFile, setEditImageFile] = useState<File | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeletingEdit, setIsDeletingEdit] = useState(false)
  const [deleteEditOpen, setDeleteEditOpen] = useState(false)
  const [addStockOpen, setAddStockOpen] = useState(false)
  const [isSubmittingStockIn, setIsSubmittingStockIn] = useState(false)
  const [stockInWarehouseId, setStockInWarehouseId] = useState('')
  const [stockInQty, setStockInQty] = useState('')
  const [stockInExpiryDate, setStockInExpiryDate] = useState('')
  const [stockInThreshold, setStockInThreshold] = useState('')
  const [newProductName, setNewProductName] = useState('')
  const [newProductDescription, setNewProductDescription] = useState('')
  const [newProductPrice, setNewProductPrice] = useState('')
  const [newProductUnit, setNewProductUnit] = useState('case')
  const [newProductImageFile, setNewProductImageFile] = useState<File | null>(null)

  const fetchInventory = async () => {
    setIsLoading(true)
    try {
      const result = await safeFetchJson('/api/inventory', { cache: 'no-store' })
      if (!result.ok) {
        return
      }
      setInventory(getCollection<any>(result.data, ['inventory']))
    } catch (error) {
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchWarehouses = async () => {
    try {
      const result = await safeFetchJson('/api/warehouses?page=1&pageSize=200', { cache: 'no-store' })
      if (!result.ok) {
        return
      }
      const list = getCollection<any>(result.data, ['warehouses'])
      setWarehouses(list)
      if (list[0]?.id && !stockInWarehouseId) setStockInWarehouseId(list[0].id)
      if (selectedWarehouseId !== 'all' && !list.some((warehouse) => warehouse?.id === selectedWarehouseId)) {
        setSelectedWarehouseId('all')
      }
    } catch (error) {
      console.error(error)
    }
  }

  const fetchProducts = async () => {
    try {
      const result = await safeFetchJson('/api/products?page=1&pageSize=500', { cache: 'no-store' })
      if (!result.ok) {
        return
      }
      setProducts(getCollection<any>(result.data, ['products']))
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    const refreshSharedData = () => {
      void Promise.all([fetchInventory(), fetchWarehouses(), fetchProducts()])
    }

    refreshSharedData()

    const unsubscribe = subscribeDataSync((message) => {
      const shouldRefresh = message.scopes.some((scope) =>
        ['inventory', 'products', 'stock-batches', 'warehouses'].includes(scope)
      )
      if (shouldRefresh) {
        refreshSharedData()
      }
    })

    const onFocus = () => refreshSharedData()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshSharedData()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const intervalId = window.setInterval(refreshSharedData, 30000)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [])

  const getAvailableQty = (item: any) => Math.max(0, (item.quantity ?? 0) - (item.reservedQuantity ?? 0))
  const getStockStatus = (item: any) => ((item.quantity ?? 0) <= (item.minStock ?? 0) ? 'restock' : 'healthy')
  const filteredInventory = useMemo(() => {
    if (selectedWarehouseId === 'all') return inventory
    return inventory.filter((item) => getWarehouseIdFromRow(item) === selectedWarehouseId)
  }, [inventory, selectedWarehouseId])

  const uploadProductImage = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch('/api/uploads/product-image', { method: 'POST', body: formData })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.success === false || !payload?.imageUrl) {
      throw new Error(payload?.error || 'Failed to upload image')
    }
    return String(payload.imageUrl)
  }

  const openEditDialog = (item: any) => {
    setEditingItem(item)
    setEditName(item.product?.name || '')
    setEditSku(item.product?.sku || '')
    setEditUnit(item.product?.unit || 'case')
    setEditPrice(String(item.product?.price ?? 0))
    setEditThreshold(String(item.minStock ?? 0))
    setEditQuantity(String(item.quantity ?? 0))
    setEditImageFile(null)
  }

  const saveInventoryEdit = async () => {
    if (!editingItem?.product?.id) {
      toast.error('Missing product reference')
      return
    }
    const nextPrice = Number(editPrice)
    const nextThreshold = Number(editThreshold)
    const nextQuantity = Number(editQuantity)
    if (!Number.isFinite(nextPrice) || nextPrice < 0) return toast.error('Invalid price')
    if (!Number.isFinite(nextThreshold) || nextThreshold < 0) return toast.error('Invalid threshold')
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) return toast.error('Invalid quantity')
    if (!editName.trim() || !editSku.trim() || !editUnit.trim()) return toast.error('Name, SKU, and unit are required')

    setIsSavingEdit(true)
    try {
      const uploadedImageUrl = editImageFile ? await uploadProductImage(editImageFile) : editingItem.product?.imageUrl || null
      const productResponse = await fetch(`/api/products/${editingItem.product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          sku: editSku.trim(),
          unit: editUnit.trim(),
          imageUrl: uploadedImageUrl,
          price: nextPrice,
        }),
      })
      const productPayload = await productResponse.json().catch(() => ({}))
      if (!productResponse.ok || productPayload?.success === false) throw new Error(productPayload?.error || 'Failed to update product')

      const inventoryResponse = await fetch(`/api/inventory/${editingItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: nextQuantity, minStock: nextThreshold }),
      })
      const inventoryPayload = await inventoryResponse.json().catch(() => ({}))
      if (!inventoryResponse.ok || inventoryPayload?.success === false) throw new Error(inventoryPayload?.error || 'Failed to update inventory')

      toast.success('Inventory item updated')
      setEditingItem(null)
      await Promise.all([fetchInventory(), fetchProducts()])
      emitDataSync(['inventory', 'products'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save changes')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const deleteInventoryProduct = async () => {
    if (!editingItem?.product?.id) {
      toast.error('Missing product reference')
      return
    }

    setIsDeletingEdit(true)
    try {
      const response = await fetch(`/api/products/${editingItem.product.id}`, {
        method: 'DELETE',
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to delete product')
      }

      toast.success('Product deleted')
      setEditingItem(null)
      setDeleteEditOpen(false)
      await Promise.all([fetchInventory(), fetchProducts()])
      emitDataSync(['inventory', 'products', 'stock-batches'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete product')
    } finally {
      setIsDeletingEdit(false)
    }
  }

  const resetStockInForm = () => {
    setStockInQty('')
    setStockInExpiryDate('')
    setStockInThreshold('')
    setNewProductName('')
    setNewProductDescription('')
    setNewProductPrice('')
    setNewProductUnit('case')
    setNewProductImageFile(null)
  }

  const addStockInBatch = async () => {
    const qty = Number(stockInQty)
    if (!stockInWarehouseId) return toast.error('Please select a warehouse')
    if (!Number.isFinite(qty) || qty <= 0) return toast.error('Quantity should be greater than 0')
    if (!newProductName.trim()) return toast.error('New product name is required')

    setIsSubmittingStockIn(true)
    try {
      const uploadedImageUrl = newProductImageFile ? await uploadProductImage(newProductImageFile) : null
      const response = await fetch('/api/stock-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: stockInWarehouseId,
          quantity: qty,
          expiryDate: stockInExpiryDate || null,
          threshold: stockInThreshold ? Number(stockInThreshold) : undefined,
          isNewProduct: true,
          productId: undefined,
          productName: newProductName.trim(),
          description: newProductDescription.trim() || null,
          unit: newProductUnit,
          price: Number(newProductPrice || 0),
          imageUrl: uploadedImageUrl,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Failed to add stock')

      toast.success('Stock added successfully')
      setAddStockOpen(false)
      resetStockInForm()
      await Promise.all([fetchInventory(), fetchProducts()])
      emitDataSync(['inventory', 'products', 'stock-batches'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add stock')
    } finally {
      setIsSubmittingStockIn(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Inventory</CardTitle>
              <CardDescription>Warehouse staff can edit product details and add stock by batch.</CardDescription>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-64"
                value={selectedWarehouseId}
                onChange={(event) => setSelectedWarehouseId(event.target.value)}
                title="Filter by warehouse"
              >
                <option value="all">All Warehouses</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name || warehouse.code || warehouse.id}
                  </option>
                ))}
              </select>
              <Button onClick={() => setAddStockOpen(true)}>
                Add Stock
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="h-64 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : filteredInventory.length === 0 ? (
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
                  {filteredInventory.map((item) => {
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
                        <td className="p-4 text-gray-600">{item.warehouse?.name || item.warehouse?.code || 'N/A'}</td>
                        <td className="p-4">
                          {status === 'healthy' && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Healthy</Badge>}
                          {status === 'restock' && <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Needs Restocking</Badge>}
                        </td>
                        <td className="p-4">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            onClick={() => openEditDialog(item)}
                            title="Edit item"
                          >
                            <Pencil className="h-4 w-4" />
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

      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="max-w-4xl w-full">
          {editingItem && (
            <>
              <DialogHeader>
                <DialogTitle>Edit Inventory Item</DialogTitle>
                <DialogDescription>Update product details and stock threshold.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Product Name</label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">SKU</label>
                  <Input value={editSku} onChange={(e) => setEditSku(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Photo</label>
                  <Input type="file" accept="image/*" onChange={(e) => setEditImageFile(e.target.files?.[0] || null)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Unit</label>
                  <select
                    aria-label="Product unit"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editUnit}
                    onChange={(e) => setEditUnit(e.target.value)}
                  >
                    {PRODUCT_UNIT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Price</label>
                  <Input type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Threshold</label>
                  <Input type="number" value={editThreshold} onChange={(e) => setEditThreshold(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">In Stock Quantity</label>
                  <Input type="number" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="destructive"
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => setDeleteEditOpen(true)}
                    disabled={isSavingEdit || isDeletingEdit}
                  >
                    {isDeletingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Delete Product
                  </Button>
                  <Button className="flex-1 bg-black text-white hover:bg-black/90" onClick={saveInventoryEdit} disabled={isSavingEdit || isDeletingEdit}>
                    {isSavingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Save Changes
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteEditOpen} onOpenChange={setDeleteEditOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-600">Delete Product Permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This action will permanently delete{' '}
              <span className="font-semibold text-foreground">{editingItem?.product?.name || 'this product'}</span>{' '}
              from the database. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingEdit}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteInventoryProduct}
              disabled={isDeletingEdit}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeletingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Delete Product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={addStockOpen} onOpenChange={(open) => { setAddStockOpen(open); if (!open) resetStockInForm() }}>
        <DialogContent className="max-w-4xl w-full">
          <DialogHeader>
            <DialogTitle>Add Product</DialogTitle>
            <DialogDescription>Create a new product and add initial stock by batch.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Warehouse</label>
              <select aria-label="Warehouse" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" title="Select Warehouse" value={stockInWarehouseId} onChange={(e) => setStockInWarehouseId(e.target.value)}>
                <option value="">Select warehouse</option>
                {warehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>{wh.name} ({wh.code})</option>
                ))}
              </select>
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Product Image</label>
                <Input type="file" accept="image/*" onChange={(e) => setNewProductImageFile(e.target.files?.[0] || null)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Product Name</label>
                <Input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Description</label>
                <Input
                  value={newProductDescription}
                  onChange={(e) => setNewProductDescription(e.target.value)}
                  placeholder="Product description"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Price</label>
                  <Input type="number" step="0.01" value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Unit</label>
                  <select
                    aria-label="New product unit"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={newProductUnit}
                    onChange={(e) => setNewProductUnit(e.target.value)}
                  >
                    {PRODUCT_UNIT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Threshold</label>
                  <Input type="number" value={stockInThreshold} onChange={(e) => setStockInThreshold(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Quantity</label>
                <Input type="number" value={stockInQty} onChange={(e) => setStockInQty(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Expiry Date</label>
                <Input type="date" value={stockInExpiryDate} onChange={(e) => setStockInExpiryDate(e.target.value)} />
              </div>
            </div>

            <Button className="w-full" onClick={addStockInBatch} disabled={isSubmittingStockIn}>
              {isSubmittingStockIn ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Add Product
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
