'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  Store,
  Search,
  Receipt,
  Building2,
  Calendar,
  Eye,
  Printer,
  Package,
  Recycle,
  User,
  Phone,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react'
import { toast } from 'sonner'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { safeFetchJson, getCollection } from './shared'

type RetailSaleItem = {
  id: string
  mode: string
  productName: string
  sku?: string
  quantity: number
  unitPrice: string | number
  subtotal: string | number
  depositPerUnit?: string | number
  depositSubtotal?: string | number
  emptyBottlesProvided?: number
  depositCredit?: string | number
  totalAmount?: string | number
  mixedComponents?: Array<{
    id: string
    productName: string
    quantityBaseUnits: number
    emptyBottlesProvided: number
  }>
}

type RetailSale = {
  id: string
  transactionNumber: string
  salesChannel: string
  warehouseId?: string
  warehouseName?: string
  warehouseCode?: string
  createdAt: string
  customerType: string
  customerName: string
  walkInName?: string
  walkInContact?: string
  walkInNotes?: string
  customerPhone?: string
  fulfillmentType: string
  pickupStatus: string
  subtotal: string | number
  taxAmount: string | number
  depositTotal: string | number
  depositCreditTotal: string | number
  totalAmount: string | number
  items: RetailSaleItem[]
}

const formatPeso = (val: unknown) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(val || 0))

const getProductDisplayName = (item: any) => {
  const baseName = String(item?.productName || item?.name || 'Product').trim()
  const rawSizes = Array.isArray(item?.sizes)
    ? item.sizes
    : Array.isArray(item?.product?.sizes)
      ? item.product.sizes
      : []
  const validSizes = rawSizes.map((s: any) => String(s || '').trim()).filter(Boolean)
  const sizeString = validSizes.join(', ') || String(item?.size || item?.sizeLabel || '').trim()

  if (sizeString && !baseName.toLowerCase().includes(sizeString.toLowerCase())) {
    return `${baseName} (${sizeString})`
  }
  return baseName
}

