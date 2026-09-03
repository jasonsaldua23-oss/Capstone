'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Loader2, PackageCheck, Recycle, Search } from 'lucide-react'

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
}

function formatEmptyStock(row: EmptyCaseInventoryRow): string {
  const parts: string[] = []
  if (row.availableCases > 0) {
    parts.push(`${row.availableCases.toLocaleString()} ${row.availableCases === 1 ? 'case' : 'cases'}`)
  }
  if (row.looseBottles > 0 || row.availableCases === 0) {
    parts.push(
      `${row.looseBottles.toLocaleString()} ${row.looseBottles === 1 ? 'glass bottle' : 'glass bottles'}`
    )
  }
  return parts.join(' and ')
}

export function WarehouseEmptyBottlesView({ warehouseId }: WarehouseEmptyBottlesViewProps) {
  const [rows, setRows] = useState<EmptyCaseInventoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    async function loadEmptyStock() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams()
        if (warehouseId) params.set('warehouseId', warehouseId)
        const query = params.toString()
        const response = await fetch(`/api/inventory/empty-cases${query ? `?${query}` : ''}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.error || 'Unable to load empty-case inventory.')
        setRows(Array.isArray(payload?.emptyCaseInventory) ? payload.emptyCaseInventory : [])
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setError(requestError instanceof Error ? requestError.message : 'Unable to load empty-case inventory.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    // Fix: show the warehouse's physical empty stock instead of customer order history.
    void loadEmptyStock()
    return () => controller.abort()
  }, [warehouseId])

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
          Current empty cases available for warehouse stock in, grouped by product.
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
                <p className="mt-0.5 text-[11px] text-slate-500">Ready to be consumed during stock in</p>
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
                    <th className="px-4 py-3 text-center">Available Empty Stock</th>
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
                          {formatEmptyStock(row)}
                        </Badge>
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
  )
}
