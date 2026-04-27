'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'

function getCollection<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>

  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[]
  }

  if (Array.isArray(record.data)) return record.data as T[]
  return []
}

export function StocksView() {
  const [stockBatches, setStockBatches] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('all')
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchStockBatches() {
      try {
        const response = await fetch('/api/stock-batches?page=1&pageSize=200')
        if (!response.ok) throw new Error('Failed stock batch fetch')
        const data = await response.json()
        setStockBatches(getCollection<any>(data, ['stockBatches']))
      } catch (error) {
        console.error(error)
      } finally {
        setIsLoading(false)
      }
    }
    async function fetchWarehouses() {
      try {
        const response = await fetch('/api/warehouses?page=1&pageSize=200', { cache: 'no-store', credentials: 'include' })
        if (!response.ok) return
        const data = await response.json().catch(() => ({}))
        const list = getCollection<any>(data, ['warehouses'])
        setWarehouses(list)
        if (selectedWarehouseId !== 'all' && !list.some((warehouse) => warehouse?.id === selectedWarehouseId)) {
          setSelectedWarehouseId('all')
        }
      } catch (error) {
        console.error('Failed to fetch warehouses for stocks filter:', error)
      }
    }
    fetchStockBatches()
    fetchWarehouses()
  }, [])

  const filteredStockBatches = useMemo(() => {
    if (selectedWarehouseId === 'all') return stockBatches
    return stockBatches.filter((batch) => String(batch?.inventory?.warehouse?.id || '').trim() === selectedWarehouseId)
  }, [selectedWarehouseId, stockBatches])

  const getDaysLeft = (expiryDate: string | null) => {
    if (!expiryDate) return null
    const end = new Date(expiryDate).getTime()
    const start = new Date().getTime()
    return Math.ceil((end - start) / (1000 * 60 * 60 * 24))
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Stocks</CardTitle>
            <CardDescription>Batch-based stock-in records with receipt date, expiry date, and days left.</CardDescription>
          </div>
          <div className="w-full sm:w-64">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedWarehouseId}
              onChange={(event) => setSelectedWarehouseId(event.target.value)}
              title="Filter by warehouse"
            >
              <option value="all">All Warehouses</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name || warehouse.code || warehouse.id}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="h-40 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : filteredStockBatches.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-gray-500">No stock-in batches found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left p-4 font-medium text-gray-600">Batch #</th>
                  <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                  <th className="text-left p-4 font-medium text-gray-600">Product</th>
                  <th className="text-left p-4 font-medium text-gray-600">Qty</th>
                  <th className="text-left p-4 font-medium text-gray-600">Receipt Date</th>
                  <th className="text-left p-4 font-medium text-gray-600">Expiry Date</th>
                  <th className="text-left p-4 font-medium text-gray-600">Days Left</th>
                  <th className="text-left p-4 font-medium text-gray-600">Status</th>
                  <th className="text-left p-4 font-medium text-gray-600">Location</th>
                </tr>
              </thead>
              <tbody>
                {filteredStockBatches.map((batch) => {
                  const daysLeft = getDaysLeft(batch.expiryDate)
                  const expiringSoon = typeof daysLeft === 'number' && daysLeft >= 0 && daysLeft <= 14
                  const expired = typeof daysLeft === 'number' && daysLeft < 0
                  return (
                    <tr key={batch.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-4 font-medium text-gray-900">{batch.batchNumber}</td>
                      <td className="p-4">{batch.inventory?.product?.sku || 'N/A'}</td>
                      <td className="p-4">{batch.inventory?.product?.name || 'N/A'}</td>
                      <td className="p-4 font-semibold">{batch.quantity}</td>
                      <td className="p-4">{new Date(batch.receiptDate).toLocaleDateString()}</td>
                      <td className="p-4">{batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : 'N/A'}</td>
                      <td className={`p-4 font-semibold ${expired ? 'text-red-600' : expiringSoon ? 'text-orange-600' : 'text-green-600'}`}>
                        {typeof daysLeft === 'number' ? `${Math.max(daysLeft, 0)} days` : 'N/A'}
                      </td>
                      <td className="p-4">
                        {expired && <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Expired</Badge>}
                        {!expired && expiringSoon && <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">Expiring Soon</Badge>}
                        {!expired && !expiringSoon && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>}
                      </td>
                      <td className="p-4 text-gray-600">
                        {batch.inventory?.warehouse?.code || batch.inventory?.warehouse?.name || batch.locationLabel || 'N/A'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
