'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ShoppingCart, Truck, Warehouse, Users, TrendingUp, UserCheck, MessageSquare, AlertTriangle, Package, CircleCheck } from 'lucide-react'
import type { DashboardStats } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { PortalDashboardSkeleton } from '@/components/portals/shared/loading-skeletons'
import { WelcomePopup } from '@/components/portals/shared/welcome-popup'
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, BarChart, Bar, PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts'
import { fetchAllPaginatedCollection, getCollection, formatDayKey } from './shared'

export function DashboardView({ stats, isLoading }: { stats: DashboardStats | null; isLoading: boolean }) {
  const [dashboardOrders, setDashboardOrders] = useState<any[]>([])
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
  const [warehouseCount, setWarehouseCount] = useState(0)

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

  useEffect(() => {
    async function fetchWarehouseCount() {
      try {
        const result = await fetchAllPaginatedCollection<any>(
          '/api/warehouses',
          'warehouses',
          { cache: 'no-store' },
          { retries: 2, timeoutMs: 12000, pageSize: 100, maxPages: 20 }
        )
        if (!result.ok) return
        setWarehouseCount(getCollection<any>(result.data, ['warehouses']).length)
      } catch {
        setWarehouseCount(0)
      }
    }
    fetchWarehouseCount()
  }, [])

  const dashboardOrderStats = useMemo(() => {
    const businessOrders = dashboardOrders.filter(
      (order: any) => !String(order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-')
    )
    const totalOrders = businessOrders.length
    const outForDelivery = businessOrders.filter((order: any) => String(order?.status || '').trim().toUpperCase() === 'OUT_FOR_DELIVERY').length
    const delivered = businessOrders.filter((order: any) => String(order?.status || '').trim().toUpperCase() === 'DELIVERED').length

    return {
      totalOrders,
      outForDelivery,
      delivered,
    }
  }, [dashboardOrders])

  const totalVehicles = Number(stats?.totalVehicles || 0)
  const totalClients = Number(stats?.totalCustomers || 0)
  const availableDrivers = Number(stats?.availableDrivers || stats?.activeDrivers || 0)

  const statCards = [
    { label: 'Purchase Orders', value: dashboardOrderStats.totalOrders, color: 'blue', icon: ShoppingCart },
    { label: 'Warehouse', value: warehouseCount === 1 ? 'Registered' : 'Setup Required', color: 'red', icon: Warehouse },
    { label: 'Vehicles', value: totalVehicles, color: 'green', icon: Truck },
    { label: 'Clients', value: totalClients, color: 'indigo', icon: Users },
  ]

  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    red: 'bg-red-50 text-red-600 border-red-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200',
  }

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

    for (const order of dashboardOrders) {
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

  // Order Status Distribution
  const orderStatusData = useMemo(() => {
    const statusMap = new Map<string, number>([
      ['Cancelled', 0],
      ['Rescheduled', 0],
    ])

    for (const order of dashboardOrders) {
      const rawStatus = String(order?.status || '').toUpperCase()

      if (['CANCELLED', 'CANCELED', 'FAILED', 'FAILED_DELIVERY', 'REJECTED', 'SKIPPED'].includes(rawStatus)) {
        statusMap.set('Cancelled', (statusMap.get('Cancelled') || 0) + 1)
        continue
      }

      if (rawStatus === 'RESCHEDULED') {
        statusMap.set('Rescheduled', (statusMap.get('Rescheduled') || 0) + 1)
      }
    }

    return Array.from(statusMap.entries())
      .map(([name, value]) => ({ name, value }))
      .filter((entry) => entry.value > 0)
  }, [dashboardOrders])

  // Delivery Performance
  const deliveryPerformance = useMemo(() => {
    const delivered = dashboardOrderStats.delivered
    const failed = Number(stats?.failedOrders || 0)

    return [
      { name: 'Delivered', value: delivered, color: '#10b981' },
      { name: 'Failed', value: failed, color: '#ef4444' },
    ]
  }, [dashboardOrderStats.delivered, stats?.failedOrders])

  const statusColors: { [key: string]: string } = {
    'Cancelled': '#ef4444',
    'Rescheduled': '#f59e0b',
  }
  return (
    <>
      <WelcomePopup
        open={showWelcomePopup}
        message={welcomeMessage}
        subtitle="Monitor operations, inventory, and deliveries from your admin dashboard."
        onClose={() => setShowWelcomePopup(false)}
        overlayClassName="bg-black/70"
        panelClassName="border-emerald-200 bg-[#eaf8f1]"
        titleClassName="text-slate-900"
        subtitleClassName="text-slate-600"
        buttonClassName="bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
      />
      {isLoading ? (
        <PortalDashboardSkeleton />
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-500">Here&apos;s your logistics overview.</p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4">
        {statCards.map((stat, i) => {
          const gradients: { [key: string]: string } = {
            blue: 'from-blue-50 to-indigo-50',
            red: 'from-red-50 to-rose-50',
            green: 'from-green-50 to-emerald-50',
            indigo: 'from-indigo-50 to-blue-50',
          }
          const textColors: { [key: string]: string } = {
            blue: 'text-blue-900',
            red: 'text-red-900',
            green: 'text-green-900',
            indigo: 'text-indigo-900',
          }
          return (
            <Card key={i} className={`relative overflow-hidden rounded-2xl border-0 shadow-sm bg-gradient-to-br ${gradients[stat.color as keyof typeof gradients] || 'from-gray-50 to-gray-100'}`}>
              <CardContent className="flex min-h-[160px] flex-col items-center justify-center p-6 text-center">
                <div className={`inline-flex rounded-xl border-0 p-3 ${colorClasses[stat.color as keyof typeof colorClasses]}`}>
                  <stat.icon className="h-6 w-6" />
                </div>
                <p className={`text-3xl font-bold leading-none mt-4 ${textColors[stat.color as keyof typeof textColors] || 'text-gray-900'}`}>{stat.value.toLocaleString()}</p>
                <p className="mt-2 text-sm leading-tight text-gray-600">{stat.label}</p>
              </CardContent>
            </Card>
          )
        })}
          </div>

      {/* Quick Stats Row */}
          <div className="grid grid-cols-3 gap-4">

        <Card className="bg-gradient-to-br from-green-600 to-green-700 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm">Available Drivers</p>
                <p className="text-3xl font-bold mt-1">{availableDrivers}</p>
              </div>
              <UserCheck className="h-10 w-10 text-green-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-sm">Avg. Customer Rating</p>
                <p className="text-3xl font-bold mt-1">{Number(stats?.avgRating || 0).toFixed(1)}</p>
              </div>
              <MessageSquare className="h-10 w-10 text-orange-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-cyan-500 to-blue-600 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-cyan-100 text-sm">Delivery Success Rate</p>
                <p className="text-3xl font-bold mt-1">
                  {dashboardOrderStats.totalOrders > 0
                    ? Math.round((dashboardOrderStats.delivered / dashboardOrderStats.totalOrders) * 100)
                    : 0}%
                </p>
              </div>
              <CircleCheck className="h-10 w-10 text-cyan-200" />
            </div>
          </CardContent>
        </Card>
          </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="xl:col-span-2 rounded-2xl border-0 shadow-sm">
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
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <YAxis axisLine={false} tickLine={false} width={28} domain={[0, 'auto']} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} />
                <Area type="monotone" dataKey="thisWeek" stroke="#3b82f6" strokeWidth={2.5} fill="url(#fillThisWeekAdmin)" dot={false} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Delivery Performance</CardTitle>
            <CardDescription>Delivered vs Failed orders</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deliveryPerformance} margin={{ left: 8, right: 8, top: 12, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <YAxis axisLine={false} tickLine={false} width={28} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts Section */}
          <div className="grid grid-cols-2 gap-4">
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {/* <Undo2 className="h-5 w-5 text-purple-500" /> */}
              Pending Replacements
            </CardTitle>
            <CardDescription>Replacement cases awaiting driver follow-up</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="font-medium">{stats?.pendingReturns || 0} pending replacement case(s)</p>
                  <p className="text-sm text-gray-500">Awaiting driver follow-up or closure</p>
                </div>
                <Badge variant={Number(stats?.pendingReturns || 0) > 0 ? 'secondary' : 'outline'}>
                  {Number(stats?.pendingReturns || 0) > 0 ? 'Pending' : 'Clear'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
          </div>
        </div>
      )}
    </>
  )
}
