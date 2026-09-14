'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { emitDataSync } from '@/lib/data-sync'
import { invalidateInventoryStockCaches } from '@/lib/portal-data-cache'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ArrowLeft, History, Loader2, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import type { WarehouseStocksViewProps } from '../shared/types'

type DisposalHistoryRow = {
  id: string
  disposedAt: string
  batchNumber: string
  quantity: number
  quantityUnit?: 'CASE' | 'BASE_UNIT'
  expiryDate?: string | null
  manufacturedDate?: string | null
  reason?: string | null
  performedBy?: string | null
  lossAmount?: number | string | null
  product?: { name?: string; sku?: string; sizes?: string[] }
}

export function WarehouseStocksView({ loadingBatches, stockBatches, getDaysLeft, openBatchQuantityDialog }: WarehouseStocksViewProps) {
  const [batchSearch, setBatchSearch] = useState('')
  const [expiryFilter, setExpiryFilter] = useState('all')
  const [target, setTarget] = useState<any>(null)
  const [action, setAction] = useState('DISPOSAL')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('CASE')
  const [reason, setReason] = useState('')
  const [requestId, setRequestId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showDisposedStocks, setShowDisposedStocks] = useState(false)
  const [disposals, setDisposals] = useState<DisposalHistoryRow[]>([])
  const [loadingDisposals, setLoadingDisposals] = useState(false)
  const [disposalsError, setDisposalsError] = useState('')
  const [disposalsSearch, setDisposalsSearch] = useState('')
  // Added: compare exact expiry timestamps, avoiding rounded days hiding newly expired stock.
  const isExpired = (batch: any) => !!batch.expiryDate && new Date(batch.expiryDate).getTime() <= Date.now()
  const openAction = (batch: any, nextAction: string) => {
    setTarget(batch); setAction(nextAction); setQuantity(''); setReason(''); setUnit('CASE'); setError('')
    setRequestId(crypto.randomUUID())
  }
  const availableDisposalQuantity = Number(unit === 'CASE' ? target?.quantity : target?.looseUnits || 0)
  const parsedDisposalQuantity = Number(quantity)
  const quantityError = !target
    ? ''
    : !quantity.trim()
      ? 'Enter the quantity to dispose.'
      : !Number.isSafeInteger(parsedDisposalQuantity) || parsedDisposalQuantity <= 0
        ? 'Quantity must be a positive whole number.'
        : parsedDisposalQuantity > availableDisposalQuantity
          ? `Only ${availableDisposalQuantity.toLocaleString()} ${unit === 'CASE' ? 'cases' : 'loose bottles'} remain in this batch.`
          : ''
  const reasonError = !reason.trim()
    ? 'Enter the disposal reason or reference.'
    : reason.trim().length > 500
      ? 'Disposal reason must be 500 characters or fewer.'
      : ''
  const disposalValidationError = quantityError || reasonError
  const submitAction = async () => {
    if (!target || saving) return
    if (disposalValidationError) {
      setError(disposalValidationError)
      return
    }
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/stock-batches/expired-stock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: target.id, action, quantity: Number(quantity), unit, reason, requestId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to record expired stock action')
      // Added: refresh physical and sellable balances only after a confirmed server transaction.
      invalidateInventoryStockCaches()
      emitDataSync(['inventory', 'stock-batches', 'inventory-transactions'])
      setTarget(null)
      toast.success(payload.message || 'Expired stock action recorded')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to record expired stock action')
    } finally { setSaving(false) }
  }
  const loadDisposals = async () => {
    setLoadingDisposals(true)
    setDisposalsError('')
    try {
      const response = await fetch('/api/stock-batches/disposals?pageSize=100', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to load disposed stock history')
      setDisposals(Array.isArray(payload.disposals) ? payload.disposals : [])
    } catch (requestError) {
      setDisposalsError(requestError instanceof Error ? requestError.message : 'Unable to load disposed stock history')
    } finally {
      setLoadingDisposals(false)
    }
  }
  const openDisposedStocks = () => {
    setShowDisposedStocks(true)
    void loadDisposals()
  }
  const getBatchSizeLabel = (batch: any) => {
    const productSizes = Array.isArray(batch?.inventory?.product?.sizes)
      ? batch.inventory.product.sizes
      : []
    const sizes = productSizes
      .map((value: any) => String(value || '').trim())
      .filter(Boolean)
    if (sizes.length > 0) return sizes.join(', ')
    const fallback = String(
      batch?.inventory?.product?.size ||
      batch?.inventory?.product?.sizeLabel ||
      batch?.inventory?.product?.unit ||
      ''
    ).trim()
    return fallback || 'N/A'
  }
  const query = batchSearch.trim().toLowerCase()
  // Added: search batch number, product, SKU, and size while retaining the expiry filter.
  const visibleBatches = stockBatches.filter((batch) => {
    const matchesExpiry = expiryFilter === 'all' || (expiryFilter === 'expired' ? isExpired(batch) : !isExpired(batch))
    const matchesSearch = [
      batch.batchNumber,
      batch.inventory?.product?.sku,
      batch.inventory?.product?.name,
      getBatchSizeLabel(batch),
    ].some((value) => String(value || '').toLowerCase().includes(query))
    return matchesExpiry && matchesSearch
  })
  const formatDisposalQuantity = (row: DisposalHistoryRow) => {
    const label = row.quantityUnit === 'BASE_UNIT' ? 'loose bottles' : 'cases'
    return `${Number(row.quantity || 0).toLocaleString()} ${label}`
  }
  const formatLoss = (value: DisposalHistoryRow['lossAmount']) => {
    if (value === null || value === undefined) return 'Not recorded'
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value))
  }
  const disposalQuery = disposalsSearch.trim().toLowerCase()
  const visibleDisposals = disposals.filter((row) =>
    [row.batchNumber, row.product?.name, row.product?.sku, row.reason]
      .some((value) => String(value || '').toLowerCase().includes(disposalQuery))
  )

  // Match archived products: history is a dedicated in-page workspace, not a blocking overlay.
  if (showDisposedStocks) {
    return (
      <div className="space-y-5 rounded-xl border bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" onClick={() => setShowDisposedStocks(false)} aria-label="Back to stock batches">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Disposed Stocks</h2>
              <p className="text-sm text-slate-500">Confirmed expired-stock removals and their recorded listed-price loss.</p>
            </div>
          </div>
          <Input
            aria-label="Search disposed stocks"
            placeholder="Search disposed stocks…"
            value={disposalsSearch}
            onChange={(event) => setDisposalsSearch(event.target.value)}
            className="w-full sm:max-w-xs"
          />
        </div>

        {loadingDisposals ? (
          <div role="status" className="flex h-40 items-center justify-center gap-2 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading disposed stocks…
          </div>
        ) : disposalsError ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
            <p role="alert" className="text-sm text-red-600">{disposalsError}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadDisposals()}>Retry</Button>
          </div>
        ) : visibleDisposals.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-dashed text-slate-500">
            {disposalQuery ? 'No disposed stocks match your search.' : 'No disposed stocks recorded.'}
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto rounded-xl border overscroll-x-contain">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="border-b bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Disposed</th><th className="px-4 py-3 font-medium">Batch</th><th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Quantity</th><th className="px-4 py-3 font-medium">Manufactured</th><th className="px-4 py-3 font-medium">Expiry</th>
                  <th className="px-4 py-3 text-right font-medium">Loss (listed price)</th><th className="px-4 py-3 font-medium">Recorded by</th><th className="px-4 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {visibleDisposals.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(row.disposedAt).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{row.batchNumber || 'Unavailable batch'}</td>
                    <td className="px-4 py-3"><p className="font-medium text-slate-900">{row.product?.name || 'Unavailable product'}</p><p className="text-xs text-slate-500">{[row.product?.sku, ...(row.product?.sizes || [])].filter(Boolean).join(' · ') || '—'}</p></td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">{formatDisposalQuantity(row)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{row.manufacturedDate ? new Date(row.manufacturedDate).toLocaleDateString() : 'Not available'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{row.expiryDate ? new Date(row.expiryDate).toLocaleDateString() : 'Not available'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-rose-700">{formatLoss(row.lossAmount)}</td>
                    <td className="px-4 py-3 text-slate-600">{row.performedBy || 'Not recorded'}</td>
                    <td className="max-w-xs whitespace-pre-wrap break-words px-4 py-3 text-slate-600">{row.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Stocks</CardTitle>
            <CardDescription>Batch-based stock-in records with manufactured date, expiry date, and days left.</CardDescription>
          </div>
          {/* Keep page navigation separate from the batch search and filter controls. */}
          <Button type="button" variant="outline" onClick={openDisposedStocks}>
            <History className="mr-2 h-4 w-4" />
            Disposed Stocks
          </Button>
        </div>
      </CardHeader>
      <div className="flex flex-col gap-3 px-6 pb-2 sm:flex-row sm:items-center">
        <Input
          aria-label="Search stock batches"
          placeholder="Search stock batches…"
          value={batchSearch}
          onChange={(event) => setBatchSearch(event.target.value)}
          className="h-12 w-full text-base sm:max-w-xl"
        />
        <select aria-label="Filter batches by expiry" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-fit" value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value)}>
          <option value="all">All batches</option><option value="current">Not expired</option><option value="expired">Expired - awaiting action</option>
        </select>
      </div>
      <p className="px-6 pb-4 text-xs text-gray-500">Expired stock stays in physical inventory until its disposal is confirmed.</p>
      <CardContent className="p-0">
        {loadingBatches ? (
          <PortalTableSkeleton rows={4} columns={5} className="border-0 shadow-none" />
        ) : visibleBatches.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-gray-500">No stock-in batches found</div>
        ) : (
          <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[1180px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left p-4 font-medium text-gray-600">Batch #</th>
                  <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                  <th className="text-left p-4 font-medium text-gray-600">Product</th>
                  <th className="text-left p-4 font-medium text-gray-600">Size</th>
                  <th className="text-left p-4 font-medium text-gray-600">Qty</th>
                  <th className="text-left p-4 font-medium text-gray-600">Loose Bottles</th>
                  <th className="text-left p-4 font-medium text-gray-600">Manufactured Date</th>
                  <th className="text-left p-4 font-medium text-gray-600">Expiry Date</th>
                  <th className="text-left p-4 font-medium text-gray-600">Days Left</th>
                  <th className="text-left p-4 font-medium text-gray-600">Status</th>
                  <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleBatches.map((batch) => {
                  const daysLeft = getDaysLeft(batch.expiryDate)
                  const expiringSoon = typeof daysLeft === 'number' && daysLeft >= 0 && daysLeft <= 14
                  const expired = isExpired(batch)
                  return (
                    <tr key={batch.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4 font-medium text-gray-900">{batch.batchNumber}</td>
                      <td className="p-4">{batch.inventory?.product?.sku || 'N/A'}</td>
                      <td className="p-4">{batch.inventory?.product?.name || 'N/A'}</td>
                      <td className="p-4">{getBatchSizeLabel(batch)}</td>
                      <td className="p-4 font-semibold">{batch.quantity}</td>
                      {/* Updated: keep loose bottles directly beside the full batch quantity. */}
                      <td className="p-4 font-semibold text-gray-700">{Number(batch.looseUnits || 0)}</td>
                      <td className="p-4">{new Date(batch.receiptDate).toLocaleDateString()}</td>
                      <td className="p-4">{batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : 'N/A'}</td>
                      <td className={`p-4 font-semibold ${expired ? 'text-red-600' : expiringSoon ? 'text-orange-600' : 'text-green-600'}`}>
                        {expired ? 'Expired' : typeof daysLeft === 'number' ? `${Math.max(daysLeft, 0)} days` : 'N/A'}
                      </td>
                      <td className="p-4">
                        {expired && <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Expired</Badge>}
                        {!expired && expiringSoon && <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Expiring Soon</Badge>}
                        {!expired && !expiringSoon && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>}
                      </td>
                      <td className="px-2 py-4 sm:px-3">
                        {expired ? <div className="w-full max-w-[120px]">
                          {/* Fix: expired stock has one warehouse action; keep its destructive control fully visible. */}
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full min-w-0 border-rose-300 px-2 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            onClick={() => openAction(batch, 'DISPOSAL')}
                            title="Dispose stock"
                          >
                            <Trash2 className="mr-1.5 h-4 w-4 shrink-0" />
                            Dispose
                          </Button>
                        </div> : <Button
                          size="icon"
                          variant="ghost"
                          className="text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                          onClick={() => openBatchQuantityDialog(batch)}
                          title="Edit batch quantity and dates"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <Dialog open={!!target} onOpenChange={(open) => { if (!open && !saving) setTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record stock disposal</DialogTitle>
            <DialogDescription>Confirm only stock physically removed from the warehouse. This reduces inventory and retains the batch history.</DialogDescription>
          </DialogHeader>
          <p className="text-sm">Batch: {target?.batchNumber} | Remaining: {target?.quantity} cases, {target?.looseUnits || 0} loose units</p>
          <label className="space-y-1 text-sm">Unit<select className="h-10 w-full rounded-md border px-3" value={unit} disabled={saving} onChange={(event) => { setUnit(event.target.value); setError('') }}><option value="CASE">Cases / packs</option><option value="BASE_UNIT">Loose base units</option></select></label>
          <label className="space-y-1 text-sm">Quantity<Input type="number" min="1" step="1" max={availableDisposalQuantity} value={quantity} disabled={saving} aria-invalid={!!quantityError} onChange={(event) => { setQuantity(event.target.value); setError('') }} /></label>
          {quantityError && <p role="alert" className="-mt-2 text-sm text-red-600">{quantityError}</p>}
          <label className="space-y-1 text-sm">Disposal reason / reference<Input value={reason} maxLength={500} disabled={saving} aria-invalid={!!reasonError} onChange={(event) => { setReason(event.target.value); setError('') }} placeholder="Record the disposal reason and relevant reference" /></label>
          {reasonError && <p role="alert" className="-mt-2 text-sm text-red-600">{reasonError}</p>}
          {error && error !== disposalValidationError && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button disabled={saving || !!disposalValidationError} onClick={submitAction}>{saving ? 'Recording...' : 'Confirm physical removal'}</Button>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
