'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import { subscribeDataSync } from '@/lib/data-sync'
import {
  ADMIN_STOCK_BATCH_CACHE_KEY,
  PORTAL_CACHE_TTL_MS,
  invalidateInventoryStockCaches,
  isPortalCacheFresh,
  readPortalCache,
  writePortalCache,
} from '@/lib/portal-data-cache'

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
  const cacheAtRef = useRef(0)
  const refreshInFlightRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    const refreshSharedData = (showLoading = false) => {
      if (refreshInFlightRef.current) return refreshInFlightRef.current
      if (showLoading) setIsLoading(true)

      const refresh = (async () => {
        try {
          const [batchResponse, warehouseResponse] = await Promise.all([
            fetch('/api/stock-batches?page=1&pageSize=200', { cache: 'no-store', credentials: 'include' }),
            fetch('/api/warehouses?page=1&pageSize=200', { cache: 'no-store', credentials: 'include' }),
          ])
          if (!batchResponse.ok) throw new Error('Failed stock batch fetch')

          const [batchData, warehouseData] = await Promise.all([
            batchResponse.json().catch(() => ({})),
            warehouseResponse.ok ? warehouseResponse.json().catch(() => ({})) : Promise.resolve({}),
          ])
          const nextStockBatches = getCollection<any>(batchData, ['stockBatches'])
          const nextWarehouses = getCollection<any>(warehouseData, ['warehouses'])
          setStockBatches(nextStockBatches)
          setWarehouses(nextWarehouses)
          setSelectedWarehouseId((current) =>
            current !== 'all' && !nextWarehouses.some((warehouse) => warehouse?.id === current) ? 'all' : current
          )
          // Cache batches and their warehouse labels as one consistent Stocks snapshot.
          writePortalCache(ADMIN_STOCK_BATCH_CACHE_KEY, {
            stockBatches: nextStockBatches,
            warehouses: nextWarehouses,
          })
          cacheAtRef.current = Date.now()
        } catch (error) {
          console.error(error)
        } finally {
          if (showLoading) setIsLoading(false)
        }
      })().finally(() => {
        refreshInFlightRef.current = null
      })
      refreshInFlightRef.current = refresh
      return refresh
    }

    const cached = readPortalCache<{ stockBatches: any[]; warehouses: any[] }>(ADMIN_STOCK_BATCH_CACHE_KEY)
    if (cached) {
      setStockBatches(Array.isArray(cached.data.stockBatches) ? cached.data.stockBatches : [])
      setWarehouses(Array.isArray(cached.data.warehouses) ? cached.data.warehouses : [])
      setIsLoading(false)
      cacheAtRef.current = cached.cachedAt
    }
    if (!isPortalCacheFresh(cached)) {
      void refreshSharedData(!cached)
    }

    const unsubscribe = subscribeDataSync((message) => {
      if (message.scopes.some((scope) => ['inventory', 'stock-batches', 'products', 'warehouses'].includes(scope))) {
        invalidateInventoryStockCaches()
        void refreshSharedData(false)
      }
    })

    const refreshIfStale = () => {
      if (Date.now() - cacheAtRef.current >= PORTAL_CACHE_TTL_MS) {
        void refreshSharedData(false)
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshIfStale()
    }
    window.addEventListener('focus', refreshIfStale)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      unsubscribe()
      window.removeEventListener('focus', refreshIfStale)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const filteredStockBatches = useMemo(() => {
    return stockBatches
  }, [stockBatches])

  const getDaysLeft = (expiryDate: string | null) => {
    if (!expiryDate) return null
    const end = new Date(expiryDate).getTime()
    const start = new Date().getTime()
    return Math.ceil((end - start) / (1000 * 60 * 60 * 24))
  }

  const getBatchSizeLabel = (batch: any) => {
    const productSizes = Array.isArray(batch?.inventory?.product?.sizes)
      ? batch.inventory.product.sizes
      : []
    const sizes = productSizes
      .map((value: any) => String(value || '').trim())
      .filter(Boolean)
    if (sizes.length > 0) return sizes.join(', ')
    const fallback = String(
      batch?.inventory?.product?.size ||
      batch?.inventory?.product?.sizeLabel ||
      batch?.inventory?.product?.unit ||
      ''
    ).trim()
    return fallback || 'N/A'
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Stocks</CardTitle>
            <CardDescription>Batch-based stock-in records with manufactured date, expiry date, and days left.</CardDescription>
          </div>
          <div className="w-full sm:w-64">
            <div className="flex h-10 items-center rounded-md border border-input bg-slate-50 px-3 text-sm text-slate-600">
              Warehouse: {warehouses[0]?.name || warehouses[0]?.code || 'Not registered'}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <PortalTableSkeleton rows={4} columns={5} className="border-0 shadow-none" />
        ) : filteredStockBatches.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-gray-500">No stock-in batches found</div>
        ) : (
          <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[920px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left p-4 font-medium text-gray-600">Batch #</th>
                  <th className="text-left p-4 font-medium text-gray-600">SKU</th>
                  <th className="text-left p-4 font-medium text-gray-600">Product</th>
                  <th className="text-left p-4 font-medium text-gray-600">Size</th>
                  <th className="text-left p-4 font-medium text-gray-600">Qty</th>
                  <th className="text-left p-4 font-medium text-gray-600">Manufactured Date</th>
                  <th className="text-left p-4 font-medium text-gray-600">Expiry Date</th>
                  <th className="text-left p-4 font-medium text-gray-600">Days Left</th>
                  <th className="text-left p-4 font-medium text-gray-600">Status</th>
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
                      <td className="p-4">{getBatchSizeLabel(batch)}</td>
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
