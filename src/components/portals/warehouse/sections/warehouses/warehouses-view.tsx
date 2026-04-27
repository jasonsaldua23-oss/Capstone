'use client'

import { Bar, BarChart, CartesianGrid, Cell, Label as RechartsLabel, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { Loader2 } from 'lucide-react'
import type { WarehouseWarehousesViewProps } from '../shared/types'

export function WarehouseWarehousesView({
  loadingWarehouses,
  assignedWarehouse,
  warehouseOverviewStats,
  getStockHealthDotClass,
}: WarehouseWarehousesViewProps) {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Assigned Warehouse</CardTitle>
          <CardDescription>Operational details for your assigned warehouse.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingWarehouses ? (
            <div className="h-40 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
          ) : !assignedWarehouse ? (
            <div className="h-40 flex items-center justify-center text-gray-500">No assigned warehouse found</div>
          ) : (
            <div className="rounded-lg border bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-lg">{assignedWarehouse.name}</h3>
                  <p className="text-sm text-gray-500">{assignedWarehouse.code}</p>
                  <p className="text-sm text-gray-500">{[assignedWarehouse.city, assignedWarehouse.province].filter(Boolean).join(', ')}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Capacity: {Number(assignedWarehouse.capacity || 0).toLocaleString()} units
                  </p>
                </div>
                <Badge variant={assignedWarehouse.isActive ? 'default' : 'secondary'}>
                  {assignedWarehouse.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {assignedWarehouse && warehouseOverviewStats && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Capacity Utilization</CardTitle>
                <Badge className={warehouseOverviewStats.usagePercent >= 90 ? 'bg-red-100 text-red-800 hover:bg-red-100' : warehouseOverviewStats.usagePercent >= 70 ? 'bg-amber-100 text-amber-800 hover:bg-amber-100' : 'bg-green-100 text-green-800 hover:bg-green-100'}>
                  {warehouseOverviewStats.utilizationStatus}
                </Badge>
              </div>
              <CardDescription>
                {warehouseOverviewStats.usedCapacity.toLocaleString()} / {warehouseOverviewStats.totalCapacity.toLocaleString()} units used
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-xl border bg-gradient-to-br from-slate-50 via-white to-blue-50/40 p-4 shadow-sm">
                  <p className="mb-2 text-sm font-medium text-gray-600">Used vs Free Capacity</p>
                  <ChartContainer
                    config={{ used: { label: 'Used', color: '#3b82f6' }, free: { label: 'Free', color: '#34d399' } }}
                    className="h-[260px] w-full"
                  >
                    <PieChart>
                      <Pie
                        data={warehouseOverviewStats.capacityBreakdown}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={68}
                        outerRadius={100}
                        paddingAngle={2}
                        strokeWidth={3}
                      >
                        {warehouseOverviewStats.capacityBreakdown.map((entry: any) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                        <RechartsLabel
                          content={({ viewBox }) => {
                            if (!viewBox || !('cx' in viewBox) || !('cy' in viewBox)) return null
                            const cx = typeof viewBox.cx === 'number' ? viewBox.cx : 0
                            const cy = typeof viewBox.cy === 'number' ? viewBox.cy : 0
                            return (
                              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                                <tspan x={cx} y={cy - 4} className="fill-slate-900 text-2xl font-bold">
                                  {warehouseOverviewStats.usagePercent}%
                                </tspan>
                                <tspan x={cx} y={cy + 16} className="fill-slate-500 text-xs">
                                  Used
                                </tspan>
                              </text>
                            )
                          }}
                        />
                      </Pie>
                      <Tooltip formatter={(value: any, name: any) => [Number(value).toLocaleString(), name]} />
                    </PieChart>
                  </ChartContainer>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm items-start content-start auto-rows-min self-start">
                  <div className="rounded-xl border bg-white p-3 shadow-sm h-fit self-start">
                    <p className="text-gray-500">Used</p>
                    <p className="text-lg font-semibold text-blue-700">{warehouseOverviewStats.usagePercent}%</p>
                  </div>
                  <div className="rounded-xl border bg-white p-3 shadow-sm h-fit self-start">
                    <p className="text-gray-500">Free Capacity</p>
                    <p className="text-lg font-semibold text-green-700">{warehouseOverviewStats.availableCapacity.toLocaleString()}</p>
                  </div>
                  <div className="rounded-xl border bg-white p-3 shadow-sm h-fit self-start">
                    <p className="text-gray-500">Max Capacity</p>
                    <p className="text-lg font-semibold">{warehouseOverviewStats.totalCapacity.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Capacity Trend (Last 7 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{ utilization: { label: 'Utilization', color: '#2563eb' } }}
                  className="h-[300px] w-full"
                >
                  <LineChart data={warehouseOverviewStats.utilizationTrend} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="day" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} width={34} domain={[0, 100]} />
                    <Tooltip formatter={(value) => [`${value}%`, 'Utilization']} />
                    <Line type="monotone" dataKey="utilization" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Recent Activities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {warehouseOverviewStats.recentActivities.map((activity: any) => (
                    <div key={activity.id} className="rounded-lg border bg-gradient-to-br from-white to-gray-50 px-3 py-3 shadow-sm">
                      <p className="text-sm font-semibold text-gray-900">{activity.title}</p>
                      <p className="text-sm text-gray-600">{activity.detail}</p>
                      <p className="mt-1 text-xs text-gray-500">{activity.time}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">SKU Velocity Chart</CardTitle>
                <CardDescription>Top 10 fastest-moving items for replenishment planning.</CardDescription>
              </CardHeader>
              <CardContent>
                {warehouseOverviewStats.skuVelocityData.length === 0 ? (
                  <p className="text-sm text-gray-500">No SKU velocity data available.</p>
                ) : (
                  <ChartContainer
                    config={{ velocity: { label: 'Velocity', color: '#2563eb' } }}
                    className="h-[320px] w-full"
                  >
                    <BarChart data={warehouseOverviewStats.skuVelocityData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="sku" axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={65} />
                      <YAxis axisLine={false} tickLine={false} width={34} />
                      <Tooltip
                        formatter={(value) => [value, 'Velocity Score']}
                        labelFormatter={(label) => {
                          const item = warehouseOverviewStats.skuVelocityData.find((row: any) => row.sku === label)
                          return `${label} - ${item?.name || ''}`
                        }}
                      />
                      <Bar dataKey="velocity" radius={[6, 6, 0, 0]} fill="#2563eb" />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Stock Health Distribution</CardTitle>
                <CardDescription>Healthy, low, critical, and overstocked SKU split.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{
                    healthy: { label: 'Healthy', color: '#10b981' },
                    low: { label: 'Low', color: '#f59e0b' },
                    critical: { label: 'Critical', color: '#ef4444' },
                    overstocked: { label: 'Overstocked', color: '#3b82f6' },
                  }}
                  className="h-[260px] w-full"
                >
                  <PieChart>
                    <Pie
                      data={warehouseOverviewStats.stockHealthDistribution}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={56}
                      outerRadius={92}
                      paddingAngle={2}
                    >
                      {warehouseOverviewStats.stockHealthDistribution.map((entry: any) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any, name: any) => [Number(value).toLocaleString(), name]} />
                  </PieChart>
                </ChartContainer>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {warehouseOverviewStats.stockHealthDistribution.map((entry: any) => (
                    <div key={entry.name} className="rounded-md border bg-gray-50 px-2 py-1.5 text-xs">
                      <span className={`inline-block h-2 w-2 rounded-full mr-2 ${getStockHealthDotClass(entry.name)}`} />
                      <span className="text-gray-600">{entry.name}</span>
                      <span className="float-right font-semibold text-gray-900">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Warehouse Happenings</CardTitle>
              <CardDescription>Quick operational signals inside this warehouse.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {warehouseOverviewStats.activities.map((activity: any) => (
                  <div key={activity.id} className="rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    <p className="text-sm font-medium text-gray-900">{activity.label}</p>
                    <p className="text-sm text-gray-600">{activity.detail}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
