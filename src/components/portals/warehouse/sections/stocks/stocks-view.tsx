'use client'

import { Loader2, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import type { WarehouseStocksViewProps } from '../shared/types'

export function WarehouseStocksView({ loadingBatches, stockBatches, getDaysLeft, openBatchQuantityDialog }: WarehouseStocksViewProps) {
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
        <CardTitle>Stocks</CardTitle>
        <CardDescription>Batch-based stock-in records with manufactured date, expiry date, and days left.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {loadingBatches ? (
          <PortalTableSkeleton rows={4} columns={5} className="border-0 shadow-none" />
        ) : stockBatches.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-gray-500">No stock-in batches found</div>
        ) : (
          <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[1180px]">
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
                  <th className="text-left p-4 font-medium text-gray-600">Location</th>
                  <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stockBatches.map((batch) => {
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
                      <td className="p-4 text-gray-600">
                        {batch.inventory?.warehouse?.code || batch.inventory?.warehouse?.name || batch.locationLabel || 'N/A'}
                      </td>
                      <td className="p-4">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                          onClick={() => openBatchQuantityDialog(batch)}
                          title="Edit batch quantity and dates"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
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
