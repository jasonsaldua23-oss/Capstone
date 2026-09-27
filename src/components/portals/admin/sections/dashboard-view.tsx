'use client'

import { useEffect, useMemo, useState } from 'react'
import { Boxes, CircleCheck, MessageSquare, Package, ShoppingCart, TrendingUp, Truck, Users } from 'lucide-react'
import type { DashboardStats } from '@/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { PortalDashboardSkeleton } from '@/components/portals/shared/loading-skeletons'
import { WelcomePopup } from '@/components/portals/shared/welcome-popup'
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, BarChart, Bar, PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts'
import { ChartInterpretation } from '@/components/ui/chart-interpretation'
import { describeComparison, describeComposition, toPoints } from '@/lib/chart-interpretation'
import { isIssuedPurchaseOrder } from '@/lib/purchase-documents'
import { buildInventoryStatusBreakdown, summarizeStockHealth, summarizeWarehouseDashboardOrders } from '@/lib/report-metrics'
import {
  DashboardMetricCard,
  DashboardSummaryCard,
  InventoryStatusOverviewCard,
  StockHealthCard,
} from '@/components/portals/shared/dashboard-cards'
import { summarizeReplacementCases } from '@/components/portals/shared/replacement-summary'
import { fetchAllPaginatedCollection, getCollection, formatDayKey } from './shared'

