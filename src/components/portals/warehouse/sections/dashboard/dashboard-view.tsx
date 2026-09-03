'use client'

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Boxes, Warehouse, TrendingUp, Package, ShoppingCart, CircleCheck, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { WelcomePopup } from '@/components/portals/shared/welcome-popup'
import type { WarehouseDashboardViewProps } from '../shared/types'

export function WarehouseDashboardView({
  assignedWarehouse,
  scopedInventory,
  dashboardOrderStats,
  inventoryStatusBreakdown,
  lowStockCount,
  activeTripCount,
  pendingReplacementCases,
  totalReplacementCases,
  warehouseOrdersChartConfig,
  weeklyTrendData,
}: WarehouseDashboardViewProps) {
  const [welcomeState] = useState(() => {
    if (typeof window === 'undefined') return { open: false, message: 'Welcome back!' }
    try {
      const raw = window.sessionStorage.getItem('warehouse_welcome_state')
      if (!raw) return { open: false, message: 'Welcome back!' }
      const parsed = JSON.parse(raw) as { name?: string }
      const name = String(parsed?.name || '').trim()
      const message = name ? `Welcome back, ${name}.` : 'Welcome back!'
      window.sessionStorage.removeItem('warehouse_welcome_state')
      return { open: true, message }
    } catch {
      return { open: false, message: 'Welcome back!' }
    }
  })
  const [showWelcomePopup, setShowWelcomePopup] = useState(welcomeState.open)
  const welcomeMessage = welcomeState.message

  const weeklyTrendAxis = useMemo(() => {
    const rawMax = weeklyTrendData.reduce((max, item) => {
      const nextMax = Math.max(Number(item?.thisWeek || 0), Number(item?.lastWeek || 0))
      return Math.max(max, nextMax)
    }, 0)
    const weeklyTrendMax = Math.max(1, rawMax)
    const step = weeklyTrendMax <= 5 ? 1 : Math.ceil(weeklyTrendMax / 5)
    const axisMax = Math.max(1, Math.ceil(weeklyTrendMax / step) * step)
    const ticks = Array.from({ length: Math.floor(axisMax / step) + 1 }, (_, index) => index * step)

    return {
      axisMax,
      ticks,
    }
  }, [weeklyTrendData])

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

  return (
    <div className="space-y-6">
      <WelcomePopup
        open={showWelcomePopup}
        message={welcomeMessage}
        subtitle="Manage dispatch, monitor inventory, and keep fulfillment moving."
        onClose={() => setShowWelcomePopup(false)}
        overlayClassName="bg-black/70"
        panelClassName="border-emerald-200 bg-[#eaf8f1]"
        titleClassName="text-slate-900"
        subtitleClassName="text-slate-600"
        buttonClassName="bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
      />
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Warehouse Dashboard</h1>
        <p className="text-gray-500">Warehouse operations and stock health overview.</p>
      </div>

      {/* Order Status Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="group relative overflow-hidden rounded-3xl border border-blue-100/70 bg-blue-50 shadow-[0_18px_40px_rgba(37,99,235,0.16)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(37,99,235,0.22)]">
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

        <Card className="group relative overflow-hidden rounded-3xl border border-rose-100/70 bg-rose-50 shadow-[0_18px_40px_rgba(225,29,72,0.14)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(225,29,72,0.2)]">
          <CardContent className="relative flex min-h-[150px] flex-col justify-between p-6">
            <div className="inline-flex w-fit rounded-2xl border border-rose-200/60 bg-white/70 p-2.5 text-rose-700 backdrop-blur">
              <Package className="h-5 w-5" />
            </div>
            <div className="mt-4">
              <p className="text-4xl font-extrabold leading-none tracking-tight text-rose-900">{totalReplacementCases.toLocaleString()}</p>
              <p className="mt-2 text-sm leading-tight font-medium text-rose-900/70">Replacement Cases</p>
            </div>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden rounded-3xl border border-emerald-100/70 bg-emerald-50 shadow-[0_18px_40px_rgba(5,150,105,0.14)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(5,150,105,0.2)]">
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

        <Card className="group relative overflow-hidden rounded-3xl border border-indigo-100/70 bg-indigo-50 shadow-[0_18px_40px_rgba(79,70,229,0.15)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_55px_rgba(79,70,229,0.22)]">
          <CardContent className="relative flex min-h-[150px] flex-col justify-between p-6">
            <div className="inline-flex w-fit rounded-2xl border border-indigo-200/60 bg-white/70 p-2.5 text-indigo-700 backdrop-blur">
              <Truck className="h-5 w-5" />
            </div>
            <div className="mt-4">
              <p className="text-4xl font-extrabold leading-none tracking-tight text-indigo-900">{activeTripCount.toLocaleString()}</p>
              <p className="mt-2 text-sm leading-tight font-medium text-indigo-900/70">Active Trips</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Enhanced Summary Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="group relative overflow-hidden rounded-3xl border border-blue-100/70 bg-blue-50 shadow-[0_14px_32px_rgba(37,99,235,0.12)] transition-all duration-300 hover:-translate-y-0.5">
          <CardContent className="relative flex h-full items-start gap-3 p-6">
            <div className="rounded-2xl border border-blue-200/60 bg-white/80 p-2.5 text-blue-700 backdrop-blur">
              <Warehouse className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-blue-900/75">Assigned Warehouse</p>
              <p className="mt-2 text-2xl font-extrabold leading-tight tracking-tight text-blue-900">
                {assignedWarehouse?.name ? String(assignedWarehouse.name).trim() : 'No warehouse'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden rounded-3xl border border-emerald-100/70 bg-emerald-50 shadow-[0_14px_32px_rgba(5,150,105,0.11)] transition-all duration-300 hover:-translate-y-0.5">
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

        <Card className="group relative overflow-hidden rounded-3xl border border-rose-100/70 bg-rose-50 shadow-[0_14px_32px_rgba(225,29,72,0.12)] transition-all duration-300 hover:-translate-y-0.5">
          <CardContent className="relative flex h-full items-start gap-3 p-6">
            <div className="rounded-2xl border border-rose-200/60 bg-white/80 p-2.5 text-rose-700 backdrop-blur">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-rose-900/75">Pending Replacements</p>
              <p className="mt-2 text-4xl font-extrabold leading-none tracking-tight text-rose-900">{pendingReplacementCases || 0}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden rounded-3xl border border-amber-100/70 bg-amber-50 shadow-[0_14px_32px_rgba(217,119,6,0.12)] transition-all duration-300 hover:-translate-y-0.5">
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

      {/* Inventory Status Breakdown */}
      <Card className="relative overflow-hidden rounded-3xl border border-white/70 bg-white/70 shadow-[0_24px_60px_rgba(15,23,42,0.12)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(16,185,129,0.08),transparent_30%),radial-gradient(circle_at_88%_22%,rgba(244,63,94,0.08),transparent_28%),radial-gradient(circle_at_50%_100%,rgba(245,158,11,0.07),transparent_35%)]" />
        <div className="relative h-1.5 w-full bg-linear-to-r from-emerald-400 via-amber-400 to-rose-400" />
        <CardHeader>
          <CardTitle className="text-xl font-bold text-slate-900">Inventory Status Overview</CardTitle>
          <CardDescription className="text-base text-slate-500">Quick view of stock levels across all items</CardDescription>
        </CardHeader>
        <CardContent className="relative">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={28}
                  allowDecimals={false}
                  domain={[0, weeklyTrendAxis.axisMax]}
                  ticks={weeklyTrendAxis.ticks}
                />
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
    </div>
  )
}
