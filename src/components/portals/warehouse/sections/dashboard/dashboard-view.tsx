'use client'

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Boxes, Loader2, Warehouse } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ChartContainer } from '@/components/ui/chart'
import type { WarehouseDashboardViewProps } from '../shared/types'

export function WarehouseDashboardView({
  assignedWarehouse,
  scopedInventory,
  lowStockCount,
  warehouseOrdersChartConfig,
  weeklyTrendData,
  formatPeso,
  weekIncome,
  incomeOverviewData,
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
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Warehouse Dashboard</h1>
        <p className="text-gray-500">Warehouse operations and stock health overview</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
              <Warehouse className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Assigned Warehouse</p>
              <p className="mt-1 text-3xl font-bold leading-none">{assignedWarehouse ? 1 : 0}</p>
              <p className="mt-1 text-xs text-gray-500 truncate">
                {assignedWarehouse ? `${assignedWarehouse.name} (${assignedWarehouse.code})` : 'No warehouse assigned'}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
              <Boxes className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Inventory Items</p>
              <p className="mt-1 text-3xl font-bold leading-none">{scopedInventory.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-rose-50 p-2.5 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-500">Low Stock</p>
              <p className="mt-1 text-3xl font-bold leading-none text-red-600">{lowStockCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Orders This Week vs Last Week</CardTitle>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">Month</span>
                <span className="rounded-md border border-blue-400 px-2 py-0.5 text-blue-600">Week</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ChartContainer config={warehouseOrdersChartConfig} className="h-[320px] w-full">
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

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>This Week Statistics</CardDescription>
            <CardTitle className="text-3xl">{formatPeso(weekIncome)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] flex items-end gap-3">
              {(() => {
                const max = Math.max(...incomeOverviewData.map((d) => Number(d.value) || 0), 1)
                return incomeOverviewData.map((item) => {
                  const percent = Math.max(0, Math.min(100, ((Number(item.value) || 0) / max) * 100))
                  return (
                    <div key={item.day} className="flex-1 flex flex-col items-center gap-2">
                      <div className="flex-1 w-full rounded-t-md bg-cyan-100/50 relative min-h-[4px] overflow-hidden">
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

      <Card>
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
