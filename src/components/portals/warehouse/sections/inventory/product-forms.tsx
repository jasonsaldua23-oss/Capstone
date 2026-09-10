'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { emitDataSync } from '@/lib/data-sync'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { Archive, ArrowLeft, Loader2, RotateCcw } from 'lucide-react'
import { BEVERAGE_CATEGORIES, getBeverageCategorySpec } from '@/lib/beverage-category-specs'
import { calculateProductWeightKg } from '@/lib/product-weight'

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

// Moved: the complete admin product forms now belong to warehouse inventory.
export function WarehouseProductForms({ warehouse, products = [], children }: {
  warehouse?: { id: string; name?: string; code?: string } | null
  products?: any[]
  children: (actions: { openEditDialog: (item: any) => void; openRegisterProductDialog: () => void; openArchivedProductsPage: () => void }) => ReactNode
}) {
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
  const [archiveProductOpen, setArchiveProductOpen] = useState(false)
  const [isArchivingProduct, setIsArchivingProduct] = useState(false)
  const [showArchivedProducts, setShowArchivedProducts] = useState(false)
  const [archivedProducts, setArchivedProducts] = useState<any[]>([])
  const [archivedSearch, setArchivedSearch] = useState('')
  const [loadingArchivedProducts, setLoadingArchivedProducts] = useState(false)
  const [restoringProductId, setRestoringProductId] = useState<string | null>(null)
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
  const [productBottleDeposit, setProductBottleDeposit] = useState('')
  const [productCaseDeposit, setProductCaseDeposit] = useState('')
  const [editBottleDeposit, setEditBottleDeposit] = useState('')
  const [editCaseDeposit, setEditCaseDeposit] = useState('')
  const createSkuSeed = () => Math.random().toString(36).slice(2, 7).toUpperCase()
  const normalizeProductIdentityPart = (value: unknown) =>
    String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
  // Match the backend rule before uploading an image or submitting the form.
  const hasDuplicateProduct = (name: string, size: string, category: string, excludeId?: string) =>
    [...products, ...archivedProducts].some((product: any) => {
      if (String(product?.id || '') === String(excludeId || '')) return false
      const existingCategory = product?.category?.name || product?.category
      const existingSizes = Array.isArray(product?.sizes) ? product.sizes : []
      return normalizeProductIdentityPart(product?.name) === normalizeProductIdentityPart(name)
        && normalizeProductIdentityPart(existingCategory) === normalizeProductIdentityPart(category)
        && existingSizes.some((value: unknown) => normalizeProductIdentityPart(value) === normalizeProductIdentityPart(size))
    })

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
  const editImagePreviewUrl = useMemo(
    () => editImageFile ? URL.createObjectURL(editImageFile) : String(editingItem?.product?.imageUrl || ''),
    [editImageFile, editingItem]
  )

  useEffect(() => {
    // Clean up only temporary browser previews; persisted image URLs remain untouched.
    return () => {
      if (editImagePreviewUrl.startsWith('blob:')) URL.revokeObjectURL(editImagePreviewUrl)
    }
  }, [editImagePreviewUrl])

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
    if (hasDuplicateProduct(editName, editSize, editCategory, editingItem.product.id)) {
      return toast.error('A product with the same name, size, and category already exists.')
    }
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
      emitDataSync(['inventory', 'products', 'stock-batches'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save changes')
    } finally {
      setIsSavingEdit(false)
    }
  }

  const archiveProduct = async () => {
    if (!editingItem?.product?.id || isArchivingProduct) return

    setIsArchivingProduct(true)
    try {
      const response = await fetch(`/api/products/${editingItem.product.id}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to archive product')
      }

      toast.success('Product archived successfully')
      setArchiveProductOpen(false)
      setEditingItem(null)
      // Refresh every inventory view that may still contain the archived product.
      emitDataSync(['inventory', 'products', 'stock-batches'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to archive product')
    } finally {
      setIsArchivingProduct(false)
    }
  }

  const openArchivedProductsPage = async () => {
    setShowArchivedProducts(true)
    setLoadingArchivedProducts(true)
    try {
      const response = await fetch('/api/products?archived=true&pageSize=1000', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Failed to load archived products')
      setArchivedProducts(Array.isArray(payload?.products) ? payload.products : [])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load archived products')
    } finally {
      setLoadingArchivedProducts(false)
    }
  }

  const restoreProduct = async (product: any) => {
    const productId = String(product?.id || '')
    if (!productId || restoringProductId) return
    setRestoringProductId(productId)
    try {
      const response = await fetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Failed to restore product')
      setArchivedProducts((current) => current.filter((item) => String(item.id) !== productId))
      toast.success(`${product.name || 'Product'} restored successfully`)
      emitDataSync(['inventory', 'products', 'stock-batches'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to restore product')
    } finally {
      setRestoringProductId(null)
    }
  }

  const registerProduct = async () => {
    if (!warehouse?.id) return toast.error('Your assigned warehouse is required')
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
    if (hasDuplicateProduct(productName, selectedProductSize, productCategory)) {
      return toast.error('A product with the same name, size, and category already exists.')
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
          // Registration uses the assigned warehouse without displaying a redundant form field.
          warehouseId: warehouse?.id,
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
      setProductBottleDeposit('')
      setProductCaseDeposit('')
      emitDataSync(['inventory', 'products', 'stock-batches'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to register product')
    } finally {
      setIsSubmittingProduct(false)
    }
  }

  const openRegisterProductDialog = () => {
    // Added: each registration starts with a fresh SKU and the assigned warehouse.
    setProductName(''); setProductSku(''); setProductSkuSeed(createSkuSeed())
    setProductUnit('case'); setProductQuantityPerUnit(''); setProductPrice('')
    setProductCategory(''); setProductSizes([]); setProductImageFile(null)
    setProductBottleDeposit(''); setProductCaseDeposit('')
    setRegisterProductOpen(true)
  }

  const archivedQuery = archivedSearch.trim().toLowerCase()
  const filteredArchivedProducts = archivedProducts.filter((product) =>
    [product?.name, product?.sku, product?.category, ...(Array.isArray(product?.sizes) ? product.sizes : [])]
      .some((value) => String(value || '').toLowerCase().includes(archivedQuery))
  )

  return (
    <>
      {showArchivedProducts ? (
        <div className="space-y-5 rounded-xl border bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="icon" onClick={() => setShowArchivedProducts(false)} aria-label="Back to inventory">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Archived Products</h2>
                <p className="text-sm text-slate-500">Restore products to make them available in inventory again.</p>
              </div>
            </div>
            <Input
              aria-label="Search archived products"
              placeholder="Search archived products…"
              value={archivedSearch}
              onChange={(event) => setArchivedSearch(event.target.value)}
              className="w-full sm:max-w-xs"
            />
          </div>

          {loadingArchivedProducts ? (
            <div className="flex h-40 items-center justify-center text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading archived products…
            </div>
          ) : filteredArchivedProducts.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed text-slate-500">
              {archivedQuery ? 'No archived products match your search.' : 'No archived products.'}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b bg-slate-50 text-slate-600">
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
                        <Button type="button" variant="outline" onClick={() => void restoreProduct(product)} disabled={restoringProductId === String(product.id)}>
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
        </div>
      ) : children({ openEditDialog, openRegisterProductDialog, openArchivedProductsPage })}
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
                    {editImagePreviewUrl ? (
                      // Fix: the existing preview occupies the compact white upload field itself.
                      <label className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-md border border-input bg-white px-3 hover:bg-slate-50">
                        <img
                          src={editImagePreviewUrl}
                          alt={`${editingItem.product?.name || 'Product'} preview`}
                          className="h-8 w-8 shrink-0 rounded object-contain"
                        />
                        {/* Added: identify the current product beside its photo in the upload field. */}
                        <span className="truncate text-sm text-gray-700">
                          {editingItem.product?.name || 'Product photo'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(event) => setEditImageFile(event.target.files?.[0] || null)}
                        />
                      </label>
                    ) : (
                      <Input type="file" accept="image/*" onChange={(event) => setEditImageFile(event.target.files?.[0] || null)} />
                    )}
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

                <div className="md:col-span-2 flex flex-col-reverse gap-3 border-t pt-3 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                    onClick={() => setArchiveProductOpen(true)}
                    disabled={isSavingEdit || isArchivingProduct}
                  >
                    <Archive className="mr-2 h-4 w-4" />
                    Archive Product
                  </Button>
                  <Button className="flex-1 bg-blue-600 text-white hover:bg-blue-700" onClick={saveInventoryEdit} disabled={isSavingEdit}>
                    {isSavingEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Save Changes
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiveProductOpen} onOpenChange={setArchiveProductOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-amber-600">Archive Product?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive{' '}
              <span className="font-semibold text-foreground">{editingItem?.product?.name}</span>?
              {' '}The product can only be archived when its available stock, loose bottles, and order reservations are all zero.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchivingProduct}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={(event) => {
                // Keep the confirmation open until the server accepts the archive request.
                event.preventDefault()
                void archiveProduct()
              }}
              disabled={isArchivingProduct}
            >
              {isArchivingProduct ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Archive Product
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
    </>
  )
}
