'use client'

import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { emitDataSync, subscribeDataSync } from '@/lib/data-sync'
import { useAuth } from '@/app/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, Clock, CheckCircle, XCircle, MapPin, TrendingUp, UserCheck, MessageSquare, AlertTriangle, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, Database, FileText, Users, Star, Download, Pencil, Trash2 } from 'lucide-react'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { AreaChart, CartesianGrid, YAxis, XAxis, Area, LineChart, Line, Tooltip, PieChart, Pie, Cell, Label, BarChart, Bar, ResponsiveContainer, Legend } from 'recharts'
import {
  toArray,
  getCollection,
  getDefaultRouteDate,
  normalizeTripStatus,
  formatPeso,
  formatDayKey,
  toIsoDateTime,
  formatDateTime,
  formatDayLabel,
  withinRange,
  getWarehouseIdFromRow,
  formatRoleLabel,
  safeFetchJson,
} from './shared'

const LiveTrackingMap = dynamic(() => import('@/components/shared/LiveTrackingMap'), {
  ssr: false,
})

const AddressMapPicker = dynamic(
  () => import('@/components/maps/AddressMapPicker').then((mod) => mod.AddressMapPicker),
  { ssr: false }
)

export function ReplacementsView() {
  const [replacements, setReplacements] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [isLoading, setIsLoading] = useState(true)
  const [updatingReplacementId, setUpdatingReplacementId] = useState<string | null>(null)
  const [selectedReplacement, setSelectedReplacement] = useState<any | null>(null)

  const fetchReplacements = async () => {
    setIsLoading(true)
    try {
      let response = await fetch('/api/replacements?limit=200', { cache: 'no-store', credentials: 'include' })
      if (!response.ok) {
        response = await fetch('/api/orders?includeReplacements=true&includeOrders=false&includeItems=none&limit=200', { cache: 'no-store', credentials: 'include' })
      }
      if (!response.ok) return
      const data = await response.json()
      setReplacements(getCollection(data, ['replacements']))
    } catch (error) {
      console.error('Failed to fetch replacements:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchWarehouses = async () => {
    try {
      const response = await fetch('/api/warehouses?page=1&pageSize=200', { cache: 'no-store', credentials: 'include' })
      if (!response.ok) return
      const data = await response.json().catch(() => ({}))
      setWarehouses(getCollection(data, ['warehouses']))
    } catch (error) {
      console.error('Failed to fetch warehouses for replacements filter:', error)
    }
  }

  useEffect(() => {
    fetchReplacements()
    fetchWarehouses()
  }, [])

  const parseMeta = (notes: string | null | undefined) => {
    const raw = String(notes || '').trim()
    if (!raw) return {}
    const marker = 'Meta:'
    const markerIndex = raw.lastIndexOf(marker)
    if (markerIndex < 0) return {}
    const jsonText = raw.slice(markerIndex + marker.length).trim()
    if (!jsonText) return {}
    try {
      const parsed = JSON.parse(jsonText)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  const buildReplacementLines = (replacement: any, meta: any) => {
    const sourceLines = Array.isArray(replacement?.replacementLines) && replacement.replacementLines.length
      ? replacement.replacementLines
      : Array.isArray(meta?.replacementLines) && meta.replacementLines.length
        ? meta.replacementLines
        : Array.isArray(replacement?.replacementItems) && replacement.replacementItems.length
          ? replacement.replacementItems
          : Array.isArray(meta?.replacementItems) && meta.replacementItems.length
            ? meta.replacementItems
        : []
    const fallbackLine = {
      originalProductName: replacement?.originalProductName || meta?.originalProductName || 'N/A',
      replacementProductName: replacement?.replacementProductName || meta?.replacementProductName || replacement?.originalProductName || meta?.originalProductName || 'N/A',
      quantityToReplace: replacement?.quantityToReplace ?? meta?.quantityToReplace ?? meta?.damagedQuantity ?? replacement?.replacementQuantity ?? meta?.replacementQuantity ?? 0,
      quantityReplaced: replacement?.quantityReplaced ?? meta?.quantityReplaced ?? replacement?.replacementQuantity ?? meta?.replacementQuantity ?? 0,
    }
    const lines = sourceLines.length ? sourceLines : [fallbackLine]
    return lines.map((line: any) => ({
      originalProductName: String(line?.originalProductName || line?.productName || fallbackLine.originalProductName || 'N/A'),
      replacementProductName: String(line?.replacementProductName || line?.replacementProduct?.name || line?.originalProductName || fallbackLine.replacementProductName || 'N/A'),
      quantityToReplace: Number(line?.quantityToReplace ?? line?.damagedQuantity ?? fallbackLine.quantityToReplace ?? 0),
      quantityReplaced: Number(line?.quantityReplaced ?? line?.replacedQuantity ?? fallbackLine.quantityReplaced ?? 0),
    }))
  }

  const formatIssueStatus = (item: any) => {
    const rawStatus = String(item?.status || '').toUpperCase()
    if (rawStatus === 'RESOLVED_ON_DELIVERY') return 'Resolved on Delivery'
    if (rawStatus === 'NEEDS_FOLLOW_UP') return 'Needs Follow-up'
    if (rawStatus === 'COMPLETED') return 'Completed'
    if (rawStatus === 'IN_PROGRESS') return 'In Progress'
    return 'Reported'
  }

  const getNormalizedIssueStatus = (item: any) => {
    const rawStatus = String(item?.status || '').toUpperCase()
    if (rawStatus === 'REQUESTED') return 'REPORTED'
    if (['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)) return 'IN_PROGRESS'
    if (rawStatus === 'REJECTED') return 'NEEDS_FOLLOW_UP'
    if (rawStatus === 'PROCESSED') return 'COMPLETED'
    return rawStatus || 'REPORTED'
  }

  const updateIssueStatus = async (
    replacementId: string,
    status: 'COMPLETED' | 'NEEDS_FOLLOW_UP',
    options?: { notes?: string; createReplacementOrder?: boolean }
  ) => {
    setUpdatingReplacementId(replacementId)
    try {
      const response = await fetch('/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'replacement',
          replacementId: replacementId,
          status,
          notes: options?.notes,
          createReplacementOrder: options?.createReplacementOrder,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || 'Failed to update replacement')
      }

      setReplacements((prev) => prev.map((item) => (item.id === replacementId ? { ...item, status } : item)))
      toast.success(status === 'COMPLETED' ? 'Replacement marked as completed' : 'Replacement marked for follow-up')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update replacement')
    } finally {
      setUpdatingReplacementId(null)
    }
  }

  const warehouseFilteredReplacements = useMemo(() => {
    if (selectedWarehouseId === 'all') return replacements
    return replacements.filter((item) => {
      const warehouseId = String(item?.warehouseId || item?.order?.warehouseId || '').trim()
      return warehouseId === selectedWarehouseId
    })
  }, [replacements, selectedWarehouseId])

  const filteredReplacements = useMemo(() => {
    if (selectedStatus === 'all') return warehouseFilteredReplacements
    return warehouseFilteredReplacements.filter((item) => getNormalizedIssueStatus(item) === selectedStatus)
  }, [warehouseFilteredReplacements, selectedStatus])

  const totalIssues = filteredReplacements.length
  const totalReplacedQty = filteredReplacements.reduce((sum, item) => {
    const meta = parseMeta(item?.notes)
    const qty = Number(item?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0)
  }, 0)
  const resolvedOnDelivery = filteredReplacements.filter((item) => {
    const meta = parseMeta(item?.notes)
    const rawStatus = String(item?.status || '').toUpperCase()
    const normalizedStatus =
      rawStatus === 'REQUESTED'
        ? 'REPORTED'
        : ['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)
          ? 'IN_PROGRESS'
          : rawStatus === 'REJECTED'
            ? 'NEEDS_FOLLOW_UP'
            : rawStatus === 'PROCESSED'
              ? 'COMPLETED'
              : rawStatus
    return normalizedStatus === 'RESOLVED_ON_DELIVERY'
  }).length
  const needsFollowUp = filteredReplacements.filter((item) => {
    const rawStatus = String(item?.status || '').toUpperCase()
    return rawStatus === 'NEEDS_FOLLOW_UP' || rawStatus === 'REJECTED'
  }).length
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Replacements</h1>
          <p className="text-gray-500">Reverse logistics monitoring for replacement cases, evidence, and resolution status</p>
        </div>
        <div className="w-full max-w-xs">
          <div className="flex w-full gap-2">
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
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedStatus}
              onChange={(event) => setSelectedStatus(event.target.value)}
              title="Filter by status"
            >
              <option value="all">All Statuses</option>
              <option value="RESOLVED_ON_DELIVERY">Resolved on Delivery</option>
              <option value="NEEDS_FOLLOW_UP">Needs Follow-up</option>
              <option value="COMPLETED">Completed</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="REPORTED">Reported</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-blue-50 p-2.5 text-blue-600">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Total Cases</p>
              <p className="mt-1 text-2xl font-bold leading-none">{totalIssues}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Resolved on Delivery</p>
              <p className="mt-1 text-2xl font-bold leading-none">{resolvedOnDelivery}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-amber-50 p-2.5 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Needs Follow-up</p>
              <p className="mt-1 text-2xl font-bold leading-none">{needsFollowUp}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-violet-50 p-2.5 text-violet-600">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Total Replaced Qty</p>
              <p className="mt-1 text-2xl font-bold leading-none">{totalReplacedQty}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : filteredReplacements.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-500">No replacement cases found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">Replacement #</th>
                    <th className="text-left p-4 font-medium text-gray-600">Order #</th>
                    <th className="text-left p-4 font-medium text-gray-600">Customer</th>
                    <th className="text-left p-4 font-medium text-gray-600">Warehouse</th>
                    <th className="text-left p-4 font-medium text-gray-600">Replacement Details</th>
                    <th className="text-left p-4 font-medium text-gray-600">Evidence</th>
                    <th className="text-left p-4 font-medium text-gray-600">Status</th>
                    <th className="text-left p-4 font-medium text-gray-600">Reported</th>
                    <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReplacements.map((item: any) => {
                    const meta = parseMeta(item?.notes)
                    const issueReason = String(item?.description || item?.reason || 'No details provided')
                    const replacementQty = Number(item?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
                    const hasEvidence = Boolean(String(item?.damagePhotoUrl || meta?.damagePhotoUrl || '').trim())
                    const replacementMode = String(item?.replacementMode || meta?.replacementMode || '').toUpperCase()
                    const statusLabel = formatIssueStatus(item)

                    return (
                      <tr key={item.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-4 font-medium">{item.replacementNumber}</td>
                        <td className="p-4">{item.orderNumber || item.order?.orderNumber || 'N/A'}</td>
                        <td className="p-4">{item.customerName || item.order?.customer?.name || 'N/A'}</td>
                        <td className="p-4">
                          <p className="font-medium text-gray-900">{item.warehouseName || item.warehouseCode || item.order?.warehouseName || item.order?.warehouseCode || 'N/A'}</p>
                          <p className="text-sm text-gray-500">{item.warehouseCity || item.warehouseProvince || item.order?.warehouseCity || item.order?.warehouseProvince || 'N/A'}</p>
                        </td>
                        <td className="p-4">
                          <p className="text-sm text-gray-900">{issueReason}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            {replacementQty > 0 ? <span>Qty replaced: {replacementQty}</span> : null}
                          </div>
                        </td>
                        <td className="p-4">
                          <Badge variant={hasEvidence ? 'default' : 'secondary'}>
                            {hasEvidence ? 'Photo Attached' : 'No Photo'}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <Badge
                            className={
                              statusLabel === 'Needs Follow-up'
                                ? 'bg-red-100 text-red-700 hover:bg-red-100'
                                : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100'
                            }
                          >
                            {statusLabel}
                          </Badge>
                        </td>
                        <td className="p-4 text-gray-500">
                          {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-2">
                            {String(item?.status || '').toUpperCase() !== 'COMPLETED' && String(item?.status || '').toUpperCase() !== 'RESOLVED_ON_DELIVERY' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateIssueStatus(item.id, 'COMPLETED', { notes: 'Marked completed by admin' })}
                                disabled={updatingReplacementId === item.id}
                              >
                                Mark Completed
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedReplacement(item)}
                            >
                              View Details
                            </Button>
                            {updatingReplacementId === item.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                            ) : null}
                          </div>
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

      <Dialog open={!!selectedReplacement} onOpenChange={(open) => !open && setSelectedReplacement(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {selectedReplacement ? (() => {
            const meta = parseMeta(selectedReplacement.notes)
            const evidenceUrl = String(selectedReplacement.damagePhotoUrl || meta?.damagePhotoUrl || '').trim()
            const replacementLines = buildReplacementLines(selectedReplacement, meta)
            const details = [
              ['Replacement #', selectedReplacement.replacementNumber || 'N/A'],
              ['Order #', selectedReplacement.orderNumber || selectedReplacement.order?.orderNumber || 'N/A'],
              ['Customer', selectedReplacement.customerName || selectedReplacement.order?.customer?.name || 'N/A'],
              ['Warehouse', selectedReplacement.warehouseName || selectedReplacement.warehouseCode || selectedReplacement.order?.warehouseName || selectedReplacement.order?.warehouseCode || 'N/A'],
              ['Warehouse Location', selectedReplacement.warehouseCity || selectedReplacement.warehouseProvince || selectedReplacement.order?.warehouseCity || selectedReplacement.order?.warehouseProvince || 'N/A'],
              ['Status', formatIssueStatus(selectedReplacement)],
              ['Reported', selectedReplacement.createdAt ? new Date(selectedReplacement.createdAt).toLocaleString() : 'N/A'],
              ['Reason', selectedReplacement.reason || 'N/A'],
              ['Resolution', selectedReplacement.description || 'N/A'],
              ['Replacement Mode', String(selectedReplacement.replacementMode || meta?.replacementMode || 'N/A').replace(/_/g, ' ')],
            ] as Array<[string, string]>
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Replacement Details</DialogTitle>
                  <DialogDescription>Complete information for {selectedReplacement.replacementNumber || 'this replacement'}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                  {details.map(([label, value]) => (
                    <div key={label} className="rounded-md border bg-slate-50 px-3 py-2">
                      <p className="text-xs font-medium text-slate-500">{label}</p>
                      <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-md border bg-white">
                  <div className="border-b px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">Replacement Items</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Original Product</th>
                          <th className="px-3 py-2 text-left font-medium">Replacement Product</th>
                          <th className="px-3 py-2 text-left font-medium">Quantity to Replace</th>
                          <th className="px-3 py-2 text-left font-medium">Quantity Replaced</th>
                        </tr>
                      </thead>
                      <tbody>
                        {replacementLines.map((line, index) => (
                          <tr key={`${line.originalProductName}-${index}`} className="border-t first:border-t-0">
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.originalProductName}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.replacementProductName}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.quantityToReplace}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.quantityReplaced}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {evidenceUrl ? (
                  <div className="rounded-md border bg-white px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">Evidence</p>
                    <img src={evidenceUrl} alt="Replacement evidence" className="mt-2 max-h-[360px] w-full rounded-md border object-contain" />
                  </div>
                ) : null}
              </>
            )
          })() : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
