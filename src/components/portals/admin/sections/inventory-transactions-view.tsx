'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { formatLooseQuantity, getBeverageCategorySpec } from '@/lib/beverage-category-specs'
import { safeFetchJson } from './shared'
import {
  ArrowDown,
  ArrowUp,
  Eye,
  Search,
  Calendar,
  Loader2,
  Package,
  Building2,
  Clock,
  Hash,
  FileText,
} from 'lucide-react'

function formatDateTime(value: unknown): string {
  if (!value) return ''
  const date = new Date(String(value))
  if (isNaN(date.getTime())) return ''
  return date.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(value: unknown): string {
  if (!value) return ''
  const date = new Date(String(value))
  if (isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface TransactionRow {
  id: string
  stockType: string
  type: string
  quantity: number
  quantityUnit?: 'CASE' | 'BASE_UNIT'
  baseUnitQuantity?: number
  stockUnitLabel?: string
  mixedCase?: { orderItemId?: string; componentId?: string; caseCapacity?: number; caseCount?: number; orderNumber?: string } | null
  previousStock: number
  updatedStock: number
  productName: string
  productCategory: string | null
  productSku: string | null
  warehouseName: string | null
  warehouseCode: string | null
  notes: string | null
  createdAt: string
  referenceType: string | null
  referenceId: string | null
  product?: {
    name?: string
    sku?: string
    category?: string
    sizes?: string[] | string | null
    size?: string | null
    packagingProfile?: { containerSize?: string; name?: string } | null
  }
  warehouse?: { name?: string; code?: string }
}

function getProductSizeString(tx: TransactionRow): string {
  const p = tx.product
  if (!p) return ''
  if (Array.isArray(p.sizes) && p.sizes.length > 0) {
    const validSizes = p.sizes.map((s) => String(s || '').trim()).filter(Boolean)
    if (validSizes.length > 0) return validSizes.join(', ')
  }
  if (typeof p.sizes === 'string' && p.sizes.trim()) {
    try {
      const parsed = JSON.parse(p.sizes)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validSizes = parsed.map((s) => String(s || '').trim()).filter(Boolean)
        if (validSizes.length > 0) return validSizes.join(', ')
      }
    } catch {
      return p.sizes.trim()
    }
  }
  if (p.size && typeof p.size === 'string' && p.size.trim()) {
    return p.size.trim()
  }
  if (p.packagingProfile?.containerSize && typeof p.packagingProfile.containerSize === 'string' && p.packagingProfile.containerSize.trim()) {
    return p.packagingProfile.containerSize.trim()
  }
  return ''
}

function formatProductNameWithSize(tx: TransactionRow): string {
  const baseName = String(tx.productName || tx.product?.name || '').trim()
  if (!baseName) return 'N/A'
  const size = getProductSizeString(tx)
  if (!size) return baseName
  const cleanSize = size.replace(/^\((.*)\)$/, '$1').trim()
  const escapeRegex = (val: string) => val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const trailingPattern = new RegExp(`\\s*\\(?${escapeRegex(cleanSize)}\\)?\\s*$`, 'i')
  if (trailingPattern.test(baseName)) {
    return baseName
  }
  return `${baseName} (${cleanSize})`
}

function getTransactionLooseMeasurement(tx: TransactionRow): string {
  return tx.stockUnitLabel
    || getBeverageCategorySpec(tx.productCategory || tx.product?.category)?.looseUnit
    || 'Bottle'
}

function formatTransactionQuantity(tx: TransactionRow): string {
  const quantity = tx.quantityUnit === 'BASE_UNIT'
    ? (tx.baseUnitQuantity ?? tx.quantity ?? 0)
    : (tx.quantity || 0)

  if (tx.quantityUnit === 'BASE_UNIT') {
    // Use the transaction snapshot first, then derive the exact bottle/can measurement for legacy rows.
    return formatLooseQuantity(quantity, getTransactionLooseMeasurement(tx))
  }

  const measurement = tx.stockUnitLabel || 'Case'
  return `${quantity} ${quantity === 1 ? measurement : `${measurement}s`}`
}

function formatTransactionStock(stock: number | null | undefined, tx: TransactionRow): string {
  if (stock == null || isNaN(Number(stock))) return '-'
  const val = Number(stock)
  if (tx.quantityUnit === 'BASE_UNIT') {
    return formatLooseQuantity(val, getTransactionLooseMeasurement(tx))
  }
  const measurement = tx.stockUnitLabel || 'Case'
  return `${val.toLocaleString()} ${val === 1 ? measurement : `${measurement}s`}`
}

export function InventoryTransactionsView({ userRole }: { userRole?: string }) {
  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [selectedTx, setSelectedTx] = useState<TransactionRow | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN' || !userRole

  const fetchTransactions = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      if (search) params.set('search', search)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (typeFilter !== 'ALL') params.set('type', typeFilter)

      const result = await safeFetchJson(`/api/inventory-transactions?${params.toString()}`, undefined, {
        retries: 1,
        timeoutMs: 15000,
      })
      const data = result.data
      if (!result.ok) {
        throw new Error(data?.error || 'Failed to fetch transactions')
      }
      const rows = Array.isArray(data?.transactions ?? data?.data ?? data) ? (data?.transactions ?? data?.data ?? data) : []
      const stockInOutOnly = (rows as TransactionRow[]).filter((tx) => {
        // Internal loose-bottle remainders are reconciliation records, not stock-in rows for this screen.
        if (String(tx.referenceType || '').toLowerCase() === 'replacement_bottle_remainder') return false
        const t = String(tx.stockType || tx.type || '').toUpperCase()
        return ['STOCK_IN', 'IN', 'RETURN'].includes(t) || ['STOCK_OUT', 'OUT', 'RESERVE_CONSUMED'].includes(t)
      })
      setTransactions(stockInOutOnly)
      setTotal(data?.total ?? stockInOutOnly.length)
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load transaction history')
      setTransactions([])
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, search, dateFrom, dateTo, typeFilter])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions])

  const handleSearch = () => {
    setSearch(searchInput)
    setPage(1)
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const openDetails = (tx: TransactionRow) => {
    setSelectedTx(tx)
    setDetailsOpen(true)
  }

  const isIncomingType = (type: string) => ['STOCK_IN', 'IN', 'RETURN'].includes(String(type || '').toUpperCase())

  const getTypeBadge = (type: string) => {
    const normalized = (type || '').toUpperCase()
    if (isIncomingType(normalized)) {
      return (
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1 whitespace-nowrap">
          <ArrowDown className="h-3 w-3" />
          Stock In
        </Badge>
      )
    }
    if (normalized === 'STOCK_OUT' || normalized === 'OUT' || normalized === 'RESERVE_CONSUMED') {
      return (
        <Badge className="bg-red-100 text-red-700 border-red-200 gap-1 whitespace-nowrap">
          <ArrowUp className="h-3 w-3" />
          Stock Out
        </Badge>
      )
    }
    return (
      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1 whitespace-nowrap">
        <ArrowDown className="h-3 w-3" />
        Stock In
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventory Transaction History</h1>
        <p className="text-gray-500 mt-1">View all stock-in and stock-out inventory movement records.</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by transaction ID, product, staff..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="pl-9 h-9 text-sm"
              />
            </div>

            {/* Date From */}
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                className="h-9 pl-8 pr-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            {/* Date To */}
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                className="h-9 pl-8 pr-3 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            {/* Type Filter */}
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
              className="h-9 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="ALL">All Types</option>
              <option value="IN">Stock In</option>
              <option value="OUT">Stock Out</option>
            </select>

            {/* Search Button */}
            <Button
              variant="default"
              size="sm"
              className="h-9 bg-blue-600 text-white hover:bg-blue-700"
              onClick={handleSearch}
            >
              <Search className="h-3.5 w-3.5 mr-1.5" />
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Package className="h-10 w-10 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">No inventory transactions found</p>
              <p className="text-xs text-gray-400 mt-1">
                {search || dateFrom || dateTo || typeFilter !== 'ALL'
                  ? 'Try adjusting your search or filters'
                  : 'No stock movements have been recorded yet'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Transaction ID</th>
                    <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                    <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                    <th className="text-left p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    <th className="text-right p-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                    <th className="text-center p-3 text-xs font-medium text-gray-500 uppercase tracking-wider w-20">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                      <td className="p-3">
                        <span className="text-xs font-mono text-gray-600">{tx.id?.slice(0, 12)}...</span>
                      </td>
                      <td className="p-3 text-xs text-gray-600 whitespace-nowrap">
                        {formatDateTime(tx.createdAt)}
                      </td>
                      <td className="p-3">
                        {getTypeBadge(tx.stockType || tx.type)}
                      </td>
                      <td className="p-3">
                        <div className="text-sm font-medium text-gray-900">
                          {formatProductNameWithSize(tx)}
                        </div>
                        {tx.productSku && (
                          <div className="text-xs text-gray-400">{tx.productSku}</div>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                          {tx.productCategory || tx.product?.category || 'General'}
                        </span>
                      </td>
                      <td className="p-3 text-right text-sm font-semibold tabular-nums">
                        <span className={isIncomingType(tx.stockType || tx.type) ? 'text-emerald-600' : 'text-red-600'}>
                          {formatTransactionQuantity(tx)}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => openDetails(tx)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-blue-600 transition-colors"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Showing {Math.min((page - 1) * pageSize + 1, total)}-{Math.min(page * pageSize, total)} of {total}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 text-xs"
                >
                  Previous
                </Button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let pageNum: number
                  if (totalPages <= 5) {
                    pageNum = i + 1
                  } else if (page <= 3) {
                    pageNum = i + 1
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i
                  } else {
                    pageNum = page - 2 + i
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={pageNum === page ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setPage(pageNum)}
                      className={`h-8 w-8 p-0 text-xs ${pageNum === page ? 'bg-blue-600 text-white' : ''}`}
                    >
                      {pageNum}
                    </Button>
                  )
                })}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-8 text-xs"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Details Modal */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-md sm:max-w-lg w-full max-h-[85vh] overflow-y-auto rounded-2xl p-5 sm:p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-gray-900">Transaction Details</DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              Complete information for this inventory movement.
            </DialogDescription>
          </DialogHeader>

          {selectedTx && (
            <div className="space-y-4">
              {/* Type Badge */}
              <div className="flex items-center justify-between">
                <div>
                  {getTypeBadge(selectedTx.stockType || selectedTx.type)}
                </div>
                {selectedTx.referenceType && (
                  <span className="text-xs text-gray-400">
                    Ref: {selectedTx.referenceType}
                    {selectedTx.referenceId ? ` #${selectedTx.referenceId.slice(0, 10)}` : ''}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Transaction ID */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Hash className="h-3 w-3" />
                    Transaction ID
                  </div>
                  <p className="text-sm font-mono text-gray-800 break-all">{selectedTx.id}</p>
                </div>

                {/* Date */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Clock className="h-3 w-3" />
                    Date & Time
                  </div>
                  <p className="text-sm text-gray-800">{formatDateTime(selectedTx.createdAt)}</p>
                </div>

                {/* Product Name */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Package className="h-3 w-3" />
                    Product
                  </div>
                  <p className="text-sm font-medium text-gray-800">
                    {formatProductNameWithSize(selectedTx)}
                  </p>
                  {selectedTx.productSku && (
                    <p className="text-xs text-gray-400">SKU: {selectedTx.productSku}</p>
                  )}
                </div>

                {/* Category */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <FileText className="h-3 w-3" />
                    Category
                  </div>
                  <p className="text-sm text-gray-800">
                    {selectedTx.productCategory || selectedTx.product?.category || ''}
                  </p>
                </div>

                {/* Quantity Moved */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    {isIncomingType(selectedTx.stockType || selectedTx.type) ? (
                      <ArrowDown className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <ArrowUp className="h-3 w-3 text-red-500" />
                    )}
                    Quantity Moved
                  </div>
                  <p className={`text-lg font-bold ${isIncomingType(selectedTx.stockType || selectedTx.type) ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatTransactionQuantity(selectedTx)}
                  </p>
                </div>

                {/* Previous / Updated Stock */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Package className="h-3 w-3" />
                    Stock Change
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500">
                      {formatTransactionStock(selectedTx.previousStock, selectedTx)}
                    </span>
                    <span className="text-gray-300">→</span>
                    <span className="font-medium text-gray-800">
                      {formatTransactionStock(selectedTx.updatedStock, selectedTx)}
                    </span>
                  </div>
                </div>

                {/* Warehouse */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Building2 className="h-3 w-3" />
                    Warehouse
                  </div>
                  <p className="text-sm text-gray-800">
                    {selectedTx.warehouseName || selectedTx.warehouse?.name || ''}
                  </p>
                  {selectedTx.warehouseCode && (
                    <p className="text-xs text-gray-400">Code: {selectedTx.warehouseCode}</p>
                  )}
                </div>
              </div>

              {selectedTx.mixedCase ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sky-700">
                    <Package className="h-3.5 w-3.5" />
                    Mixed Case component movement
                  </div>
                  <div className="mt-2 grid gap-2 text-sm text-sky-950 sm:grid-cols-2">
                    <p><span className="font-medium">Order:</span> {selectedTx.mixedCase.orderNumber || selectedTx.referenceId || 'N/A'}</p>
                    <p className="break-all"><span className="font-medium">Order item:</span> {selectedTx.mixedCase.orderItemId || 'N/A'}</p>
                    <p><span className="font-medium">Component:</span> {formatProductNameWithSize(selectedTx)}</p>
                    <p className="break-all"><span className="font-medium">Component ID:</span> {selectedTx.mixedCase.componentId || 'N/A'}</p>
                    <p><span className="font-medium">Case capacity:</span> {selectedTx.mixedCase.caseCapacity == null ? 'N/A' : formatLooseQuantity(selectedTx.mixedCase.caseCapacity, getTransactionLooseMeasurement(selectedTx))}</p>
                    <p><span className="font-medium">Case count:</span> {selectedTx.mixedCase.caseCount ?? 'N/A'}</p>
                  </div>
                </div>
              ) : null}

              {/* Remarks / Notes */}
              {(selectedTx.notes || selectedTx.referenceType) && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                    <FileText className="h-3 w-3" />
                    Remarks
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {selectedTx.notes || selectedTx.referenceType || ''}
                  </p>
                </div>
              )}

              <div className="pt-2">
                <Button
                  variant="outline"
                  className="w-full h-9 text-sm"
                  onClick={() => setDetailsOpen(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
