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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="group relative overflow-hidden rounded-3xl border border-blue-100/70 bg-gradient-to-br from-blue-50 via-sky-50 to-indigo-100 shadow-[0_18px_40px_rgba(37,99,235,0.16)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(37,99,235,0.22)]">
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-blue-300/25 blur-2xl" />
          <CardContent className="relative flex min-h-[150px] flex-col justify-between p-6">
            <div className="inline-flex w-fit rounded-2xl border border-blue-200/60 bg-white/70 p-2.5 text-blue-700 backdrop-blur">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div className="mt-4">
              <p className="text-4xl font-extrabold leading-none tracking-tight text-blue-900">{dashboardOrderStats.totalOrders.toLocaleString()}</p>
              <p className="mt-2 text-sm leading-tight font-medium text-blue-900/70">Total Orders</p>
            </div>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden rounded-3xl border border-rose-100/70 bg-gradient-to-br from-rose-50 via-pink-50 to-red-100 shadow-[0_18px_40px_rgba(225,29,72,0.14)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(225,29,72,0.2)]">
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-rose-300/25 blur-2xl" />
          <CardContent className="relative flex min-h-[150px] flex-col justify-between p-6">
            <div className="inline-flex w-fit rounded-2xl border border-rose-200/60 bg-white/70 p-2.5 text-rose-700 backdrop-blur">
              <MapPin className="h-5 w-5" />
            </div>
            <div className="mt-4">
              <p className="text-4xl font-extrabold leading-none tracking-tight text-rose-900">{dashboardOrderStats.outForDelivery.toLocaleString()}</p>
              <p className="mt-2 text-sm leading-tight font-medium text-rose-900/70">Out for Delivery</p>
            </div>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden rounded-3xl border border-emerald-100/70 bg-gradient-to-br from-emerald-50 via-green-50 to-teal-100 shadow-[0_18px_40px_rgba(5,150,105,0.14)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(5,150,105,0.2)]">
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-emerald-300/25 blur-2xl" />
          <CardContent className="relative flex min-h-[150px] flex-col justify-between p-6">
            <div className="inline-flex w-fit rounded-2xl border border-emerald-200/60 bg-white/70 p-2.5 text-emerald-700 backdrop-blur">
              <CircleCheck className="h-5 w-5" />
            </div>
            <div className="mt-4">
              <p className="text-4xl font-extrabold leading-none tracking-tight text-emerald-900">{dashboardOrderStats.delivered.toLocaleString()}</p>
              <p className="mt-2 text-sm leading-tight font-medium text-emerald-900/70">Delivered</p>
            </div>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden rounded-3xl border border-indigo-100/70 bg-gradient-to-br from-indigo-50 via-blue-50 to-violet-100 shadow-[0_18px_40px_rgba(79,70,229,0.15)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(79,70,229,0.22)]">
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-indigo-300/25 blur-2xl" />
          <CardContent className="relative flex min-h-[150px] flex-col justify-between p-6">
            <div className="inline-flex w-fit rounded-2xl border border-indigo-200/60 bg-white/70 p-2.5 text-indigo-700 backdrop-blur">
              <Truck className="h-5 w-5" />
            </div>
            <div className="mt-4">
              <p className="text-4xl font-extrabold leading-none tracking-tight text-indigo-900">0</p>
              <p className="mt-2 text-sm leading-tight font-medium text-indigo-900/70">Active Trips</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Enhanced Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="group relative overflow-hidden rounded-3xl border border-blue-100/70 bg-gradient-to-br from-white via-blue-50/70 to-indigo-100/60 shadow-[0_14px_32px_rgba(37,99,235,0.12)] transition-all duration-300 hover:-translate-y-0.5">
          <div className="pointer-events-none absolute -right-10 -bottom-10 h-28 w-28 rounded-full bg-blue-300/20 blur-2xl" />
          <CardContent className="relative flex h-full items-start gap-3 p-6">
            <div className="rounded-2xl border border-blue-200/60 bg-white/80 p-2.5 text-blue-700 backdrop-blur">
              <Warehouse className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-blue-900/75">Assigned Warehouse</p>
              <p className="mt-2 text-4xl font-extrabold leading-none tracking-tight text-blue-900">{assignedWarehouse ? 1 : 0}</p>
              <p className="mt-2 text-xs text-blue-900/60 truncate">
                {assignedWarehouse ? `${assignedWarehouse.name}` : 'No warehouse'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden rounded-3xl border border-emerald-100/70 bg-gradient-to-br from-white via-emerald-50/70 to-teal-100/60 shadow-[0_14px_32px_rgba(5,150,105,0.11)] transition-all duration-300 hover:-translate-y-0.5">
          <div className="pointer-events-none absolute -right-10 -bottom-10 h-28 w-28 rounded-full bg-emerald-300/20 blur-2xl" />
          <CardContent className="relative flex h-full items-start gap-3 p-6">
            <div className="rounded-2xl border border-emerald-200/60 bg-white/80 p-2.5 text-emerald-700 backdrop-blur">
              <Boxes className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-emerald-900/75">Inventory Items</p>
              <p className="mt-2 text-4xl font-extrabold leading-none tracking-tight text-emerald-900">{scopedInventory.length}</p>
              <p className="mt-2 text-xs text-emerald-900/60">Total SKUs tracked</p>
            </div>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden rounded-3xl border border-rose-100/70 bg-gradient-to-br from-white via-rose-50/70 to-pink-100/60 shadow-[0_14px_32px_rgba(225,29,72,0.12)] transition-all duration-300 hover:-translate-y-0.5">
          <div className="pointer-events-none absolute -right-10 -bottom-10 h-28 w-28 rounded-full bg-rose-300/20 blur-2xl" />
          <CardContent className="relative flex h-full items-start gap-3 p-6">
            <div className="rounded-2xl border border-rose-200/60 bg-white/80 p-2.5 text-rose-700 backdrop-blur">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-rose-900/75">Low Stock Items</p>
              <p className="mt-2 text-4xl font-extrabold leading-none tracking-tight text-rose-900">{lowStockCount}</p>
              <p className="mt-2 text-xs text-rose-900/60">{stockHealthPercentage}% of inventory</p>
            </div>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden rounded-3xl border border-amber-100/70 bg-gradient-to-br from-white via-amber-50/70 to-orange-100/60 shadow-[0_14px_32px_rgba(217,119,6,0.12)] transition-all duration-300 hover:-translate-y-0.5">
          <div className="pointer-events-none absolute -right-10 -bottom-10 h-28 w-28 rounded-full bg-amber-300/20 blur-2xl" />
          <CardContent className="relative flex h-full items-start gap-3 p-6">
            <div className="rounded-2xl border border-amber-200/60 bg-white/80 p-2.5 text-amber-700 backdrop-blur">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-amber-900/75">Avg Stock Level</p>
              <p className="mt-2 text-4xl font-extrabold leading-none tracking-tight text-amber-900">{averageStockLevel}</p>
              <p className="mt-2 text-xs text-amber-900/60">Units per item</p>
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
      <Card className="relative overflow-hidden rounded-3xl border border-white/70 bg-white/70 shadow-[0_24px_60px_rgba(15,23,42,0.12)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(16,185,129,0.08),transparent_30%),radial-gradient(circle_at_88%_22%,rgba(244,63,94,0.08),transparent_28%),radial-gradient(circle_at_50%_100%,rgba(245,158,11,0.07),transparent_35%)]" />
        <div className="relative h-1.5 w-full bg-linear-to-r from-emerald-400 via-amber-400 to-rose-400" />
        <CardHeader>
          <CardTitle className="text-xl font-bold text-slate-900">Inventory Status Overview</CardTitle>
          <CardDescription className="text-base text-slate-500">Quick view of stock levels across all items</CardDescription>
        </CardHeader>
        <CardContent className="relative">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="relative overflow-hidden rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-teal-100/70 p-5 shadow-[0_10px_24px_rgba(16,185,129,0.14)]">
              <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-emerald-300/30 blur-xl" />
              <div className="mb-3 inline-flex rounded-xl bg-white/65 p-2 text-emerald-700">
                <CircleCheck className="h-4 w-4" />
              </div>
              <p className="text-sm font-medium text-emerald-900/75">Healthy Stock</p>
              <p className="mt-3 text-5xl font-extrabold leading-none tracking-tight text-emerald-700">{inventoryStatusBreakdown.healthy}</p>
              <p className="mt-3 text-sm text-emerald-900/70">Good levels</p>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 to-yellow-100/70 p-5 shadow-[0_10px_24px_rgba(245,158,11,0.14)]">
              <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-amber-300/30 blur-xl" />
              <div className="mb-3 inline-flex rounded-xl bg-white/65 p-2 text-amber-700">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <p className="text-sm font-medium text-amber-900/75">Low Stock</p>
              <p className="mt-3 text-5xl font-extrabold leading-none tracking-tight text-amber-700">{inventoryStatusBreakdown.lowStock}</p>
              <p className="mt-3 text-sm text-amber-900/70">Needs order soon</p>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-orange-200/70 bg-gradient-to-br from-orange-50 to-amber-100/70 p-5 shadow-[0_10px_24px_rgba(249,115,22,0.14)]">
              <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-orange-300/30 blur-xl" />
              <div className="mb-3 inline-flex rounded-xl bg-white/65 p-2 text-orange-700">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <p className="text-sm font-medium text-orange-900/75">Critical</p>
              <p className="mt-3 text-5xl font-extrabold leading-none tracking-tight text-orange-700">{inventoryStatusBreakdown.critical}</p>
              <p className="mt-3 text-sm text-orange-900/70">Below minimum</p>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-rose-200/70 bg-gradient-to-br from-rose-50 to-pink-100/70 p-5 shadow-[0_10px_24px_rgba(244,63,94,0.14)]">
              <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-rose-300/30 blur-xl" />
              <div className="mb-3 inline-flex rounded-xl bg-white/65 p-2 text-rose-700">
                <Package className="h-4 w-4" />
              </div>
              <p className="text-sm font-medium text-rose-900/75">Out of Stock</p>
              <p className="mt-3 text-5xl font-extrabold leading-none tracking-tight text-rose-700">{inventoryStatusBreakdown.outOfStock}</p>
              <p className="mt-3 text-sm text-rose-900/70">Urgent reorder</p>
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-slate-200/70 bg-white/75 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
            <div className="flex items-center justify-between text-base">
              <span className="font-medium text-slate-600">Total Items</span>
              <span className="text-2xl font-extrabold leading-none text-slate-900">{scopedInventory.length}</span>
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
