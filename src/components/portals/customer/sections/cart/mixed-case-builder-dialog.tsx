'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Minus, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { quoteMixedCase } from '../orders/orders-api'
import type { CartItem, Product } from '../shared/customer-types'
import { formatLooseQuantity, getBeverageCategorySpec } from '@/lib/beverage-category-specs'

type MixedCaseBuilderDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: Product[]
  editingItem?: CartItem | null
  onSave: (item: CartItem) => void
  formatPeso: (value: number) => string
}

const makeCartKey = () =>
  `mixed:${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`

// Mixed cases use the real case quantity; a separate packaging profile is unnecessary.
const getAllowedCapacities = (product: Product) => {
  const capacity = Math.floor(Number(product.quantityPerCase ?? product.quantityPerUnit ?? 0))
  return Number.isInteger(capacity) && capacity > 0 ? [capacity] : []
}

const getSupportedCapacities = (products: Product[]) => {
  const supportByCapacity = new Map<number, number>()
  products.forEach((product) => {
    getAllowedCapacities(product).forEach((value) => {
      supportByCapacity.set(value, (supportByCapacity.get(value) || 0) + 1)
    })
  })
  return Array.from(supportByCapacity.entries())
    .filter(([, productCount]) => productCount >= 2)
    .map(([value]) => value)
    .sort((a, b) => a - b)
}

