'use client'

import { CircleCheck, Eye, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { WarehouseOrdersViewProps } from '../shared/types'

export function WarehouseOrdersView({
  loadingOrders,
  scopedOrders,
  orderStatusFilter,
  setOrderStatusFilter,
  orderStatusOptions,
  orderDatePreset,
  setOrderDatePreset,
  orderCustomDateFilter,
  setOrderCustomDateFilter,
  orderMinPriceFilter,
  setOrderMinPriceFilter,
  orderMaxPriceFilter,
  setOrderMaxPriceFilter,
  filteredOrders,
  formatPeso,
  formatWarehouseOrderStatus,
  openOrderDetail,
  updateWarehouseOrderStatus,
  updatingOrderId,
}: WarehouseOrdersViewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
        <CardDescription>Order records relevant to warehouse operations.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {loadingOrders ? (
          <div className="h-40 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          </div>
        ) : scopedOrders.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-gray-500">No orders found</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 border-b bg-gray-50/70 p-3 md:grid-cols-6">
              <select
                aria-label="Filter orders by status"
                value={orderStatusFilter}
                onChange={(event) => setOrderStatusFilter(event.target.value)}
                className="h-9 rounded-md border border-input bg-white px-3 text-sm"
              >
                <option value="all">All statuses</option>
                {orderStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter orders by date range"
                value={orderDatePreset}
                onChange={(event) => setOrderDatePreset(event.target.value)}
                className="h-9 rounded-md border border-input bg-white px-3 text-sm"
              >
                <option value="all">All dates</option>
                <option value="past_7_days">Past 7 days</option>
                <option value="past_14_days">Past 14 days</option>
                <option value="past_1_month">Past 1 month</option>
                <option value="past_3_months">Past 3 months</option>
                <option value="past_6_months">Past 6 months</option>
                <option value="past_1_year">Past 1 year</option>
                <option value="custom">Custom date</option>
              </select>
              <Input
                type="date"
                value={orderCustomDateFilter}
                onChange={(event) => setOrderCustomDateFilter(event.target.value)}
                className="h-9"
                disabled={orderDatePreset !== 'custom'}
              />
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Min price"
                value={orderMinPriceFilter}
                onChange={(event) => setOrderMinPriceFilter(event.target.value)}
                className="h-9"
              />
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Max price"
                value={orderMaxPriceFilter}
                onChange={(event) => setOrderMaxPriceFilter(event.target.value)}
                className="h-9"
              />
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => {
                  setOrderStatusFilter('all')
                  setOrderDatePreset('all')
                  setOrderCustomDateFilter('')
                  setOrderMinPriceFilter('')
                  setOrderMaxPriceFilter('')
                }}
              >
                Reset Filters
              </Button>
            </div>
            {filteredOrders.length === 0 ? (
              <div className="h-24 flex items-center justify-center text-gray-500">No orders match the selected filters</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left p-4 font-medium text-gray-600">Order #</th>
                      <th className="text-left p-4 font-medium text-gray-600">Customer</th>
                      <th className="text-left p-4 font-medium text-gray-600">Date</th>
                      <th className="text-left p-4 font-medium text-gray-600">Total</th>
                      <th className="text-left p-4 font-medium text-gray-600">Status</th>
                      <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((order) => (
                      <tr key={order.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-4 font-medium">{order.orderNumber}</td>
                        <td className="p-4">{order.customer?.name || 'N/A'}</td>
                        <td className="p-4">
                          {new Date(order.deliveryDate || order.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-4 font-semibold">{formatPeso(order.totalAmount || 0)}</td>
                        <td className="p-4">
                          <Badge>{formatWarehouseOrderStatus(order.status, order.paymentStatus, order.warehouseStage)}</Badge>
                        </td>
                        <td className="p-4">
                          {(() => {
                            const orderStatus = String(order.status || '').toUpperCase()
                            const isPendingApproval = String(order.paymentStatus || '').toLowerCase() === 'pending_approval'
                            return (
                              <div className="flex items-center gap-3">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  onClick={() => void openOrderDetail(order)}
                                  title="View details"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                  onClick={() => updateWarehouseOrderStatus(order.id, 'PREPARING')}
                                  disabled={(!['PENDING', 'CONFIRMED'].includes(orderStatus) && !isPendingApproval) || updatingOrderId === order.id}
                                  title="Confirm Order"
                                >
                                  {updatingOrderId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleCheck className="h-4 w-4" />}
                                </Button>
                              </div>
                            )
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
