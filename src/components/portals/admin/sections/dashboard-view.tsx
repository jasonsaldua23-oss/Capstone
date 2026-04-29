'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ShoppingCart, Truck, MapPin, CircleCheck, TrendingUp, UserCheck, MessageSquare, AlertTriangle, Package } from 'lucide-react'
import type { DashboardStats } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, BarChart, Bar, PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts'
import { fetchAllPaginatedCollection, getCollection, formatDayKey } from './shared'

export function DashboardView({ stats, isLoading }: { stats: DashboardStats | null; isLoading: boolean }) {
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
    const totalOrders = Number(stats?.totalOrders || dashboardOrders.length || 0)
    const outForDelivery = Number(stats?.inTransitOrders || 0)
    const delivered = Number(stats?.deliveredOrders || 0)

    return {
      totalOrders,
      outForDelivery,
      delivered,
    }
  }, [dashboardOrders.length, stats])

  const activeTripsFromData = Number(stats?.activeTrips || 0)
  const availableDrivers = Number(stats?.availableDrivers || stats?.activeDrivers || 0)

  const statCards = [
    { label: 'Total Orders', value: dashboardOrderStats.totalOrders, color: 'blue', icon: ShoppingCart },
    { label: 'Out for Delivery', value: dashboardOrderStats.outForDelivery, color: 'red', icon: MapPin },
    { label: 'Delivered', value: dashboardOrderStats.delivered, color: 'green', icon: CircleCheck },
    { label: 'Active Trips', value: activeTripsFromData, color: 'indigo', icon: Truck },
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
    const statusMap = new Map<string, number>()
    for (const order of dashboardOrders) {
      const status = String(order?.status || '').toUpperCase() || 'UNKNOWN'
      statusMap.set(status, (statusMap.get(status) || 0) + 1)
    }
    return Array.from(statusMap.entries()).map(([name, value]) => ({
      name: name.charAt(0) + name.slice(1).toLowerCase(),
      value,
    }))
  }, [dashboardOrders])

  // Delivery Performance
  const deliveryPerformance = useMemo(() => {
    const delivered = dashboardOrderStats.delivered
    const total = dashboardOrderStats.totalOrders
    const pending = dashboardOrderStats.outForDelivery

    return [
      { name: 'Delivered', value: delivered, color: '#10b981' },
      { name: 'In Progress', value: pending, color: '#f59e0b' },
    ]
  }, [dashboardOrderStats])

  const statusColors: { [key: string]: string } = {
    'Pending': '#ef4444',
    'Processing': '#f59e0b',
    'Loaded': '#8b5cf6',
    'In_transit': '#3b82f6',
    'Delivered': '#10b981',
    'Cancelled': '#6b7280',
    'Unknown': '#9ca3af',
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
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
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Order Status Distribution */}
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Order Status Distribution</CardTitle>
            <CardDescription>Breakdown of orders by status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] flex items-center justify-center">
              {orderStatusData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={orderStatusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(entry: any) => `${entry.name}: ${entry.value}`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {orderStatusData.map((entry: any, index: number) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={Object.values(statusColors)[index % Object.values(statusColors).length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any) => `${value} orders`} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-500">No data available</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Delivery Performance */}
        <Card className="rounded-2xl border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Delivery Performance</CardTitle>
            <CardDescription>Delivered vs In Progress orders</CardDescription>
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="rounded-2xl border-0 shadow-sm">
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

        <Card className="rounded-2xl border-0 shadow-sm">
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
