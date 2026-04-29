'use client'

import { Area, AreaChart, CartesianGrid, XAxis, YAxis, PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts'
import { AlertTriangle, Boxes, Loader2, Warehouse, TrendingUp, Package, ShoppingCart, MapPin, CircleCheck, Truck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ChartContainer } from '@/components/ui/chart'
import type { WarehouseDashboardViewProps } from '../shared/types'
import { fetchAllPaginatedCollection, getCollection } from '../../../admin/sections/shared'

export function WarehouseDashboardView({
  assignedWarehouse,
  scopedInventory,
  lowStockCount,
  warehouseOrdersChartConfig,
  weeklyTrendData,
  transactionDateFrom,
  setTransactionDateFrom,
  transactionDatePreset,
  setTransactionDatePreset,
  transactionTypeFilter,
  setTransactionTypeFilter,
  availableInventoryTransactionTypes,
  loadingInventoryTransactions,
  filteredInventoryTransactions,
}: WarehouseDashboardViewProps) {
  const [dashboardOrders, setDashboardOrders] = useState<any[]>([])

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const ordersResult = await fetchAllPaginatedCollection<any>(
          '/api/orders?includeItems=none',
          'orders',
          { cache: 'no-store' },
          { retries: 3, timeoutMs: 15000, pageSize: 200, maxPages: 100 }
        )

        if (ordersResult.ok) {
          setDashboardOrders(getCollection<any>(ordersResult.data, ['orders']))
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      }
    }
    fetchDashboardData()
  }, [])

  const dashboardOrderStats = useMemo(() => {
    const totalOrders = dashboardOrders.length || 0
    const outForDelivery = dashboardOrders.filter(o => o?.status === 'IN_TRANSIT').length
    const delivered = dashboardOrders.filter(o => o?.status === 'DELIVERED').length

    return {
      totalOrders,
      outForDelivery,
      delivered,
    }
  }, [dashboardOrders])
  // Calculate transaction type distribution
  const transactionTypeData = useMemo(() => {
    const typeMap = new Map<string, number>()
    for (const transaction of filteredInventoryTransactions) {
      const type = String(transaction?.type || 'OTHER').toUpperCase()
      typeMap.set(type, (typeMap.get(type) || 0) + 1)
    }
    return Array.from(typeMap.entries()).map(([name, value]) => ({
      name: name.replace(/_/g, ' '),
      value,
    }))
  }, [filteredInventoryTransactions])

  // Calculate stock health percentage
  const stockHealthPercentage = useMemo(() => {
    if (scopedInventory.length === 0) return 0
    return Math.round((lowStockCount / scopedInventory.length) * 100)
  }, [scopedInventory, lowStockCount])

  // Calculate average stock level
  const averageStockLevel = useMemo(() => {
    if (scopedInventory.length === 0) return 0
    const totalQty = scopedInventory.reduce((sum, item) => sum + (Number(item?.quantity || 0)), 0)
    return Math.round(totalQty / scopedInventory.length)
  }, [scopedInventory])

  // Calculate total transactions count
  const totalTransactionCount = useMemo(() => {
    return filteredInventoryTransactions.length
  }, [filteredInventoryTransactions])

  // Calculate inventory status breakdown
  const inventoryStatusBreakdown = useMemo(() => {
    let healthy = 0
    let lowStock = 0
    let critical = 0
    let outOfStock = 0

    for (const item of scopedInventory) {
      const qty = Number(item?.quantity || 0)
      const minQty = Number(item?.minimum_required_quantity || 1)

      if (qty === 0) {
        outOfStock++
      } else if (qty <= minQty) {
        critical++
      } else if (qty <= minQty * 1.5) {
        lowStock++
      } else {
        healthy++
      }
    }

    return { healthy, lowStock, critical, outOfStock }
  }, [scopedInventory])

  // Color palette for transaction types
  const transactionColors = [
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // purple
    '#06b6d4', // cyan
    '#ec4899', // pink
    '#f97316', // orange
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Warehouse Dashboard</h1>
        <p className="text-gray-500">Warehouse operations and stock health overview</p>
      </div>

      {/* Order Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="relative overflow-hidden rounded-2xl border-0 shadow-sm bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardContent className="flex min-h-[120px] flex-col justify-between p-5">
            <div className="inline-flex w-fit rounded-xl border-0 p-2.5 bg-blue-50 text-blue-600">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div className="mt-4">
              <p className="text-2xl font-bold leading-none text-blue-900">{dashboardOrderStats.totalOrders.toLocaleString()}</p>
              <p className="mt-2 text-sm leading-tight text-gray-600">Total Orders</p>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden rounded-2xl border-0 shadow-sm bg-gradient-to-br from-red-50 to-rose-50">
          <CardContent className="flex min-h-[120px] flex-col justify-between p-5">
            <div className="inline-flex w-fit rounded-xl border-0 p-2.5 bg-red-50 text-red-600">
              <MapPin className="h-5 w-5" />
            </div>
            <div className="mt-4">
              <p className="text-2xl font-bold leading-none text-red-900">{dashboardOrderStats.outForDelivery.toLocaleString()}</p>
              <p className="mt-2 text-sm leading-tight text-gray-600">Out for Delivery</p>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden rounded-2xl border-0 shadow-sm bg-gradient-to-br from-green-50 to-emerald-50">
          <CardContent className="flex min-h-[120px] flex-col justify-between p-5">
            <div className="inline-flex w-fit rounded-xl border-0 p-2.5 bg-green-50 text-green-600">
              <CircleCheck className="h-5 w-5" />
            </div>
            <div className="mt-4">
              <p className="text-2xl font-bold leading-none text-green-900">{dashboardOrderStats.delivered.toLocaleString()}</p>
              <p className="mt-2 text-sm leading-tight text-gray-600">Delivered</p>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden rounded-2xl border-0 shadow-sm bg-gradient-to-br from-indigo-50 to-blue-50">
          <CardContent className="flex min-h-[120px] flex-col justify-between p-5">
            <div className="inline-flex w-fit rounded-xl border-0 p-2.5 bg-indigo-50 text-indigo-600">
              <Truck className="h-5 w-5" />
            </div>
            <div className="mt-4">
              <p className="text-2xl font-bold leading-none text-indigo-900">0</p>
              <p className="mt-2 text-sm leading-tight text-gray-600">Active Trips</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Enhanced Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-2xl border-0 shadow-sm bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-600">
              <Warehouse className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-600">Assigned Warehouse</p>
              <p className="mt-2 text-3xl font-bold leading-none text-blue-900">{assignedWarehouse ? 1 : 0}</p>
              <p className="mt-1 text-xs text-gray-500 truncate">
                {assignedWarehouse ? `${assignedWarehouse.name}` : 'No warehouse'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-teal-50">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-600">
              <Boxes className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-600">Inventory Items</p>
              <p className="mt-2 text-3xl font-bold leading-none text-emerald-900">{scopedInventory.length}</p>
              <p className="mt-1 text-xs text-gray-500">Total SKUs tracked</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-0 shadow-sm bg-gradient-to-br from-rose-50 to-pink-50">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-rose-500/10 p-2.5 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-600">Low Stock Items</p>
              <p className="mt-2 text-3xl font-bold leading-none text-rose-900">{lowStockCount}</p>
              <p className="mt-1 text-xs text-gray-500">{stockHealthPercentage}% of inventory</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-0 shadow-sm bg-gradient-to-br from-amber-50 to-orange-50">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-amber-500/10 p-2.5 text-amber-600">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-600">Avg Stock Level</p>
              <p className="mt-2 text-3xl font-bold leading-none text-amber-900">{averageStockLevel}</p>
              <p className="mt-1 text-xs text-gray-500">Units per item</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-indigo-100 text-sm">Total Transactions</p>
                <p className="text-3xl font-bold mt-1">{totalTransactionCount}</p>
              </div>
              <TrendingUp className="h-10 w-10 text-indigo-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-violet-500 to-pink-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-violet-100 text-sm">Stock Health Status</p>
                <p className="text-3xl font-bold mt-1">{stockHealthPercentage > 30 ? '⚠️' : '✓'}</p>
              </div>
              <AlertTriangle className="h-10 w-10 text-violet-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-cyan-500 to-teal-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-cyan-100 text-sm">Inventory Utilization</p>
                <p className="text-3xl font-bold mt-1">
                  {scopedInventory.length > 0 ? Math.round(((scopedInventory.length - lowStockCount) / scopedInventory.length) * 100) : 0}%
                </p>
              </div>
              <Boxes className="h-10 w-10 text-cyan-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Inventory Status Breakdown */}
      <Card className="rounded-2xl border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Inventory Status Overview</CardTitle>
          <CardDescription>Quick view of stock levels across all items</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
              <p className="text-xs text-gray-600 mb-2">Healthy Stock</p>
              <p className="text-3xl font-bold text-emerald-600">{inventoryStatusBreakdown.healthy}</p>
              <p className="text-xs text-gray-500 mt-1">Good levels</p>
            </div>
            <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
              <p className="text-xs text-gray-600 mb-2">Low Stock</p>
              <p className="text-3xl font-bold text-yellow-600">{inventoryStatusBreakdown.lowStock}</p>
              <p className="text-xs text-gray-500 mt-1">Needs order soon</p>
            </div>
            <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
              <p className="text-xs text-gray-600 mb-2">Critical</p>
              <p className="text-3xl font-bold text-orange-600">{inventoryStatusBreakdown.critical}</p>
              <p className="text-xs text-gray-500 mt-1">Below minimum</p>
            </div>
            <div className="p-4 bg-red-50 rounded-lg border border-red-200">
              <p className="text-xs text-gray-600 mb-2">Out of Stock</p>
              <p className="text-3xl font-bold text-red-600">{inventoryStatusBreakdown.outOfStock}</p>
              <p className="text-xs text-gray-500 mt-1">Urgent reorder</p>
            </div>
          </div>
          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Total Items:</span>
              <span className="font-bold text-gray-900">{scopedInventory.length}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 rounded-2xl border-0 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-base">Weekly Order Trends</CardTitle>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">This Week</span>
                <span className="rounded-md border border-blue-400 bg-blue-50 px-2 py-0.5 text-blue-600">vs Last Week</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ChartContainer config={warehouseOrdersChartConfig} className="h-[300px] w-full">
              <AreaChart data={weeklyTrendData} margin={{ left: 8, right: 8, top: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillThisWeekWh" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.08} />
                  </linearGradient>
                  <linearGradient id="fillLastWeekWh" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1d4ed8" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#1d4ed8" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <YAxis axisLine={false} tickLine={false} width={28} domain={[0, 'auto']} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} />
                <Area type="monotone" dataKey="thisWeek" stroke="#3b82f6" strokeWidth={2.5} fill="url(#fillThisWeekWh)" dot={false} />
                <Area type="monotone" dataKey="lastWeek" stroke="#1d4ed8" strokeWidth={2} fill="url(#fillLastWeekWh)" dot={false} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Stock Health Gauge Card */}
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm">Stock Health</CardTitle>
            <CardDescription>Low stock percentage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-center">
                <div className="relative h-24 w-24 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-8 border-gray-200" style={{
                    background: `conic-gradient(from 0deg, ${stockHealthPercentage > 30 ? '#ef4444' : '#10b981'} ${stockHealthPercentage * 3.6}deg, #e5e7eb ${stockHealthPercentage * 3.6}deg)`
                  }} />
                  <div className="absolute inset-2 rounded-full bg-white flex items-center justify-center">
                    <span className={`text-2xl font-bold ${stockHealthPercentage > 30 ? 'text-red-600' : 'text-green-600'}`}>
                      {stockHealthPercentage}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600">
                  {stockHealthPercentage > 30 ? 'Needs Attention' : 'Healthy'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {lowStockCount} of {scopedInventory.length} items
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transaction Type Distribution Chart */}
      {transactionTypeData.length > 0 && (
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Transaction Type Distribution</CardTitle>
            <CardDescription>Breakdown of inventory transactions by type</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={transactionTypeData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={(entry: any) => `${entry.name}: ${entry.value}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {transactionTypeData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={transactionColors[index % transactionColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => `${value} transactions`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardTitle>Inventory Transactions</CardTitle>
              <CardDescription>All inventory movement records for this warehouse.</CardDescription>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input
                type="date"
                value={transactionDateFrom}
                onChange={(event) => {
                  setTransactionDateFrom(event.target.value)
                  setTransactionDatePreset('custom')
                }}
                className="h-9"
              />
              <select
                aria-label="Transaction date range preset"
                value={transactionDatePreset}
                onChange={(event) => setTransactionDatePreset(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="custom">Custom range</option>
                <option value="past_7_days">Past 7 days</option>
                <option value="past_14_days">Past 14 days</option>
                <option value="past_1_month">Past 1 month</option>
                <option value="past_3_months">Past 3 months</option>
                <option value="past_6_months">Past 6 months</option>
                <option value="past_1_year">Past 1 year</option>
              </select>
              <select
                aria-label="Transaction type filter"
                value={transactionTypeFilter}
                onChange={(event) => setTransactionTypeFilter(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">All types</option>
                {availableInventoryTransactionTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadingInventoryTransactions ? (
            <div className="h-40 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
          ) : filteredInventoryTransactions.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-500">No inventory transactions found</div>
          ) : (
            <div className="max-h-[380px] overflow-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b sticky top-0 z-10">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">Date</th>
                    <th className="text-left p-4 font-medium text-gray-600">Type</th>
                    <th className="text-left p-4 font-medium text-gray-600">Product</th>
                    <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                    <th className="text-left p-4 font-medium text-gray-600">Qty</th>
                    <th className="text-left p-4 font-medium text-gray-600">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventoryTransactions.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4">{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'N/A'}</td>
                      <td className="p-4">
                        <Badge variant="outline">{String(entry.type || 'N/A').replace(/_/g, ' ')}</Badge>
                      </td>
                      <td className="p-4">{entry.product?.name || 'N/A'}</td>
                      <td className="p-4">{entry.product?.sku || 'N/A'}</td>
                      <td className="p-4 font-semibold">{Number(entry.quantity || 0).toLocaleString()}</td>
                      <td className="p-4 text-gray-600">
                        {entry.referenceType || 'N/A'}
                        {entry.referenceId ? ` #${entry.referenceId}` : ''}
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
