'use client'

import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface ShortfallLine {
  productId: string
  productName: string
  productSku?: string
  declaredBottles: number
  countedBottles: number
  missingBottles: number
}

interface ShortfallRow {
  orderId: string
  orderNumber: string
  customerName: string
  warehouseName: string
  deliveredAt: string
  returnNumber: string
  countedBy?: string | null
  missingBottles: number
  depositCharged: number
  lines: ShortfallLine[]
}

interface ShortfallSummary {
  orders: number
  missingBottles: number
  depositCharged: number
}

// How an incomplete return is handled, in the order it happens at the stop.
const PROCESS_STEPS = [
  { title: 'Counted at the stop', body: "The driver counts each product's empties, cases and any bottles missing from them, before completing the delivery." },
  { title: 'Missing deposit charged', body: 'Each missing bottle adds its bottle deposit to the amount due, and a case not handed over adds its crate deposit too. The driver collects it.' },
  { title: 'Empty stock adjusted', body: "Only the bottles that arrived are added to the warehouse's empty stock." },
]

const formatPeso = (value: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value)
const bottles = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'bottle' : 'bottles'}`

/** Delivered orders whose customer handed over fewer empties than they declared at checkout. */
export function IncompleteEmptiesReturns({ warehouseId }: { warehouseId?: string }) {
  const [rows, setRows] = useState<ShortfallRow[]>([])
  const [summary, setSummary] = useState<ShortfallSummary | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function loadShortfalls() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: '10' })
        if (warehouseId) params.set('warehouseId', warehouseId)
        const response = await fetch(`/api/inventory/empties-shortfalls?${params}`, { cache: 'no-store', signal: controller.signal })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.error || 'Unable to load incomplete returns.')
        if (controller.signal.aborted) return
        setRows(Array.isArray(payload.shortfalls) ? payload.shortfalls : [])
        setSummary(payload.summary || null)
        setTotalPages(Number(payload.totalPages) || 0)
      } catch (requestError) {
        if (controller.signal.aborted) return
        setError(requestError instanceof Error ? requestError.message : 'Unable to load incomplete returns.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void loadShortfalls()
    return () => controller.abort()
  }, [warehouseId, page, retry])

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 pb-3">
        <CardTitle className="text-base font-semibold text-slate-900">Incomplete Empties Returns</CardTitle>
        <CardDescription className="text-xs text-slate-500">
          Delivered orders where the customer handed over fewer empties than they declared at checkout.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ol aria-label="How incomplete returns are handled" className="grid grid-cols-1 gap-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-3">
          {PROCESS_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{index + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading incomplete returns...</div>
        ) : error ? (
          <div className="space-y-3 p-8 text-center"><p role="alert" className="text-sm text-red-600">{error}</p><Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry</Button></div>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">No incomplete returns. Every delivered order&apos;s empties matched what was declared.</p>
        ) : (
          <>
            {summary && (
              <p className="px-4 pt-3 text-xs text-slate-600">
                <span className="font-semibold text-slate-900">{summary.orders.toLocaleString()} {summary.orders === 1 ? 'order' : 'orders'}</span>
                {' · '}<span className="font-semibold text-red-700">{bottles(summary.missingBottles)} missing</span>
                {' · '}<span className="font-semibold text-amber-800">{formatPeso(summary.depositCharged)}</span> deposit charged
              </p>
            )}
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="stack-table w-full min-w-[960px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Delivered</th><th className="px-4 py-3">Order</th><th className="px-4 py-3">Warehouse</th>
                    <th className="px-4 py-3">Empties counted</th><th className="px-4 py-3 text-center">Missing</th>
                    <th className="px-4 py-3 text-right">Deposit charged</th><th className="px-4 py-3">Counted by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.orderId} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-slate-600"><span className="whitespace-nowrap">{new Date(row.deliveredAt).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></td>
                      <td className="px-4 py-3"><p className="whitespace-nowrap font-semibold text-slate-900">{row.orderNumber}</p><p className="text-xs text-slate-500">{row.customerName}</p></td>
                      <td className="px-4 py-3 text-slate-600">{row.warehouseName}</td>
                      <td className="px-4 py-3">
                        <ul className="space-y-1">
                          {row.lines.map((line) => (
                            <li key={line.productId}>
                              <p className="font-medium text-slate-900">{line.productName}</p>
                              <p className="text-xs text-slate-500">{line.countedBottles.toLocaleString()} of {bottles(line.declaredBottles)} handed over</p>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-red-700"><span className="whitespace-nowrap">{bottles(row.missingBottles)}</span></td>
                      <td className="px-4 py-3 text-right font-semibold text-amber-800"><span className="whitespace-nowrap">{row.depositCharged > 0 ? formatPeso(row.depositCharged) : '—'}</span></td>
                      <td className="px-4 py-3"><p className="text-slate-700">{row.countedBy || 'Not recorded'}</p><p className="whitespace-nowrap text-xs text-slate-500">{row.returnNumber}</p></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
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