export function MixedCaseBuilderDialog({
  open,
  onOpenChange,
  products,
  editingItem,
  onSave,
  formatPeso,
}: MixedCaseBuilderDialogProps) {
  const groups = useMemo(() => {
    const map = new Map<string, Product[]>()
    products.forEach((product) => {
      const categorySpec = getBeverageCategorySpec(product.category)
      const orderFormat = String((product as any)?.unit || '').trim().toLowerCase()
      // Mixed Case is only available for full cases of carbonated glass bottles.
      if ((product as any)?.isActive === false || categorySpec?.category !== 'Carbonated (Glass)' || orderFormat !== 'case' || Number(product.availableBaseUnits || 0) <= 0) return
      const rows = map.get(categorySpec.compatibilityKey) || []
      rows.push(product)
      map.set(categorySpec.compatibilityKey, rows)
    })
    return Array.from(map.entries())
      .filter(([, rows]) => getSupportedCapacities(rows).length > 0)
      .map(([key, rows]) => ({ key, products: rows }))
  }, [products])

  const [groupKey, setGroupKey] = useState('')
  const [capacity, setCapacity] = useState(0)
  const [caseCount, setCaseCount] = useState(1)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [isQuoting, setIsQuoting] = useState(false)

  const selectedGroup = groups.find((group) => group.key === groupKey) || groups[0]
  const capacities = useMemo(() => {
    if (!selectedGroup) return []
    return getSupportedCapacities(selectedGroup.products)
  }, [selectedGroup])
  const eligibleProducts = useMemo(
    () => (selectedGroup?.products || []).filter((product) => getAllowedCapacities(product).includes(capacity)),
    [capacity, selectedGroup]
  )

  useEffect(() => {
    if (!open) return
    if (editingItem?.itemType === 'MIXED_CASE') {
      const firstProductId = editingItem.components?.[0]?.productId
      const firstProduct = products.find((product) => product.id === firstProductId)
      setGroupKey(getBeverageCategorySpec(firstProduct?.category)?.compatibilityKey || groups[0]?.key || '')
      setCapacity(Number(editingItem.caseCapacity || 0))
      setCaseCount(Math.max(1, Number(editingItem.quantity || 1)))
      setQuantities(
        Object.fromEntries((editingItem.components || []).map((component) => [component.productId, component.quantityPerCase]))
      )
      return
    }
    const initialGroup = groups[0]
    setGroupKey(initialGroup?.key || '')
    setCapacity(getSupportedCapacities(initialGroup?.products || [])[0] || 0)
    setCaseCount(1)
    setQuantities({})
  }, [open, editingItem, groups, products])

  useEffect(() => {
    if (capacities.length === 0) {
      setCapacity(0)
      setQuantities({})
      return
    }
    if (!capacities.includes(capacity)) {
      setCapacity(capacities[0])
      setQuantities({})
    }
  }, [capacities, capacity])

  const selectedRows = eligibleProducts
    .map((product) => ({ product, quantity: Math.max(0, Number(quantities[product.id] || 0)) }))
    .filter((row) => row.quantity > 0)
  const added = selectedRows.reduce((sum, row) => sum + row.quantity, 0)
  const remaining = Math.max(0, capacity - added)
  const exceeds = added > capacity
  const complete = capacity > 0 && added === capacity && selectedRows.length >= 2
  const estimatedPerCase = selectedRows.reduce(
    (sum, row) => sum + Number(row.product.baseUnitPrice || 0) * row.quantity,
    0
  )

  const clampQuantities = (nextCapacity: number, nextCaseCount: number) => {
    setQuantities((current) => {
      let availableCapacity = Math.max(0, nextCapacity)
      const next: Record<string, number> = {}
      ;(selectedGroup?.products || []).forEach((product) => {
        if (!getAllowedCapacities(product).includes(nextCapacity)) {
          next[product.id] = 0
          return
        }
        const stockLimit = Math.floor(Number(product.availableBaseUnits || 0) / Math.max(1, nextCaseCount))
        const requested = Number(current[product.id])
        const safeRequested = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0
        const value = Math.min(stockLimit, availableCapacity, safeRequested)
        next[product.id] = value
        availableCapacity -= value
      })
      return next
    })
  }

  const updateCapacity = (nextValue: number) => {
    const nextCapacity = Math.max(0, Math.floor(Number(nextValue || 0)))
    setCapacity(nextCapacity)
    clampQuantities(nextCapacity, caseCount)
  }

  const updateCaseCount = (nextValue: number) => {
    const nextCaseCount = Math.max(1, Math.floor(Number(nextValue || 1)))
    setCaseCount(nextCaseCount)
    clampQuantities(capacity, nextCaseCount)
  }

  const updateQuantity = (product: Product, nextValue: number) => {
    const availableForEachCase = Math.floor(Number(product.availableBaseUnits || 0) / Math.max(1, caseCount))
    const currentQuantity = Math.max(0, Number(quantities[product.id] || 0))
    const requestedQuantity = Math.max(0, Math.floor(Number(nextValue || 0)))
    if (requestedQuantity > currentQuantity + remaining) {
      toast.error(`Cannot add ${requestedQuantity - currentQuantity} units. Only ${remaining} units remain available in this case.`)
    }
    setQuantities((current) => {
      const addedByOtherProducts = eligibleProducts.reduce(
        (sum, row) => row.id === product.id ? sum : sum + Math.max(0, Number(current[row.id] || 0)),
        0
      )
      const availableCapacity = Math.max(0, capacity - addedByOtherProducts)
      const parsedNextValue = Number(nextValue)
      const safeNextValue = Number.isFinite(parsedNextValue) ? Math.floor(parsedNextValue) : 0
      const next = Math.max(
        0,
        Math.min(availableForEachCase, availableCapacity, safeNextValue)
      )
      return { ...current, [product.id]: next }
    })
  }

  const save = async () => {
    if (!complete || exceeds) {
      toast.error('Complete the Mixed Case with at least two products before adding it.')
      return
    }
    setIsQuoting(true)
    try {
      const { response, data } = await quoteMixedCase({
        caseCapacity: capacity,
        quantity: caseCount,
        components: selectedRows.map((row) => ({ productId: row.product.id, quantity: row.quantity })),
      })
      if (!response.ok || data?.success === false) throw new Error(data?.error || 'Unable to validate Mixed Case')
      const quote = data.quote
      const maxCases = Math.min(
        ...quote.components.map((component: any) => {
          const product = products.find((row) => row.id === component.productId)
          return Math.floor(Number(product?.availableBaseUnits || 0) / Math.max(1, Number(component.quantityPerCase || 1)))
        })
      )
      // Keep the selected product data on each component so mixed-case cards can show both images.
      const mixedComponents = quote.components.map((component: any) => ({
        ...component,
        product: products.find((product) => String(product.id) === String(component.productId)) || null,
      }))
      const firstProduct = mixedComponents[0]?.product
      onSave({
        productId: editingItem?.productId || makeCartKey(),
        itemType: 'MIXED_CASE',
        name: `Mixed Case — ${quote.caseCapacity} units`,
        sku: 'MIXED-CASE',
        imageUrl: firstProduct?.imageUrl || null,
        unit: 'mixed case',
        sizeLabel: `${quote.caseCapacity} units`,
        unitPrice: Number(quote.unitPrice || 0),
        quantity: Number(quote.caseCount || caseCount),
        available: Math.max(1, maxCases),
        caseCapacity: Number(quote.caseCapacity),
        components: mixedComponents,
      })
      onOpenChange(false)
      toast.success(editingItem ? 'Mixed Case updated' : 'Mixed Case added to cart')
    } catch (error: any) {
      toast.error(error?.message || 'Unable to validate Mixed Case')
    } finally {
      setIsQuoting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{editingItem ? 'Edit Mixed Case' : 'Build a Mixed Case'}</DialogTitle>
        </DialogHeader>

        {groups.length === 0 ? (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            At least two in-stock products with the same packaging type and case capacity are required.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-700">Packaging Type</span>
                <select
                  value={selectedGroup?.key || ''}
                  onChange={(event) => {
                    setGroupKey(event.target.value)
                    setQuantities({})
                  }}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3"
                >
                  {groups.map((group) => (
                    <option key={group.key} value={group.key}>{getBeverageCategorySpec(group.products[0]?.category)?.packagingType || group.key}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-700">Case capacity</span>
                <select
                  value={capacity}
                  onChange={(event) => updateCapacity(Number(event.target.value))}
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3"
                >
                  {capacities.map((value) => <option key={value} value={value}>{value} units</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-700">Number of cases</span>
                <Input type="number" min={1} value={caseCount} onChange={(event) => updateCaseCount(Number(event.target.value))} />
              </label>
            </div>

            <div className={`grid grid-cols-3 gap-2 rounded-xl p-3 text-center text-sm ${exceeds ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>
              <div><p className="text-xs opacity-70">Capacity</p><p className="text-lg font-bold">{capacity}</p></div>
              <div><p className="text-xs opacity-70">Added</p><p className="text-lg font-bold">{added}</p></div>
              <div><p className="text-xs opacity-70">Remaining</p><p className="text-lg font-bold">{remaining}</p></div>
            </div>

            <div className="space-y-2">
              {eligibleProducts.map((product) => {
                const quantity = Math.max(0, Number(quantities[product.id] || 0))
                const label = getBeverageCategorySpec(product.category)?.looseUnit || product.looseUnit || 'unit'
                const maxForCases = Math.floor(Number(product.availableBaseUnits || 0) / Math.max(1, caseCount))
                const maxAllowedForRow = Math.min(maxForCases, quantity + remaining)
                return (
                  <div key={product.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{product.name}</p>
                      <p className="text-xs text-slate-500">{formatLooseQuantity(maxForCases, label)} available per case · {formatPeso(Number(product.baseUnitPrice || 0))}/{label}</p>
                      {quantity > 0 ? <p className="text-xs font-medium text-emerald-700">Subtotal/case: {formatPeso(Number(product.baseUnitPrice || 0) * quantity)}</p> : null}
                    </div>
                    <div className="flex items-center rounded-lg border border-slate-200">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => updateQuantity(product, quantity - 1)}
                        aria-label={quantity <= 1 ? `Remove ${product.name} from Mixed Case` : `Decrease ${product.name} quantity`}
                      >
                        {quantity <= 1 ? <Trash2 aria-hidden="true" className="h-4 w-4" /> : <Minus aria-hidden="true" className="h-4 w-4" />}
                      </Button>
                      <Input
                        className="h-9 w-16 border-0 text-center shadow-none"
                        type="number"
                        min={0}
                        max={maxAllowedForRow}
                        value={quantity}
                        onChange={(event) => updateQuantity(product, Number(event.target.value))}
                        aria-label={`${product.name} quantity per Mixed Case`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => updateQuantity(product, quantity + 1)}
                        disabled={quantity >= maxAllowedForRow}
                        aria-label={`Increase ${product.name} quantity`}
                      >
                        <Plus aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
              <div>
                <p className="text-xs text-slate-500">Estimated Mixed Case total</p>
                <p className="text-xl font-bold text-emerald-700">{formatPeso(estimatedPerCase * caseCount)}</p>
              </div>
              <Button onClick={save} disabled={!complete || exceeds || isQuoting} className="bg-emerald-600 hover:bg-emerald-500">
                {isQuoting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingItem ? 'Save changes' : 'Add Mixed Case'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