export function RetailTransactionsView() {
  const [sales, setSales] = useState<RetailSale[]>([])
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; code: string }>>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('ALL')
  const [selectedReceipt, setSelectedReceipt] = useState<RetailSale | null>(null)

  const fetchSales = useCallback(async () => {
    setLoading(true)
    try {
      const url = warehouseFilter && warehouseFilter !== 'ALL'
        ? `/api/retail/sales?warehouseId=${encodeURIComponent(warehouseFilter)}&pageSize=50`
        : '/api/retail/sales?pageSize=50'
      const result = await safeFetchJson(url, { cache: 'no-store' })
      if (result.ok) {
        setSales(getCollection<RetailSale>(result.data, ['sales']))
      } else if (!result.data?.aborted) {
        // A timed-out or truncated response is a transient blip, not a reason to
        // alarm the cashier mid-shift; the retry on next fetch recovers silently.
        toast.error(result.data?.error || 'Failed to load retail sales')
      }
    } catch {
      toast.error('Network error loading retail sales')
    } finally {
      setLoading(false)
    }
  }, [warehouseFilter])

  const fetchWarehouses = useCallback(async () => {
    try {
      const result = await safeFetchJson('/api/warehouses?page=1&pageSize=100', { cache: 'no-store' })
      if (result.ok) {
        setWarehouses(getCollection<any>(result.data, ['warehouses']))
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void fetchWarehouses()
  }, [fetchWarehouses])

  useEffect(() => {
    void fetchSales()
  }, [fetchSales])

  const filteredSales = useMemo(() => {
    return sales.filter((sale: any) => {
      const q = searchQuery.trim().toLowerCase()
      const custName = sale.customerName || sale.walkInName || sale.customer?.name || ''
      const custPhone = sale.walkInContact || sale.customerPhone || sale.customer?.contactNumber || sale.customer?.phone || ''
      const itemsText = Array.isArray(sale.items)
        ? sale.items.map((i: any) => `${getProductDisplayName(i)} ${i.productSku || ''}`).join(' ')
        : ''
      const matchesSearch =
        !q ||
        (sale.transactionNumber && String(sale.transactionNumber).toLowerCase().includes(q)) ||
        custName.toLowerCase().includes(q) ||
        custPhone.toLowerCase().includes(q) ||
        itemsText.toLowerCase().includes(q)

      return matchesSearch
    })
  }, [sales, searchQuery])

  // Summary Metrics
  const totalRevenue = useMemo(() => {
    return sales.reduce((sum, s: any) => sum + Number(s.totalAmount ?? s.grandTotal ?? 0), 0)
  }, [sales])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-950 flex items-center gap-2.5">
            <Store className="h-6 w-6 text-sky-600" />
            Retail / Counter Transactions
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Track walk-in counter sales and transaction details across warehouses.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchSales}
          disabled={loading}
          className="border-slate-200 hover:bg-slate-50 text-slate-700 self-start sm:self-auto"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200 shadow-sm bg-gradient-to-br from-sky-50/50 to-white">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Retail Sales</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{formatPeso(totalRevenue)}</p>
                <p className="text-xs text-slate-500 mt-0.5">{sales.length} transactions total</p>
              </div>
              <div className="rounded-xl p-2.5 bg-sky-100 text-sky-600">
                <Store className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Table Card */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold text-slate-900">Retail Sales History</CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Detailed records of all counter receipts, items sold, and deposit credits.
              </CardDescription>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search receipt, customer, item..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9 text-xs bg-slate-50 border-slate-200"
                />
              </div>

              {/* Warehouse selector */}
              <select
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value)}
                className="h-9 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="ALL">All Warehouses</option>
                {warehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.name} ({wh.code})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-8">
              <PortalTableSkeleton rows={6} columns={6} className="border-0 shadow-none" />
            </div>
          ) : filteredSales.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Store className="h-6 w-6" />
              </div>
              <p className="font-medium text-slate-700">No retail transactions found</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Walk-in counter sales made at warehouse retail counters will appear here in real time.
              </p>
            </div>
          ) : (
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Receipt / Trans #</th>
                    <th className="px-4 py-3">Date &amp; Time</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Items</th>
                    <th className="px-4 py-3 text-right">Total Amount</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSales.map((sale: any) => {
                    const rawDate = sale.createdAt || sale.date
                    const dateObj = rawDate ? new Date(rawDate) : null
                    const isValidDate = dateObj && !isNaN(dateObj.getTime())
                    const formattedDate = isValidDate
                      ? dateObj.toLocaleString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'

                    const customerDisplay =
                      sale.customerName ||
                      sale.walkInName ||
                      sale.customer?.name ||
                      (sale.customerType === 'EXISTING' ? 'Registered Customer' : 'Walk-in Customer')
                    const contactDisplay =
                      sale.walkInContact ||
                      sale.customerPhone ||
                      sale.customer?.contactNumber ||
                      sale.customer?.phone ||
                      ''

                    const saleAmount = sale.totalAmount ?? sale.grandTotal ?? 0
                    const items = Array.isArray(sale.items) ? sale.items : []

                    return (
                      <tr key={sale.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Receipt className="h-3.5 w-3.5 text-sky-600" />
                            {sale.transactionNumber || sale.id}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-slate-400" />
                            {formattedDate}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-slate-900">{customerDisplay}</div>
                          {contactDisplay ? (
                            <div className="text-xs text-slate-400 flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {contactDisplay}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {items.length > 0 ? (
                            <div className="space-y-1 min-w-[200px] max-w-[340px]">
                              {items.map((item: any, idx: number) => {
                                const modeLabel = item.mode === 'MIXED_CASE' ? 'Mixed Case' : (item.mode === 'LOOSE' ? 'Loose' : 'Case')
                                const displayName = getProductDisplayName(item)
                                return (
                                  <div key={item.id || idx} className="text-xs leading-snug">
                                    <span className="font-semibold text-slate-900">{displayName}</span>
                                    <span className="text-slate-500 ml-1.5 font-normal">
                                      ×{item.quantity} ({modeLabel})
                                    </span>
                                    {item.components && item.components.length > 0 ? (
                                      <MixedCaseComponents item={item} compact />
                                    ) : null}
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">No items</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">
                          {formatPeso(saleAmount)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 text-sky-600 hover:text-sky-700 hover:bg-sky-50"
                            onClick={() => setSelectedReceipt(sale)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            Receipt
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Receipt Detail Modal */}
      <Dialog open={Boolean(selectedReceipt)} onOpenChange={(open) => !open && setSelectedReceipt(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          {selectedReceipt ? (
            (() => {
              const receiptDate = (selectedReceipt as any).createdAt || (selectedReceipt as any).date
              const receiptDateObj = receiptDate ? new Date(receiptDate) : null
              const receiptDateFormatted = receiptDateObj && !isNaN(receiptDateObj.getTime())
                ? receiptDateObj.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                : '—'

              const receiptCustomerName =
                (selectedReceipt as any).customerName ||
                (selectedReceipt as any).walkInName ||
                (selectedReceipt as any).customer?.name ||
                ((selectedReceipt as any).customerType === 'EXISTING' ? 'Registered Customer' : 'Walk-in Customer')

              const receiptContact =
                (selectedReceipt as any).walkInContact ||
                (selectedReceipt as any).customerPhone ||
                (selectedReceipt as any).customer?.contactNumber ||
                (selectedReceipt as any).customer?.phone ||
                ''

              const receiptSubtotal = (selectedReceipt as any).subtotal ?? (selectedReceipt as any).productTotal ?? 0
              const receiptTotal = (selectedReceipt as any).totalAmount ?? (selectedReceipt as any).grandTotal ?? 0
              const receiptDeposit = (selectedReceipt as any).depositTotal ?? (selectedReceipt as any).deposit ?? 0

              return (
                <div className="space-y-4">
                  <DialogHeader className="border-b pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                          <Receipt className="h-5 w-5 text-sky-600" />
                          Receipt #{selectedReceipt.transactionNumber}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-slate-500 mt-0.5">
                          {receiptDateFormatted}
                          {selectedReceipt.warehouseName ? ` • ${selectedReceipt.warehouseName}` : ''}
                        </DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>

                  {/* Customer summary */}
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-400 uppercase tracking-wider block">Customer</span>
                      <span className="font-medium text-slate-800">{receiptCustomerName}</span>
                      {receiptContact ? (
                        <span className="text-slate-500 block">{receiptContact}</span>
                      ) : null}
                    </div>
                    <div>
                      <span className="text-slate-400 uppercase tracking-wider block">Fulfillment</span>
                      <span className="font-medium text-slate-800">Immediate Release</span>
                      {selectedReceipt.walkInNotes ? (
                        <span className="text-slate-500 block italic">"{selectedReceipt.walkInNotes}"</span>
                      ) : null}
                    </div>
                  </div>

                  {/* Items list */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Purchased Items</h4>
                    <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border border-slate-200">
                      <table className="w-full min-w-[620px] text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                          <tr>
                            <th className="px-3 py-2 text-left">Item / Mode</th>
                            <th className="px-3 py-2 text-center">Qty</th>
                            <th className="px-3 py-2 text-right">Price</th>
                            <th className="px-3 py-2 text-right">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedReceipt.items?.map((item: any, idx: number) => {
                            const itemPrice = item.unitPrice ?? 0
                            const itemSubtotal = item.subtotal ?? item.productSubtotal ?? 0
                            const displayName = getProductDisplayName(item)
                            return (
                              <tr key={item.id || idx}>
                                <td className="px-3 py-2">
                                  <div className="font-medium text-slate-900">{displayName}</div>
                                  <div className="text-[11px] text-slate-400">
                                    Mode: {item.mode}
                                    {item.emptyBottlesProvided ? ` • Returned: ${item.emptyBottlesProvided} empties` : ''}
                                  </div>
                                  {item.components && item.components.length > 0 ? (
                                    <MixedCaseComponents item={item} compact />
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 text-center font-medium text-slate-700">{item.quantity}</td>
                                <td className="px-3 py-2 text-right text-slate-600">{formatPeso(itemPrice)}</td>
                                <td className="px-3 py-2 text-right font-medium text-slate-900">
                                  {formatPeso(itemSubtotal)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Totals & Breakdown */}
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5">
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal:</span>
                      <span>{formatPeso(receiptSubtotal)}</span>
                    </div>
                    {Number(receiptDeposit) > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>Container Deposits:</span>
                        <span>+{formatPeso(receiptDeposit)}</span>
                      </div>
                    )}
                    {Number((selectedReceipt as any).depositCreditTotal || 0) > 0 && (
                      <div className="flex justify-between text-emerald-700 font-medium">
                        <span>Empty Bottle Credit Applied:</span>
                        <span>-{formatPeso((selectedReceipt as any).depositCreditTotal)}</span>
                      </div>
                    )}
                    {Number((selectedReceipt as any).taxAmount || 0) > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>VAT / Tax:</span>
                        <span>{formatPeso((selectedReceipt as any).taxAmount)}</span>
                      </div>
                    )}
                    <div className="border-t border-slate-200 pt-1.5 flex justify-between text-sm font-bold text-slate-900">
                      <span>Total Amount:</span>
                      <span className="text-sky-700">{formatPeso(receiptTotal)}</span>
                    </div>
                  </div>

                  <DialogFooter className="border-t pt-3 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.print()}
                      className="gap-1.5 border-slate-200"
                    >
                      <Printer className="h-4 w-4" />
                      Print Receipt
                    </Button>
                    <Button size="sm" onClick={() => setSelectedReceipt(null)} className="bg-sky-600 text-white hover:bg-sky-700">
                      Close
                    </Button>
                  </DialogFooter>
                </div>
              )
            })()
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
