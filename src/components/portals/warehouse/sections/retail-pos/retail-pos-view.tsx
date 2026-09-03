'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  Minus,
  Package,
  Plus,
  Printer,
  Receipt,
  ReceiptText,
  Recycle,
  RefreshCw,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatPhilippinePhoneInput } from '@/lib/philippine-phone'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import { getTabAuthToken } from '@/lib/client-auth'

type RetailProduct = {
  id: string
  sku: string
  name: string
  imageUrl?: string | null
  category: string
  packagingType: string
  looseUnit: string
  sizes?: string[]
  retailUnitPrice?: string | null
  casePrice: string
  caseQuantity: number
  depositPerUnit: string
  caseDeposit: string
  depositEligible: boolean
  depositExempt: boolean
  availableBaseUnits: number
  availableCases: number
  supportedModes: Array<'LOOSE' | 'CASE' | 'MIXED_CASE'>
  mixedCaseCapacities: number[]
}

type RetailCartLine = {
  key: string
  mode: 'LOOSE' | 'CASE' | 'MIXED_CASE'
  productId?: string
  quantity: number
  caseCapacity?: number
  emptyBottlesProvided?: number
  components?: Array<{ productId: string; quantityBaseUnits: number; emptyBottlesProvided: number }>
}

type RetailSale = Record<string, any>

const peso = (value: unknown) =>
  `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const getProductSizeLabel = (p?: RetailProduct | null) =>
  Array.isArray(p?.sizes) && p.sizes.length > 0 ? ` (${p.sizes.join(', ')})` : ''

const getProductPrimarySize = (p?: RetailProduct | null) => {
  if (!p || !Array.isArray(p.sizes) || p.sizes.length === 0) return ''
  return p.sizes[0]
}

// Receipt records carry product sizes as an array so the sold variant remains visible.
const getReceiptItemSize = (item: any) => {
  const sizes = Array.isArray(item?.sizes)
    ? item.sizes.map((size: any) => String(size || '').trim()).filter(Boolean)
    : []
  return sizes.join(', ') || String(item?.sizeLabel || item?.size || '').trim()
}

async function authFetch(url: string, init?: RequestInit) {
  const token = getTabAuthToken()
  const headers = new Headers(init?.headers || {})
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  })
  const text = await response.text()
  let payload: any = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { error: response.status === 401 ? 'Unauthorized. Please refresh or log in again.' : `Server returned status ${response.status}` }
  }
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`)
  }
  return payload
}

