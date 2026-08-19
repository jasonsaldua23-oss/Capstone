'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Minus, Plus, ReceiptText, Search, ShoppingCart, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

type RetailProduct = {
  id: string
  sku: string
  name: string
  imageUrl?: string | null
  category: string
  packagingType: string
  looseUnit: string
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

type RetailCustomer = { id: string; name: string; email?: string; phone?: string }
type RetailSale = Record<string, any>

const peso = (value: unknown) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.success === false) throw new Error(payload?.error || 'Request failed')
  return payload
}

export function WarehouseRetailPosView({ warehouseId }: { warehouseId: string }) {
  const [products, setProducts] = useState<RetailProduct[]>([])
  const [customers, setCustomers] = useState<RetailCustomer[]>([])
  const [sales, setSales] = useState<RetailSale[]>([])
  const [cart, setCart] = useState<RetailCartLine[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [quoteResult, setQuoteResult] = useState<any>(null)
  const [quoteToken, setQuoteToken] = useState('')
  const [receipt, setReceipt] = useState<RetailSale | null>(null)
  const [receiptPaymentAmount, setReceiptPaymentAmount] = useState('0.00')
  const [customerType, setCustomerType] = useState<'WALK_IN' | 'EXISTING'>('WALK_IN')
  const [customerId, setCustomerId] = useState('')
  const [walkInFirstName, setWalkInFirstName] = useState('')
  const [walkInLastName, setWalkInLastName] = useState('')
  const [walkInMiddleName, setWalkInMiddleName] = useState('')
  const [walkInContact, setWalkInContact] = useState('')
  const [walkInNotes, setWalkInNotes] = useState('')
  const [fulfillmentType, setFulfillmentType] = useState<'IMMEDIATE' | 'CUSTOMER_PICKUP'>('IMMEDIATE')
  const [amountPaid, setAmountPaid] = useState('0.00')
  const [mixedCapacity, setMixedCapacity] = useState(12)
  const [mixedProductA, setMixedProductA] = useState('')
  const [mixedProductB, setMixedProductB] = useState('')
  const [mixedQuantityA, setMixedQuantityA] = useState(6)

  const invalidateQuote = useCallback(() => {
    setQuoteResult(null)
    setQuoteToken('')
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [productPayload, customerPayload, salesPayload] = await Promise.all([
        fetch(`/api/retail/products?warehouseId=${encodeURIComponent(warehouseId)}&pageSize=100`, { cache: 'no-store', credentials: 'include' }).then(readJson),
        fetch('/api/customers?pageSize=100', { cache: 'no-store', credentials: 'include' }).then(readJson),
        fetch(`/api/retail/sales?warehouseId=${encodeURIComponent(warehouseId)}&pageSize=25`, { cache: 'no-store', credentials: 'include' }).then(readJson),
      ])
      setProducts(Array.isArray(productPayload?.products) ? productPayload.products : [])
      setCustomers(Array.isArray(customerPayload?.customers) ? customerPayload.customers : [])
      setSales(Array.isArray(salesPayload?.sales) ? salesPayload.sales : [])
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load Retail / POS')
    } finally {
      setLoading(false)
    }
  }, [warehouseId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (receipt) setReceiptPaymentAmount(String(receipt.amountPaid || '0.00'))
  }, [receipt])

  const visibleProducts = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return products
    return products.filter((product) => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(needle))
  }, [products, search])

  const mixedProducts = useMemo(
    () => products.filter((product) => product.supportedModes.includes('MIXED_CASE') && product.mixedCaseCapacities.includes(mixedCapacity)),
    [mixedCapacity, products],
  )

  const addProduct = (product: RetailProduct, mode: 'LOOSE' | 'CASE') => {
    setCart((current) => {
      const existing = current.find((line) => line.mode === mode && line.productId === product.id)
      if (existing) return current.map((line) => line.key === existing.key ? { ...line, quantity: line.quantity + 1 } : line)
      return [...current, { key: crypto.randomUUID(), mode, productId: product.id, quantity: 1, emptyBottlesProvided: 0 }]
    })
    invalidateQuote()
  }

  const updateLine = (key: string, changes: Partial<RetailCartLine>) => {
    setCart((current) => current.map((line) => line.key === key ? { ...line, ...changes } : line))
    invalidateQuote()
  }

  const addMixedCase = () => {
    const quantityB = mixedCapacity - mixedQuantityA
    if (!mixedProductA || !mixedProductB || mixedProductA === mixedProductB || mixedQuantityA <= 0 || quantityB <= 0) {
      toast.error('Choose two different products and split the full case between them')
      return
    }
    setCart((current) => [...current, {
      key: crypto.randomUUID(),
      mode: 'MIXED_CASE',
      quantity: 1,
      caseCapacity: mixedCapacity,
      components: [
        { productId: mixedProductA, quantityBaseUnits: mixedQuantityA, emptyBottlesProvided: 0 },
        { productId: mixedProductB, quantityBaseUnits: quantityB, emptyBottlesProvided: 0 },
      ],
    }])
    invalidateQuote()
  }

  const requestBody = () => ({
    warehouseId,
    customerType,
    customerId: customerType === 'EXISTING' ? customerId : undefined,
    // Keep the existing API contract while collecting each part of the walk-in customer's name separately.
    walkIn: customerType === 'WALK_IN' ? {
      name: [walkInFirstName, walkInLastName, walkInMiddleName].map((part) => part.trim()).filter(Boolean).join(' '),
      contactNumber: walkInContact,
      notes: walkInNotes,
    } : undefined,
    fulfillmentType,
    amountPaid,
    items: cart.map(({ key: _key, ...line }) => line),
  })

  const reviewSale = async () => {
    if (!cart.length) return toast.error('Add at least one product')
    if (customerType === 'EXISTING' && !customerId) return toast.error('Select an existing customer')
    setSubmitting(true)
    try {
      const payload = await fetch('/api/retail/quote', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody()),
      }).then(readJson)
      setQuoteResult(payload.quote)
      setQuoteToken(payload.quoteToken)
      toast.success('Totals refreshed from current stock and deposit settings')
    } catch (error: any) {
      toast.error(error?.message || 'Unable to quote this sale')
    } finally {
      setSubmitting(false)
    }
  }

  const completeSale = async () => {
    if (!quoteToken) return toast.error('Review the current totals before checkout')
    setSubmitting(true)
    try {
      const payload = await fetch('/api/retail/sales', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody(), quoteToken, idempotencyKey: crypto.randomUUID() }),
      }).then(readJson)
      setReceipt(payload.sale)
      setCart([])
      invalidateQuote()
      setAmountPaid('0.00')
      toast.success(fulfillmentType === 'IMMEDIATE' ? 'Retail sale completed' : 'Pickup sale reserved')
      await loadData()
    } catch (error: any) {
      invalidateQuote()
      toast.error(error?.message || 'Unable to complete this sale')
    } finally {
      setSubmitting(false)
    }
  }

  const mutateReceipt = async (path: string, method: 'PATCH' | 'POST', body: Record<string, unknown>) => {
    if (!receipt) return
    setSubmitting(true)
    try {
      const payload = await fetch(`/api/retail/sales/${receipt.id}/${path}`, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId, ...body }),
      }).then(readJson)
      setReceipt(payload.sale)
      toast.success('Retail transaction updated')
      await loadData()
    } catch (error: any) {
      toast.error(error?.message || 'Unable to update the retail transaction')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-950">Retail / POS</h1>
        <p className="text-sm text-slate-600">Process counter sales, bottle deposits, and offline customer pickups.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,0.8fr)]">
        <div className="space-y-6">
          <Card className="border-white/50 bg-white/75 shadow-sm backdrop-blur-xl">
            <CardHeader>
              <CardTitle>Products</CardTitle>
              <CardDescription>Availability reflects your assigned warehouse.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input aria-label="Search retail products" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, SKU, or category" className="pl-9" />
              </div>
              {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
                <div className="grid gap-3 md:grid-cols-2">
                  {visibleProducts.map((product) => (
                    <div key={product.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex gap-3">
                        <div className="h-16 w-16 overflow-hidden rounded-xl bg-slate-100">
                          {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-slate-950">{product.name}</p>
                          <p className="text-xs text-slate-500">{product.sku} · {product.packagingType}</p>
                          <p className="mt-1 text-xs font-medium text-emerald-700">{product.availableBaseUnits} {product.looseUnit}{product.availableBaseUnits === 1 ? '' : 's'} available</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button variant="outline" disabled={!product.supportedModes.includes('LOOSE') || product.availableBaseUnits < 1} onClick={() => addProduct(product, 'LOOSE')}>
                          <Plus className="mr-1 h-4 w-4" /> {product.retailUnitPrice ? `${peso(product.retailUnitPrice)} / ${product.looseUnit}` : 'Loose unavailable'}
                        </Button>
                        <Button variant="outline" disabled={!product.supportedModes.includes('CASE') || product.availableCases < 1} onClick={() => addProduct(product, 'CASE')}>
                          <Plus className="mr-1 h-4 w-4" /> {peso(product.casePrice)} / case
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/50 bg-white/75 shadow-sm backdrop-blur-xl">
            <CardHeader><CardTitle>Mixed Case Builder</CardTitle><CardDescription>Combine two compatible Glass Bottle products into one full case.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              <div><Label htmlFor="mixed-capacity">Case capacity</Label><Input id="mixed-capacity" type="number" min={2} value={mixedCapacity} onChange={(e) => setMixedCapacity(Math.max(2, Number(e.target.value) || 2))} /></div>
              <div><Label htmlFor="mixed-a">Product A</Label><select id="mixed-a" value={mixedProductA} onChange={(e) => setMixedProductA(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select</option>{mixedProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><Label htmlFor="mixed-b">Product B</Label><select id="mixed-b" value={mixedProductB} onChange={(e) => setMixedProductB(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select</option>{mixedProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div><Label htmlFor="mixed-qty-a">Product A quantity</Label><Input id="mixed-qty-a" type="number" min={1} max={mixedCapacity - 1} value={mixedQuantityA} onChange={(e) => setMixedQuantityA(Number(e.target.value) || 1)} /></div>
              <div className="md:col-span-4 flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm"><span>Product B automatically fills <strong>{Math.max(0, mixedCapacity - mixedQuantityA)}</strong> bottles.</span><Button onClick={addMixedCase}>Add Mixed Case</Button></div>
            </CardContent>
          </Card>

          <Card className="border-white/50 bg-white/75 shadow-sm backdrop-blur-xl">
            <CardHeader><CardTitle>Recent Retail Transactions</CardTitle><CardDescription>Retail sales remain separate from delivery purchase orders.</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              {sales.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No retail transactions yet.</p> : sales.map((sale) => (
                <button key={sale.id} onClick={() => setReceipt(sale)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-left hover:bg-slate-50">
                  <div><p className="font-semibold text-slate-900">{sale.transactionNumber}</p><p className="text-xs text-slate-500">{sale.customer?.name} · {new Date(sale.date).toLocaleString()}</p></div>
                  <div className="text-right"><p className="font-semibold">{peso(sale.grandTotal)}</p><Badge variant="outline">{sale.pickupStatus === 'NOT_APPLICABLE' ? sale.paymentStatus : sale.pickupStatus.replaceAll('_', ' ')}</Badge></div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Card className="border-white/50 bg-white/85 shadow-lg backdrop-blur-xl">
            <CardHeader><CardTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" /> Current Sale</CardTitle><CardDescription>{cart.length} cart line{cart.length === 1 ? '' : 's'}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Button variant={customerType === 'WALK_IN' ? 'default' : 'outline'} onClick={() => { setCustomerType('WALK_IN'); invalidateQuote() }}>Walk-in</Button>
                <Button variant={customerType === 'EXISTING' ? 'default' : 'outline'} onClick={() => { setCustomerType('EXISTING'); invalidateQuote() }}>Existing Customer</Button>
              </div>
              {customerType === 'EXISTING' ? (
                <div><Label htmlFor="retail-customer">Customer</Label><select id="retail-customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value); invalidateQuote() }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</option>)}</select></div>
              ) : (
                <div className="grid gap-3"><div><Label htmlFor="walk-in-first-name">First name (optional)</Label><Input id="walk-in-first-name" value={walkInFirstName} onChange={(e) => setWalkInFirstName(e.target.value)} /></div><div><Label htmlFor="walk-in-last-name">Last name (optional)</Label><Input id="walk-in-last-name" value={walkInLastName} onChange={(e) => setWalkInLastName(e.target.value)} /></div><div><Label htmlFor="walk-in-middle-name">Middle name (optional)</Label><Input id="walk-in-middle-name" value={walkInMiddleName} onChange={(e) => setWalkInMiddleName(e.target.value)} /></div><div><Label htmlFor="walk-in-contact">Contact number (optional)</Label><Input id="walk-in-contact" value={walkInContact} onChange={(e) => setWalkInContact(e.target.value)} /></div><div><Label htmlFor="walk-in-notes">Notes (optional)</Label><Textarea id="walk-in-notes" value={walkInNotes} onChange={(e) => setWalkInNotes(e.target.value)} /></div></div>
              )}

              <div className="max-h-[340px] space-y-3 overflow-y-auto" aria-live="polite">
                {cart.map((line) => {
                  const product = products.find((item) => item.id === line.productId)
                  return <div key={line.key} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{line.mode === 'MIXED_CASE' ? `Mixed Case · ${line.caseCapacity}` : product?.name}</p><p className="text-xs text-slate-500">{line.mode.replaceAll('_', ' ')}</p></div><Button size="icon" variant="ghost" aria-label="Remove cart line" onClick={() => { setCart((current) => current.filter((item) => item.key !== line.key)); invalidateQuote() }}><Trash2 className="h-4 w-4 text-red-500" /></Button></div>
                    <div className="mt-3 flex items-center gap-2"><Button size="icon" variant="outline" aria-label="Decrease quantity" onClick={() => updateLine(line.key, { quantity: Math.max(1, line.quantity - 1) })}><Minus className="h-4 w-4" /></Button><Input aria-label="Quantity" type="number" min={1} value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: Math.max(1, Number(e.target.value) || 1) })} className="w-20 text-center" /><Button size="icon" variant="outline" aria-label="Increase quantity" onClick={() => updateLine(line.key, { quantity: line.quantity + 1 })}><Plus className="h-4 w-4" /></Button></div>
                    {line.mode !== 'MIXED_CASE' && product?.depositEligible ? <div className="mt-3"><Label htmlFor={`empties-${line.key}`}>Empty {product.looseUnit}s provided</Label><Input id={`empties-${line.key}`} type="number" min={0} max={line.mode === 'CASE' ? line.quantity * product.caseQuantity : line.quantity} value={line.emptyBottlesProvided || 0} onChange={(e) => updateLine(line.key, { emptyBottlesProvided: Math.max(0, Number(e.target.value) || 0) })} /></div> : null}
                    {line.mode === 'MIXED_CASE' ? <div className="mt-2 space-y-2 text-xs text-slate-600">{line.components?.map((component, componentIndex) => {
                      const componentProduct = products.find((p) => p.id === component.productId)
                      return <div key={component.productId} className="grid grid-cols-[1fr_110px] items-end gap-2"><p>{componentProduct?.name}: {component.quantityBaseUnits} Glass Bottles</p>{componentProduct?.depositEligible ? <div><Label htmlFor={`mixed-empties-${line.key}-${component.productId}`} className="text-xs">Empties</Label><Input id={`mixed-empties-${line.key}-${component.productId}`} type="number" min={0} max={component.quantityBaseUnits} value={component.emptyBottlesProvided} onChange={(event) => {
                        const components = [...(line.components || [])]
                        components[componentIndex] = { ...component, emptyBottlesProvided: Math.max(0, Number(event.target.value) || 0) }
                        updateLine(line.key, { components })
                      }} /></div> : null}</div>
                    })}</div> : null}
                  </div>
                })}
                {!cart.length ? <p className="py-8 text-center text-sm text-slate-500">Select products to begin a sale.</p> : null}
              </div>

              <div className="grid gap-3"><div><Label htmlFor="fulfillment">Fulfillment</Label><select id="fulfillment" value={fulfillmentType} onChange={(e) => { setFulfillmentType(e.target.value as any); invalidateQuote() }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="IMMEDIATE">Immediate release</option><option value="CUSTOMER_PICKUP">Customer pickup</option></select></div><div><Label htmlFor="amount-paid">Amount paid</Label><Input id="amount-paid" type="number" min="0" step="0.01" value={amountPaid} onChange={(e) => { setAmountPaid(e.target.value); invalidateQuote() }} /></div></div>

              {quoteResult ? <div className="space-y-2 rounded-2xl bg-slate-950 p-4 text-sm text-white" aria-live="polite"><div className="flex justify-between"><span>Product total</span><span>{peso(quoteResult.productTotal)}</span></div><div className="flex justify-between"><span>Empty bottles provided</span><span>{quoteResult.emptyBottlesProvided}</span></div><div className="flex justify-between"><span>Deposit</span><span>{peso(quoteResult.deposit)}</span></div><div className="flex justify-between border-t border-white/20 pt-2 text-base font-bold"><span>Grand total</span><span>{peso(quoteResult.grandTotal)}</span></div><div className="flex justify-between"><span>{quoteResult.paymentStatus.replaceAll('_', ' ')}</span><span>Balance {peso(quoteResult.remainingBalance)}</span></div></div> : null}
              <div className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={submitting || !cart.length} onClick={reviewSale}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Review totals'}</Button><Button disabled={submitting || !quoteToken} onClick={completeSale}>{fulfillmentType === 'IMMEDIATE' ? 'Complete sale' : 'Reserve pickup'}</Button></div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(receipt)} onOpenChange={(open) => !open && setReceipt(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5" /> Retail Receipt</DialogTitle><DialogDescription>Ann Ann&apos;s Beverages Trading · {receipt?.transactionNumber}</DialogDescription></DialogHeader>
          {receipt ? <div className="space-y-4 text-sm"><div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4"><div><span className="text-slate-500">Customer</span><p className="font-semibold">{receipt.customer?.name}</p></div><div><span className="text-slate-500">Staff</span><p className="font-semibold">{receipt.staff?.name}</p></div><div><span className="text-slate-500">Date</span><p>{new Date(receipt.date).toLocaleString()}</p></div><div><span className="text-slate-500">Pickup</span><p>{String(receipt.pickupStatus).replaceAll('_', ' ')}</p></div></div><div className="space-y-2">{receipt.items?.map((item: any) => <div key={item.id} className="rounded-xl border p-3"><div className="flex justify-between"><div><p className="font-semibold">{item.productName}</p><p className="text-xs text-slate-500">{item.packagingType} · {item.mode.replaceAll('_', ' ')}</p></div><p className="font-semibold">{peso(item.productSubtotal)}</p></div>{item.components?.map((component: any) => <p key={component.id} className="mt-1 text-xs text-slate-600">{component.productName}: {component.quantityBaseUnits} {component.looseUnit}s</p>)}</div>)}</div><div className="space-y-2 border-t pt-4"><div className="flex justify-between"><span>Product total</span><span>{peso(receipt.productTotal)}</span></div><div className="flex justify-between"><span>Empties</span><span>{receipt.emptyBottlesProvided}</span></div><div className="flex justify-between"><span>Deposit</span><span>{peso(receipt.deposit)}</span></div><div className="flex justify-between text-lg font-bold"><span>Grand total</span><span>{peso(receipt.grandTotal)}</span></div><div className="flex justify-between"><span>{receipt.paymentStatus.replaceAll('_', ' ')}</span><span>Balance {peso(receipt.remainingBalance)}</span></div></div>{receipt.transactionStatus !== 'CANCELLED' ? <div className="space-y-3 rounded-xl border p-3"><div><Label htmlFor="receipt-payment">Recorded amount paid</Label><div className="flex gap-2"><Input id="receipt-payment" type="number" min="0" max={receipt.grandTotal} step="0.01" value={receiptPaymentAmount} onChange={(event) => setReceiptPaymentAmount(event.target.value)} /><Button variant="outline" disabled={submitting} onClick={() => mutateReceipt('payment', 'PATCH', { amountPaid: receiptPaymentAmount })}>Update</Button></div></div>{receipt.pickupStatus === 'PENDING_PICKUP' ? <Button className="w-full" disabled={submitting} onClick={() => mutateReceipt('pickup-status', 'PATCH', { pickupStatus: 'READY_FOR_PICKUP' })}>Mark ready for pickup</Button> : null}{receipt.pickupStatus === 'READY_FOR_PICKUP' ? <Button className="w-full" disabled={submitting} onClick={() => mutateReceipt('pickup-status', 'PATCH', { pickupStatus: 'PICKED_UP_COMPLETED' })}>Complete pickup</Button> : null}<Button variant="destructive" className="w-full" disabled={submitting} onClick={() => {
            const hasEmpties = Number(receipt.emptyBottlesProvided || 0) > 0
            const prompt = hasEmpties ? 'Confirm the accepted empties were physically returned to the customer or corrected, then cancel this transaction?' : 'Cancel this retail transaction and reverse its inventory effects?'
            if (window.confirm(prompt)) void mutateReceipt('cancel', 'POST', { reason: 'Cancelled by warehouse staff', emptiesRestoredToCustomer: hasEmpties })
          }}>Cancel transaction</Button></div> : null}<Button className="w-full" onClick={() => window.print()}>Print receipt</Button></div> : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
