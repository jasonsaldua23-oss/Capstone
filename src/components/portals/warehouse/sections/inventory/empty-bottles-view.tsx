'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Loader2, PackageCheck, Recycle, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

interface EmptyCaseInventoryRow {
  inventoryId: string
  warehouseId: string
  warehouseName: string
  productId: string
  productName: string
  productSku: string
  containersPerCase: number
  availableBottles: number
  availableCases: number
  looseBottles: number
}

interface WarehouseEmptyBottlesViewProps {
  warehouseId?: string
  readOnly?: boolean
}

interface EmptyReturnHistoryRow {
  id: string
  createdAt: string
  quantity: number
  quantityUnit?: string
  performedBy?: string | null
  notes?: string | null
  product?: { name?: string; sku?: string }
  warehouse?: { name?: string }
}

// Use the original recorded units, not today's product packaging, for historical returns.
function getEmptyReturnDetails(row: EmptyReturnHistoryRow) {
  const notes = row.notes || ''
  const recorded = notes.match(/^Warehouse return: (\d+) (case|bottle)\(s\)\.\s*([\s\S]*)$/)
  const remarks = recorded?.[3] ?? notes
  const combined = recorded?.[2] === 'bottle'
    ? remarks.match(/^(\d+) full cases and (\d+) loose bottles\.\s*([\s\S]*)$/)
    : null
  if (combined) return { cases: Number(combined[1]), bottles: Number(combined[2]), remarks: combined[3] }
  if (recorded) return {
    cases: recorded[2] === 'case' ? Number(recorded[1]) : 0,
    bottles: recorded[2] === 'bottle' ? Number(recorded[1]) : 0,
    remarks,
  }
  return { cases: row.quantityUnit === 'CASE' ? row.quantity : 0, bottles: row.quantityUnit === 'CASE' ? 0 : row.quantity, remarks }
}

