'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
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
import { Download, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { getCollection, getWarehouseIdFromRow, formatPeso, safeFetchJson } from './shared'
import {
  getInventoryAlertLevel,
  getInventoryAvailableQty,
  getInventoryReservedBaseUnits,
  getInventoryUnitsPerCase,
} from '@/lib/report-metrics'
import { BEVERAGE_CATEGORIES, formatLooseQuantity, getBeverageCategorySpec } from '@/lib/beverage-category-specs'
import { calculateProductWeightKg } from '@/lib/product-weight'
import {
  ADMIN_INVENTORY_CACHE_KEY,
  PORTAL_CACHE_TTL_MS,
  invalidateInventoryStockCaches,
  isPortalCacheFresh,
  readPortalCache,
  writePortalCache,
} from '@/lib/portal-data-cache'

const PRODUCT_UNIT_OPTIONS = [
  { value: 'case', label: 'case' },
  { value: 'pack', label: 'pack' },
]

const CASE_SIZE_OPTIONS = [
  '8oz',
  '12oz',
  '1 Liter',
]

const PACK_SIZE_OPTIONS = [
  '7oz',
  '8oz',
  '12oz',
  '195ml',
  '237ml',
  '240ml',
  '250ml',
  '290ml',
  '300ml',
  '320ml',
  '350ml',
  '355ml',
  '450ml',
  '500ml',
  '600ml',
  '900ml',
  '1 Liter',
  '1.5 Liters',
  '2 Liters',
  '320g',
  '640g',
]

const SIZE_OPTIONS = {
  case: CASE_SIZE_OPTIONS,
  bottle: CASE_SIZE_OPTIONS,
  'pack': PACK_SIZE_OPTIONS,
}

const GLASS_DEPOSIT_BY_SIZE: Record<string, { bottle: number; case: number }> = {
  '12oz': { bottle: 2, case: 90 },
  '1 Liter': { bottle: 6, case: 124 },
}

const getGlassDepositPreset = (category: unknown, sizes: unknown, unit: unknown) => {
  const spec = getBeverageCategorySpec(category)
  // Glass packaging and deposit eligibility are separate; Alcohol is always exempt.
  if (!spec?.depositAllowed || String(unit || '').trim().toLowerCase() !== 'case') return null
  const selectedSize = Array.isArray(sizes) ? String(sizes[0] || '').trim() : ''
  return GLASS_DEPOSIT_BY_SIZE[selectedSize] || null
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
  const [editCategory, setEditCategory] = useState('')
  const [editUnit, setEditUnit] = useState('case')
  const [editSize, setEditSize] = useState('')
  const [editQuantityPerUnit, setEditQuantityPerUnit] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editImageFile, setEditImageFile] = useState<File | null>(null)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [isDeletingEdit, setIsDeletingEdit] = useState(false)
  const [deleteEditOpen, setDeleteEditOpen] = useState(false)
  const [registerProductOpen, setRegisterProductOpen] = useState(false)
  const [isSubmittingProduct, setIsSubmittingProduct] = useState(false)
  const [productName, setProductName] = useState('')
  const [productSku, setProductSku] = useState('')
  const [productUnit, setProductUnit] = useState('case')
  const [productQuantityPerUnit, setProductQuantityPerUnit] = useState('')
  const [productPrice, setProductPrice] = useState('')
  const [productCategory, setProductCategory] = useState('')
  const [productSizes, setProductSizes] = useState<string[]>([])
  const [productImageFile, setProductImageFile] = useState<File | null>(null)
  const [productSkuSeed, setProductSkuSeed] = useState('')
  const [productWarehouseId, setProductWarehouseId] = useState('')
  const [productBottleDeposit, setProductBottleDeposit] = useState('')
  const [productCaseDeposit, setProductCaseDeposit] = useState('')
  const [editBottleDeposit, setEditBottleDeposit] = useState('')
  const [editCaseDeposit, setEditCaseDeposit] = useState('')
  const cacheAtRef = useRef(0)
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const createSkuSeed = () => Math.random().toString(36).slice(2, 7).toUpperCase()

  const selectedProductSize = productSizes[0] ?? ''
  const selectedCategorySpec = getBeverageCategorySpec(productCategory)
  const editingCategorySpec = getBeverageCategorySpec(editCategory)
  const selectedProductQuantityPerUnit = Number(productQuantityPerUnit)
  // Fix: physical packaging comes from category; "case" versus "pack" is only
  // an order format and must not decide whether glass weight is used.
  const selectedProductWeight = calculateProductWeightKg({
    size: selectedProductSize,
    quantityPerUnit: selectedProductQuantityPerUnit,
    returnableGlass: Boolean(selectedCategorySpec?.depositAllowed),
  })
  const selectedGlassDeposit = getGlassDepositPreset(productCategory, productSizes, productUnit)
  const editingGlassDeposit = editingItem
    ? getGlassDepositPreset(editCategory, editSize ? [editSize] : [], editUnit)
    : null
  const editingProductWeight = calculateProductWeightKg({
    size: editSize,
    quantityPerUnit: Number(editQuantityPerUnit),
    returnableGlass: Boolean(editingCategorySpec?.depositAllowed),
  })

  const autoGeneratedSku = useMemo(() => {
    if (!productSkuSeed) return ''
    const namePart = (productName || 'PRD')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4) || 'PRD'
    const unitPart = (productUnit || 'UNT')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3) || 'UNT'
    const sizePart = (selectedProductSize || 'SIZE')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4) || 'SIZE'

    return `${namePart}-${unitPart}-${sizePart}-${productSkuSeed}`
  }, [productName, productUnit, selectedProductSize, productSkuSeed])

  useEffect(() => {
    if (registerProductOpen) {
      setProductSku(autoGeneratedSku)
    }
  }, [autoGeneratedSku, registerProductOpen])

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
    if (level === 'overstocked') return 'overstocked'
    return level === 'healthy' ? 'healthy' : 'restock'
  }
  const filteredInventory = useMemo(() => {
    return inventory
  }, [inventory])

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
        Math.max(Number(item.looseBottles ?? item.loose_bottles ?? 0), 0),
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
    setEditCategory(getBeverageCategorySpec(item.product?.category)?.category || '')
    setEditUnit(item.product?.unit || 'case')
    setEditSize(Array.isArray(item.product?.sizes) ? String(item.product.sizes[0] || '').trim() : '')
    setEditQuantityPerUnit(String(item.product?.quantityPerUnit ?? item.product?.quantity_per_unit ?? ''))
    setEditPrice(String(item.product?.price ?? 0))
    // The API reports stored deposits as depositAmount / caseDepositAmount.
    const storedBottleDeposit = item.product?.depositAmount ?? item.product?.bottleDeposit
    const storedCaseDeposit = item.product?.caseDepositAmount ?? item.product?.caseDeposit
    setEditBottleDeposit(Number(storedBottleDeposit) > 0 ? String(storedBottleDeposit) : '')
    setEditCaseDeposit(Number(storedCaseDeposit) > 0 ? String(storedCaseDeposit) : '')
    setEditImageFile(null)
  }

  const saveInventoryEdit = async () => {
    if (!editingItem?.product?.id) {
      toast.error('Missing product reference')
      return
    }
    const nextPrice = Number(editPrice)
    const nextQuantityPerUnit = Number(editQuantityPerUnit)
    const nextBottleDeposit = editBottleDeposit !== '' ? Number(editBottleDeposit) : (editingGlassDeposit?.bottle ?? null)
    const nextCaseDeposit = editCaseDeposit !== '' ? Number(editCaseDeposit) : (editingGlassDeposit?.case ?? null)
    if (!Number.isFinite(nextPrice) || nextPrice < 0) return toast.error('Invalid price')
    if (!Number.isFinite(nextQuantityPerUnit) || nextQuantityPerUnit <= 0) return toast.error('Quantity per unit is required')
    // Fix: container deposits are configured as non-negative whole peso amounts.
    if (editingCategorySpec?.depositAllowed && (
      (nextBottleDeposit !== null && (!Number.isInteger(nextBottleDeposit) || nextBottleDeposit < 0))
      || (nextCaseDeposit !== null && (!Number.isInteger(nextCaseDeposit) || nextCaseDeposit < 0))
    )) return toast.error('Deposit amounts must be whole numbers')
    if (!editName.trim() || !editSku.trim() || !editUnit.trim() || !editCategory || !editSize) return toast.error('Name, SKU, category, order format, and size are required')
    if (editingProductWeight === null) return toast.error('Unable to calculate product weight from the selected size and quantity')

    setIsSavingEdit(true)
    try {
      const uploadedImageUrl = editImageFile ? await uploadProductImage(editImageFile) : editingItem.product?.imageUrl || null
      const productResponse = await fetch(`/api/products/${editingItem.product.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          sku: editSku.trim(),
          category: editCategory,
          unit: editUnit.trim(),
          // Keep the product's canonical size synchronized with the edit form.
          sizes: [editSize],
          quantityPerUnit: Math.floor(nextQuantityPerUnit),
          quantityPerCase: Math.floor(nextQuantityPerUnit),
          // Keep the saved weight synchronized when size or quantity is edited.
          weight: editingProductWeight,
          imageUrl: uploadedImageUrl,
          price: nextPrice,
          retailUnitPrice: nextQuantityPerUnit > 0 ? Number((nextPrice / nextQuantityPerUnit).toFixed(2)) : nextPrice,
          casePrice: nextPrice,
          bottleDeposit: !editingCategorySpec?.depositAllowed
            ? null
            : nextBottleDeposit,
          caseDeposit: !editingCategorySpec?.depositAllowed
            ? null
            : nextCaseDeposit,
        }),
      })
      const productPayload = await productResponse.json().catch(() => ({}))
      if (!productResponse.ok || productPayload?.success === false) throw new Error(productPayload?.error || 'Failed to update product')

      toast.success('Inventory item updated')
      setEditingItem(null)
      // The sync subscriber refreshes and caches the related collections once.
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
      emitDataSync(['inventory', 'products', 'stock-batches'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete product')
    } finally {
      setIsDeletingEdit(false)
    }
  }

  const registerProduct = async () => {
    const nextPrice = Number(productPrice)
    const nextQuantityPerUnit = Number(productQuantityPerUnit)
    const nextBottleDeposit = productBottleDeposit !== '' ? Number(productBottleDeposit) : (selectedGlassDeposit?.bottle ?? null)
    const nextCaseDeposit = productCaseDeposit !== '' ? Number(productCaseDeposit) : (selectedGlassDeposit?.case ?? null)
    const nextSku = (autoGeneratedSku || productSku || '').trim()

    if (!productName.trim() || !nextSku || !productUnit.trim()) {
      return toast.error('Name, SKU, and order format are required')
    }
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      return toast.error('Invalid price')
    }
    if (!Number.isFinite(nextQuantityPerUnit) || nextQuantityPerUnit <= 0) {
      return toast.error('Quantity per unit is required')
    }
    // Fix: reject fractional deposits before uploading or submitting product data.
    if (selectedCategorySpec?.depositAllowed && (
      (nextBottleDeposit !== null && (!Number.isInteger(nextBottleDeposit) || nextBottleDeposit < 0))
      || (nextCaseDeposit !== null && (!Number.isInteger(nextCaseDeposit) || nextCaseDeposit < 0))
    )) {
      return toast.error('Deposit amounts must be whole numbers')
    }
    if (productSizes.length === 0) {
      return toast.error('Please select at least one size')
    }
    if (!productImageFile) {
      return toast.error('Product image is required')
    }
    if (!productCategory) {
      return toast.error('Please select a category')
    }
    if (selectedProductWeight === null) {
      return toast.error('Unable to calculate product weight from the selected size and quantity')
    }
    setIsSubmittingProduct(true)
    try {
      const uploadedImageUrl = await uploadProductImage(productImageFile)
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: productName.trim(),
          sku: nextSku,
          unit: productUnit.trim(),
          quantityPerUnit: Math.floor(nextQuantityPerUnit),
          quantityPerCase: Math.floor(nextQuantityPerUnit),
          weight: selectedProductWeight,
          category: productCategory,
          price: nextPrice,
          retailUnitPrice: nextQuantityPerUnit > 0 ? Number((nextPrice / nextQuantityPerUnit).toFixed(2)) : nextPrice,
          casePrice: nextPrice,
          bottleDeposit: !selectedCategorySpec?.depositAllowed
            ? null
            : nextBottleDeposit,
          caseDeposit: !selectedCategorySpec?.depositAllowed
            ? null
            : nextCaseDeposit,
          warehouseId: productWarehouseId || warehouses[0]?.id,
          sizes: productSizes,
          imageUrl: uploadedImageUrl,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to create product')
      }

      toast.success('Product registered successfully')
      setRegisterProductOpen(false)
      setProductName('')
      setProductSku('')
      setProductSkuSeed('')
      setProductUnit('case')
      setProductQuantityPerUnit('')
      setProductPrice('')
      setProductCategory('')
      setProductSizes([])
      setProductImageFile(null)
      setProductWarehouseId('')
      setProductBottleDeposit('')
      setProductCaseDeposit('')
      emitDataSync(['inventory', 'products'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to register product')
    } finally {
      setIsSubmittingProduct(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Inventory</CardTitle>
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <div className="flex h-10 min-w-0 flex-1 items-center rounded-md border border-input bg-slate-50 px-3 text-sm text-slate-600 sm:w-[260px] sm:flex-none">
                Warehouse: {warehouses[0]?.name || warehouses[0]?.code || 'Not registered'}
              </div>
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
              <Button
                onClick={() => {
                  setProductSkuSeed(createSkuSeed())
                  setRegisterProductOpen(true)
                }}
                className="shrink-0 whitespace-nowrap bg-blue-600 text-white hover:bg-blue-700"
              >
                Register Product
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <PortalTableSkeleton rows={6} columns={7} className="border-0 shadow-none" />
          ) : filteredInventory.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-500">No inventory records found</div>
          ) : (
            <div className="w-full max-w-full overflow-x-auto overscroll-x-contain pb-1">
              <table className="w-full min-w-[1120px] text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">SKU</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap min-w-[190px]">Product</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Weight</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Price</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Threshold</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Qty Per Case/Pack</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Loose Base Units</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Available</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Reserved</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Status</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map((item) => {
                    const status = getStockStatus(item)
                    const reservedQty = getReservedQty(item)
                    const reservedBaseQty = getReservedBaseQty(item)
                    const availableQty = getAvailableQty(item)
                    const quantityPerCase = getQuantityPerCase(item)
                    const looseBottles = Math.max(Number(item.looseBottles ?? item.loose_bottles ?? 0), 0)
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
                        </td>
                        <td className="p-2.5 text-center">
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
        <DialogContent className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
          {editingItem && (
            <>
              <DialogHeader>
                <DialogTitle>Edit Inventory Item</DialogTitle>
                <DialogDescription>Update product details and stock threshold.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
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
                    <label className="text-sm font-medium text-gray-700">Category</label>
                    <select
                      aria-label="Product category"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={editCategory}
                      onChange={(event) => {
                        const nextCategory = event.target.value
                        setEditCategory(nextCategory)
                        if (!getBeverageCategorySpec(nextCategory)?.depositAllowed) {
                          setEditBottleDeposit('')
                          setEditCaseDeposit('')
                        }
                      }}
                    >
                      <option value="">Select a category</option>
                      {BEVERAGE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Order Format</label>
                    <select
                      aria-label="Product unit"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={editUnit}
                      onChange={(e) => {
                        setEditUnit(e.target.value)
                        setEditSize('')
                        if (e.target.value === 'bottle') setEditQuantityPerUnit('1')
                      }}
                    >
                      {PRODUCT_UNIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Photo</label>
                    <Input type="file" accept="image/*" onChange={(e) => setEditImageFile(e.target.files?.[0] || null)} />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Price (PHP)</label>
                    <Input type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Quantity Per Case</label>
                    <Input type="number" step="1" min="1" value={editQuantityPerUnit} onChange={(e) => setEditQuantityPerUnit(e.target.value)} placeholder="Required" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Product Size</label>
                    <select
                      aria-label="Product size"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={editSize}
                      onChange={(event) => setEditSize(event.target.value)}
                    >
                      <option value="">Select size</option>
                      {editSize && !SIZE_OPTIONS[editUnit as keyof typeof SIZE_OPTIONS]?.includes(editSize) ? (
                        <option value={editSize}>{editSize}</option>
                      ) : null}
                      {SIZE_OPTIONS[editUnit as keyof typeof SIZE_OPTIONS]?.map((size) => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                  </div>
                  {editingCategorySpec?.depositAllowed ? (
                    <div className="grid grid-cols-1 gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-emerald-900">Deposit per Bottle (PHP)</label>
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          value={editBottleDeposit}
                          onChange={(e) => setEditBottleDeposit(e.target.value)}
                          placeholder={editingGlassDeposit ? String(editingGlassDeposit.bottle) : '0'}
                          className="bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-sm font-medium text-emerald-900">Deposit per Case (PHP)</label>
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          value={editCaseDeposit}
                          onChange={(e) => setEditCaseDeposit(e.target.value)}
                          placeholder={editingGlassDeposit ? String(editingGlassDeposit.case) : '0'}
                          className="bg-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                      Container deposits do not apply to {editingCategorySpec.category}.
                    </p>
                  )}
                </div>

                <div className="md:col-span-2 flex gap-3 pt-3 border-t">
                  <Button
                    variant="destructive"
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => setDeleteEditOpen(true)}
                    disabled={isSavingEdit || isDeletingEdit}
                  >
                    {isDeletingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Delete Product
                  </Button>
                  <Button className="flex-1 bg-blue-600 text-white hover:bg-blue-700" onClick={saveInventoryEdit} disabled={isSavingEdit || isDeletingEdit}>
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
              from the system. This cannot be undone.
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

      <Dialog
        open={registerProductOpen}
        onOpenChange={(open) => {
          setRegisterProductOpen(open)
          if (!open) {
            setProductSkuSeed('')
          }
        }}
      >
        <DialogContent className="max-w-5xl w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Register New Product</DialogTitle>
            <DialogDescription>Add a new product to your inventory system.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
            {/* Left Column: Product Info & Identity */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Warehouse</label>
                <div className="rounded-md border border-input bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {warehouses[0]?.name || warehouses[0]?.code || 'Warehouse setup required'}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Product Name</label>
                <Input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Pepsi"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Category</label>
                <select
                  aria-label="Product category"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={productCategory}
                  onChange={(e) => {
                    const nextCategory = e.target.value
                    setProductCategory(nextCategory)
                    // Drop any deposit typed under a returnable category so it is
                    // not carried into a category that has no deposit.
                    if (!getBeverageCategorySpec(nextCategory)?.depositAllowed) {
                      setProductBottleDeposit('')
                      setProductCaseDeposit('')
                    }
                  }}
                >
                  <option value="">Select a category</option>
                  {BEVERAGE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">SKU</label>
                <Input
                  value={productSku}
                  readOnly
                  placeholder="Auto-generated on category & name"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Order Format</label>
                <select
                  aria-label="Product unit"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={productUnit}
                  onChange={(e) => {
                    setProductUnit(e.target.value)
                    setProductSizes([])
                    if (e.target.value === 'bottle') setProductQuantityPerUnit('1')
                  }}
                >
                  {PRODUCT_UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Product Photo</label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setProductImageFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>

            {/* Right Column: Pricing & Packaging Specs */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Price (PHP)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={productPrice}
                  onChange={(e) => setProductPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700">Quantity Per Case</label>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  value={productQuantityPerUnit}
                  onChange={(e) => setProductQuantityPerUnit(e.target.value)}
                  placeholder="e.g. 24"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Available Size</label>
                  <select
                    aria-label="Available size"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={selectedProductSize}
                    onChange={(e) => setProductSizes(e.target.value ? [e.target.value] : [])}
                  >
                    <option value="">Select size</option>
                    {SIZE_OPTIONS[productUnit as keyof typeof SIZE_OPTIONS]?.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Weight (kg)</label>
                  <Input
                    value={selectedProductWeight !== null ? selectedProductWeight.toFixed(2) : ''}
                    readOnly
                    placeholder="Auto"
                  />
                </div>
              </div>
              {/* Container deposits only apply to returnable (glass) categories;
                  every other category has nothing to deposit against. */}
              {selectedCategorySpec?.depositAllowed ? (
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-emerald-900">Deposit / Bottle (PHP)</label>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={productBottleDeposit}
                      onChange={(e) => setProductBottleDeposit(e.target.value)}
                      placeholder={selectedGlassDeposit ? String(selectedGlassDeposit.bottle) : '0'}
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-emerald-900">Deposit / Case (PHP)</label>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={productCaseDeposit}
                      onChange={(e) => setProductCaseDeposit(e.target.value)}
                      placeholder={selectedGlassDeposit ? String(selectedGlassDeposit.case) : '0'}
                      className="bg-white"
                    />
                  </div>
                  <p className="col-span-2 text-xs text-emerald-800">Enter custom deposit amounts or leave blank to use defaults.</p>
                </div>
              ) : productCategory ? (
                <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Container deposits do not apply to {selectedCategorySpec.category}.
                </p>
              ) : null}
            </div>

            {/* Bottom Actions spanning full width */}
            <div className="md:col-span-2 flex gap-3 pt-3 border-t">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setRegisterProductOpen(false)
                  setProductName('')
                  setProductSku('')
                  setProductSkuSeed('')
                  setProductUnit('case')
                  setProductQuantityPerUnit('')
                  setProductPrice('')
                  setProductCategory('')
                  setProductSizes([])
                  setProductImageFile(null)
                  setProductWarehouseId('')
                }}
                disabled={isSubmittingProduct}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
                onClick={registerProduct}
                disabled={isSubmittingProduct}
              >
                {isSubmittingProduct ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Register Product
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
