'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ShoppingCart, Clock, Truck, MapPin, CircleCheck, TrendingUp, UserCheck, MessageSquare, AlertTriangle } from 'lucide-react'
import type { DashboardStats } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { AreaChart, CartesianGrid, YAxis, XAxis, Area } from 'recharts'
import { getCollection, formatDayKey, formatPeso } from './shared'

export function DashboardView({ stats, isLoading }: { stats: DashboardStats | null; isLoading: boolean }) {
  const [dashboardOrders, setDashboardOrders] = useState<any[]>([])

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const ordersRes = await fetch('/api/orders?limit=200&includeItems=none')

        if (ordersRes.ok) {
          const ordersData = await ordersRes.json()
          setDashboardOrders(getCollection<any>(ordersData, ['orders']))
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      }
    }
    fetchDashboardData()
  }, [])

  const dashboardOrderStats = useMemo(() => {
    const totalOrders = Number(stats?.totalOrders || dashboardOrders.length || 0)
    const processing = Number(stats?.pendingOrders || 0)
    const loadedOnly = Number(stats?.loadedOrders || 0)
    const outForDelivery = Number(stats?.inTransitOrders || 0)
    const delivered = Number(stats?.deliveredOrders || 0)
    const deliveredPaidRevenue = Number(stats?.totalRevenue || 0)

    return {
      totalOrders,
      processing,
      loadedOnly,
      outForDelivery,
      delivered,
      deliveredPaidRevenue,
    }
  }, [dashboardOrders.length, stats])

  const activeTripsFromData = Number(stats?.activeTrips || 0)
  const availableDrivers = Number(stats?.availableDrivers || stats?.activeDrivers || 0)

  const statCards = [
    { label: 'Total Orders', value: dashboardOrderStats.totalOrders, color: 'blue', icon: ShoppingCart },
    { label: 'Processing', value: dashboardOrderStats.processing, color: 'yellow', icon: Clock },
    { label: 'Loaded', value: dashboardOrderStats.loadedOnly, color: 'purple', icon: Truck },
    { label: 'Out for Delivery', value: dashboardOrderStats.outForDelivery, color: 'red', icon: MapPin },
    { label: 'Delivered', value: dashboardOrderStats.delivered, color: 'green', icon: CircleCheck },
    { label: 'Active Trips', value: activeTripsFromData, color: 'indigo', icon: Truck },
  ]

  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    red: 'bg-red-50 text-red-600 border-red-200',
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

  const revenueOverviewData = useMemo(() => {
    const dailyRevenue = new Map<string, number>()
    for (const order of dashboardOrders) {
      if (!order?.createdAt) continue
      if (String(order?.status || '').toUpperCase() !== 'DELIVERED') continue
      if (String(order?.paymentStatus || '').toLowerCase() !== 'paid') continue
      const orderDate = new Date(order.createdAt)
      if (Number.isNaN(orderDate.getTime())) continue
      const orderKey = formatDayKey(orderDate)
      dailyRevenue.set(orderKey, (dailyRevenue.get(orderKey) || 0) + Number(order.totalAmount || 0))
    }
    return last7Days.map((day) => ({
      day: day.label,
      value: Math.round(dailyRevenue.get(day.key) || 0),
    }))
  }, [dashboardOrders, last7Days])

  const weekRevenue = useMemo(() => revenueOverviewData.reduce((sum, entry) => sum + entry.value, 0), [revenueOverviewData])

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500">Welcome back! Here's your logistics overview.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((stat, i) => (
          <Card key={i} className="relative overflow-hidden rounded-2xl border border-slate-200/80 shadow-sm">
            <CardContent className="flex min-h-[120px] flex-col justify-between p-5">
              <div className={`inline-flex w-fit rounded-xl border p-2.5 ${colorClasses[stat.color as keyof typeof colorClasses]}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div className="mt-4">
                <p className="text-2xl font-bold leading-none">{stat.value.toLocaleString()}</p>
                <p className="mt-2 text-sm leading-tight text-gray-500">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-blue-600 to-blue-700 text-white">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">Total Revenue</p>
                <p className="text-3xl font-bold mt-1">
                  {formatPeso(dashboardOrderStats.deliveredPaidRevenue)}
                </p>
              </div>
              <TrendingUp className="h-10 w-10 text-blue-200" />
            </div>
          </CardContent>
        </Card>

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
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Orders This Week vs Last Week</CardTitle>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">Month</span>
                <span className="rounded-md border border-blue-400 px-2 py-0.5 text-blue-600">Week</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ChartContainer config={ordersChartConfig} className="h-[320px] w-full">
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

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>This Week Statistics</CardDescription>
            <CardTitle className="text-3xl">{formatPeso(weekRevenue)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] flex items-end gap-3">
              {(() => {
                const maxRevenueBar = Math.max(...revenueOverviewData.map((d) => Number(d.value) || 0), 1)
                return revenueOverviewData.map((item) => {
                  const percent = Math.max(0, Math.min(100, ((Number(item.value) || 0) / maxRevenueBar) * 100))
                  return (
                    <div key={item.day} className="flex-1 flex flex-col items-center gap-2">
                      <div className="flex-1 w-full rounded-t-md bg-cyan-100/50 relative min-h-[18px] overflow-hidden">
                        <div
                          className="absolute bottom-0 left-0 right-0 rounded-t-md bg-cyan-400 min-h-[4px]"
                          style={{ height: `${percent}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500">{item.day}</span>
                    </div>
                  )
                })
              })()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              Low Stock Alerts
            </CardTitle>
            <CardDescription>Items that need restocking soon</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{stats?.lowStockItems || 0}</h1>
                  <p className="text-sm text-gray-500">Items currently below threshold</p>
                </div>
                <Badge variant={Number(stats?.lowStockItems || 0) > 0 ? 'destructive' : 'secondary'}>
                  {Number(stats?.lowStockItems || 0) > 0 ? 'Needs Action' : 'Stable'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {/* <Undo2 className="h-5 w-5 text-purple-500" /> */}
              Pending Replacements
            </CardTitle>
            <CardDescription>Replacement cases awaiting review</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="font-medium">{stats?.pendingReturns || 0} pending replacement case(s)</p>
                  <p className="text-sm text-gray-500">Awaiting admin follow-up or closure</p>
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
  )
}
