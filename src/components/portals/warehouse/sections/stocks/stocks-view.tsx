'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { emitDataSync } from '@/lib/data-sync'
import { invalidateInventoryStockCaches } from '@/lib/portal-data-cache'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Loader2, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import type { WarehouseStocksViewProps } from '../shared/types'

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
  // Added: compare exact expiry timestamps, avoiding rounded days hiding newly expired stock.
  const isExpired = (batch: any) => !!batch.expiryDate && new Date(batch.expiryDate).getTime() <= Date.now()
  const openAction = (batch: any, nextAction: string) => {
    setTarget(batch); setAction(nextAction); setQuantity(''); setReason(''); setUnit('CASE'); setError('')
    setRequestId(crypto.randomUUID())
  }
  const submitAction = async () => {
    if (!target || saving) return
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stocks</CardTitle>
        <CardDescription>Batch-based stock-in records with manufactured date, expiry date, and days left.</CardDescription>
        <Input
          aria-label="Search stock batches"
          placeholder="Search stock batches…"
          value={batchSearch}
          onChange={(event) => setBatchSearch(event.target.value)}
          className="h-12 w-full text-base md:max-w-xl"
        />
        <select aria-label="Filter batches by expiry" className="h-10 w-fit rounded-md border border-input bg-background px-3 text-sm" value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value)}>
          <option value="all">All batches</option><option value="current">Not expired</option><option value="expired">Expired - awaiting action</option>
        </select>
        <p className="text-xs text-gray-500">Expired stock stays in physical inventory until its supplier return or disposal is confirmed.</p>
      </CardHeader>
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
                      <td className="p-4">
                        {expired ? <div className="flex flex-col gap-2">
                          <Button size="sm" variant="outline" onClick={() => openAction(batch, 'SUPPLIER_RETURN')}>Return to supplier</Button>
                          <Button size="sm" variant="outline" onClick={() => openAction(batch, 'DISPOSAL')}>Record disposal</Button>
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
            <DialogTitle>{action === 'DISPOSAL' ? 'Record disposal' : 'Return to supplier'}</DialogTitle>
            <DialogDescription>Confirm only stock physically removed from the warehouse. This reduces inventory and retains the batch history.</DialogDescription>
          </DialogHeader>
          <p className="text-sm">Batch: {target?.batchNumber} | Remaining: {target?.quantity} cases, {target?.looseUnits || 0} loose units</p>
          <label className="space-y-1 text-sm">Unit<select className="h-10 w-full rounded-md border px-3" value={unit} disabled={saving} onChange={(event) => setUnit(event.target.value)}><option value="CASE">Cases / packs</option><option value="BASE_UNIT">Loose base units</option></select></label>
          <label className="space-y-1 text-sm">Quantity<Input type="number" min="1" step="1" max={unit === 'CASE' ? target?.quantity : target?.looseUnits || 0} value={quantity} disabled={saving} onChange={(event) => setQuantity(event.target.value)} /></label>
          <label className="space-y-1 text-sm">Reason / supplier reference<Input value={reason} disabled={saving} onChange={(event) => setReason(event.target.value)} placeholder="Record the reason and relevant reference" /></label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button disabled={saving || !reason.trim() || !Number.isInteger(Number(quantity)) || Number(quantity) <= 0 || Number(quantity) > Number(unit === 'CASE' ? target?.quantity : target?.looseUnits || 0)} onClick={submitAction}>{saving ? 'Recording...' : 'Confirm physical removal'}</Button>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
