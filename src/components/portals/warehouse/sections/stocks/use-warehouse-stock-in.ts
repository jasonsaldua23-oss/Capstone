import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { emitDataSync } from '@/lib/data-sync'
import type { InventoryItem, ProductOption, StockBatchItem, StockRow, WarehouseItem } from '../../warehouse-portal-types'
import { getLocalDateInputValue } from '../../warehouse-portal-utils'
import { getInventoryAlertLevel, getInventoryAvailableQty, getInventoryThreshold, isInventoryOverstocked } from '@/lib/report-metrics'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

/**
 * Stock-in (bulk receive) and stock-batch editing: the form rows, their validation and CSV import, and the submit paths.
 */
export type WarehouseStockInInputs = {
  assignedWarehouse: WarehouseItem | null
  inventory: InventoryItem[]
  isWarehouseScopedUser: boolean
  products: ProductOption[]
  setStockInWarehouseId: Dispatch<SetStateAction<string>>
  stockInWarehouseId: string
  warehouses: WarehouseItem[]
}

export function useWarehouseStockIn(inputs: WarehouseStockInInputs) {
  const {
    assignedWarehouse,
    inventory,
    isWarehouseScopedUser,
    products,
    setStockInWarehouseId,
    stockInWarehouseId,
    warehouses,
  } = inputs

  const [editingBatch, setEditingBatch] = useState<StockBatchItem | null>(null)
  const [editBatchQuantity, setEditBatchQuantity] = useState('')
  const [editBatchManufacturedDate, setEditBatchManufacturedDate] = useState('')
  const [editBatchExpiryDate, setEditBatchExpiryDate] = useState('')
  const [isSavingBatchQty, setIsSavingBatchQty] = useState(false)
  const [addStockOpen, setAddStockOpen] = useState(false)
  const [isSubmittingStockIn, setIsSubmittingStockIn] = useState(false)
  const [stockRows, setStockRows] = useState<StockRow[]>([
    { id: `row-${Date.now()}-0`, productId: '', quantity: '', manufacturedDate: '', expiryDate: '', validationErrors: {} }
  ])
  const getItemThreshold = (item: InventoryItem | null | undefined) => getInventoryThreshold(item)
  const isOverstockedInventoryItem = (item: InventoryItem | null | undefined) => isInventoryOverstocked(item)
  const stockInSubmissionRef = useRef(false)
  const stockInRequestIdRef = useRef('')
  const availableExistingProducts = useMemo(() => {
    const targetWarehouseId = String(stockInWarehouseId || '').trim()
    if (!targetWarehouseId) return []

    const inventoryForWarehouse = inventory.filter((item) => String(item?.warehouse?.id || '') === targetWarehouseId)
    const seen = new Set<string>()
    const fromInventory: ProductOption[] = []

    for (const item of inventoryForWarehouse) {
      const productId = String(item?.product?.id || '').trim()
      if (!productId || seen.has(productId)) continue
      seen.add(productId)
      const threshold = getItemThreshold(item)
      const qty = Number((item as any)?.quantity ?? 0) || 0
      const reserved = Number((item as any)?.reservedQuantity ?? (item as any)?.reserved_quantity ?? 0) || 0
      const available = Math.max(0, qty - reserved)
      const lastRestockedRaw = (item as any)?.lastRestockedAt ?? (item as any)?.last_restocked_at ?? (item as any)?.updatedAt ?? (item as any)?.updated_at
      const lastRestockedAt = lastRestockedRaw ? new Date(lastRestockedRaw) : null
      const daysSinceRestock = lastRestockedAt && !Number.isNaN(lastRestockedAt.getTime())
        ? Math.max(0, Math.floor((Date.now() - lastRestockedAt.getTime()) / (24 * 60 * 60 * 1000)))
        : 0
      const isOverstocked = isOverstockedInventoryItem(item)
      const inventoryStatus = getInventoryAlertLevel(item)
      fromInventory.push({
        id: productId,
        sku: String(item?.product?.sku || '').trim(),
        name: String(item?.product?.name || '').trim(),
        price: Number(item?.product?.price || 0),
        unit: String(item?.product?.unit || 'case').trim(),
        sizes: Array.isArray(item?.product?.sizes) ? item.product.sizes : [],
        category: String((item?.product as any)?.category?.name || (item?.product as any)?.category || '').trim(),
        inventoryStatus,
        isOverstocked,
        overstockInfo: isOverstocked
          ? {
              available,
              threshold,
              daysSinceRestock,
            }
          : null,
      })
    }

    const withFallbackNames = fromInventory.map((entry) => {
      const fallback = products.find((p) => p.id === entry.id)
      return {
        ...entry,
        sku: entry.sku || String(fallback?.sku || '').trim(),
        name: entry.name || String(fallback?.name || '').trim(),
        price: Number(entry.price || fallback?.price || 0),
        unit: entry.unit || String(fallback?.unit || 'case').trim(),
        sizes: (entry.sizes && entry.sizes.length > 0) ? entry.sizes : (Array.isArray(fallback?.sizes) ? fallback.sizes : []),
        category: entry.category || String((fallback as any)?.category?.name || (fallback as any)?.category || '').trim(),
      }
    })

    return withFallbackNames
      .filter((entry) => entry.id && entry.name)
      .sort((a, b) => `${a.sku} ${a.name}`.localeCompare(`${b.sku} ${b.name}`))
  }, [inventory, products, stockInWarehouseId])
  const getAvailableQty = (item: InventoryItem) => getInventoryAvailableQty(item)

  const getStockStatus = (item: InventoryItem) => {
    const level = getInventoryAlertLevel(item)
    // Fix: preserve the zero-stock state instead of grouping it with positive low stock.
    if (level === 'out_of_stock') return 'out_of_stock'
    if (level === 'overstocked') return 'overstocked'
    return level === 'healthy' ? 'healthy' : 'restock'
  }

  const openBatchQuantityDialog = (batch: StockBatchItem) => {
    setEditingBatch(batch)
    setEditBatchQuantity(String(Math.max(0, Number(batch.quantity || 0))))
    // Added: populate the batch dates so warehouse staff can update them with the quantity.
    setEditBatchManufacturedDate(batch.receiptDate ? new Date(batch.receiptDate).toISOString().slice(0, 10) : '')
    setEditBatchExpiryDate(batch.expiryDate ? new Date(batch.expiryDate).toISOString().slice(0, 10) : '')
  }

  const saveStockBatchChanges = async () => {
    if (!editingBatch?.id) return
    const nextQuantity = Number(editBatchQuantity)
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
      toast.error('Quantity must be a non-negative number')
      return
    }
    if (!editBatchManufacturedDate) {
      toast.error('Manufactured date is required')
      return
    }
    if (editBatchExpiryDate && editBatchExpiryDate < getLocalDateInputValue()) {
      toast.error('Expiry date cannot be in the past. Enter today or a future date.')
      return
    }

    setIsSavingBatchQty(true)
    try {
      const response = await fetch('/api/stock-batches', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Added: save the batch dates in the same update as its quantity.
        body: JSON.stringify({
          batchId: editingBatch.id,
          quantity: Math.floor(nextQuantity),
          manufacturedDate: editBatchManufacturedDate,
          expiryDate: editBatchExpiryDate || null,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update stock batch')
      }

      setEditingBatch(null)
      toast.success('Stock batch updated')
      emitDataSync(['inventory', 'stock-batches', 'inventory-transactions'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update stock batch')
    } finally {
      setIsSavingBatchQty(false)
    }
  }

  const resetStockInForm = () => {
    stockInRequestIdRef.current = ''
    setStockRows([
      { id: `row-${Date.now()}-0`, productId: '', quantity: '', manufacturedDate: '', expiryDate: '', validationErrors: {} }
    ])
    if (!isWarehouseScopedUser || !assignedWarehouse?.id) {
      setStockInWarehouseId('')
    }
  }

  // Row management functions
  const addStockRow = () => {
    const newRow: StockRow = {
      id: `row-${Date.now()}-${Math.random()}`,
      productId: '',
      quantity: '',
      manufacturedDate: '',
      expiryDate: '',
      validationErrors: {}
    }
    setStockRows([...stockRows, newRow])
  }

  const removeStockRow = (rowId: string) => {
    if (stockRows.length > 1) {
      setStockRows(stockRows.filter(r => r.id !== rowId))
    }
  }

  const updateStockRow = (rowId: string, field: keyof Omit<StockRow, 'id' | 'validationErrors'>, value: string) => {
    setStockRows((prevRows) => prevRows.map((row) => {
      if (row.id === rowId) {
        const updatedRow = { ...row, [field]: value, validationErrors: {} }
        return updatedRow
      }
      return row
    }))
  }

  const validateStockRow = (row: StockRow) => {
    const errors: StockRow['validationErrors'] = {}
    if (!row.productId.trim()) errors.productId = 'Product is required'
    const selectedProduct = availableExistingProducts.find((p) => p.id === row.productId.trim())
    if (selectedProduct?.isOverstocked) {
      const info = selectedProduct.overstockInfo
      if (info) {
        errors.productId = `Overstocked: available ${info.available}, threshold ${info.threshold}, ${info.daysSinceRestock} days since restock`
      } else {
        errors.productId = 'Product is overstocked and cannot be restocked right now'
      }
    }
    if (!row.quantity.trim()) errors.quantity = 'Quantity is required'
    else if (isNaN(Number(row.quantity)) || Number(row.quantity) <= 0) errors.quantity = 'Quantity must be > 0'
    if (!row.expiryDate.trim()) errors.expiryDate = 'Expiry date is required'
    else if (row.expiryDate < getLocalDateInputValue()) {
      errors.expiryDate = 'Expiry date cannot be in the past. Enter today or a future date.'
    }
    return errors
  }

  const validateAllStockRows = () => {
    let hasErrors = false
    const selectedCounts = stockRows.reduce<Record<string, number>>((acc, row) => {
      const key = row.productId.trim()
      if (!key) return acc
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    const updatedRows = stockRows.map(row => {
      const errors = validateStockRow(row)
      const key = row.productId.trim()
      if (key && (selectedCounts[key] || 0) > 1) {
        errors.productId = 'Product already selected in another row'
      }
      if (Object.keys(errors).length > 0) hasErrors = true
      return { ...row, validationErrors: errors }
    })
    setStockRows(updatedRows)
    return !hasErrors
  }

  // CSV parsing function
  const parseCSVData = (csvText: string): StockRow[] => {
    const lines = csvText.trim().split('\n').filter(line => line.trim())
    const newRows: StockRow[] = []

    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim())
      if (parts.length < 2) continue

      const productIdentifier = parts[0]
      const quantity = parts[1]
      const manufacturedDate = parts[2] || ''
      const expiryDate = parts[3] || ''

      // Find product by SKU or name
      const matchedProduct = availableExistingProducts.find(
        p => p.sku === productIdentifier || p.name === productIdentifier || p.id === productIdentifier
      )

      if (matchedProduct && quantity) {
        newRows.push({
          id: `row-${Date.now()}-${Math.random()}`,
          productId: matchedProduct.id,
          quantity: quantity,
          manufacturedDate: manufacturedDate,
          expiryDate: expiryDate,
          validationErrors: {}
        })
      }
    }

    return newRows
  }

  // Keyboard navigation
  const handleStockModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isSubmittingStockIn) {
      setAddStockOpen(false)
    }

    // Handle Ctrl+V / Cmd+V for CSV paste
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && e.target instanceof HTMLDivElement) {
      e.preventDefault()
      navigator.clipboard.readText().then(text => {
        const parsedRows = parseCSVData(text)
        if (parsedRows.length > 0) {
          setStockRows(parsedRows)
          toast.success(`${parsedRows.length} rows imported from clipboard`)
        }
      }).catch(() => {
        toast.error('Failed to read clipboard')
      })
    }
  }

  const openAddStockDialog = () => {
    if (isWarehouseScopedUser && assignedWarehouse?.id) {
      setStockInWarehouseId(assignedWarehouse.id)
    } else if (!stockInWarehouseId && warehouses[0]?.id) {
      setStockInWarehouseId(warehouses[0].id)
    }
    setAddStockOpen(true)
  }

  const addStockInBatch = async () => {
    if (!stockInWarehouseId) {
      toast.error('Please select a warehouse')
      return
    }

    // Validate all rows before submitting
    if (!validateAllStockRows()) return
    // Prevent a rapid double-click from sending the same stock quantities twice.
    if (stockInSubmissionRef.current) return
    stockInSubmissionRef.current = true

    if (!stockInRequestIdRef.current) {
      stockInRequestIdRef.current = `STOCKIN-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }

    // Prepare batches
    const batches = stockRows.map((row, index) => ({
      productId: row.productId,
      quantity: Number(row.quantity),
      manufacturedDate: row.manufacturedDate || null,
      expiryDate: row.expiryDate || null,
      // A stable batch number makes a retry idempotent instead of duplicating stock.
      batchNumber: `${stockInRequestIdRef.current}-${index}`,
    }))

    setIsSubmittingStockIn(true)
    try {
      const response = await fetch('/api/stock-batches/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId: stockInWarehouseId,
          batches: batches
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to add stock')
      }

      const created = payload?.created || 0
      const failed = payload?.failed || 0

      if (created > 0) {
        toast.success(`${created} of ${created + failed} stock entries added successfully`)
      }
      if (failed > 0) {
        toast.error(`${failed} entries failed`)
      }

      setAddStockOpen(false)
      resetStockInForm()
      emitDataSync(['inventory', 'products', 'stock-batches', 'inventory-transactions'])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add stock')
    } finally {
      stockInSubmissionRef.current = false
      setIsSubmittingStockIn(false)
    }
  }

  return {
    addStockInBatch,
    addStockOpen,
    addStockRow,
    availableExistingProducts,
    editBatchExpiryDate,
    editBatchManufacturedDate,
    editBatchQuantity,
    editingBatch,
    getAvailableQty,
    getStockStatus,
    isSavingBatchQty,
    isSubmittingStockIn,
    openAddStockDialog,
    openBatchQuantityDialog,
    removeStockRow,
    resetStockInForm,
    saveStockBatchChanges,
    setAddStockOpen,
    setEditBatchExpiryDate,
    setEditBatchManufacturedDate,
    setEditBatchQuantity,
    setEditingBatch,
    stockRows,
    updateStockRow,
  }
}

/** Everything the hook manages, for the dialogs that render it. */
export type WarehouseStockIn = ReturnType<typeof useWarehouseStockIn>
