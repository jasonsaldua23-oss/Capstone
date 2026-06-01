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
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
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
import { Loader2, Truck, Menu, Bell, ChevronDown, Settings, LogOut, Clock, XCircle, MapPin, TrendingUp, UserCheck, MessageSquare, Eye, EyeOff, CircleCheck, BarChart3, ShoppingCart, Package, Archive, Building2, Database, FileText, Users, Star, Download, Pencil, Trash2 } from 'lucide-react'
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
    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const formatProductNameWithSize = (baseName: any, sizeValue: any) => {
      const normalizedBaseName = String(baseName || 'N/A').trim()
      const normalizedSize = String(sizeValue || '').trim().replace(/^\((.*)\)$/, '$1').trim()
      if (!normalizedSize) return normalizedBaseName
      const trailingSizePattern = new RegExp(`\\s*\\(?${escapeRegex(normalizedSize)}\\)?\\s*$`, 'i')
      const baseWithoutTrailingSize = normalizedBaseName.replace(trailingSizePattern, '').trim()
      return `${baseWithoutTrailingSize || normalizedBaseName} (${normalizedSize})`
    }
    const toDisplayQty = (line: any, fallbackNumeric: number, mode: 'toReplace' | 'replaced') => {
      const contextText = `${String(replacement?.description || '')} ${String(replacement?.reason || '')} ${String(replacement?.notes || '')}`.toLowerCase()
      const byBottleText = /\bby\s*bottle\b/.test(contextText)
      const qtyPerUnitMatch = contextText.match(/qty\s*\/\s*unit\s*[:\-]?\s*(\d+)/i)
      const qtyPerCaseMatch = contextText.match(/qty\s*\/\s*case\s*[:\-]?\s*(\d+)/i)
      const qtyPerPackMatch = contextText.match(/qty\s*\/\s*pack\s*[:\-]?\s*(\d+)/i)
      const qtyPerBundleMatch = contextText.match(/qty\s*\/\s*bundle\s*[:\-]?\s*(\d+)/i)
      const qtyPerUnitFromFields = Number(line?.qtyPerUnit ?? line?.quantityPerUnit ?? replacement?.qtyPerUnit ?? replacement?.quantityPerUnit ?? meta?.qtyPerUnit ?? meta?.quantityPerUnit ?? NaN)
      const qtyPerUnit = Number.isFinite(qtyPerUnitFromFields) && qtyPerUnitFromFields > 0 ? qtyPerUnitFromFields : (qtyPerUnitMatch ? Number(qtyPerUnitMatch[1]) : NaN)
      const qtyPerCaseFromFields = Number(line?.qtyPerCase ?? line?.quantityPerCase ?? replacement?.qtyPerCase ?? replacement?.quantityPerCase ?? meta?.qtyPerCase ?? meta?.quantityPerCase ?? NaN)
      const qtyPerCase = Number.isFinite(qtyPerCaseFromFields) && qtyPerCaseFromFields > 0 ? qtyPerCaseFromFields : (qtyPerCaseMatch ? Number(qtyPerCaseMatch[1]) : NaN)
      const qtyPerPack = qtyPerPackMatch ? Number(qtyPerPackMatch[1]) : NaN
      const qtyPerBundle = qtyPerBundleMatch ? Number(qtyPerBundleMatch[1]) : NaN

      // Mirror getModalQtyDisplay from warehouse portal
      if (byBottleText) {
        const bottleQty = Number(
          mode === 'toReplace'
            ? (line?.damagedBottles ?? line?.quantityToReplaceBottles ?? line?.replacementBottles ?? line?.quantityToReplace)
            : (line?.replacedBottles ?? line?.quantityReplacedBottles ?? line?.replacementBottles ?? line?.quantityReplaced)
        )
        if (Number.isFinite(bottleQty)) return `${bottleQty} bottle(s)`
        const fallback = Math.max(0, Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0)
        return fallback > 0 ? `${fallback} bottle(s)` : '0'
      }

      const directUnitQty = Number(
        mode === 'toReplace'
          ? (line?.damagedCases ?? line?.quantityToReplaceCases ?? line?.replacementCases ?? line?.unitsToReplace ?? line?.quantityToReplaceUnits)
          : (line?.replacedCases ?? line?.quantityReplacedCases ?? line?.replacementCases ?? line?.unitsReplaced ?? line?.quantityReplacedUnits)
      )
      if (Number.isFinite(directUnitQty) && directUnitQty >= 0) return `${directUnitQty} unit(s)`

      // Pick effective qtyPerUnit across all unit types
      const effectiveQtyPerUnit = Number.isFinite(qtyPerUnit) && qtyPerUnit > 0 ? qtyPerUnit
        : Number.isFinite(qtyPerCase) && qtyPerCase > 0 ? qtyPerCase
        : Number.isFinite(qtyPerPack) && qtyPerPack > 0 ? qtyPerPack
        : Number.isFinite(qtyPerBundle) && qtyPerBundle > 0 ? qtyPerBundle
        : NaN

      // Always use fallbackNumeric â€” it's the pre-computed qty (toReplace, replaced, OR remaining)
      const fallback = Math.max(0, Number.isFinite(fallbackNumeric) ? fallbackNumeric : 0)
      if (Number.isFinite(effectiveQtyPerUnit) && effectiveQtyPerUnit > 0 && fallback > 0) {
        const units = fallback / effectiveQtyPerUnit
        const unitsText = Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\.00$/, '')
        return `${unitsText} unit(s)`
      }
      return fallback > 0 ? `${fallback} unit(s)` : '0'
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
      quantityReplaced: replacement?.quantityReplaced ?? meta?.quantityReplaced ?? 0,
    }
    const lines = sourceLines.length ? sourceLines : [fallbackLine]
    return lines.map((line: any) => {
      const originalProductId = String(line?.originalProductId || line?.productId || '').trim()
      const replacementProductId = String(line?.replacementProductId || line?.productId || '').trim()
      const originalCategoryRaw = String(
        line?.originalProductCategory ||
        line?.originalCategory ||
        line?.category ||
        ''
      ).trim()
      const replacementCategoryRaw = String(
        line?.replacementProductCategory ||
        line?.replacementCategory ||
        line?.category ||
        ''
      ).trim()
      const originalSize = String(line?.originalProductSize || replacement?.originalProductSize || meta?.originalProductSize || '').trim()
      const replacementSize = String(line?.replacementProductSize || replacement?.replacementProductSize || meta?.replacementProductSize || originalSize || '').trim()
      const originalBaseName = String(line?.originalProductName || line?.productName || fallbackLine.originalProductName || 'N/A')
      const replacementBaseName = String(line?.replacementProductName || line?.replacementProduct?.name || line?.originalProductName || fallbackLine.replacementProductName || 'N/A')
      const matchedOriginalOrderItem = sourceOrderItems.find((orderItem: any) => {
        const orderItemProductId = String(orderItem?.product?.id || orderItem?.productId || '').trim()
        if (originalProductId && orderItemProductId && originalProductId === orderItemProductId) return true
        const orderItemProductName = String(orderItem?.product?.name || orderItem?.productName || '').trim().toLowerCase()
        return Boolean(orderItemProductName && orderItemProductName === originalBaseName.trim().toLowerCase())
      })
      const matchedReplacementOrderItem = sourceOrderItems.find((orderItem: any) => {
        const orderItemProductId = String(orderItem?.product?.id || orderItem?.productId || '').trim()
        if (replacementProductId && orderItemProductId && replacementProductId === orderItemProductId) return true
        const orderItemProductName = String(orderItem?.product?.name || orderItem?.productName || '').trim().toLowerCase()
        return Boolean(orderItemProductName && orderItemProductName === replacementBaseName.trim().toLowerCase())
      })
      const originalCategory = originalCategoryRaw || String(
        matchedOriginalOrderItem?.product?.category?.name ||
        matchedOriginalOrderItem?.product?.category ||
        ''
      ).trim()
      const replacementCategory = replacementCategoryRaw || String(
        matchedReplacementOrderItem?.product?.category?.name ||
        matchedReplacementOrderItem?.product?.category ||
        ''
      ).trim()
      const quantityToReplace = Number(line?.quantityToReplace ?? line?.damagedQuantity ?? fallbackLine.quantityToReplace ?? 0)
      const rawQuantityReplaced = Number(line?.quantityReplaced ?? line?.replacedQuantity ?? fallbackLine.quantityReplaced ?? 0)
      const quantityReplaced = Math.max(0, rawQuantityReplaced)
      const quantityRemaining = Math.max(0, quantityToReplace - quantityReplaced)
      return {
        originalProductName: formatProductNameWithSize(originalBaseName, originalSize),
        replacementProductName: formatProductNameWithSize(replacementBaseName, replacementSize),
        originalProductCategory: originalCategory,
        replacementProductCategory: replacementCategory,
        quantityToReplace,
        quantityReplaced,
        quantityRemaining,
        quantityToReplaceDisplay: toDisplayQty(line, quantityToReplace, 'toReplace'),
        quantityReplacedDisplay: quantityReplaced > 0 ? toDisplayQty(line, quantityReplaced, 'replaced') : '0',
        quantityRemainingDisplay: quantityRemaining > 0 ? toDisplayQty(line, quantityRemaining, 'toReplace') : '0',
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
    const byBundleText = /\bby\s*bundle\b/.test(contextText)
    const byUnitText = /\bby\s*unit\b/.test(contextText)
    const byCaseText = /\bby\s*case\b/.test(contextText)
    const byBottleText = /\bby\s*bottle\b/.test(contextText)
    const qtyPerUnitMatch = contextText.match(/qty\s*\/\s*unit\s*[:\-]?\s*(\d+)/i)
    const qtyPerCaseMatch = contextText.match(/qty\s*\/\s*case\s*[:\-]?\s*(\d+)/i)
    const qtyPerPackMatch = contextText.match(/qty\s*\/\s*pack\s*[:\-]?\s*(\d+)/i)
    const qtyPerBundleMatch = contextText.match(/qty\s*\/\s*bundle\s*[:\-]?\s*(\d+)/i)
    const qtyPerUnitFromFields = Number(first?.qtyPerUnit ?? first?.quantityPerUnit ?? entry?.qtyPerUnit ?? entry?.quantityPerUnit ?? meta?.qtyPerUnit ?? meta?.quantityPerUnit ?? NaN)
    const qtyPerUnit = Number.isFinite(qtyPerUnitFromFields) && qtyPerUnitFromFields > 0 ? qtyPerUnitFromFields : (qtyPerUnitMatch ? Number(qtyPerUnitMatch[1]) : NaN)
    const qtyPerCaseFromFields = Number(first?.qtyPerCase ?? first?.quantityPerCase ?? entry?.qtyPerCase ?? entry?.quantityPerCase ?? meta?.qtyPerCase ?? meta?.quantityPerCase ?? NaN)
    const qtyPerCase = Number.isFinite(qtyPerCaseFromFields) && qtyPerCaseFromFields > 0 ? qtyPerCaseFromFields : (qtyPerCaseMatch ? Number(qtyPerCaseMatch[1]) : NaN)
    const qtyPerPack = qtyPerPackMatch ? Number(qtyPerPackMatch[1]) : NaN
    const qtyPerBundle = qtyPerBundleMatch ? Number(qtyPerBundleMatch[1]) : NaN
    const unitLabel =
      unitHint.includes('pack') || byPackText ? 'pack(s)'
        : unitHint.includes('bundle') || byBundleText ? 'bundle(s)'
          : unitHint.includes('case') || byCaseText || byUnitText ? 'case(s)'
              : 'bottle(s)'

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
    if (Number.isFinite(caseQty) && caseQty > 0) return `${caseQty} ${unitLabel}`
    if (Number.isFinite(bottleQty) && bottleQty > 0) return `${bottleQty} bottle(s)`

    const fallbackQty = Number(
      mode === 'toReplace'
        ? (entry?.quantityToReplace ?? meta?.quantityToReplace ?? entry?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
        : (entry?.quantityReplaced ?? meta?.quantityReplaced ?? 0)
    )
    const fallback = Math.max(0, Number.isFinite(fallbackQty) ? fallbackQty : 0)
    if (byUnitText && Number.isFinite(qtyPerUnit) && qtyPerUnit > 0 && fallback > 0) return `${fallback / qtyPerUnit} ${unitLabel}`
    if (byCaseText && Number.isFinite(qtyPerCase) && qtyPerCase > 0 && fallback > 0) return `${fallback / qtyPerCase} ${unitLabel}`
    if (byPackText && Number.isFinite(qtyPerPack) && qtyPerPack > 0 && fallback > 0) return `${fallback / qtyPerPack} ${unitLabel}`
    if (byBundleText && Number.isFinite(qtyPerBundle) && qtyPerBundle > 0 && fallback > 0) return `${fallback / qtyPerBundle} ${unitLabel}`
    if (byBottleText) return `${fallback} bottle(s)`
    return fallback > 0 ? `${fallback} ${unitLabel}` : '0'
  }

  const getNormalizedQtyLineDisplay = (entry: any, meta: any, mode: 'toReplace' | 'replaced') => {
    const contextText = `${String(entry?.description || '')} ${String(entry?.reason || '')} ${String(entry?.notes || '')}`.toLowerCase()
    const isByBottle = /\bby\s*bottle\b/.test(contextText)
    if (isByBottle) return getReplacementQtyDisplay(entry, meta, mode)
    const lines =
      (Array.isArray(entry?.replacementLines) && entry.replacementLines.length ? entry.replacementLines : null) ||
      (Array.isArray(meta?.replacementLines) && meta.replacementLines.length ? meta.replacementLines : null) ||
      (Array.isArray(entry?.replacementItems) && entry.replacementItems.length ? entry.replacementItems : null) ||
      (Array.isArray(meta?.replacementItems) && meta.replacementItems.length ? meta.replacementItems : null) ||
      []
    const first = lines[0] || {}
    const rawQty = Number(
      mode === 'toReplace'
        ? (entry?.quantityToReplace ?? meta?.quantityToReplace ?? first?.quantityToReplace ?? first?.damagedQuantity ?? 0)
        : (entry?.quantityReplaced ?? meta?.quantityReplaced ?? first?.quantityReplaced ?? first?.replacedQuantity ?? 0)
    )
    const directUnits = Number(
      mode === 'toReplace'
        ? (first?.damagedCases ?? first?.quantityToReplaceCases ?? first?.unitsToReplace ?? first?.quantityToReplaceUnits)
        : (first?.replacedCases ?? first?.quantityReplacedCases ?? first?.unitsReplaced ?? first?.quantityReplacedUnits)
    )
    if (Number.isFinite(directUnits) && directUnits >= 0) return `${directUnits} unit(s)`
    const detailsText = `${String(entry?.description || '')} ${String(entry?.notes || '')} ${String(entry?.reason || '')}`
    const qtyPerGenericMatch = detailsText.match(/qty\s*\/\s*(?:unit|case|pack|bundle)\s*[:\-]?\s*(\d+)/i)
    const qtyPerText = qtyPerGenericMatch ? Number(qtyPerGenericMatch[1]) : NaN
    const qtyPerFromLine = Number(
      first?.qtyPerUnit ??
      first?.quantityPerUnit ??
      first?.quantityPerCase ??
      first?.unitsPerCase ??
      first?.bottlesPerUnit ??
      first?.bottlesPerCase ??
      entry?.qtyPerUnit ??
      entry?.quantityPerUnit ??
      entry?.quantityPerCase ??
      entry?.unitsPerCase ??
      entry?.bottlesPerUnit ??
      entry?.bottlesPerCase ??
      meta?.qtyPerUnit ??
      meta?.quantityPerUnit ??
      meta?.quantityPerCase ??
      meta?.unitsPerCase ??
      meta?.bottlesPerUnit ??
      meta?.bottlesPerCase ??
      NaN
    )
    const perUnit = Number.isFinite(qtyPerFromLine) && qtyPerFromLine > 0
      ? qtyPerFromLine
      : qtyPerText
    if (Number.isFinite(perUnit) && perUnit > 0 && Number.isFinite(rawQty) && rawQty >= 0) {
      const units = rawQty / perUnit
      const unitsText = Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\.00$/, '')
      return `${unitsText} unit(s)`
    }
    return getReplacementQtyDisplay(entry, meta, mode)
  }

  const getReplacementDetailsText = (entry: any, meta: any) => {
    const lines =
      (Array.isArray(entry?.replacementLines) && entry.replacementLines.length ? entry.replacementLines : null) ||
      (Array.isArray(meta?.replacementLines) && meta.replacementLines.length ? meta.replacementLines : null) ||
      (Array.isArray(entry?.replacementItems) && entry.replacementItems.length ? entry.replacementItems : null) ||
      (Array.isArray(meta?.replacementItems) && meta.replacementItems.length ? meta.replacementItems : null) ||
      []
    const first = lines[0] || {}
    const productName = String(
      first?.originalProductName ||
      first?.productName ||
      entry?.originalProductName ||
      meta?.originalProductName ||
      entry?.productName ||
      entry?.order?.items?.[0]?.product?.name ||
      entry?.order?.items?.[0]?.productName ||
      'Product'
    ).trim()
    const productSize = String(
      first?.originalProductSize ||
      first?.productSize ||
      entry?.originalProductSize ||
      meta?.originalProductSize ||
      entry?.productSize ||
      entry?.order?.items?.[0]?.product?.size ||
      entry?.order?.items?.[0]?.size ||
      ''
    ).trim()
    const productLabel = productSize ? `${productName} ${productSize}` : productName
    const contextText = `${String(entry?.description || '')} ${String(entry?.reason || '')} ${String(entry?.notes || '')}`.toLowerCase()
    const isByBottle = /\bby\s*bottle\b/.test(contextText)
    const qtyToReplaceLabel = getReplacementQtyDisplay(entry, meta, 'toReplace')
    const qtyPerUnitMatch = contextText.match(/qty\s*\/\s*unit\s*[:\-]?\s*(\d+)/i)
    const qtyPerUnitFromText = qtyPerUnitMatch ? Number(qtyPerUnitMatch[1]) : NaN
    const qtyPerUnitFromLine = Number(
      first?.qtyPerUnit ??
      first?.quantityPerUnit ??
      first?.quantityPerCase ??
      first?.unitsPerCase ??
      first?.bottlesPerUnit ??
      first?.bottlesPerCase ??
      entry?.qtyPerUnit ??
      entry?.quantityPerUnit ??
      entry?.quantityPerCase ??
      entry?.unitsPerCase ??
      entry?.bottlesPerUnit ??
      entry?.bottlesPerCase ??
      meta?.qtyPerUnit ??
      meta?.quantityPerUnit ??
      meta?.quantityPerCase ??
      meta?.unitsPerCase ??
      meta?.bottlesPerUnit ??
      meta?.bottlesPerCase ??
      NaN
    )
    const qtyPerUnitNumeric = Number.isFinite(qtyPerUnitFromText) && qtyPerUnitFromText > 0
      ? qtyPerUnitFromText
      : (Number.isFinite(qtyPerUnitFromLine) && qtyPerUnitFromLine > 0 ? qtyPerUnitFromLine : NaN)
    const qtyPerUnit = Number.isFinite(qtyPerUnitNumeric) ? String(qtyPerUnitNumeric) : ''
    const rawQtyToReplace = Number(
      entry?.quantityToReplace ??
      meta?.quantityToReplace ??
      entry?.damagedQuantity ??
      meta?.damagedQuantity ??
      first?.quantityToReplace ??
      first?.damagedQuantity ??
      0
    )
    const modeLabel = isByBottle ? 'By Bottle' : 'By Unit'
    let displayQty = qtyToReplaceLabel
    const directUnitQty = Number(
      first?.damagedCases ??
      first?.quantityToReplaceCases ??
      first?.replacementCases ??
      first?.unitsToReplace ??
      first?.quantityToReplaceUnits ??
      NaN
    )
    if (!isByBottle && Number.isFinite(directUnitQty) && directUnitQty > 0) {
      displayQty = `${directUnitQty} unit(s)`
    }
    if (!isByBottle && Number.isFinite(qtyPerUnitNumeric) && qtyPerUnitNumeric > 0 && Number.isFinite(rawQtyToReplace) && rawQtyToReplace > 0) {
      const units = rawQtyToReplace / qtyPerUnitNumeric
      if (Number.isFinite(units) && units > 0) {
        const unitsText = Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\.00$/, '')
        displayQty = `${unitsText} unit(s)`
      }
    }
    if (!isByBottle && (!Number.isFinite(qtyPerUnitNumeric) || qtyPerUnitNumeric <= 0) && Number.isFinite(rawQtyToReplace) && rawQtyToReplace > 0) {
      const detailsText = `${String(entry?.description || '')} ${String(entry?.notes || '')} ${String(entry?.reason || '')}`
      const qtyPerGenericMatch = detailsText.match(/qty\s*\/\s*(?:unit|case|pack|bundle)\s*[:\-]?\s*(\d+)/i)
      const genericPerUnit = qtyPerGenericMatch ? Number(qtyPerGenericMatch[1]) : NaN
      if (Number.isFinite(genericPerUnit) && genericPerUnit > 0) {
        const units = rawQtyToReplace / genericPerUnit
        if (Number.isFinite(units) && units > 0) {
          const unitsText = Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\.00$/, '')
          displayQty = `${unitsText} unit(s)`
        }
      }
    }
    const base = `${productLabel} ${modeLabel}: ${displayQty}`
    if (qtyPerUnit) return `${base}\nQty/Unit: ${qtyPerUnit}`
    return `${base}.`
  }

  const hasOutstandingReplacementQty = (entry: any, meta: any): boolean => {
    const lines = buildReplacementLines(entry, meta)
    const totalQtyToReplace = lines.reduce((sum, line) => sum + Math.max(Number(line.quantityToReplace || 0), 0), 0)
    const totalQtyReplaced = lines.reduce((sum, line) => sum + Math.max(Number(line.quantityReplaced || 0), 0), 0)
    if (totalQtyToReplace > 0) return totalQtyReplaced < totalQtyToReplace
    const qtyToReplace = Number(
      entry?.quantityToReplace ??
      meta?.quantityToReplace ??
      entry?.damagedQuantity ??
      meta?.damagedQuantity ??
      0
    )
    const qtyReplaced = Number(
      entry?.quantityReplaced ??
      meta?.quantityReplaced ??
      0
    )
    return Number.isFinite(qtyToReplace) && Number.isFinite(qtyReplaced) && qtyToReplace > qtyReplaced
  }
  const hasStrictScheduledFollowUp = (entry: any): boolean => {
    const scheduledDeliveryDate = String(entry?.scheduledDeliveryDate || '').trim()
    const replacementOrderId = String(entry?.replacementOrderId || '').trim()
    const replacementOrderNumber = String(entry?.replacementOrderNumber || '').trim()
    return Boolean(scheduledDeliveryDate || replacementOrderId || replacementOrderNumber)
  }

  const formatIssueStatus = (item: any) => {
    const meta = parseMeta(item?.notes)
    const rawStatus = String(item?.status || '').toUpperCase()
    const rawMode = String(item?.replacementMode || meta?.replacementMode || '').trim().toUpperCase()
    const hasScheduledFollowUp = hasStrictScheduledFollowUp(item)
    if (['CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(rawStatus)) return 'Cancelled'
    if (rawMode === 'CUSTOMER_SUBMITTED' && rawStatus === 'IN_PROGRESS' && hasScheduledFollowUp) {
      return 'Scheduled for Delivery'
    }
    if (rawMode === 'CUSTOMER_SUBMITTED' && rawStatus === 'IN_PROGRESS' && !hasScheduledFollowUp) {
      return 'Approved'
    }
    if (['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus) && hasOutstandingReplacementQty(item, meta)) {
      return hasScheduledFollowUp ? 'Scheduled for Delivery' : 'Needs Follow-up'
    }
    if (rawStatus === 'PENDING') return 'Pending'
    if (rawStatus === 'UNDER_REVIEW') return 'Under Review'
    if (rawStatus === 'APPROVED') return 'Approved'
    if (rawStatus === 'REJECTED') return 'Rejected'
    if (rawStatus === 'RESOLVED_ON_DELIVERY') return 'Completed'
    if (rawStatus === 'NEEDS_FOLLOW_UP') return 'Needs Follow-up'
    if (rawStatus === 'COMPLETED') return 'Completed'
    if (rawStatus === 'IN_PROGRESS') return 'In Progress'
    return 'Reported'
  }

  const getNormalizedIssueStatus = (item: any) => {
    const meta = parseMeta(item?.notes)
    const rawStatus = String(item?.status || '').toUpperCase()
    if (['CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(rawStatus)) return 'CANCELLED'
    if (['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus) && hasOutstandingReplacementQty(item, meta)) {
      return 'NEEDS_FOLLOW_UP'
    }
    if (['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'].includes(rawStatus)) return rawStatus
    if (rawStatus === 'REQUESTED') return 'REPORTED'
    if (['APPROVED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED'].includes(rawStatus)) return 'IN_PROGRESS'
    if (rawStatus === 'PROCESSED') return 'COMPLETED'
    return rawStatus || 'REPORTED'
  }

  const collectEvidenceUrls = (entry: any, meta: any): string[] => {
    const urlsFromArray = Array.isArray(entry?.damagePhotoUrls) ? entry.damagePhotoUrls : []
    const fallbackSingle = [entry?.damagePhotoUrl, meta?.damagePhotoUrl]
    return [...urlsFromArray, ...fallbackSingle]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
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
    filteredReplacements.forEach((item) => {
      customerRequests.push(item)
    })
    return { customerRequests }
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

  const getReplacementLinesForKpi = (item: any, meta: any) =>
    (Array.isArray(item?.replacementLines) && item.replacementLines.length ? item.replacementLines : null) ||
    (Array.isArray(meta?.replacementLines) && meta.replacementLines.length ? meta.replacementLines : null) ||
    (Array.isArray(item?.replacementItems) && item.replacementItems.length ? item.replacementItems : null) ||
    (Array.isArray(meta?.replacementItems) && meta.replacementItems.length ? meta.replacementItems : null) ||
    []

  const getCanonicalReplacedQtyForKpi = (item: any, meta: any): number => {
    const qty = Number(
      item?.replacementQuantity ??
      meta?.replacementQuantity ??
      item?.quantityReplaced ??
      meta?.quantityReplaced ??
      0
    )
    return Number.isFinite(qty) && qty > 0 ? qty : 0
  }

  const getUnitReplacedQtyForKpi = (item: any, meta: any): number => {
    const lines = getReplacementLinesForKpi(item, meta)
    const firstLine = lines[0] || {}
    const directUnitQty = Number(
      firstLine?.replacedCases ??
      firstLine?.quantityReplacedCases ??
      firstLine?.replacementCases ??
      item?.replacementCases ??
      meta?.replacementCases ??
      item?.quantityReplacedCases ??
      meta?.quantityReplacedCases ??
      0
    )
    if (Number.isFinite(directUnitQty) && directUnitQty > 0) return directUnitQty

    const qtyPerCase = Number(
      firstLine?.quantityPerCase ??
      firstLine?.qtyPerUnit ??
      firstLine?.quantityPerUnit ??
      item?.quantityPerCase ??
      meta?.quantityPerCase ??
      item?.qtyPerUnit ??
      meta?.qtyPerUnit ??
      0
    )
    const canonicalQty = getCanonicalReplacedQtyForKpi(item, meta)
    if (Number.isFinite(qtyPerCase) && qtyPerCase > 0 && canonicalQty > 0) {
      const units = canonicalQty / qtyPerCase
      return Number.isFinite(units) && units > 0 ? units : 0
    }
    // Do not fallback to canonical quantity here, because it is typically base bottles
    // and can leak bottle-based replacements into the unit card.
    return 0
  }

  const getBottleReplacedQtyForKpi = (item: any, meta: any): number => {
    const lines = getReplacementLinesForKpi(item, meta)
    const firstLine = lines[0] || {}
    const lineBottleQty = Number(
      firstLine?.replacedBottles ??
      firstLine?.quantityReplacedBottles ??
      firstLine?.replacementBottles
    )
    if (Number.isFinite(lineBottleQty) && lineBottleQty > 0) return lineBottleQty

    const topBottleQty = Number(
      item?.replacementBottles ??
      meta?.replacementBottles ??
      item?.replacedBottles ??
      meta?.replacedBottles ??
      0
    )
    if (Number.isFinite(topBottleQty) && topBottleQty > 0) return topBottleQty

    // Fallback: text-based bottle classification when structural bottle qty is absent.
    const contextText = `${String(item?.reason || '')} ${String(item?.description || '')} ${String(item?.notes || '')}`.toLowerCase()
    const hasBottleText = /\bbottle(?:s)?\b/.test(contextText)
    const hasUnitEvidence = Number(
      firstLine?.replacedCases ??
      firstLine?.quantityReplacedCases ??
      firstLine?.replacementCases ??
      item?.replacementCases ??
      meta?.replacementCases ??
      item?.quantityReplacedCases ??
      meta?.quantityReplacedCases ??
      0
    ) > 0
    if (!hasBottleText || hasUnitEvidence) return 0

    return getCanonicalReplacedQtyForKpi(item, meta)
  }

  const totalIssues = filteredReplacements.length
  const totalReplacedQty = filteredReplacements.reduce((sum, item) => {
    const meta = parseMeta(item?.notes)
    const rawStatus = String(item?.status || '').trim().toUpperCase()
    const isResolved =
      (['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus) && !hasOutstandingReplacementQty(item, meta)) ||
      ['REJECTED', 'CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(rawStatus)
    if (!isResolved) return sum
    const bottleQty = getBottleReplacedQtyForKpi(item, meta)
    if (bottleQty > 0) return sum
    return sum + getUnitReplacedQtyForKpi(item, meta)
  }, 0)
  const replacedTypeSummary = filteredReplacements.reduce((sum, item) => {
    const meta = parseMeta(item?.notes)
    const rawStatus = String(item?.status || '').trim().toUpperCase()
    const isResolved = ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus) && !hasOutstandingReplacementQty(item, meta)
    if (!isResolved) return sum
    const bottleQty = getBottleReplacedQtyForKpi(item, meta)
    if (bottleQty > 0) sum.bottles += bottleQty
    return sum
  }, { bottles: 0, cases: 0 })
  const scheduledReplacementsCount = filteredReplacements.filter((item) => hasStrictScheduledFollowUp(item)).length
  const rejectedCount = filteredReplacements.filter((item) => {
    const rawStatus = String(item?.status || '').toUpperCase()
    return rawStatus === 'REJECTED'
  }).length
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[260px]">
          <h1 className="text-2xl font-bold text-gray-900">Replacements</h1>
          <p className="text-gray-500">Reverse logistics monitoring for replacement cases, evidence, and resolution status</p>
        </div>
        <div className="w-full max-w-[420px]">
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
              <option value="COMPLETED">Completed</option>
              <option value="IN_PROGRESS">In Progress</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex min-h-[132px] items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm leading-5 text-gray-500">Total Cases</p>
              <p className="text-2xl font-bold leading-none text-gray-900">{totalIssues}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex min-h-[132px] items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <XCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm leading-5 text-gray-500">Rejected</p>
              <p className="text-2xl font-bold leading-none text-gray-900">{rejectedCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex min-h-[132px] items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm leading-5 text-gray-500">Replaced Bottles</p>
              <p className="text-2xl font-bold leading-none text-gray-900">{replacedTypeSummary.bottles}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex min-h-[132px] items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm leading-5 text-gray-500">Replaced Unit</p>
              <p className="text-2xl font-bold leading-none text-gray-900">{totalReplacedQty}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex min-h-[132px] items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Clock className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm leading-5 text-gray-500">Scheduled Replacements</p>
              <p className="text-2xl font-bold leading-none text-gray-900">{scheduledReplacementsCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customer Replacement Requests</CardTitle>
          <CardDescription>Requests submitted directly by customers after delivery</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <PortalTableSkeleton rows={5} columns={6} className="border-0 shadow-none" />
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
                    const issueReason = getReplacementDetailsText(item, meta)
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
                      const qtyPerCase = Math.max(1, Number(sourceLine?.quantityPerCase ?? matchedOrderItem?.product?.quantityPerCase ?? matchedOrderItem?.product?.quantityPerUnit ?? 1))
                      const effectiveUnit = String(
                        sourceLine?.productUnit ??
                        sourceLine?.replacementProductUnit ??
                        sourceLine?.originalProductUnit ??
                        matchedOrderItem?.product?.unit ??
                        matchedOrderItem?.unit ??
                        ''
                      ).trim().toLowerCase()
                      const isBottleUnit = effectiveUnit.includes('bottle')
                      const basePrice = Number.isFinite(unitPrice) ? unitPrice : 0
                      const qty = Math.max(Number(line?.quantityReplaced || 0), 0)
                      const replacedQtyInBillingUnit = isBottleUnit ? qty : (qty / qtyPerCase)
                      const lineLoss = replacedQtyInBillingUnit > 0 ? replacedQtyInBillingUnit * basePrice : 0
                      return sum + lineLoss
                    }, 0)
                    const evidenceUrls = collectEvidenceUrls(item, meta)
                    const evidenceCount = evidenceUrls.length
                    const hasEvidence = evidenceCount > 0
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
                          <p className="whitespace-pre-line text-sm leading-5 text-gray-900">{issueReason}</p>
                          {totalLoss > 0 ? <p className="mt-1 text-xs font-semibold text-red-600">Loss: {formatPeso(totalLoss)}</p> : null}
                        </td>
                        <td className="p-4">
                          <Badge className={hasEvidence ? 'bg-blue-100 text-blue-700 hover:bg-blue-100' : ''} variant="secondary">
                            {hasEvidence ? `${evidenceCount} Photo${evidenceCount > 1 ? 's' : ''} Attached` : 'No Photo'}
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
        <DialogContent className="max-h-[90vh] w-[72vw] max-w-[640px] overflow-y-auto p-0 sm:max-w-[640px]">
          {selectedReplacement ? (() => {
            const meta = parseMeta(selectedReplacement.notes)
            const evidenceUrls = collectEvidenceUrls(selectedReplacement, meta)
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
                const srcOrderItemId = String(sourceLine?.orderItemId ?? sourceLine?.originalOrderItemId ?? '').trim()
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
              const qtyPerCase = Math.max(1, Number(sourceLine?.quantityPerCase ?? matchedOrderItem?.product?.quantityPerCase ?? matchedOrderItem?.product?.quantityPerUnit ?? 1))
              const effectiveUnit = String(
                sourceLine?.productUnit ??
                sourceLine?.replacementProductUnit ??
                sourceLine?.originalProductUnit ??
                matchedOrderItem?.product?.unit ??
                matchedOrderItem?.unit ??
                ''
              ).trim().toLowerCase()
              const isBottleUnit = effectiveUnit.includes('bottle')
              const basePrice = Number.isFinite(unitPrice) ? unitPrice : 0
              const qty = Math.max(Number(line?.quantityReplaced || 0), 0)
              const replacedQtyInBillingUnit = isBottleUnit ? qty : (qty / qtyPerCase)
              const lineLoss = replacedQtyInBillingUnit > 0 ? replacedQtyInBillingUnit * basePrice : 0
              return lineLoss
            })
            const totalLoss = replacementLineLoss.reduce((sum, loss) => sum + Number(loss || 0), 0)
            const rawStatus = String(selectedReplacement?.status || '').toUpperCase()
            const hasOutstanding = hasOutstandingReplacementQty(selectedReplacement, meta)
            const isScheduledReplacement = hasStrictScheduledFollowUp(selectedReplacement)
            const baseResolution = getReplacementDetailsText(selectedReplacement, meta).trim()
            const effectiveResolution = baseResolution || 'N/A'
            const rawMode = String(selectedReplacement.replacementMode || meta?.replacementMode || 'N/A')
            const isResolvedCase = Boolean(
              selectedReplacement?.isClosed ||
              ((rawStatus === 'COMPLETED' || rawStatus === 'RESOLVED_ON_DELIVERY') && !hasOutstanding) ||
              (totalQtyToReplace > 0 && totalQtyReplaced >= totalQtyToReplace)
            )
            const isFinalizedStatus = ['COMPLETED', 'RESOLVED_ON_DELIVERY', 'REJECTED', 'CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(rawStatus) || isResolvedCase
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
                          <th className="px-3 py-2 text-left font-medium">Replaced</th>
                          <th className="px-3 py-2 text-left font-medium">Loss</th>
                        </tr>
                      </thead>
                      <tbody>
                        {replacementLines.map((line, index) => {
                          const lineLoss = replacementLineLoss[index] || 0
                          return (
                          <tr key={`${line.originalProductName}-${index}`} className="border-t first:border-t-0">
                            <td className="px-3 py-2">
                              <p className="font-semibold text-slate-900">{line.originalProductName}</p>
                              {String(line.originalProductCategory || '').trim() ? (
                                <p className="text-xs text-slate-500">{line.originalProductCategory}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-semibold text-slate-900">{line.replacementProductName}</p>
                              {String(line.replacementProductCategory || '').trim() ? (
                                <p className="text-xs text-slate-500">{line.replacementProductCategory}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-semibold text-slate-900">{line.quantityToReplaceDisplay ?? line.quantityToReplace}</p>
                            </td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{line.quantityReplacedDisplay ?? line.quantityReplaced}</td>
                            <td className="px-3 py-2 font-semibold text-red-600">{lineLoss > 0 ? `- ${formatPeso(lineLoss)}` : '--'}</td>
                          </tr>
                          )
                        })}
                        <tr className="border-t bg-slate-50">
                          <td className="px-3 py-2 font-semibold text-slate-700" colSpan={4}>Total Loss</td>
                          <td className="px-3 py-2 font-bold text-red-600">{totalLoss > 0 ? `- ${formatPeso(totalLoss)}` : '--'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                {evidenceUrls.length > 0 ? (
                  <div className="rounded-md border bg-white px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">Evidence ({evidenceUrls.length})</p>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {evidenceUrls.map((url, index) => (
                        <img
                          key={`${url}-${index}`}
                          src={url}
                          alt={`Replacement evidence ${index + 1}`}
                          className="max-h-[360px] w-full rounded-md border object-contain"
                        />
                      ))}
                    </div>
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
                      ) : !isScheduledReplacement && !isFinalizedStatus && rawStatus !== 'APPROVED' ? (
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