function ReturnedEmptiesHistory({ warehouseId }: { warehouseId?: string }) {
  const [history, setHistory] = useState<EmptyReturnHistoryRow[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function loadHistory() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ referenceType: 'manual_empty_return', page: String(page), pageSize: '20' })
        if (warehouseId) params.set('warehouseId', warehouseId)
        const response = await fetch(`/api/inventory-transactions?${params}`, { cache: 'no-store', signal: controller.signal })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error || 'Unable to load returned empties history.')
        if (controller.signal.aborted) return
        setHistory(Array.isArray(payload.transactions) ? payload.transactions : [])
        setTotalPages(Number(payload.totalPages) || 0)
      } catch (requestError) {
        if (controller.signal.aborted) return
        setError(requestError instanceof Error ? requestError.message : 'Unable to load returned empties history.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadHistory()
    return () => controller.abort()
  }, [warehouseId, page, retry])

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle className="text-base font-semibold text-slate-900">Returned Empties History</CardTitle>
        <CardDescription className="text-xs text-slate-500">Completed warehouse returns, newest first. Quantities show what was recorded at the time.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading return history...</div>
        ) : error ? (
          <div className="space-y-3 p-8 text-center"><p role="alert" className="text-sm text-red-600">{error}</p><Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry</Button></div>
        ) : history.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">No returned empties recorded yet.</p>
        ) : (
          <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3">Date &amp; time</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Warehouse</th>
                  <th className="px-4 py-3 text-center">Full cases</th><th className="px-4 py-3 text-center">Loose bottles</th><th className="px-4 py-3">Recorded by</th><th className="px-4 py-3">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((row) => {
                  const details = getEmptyReturnDetails(row)
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{new Date(row.createdAt).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-4 py-3"><p className="font-semibold text-slate-900">{row.product?.name || 'Unavailable product'}</p><p className="text-xs text-slate-500">{row.product?.sku || '—'}</p></td>
                      <td className="px-4 py-3 text-slate-600">{row.warehouse?.name || '—'}</td>
                      <td className="px-4 py-3 text-center font-semibold text-emerald-700">{details.cases.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center font-semibold text-blue-700">{details.bottles.toLocaleString()}</td>
                      <td className="px-4 py-3 text-slate-600">{row.performedBy || 'Not recorded'}</td>
                      <td className="max-w-xs whitespace-pre-wrap break-words px-4 py-3 text-slate-600">{details.remarks || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && !error && (
          <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-4 py-3">
            <Button size="sm" variant="outline" disabled={loading || page === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={loading || page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function WarehouseEmptyBottlesView({ warehouseId, readOnly = false }: WarehouseEmptyBottlesViewProps) {
  const [rows, setRows] = useState<EmptyCaseInventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [returnTarget, setReturnTarget] = useState<EmptyCaseInventoryRow | null>(null)
  const [returnForm, setReturnForm] = useState({ cases: '', looseBottles: '', remarks: '' })
  const [returnError, setReturnError] = useState('')
  const [isSavingReturn, setIsSavingReturn] = useState(false)
  const [historyRevision, setHistoryRevision] = useState(0)

  // Keep the full-case and loose-bottle inputs within their displayed physical balances.
  const returnCases = Number(returnForm.cases)
  const returnLooseBottles = Number(returnForm.looseBottles)
  const returnedBottles = returnCases * (returnTarget?.containersPerCase || 0) + returnLooseBottles
  const validReturn = !!returnTarget
    && Number.isSafeInteger(returnCases) && returnCases >= 0 && returnCases <= returnTarget.availableCases
    && Number.isSafeInteger(returnLooseBottles) && returnLooseBottles >= 0 && returnLooseBottles <= returnTarget.looseBottles
    && Number.isSafeInteger(returnedBottles) && returnedBottles > 0 && returnedBottles <= returnTarget.availableBottles

  const updateReturnQuantity = (field: 'cases' | 'looseBottles', value: string) => {
    if (!/^\d*$/.test(value)) return
    const maximum = field === 'cases' ? returnTarget?.availableCases : returnTarget?.looseBottles
    setReturnForm((current) => ({
      ...current,
      [field]: value === '' ? '' : String(Math.min(Number(value), maximum || 0)),
    }))
    setReturnError('')
  }

  // Reuse the inventory fetch after a return without navigating or resetting the page.
  const loadEmptyStock = useCallback(async (signal?: AbortSignal, showLoading = false) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (warehouseId) params.set('warehouseId', warehouseId)
      const query = params.toString()
      const response = await fetch(`/api/inventory/empty-cases${query ? `?${query}` : ''}`, {
        cache: 'no-store',
        signal,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Unable to load empty-case inventory.')
      setRows(Array.isArray(payload?.emptyCaseInventory) ? payload.emptyCaseInventory : [])
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return
      setError(requestError instanceof Error ? requestError.message : 'Unable to load empty-case inventory.')
    } finally {
      if (showLoading && !signal?.aborted) setLoading(false)
    }
  }, [warehouseId])

  useEffect(() => {
    const controller = new AbortController()

    // Fix: show the warehouse's physical empty stock instead of customer order history.
    void loadEmptyStock(controller.signal, true)
    return () => controller.abort()
  }, [loadEmptyStock])

  const submitReturn = async () => {
    // Fix: deduct warehouse empties without changing customer return records.
    if (readOnly || isSavingReturn || !returnTarget || !validReturn) return
    setIsSavingReturn(true)
    setReturnError('')
    try {
      const response = await fetch('/api/inventory/empty-returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // One bottle-total request makes a combined case/loose return atomic using the existing API.
        body: JSON.stringify({
          inventoryId: returnTarget.inventoryId,
          containerUnit: 'BOTTLE',
          quantity: returnedBottles,
          remarks: `${returnCases} full cases and ${returnLooseBottles} loose bottles. ${returnForm.remarks.trim()}`.trim(),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || 'Unable to record returned containers.')
      setReturnTarget(null)
      setReturnForm({ cases: '', looseBottles: '', remarks: '' })
      toast.success('Empty containers returned')
      // Reload the history's first page after saving, without refreshing the portal.
      setHistoryRevision((value) => value + 1)
      // Refresh only this table and its derived totals from the saved server balance.
      await loadEmptyStock()
    } catch (requestError) {
      setReturnError(requestError instanceof Error ? requestError.message : 'Unable to record returned containers.')
    } finally {
      setIsSavingReturn(false)
    }
  }

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) =>
      [row.productName, row.productSku, row.warehouseName].some((value) =>
        String(value || '').toLowerCase().includes(query)
      )
    )
  }, [rows, searchQuery])

  const totals = useMemo(
    () =>
      rows.reduce(
        (summary, row) => ({
          cases: summary.cases + row.availableCases,
          looseBottles: summary.looseBottles + row.looseBottles,
        }),
        { cases: 0, looseBottles: 0 }
      ),
    [rows]
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Recycle className="h-5 w-5 text-emerald-600" />
          Empty Bottles &amp; Cases Management
        </h2>
        <p className="mt-0.5 text-sm text-slate-500">
          {readOnly
            ? 'Monitor the physical empty-container stock across warehouses.'
            : 'Return warehouse empties manually. Restocking does not deduct empty stock.'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="border-slate-200 bg-gradient-to-br from-emerald-50/50 to-white shadow-sm">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Available Empty Stock</p>
                <p className="mt-1 text-2xl font-bold text-emerald-700">
                  {totals.cases.toLocaleString()} {totals.cases === 1 ? 'case' : 'cases'}
                  {totals.looseBottles > 0
                    ? ` and ${totals.looseBottles.toLocaleString()} ${totals.looseBottles === 1 ? 'glass bottle' : 'glass bottles'}`
                    : ''}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">Received from delivered customer orders</p>
              </div>
              <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-600">
                <Recycle className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-gradient-to-br from-blue-50/50 to-white shadow-sm">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Products With Empties</p>
                <p className="mt-1 text-2xl font-bold text-blue-700">{rows.length.toLocaleString()}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Products with a current physical balance</p>
              </div>
              <div className="rounded-xl bg-blue-100 p-2.5 text-blue-600">
                <PackageCheck className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="text-base font-semibold text-slate-900">Current Empty-Case Inventory</CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Customer checkout reservations and delivered-order history are not shown here.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-auto sm:min-w-[260px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search product, SKU, warehouse..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-9 border-slate-200 bg-slate-50 pl-8 text-xs"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading empty-case inventory...
            </div>
          ) : error ? (
            <div className="p-12 text-center text-sm text-red-600">{error}</div>
          ) : filteredRows.length === 0 ? (
            <div className="space-y-2 p-12 text-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Recycle className="h-6 w-6" />
              </div>
              <p className="font-medium text-slate-700">No available empty cases found</p>
              <p className="text-xs text-slate-500">Delivered empties appear here only while a physical balance remains.</p>
            </div>
          ) : (
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Warehouse</th>
                    <th className="px-4 py-3 text-center">Bottles per Case</th>
                    <th className="px-4 py-3 text-center">Available Empty Cases</th>
                    <th className="px-4 py-3 text-center">Loose Bottles</th>
                    {/* Admin monitoring is read-only, so actions remain available only to warehouse staff. */}
                    {!readOnly && <th className="px-4 py-3 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRows.map((row) => (
                    <tr key={row.inventoryId} className="transition-colors hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-medium text-slate-600">{row.productSku || '—'}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{row.productName}</td>
                      <td className="px-4 py-3 text-slate-600">{row.warehouseName}</td>
                      <td className="px-4 py-3 text-center text-slate-700">{row.containersPerCase.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge className="border-emerald-200 bg-emerald-50 font-semibold text-emerald-700">
                          <Recycle className="mr-1 h-3 w-3" />
                          {row.availableCases.toLocaleString()} {row.availableCases === 1 ? 'case' : 'cases'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {/* The API returns only the remainder after complete cases are formed. */}
                        <Badge className="border-blue-200 bg-blue-50 font-semibold text-blue-700">
                          {row.looseBottles.toLocaleString()} {row.looseBottles === 1 ? 'bottle' : 'bottles'}
                        </Badge>
                      </td>
                      {!readOnly && (
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" variant="outline" onClick={() => {
                            // Start each product return with a clean form and no stale validation error.
                            setReturnForm({ cases: '', looseBottles: '', remarks: '' })
                            setReturnError('')
                            setReturnTarget(row)
                          }}>
                            Return
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ReturnedEmptiesHistory key={`${warehouseId || 'all'}-${historyRevision}`} warehouseId={warehouseId} />

      {!readOnly && <Dialog open={!!returnTarget} onOpenChange={(open) => !open && !isSavingReturn && setReturnTarget(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-xl border-slate-200 bg-white p-5 sm:max-w-lg sm:p-6" showCloseButton={!isSavingReturn}>
          <DialogHeader className="pr-6 text-left">
            <DialogTitle className="text-xl font-semibold text-slate-900">Return empty containers</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-slate-500">Enter the full cases and loose bottles being sent back. Confirming deducts them from empty stock.</DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void submitReturn() }}>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="break-words text-sm font-semibold text-slate-900">{returnTarget?.productName}</p>
              <p className="mt-1 break-words text-xs text-slate-500">{returnTarget?.warehouseName} · {returnTarget?.containersPerCase} bottles per case</p>
            </div>
            {/* Separate labeled fields stack on mobile; whole-number input avoids oversized native spinners. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="empty-return-cases" className="text-sm font-medium">Full cases</Label>
                <Input id="empty-return-cases" type="text" inputMode="numeric" pattern="[0-9]*" placeholder="0" autoComplete="off" aria-describedby="empty-return-cases-help" className="h-11 bg-white text-base tabular-nums" value={returnForm.cases} disabled={isSavingReturn || !returnTarget?.availableCases} onChange={(event) => updateReturnQuantity('cases', event.target.value)} />
                <p id="empty-return-cases-help" className="text-xs text-slate-500">Available: {returnTarget?.availableCases.toLocaleString() ?? 0} cases</p>
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="empty-return-bottles" className="text-sm font-medium">Loose bottles</Label>
                <Input id="empty-return-bottles" type="text" inputMode="numeric" pattern="[0-9]*" placeholder="0" autoComplete="off" aria-describedby="empty-return-bottles-help" className="h-11 bg-white text-base tabular-nums" value={returnForm.looseBottles} disabled={isSavingReturn || !returnTarget?.looseBottles} onChange={(event) => updateReturnQuantity('looseBottles', event.target.value)} />
                <p id="empty-return-bottles-help" className="text-xs text-slate-500">Available: {returnTarget?.looseBottles.toLocaleString() ?? 0} loose bottles</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="empty-return-remarks" className="text-sm font-medium">Remarks <span className="font-normal text-slate-400">(optional)</span></Label>
              <Input id="empty-return-remarks" className="h-11 bg-white" value={returnForm.remarks} disabled={isSavingReturn} placeholder="Add a note about this return" onChange={(event) => setReturnForm((current) => ({ ...current, remarks: event.target.value }))} />
            </div>
            <p className="text-sm text-slate-600" aria-live="polite">Returning: <span className="font-semibold text-slate-900">{returnCases} {returnCases === 1 ? 'case' : 'cases'} and {returnLooseBottles} loose {returnLooseBottles === 1 ? 'bottle' : 'bottles'}</span></p>
            {returnError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{returnError}</p>}
            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="h-11" disabled={isSavingReturn} onClick={() => setReturnTarget(null)}>Cancel</Button>
              <Button type="submit" className="h-11 bg-emerald-700 text-white hover:bg-emerald-800" disabled={isSavingReturn || !validReturn}>
                {isSavingReturn && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isSavingReturn ? 'Recording…' : 'Confirm return'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>}
    </div>
  )
}