export function DashboardView({ stats, isLoading }: { stats: DashboardStats | null; isLoading: boolean }) {
  const [dashboardOrders, setDashboardOrders] = useState<any[]>([])
  const [dashboardInventory, setDashboardInventory] = useState<any[]>([])
  const [dashboardReplacements, setDashboardReplacements] = useState<any[]>([])
  const [dashboardOrdersLoading, setDashboardOrdersLoading] = useState(true)
  const [welcomeState] = useState(() => {
    if (typeof window === 'undefined') return { open: false, message: 'Welcome back!' }
    try {
      const raw = window.sessionStorage.getItem('admin_welcome_state')
      if (!raw) return { open: false, message: 'Welcome back!' }
      const parsed = JSON.parse(raw) as { name?: string }
      const name = String(parsed?.name || '').trim()
      window.sessionStorage.removeItem('admin_welcome_state')
      return {
        open: true,
        message: name ? `Welcome back, ${name}.` : 'Welcome back!',
      }
    } catch {
      return { open: false, message: 'Welcome back!' }
    }
  })
  const [showWelcomePopup, setShowWelcomePopup] = useState(welcomeState.open)
  const welcomeMessage = welcomeState.message

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        // The stock and replacement figures load alongside the orders, so the
        // dashboard waits for the slowest of the three rather than their sum.
        const [ordersResult, inventoryResult, replacementsResult] = await Promise.all([
          fetchAllPaginatedCollection<any>(
            '/api/orders?includeItems=none&summaryOnly=true',
            'orders',
            { cache: 'no-store' },
            // Keep the dashboard loading state until the real order totals arrive.
            { retries: 1, timeoutMs: 90000, pageSize: 200, maxPages: 100 }
          ),
          fetchAllPaginatedCollection<any>(
            '/api/inventory',
            'inventory',
            { cache: 'no-store' },
            { retries: 1, timeoutMs: 30000, pageSize: 200, maxPages: 50 }
          ),
          fetchAllPaginatedCollection<any>(
            '/api/replacements',
            'replacements',
            { cache: 'no-store' },
            { retries: 1, timeoutMs: 30000, pageSize: 200, maxPages: 50 }
          ),
        ])

        if (ordersResult.ok) {
          setDashboardOrders(getCollection<any>(ordersResult.data, ['orders']))
        }
        if (inventoryResult.ok) {
          setDashboardInventory(getCollection<any>(inventoryResult.data, ['inventory']))
        }
        if (replacementsResult.ok) {
          setDashboardReplacements(getCollection<any>(replacementsResult.data, ['replacements']))
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        setDashboardOrdersLoading(false)
      }
    }
    fetchDashboardData()
  }, [])

  // Same helpers as the warehouse dashboard, so both portals show the same figures.
  const dashboardOrderStats = useMemo(() => summarizeWarehouseDashboardOrders(dashboardOrders), [dashboardOrders])
  const replacementSummary = useMemo(() => summarizeReplacementCases(dashboardReplacements), [dashboardReplacements])
  const inventoryStatusBreakdown = useMemo(() => buildInventoryStatusBreakdown(dashboardInventory), [dashboardInventory])
  const lowStockCount = useMemo(() => summarizeStockHealth(dashboardInventory).belowThreshold, [dashboardInventory])

  const totalVehicles = Number(stats?.totalVehicles || 0)
  const totalClients = Number(stats?.totalCustomers || 0)
  const activeTrips = Number(stats?.activeTrips || 0)
  const deliverySuccessRate = dashboardOrderStats.totalOrders > 0
    ? Math.round((dashboardOrderStats.delivered / dashboardOrderStats.totalOrders) * 100)
    : 0

  const last7Days = useMemo(() => {
    return Array.from({ length: 7 }).map((_, index) => {
      const date = new Date()
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - (6 - index))
      return {
        key: formatDayKey(date),
        label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      }
    })
  }, [])

  const ordersComparisonData = useMemo(() => {
    const thisWeekCount = new Map<string, number>()
    const lastWeekCount = new Map<string, number>()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const approvedOrders = dashboardOrders.filter(isIssuedPurchaseOrder)
    for (const order of approvedOrders) {
      if (!order?.createdAt) continue
      const orderDate = new Date(order.createdAt)
      if (Number.isNaN(orderDate.getTime())) continue
      orderDate.setHours(0, 0, 0, 0)
      const dayDiff = Math.floor((today.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24))
      if (dayDiff >= 0 && dayDiff <= 6) {
        const orderKey = formatDayKey(orderDate)
        thisWeekCount.set(orderKey, (thisWeekCount.get(orderKey) || 0) + 1)
      } else if (dayDiff >= 7 && dayDiff <= 13) {
        const mappedLastWeekKeyDate = new Date(orderDate)
        mappedLastWeekKeyDate.setDate(mappedLastWeekKeyDate.getDate() + 7)
        const mappedLastWeekKey = formatDayKey(mappedLastWeekKeyDate)
        lastWeekCount.set(mappedLastWeekKey, (lastWeekCount.get(mappedLastWeekKey) || 0) + 1)
      }
    }

    return last7Days.map((day) => ({
      day: day.label,
      thisWeek: thisWeekCount.get(day.key) || 0,
      lastWeek: lastWeekCount.get(day.key) || 0,
    }))
  }, [dashboardOrders, last7Days])

  const ordersChartConfig = {
    thisWeek: {
      label: 'This Week',
      color: '#3b82f6',
    },
    lastWeek: {
      label: 'Last Week',
      color: '#1d4ed8',
    },
  }

  const deliveryPerformance = useMemo(() => {
    const delivered = dashboardOrderStats.delivered
    const failed = Number(stats?.failedOrders || 0)

    return [
      { name: 'Delivered', value: delivered, color: '#10b981' },
      { name: 'Failed', value: failed, color: '#ef4444' },
    ]
  }, [dashboardOrderStats.delivered, stats?.failedOrders])

  // Both dashboard charts carry a reading so the numbers are not left to the eye alone.
  const ordersInterpretation = useMemo(() => describeComparison(
    { name: 'This week', points: toPoints(ordersComparisonData, (row) => row.day, (row) => row.thisWeek) },
    { name: 'Last week', points: toPoints(ordersComparisonData, (row) => row.day, (row) => row.lastWeek) },
    { noun: 'approved orders', periodNoun: 'day', framing: 'change', emptyMessage: 'No approved orders landed in either week, so there is nothing to compare yet.' }
  ), [ordersComparisonData])

  const deliveryInterpretation = useMemo(() => describeComposition(
    toPoints(deliveryPerformance, (row) => row.name, (row) => row.value),
    { noun: 'closed orders', entityNoun: 'outcome', emptyMessage: 'No order has been delivered or failed yet, so there is nothing to interpret.' }
  ), [deliveryPerformance])

  return (
    <>
      <WelcomePopup
        open={showWelcomePopup}
        message={welcomeMessage}
        subtitle="Monitor operations, inventory, and deliveries from your admin dashboard."
        onClose={() => setShowWelcomePopup(false)}
        overlayClassName="bg-black/70"
        panelClassName="border-slate-200 bg-white"
        titleClassName="text-slate-900"
        subtitleClassName="text-slate-600"
        buttonClassName="bg-slate-100 text-slate-600 hover:bg-slate-200"
      />
      {isLoading || dashboardOrdersLoading ? (
        <PortalDashboardSkeleton />
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-500">Here&apos;s your logistics overview.</p>
          </div>

          {/* Order Status Cards */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <DashboardMetricCard icon={ShoppingCart} value={dashboardOrderStats.totalOrders} label="Purchase Orders" tone="blue" />
            <DashboardMetricCard icon={Package} value={replacementSummary.totalCases} label="Replacement Cases" tone="rose" />
            <DashboardMetricCard icon={CircleCheck} value={dashboardOrderStats.delivered} label="Delivered" tone="emerald" />
            <DashboardMetricCard icon={Truck} value={activeTrips} label="Active Trips" tone="indigo" />
          </div>

          {/* Stock, fleet and clients */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <DashboardSummaryCard icon={Boxes} label="Inventory Items" value={dashboardInventory.length} hint="Total SKUs tracked" tone="emerald" />
            <DashboardSummaryCard icon={Truck} label="Vehicles" value={totalVehicles} hint="In the fleet" tone="indigo" />
            <DashboardSummaryCard icon={Users} label="Clients" value={totalClients} hint="Registered clients" tone="blue" />
            <DashboardSummaryCard
              icon={MessageSquare}
              label="Avg. Customer Rating"
              value={Number(stats?.avgRating || 0).toFixed(1)}
              valueKind="number"
              hint="Out of 5 stars"
              tone="amber"
            />
          </div>

          <InventoryStatusOverviewCard breakdown={inventoryStatusBreakdown} totalItems={dashboardInventory.length} />

          {/* Two columns on tablets, one row of four on wide screens: no empty cells at either. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl border-0 shadow-sm md:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-base">Orders This Week vs Last Week</CardTitle>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">This Week</span>
                <span className="rounded-md border border-blue-400 bg-blue-50 px-2 py-0.5 text-blue-600">vs Last Week</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ChartContainer config={ordersChartConfig} className="h-[300px] w-full">
              <AreaChart data={ordersComparisonData} margin={{ left: 8, right: 8, top: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillThisWeekAdmin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.08} />
                  </linearGradient>
                  <linearGradient id="fillLastWeekAdmin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1d4ed8" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#1d4ed8" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <YAxis axisLine={false} tickLine={false} width={28} domain={[0, 'auto']} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="thisWeek" stroke="#3b82f6" strokeWidth={2.5} fill="url(#fillThisWeekAdmin)" dot={false} />
                <Area type="monotone" dataKey="lastWeek" stroke="#1d4ed8" strokeWidth={2} fill="url(#fillLastWeekAdmin)" dot={false} />
              </AreaChart>
            </ChartContainer>
            <ChartInterpretation text={ordersInterpretation} />
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Delivery Performance</CardTitle>
            <CardDescription>Delivered vs failed orders · {deliverySuccessRate}% of purchase orders delivered</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deliveryPerformance} margin={{ left: 8, right: 8, top: 12, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <YAxis axisLine={false} tickLine={false} width={28} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {deliveryPerformance.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ChartInterpretation text={deliveryInterpretation} />
          </CardContent>
        </Card>
        <StockHealthCard lowStockCount={lowStockCount} totalItems={dashboardInventory.length} />
      </div>
    </div>
  )}
</>
)
}
