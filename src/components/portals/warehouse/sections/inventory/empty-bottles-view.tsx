'use client'

import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Recycle, Search, PackageCheck, Banknote, Calendar, ArrowUpRight, Eye } from 'lucide-react'
interface EmptyBottleRecord {
  id: string
  orderId: string
  orderNumber: string
  customerName: string
  customerPhone?: string
  date: string
  productName: string
  productSku?: string
  productImage?: string | null
  orderedQty: number
  unit: string
  emptiesReturned: number
  depositCredit: number
  orderStatus: string
  order: any
}

interface WarehouseEmptyBottlesViewProps {
  orders: any[]
  formatPeso: (value: number) => string
  openOrderDetail?: (order: any) => void
  loadingOrders?: boolean
}

export function WarehouseEmptyBottlesView({
  orders,
  formatPeso,
  openOrderDetail,
  loadingOrders,
}: WarehouseEmptyBottlesViewProps) {
  const [activeTab, setActiveTab] = useState<'inventory' | 'reserved' | 'delivered'>('inventory')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  // Extract all empty bottle return transactions from customer checkout orders
  const records: EmptyBottleRecord[] = useMemo(() => {
    const list: EmptyBottleRecord[] = []

    orders.forEach((order) => {
      const orderDate = order.createdAt || (order as any).created_at || new Date().toISOString()
      const customerName = order.customer?.name || order.shippingName || (order as any).customer_name || 'Customer'
      const customerPhone = order.customer?.phone || order.shippingPhone || ''

      const items = Array.isArray(order.items) ? order.items : []
      let foundInItems = false

      items.forEach((item, index) => {
        let emptiesQty = Number((item as any).emptyReturnedQuantity || 0)
        let depositCredit = Number((item as any).depositRefunded || 0)

        // Parse from notes if not directly in property
        const itemNotes = String(item.notes || '')
        if (emptiesQty <= 0 && itemNotes) {
          const match = itemNotes.match(/Returned\s+(\d+)\s+(?:empty|empties)/i)
          if (match) {
            emptiesQty = parseInt(match[1], 10)
          }
        }

        // If customer used empties on this item, record it
        if (emptiesQty > 0) {
          foundInItems = true
          const prodName = item.product?.name || item.productName || item.name || 'Returnable Beverage'
          const prodSku = item.product?.sku || item.productSku || ''
          const prodImg = item.product?.imageUrl || null
          const isCase = String(item.unit || item.product?.unit || '').trim().toLowerCase() === 'case'
          const containersPerCase = Math.max(1, Number(item.quantityPerCase || item.product?.quantityPerCase || 24))
          const depositPerBottle = 5

          if (depositCredit <= 0) {
            depositCredit = emptiesQty * depositPerBottle
          }

          list.push({
            id: `${order.id}-item-${item.id || index}`,
            orderId: order.id,
            orderNumber: order.orderNumber || (order as any).order_number || 'ORD',
            customerName,
            customerPhone,
            date: orderDate,
            productName: prodName,
            productSku: prodSku,
            productImage: prodImg,
            orderedQty: item.quantity,
            unit: item.unit || 'case',
            emptiesReturned: emptiesQty,
            depositCredit,
            orderStatus: order.status,
            order,
          })
        }
      })

      // If order notes mention returned empties but items didn't have detailed breakdown
      if (!foundInItems) {
        const orderNotes = String(order.notes || '')
        const match = orderNotes.match(/Returned\s+(\d+)\s+(?:empty|empties)/i)
        if (match) {
          const emptiesQty = parseInt(match[1], 10)
          if (emptiesQty > 0) {
            list.push({
              id: `${order.id}-order-empties`,
              orderId: order.id,
              orderNumber: order.orderNumber || (order as any).order_number || 'ORD',
              customerName,
              customerPhone,
              date: orderDate,
              productName: 'Returnable Glass Containers',
              orderedQty: items.length,
              unit: 'order',
              emptiesReturned: emptiesQty,
              depositCredit: emptiesQty * 5,
              orderStatus: order.status,
              order,
            })
          }
        }
      }
    })

    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [orders])

  // Partition into Active Reserved vs Delivered/Completed
  const activeReservedRecords = useMemo(() => {
    return records.filter((r) => {
      const s = String(r.orderStatus).toUpperCase()
      return !['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'FAILED_DELIVERY'].includes(s)
    })
  }, [records])

  const deliveredRecords = useMemo(() => {
    return records.filter((r) => {
      const s = String(r.orderStatus).toUpperCase()
      return ['DELIVERED', 'COMPLETED'].includes(s)
    })
  }, [records])

  // Summary Metrics
  const totalEmptiesDelivered = useMemo(
    () => deliveredRecords.reduce((sum, r) => sum + r.emptiesReturned, 0),
    [deliveredRecords]
  )
  const totalEmptiesReserved = useMemo(
    () => activeReservedRecords.reduce((sum, r) => sum + r.emptiesReturned, 0),
    [activeReservedRecords]
  )
  const totalDepositCredit = useMemo(
    () => records.reduce((sum, r) => sum + r.depositCredit, 0),
    [records]
  )

  const activeDisplayList = useMemo(() => {
    let source = records
    if (activeTab === 'reserved') source = activeReservedRecords
    if (activeTab === 'delivered') source = deliveredRecords

    return source.filter((r) => {
      const matchesSearch =
        !searchQuery.trim() ||
        r.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.productSku && r.productSku.toLowerCase().includes(searchQuery.toLowerCase()))

      const matchesStatus =
        statusFilter === 'ALL' ||
        String(r.orderStatus).toUpperCase() === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [records, activeReservedRecords, deliveredRecords, activeTab, searchQuery, statusFilter])

  const getOrderStatusBadgeClass = (status: string) => {
    const s = String(status || '').toUpperCase()
    if (['DELIVERED', 'COMPLETED'].includes(s)) return 'bg-emerald-100 text-emerald-800'
    if (['OUT_FOR_DELIVERY', 'IN_TRANSIT'].includes(s)) return 'bg-blue-100 text-blue-800'
    if (['PREPARING', 'PROCESSING', 'LOADED'].includes(s)) return 'bg-purple-100 text-purple-800'
    if (['CANCELLED', 'REJECTED'].includes(s)) return 'bg-red-100 text-red-800'
    return 'bg-amber-100 text-amber-800'
  }

  return (
    <div className="space-y-6">
      {/* Header & Description */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Recycle className="h-5 w-5 text-emerald-600" />
              Empty Bottles &amp; Cases Management
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Track warehouse empty container inventory, active order reservations, and delivered bottle returns.
            </p>
          </div>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-slate-200 shadow-sm bg-gradient-to-br from-emerald-50/50 to-white">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Delivered Empty Stock
                </p>
                <p className="text-2xl font-bold text-emerald-700 mt-1">
                  {totalEmptiesDelivered.toLocaleString()}
                  <span className="text-xs font-normal text-slate-500 ml-1.5">bottles/units</span>
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">Ready for production / refill</p>
              </div>
              <div className="rounded-xl p-2.5 bg-emerald-100 text-emerald-600">
                <Recycle className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm bg-gradient-to-br from-blue-50/50 to-white">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Used / Reserved in Orders
                </p>
                <p className="text-2xl font-bold text-blue-700 mt-1">
                  {totalEmptiesReserved.toLocaleString()}
                  <span className="text-xs font-normal text-slate-500 ml-1.5">bottles/units</span>
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">Locked in {activeReservedRecords.length} active orders</p>
              </div>
              <div className="rounded-xl p-2.5 bg-blue-100 text-blue-600">
                <PackageCheck className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm bg-gradient-to-br from-indigo-50/50 to-white">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Total Deposit Value Handled
                </p>
                <p className="text-2xl font-bold text-indigo-700 mt-1">
                  {formatPeso(totalDepositCredit)}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">Across all return transactions</p>
              </div>
              <div className="rounded-xl p-2.5 bg-indigo-100 text-indigo-600">
                <Banknote className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex rounded-xl bg-slate-100 p-1 w-full sm:w-auto self-start">
        <button
          type="button"
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            activeTab === 'inventory'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Recycle className="h-3.5 w-3.5 text-slate-700" />
          <span>All Checkout Returns ({records.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('reserved')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            activeTab === 'reserved'
              ? 'bg-white text-blue-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <PackageCheck className="h-3.5 w-3.5 text-blue-600" />
          <span>Used / Reserved in Active Orders ({activeReservedRecords.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('delivered')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            activeTab === 'delivered'
              ? 'bg-white text-emerald-700 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Recycle className="h-3.5 w-3.5 text-emerald-600" />
          <span>Delivered &amp; Returned to Stock ({deliveredRecords.length})</span>
        </button>
      </div>

      {/* Main Records Table Card */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold text-slate-900">
                {activeTab === 'inventory' && 'All Customer Empty Returns'}
                {activeTab === 'reserved' && 'Used / Reserved Empty Deposits in Active Orders'}
                {activeTab === 'delivered' && 'Delivered Returns Transferred to Warehouse Empty Stock'}
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                {activeTab === 'reserved'
                  ? 'Empty bottles and cases locked in ongoing orders. Released if cancelled, transferred to stock when delivered.'
                  : 'Empty container transactions from customer checkouts and deliveries.'}
              </CardDescription>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search order, customer, product..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9 text-xs bg-slate-50 border-slate-200"
                />
              </div>

              {activeTab === 'inventory' && (
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 px-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ALL">All Order Statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="PROCESSING">Processing</option>
                  <option value="OUT_FOR_DELIVERY">Out for Delivery</option>
                  <option value="DELIVERED">Delivered</option>
                </select>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loadingOrders ? (
            <div className="p-12 text-center text-sm text-slate-500">
              Loading empty bottle records...
            </div>
          ) : activeDisplayList.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Recycle className="h-6 w-6" />
              </div>
              <p className="font-medium text-slate-700">No empty container records found</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                {activeTab === 'reserved'
                  ? 'There are no active orders currently reserving empty bottle deposits.'
                  : 'Empty containers returned during customer checkout will automatically appear here.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Order #</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Product / Beverage</th>
                    <th className="px-4 py-3 text-center">Ordered Qty</th>
                    <th className="px-4 py-3 text-center">Empties Reserved/Returned</th>
                    <th className="px-4 py-3 text-right">Deposit Credited</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeDisplayList.map((record) => (
                    <tr key={record.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {record.orderNumber}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          {new Date(record.date).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-slate-800">{record.customerName}</div>
                        {record.customerPhone ? (
                          <div className="text-xs text-slate-400">{record.customerPhone}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {record.productImage ? (
                            <img
                              src={record.productImage}
                              alt={record.productName}
                              className="h-8 w-8 rounded object-cover border bg-white shrink-0"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded bg-slate-100 border flex items-center justify-center text-slate-400 shrink-0">
                              <Recycle className="h-4 w-4" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 truncate max-w-[220px]">
                              {record.productName}
                            </div>
                            {record.productSku ? (
                              <div className="text-xs text-slate-400">SKU: {record.productSku}</div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-slate-700">
                        {record.orderedQty} {record.unit}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold">
                          <Recycle className="h-3 w-3 mr-1" />
                          {record.emptiesReturned} bottles
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700 whitespace-nowrap">
                        {formatPeso(record.depositCredit)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={getOrderStatusBadgeClass(record.orderStatus)}>
                          {record.orderStatus?.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {openOrderDetail ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            onClick={() => openOrderDetail(record.order)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            View
                          </Button>
                        ) : null}
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

