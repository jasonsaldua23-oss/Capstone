'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { PackagingProfileDialog, type PackagingProfileRow } from './packaging-profile-dialog'
import { BEVERAGE_CATEGORIES, formatLooseQuantity, getBeverageCategorySpec } from '@/lib/beverage-category-specs'

const PRODUCT_UNIT_OPTIONS = [
  { value: 'case', label: 'case' },
  { value: 'pack(bundle)', label: 'pack(bundle)' },
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
  'pack(bundle)': PACK_SIZE_OPTIONS,
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

const WEIGHT_BY_SIZE_PACK: Record<string, number> = {
  '7oz': 0.20,
  '8oz': 0.23,
  '12oz': 0.34,
  '195ml': 0.20,
  '237ml': 0.24,
  '240ml': 0.24,
  '250ml': 0.25,
  '290ml': 0.29,
  '300ml': 0.30,
  '320ml': 0.32,
  '350ml': 0.35,
  '355ml': 0.36,
  '450ml': 0.45,
  '500ml': 0.50,
  '600ml': 0.60,
  '900ml': 0.90,
  '1 Liter': 1.00,
  '1.5 Liters': 1.50,
  '2 Liters': 2.00,
  '320g': 0.32,
  '640g': 0.64,
}

const WEIGHT_BY_SIZE_CASE: Record<string, number> = {
  '8oz': 0.45,
  '12oz': 0.68,
  '1 Liter': 1.55,
  // Backward compatibility for existing records saved with old labels
  '8oz glass bottle': 0.45,
  '12oz glass bottle': 0.68,
  '1 Liter glass bottle': 1.55,
}


export function InventoryView() {
  const [inventory, setInventory] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('all')
  const [products, setProducts] = useState<any[]>([])
  const [packagingProfiles, setPackagingProfiles] = useState<PackagingProfileRow[]>([])
  const [packagingProfilesOpen, setPackagingProfilesOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [editingItem, setEditingItem] = useState<any | null>(null)
  const [editName, setEditName] = useState('')
  const [editSku, setEditSku] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editUnit, setEditUnit] = useState('case')
  const [editQuantityPerUnit, setEditQuantityPerUnit] = useState('')
  const [editPackagingProfileId, setEditPackagingProfileId] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editRetailUnitPrice, setEditRetailUnitPrice] = useState('')
  const [editCasePrice, setEditCasePrice] = useState('')
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
  const [productRetailUnitPrice, setProductRetailUnitPrice] = useState('')
  const [productCasePrice, setProductCasePrice] = useState('')
  const [productCategory, setProductCategory] = useState('')
  const [productSizes, setProductSizes] = useState<string[]>([])
  const [productImageFile, setProductImageFile] = useState<File | null>(null)
  const [productSkuSeed, setProductSkuSeed] = useState('')
  const [productWarehouseId, setProductWarehouseId] = useState('')
  const [productPackagingProfileId, setProductPackagingProfileId] = useState('')
  const createSkuSeed = () => Math.random().toString(36).slice(2, 7).toUpperCase()

  const selectedProductSize = productSizes[0] ?? ''
  const selectedCategorySpec = getBeverageCategorySpec(productCategory)
  const editingCategorySpec = getBeverageCategorySpec(editCategory)
  const selectedProductBaseWeight = selectedProductSize
    ? (productUnit === 'pack(bundle)' ? WEIGHT_BY_SIZE_PACK[selectedProductSize] : WEIGHT_BY_SIZE_CASE[selectedProductSize])
    : null
  const selectedProductQuantityPerUnit = Number(productQuantityPerUnit)
  const selectedProductWeight =
    selectedProductBaseWeight !== null &&
      Number.isFinite(selectedProductQuantityPerUnit) &&
      selectedProductQuantityPerUnit > 0
      ? selectedProductBaseWeight * selectedProductQuantityPerUnit
      : null
  const selectedGlassDeposit = getGlassDepositPreset(productCategory, productSizes, productUnit)
  const editingGlassDeposit = editingItem
    ? getGlassDepositPreset(editCategory, editingItem.product?.sizes, editUnit)
    : null

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
      const activeWarehouses = list.filter((warehouse) => warehouse?.isActive !== false)
      setWarehouses(activeWarehouses)
      if (selectedWarehouseId !== 'all' && !activeWarehouses.some((warehouse) => warehouse?.id === selectedWarehouseId)) {
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

  const fetchPackagingProfiles = async () => {
    try {
      const result = await safeFetchJson('/api/packaging-profiles', { cache: 'no-store' })
      if (result.ok) {
        setPackagingProfiles(getCollection<PackagingProfileRow>(result.data, ['packagingProfiles']))
      }
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    const refreshSharedData = () => {
      void Promise.all([fetchInventory(), fetchWarehouses(), fetchProducts(), fetchPackagingProfiles()])
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
    item?.product?.packagingProfile?.baseUnitLabel ||
    item?.product?.packaging_profile?.base_unit_label ||
    'unit'
  ).trim() || 'unit'
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
      'Price',
      'Threshold',
      'Qty Per Case/Pack',
      'Loose Base Units',
      'Available Cases',
      'Reserved Cases',
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
    setEditQuantityPerUnit(String(item.product?.quantityPerUnit ?? item.product?.quantity_per_unit ?? ''))
    setEditPackagingProfileId(String(item.product?.packagingProfile?.id || ''))
    setEditPrice(String(item.product?.price ?? 0))
    setEditRetailUnitPrice(String(item.product?.retailUnitPrice ?? ''))
    setEditCasePrice(String(item.product?.casePrice ?? item.product?.price ?? 0))
    setEditImageFile(null)
  }

  const saveInventoryEdit = async () => {
    if (!editingItem?.product?.id) {
      toast.error('Missing product reference')
      return
    }
    const nextPrice = Number(editPrice)
    const nextRetailUnitPrice = Number(editRetailUnitPrice)
    const nextCasePrice = Number(editCasePrice)
    const nextQuantityPerUnit = Number(editQuantityPerUnit)
    if (!Number.isFinite(nextPrice) || nextPrice < 0) return toast.error('Invalid price')
    if (!Number.isFinite(nextRetailUnitPrice) || nextRetailUnitPrice < 0) return toast.error('Invalid retail unit price')
    if (!Number.isFinite(nextCasePrice) || nextCasePrice < 0) return toast.error('Invalid retail case/pack price')
    if (!Number.isFinite(nextQuantityPerUnit) || nextQuantityPerUnit <= 0) return toast.error('Quantity per unit is required')
    if (!editName.trim() || !editSku.trim() || !editUnit.trim() || !editCategory) return toast.error('Name, SKU, category, and order format are required')

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
          quantityPerUnit: Math.floor(nextQuantityPerUnit),
          quantityPerCase: Math.floor(nextQuantityPerUnit),
          packagingProfileId: editPackagingProfileId || null,
          imageUrl: uploadedImageUrl,
          price: nextPrice,
          retailUnitPrice: nextRetailUnitPrice,
          casePrice: nextCasePrice,
        }),
      })
      const productPayload = await productResponse.json().catch(() => ({}))
      if (!productResponse.ok || productPayload?.success === false) throw new Error(productPayload?.error || 'Failed to update product')

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

  const registerProduct = async () => {
    const nextPrice = Number(productPrice)
    const nextRetailUnitPrice = Number(productRetailUnitPrice)
    const nextCasePrice = Number(productCasePrice)
    const nextQuantityPerUnit = Number(productQuantityPerUnit)
    const nextSku = (autoGeneratedSku || productSku || '').trim()

    if (!productName.trim() || !nextSku || !productUnit.trim()) {
      return toast.error('Name, SKU, and order format are required')
    }
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      return toast.error('Invalid price')
    }
    if (!Number.isFinite(nextRetailUnitPrice) || nextRetailUnitPrice < 0) {
      return toast.error('Invalid retail unit price')
    }
    if (!Number.isFinite(nextCasePrice) || nextCasePrice < 0) {
      return toast.error('Invalid retail case/pack price')
    }
    if (!Number.isFinite(nextQuantityPerUnit) || nextQuantityPerUnit <= 0) {
      return toast.error('Quantity per unit is required')
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
          packagingProfileId: productPackagingProfileId || null,
          weight:
            selectedProductBaseWeight !== null
              ? Number((selectedProductBaseWeight * Math.floor(nextQuantityPerUnit)).toFixed(2))
              : null,
          category: productCategory,
          price: nextPrice,
          retailUnitPrice: nextRetailUnitPrice,
          casePrice: nextCasePrice,
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
      setProductRetailUnitPrice('')
      setProductCasePrice('')
      setProductCategory('')
      setProductSizes([])
      setProductImageFile(null)
      setProductWarehouseId('')
      setProductPackagingProfileId('')
      await Promise.all([fetchInventory(), fetchProducts()])
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
            <div className="w-full overflow-x-auto pb-1">
              <table className="w-full min-w-[1120px] text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">SKU</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap min-w-[190px]">Product</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Price</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Threshold</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Qty Per Case/Pack</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Loose Base Units</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Available Cases</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Reserved</th>
                    <th className="text-center p-2.5 font-medium text-gray-600 whitespace-nowrap">Location</th>
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
                        <td className="p-2.5 text-center font-medium text-indigo-600">{formatPeso(item.product?.price ?? 0)}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{getThreshold(item)}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{quantityPerCase}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{formatLooseQuantity(looseBottles, baseUnitLabel)}</td>
                        <td className="p-2.5 text-center font-semibold text-gray-900">{availableQty}</td>
                        <td className="p-2.5 text-center font-semibold text-orange-600">
                          <p>{reservedQty} case(s)</p>
                          <p className="text-[11px] font-medium text-orange-500">{reservedBaseQty} {baseUnitLabel}(s)</p>
                        </td>
                        <td className="p-2.5 text-center text-gray-600">{item.warehouse?.name || item.warehouse?.code || 'N/A'}</td>
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
                  <label className="text-sm font-medium text-gray-700">Category</label>
                  <select
                    aria-label="Product category"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editCategory}
                    onChange={(event) => setEditCategory(event.target.value)}
                  >
                    <option value="">Select a category</option>
                    {BEVERAGE_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Photo</label>
                  <Input type="file" accept="image/*" onChange={(e) => setEditImageFile(e.target.files?.[0] || null)} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Order Format</label>
                  <select
                    aria-label="Product unit"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editUnit}
                    onChange={(e) => {
                      setEditUnit(e.target.value)
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
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <p className="text-xs text-slate-500">Packaging Type</p>
                    <p className="text-sm font-semibold text-slate-800">{editingCategorySpec?.packagingType || 'Select a category'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Unit</p>
                    <p className="text-sm font-semibold text-slate-800">{editingCategorySpec?.looseUnit || 'Select a category'}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Price</label>
                  <Input type="number" step="0.01" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-sky-100 bg-sky-50/60 p-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-sky-950">Retail Loose Unit Price (PHP)</label>
                    <Input type="number" min="0" step="0.01" value={editRetailUnitPrice} onChange={(e) => setEditRetailUnitPrice(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-sky-950">Retail Case/Pack Price (PHP)</label>
                    <Input type="number" min="0" step="0.01" value={editCasePrice} onChange={(e) => setEditCasePrice(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Quantity Per Case</label>
                  <Input type="number" step="1" min="1" value={editQuantityPerUnit} onChange={(e) => setEditQuantityPerUnit(e.target.value)} placeholder="Required" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-gray-700">Packaging Profile</label>
                  <select
                    aria-label="Packaging profile"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={editPackagingProfileId}
                    onChange={(event) => {
                      const id = event.target.value
                      setEditPackagingProfileId(id)
                      const profile = packagingProfiles.find((row) => row.id === id)
                      if (profile) setEditQuantityPerUnit(String(profile.standardUnitsPerCase))
                    }}
                  >
                    <option value="">Standard cases only</option>
                    {packagingProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                </div>
                {editingGlassDeposit ? (
                  <div className="grid grid-cols-2 gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-emerald-900">Deposit per Bottle (PHP)</label>
                      <Input value={editingGlassDeposit.bottle.toFixed(2)} readOnly />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-emerald-900">Deposit per Case (PHP)</label>
                      <Input value={editingGlassDeposit.case.toFixed(2)} readOnly />
                    </div>
                  </div>
                ) : editingCategorySpec?.depositExempt ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">Deposit: Exempt</div>
                ) : null}
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
        <DialogContent className="max-w-5xl w-full">
          <DialogHeader>
            <DialogTitle>Register New Product</DialogTitle>
            <DialogDescription>Add a new product to your inventory system.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="md:col-span-2 space-y-1">
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
                placeholder=""
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Category</label>
              <select
                aria-label="Product category"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={productCategory}
                onChange={(e) => setProductCategory(e.target.value)}
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
                placeholder=""
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
            <div className="md:col-span-2 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <p className="text-xs text-slate-500">Packaging Type</p>
                <p className="text-sm font-semibold text-slate-800">{selectedCategorySpec?.packagingType || 'Select a category'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Unit</p>
                <p className="text-sm font-semibold text-slate-800">{selectedCategorySpec?.looseUnit || 'Select a category'}</p>
              </div>
            </div>
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
            <div className="md:col-span-2 grid grid-cols-2 gap-3 rounded-lg border border-sky-100 bg-sky-50/60 p-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-sky-950">Retail Loose Unit Price (PHP)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productRetailUnitPrice}
                  onChange={(e) => setProductRetailUnitPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-sky-950">Retail Case/Pack Price (PHP)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productCasePrice}
                  onChange={(e) => setProductCasePrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Quantity Per Case</label>
              <Input
                type="number"
                step="1"
                min="1"
                value={productQuantityPerUnit}
                onChange={(e) => setProductQuantityPerUnit(e.target.value)}
                placeholder="Required"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium text-gray-700">Packaging Profile</label>
                <button type="button" className="text-xs font-medium text-blue-600" onClick={() => setPackagingProfilesOpen(true)}>Manage</button>
              </div>
              <select
                aria-label="Packaging profile"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={productPackagingProfileId}
                onChange={(event) => {
                  const id = event.target.value
                  setProductPackagingProfileId(id)
                  const profile = packagingProfiles.find((row) => row.id === id)
                  if (profile) setProductQuantityPerUnit(String(profile.standardUnitsPerCase))
                }}
              >
                <option value="">Standard cases only</option>
                {packagingProfiles.filter((profile) => profile.isActive).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Available Sizes</label>
              <select
                aria-label="Available size"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedProductSize}
                onChange={(e) => setProductSizes(e.target.value ? [e.target.value] : [])}
              >
                <option value="">Select a size</option>
                {SIZE_OPTIONS[productUnit as keyof typeof SIZE_OPTIONS]?.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Total Weight per Unit (kg)</label>
              <Input
                value={selectedProductWeight !== null ? selectedProductWeight.toFixed(2) : ''}
                readOnly
                placeholder=""
              />
            </div>
            {selectedGlassDeposit ? (
              <div className="md:col-span-2 grid grid-cols-2 gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-emerald-900">Deposit per Bottle (PHP)</label>
                  <Input value={selectedGlassDeposit.bottle.toFixed(2)} readOnly />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-emerald-900">Deposit per Case (PHP)</label>
                  <Input value={selectedGlassDeposit.case.toFixed(2)} readOnly />
                </div>
                <p className="col-span-2 text-xs text-emerald-800">Automatically configured for this supported glass-bottle size.</p>
              </div>
            ) : selectedCategorySpec?.depositExempt ? (
              <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">Deposit: Exempt</div>
            ) : null}
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Photo</label>
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => setProductImageFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="md:col-span-2 flex gap-2 pt-4 border-t">
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
                  setProductPackagingProfileId('')
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
      <PackagingProfileDialog
        open={packagingProfilesOpen}
        onOpenChange={setPackagingProfilesOpen}
        profiles={packagingProfiles}
        onSaved={fetchPackagingProfiles}
      />
    </div>
  )
}
