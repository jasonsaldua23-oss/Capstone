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
  const [ordersForPricing, setOrdersForPricing] = useState<any[]>([])
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [isLoading, setIsLoading] = useState(true)
  const [updatingReplacementId, setUpdatingReplacementId] = useState<string | null>(null)
  const [selectedReplacement, setSelectedReplacement] = useState<any | null>(null)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

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

  const fetchOrdersForPricing = async () => {
    try {
      const response = await fetch('/api/orders?limit=500', { cache: 'no-store', credentials: 'include' })
      if (!response.ok) return
      const data = await response.json().catch(() => ({}))
      setOrdersForPricing(getCollection(data, ['orders']))
    } catch (error) {
      console.error('Failed to fetch orders for replacement pricing:', error)
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
    fetchOrdersForPricing()
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
      try {
        const firstBrace = jsonText.indexOf('{')
        if (firstBrace < 0) return {}
        let depth = 0
        let endIndex = -1
        for (let i = firstBrace; i < jsonText.length; i += 1) {
          const ch = jsonText[i]
          if (ch === '{') depth += 1
          if (ch === '}') {
            depth -= 1
            if (depth === 0) {
              endIndex = i
              break
            }
          }
        }
        if (endIndex < 0) return {}
        const objectText = jsonText.slice(firstBrace, endIndex + 1)
        const parsed = JSON.parse(objectText)
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }
  }

  const buildReplacementLines = (replacement: any, meta: any) => {
    const rawStatus = String(replacement?.status || '').trim().toUpperCase()
    const isReplacementCompleted = ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus)
    const toDisplayQty = (line: any, fallbackNumeric: number, mode: 'toReplace' | 'replaced') => {
      const unitHint = String(
        line?.productUnit ||
        line?.replacementProductUnit ||
        line?.originalProductUnit ||
        line?.unit ||
        ''
      ).trim().toLowerCase()
      const contextText = `${String(replacement?.description || '')} ${String(replacement?.reason || '')} ${String(replacement?.notes || '')}`.toLowerCase()
      const byPackText = /\bby\s*pack\b/.test(contextText)
      const byCaseText = /\bby\s*case\b/.test(contextText)
      const byBottleText = /\bby\s*bottle\b/.test(contextText)
      const qtyPerCaseMatch = contextText.match(/qty\s*\/\s*case\s*[:\-]?\s*(\d+)/i)
      const qtyPerPackMatch = contextText.match(/qty\s*\/\s*pack\s*[:\-]?\s*(\d+)/i)
      const qtyPerCase = qtyPerCaseMatch ? Number(qtyPerCaseMatch[1]) : NaN
      const qtyPerPack = qtyPerPackMatch ? Number(qtyPerPackMatch[1]) : NaN
      const isPackUnit = unitHint.includes('pack') || byPackText

      const caseLikeQty = Number(
        mode === 'toReplace'
          ? (line?.damagedCases ?? line?.quantityToReplaceCases ?? line?.replacementCases)
          : (line?.replacedCases ?? line?.quantityReplacedCases ?? line?.replacementCases)
      )
      const bottleQty = Number(
        mode === 'toReplace'
          ? (line?.damagedBottles ?? line?.quantityToReplaceBottles ?? line?.replacementBottles)
          : (line?.replacedBottles ?? line?.quantityReplacedBottles ?? line?.replacementBottles)
      )

      if (Number.isFinite(caseLikeQty) && caseLikeQty > 0) {
        return `${caseLikeQty} ${isPackUnit ? 'pack(s)' : 'case(s)'}`
      }
      if (Number.isFinite(bottleQty) && bottleQty > 0) {
        return `${bottleQty} bottle(s)`
      }

      const fallback = Math.max(0, Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0)
      if (byCaseText && Number.isFinite(qtyPerCase) && qtyPerCase > 0 && fallback > 0) {
        return `${fallback / qtyPerCase} case(s)`
      }
      if (byPackText && Number.isFinite(qtyPerPack) && qtyPerPack > 0 && fallback > 0) {
        return `${fallback / qtyPerPack} pack(s)`
      }
      if (byBottleText) {
        return `${fallback} bottle(s)`
      }
      return String(fallback)
    }

    const sourceLines = Array.isArray(replacement?.replacementLines) && replacement.replacementLines.length
      ? replacement.replacementLines
      : Array.isArray(meta?.replacementLines) && meta.replacementLines.length
        ? meta.replacementLines
        : Array.isArray(replacement?.replacementItems) && replacement.replacementItems.length
          ? replacement.replacementItems
          : Array.isArray(meta?.replacementItems) && meta.replacementItems.length
            ? meta.replacementItems
        : []
    const orderNumberKey = String(replacement?.orderNumber || replacement?.order?.orderNumber || '').trim().toUpperCase()
    const sourceOrder =
      ordersForPricing.find((order) => String(order?.orderNumber || '').trim().toUpperCase() === orderNumberKey) ||
      ordersForPricing.find((order) => String(order?.id || '') === String(replacement?.orderId || replacement?.order?.id || '')) ||
      null
    const sourceOrderItems = Array.isArray(sourceOrder?.items) ? sourceOrder.items : []
    const fallbackProductName =
      String(
        sourceOrderItems[0]?.product?.name ||
        sourceOrderItems[0]?.productName ||
        sourceOrderItems[0]?.name ||
        ''
      ).trim() || 'N/A'
    const fallbackLine = {
      originalProductName:
        replacement?.originalProductName ||
        meta?.originalProductName ||
        replacement?.order?.items?.[0]?.product?.name ||
        replacement?.order?.items?.[0]?.productName ||
        fallbackProductName ||
        'N/A',
      replacementProductName:
        replacement?.replacementProductName ||
        meta?.replacementProductName ||
        replacement?.originalProductName ||
        meta?.originalProductName ||
        replacement?.order?.items?.[0]?.product?.name ||
        replacement?.order?.items?.[0]?.productName ||
        fallbackProductName ||
        'N/A',
      quantityToReplace: replacement?.quantityToReplace ?? meta?.quantityToReplace ?? meta?.damagedQuantity ?? replacement?.replacementQuantity ?? meta?.replacementQuantity ?? 0,
      quantityReplaced: replacement?.quantityReplaced ?? meta?.quantityReplaced ?? replacement?.replacementQuantity ?? meta?.replacementQuantity ?? 0,
    }
    const lines = sourceLines.length ? sourceLines : [fallbackLine]
    return lines.map((line: any) => {
      const originalSize = String(line?.originalProductSize || replacement?.originalProductSize || meta?.originalProductSize || '').trim()
      const replacementSize = String(line?.replacementProductSize || replacement?.replacementProductSize || meta?.replacementProductSize || originalSize || '').trim()
      const originalBaseName = String(line?.originalProductName || line?.productName || fallbackLine.originalProductName || 'N/A')
      const replacementBaseName = String(line?.replacementProductName || line?.replacementProduct?.name || line?.originalProductName || fallbackLine.replacementProductName || 'N/A')
      const quantityToReplace = Number(line?.quantityToReplace ?? line?.damagedQuantity ?? fallbackLine.quantityToReplace ?? 0)
      const rawQuantityReplaced = Number(line?.quantityReplaced ?? line?.replacedQuantity ?? fallbackLine.quantityReplaced ?? 0)
      const quantityReplaced = isReplacementCompleted ? rawQuantityReplaced : 0
      return {
        originalProductName: originalSize ? `${originalBaseName} (${originalSize})` : originalBaseName,
        replacementProductName: replacementSize ? `${replacementBaseName} (${replacementSize})` : replacementBaseName,
        quantityToReplace,
        quantityReplaced,
        quantityToReplaceDisplay: toDisplayQty(line, quantityToReplace, 'toReplace'),
        quantityReplacedDisplay: isReplacementCompleted ? toDisplayQty(line, quantityReplaced, 'replaced') : '0',
      }
    })
  }

  const getReplacementQtyDisplay = (entry: any, meta: any, mode: 'toReplace' | 'replaced') => {
    const lines =
      (Array.isArray(entry?.replacementLines) && entry.replacementLines.length ? entry.replacementLines : null) ||
      (Array.isArray(meta?.replacementLines) && meta.replacementLines.length ? meta.replacementLines : null) ||
      (Array.isArray(entry?.replacementItems) && entry.replacementItems.length ? entry.replacementItems : null) ||
      (Array.isArray(meta?.replacementItems) && meta.replacementItems.length ? meta.replacementItems : null) ||
      []
    const first = lines[0] || {}
    const unitHint = String(
      first?.productUnit ||
      first?.replacementProductUnit ||
      first?.originalProductUnit ||
      first?.unit ||
      ''
    ).trim().toLowerCase()
    const contextText = `${String(entry?.description || '')} ${String(entry?.reason || '')} ${String(entry?.notes || '')}`.toLowerCase()
    const byPackText = /\bby\s*pack\b/.test(contextText)
    const byCaseText = /\bby\s*case\b/.test(contextText)
    const byBottleText = /\bby\s*bottle\b/.test(contextText)
    const qtyPerCaseMatch = contextText.match(/qty\s*\/\s*case\s*[:\-]?\s*(\d+)/i)
    const qtyPerPackMatch = contextText.match(/qty\s*\/\s*pack\s*[:\-]?\s*(\d+)/i)
    const qtyPerCase = qtyPerCaseMatch ? Number(qtyPerCaseMatch[1]) : NaN
    const qtyPerPack = qtyPerPackMatch ? Number(qtyPerPackMatch[1]) : NaN
    const isPackUnit = unitHint.includes('pack') || byPackText

    const caseQty = Number(
      mode === 'toReplace'
        ? (first?.damagedCases ?? first?.quantityToReplaceCases ?? first?.replacementCases)
        : (first?.replacedCases ?? first?.quantityReplacedCases ?? first?.replacementCases)
    )
    const bottleQty = Number(
      mode === 'toReplace'
        ? (first?.damagedBottles ?? first?.quantityToReplaceBottles ?? first?.replacementBottles)
        : (first?.replacedBottles ?? first?.quantityReplacedBottles ?? first?.replacementBottles)
    )
    if (Number.isFinite(caseQty) && caseQty > 0) return `${caseQty} ${isPackUnit ? 'pack(s)' : 'case(s)'}`
    if (Number.isFinite(bottleQty) && bottleQty > 0) return `${bottleQty} bottle(s)`

    const fallbackQty = Number(
      mode === 'toReplace'
        ? (entry?.quantityToReplace ?? meta?.quantityToReplace ?? entry?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
        : (entry?.quantityReplaced ?? meta?.quantityReplaced ?? entry?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
    )
    const fallback = Math.max(0, Number.isFinite(fallbackQty) ? fallbackQty : 0)
    if (byCaseText && Number.isFinite(qtyPerCase) && qtyPerCase > 0 && fallback > 0) return `${fallback / qtyPerCase} case(s)`
    if (byPackText && Number.isFinite(qtyPerPack) && qtyPerPack > 0 && fallback > 0) return `${fallback / qtyPerPack} pack(s)`
    if (byBottleText) return `${fallback} bottle(s)`
    return `${fallback}`
  }

  const formatIssueStatus = (item: any) => {
    const rawStatus = String(item?.status || '').toUpperCase()
    if (rawStatus === 'PENDING') return 'Pending'
    if (rawStatus === 'UNDER_REVIEW') return 'Under Review'
    if (rawStatus === 'APPROVED') return 'Approved'
    if (rawStatus === 'REJECTED') return 'Rejected'
    if (rawStatus === 'RESOLVED_ON_DELIVERY') return 'Resolved on Delivery'
    if (rawStatus === 'NEEDS_FOLLOW_UP') return 'Needs Follow-up'
    if (rawStatus === 'COMPLETED') return 'Completed'
    if (rawStatus === 'IN_PROGRESS') return 'In Progress'
    return 'Reported'
  }

  const getNormalizedIssueStatus = (item: any) => {
    const rawStatus = String(item?.status || '').toUpperCase()
    if (['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'].includes(rawStatus)) return rawStatus
    if (rawStatus === 'REQUESTED') return 'REPORTED'
    if (['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)) return 'IN_PROGRESS'
    if (rawStatus === 'PROCESSED') return 'COMPLETED'
    return rawStatus || 'REPORTED'
  }

  const updateIssueStatus = async (
    replacementId: string,
    status: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'NEEDS_FOLLOW_UP',
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
      setSelectedReplacement((prev: any) => (prev && prev.id === replacementId ? { ...prev, status } : prev))
      toast.success(`Replacement updated to ${status.replace(/_/g, ' ')}`)
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

  const replacementsBySource = useMemo(() => {
    const customerRequests: any[] = []
    const duringDelivery: any[] = []
    filteredReplacements.forEach((item) => {
      const meta = parseMeta(item?.notes)
      const mode = String(item?.replacementMode || meta?.replacementMode || '').trim().toUpperCase()
      if (mode === 'CUSTOMER_SUBMITTED') {
        customerRequests.push(item)
      } else {
        duringDelivery.push(item)
      }
    })
    return { customerRequests, duringDelivery }
  }, [filteredReplacements])

  const orderItemsByOrderNumber = useMemo(() => {
    const index = new Map<string, any[]>()
    ordersForPricing.forEach((order) => {
      const orderNumber = String(order?.orderNumber || '').trim().toUpperCase()
      if (!orderNumber) return
      const items = Array.isArray(order?.items) ? order.items : []
      index.set(orderNumber, items)
    })
    return index
  }, [ordersForPricing])

  const totalIssues = filteredReplacements.length
  const totalReplacedQty = filteredReplacements.reduce((sum, item) => {
    const meta = parseMeta(item?.notes)
    const rawStatus = String(item?.status || '').trim().toUpperCase()
    const isResolved = ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus)
    if (!isResolved) return sum
    const qty = Number(item?.quantityReplaced ?? meta?.quantityReplaced ?? item?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0)
  }, 0)
  const scheduledReplacementsCount = filteredReplacements.filter((item) => {
    const meta = parseMeta(item?.notes)
    return Boolean(
      String(item?.scheduledDeliveryDate || meta?.scheduledDeliveryDate || '').trim() ||
      String(item?.replacementOrderId || meta?.replacementOrderId || '').trim() ||
      String(item?.replacementOrderNumber || meta?.replacementOrderNumber || '').trim()
    )
  }).length
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
    return rawStatus === 'NEEDS_FOLLOW_UP'
  }).length
  const rejectedCount = filteredReplacements.filter((item) => {
    const rawStatus = String(item?.status || '').toUpperCase()
    return rawStatus === 'REJECTED'
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
              <option value="PENDING">Pending</option>
              <option value="UNDER_REVIEW">Under Review</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="RESOLVED_ON_DELIVERY">Resolved on Delivery</option>
              <option value="NEEDS_FOLLOW_UP">Needs Follow-up</option>
              <option value="COMPLETED">Completed</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="REPORTED">Reported</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
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
            <div className="rounded-xl bg-rose-50 p-2.5 text-rose-600">
              <XCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Rejected</p>
              <p className="mt-1 text-2xl font-bold leading-none">{rejectedCount}</p>
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
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex h-full items-start gap-3 p-5">
            <div className="rounded-xl bg-sky-50 p-2.5 text-sky-600">
              <Clock className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-gray-500">Scheduled Replacements</p>
              <p className="mt-1 text-2xl font-bold leading-none">{scheduledReplacementsCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>During Delivery Replacements</CardTitle>
          <CardDescription>Reported and handled while delivery is ongoing</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : replacementsBySource.duringDelivery.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-500">No during-delivery replacement cases found</p>
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
                  {replacementsBySource.duringDelivery.map((item: any) => {
                    const meta = parseMeta(item?.notes)
                    const rawStatus = String(item?.status || '').trim().toUpperCase()
                    const qtyToReplaceLabel = getReplacementQtyDisplay(item, meta, 'toReplace')
                    const replacementLines = buildReplacementLines(item, meta)
                    const orderNumberKey = String(item?.orderNumber || item?.order?.orderNumber || '').trim().toUpperCase()
                    const orderItems =
                      (Array.isArray(item?.order?.items) ? item.order.items : []).length > 0
                        ? item.order.items
                        : (orderItemsByOrderNumber.get(orderNumberKey) || [])
                    const totalLoss = replacementLines.reduce((sum, line, index) => {
                      const sourceLine =
                        (Array.isArray(item?.replacementLines) ? item.replacementLines[index] : undefined) ||
                        (Array.isArray(item?.replacementItems) ? item.replacementItems[index] : undefined) ||
                        (Array.isArray(meta?.replacementLines) ? meta.replacementLines[index] : undefined) ||
                        (Array.isArray(meta?.replacementItems) ? meta.replacementItems[index] : undefined) ||
                        {}
                      const matchedOrderItem = orderItems.find((orderItem: any) => {
                        const srcOrderItemId = String(sourceLine?.orderItemId ?? '').trim()
                        const oiId = String(orderItem?.id ?? '').trim()
                        if (srcOrderItemId && oiId && srcOrderItemId === oiId) return true

                        const srcProductId = String(
                          sourceLine?.productId ??
                          sourceLine?.originalProductId ??
                          sourceLine?.replacementProductId ??
                          ''
                        ).trim()
                        const oiProductId = String(orderItem?.product?.id ?? orderItem?.productId ?? '').trim()
                        if (srcProductId && oiProductId && srcProductId === oiProductId) return true

                        const srcName = String(line?.originalProductName ?? line?.replacementProductName ?? '').trim().toLowerCase()
                        const oiName = String(orderItem?.product?.name ?? orderItem?.name ?? '').trim().toLowerCase()
                        return Boolean(srcName && oiName && srcName === oiName)
                      })

                      const unitPrice = Number(
                        sourceLine?.unitPrice ??
                        sourceLine?.price ??
                        sourceLine?.sellingPrice ??
                        sourceLine?.replacementUnitPrice ??
                        sourceLine?.originalUnitPrice ??
                        matchedOrderItem?.unitPrice ??
                        matchedOrderItem?.price ??
                        matchedOrderItem?.product?.price ??
                        0
                      )
                      const qty = Math.max(Number(line?.quantityReplaced || 0), 0)
                      return sum + (Number.isFinite(unitPrice) ? unitPrice : 0) * qty
                    }, 0)
                    const evidenceUrls = Array.isArray(item?.damagePhotoUrls) ? item.damagePhotoUrls : []
                    const evidenceUrl = String(evidenceUrls[0] || item?.damagePhotoUrl || meta?.damagePhotoUrl || '').trim()
                    const hasEvidence = Boolean(evidenceUrl)
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
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>Qty to replace: {qtyToReplaceLabel}</span>
                          </div>
                          <p className="mt-1 text-sm font-semibold text-red-600">- Total loss: {formatPeso(totalLoss)}</p>
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
                        <td className="p-4 min-w-[220px]">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedReplacement(item)}
                          >
                            View Details
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

      <Card>
        <CardHeader>
          <CardTitle>Customer Replacement Requests</CardTitle>
          <CardDescription>Requests submitted directly by customers after delivery</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : replacementsBySource.customerRequests.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-500">No customer replacement requests found</p>
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
                  {replacementsBySource.customerRequests.map((item: any) => {
                    const meta = parseMeta(item?.notes)
                    const rawStatus = String(item?.status || '').trim().toUpperCase()
                    const qtyToReplaceLabel = getReplacementQtyDisplay(item, meta, 'toReplace')
                    const replacementLines = buildReplacementLines(item, meta)
                    const orderNumberKey = String(item?.orderNumber || item?.order?.orderNumber || '').trim().toUpperCase()
                    const orderItems =
                      (Array.isArray(item?.order?.items) ? item.order.items : []).length > 0
                        ? item.order.items
                        : (orderItemsByOrderNumber.get(orderNumberKey) || [])
                    const totalLoss = replacementLines.reduce((sum, line, index) => {
                      const sourceLine =
                        (Array.isArray(item?.replacementLines) ? item.replacementLines[index] : undefined) ||
                        (Array.isArray(item?.replacementItems) ? item.replacementItems[index] : undefined) ||
                        (Array.isArray(meta?.replacementLines) ? meta.replacementLines[index] : undefined) ||
                        (Array.isArray(meta?.replacementItems) ? meta.replacementItems[index] : undefined) ||
                        {}
                      const matchedOrderItem = orderItems.find((orderItem: any) => {
                        const srcOrderItemId = String(sourceLine?.orderItemId ?? '').trim()
                        const oiId = String(orderItem?.id ?? '').trim()
                        if (srcOrderItemId && oiId && srcOrderItemId === oiId) return true

                        const srcProductId = String(
                          sourceLine?.productId ??
                          sourceLine?.originalProductId ??
                          sourceLine?.replacementProductId ??
                          ''
                        ).trim()
                        const oiProductId = String(orderItem?.product?.id ?? orderItem?.productId ?? '').trim()
                        if (srcProductId && oiProductId && srcProductId === oiProductId) return true

                        const srcName = String(line?.originalProductName ?? line?.replacementProductName ?? '').trim().toLowerCase()
                        const oiName = String(orderItem?.product?.name ?? orderItem?.name ?? '').trim().toLowerCase()
                        return Boolean(srcName && oiName && srcName === oiName)
                      })

                      const unitPrice = Number(
                        sourceLine?.unitPrice ??
                        sourceLine?.price ??
                        sourceLine?.sellingPrice ??
                        sourceLine?.replacementUnitPrice ??
                        sourceLine?.originalUnitPrice ??
                        matchedOrderItem?.unitPrice ??
                        matchedOrderItem?.price ??
                        matchedOrderItem?.product?.price ??
                        0
                      )
                      const qty = Math.max(Number(line?.quantityReplaced || 0), 0)
                      return sum + (Number.isFinite(unitPrice) ? unitPrice : 0) * qty
                    }, 0)
                    const evidenceUrls = Array.isArray(item?.damagePhotoUrls) ? item.damagePhotoUrls : []
                    const evidenceUrl = String(evidenceUrls[0] || item?.damagePhotoUrl || meta?.damagePhotoUrl || '').trim()
                    const hasEvidence = Boolean(evidenceUrl)
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
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>Qty to replace: {qtyToReplaceLabel}</span>
                          </div>
                          <p className="mt-1 text-sm font-semibold text-red-600">- Total loss: {formatPeso(totalLoss)}</p>
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
                        <td className="p-4 min-w-[220px]">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedReplacement(item)}
                          >
                            View Details
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

      <Dialog open={!!selectedReplacement} onOpenChange={(open) => !open && setSelectedReplacement(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto p-0">
          {selectedReplacement ? (() => {
            const meta = parseMeta(selectedReplacement.notes)
            const evidenceUrls = Array.isArray(selectedReplacement.damagePhotoUrls) ? selectedReplacement.damagePhotoUrls : []
            const evidenceUrl = String(evidenceUrls[0] || selectedReplacement.damagePhotoUrl || meta?.damagePhotoUrl || '').trim()
            const replacementLines = buildReplacementLines(selectedReplacement, meta)
            const totalQtyToReplace = replacementLines.reduce((sum, line) => sum + Math.max(Number(line.quantityToReplace || 0), 0), 0)
            const totalQtyReplaced = replacementLines.reduce((sum, line) => sum + Math.max(Number(line.quantityReplaced || 0), 0), 0)
            const sourceLines =
              Array.isArray(selectedReplacement?.replacementLines) && selectedReplacement.replacementLines.length
                ? selectedReplacement.replacementLines
                : Array.isArray(selectedReplacement?.replacementItems) && selectedReplacement.replacementItems.length
                  ? selectedReplacement.replacementItems
                  : Array.isArray(meta?.replacementLines) && meta.replacementLines.length
                    ? meta.replacementLines
                    : Array.isArray(meta?.replacementItems) && meta.replacementItems.length
                      ? meta.replacementItems
                      : []
            const orderNumberKey = String(selectedReplacement?.orderNumber || selectedReplacement?.order?.orderNumber || '').trim().toUpperCase()
            const pricingOrder = ordersForPricing.find(
              (order) => String(order?.orderNumber || '').trim().toUpperCase() === orderNumberKey
            )
            const orderItems = (Array.isArray(selectedReplacement?.order?.items) && selectedReplacement.order.items.length
              ? selectedReplacement.order.items
              : Array.isArray(pricingOrder?.items)
                ? pricingOrder.items
                : []) as any[]
            const replacementLineLoss = replacementLines.map((line, index) => {
              const sourceLine = sourceLines[index] || {}
              const matchedOrderItem = orderItems.find((orderItem: any) => {
                const srcOrderItemId = String(sourceLine?.orderItemId ?? '').trim()
                const oiId = String(orderItem?.id ?? '').trim()
                if (srcOrderItemId && oiId && srcOrderItemId === oiId) return true
                const srcName = String(line?.originalProductName ?? line?.replacementProductName ?? '').trim().toLowerCase()
                const oiName = String(orderItem?.product?.name ?? '').trim().toLowerCase()
                return Boolean(srcName && oiName && srcName === oiName)
              })
              const unitPrice = Number(
                sourceLine?.unitPrice ??
                sourceLine?.price ??
                sourceLine?.sellingPrice ??
                matchedOrderItem?.unitPrice ??
                matchedOrderItem?.price ??
                matchedOrderItem?.product?.price ??
                0
              )
              const qty = Math.max(Number(line?.quantityReplaced || 0), 0)
              return (Number.isFinite(unitPrice) ? unitPrice : 0) * qty
            })
            const totalLoss = replacementLineLoss.reduce((sum, loss) => sum + Number(loss || 0), 0)
            const rawStatus = String(selectedReplacement?.status || '').toUpperCase()
            const isScheduledReplacement = Boolean(
              String(selectedReplacement?.scheduledDeliveryDate || meta?.scheduledDeliveryDate || '').trim() ||
              String(selectedReplacement?.replacementOrderId || meta?.replacementOrderId || '').trim() ||
              String(selectedReplacement?.replacementOrderNumber || meta?.replacementOrderNumber || '').trim()
            )
            const baseResolution = String(selectedReplacement.description || '').trim()
            const effectiveResolution = baseResolution || 'N/A'
            const rawMode = String(selectedReplacement.replacementMode || meta?.replacementMode || 'N/A')
            const isResolvedCase = Boolean(
              selectedReplacement?.isClosed ||
              rawStatus === 'COMPLETED' ||
              rawStatus === 'RESOLVED_ON_DELIVERY' ||
              (totalQtyToReplace > 0 && totalQtyReplaced >= totalQtyToReplace)
            )
            const details = [
              ['Replacement #', selectedReplacement.replacementNumber || 'N/A'],
              ['Order #', selectedReplacement.orderNumber || selectedReplacement.order?.orderNumber || 'N/A'],
              ['Customer', selectedReplacement.customerName || selectedReplacement.order?.customer?.name || 'N/A'],
              ['Warehouse', selectedReplacement.warehouseName || selectedReplacement.warehouseCode || selectedReplacement.order?.warehouseName || selectedReplacement.order?.warehouseCode || 'N/A'],
              ['Warehouse Location', selectedReplacement.warehouseCity || selectedReplacement.warehouseProvince || selectedReplacement.order?.warehouseCity || selectedReplacement.order?.warehouseProvince || 'N/A'],
              ['Status', formatIssueStatus(selectedReplacement)],
              ['Reported', selectedReplacement.createdAt ? new Date(selectedReplacement.createdAt).toLocaleString() : 'N/A'],
              ['Reason', selectedReplacement.reason || 'N/A'],
              ['Resolution', effectiveResolution],
              ['Replacement Mode', rawMode.replace(/_/g, ' ')],
            ] as Array<[string, string]>
            return (
              <>
                <div className="space-y-4 p-6 pb-28">
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
                          <th className="px-3 py-2 text-left font-medium">Total Loss</th>
                        </tr>
                      </thead>
                      <tbody>
                        {replacementLines.map((line, index) => (
                          <tr key={`${line.originalProductName}-${index}`} className="border-t first:border-t-0">
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.originalProductName}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.replacementProductName}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.quantityToReplaceDisplay ?? line.quantityToReplace}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.quantityReplacedDisplay ?? line.quantityReplaced}</td>
                            <td className="px-3 py-2 font-semibold text-red-600">- {formatPeso(replacementLineLoss[index] || 0)}</td>
                          </tr>
                        ))}
                        <tr className="border-t bg-slate-50">
                          <td className="px-3 py-2 font-semibold text-slate-700" colSpan={4}>Total Loss</td>
                          <td className="px-3 py-2 font-bold text-red-600">- {formatPeso(totalLoss)}</td>
                        </tr>
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
                </div>
                <div className="sticky bottom-0 left-0 right-0 border-t bg-slate-50/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-slate-50/85">
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {rawStatus === 'UNDER_REVIEW' ? (
                        <>
                          <Button
                            size="sm"
                            className="bg-emerald-600 text-white hover:bg-emerald-700"
                            onClick={() => updateIssueStatus(selectedReplacement.id, 'APPROVED', {
                              notes: 'Replacement approved for processing',
                            })}
                            disabled={updatingReplacementId === selectedReplacement.id}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setRejectReason('')
                              setRejectDialogOpen(true)
                            }}
                            disabled={updatingReplacementId === selectedReplacement.id}
                          >
                            Reject
                          </Button>
                        </>
                      ) : !isScheduledReplacement && rawStatus !== 'APPROVED' && rawStatus !== 'REJECTED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-blue-200 text-blue-700 hover:bg-blue-50"
                          onClick={() => updateIssueStatus(selectedReplacement.id, 'UNDER_REVIEW', { notes: 'Replacement is being evaluated by staff' })}
                          disabled={updatingReplacementId === selectedReplacement.id}
                        >
                          Under Review
                        </Button>
                      ) : isScheduledReplacement ? (
                        <p className="text-sm text-blue-700">Scheduled replacement is already queued for trip planning.</p>
                      ) : (
                        <p className="text-sm text-slate-500">This replacement is already finalized.</p>
                      )}
                      {updatingReplacementId === selectedReplacement.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                      ) : null}
                    </div>
                  </div>
                </div>
              </>
            )
          })() : null}
        </DialogContent>
      </Dialog>
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Replacement Request</DialogTitle>
            <DialogDescription>
              Provide a clear reason for rejection. This will be saved in the replacement record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-sm font-medium text-slate-700">Rejection reason</label>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={4}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              placeholder="Enter rejection reason..."
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setRejectDialogOpen(false)}
                disabled={Boolean(selectedReplacement?.id && updatingReplacementId === selectedReplacement.id)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (!selectedReplacement?.id) return
                  const reason = rejectReason.trim()
                  if (!reason) {
                    toast.error('Rejection reason is required')
                    return
                  }
                  setRejectDialogOpen(false)
                  void updateIssueStatus(selectedReplacement.id, 'REJECTED', { notes: reason })
                }}
                disabled={Boolean(selectedReplacement?.id && updatingReplacementId === selectedReplacement.id)}
              >
                Confirm Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
