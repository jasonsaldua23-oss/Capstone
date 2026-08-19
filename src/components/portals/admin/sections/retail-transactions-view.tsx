'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  Store,
  Search,
  Receipt,
  Banknote,
  CheckCircle2,
  Clock,
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
  paymentStatus: string
  subtotal: string | number
  taxAmount: string | number
  depositTotal: string | number
  depositCreditTotal: string | number
  totalAmount: string | number
  amountPaid: string | number
  changeAmount: string | number
  balanceRemaining: string | number
  items: RetailSaleItem[]
}

const formatPeso = (val: unknown) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(val || 0))

export function RetailTransactionsView() {
  const [sales, setSales] = useState<RetailSale[]>([])
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string; code: string }>>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [warehouseFilter, setWarehouseFilter] = useState('ALL')
  const [paymentFilter, setPaymentFilter] = useState('ALL')
  const [fulfillmentFilter, setFulfillmentFilter] = useState('ALL')
  const [selectedReceipt, setSelectedReceipt] = useState<RetailSale | null>(null)

  const fetchSales = useCallback(async () => {
    setLoading(true)
    try {
      const url = warehouseFilter && warehouseFilter !== 'ALL'
        ? `/api/retail/sales?warehouseId=${encodeURIComponent(warehouseFilter)}&pageSize=500`
        : '/api/retail/sales?pageSize=500'
      const response = await fetch(url, { cache: 'no-store', credentials: 'include' })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload?.success !== false) {
        setSales(Array.isArray(payload?.sales) ? payload.sales : [])
      } else {
        toast.error(payload?.error || 'Failed to load retail sales')
      }
    } catch {
      toast.error('Network error loading retail sales')
    } finally {
      setLoading(false)
    }
  }, [warehouseFilter])

  const fetchWarehouses = useCallback(async () => {
    try {
      const res = await fetch('/api/warehouses?page=1&pageSize=100', { cache: 'no-store', credentials: 'include' })
      const payload = await res.json().catch(() => ({}))
      if (res.ok) {
        setWarehouses(Array.isArray(payload?.warehouses) ? payload.warehouses : payload?.data || [])
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
    return sales.filter((sale) => {
      const q = searchQuery.trim().toLowerCase()
      const matchesSearch =
        !q ||
        (sale.transactionNumber && sale.transactionNumber.toLowerCase().includes(q)) ||
        (sale.customerName && sale.customerName.toLowerCase().includes(q)) ||
        (sale.walkInName && sale.walkInName.toLowerCase().includes(q)) ||
        (sale.walkInContact && sale.walkInContact.toLowerCase().includes(q)) ||
        (sale.warehouseName && sale.warehouseName.toLowerCase().includes(q))

      const matchesPayment =
        paymentFilter === 'ALL' ||
        String(sale.paymentStatus).toUpperCase() === paymentFilter

      const matchesFulfillment =
        fulfillmentFilter === 'ALL' ||
        String(sale.fulfillmentType).toUpperCase() === fulfillmentFilter ||
        String(sale.pickupStatus).toUpperCase() === fulfillmentFilter

      return matchesSearch && matchesPayment && matchesFulfillment
    })
  }, [sales, searchQuery, paymentFilter, fulfillmentFilter])

  // Summary Metrics
  const totalRevenue = useMemo(() => {
    return sales.reduce((sum, s) => sum + Number(s.totalAmount || 0), 0)
  }, [sales])

  const totalPaid = useMemo(() => {
    return sales.reduce((sum, s) => sum + Number(s.amountPaid || 0), 0)
  }, [sales])

  const pendingPickups = useMemo(() => {
    return sales.filter(
      (s) =>
        s.fulfillmentType === 'CUSTOMER_PICKUP' &&
        ['PENDING', 'PENDING_PICKUP', 'READY_FOR_PICKUP'].includes(String(s.pickupStatus).toUpperCase())
    ).length
  }, [sales])

  const pendingPayments = useMemo(() => {
    return sales.filter((s) => ['PARTIALLY_PAID', 'PENDING', 'UNPAID'].includes(String(s.paymentStatus).toUpperCase()))
      .length
  }, [sales])

  const getPaymentBadgeClass = (status: string) => {
    const s = String(status || '').toUpperCase()
    if (s === 'PAID') return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    if (s === 'PARTIALLY_PAID') return 'bg-amber-100 text-amber-800 border-amber-200'
    if (s === 'CANCELLED' || s === 'VOID') return 'bg-red-100 text-red-800 border-red-200'
    return 'bg-rose-100 text-rose-800 border-rose-200'
  }

  const getFulfillmentBadgeClass = (type: string, pickupStatus: string) => {
    if (type === 'IMMEDIATE') return 'bg-blue-100 text-blue-800 border-blue-200'
    const ps = String(pickupStatus || '').toUpperCase()
    if (ps === 'PICKED_UP' || ps === 'COMPLETED') return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    return 'bg-purple-100 text-purple-800 border-purple-200'
  }

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
            Track walk-in POS counter sales, payment settlements, and customer pickup orders across warehouses.
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

        <Card className="border-slate-200 shadow-sm bg-gradient-to-br from-emerald-50/50 to-white">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Collected Payments</p>
                <p className="text-2xl font-bold text-emerald-700 mt-1">{formatPeso(totalPaid)}</p>
                <p className="text-xs text-slate-500 mt-0.5">Settled at counter</p>
              </div>
              <div className="rounded-xl p-2.5 bg-emerald-100 text-emerald-600">
                <Banknote className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm bg-gradient-to-br from-purple-50/50 to-white">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending Pickups</p>
                <p className="text-2xl font-bold text-purple-700 mt-1">{pendingPickups}</p>
                <p className="text-xs text-slate-500 mt-0.5">Awaiting customer collection</p>
              </div>
              <div className="rounded-xl p-2.5 bg-purple-100 text-purple-600">
                <Package className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm bg-gradient-to-br from-amber-50/50 to-white">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending Balances</p>
                <p className="text-2xl font-bold text-amber-700 mt-1">{pendingPayments}</p>
                <p className="text-xs text-slate-500 mt-0.5">Unsettled counter balances</p>
              </div>
              <div className="rounded-xl p-2.5 bg-amber-100 text-amber-600">
                <Clock className="h-5 w-5" />
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
                  placeholder="Search receipt, customer..."
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

              {/* Payment filter */}
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="h-9 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="ALL">All Payments</option>
                <option value="PAID">Paid</option>
                <option value="PARTIALLY_PAID">Partially Paid</option>
                <option value="PENDING">Pending</option>
              </select>

              {/* Fulfillment filter */}
              <select
                value={fulfillmentFilter}
                onChange={(e) => setFulfillmentFilter(e.target.value)}
                className="h-9 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="ALL">All Fulfillments</option>
                <option value="IMMEDIATE">Immediate Handout</option>
                <option value="CUSTOMER_PICKUP">Customer Pickup</option>
                <option value="PICKED_UP">Picked Up</option>
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-8">
              <PortalTableSkeleton rows={6} columns={7} className="border-0 shadow-none" />
            </div>
          ) : filteredSales.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Store className="h-6 w-6" />
              </div>
              <p className="font-medium text-slate-700">No retail transactions found</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Walk-in counter sales made at warehouse POS registers will appear here in real time.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Receipt / Trans #</th>
                    <th className="px-4 py-3">Date &amp; Time</th>
                    <th className="px-4 py-3">Warehouse</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3 text-center">Items</th>
                    <th className="px-4 py-3 text-right">Total Amount</th>
                    <th className="px-4 py-3 text-right">Amount Paid</th>
                    <th className="px-4 py-3 text-center">Payment</th>
                    <th className="px-4 py-3 text-center">Fulfillment</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSales.map((sale) => {
                    const itemCount = Array.isArray(sale.items) ? sale.items.length : 0
                    const customerDisplay =
                      sale.customerType === 'EXISTING'
                        ? sale.customerName || 'Registered Customer'
                        : sale.walkInName || 'Walk-in Customer'
                    const contactDisplay = sale.walkInContact || sale.customerPhone || ''

                    return (
                      <tr key={sale.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          <div className="flex items-center gap-1.5">
                            <Receipt className="h-3.5 w-3.5 text-sky-600" />
                            {sale.transactionNumber || sale.id}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-slate-400" />
                            {new Date(sale.createdAt).toLocaleString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-slate-700">
                          <div className="flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-slate-400" />
                            {sale.warehouseName || sale.warehouseCode || 'Main Warehouse'}
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
                        <td className="px-4 py-3 text-center text-xs font-medium text-slate-700">
                          {itemCount} {itemCount === 1 ? 'item' : 'items'}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">
                          {formatPeso(sale.totalAmount)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-emerald-700 whitespace-nowrap">
                          {formatPeso(sale.amountPaid)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className={getPaymentBadgeClass(sale.paymentStatus)}>
                            {sale.paymentStatus || 'UNPAID'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className={getFulfillmentBadgeClass(sale.fulfillmentType, sale.pickupStatus)}>
                            {sale.fulfillmentType === 'IMMEDIATE'
                              ? 'Immediate'
                              : sale.pickupStatus === 'PICKED_UP'
                              ? 'Picked Up'
                              : 'Pickup Pending'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
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
            <div className="space-y-4">
              <DialogHeader className="border-b pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <Receipt className="h-5 w-5 text-sky-600" />
                      Receipt #{selectedReceipt.transactionNumber}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-slate-500 mt-0.5">
                      {new Date(selectedReceipt.createdAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}{' '}
                      • {selectedReceipt.warehouseName || 'Warehouse'}
                    </DialogDescription>
                  </div>
                  <Badge variant="outline" className={getPaymentBadgeClass(selectedReceipt.paymentStatus)}>
                    {selectedReceipt.paymentStatus}
                  </Badge>
                </div>
              </DialogHeader>

              {/* Customer summary */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-400 uppercase tracking-wider block">Customer</span>
                  <span className="font-medium text-slate-800">
                    {selectedReceipt.customerType === 'EXISTING'
                      ? selectedReceipt.customerName
                      : selectedReceipt.walkInName || 'Walk-in Customer'}
                  </span>
                  {selectedReceipt.walkInContact ? (
                    <span className="text-slate-500 block">{selectedReceipt.walkInContact}</span>
                  ) : null}
                </div>
                <div>
                  <span className="text-slate-400 uppercase tracking-wider block">Fulfillment</span>
                  <span className="font-medium text-slate-800">
                    {selectedReceipt.fulfillmentType === 'IMMEDIATE' ? 'Immediate Handout' : 'Customer Pickup'}
                  </span>
                  {selectedReceipt.walkInNotes ? (
                    <span className="text-slate-500 block italic">"{selectedReceipt.walkInNotes}"</span>
                  ) : null}
                </div>
              </div>

              {/* Items list */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Purchased Items</h4>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                      <tr>
                        <th className="px-3 py-2 text-left">Item / Mode</th>
                        <th className="px-3 py-2 text-center">Qty</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedReceipt.items?.map((item, idx) => (
                        <tr key={item.id || idx}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-900">{item.productName}</div>
                            <div className="text-[11px] text-slate-400">
                              Mode: {item.mode}
                              {item.emptyBottlesProvided ? ` • Returned: ${item.emptyBottlesProvided} empties` : ''}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center font-medium text-slate-700">{item.quantity}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{formatPeso(item.unitPrice)}</td>
                          <td className="px-3 py-2 text-right font-medium text-slate-900">
                            {formatPeso(item.subtotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals & Breakdown */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span>{formatPeso(selectedReceipt.subtotal)}</span>
                </div>
                {Number(selectedReceipt.depositTotal || 0) > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Container Deposits:</span>
                    <span>+{formatPeso(selectedReceipt.depositTotal)}</span>
                  </div>
                )}
                {Number(selectedReceipt.depositCreditTotal || 0) > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>Empty Bottle Credit Applied:</span>
                    <span>-{formatPeso(selectedReceipt.depositCreditTotal)}</span>
                  </div>
                )}
                {Number(selectedReceipt.taxAmount || 0) > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>VAT / Tax:</span>
                    <span>{formatPeso(selectedReceipt.taxAmount)}</span>
                  </div>
                )}
                <div className="border-t border-slate-200 pt-1.5 flex justify-between text-sm font-bold text-slate-900">
                  <span>Total Amount:</span>
                  <span className="text-sky-700">{formatPeso(selectedReceipt.totalAmount)}</span>
                </div>
                <div className="flex justify-between text-slate-600 pt-1">
                  <span>Amount Paid:</span>
                  <span className="font-semibold text-emerald-700">{formatPeso(selectedReceipt.amountPaid)}</span>
                </div>
                {Number(selectedReceipt.changeAmount || 0) > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>Change Returned:</span>
                    <span>{formatPeso(selectedReceipt.changeAmount)}</span>
                  </div>
                )}
                {Number(selectedReceipt.balanceRemaining || 0) > 0 && (
                  <div className="flex justify-between text-amber-700 font-semibold">
                    <span>Remaining Balance:</span>
                    <span>{formatPeso(selectedReceipt.balanceRemaining)}</span>
                  </div>
                )}
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
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