export function WarehouseRetailPosView({ warehouseId }: { warehouseId: string }) {
  const [products, setProducts] = useState<RetailProduct[]>([])
  const [sales, setSales] = useState<RetailSale[]>([])
  const [cart, setCart] = useState<RetailCartLine[]>([])
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [receipt, setReceipt] = useState<RetailSale | null>(null)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [walkInFirstName, setWalkInFirstName] = useState('')
  const [walkInLastName, setWalkInLastName] = useState('')
  const [walkInMiddleName, setWalkInMiddleName] = useState('')
  const [walkInContact, setWalkInContact] = useState('')
  const [walkInNotes, setWalkInNotes] = useState('')
  const fulfillmentType = 'IMMEDIATE'
  const [mixedCapacity, setMixedCapacity] = useState(12)
  const [mixedProductA, setMixedProductA] = useState('')
  const [mixedProductB, setMixedProductB] = useState('')
  const [mixedQuantityA, setMixedQuantityA] = useState(6)

  const printReceipt = () => {
    const receiptElement = document.getElementById('retail-pos-print-receipt')
    if (!receiptElement) return

    // Print a direct body child so the Radix dialog's fixed centering cannot clip the receipt.
    document.getElementById('retail-pos-print-copy')?.remove()
    const printCopy = receiptElement.cloneNode(true) as HTMLElement
    printCopy.id = 'retail-pos-print-copy'
    printCopy.className = ''
    printCopy.setAttribute('aria-hidden', 'true')
    printCopy.style.display = 'none'
    printCopy.style.setProperty('position', 'static', 'important')
    printCopy.style.setProperty('inset', 'auto', 'important')
    printCopy.style.setProperty('translate', 'none', 'important')
    printCopy.style.setProperty('transform', 'none', 'important')
    printCopy.style.setProperty('scale', 'none', 'important')
    printCopy.style.setProperty('animation', 'none', 'important')
    printCopy.style.setProperty('width', '100%', 'important')
    printCopy.style.setProperty('max-width', 'none', 'important')
    printCopy.style.setProperty('max-height', 'none', 'important')
    printCopy.style.setProperty('overflow', 'visible', 'important')
    printCopy.style.setProperty('box-sizing', 'border-box', 'important')
    document.body.appendChild(printCopy)

    const cleanup = () => printCopy.remove()
    window.addEventListener('afterprint', cleanup, { once: true })
    // Give Chromium a full layout cycle before it snapshots the temporary print document.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const warehouseParam = warehouseId ? `warehouseId=${encodeURIComponent(warehouseId)}&` : ''
      const [productRes, salesRes] = await Promise.allSettled([
        authFetch(`/api/retail/products?${warehouseParam}pageSize=100`),
        authFetch(`/api/retail/sales?${warehouseParam}pageSize=20`),
      ])

      if (productRes.status === 'fulfilled') {
        setProducts(productRes.value.products || [])
      } else {
        console.error('Failed to load retail products:', productRes.reason)
        toast.error('Could not load products for this warehouse')
      }

      if (salesRes.status === 'fulfilled') {
        setSales(salesRes.value.sales || [])
      }
    } catch (error: any) {
      toast.error(error?.message || 'Unable to load retail portal data')
    } finally {
      setLoading(false)
    }
  }, [warehouseId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Extract unique categories for filter tabs
  const categories = useMemo(() => {
    const set = new Set<string>()
    products.forEach((p) => {
      if (p.category) set.add(p.category.trim())
    })
    return ['ALL', ...Array.from(set).sort((a, b) => a.localeCompare(b))]
  }, [products])

  const visibleProducts = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return products.filter((product) => {
      const sizesText = Array.isArray(product.sizes) ? product.sizes.join(' ') : ''
      const matchesSearch =
        !needle ||
        `${product.name} ${sizesText} ${product.sku} ${product.category} ${product.packagingType}`.toLowerCase().includes(needle)
      const matchesCategory =
        selectedCategory === 'ALL' ||
        product.category?.trim().toLowerCase() === selectedCategory.toLowerCase()
      return matchesSearch && matchesCategory
    })
  }, [products, search, selectedCategory])

  const availableCapacities = useMemo(() => {
    const caps = new Set<number>()
    products.forEach((p) => {
      p.mixedCaseCapacities?.forEach((c) => caps.add(c))
    })
    return Array.from(caps).sort((a, b) => a - b)
  }, [products])

  useEffect(() => {
    if (availableCapacities.length > 0 && !availableCapacities.includes(mixedCapacity)) {
      setMixedCapacity(availableCapacities[0])
      setMixedQuantityA(Math.max(1, Math.floor(availableCapacities[0] / 2)))
    }
  }, [availableCapacities, mixedCapacity])

  const mixedProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          product.supportedModes.includes('MIXED_CASE') && product.mixedCaseCapacities.includes(mixedCapacity)
      ),
    [mixedCapacity, products]
  )

  const addProduct = (product: RetailProduct, mode: 'LOOSE' | 'CASE') => {
    setCart((current) => {
      const existing = current.find((line) => line.mode === mode && line.productId === product.id)
      if (existing) {
        return current.map((line) =>
          line.key === existing.key ? { ...line, quantity: line.quantity + 1 } : line
        )
      }
      return [
        ...current,
        { key: crypto.randomUUID(), mode, productId: product.id, quantity: 1, emptyBottlesProvided: 0 },
      ]
    })
    toast.success(`Added ${product.name} (${mode === 'CASE' ? 'Case' : 'Loose'}) to sale`)
  }

  const updateLine = (key: string, changes: Partial<RetailCartLine>) => {
    setCart((current) => current.map((line) => (line.key === key ? { ...line, ...changes } : line)))
  }

  const removeLine = (key: string) => {
    setCart((current) => current.filter((line) => line.key !== key))
  }

  const clearCart = () => {
    if (!cart.length) return
    setCart([])
    toast.info('Sale cart cleared')
  }

  const addMixedCase = () => {
    const quantityB = mixedCapacity - mixedQuantityA
    if (
      !mixedProductA ||
      !mixedProductB ||
      mixedProductA === mixedProductB ||
      mixedQuantityA <= 0 ||
      quantityB <= 0
    ) {
      toast.error('Please choose two different products and split the full case capacity between them')
      return
    }
    setCart((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        mode: 'MIXED_CASE',
        quantity: 1,
        caseCapacity: mixedCapacity,
        components: [
          { productId: mixedProductA, quantityBaseUnits: mixedQuantityA, emptyBottlesProvided: 0 },
          { productId: mixedProductB, quantityBaseUnits: quantityB, emptyBottlesProvided: 0 },
        ],
      },
    ])
    toast.success(`Added Mixed Case (${mixedCapacity} bottles) to sale`)
  }

  const validateCustomerInfo = () => {
    if (!walkInFirstName.trim()) {
      toast.error('First name is required for walk-in customer')
      return false
    }
    if (!walkInLastName.trim()) {
      toast.error('Last name is required for walk-in customer')
      return false
    }
    if (!walkInContact.trim()) {
      toast.error('Contact number is required for walk-in customer')
      return false
    }
    return true
  }

  const requestBody = () => {
    const walkInFullName = [walkInFirstName.trim(), walkInMiddleName.trim(), walkInLastName.trim()]
      .filter(Boolean)
      .join(' ')

    return {
      warehouseId,
      customerType: 'WALK_IN',
      walkIn: {
        name: walkInFullName,
        contactNumber: walkInContact.trim(),
        notes: walkInNotes.trim(),
      },
      fulfillmentType,
      items: cart.map(({ key: _key, ...line }) => {
        // Backend always expects emptyBottlesProvided in individual bottles.
        // For CASE mode the UI collects cases, so convert cases to bottles here.
        if (line.mode === 'CASE' && line.emptyBottlesProvided) {
          const product = products.find((p) => p.id === line.productId)
          const caseQty = Number(product?.caseQuantity || 1)
          return { ...line, emptyBottlesProvided: Number(line.emptyBottlesProvided) * caseQty }
        }
        return line
      }),
    }
  }

  const completeSale = async () => {
    if (!cart.length) return toast.error('Add at least one product to the sale')
    if (!validateCustomerInfo()) return
    setSubmitting(true)
    try {
      // Validate authoritative prices and deposits immediately before creating the sale.
      const quoted = await authFetch('/api/retail/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody()),
      })
      const payload = await authFetch('/api/retail/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody(), quoteToken: quoted.quoteToken, idempotencyKey: crypto.randomUUID() }),
      })
      setReceipt(payload.sale)
      setCart([])
      setWalkInFirstName('')
      setWalkInLastName('')
      setWalkInMiddleName('')
      setWalkInContact('')
      setWalkInNotes('')
      toast.success('Retail sale completed successfully')
      await loadData()
    } catch (error: any) {
      toast.error(error?.message || 'Unable to complete this retail sale')
    } finally {
      setSubmitting(false)
    }
  }

  const mutateReceipt = async (path: string, method: 'PATCH' | 'POST', body: Record<string, unknown>) => {
    if (!receipt) return
    setSubmitting(true)
    try {
      const payload = await authFetch(`/api/retail/sales/${receipt.id}/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId, ...body }),
      })
      setReceipt(payload.sale)
      toast.success('Retail transaction updated')
      await loadData()
    } catch (error: any) {
      toast.error(error?.message || 'Unable to update the retail transaction')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedProductAData = useMemo(
    () => products.find((p) => p.id === mixedProductA),
    [products, mixedProductA]
  )
  const selectedProductBData = useMemo(
    () => products.find((p) => p.id === mixedProductB),
    [products, mixedProductB]
  )

  const cartTotalItemsCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  )

  const getCartLineUnitPrice = (line: RetailCartLine) => {
    if (line.mode === 'MIXED_CASE') {
      return (line.components || []).reduce((sum, component) => {
        const product = products.find((item) => item.id === component.productId)
        return sum + Number(product?.retailUnitPrice || 0) * component.quantityBaseUnits
      }, 0)
    }
    const product = products.find((item) => item.id === line.productId)
    return Number(line.mode === 'CASE' ? product?.casePrice : product?.retailUnitPrice || 0)
  }

  const cartProductTotal = useMemo(
    () => cart.reduce((sum, line) => sum + getCartLineUnitPrice(line) * line.quantity, 0),
    [cart, products]
  )

  const cartDepositTotal = useMemo(() => cart.reduce((sum, line) => {
    if (line.mode === 'MIXED_CASE') {
      const depositPerCase = (line.components || []).reduce((componentSum, component) => {
        const product = products.find((item) => item.id === component.productId)
        if (!product?.depositEligible) return componentSum
        const returned = Math.min(component.quantityBaseUnits, Number(component.emptyBottlesProvided || 0))
        return componentSum + Math.max(0, component.quantityBaseUnits - returned) * Number(product.depositPerUnit || 0)
      }, 0)
      return sum + depositPerCase * line.quantity
    }
    const product = products.find((item) => item.id === line.productId)
    if (!product?.depositEligible) return sum
    const units = line.mode === 'CASE' ? line.quantity * product.caseQuantity : line.quantity
    // For CASE mode, user inputs cases returned (not individual bottles), so convert to bottles
    const returnedBottles = line.mode === 'CASE'
      ? Number(line.emptyBottlesProvided || 0) * product.caseQuantity
      : Number(line.emptyBottlesProvided || 0)
    const returned = Math.min(units, returnedBottles)
    return sum + Math.max(0, units - returned) * Number(product.depositPerUnit || 0)
  }, 0), [cart, products])

  const cartGrandTotal = cartProductTotal + cartDepositTotal

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Retail</h1>
            <Badge variant="outline" className="border-sky-200 bg-sky-50 font-semibold text-sky-700">
              Counter Sales
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Process on-the-spot counter sales and manage bottle deposit refunds.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadData()}
            disabled={loading}
            className="gap-2 rounded-xl border-slate-200 bg-white/80 shadow-xs hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Main Grid: Catalog/Tools vs Checkout Drawer */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,0.95fr)]">
        {/* Left Column: Products Catalog, Mixed Case Builder, and Recent Transactions */}
        <div className="space-y-6 min-w-0">
          {/* Catalog Card */}
          <Card className="rounded-3xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-xl">
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-lg font-bold text-slate-900">Product Catalog</CardTitle>
                  <CardDescription className="text-xs text-slate-500">
                    Live inventory availability for this warehouse
                  </CardDescription>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    aria-label="Search retail products"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, size, or type..."
                    className="h-9 rounded-xl pl-9 text-xs border-slate-200 bg-white"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Category Filter Chips */}
              {categories.length > 2 && (
                <div className="mt-3 flex flex-wrap gap-1.5 pt-1">
                  {categories.map((cat) => {
                    const isActive = selectedCategory === cat
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                          isActive
                            ? 'bg-slate-900 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {cat === 'ALL' ? 'All Categories' : cat}
                      </button>
                    )
                  })}
                </div>
              )}
            </CardHeader>

            <CardContent className="p-4 sm:p-6">
              {loading ? (
                <PortalTableSkeleton rows={4} columns={4} className="border-0 shadow-none" />
              ) : visibleProducts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 py-12 text-center">
                  <Package className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-2 text-sm font-semibold text-slate-700">No products found</p>
                  <p className="text-xs text-slate-500">
                    {search || selectedCategory !== 'ALL'
                      ? 'Try adjusting your search query or category filter.'
                      : 'No retail products currently match your active filters.'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 text-xs"
                    onClick={() => {
                      setSearch('')
                      setSelectedCategory('ALL')
                      void loadData()
                    }}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Reload Catalog
                  </Button>
                </div>
              ) : (
                <div className="grid gap-3.5 sm:grid-cols-2">
                  {visibleProducts.map((product) => {
                    const hasCase = product.supportedModes.includes('CASE')
                    const isOutOfStock = product.availableCases < 1
                    const primarySize = getProductPrimarySize(product)

                    return (
                      <div
                        key={product.id}
                        className={`group relative flex flex-col justify-between rounded-2xl border bg-white p-4 transition-all duration-200 hover:shadow-md ${
                          isOutOfStock
                            ? 'border-slate-200 opacity-60'
                            : 'border-slate-200/90 hover:border-sky-300'
                        }`}
                      >
                        <div>
                          <div className="flex items-start gap-3">
                            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
                              <img
                                src={product.imageUrl || '/ann-anns-logo.png'}
                                alt={product.name}
                                className="h-full w-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.src = '/ann-anns-logo.png'
                                }}
                              />
                              {product.depositEligible && (
                                <span
                                  className="absolute bottom-0.5 right-0.5 rounded-full bg-emerald-600 p-0.5 text-white shadow-xs"
                                  title="Bottle Deposit Eligible"
                                >
                                  <Recycle className="h-3 w-3" />
                                </span>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-slate-900 leading-tight line-clamp-1">
                                  {product.name}
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">
                                {primarySize ? `${primarySize} · ` : ''}{product.packagingType}
                              </p>

                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {product.availableCases > 0 ? (
                                  <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                    {product.availableCases} case{product.availableCases === 1 ? '' : 's'} left
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                                    0 cases left
                                  </span>
                                )}

                                {product.caseQuantity > 0 ? (
                                  <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                    {product.caseQuantity} {product.looseUnit}s / case
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Action Button: Sold by Case Only */}
                        <div className="mt-3.5 pt-2 border-t border-slate-100">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!hasCase || product.availableCases < 1}
                            onClick={() => addProduct(product, 'CASE')}
                            className="w-full h-9 text-xs font-semibold rounded-xl border-slate-200 text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-300 disabled:opacity-40"
                          >
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            {product.availableCases < 1 ? 'Out of Stock' : `+ ${peso(product.casePrice)} / case`}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Mixed Case Builder Card */}
          <Card className="rounded-3xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-xl">
            <CardHeader className="border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-indigo-50 p-1.5 text-indigo-600">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold text-slate-900">Mixed Case Builder</CardTitle>
                  <CardDescription className="text-xs text-slate-500">
                    Combine two compatible glass bottle products into one full case for a counter sale
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-4 sm:p-6 space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <Label htmlFor="mixed-capacity" className="text-xs font-semibold text-slate-700">
                    Case Capacity
                  </Label>
                  {availableCapacities.length > 0 ? (
                    <select
                      id="mixed-capacity"
                      value={mixedCapacity}
                      onChange={(e) => {
                        const cap = Number(e.target.value) || 12
                        setMixedCapacity(cap)
                        setMixedQuantityA(Math.max(1, Math.floor(cap / 2)))
                      }}
                      className="mt-1 h-9.5 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      {availableCapacities.map((c) => (
                        <option key={c} value={c}>
                          {c} bottles / case
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="mixed-capacity"
                      type="number"
                      min={2}
                      value={mixedCapacity}
                      onChange={(e) => {
                        const cap = Math.max(2, Number(e.target.value) || 2)
                        setMixedCapacity(cap)
                        if (mixedQuantityA >= cap) setMixedQuantityA(Math.max(1, Math.floor(cap / 2)))
                      }}
                      className="mt-1 h-9.5 rounded-xl text-xs"
                    />
                  )}
                </div>

                <div>
                  <Label htmlFor="mixed-a" className="text-xs font-semibold text-slate-700">
                    Product A
                  </Label>
                  <select
                    id="mixed-a"
                    value={mixedProductA}
                    onChange={(e) => setMixedProductA(e.target.value)}
                    className="mt-1 h-9.5 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Select product A...</option>
                    {mixedProducts.map((p) => (
                      <option key={p.id} value={p.id} disabled={p.id === mixedProductB}>
                        {p.name}
                        {getProductSizeLabel(p)} ({p.availableBaseUnits} available)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label htmlFor="mixed-b" className="text-xs font-semibold text-slate-700">
                    Product B
                  </Label>
                  <select
                    id="mixed-b"
                    value={mixedProductB}
                    onChange={(e) => setMixedProductB(e.target.value)}
                    className="mt-1 h-9.5 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Select product B...</option>
                    {mixedProducts.map((p) => (
                      <option key={p.id} value={p.id} disabled={p.id === mixedProductA}>
                        {p.name}
                        {getProductSizeLabel(p)} ({p.availableBaseUnits} available)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <Label htmlFor="mixed-qty-a" className="text-xs font-semibold text-slate-700">
                    Product A Quantity ({mixedQuantityA} pcs)
                  </Label>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9.5 w-9.5 rounded-xl shrink-0"
                      onClick={() => setMixedQuantityA((q) => Math.max(1, q - 1))}
                      disabled={mixedQuantityA <= 1}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <Input
                      id="mixed-qty-a"
                      type="number"
                      min={1}
                      max={mixedCapacity - 1}
                      value={mixedQuantityA}
                      onChange={(e) => {
                        const val = Math.min(mixedCapacity - 1, Math.max(1, Number(e.target.value) || 1))
                        setMixedQuantityA(val)
                      }}
                      className="h-9.5 rounded-xl text-center text-xs font-bold"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9.5 w-9.5 rounded-xl shrink-0"
                      onClick={() => setMixedQuantityA((q) => Math.min(mixedCapacity - 1, q + 1))}
                      disabled={mixedQuantityA >= mixedCapacity - 1}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Proportional Split Bar Visualizer */}
              <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-2">
                  <span>
                    Product A: <strong className="text-indigo-600">{selectedProductAData?.name || 'Selected'} ({mixedQuantityA} pcs)</strong>
                  </span>
                  <span>
                    Product B: <strong className="text-emerald-600">{selectedProductBData?.name || 'Selected'} ({Math.max(0, mixedCapacity - mixedQuantityA)} pcs)</strong>
                  </span>
                </div>

                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200 flex">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${(mixedQuantityA / mixedCapacity) * 100}%` }}
                  />
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${((mixedCapacity - mixedQuantityA) / mixedCapacity) * 100}%` }}
                  />
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    Total: <strong>{mixedCapacity}</strong> glass bottles
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={addMixedCase}
                    className="h-8.5 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add Mixed Case to Cart
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent Retail Transactions Card */}
          <Card className="rounded-3xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-xl">
            <CardHeader className="border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-slate-900">Recent Retail Transactions</CardTitle>
                  <CardDescription className="text-xs text-slate-500">
                    Counter receipts processed at this warehouse
                  </CardDescription>
                </div>
                <Badge variant="outline" className="font-semibold text-slate-600">
                  {sales.length} transactions
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {sales.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  No retail sales recorded for this warehouse yet.
                </div>
              ) : (
                <div className="max-w-full overflow-x-auto overscroll-x-contain">
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="border-b border-slate-100 bg-slate-50/75 text-slate-600 font-semibold">
                      <tr>
                        <th className="px-4 py-3">Receipt #</th>
                        <th className="px-4 py-3">Customer</th>
                        <th className="px-4 py-3">Date & Time</th>
                        <th className="px-4 py-3">Total Amount</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {sales.map((sale) => (
                        <tr key={sale.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {sale.transactionNumber}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium text-slate-800">
                              {sale.customer?.name || 'Walk-in Customer'}
                            </span>
                            {sale.customer?.phone && (
                              <p className="text-[11px] text-slate-500">{sale.customer.phone}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {new Date(sale.date).toLocaleDateString()} · {new Date(sale.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-900">
                            {peso(sale.grandTotal)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setReceipt(sale)}
                              className="h-7 text-[11px] rounded-lg border-slate-200 text-sky-700 hover:bg-sky-50"
                            >
                              <Receipt className="mr-1 h-3 w-3" />
                              Receipt
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
        </div>

        {/* Right Column: Active Sale & Checkout Drawer (Sticky) */}
        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card className="rounded-3xl border border-slate-200/90 bg-white/90 shadow-md backdrop-blur-xl">
            <CardHeader className="border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-xl bg-sky-50 p-2 text-sky-600">
                    <ShoppingCart className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900">Current Sale</CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      {cart.length} item line{cart.length === 1 ? '' : 's'} ({cartTotalItemsCount} unit{cartTotalItemsCount === 1 ? '' : 's'})
                    </CardDescription>
                  </div>
                </div>

                {cart.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearCart}
                    className="h-7 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-4 sm:p-5 space-y-4">
              {/* Counter sales now use one direct walk-in checkout flow. */}
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5">
                  <p className="text-xs font-bold text-slate-800">Walk-in Customer Details</p>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="walk-in-first-name" className="text-xs font-semibold text-slate-700">
                        First Name <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        id="walk-in-first-name"
                        value={walkInFirstName}
                        onChange={(e) => setWalkInFirstName(e.target.value)}
                        placeholder="e.g. Juan"
                        className="mt-1 h-9 rounded-xl text-xs border-slate-200 bg-white"
                      />
                    </div>

                    <div>
                      <Label htmlFor="walk-in-last-name" className="text-xs font-semibold text-slate-700">
                        Last Name <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        id="walk-in-last-name"
                        value={walkInLastName}
                        onChange={(e) => setWalkInLastName(e.target.value)}
                        placeholder="e.g. Dela Cruz"
                        className="mt-1 h-9 rounded-xl text-xs border-slate-200 bg-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="walk-in-middle-name" className="text-xs font-semibold text-slate-500">
                        Middle Name (optional)
                      </Label>
                      <Input
                        id="walk-in-middle-name"
                        value={walkInMiddleName}
                        onChange={(e) => setWalkInMiddleName(e.target.value)}
                        placeholder="e.g. Santos"
                        className="mt-1 h-9 rounded-xl text-xs border-slate-200 bg-white"
                      />
                    </div>

                    <div>
                      <Label htmlFor="walk-in-contact" className="text-xs font-semibold text-slate-700">
                        Contact Number <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        id="walk-in-contact"
                        value={walkInContact}
                        inputMode="numeric"
                        onChange={(e) => setWalkInContact(formatPhilippinePhoneInput(e.target.value))}
                        placeholder="0912 345 6789"
                        className="mt-1 h-9 rounded-xl text-xs border-slate-200 bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="walk-in-notes" className="text-xs font-semibold text-slate-500">
                      Notes (optional)
                    </Label>
                    <Textarea
                      id="walk-in-notes"
                      value={walkInNotes}
                      onChange={(e) => setWalkInNotes(e.target.value)}
                      placeholder="e.g. Customer brought empty bottles, special packaging instructions..."
                      className="mt-1 min-h-[60px] rounded-xl text-xs border-slate-200 bg-white"
                    />
                  </div>
              </div>

              {/* Cart Items List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-700">Sale Cart Items</Label>
                  <span className="text-[11px] text-slate-500">{cart.length} item{cart.length === 1 ? '' : 's'}</span>
                </div>

                <div className="max-h-[300px] space-y-2.5 overflow-y-auto pr-1">
                  {cart.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-8 text-center">
                      <ShoppingCart className="mx-auto h-6 w-6 text-slate-400" />
                      <p className="mt-1.5 text-xs font-medium text-slate-600">Sale cart is empty</p>
                      <p className="text-[11px] text-slate-400">Add loose bottles or full cases from the catalog.</p>
                    </div>
                  ) : (
                    cart.map((line) => {
                      const product = products.find((item) => item.id === line.productId)

                      return (
                        <div
                          key={line.key}
                          className="rounded-2xl border border-slate-200/90 bg-white p-3 shadow-xs space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-900 leading-tight">
                                {line.mode === 'MIXED_CASE'
                                  ? `Mixed Case (${line.caseCapacity} bottles)`
                                  : `${product?.name || 'Product'}${getProductSizeLabel(product)}`}
                              </p>
                              <Badge
                                variant="outline"
                                className="mt-1 text-[10px] font-semibold text-slate-600"
                              >
                                {line.mode.replace(/_/g, ' ')}
                              </Badge>
                              <p className="mt-1 text-[11px] text-slate-500">
                                {peso(getCartLineUnitPrice(line))} each ·{' '}
                                <span className="font-bold text-slate-800">
                                  {peso(getCartLineUnitPrice(line) * line.quantity)} total
                                </span>
                              </p>
                            </div>

                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() => removeLine(line.key)}
                              className="h-7 w-7 rounded-lg text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Remove item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          {/* Quantity Stepper */}
                          <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                            <span className="text-[11px] font-medium text-slate-500">Order Quantity:</span>
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-7 w-7 rounded-lg"
                                onClick={() => updateLine(line.key, { quantity: Math.max(1, line.quantity - 1) })}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <Input
                                type="number"
                                min={1}
                                value={line.quantity}
                                onChange={(e) =>
                                  updateLine(line.key, { quantity: Math.max(1, Number(e.target.value) || 1) })
                                }
                                className="h-7 w-14 rounded-lg text-center text-xs font-bold"
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-7 w-7 rounded-lg"
                                onClick={() => updateLine(line.key, { quantity: line.quantity + 1 })}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>

                          {/* Deposit / Empty Bottles Return Counter */}
                          {line.mode !== 'MIXED_CASE' && product?.depositEligible ? (
                            <div className="rounded-xl bg-emerald-50/70 p-2.5 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <Label htmlFor={`empties-${line.key}`} className="text-[11px] font-semibold text-emerald-900 flex items-center gap-1">
                                  <Recycle className="h-3.5 w-3.5 text-emerald-600" />
                                  {line.mode === 'CASE' ? 'Empty Cases returned:' : `Empty ${product.looseUnit}s returned:`}
                                </Label>
                                <Input
                                  type="number"
                                  min={0}
                                  max={line.quantity}
                                  value={line.emptyBottlesProvided || 0}
                                  onChange={(e) =>
                                    updateLine(line.key, {
                                    })
                                  }
                                  className="h-7 w-16 rounded-lg text-center text-xs font-bold border-emerald-300 bg-white"
                                />
                              </div>
                            </div>
                          ) : null}

                          {/* Mixed Case Components Deposit Inputs */}
                          {line.mode === 'MIXED_CASE' && line.components ? (
                            <div className="rounded-xl bg-slate-50 p-2.5 space-y-2 text-xs">
                              <p className="text-[11px] font-semibold text-slate-700">Empty Bottles Returned per Product:</p>
                              {line.components.map((component, componentIndex) => {
                                const componentProduct = products.find((p) => p.id === component.productId)
                                return (
                                  <div
                                    key={component.productId}
                                    className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/60"
                                  >
                                    <div className="flex min-w-0 items-center gap-2">
                                      <img
                                        src={componentProduct?.imageUrl || '/ann-anns-logo.png'}
                                        alt={componentProduct?.name || 'Mixed-case product'}
                                        className="h-8 w-8 shrink-0 rounded-md border border-slate-200 bg-white object-cover"
                                      />
                                      <span className="text-[11px] text-slate-600">
                                        {componentProduct?.name} {getProductPrimarySize(componentProduct)}: {component.quantityBaseUnits} bottles
                                      </span>
                                    </div>
                                    {componentProduct?.depositEligible ? (
                                      <Input
                                        type="number"
                                        min={0}
                                        max={component.quantityBaseUnits}
                                        value={component.emptyBottlesProvided || 0}
                                        onChange={(e) => {
                                          const components = [...(line.components || [])]
                                          components[componentIndex] = {
                                            ...component,
                                            emptyBottlesProvided: Math.max(0, Number(e.target.value) || 0),
                                          }
                                          updateLine(line.key, { components })
                                        }}
                                        className="h-6.5 w-14 rounded-lg text-center text-xs font-bold bg-white"
                                      />
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Always-visible cart totals; final deposit validation still runs during checkout. */}
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-[#f8fafc] p-4 text-xs shadow-none">
                <div className="flex justify-between text-slate-600">
                  <span>Product Subtotal</span>
                  <span className="font-medium text-slate-800">{peso(cartProductTotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Bottle Deposit</span>
                  <span className="font-medium text-slate-800">{peso(cartDepositTotal)}</span>
                </div>
                <div className="h-px bg-slate-100" />
                <div className="flex justify-between text-[15px] font-semibold text-slate-900">
                  <span>Total</span>
                  <span className="text-emerald-600">{peso(cartGrandTotal)}</span>
                </div>
              </div>

              {/* Checkout Action Buttons */}
              <div className="pt-1">
                <Button
                  type="button"
                  disabled={submitting || !cart.length}
                  onClick={completeSale}
                  className="h-10 w-full rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                  Complete Sale
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Official Receipt & Transaction Detail Dialog */}
      <Dialog
        open={Boolean(receipt)}
        onOpenChange={(open) => {
          if (!open) {
            setCancelConfirmOpen(false)
            setReceipt(null)
          }
        }}
      >
        <DialogContent
          id="retail-pos-print-receipt"
          className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-3xl p-6"
        >
          <DialogHeader className="border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                <ReceiptText className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-slate-900">
                  Retail Sales Receipt
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Ann Ann&apos;s Beverages Trading · {receipt?.transactionNumber}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {receipt ? (
            <div className="space-y-4 text-xs">
              {/* Receipt Metadata Box */}
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 sm:grid-cols-2">
                <div>
                  <span className="text-slate-500 font-medium">Customer</span>
                  <p className="font-bold text-slate-900 mt-0.5">{receipt.customer?.name || 'Walk-in Customer'}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Cashier / Staff</span>
                  <p className="font-bold text-slate-900 mt-0.5">{receipt.staff?.name || 'Warehouse Staff'}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Date & Time</span>
                  <p className="font-semibold text-slate-800 mt-0.5">{new Date(receipt.date).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Fulfillment</span>
                  <p className="font-semibold text-slate-800 mt-0.5">Immediate Release</p>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2">
                <p className="font-bold text-slate-800 text-xs">Purchased Items</p>
                <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 overflow-hidden">
                  {receipt.items?.map((item: any) => (
                    <div key={item.id} className="p-3 bg-white">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-slate-900">
                            {item.productName}{getReceiptItemSize(item) ? ` (${getReceiptItemSize(item)})` : ''}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {item.packagingType} · {item.mode.replace(/_/g, ' ')} · Qty: {item.quantity}
                          </p>
                        </div>
                        <p className="font-bold text-slate-900">{peso(item.productSubtotal)}</p>
                      </div>

                      {item.components?.length ? <MixedCaseComponents item={item} compact /> : null}
                      <div className="hidden">
                      {item.components?.map((component: any) => (
                        <p key={component.id} className="mt-1 text-[11px] text-slate-600 pl-2 border-l-2 border-slate-200">
                          {component.productName}{getReceiptItemSize(component) ? ` (${getReceiptItemSize(component)})` : ''}: {component.quantityBaseUnits} {component.looseUnit}s
                        </p>
                      ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Financial Totals */}
              <div className="rounded-2xl border border-slate-200 bg-[#f8fafc] p-4 text-xs shadow-none space-y-2">
                <div className="flex justify-between text-slate-600">
                  <span>Product Subtotal</span>
                  <span className="font-medium text-slate-800">{peso(receipt.productTotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Empty Bottles Returned</span>
                  <span className="font-medium text-slate-800">{receipt.emptyBottlesProvided || 0} pcs</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Bottle Deposit</span>
                  <span className="font-medium text-slate-800">{peso(receipt.deposit)}</span>
                </div>
                <div className="h-px bg-slate-100" />
                <div className="flex justify-between text-[15px] font-semibold text-slate-900">
                  <span>Grand Total</span>
                  <span className="text-emerald-600">{peso(receipt.grandTotal)}</span>
                </div>
              </div>

              {/* Management Controls for Open Transaction */}
              {receipt.transactionStatus !== 'CANCELLED' ? (
                <div className="receipt-no-print space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="font-bold text-slate-800">Manage Transaction</p>

                  <Button
                    type="button"
                    variant="destructive"
                    className="w-full h-9 rounded-xl text-xs font-semibold"
                    disabled={submitting}
                    onClick={() => setCancelConfirmOpen(true)}
                  >
                    Cancel Transaction
                  </Button>
                </div>
              ) : null}

              {/* Print Receipt Button */}
              <div className="receipt-no-print pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-10 rounded-xl border-slate-200 text-slate-800 hover:bg-slate-100 font-semibold"
                  onClick={printReceipt}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print Official Receipt
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <AlertDialogContent className="max-w-md rounded-2xl p-6">
          <AlertDialogHeader className="gap-3 text-left">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-red-600">
              <AlertCircle className="h-5 w-5" />
            </div>
            <AlertDialogTitle className="text-lg font-bold text-slate-900">
              Cancel retail transaction?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm leading-6 text-slate-600">
              <span className="block">
                Transaction <strong className="text-slate-900">{receipt?.transactionNumber}</strong> will be cancelled and its inventory movements will be reversed.
              </span>
              {Number(receipt?.emptyBottlesProvided || 0) > 0 ? (
                <span className="block font-medium text-amber-700">
                  Confirm that all accepted empty bottles were returned to the customer or physically corrected before continuing.
                </span>
              ) : null}
              <span className="block">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2 gap-2 sm:gap-2">
            <AlertDialogCancel disabled={submitting} className="rounded-xl">
              Keep Transaction
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              className="rounded-xl bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                const hasEmpties = Number(receipt?.emptyBottlesProvided || 0) > 0
                void mutateReceipt('cancel', 'POST', {
                  reason: 'Cancelled by warehouse staff',
                  emptiesRestoredToCustomer: hasEmpties,
                })
              }}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cancel Transaction
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Print only the receipt dialog; portal content and transaction controls stay on screen only. */}
      <style jsx global>{`
        @media print {
          @page {
            margin: 0;
          }

          body > * {
            display: none !important;
          }

          body > #retail-pos-print-copy {
            display: grid !important;
          }

          #retail-pos-print-copy {
            position: static !important;
            inset: auto !important;
            width: 100% !important;
            max-width: none !important;
            max-height: none !important;
            margin: 0 !important;
            padding: 12mm !important;
            overflow: visible !important;
            translate: none !important;
            transform: none !important;
            animation: none !important;
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
          }

          #retail-pos-print-copy [data-slot='dialog-close'],
          #retail-pos-print-copy .receipt-no-print {
            display: none !important;
          }
        }
      `}</style>
    </div>
  )
}
