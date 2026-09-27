'use client'

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Boxes, Warehouse, TrendingUp, Package, ShoppingCart, CircleCheck, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeComparison, toPoints } from '@/lib/chart-interpretation'
import { WelcomePopup } from '@/components/portals/shared/welcome-popup'
import {
  DashboardMetricCard,
  DashboardSummaryCard,
  InventoryStatusOverviewCard,
  StockHealthCard,
  averageStockLevel,
} from '@/components/portals/shared/dashboard-cards'
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

  const weeklyTrendInterpretation = useMemo(() => describeComparison(
    { name: 'This week', points: toPoints(weeklyTrendData, (row: any) => row.day, (row: any) => row.thisWeek) },
    { name: 'Last week', points: toPoints(weeklyTrendData, (row: any) => row.day, (row: any) => row.lastWeek) },
    { noun: 'orders', periodNoun: 'day', framing: 'change', emptyMessage: 'No orders landed in either week, so there is nothing to compare yet.' }
  ), [weeklyTrendData])

  return (
    <div className="space-y-6">
      <WelcomePopup
        open={showWelcomePopup}
        message={welcomeMessage}
        subtitle="Manage dispatch, monitor inventory, and keep fulfillment moving."
        onClose={() => setShowWelcomePopup(false)}
        overlayClassName="bg-black/70"
        panelClassName="border-slate-200 bg-white"
        titleClassName="text-slate-900"
        subtitleClassName="text-slate-600"
        buttonClassName="bg-slate-100 text-slate-600 hover:bg-slate-200"
      />
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Warehouse Dashboard</h1>
        <p className="text-gray-500">Warehouse operations and stock health overview.</p>
      </div>

      {/* Order Status Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardMetricCard icon={ShoppingCart} value={dashboardOrderStats.totalOrders} label="Total Orders" tone="blue" />
        <DashboardMetricCard icon={Package} value={totalReplacementCases} label="Replacement Cases" tone="rose" />
        <DashboardMetricCard icon={CircleCheck} value={dashboardOrderStats.delivered} label="Delivered" tone="emerald" />
        <DashboardMetricCard icon={Truck} value={activeTripCount} label="Active Trips" tone="indigo" />
      </div>

      {/* Enhanced Summary Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardSummaryCard
          icon={Warehouse}
          label="Assigned Warehouse"
          value={assignedWarehouse?.name ? String(assignedWarehouse.name).trim() : 'No warehouse'}
          tone="blue"
        />
        <DashboardSummaryCard icon={Boxes} label="Inventory Items" value={scopedInventory.length} hint="Total SKUs tracked" tone="emerald" />
        <DashboardSummaryCard icon={AlertTriangle} label="Pending Replacements" value={pendingReplacementCases || 0} tone="rose" />
        <DashboardSummaryCard icon={Package} label="Avg Stock Level" value={averageStockLevel(scopedInventory)} hint="Units per item" tone="amber" />
      </div>

      {/* Inventory Status Breakdown */}
      <InventoryStatusOverviewCard breakdown={inventoryStatusBreakdown} totalItems={scopedInventory.length} />

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
            <ChartInterpretation text={weeklyTrendInterpretation} />
          </CardContent>
        </Card>

        {/* Stock Health Gauge Card */}
        <StockHealthCard lowStockCount={lowStockCount} totalItems={scopedInventory.length} />
      </div>
    </div>
  )
}
