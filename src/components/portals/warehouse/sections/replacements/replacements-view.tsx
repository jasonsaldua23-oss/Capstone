'use client'

import { useMemo, useState } from 'react'
import { Boxes, CalendarDays, ClipboardList, Loader2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { WarehouseReplacementsViewProps } from '../shared/types'

export function WarehouseReplacementsView({
  replacementSummary,
  loadingReplacements,
  scopedReplacements,
  parseIssueMeta,
  formatIssueStatus,
  updateIssueStatus,
  updatingReplacementId,
  selectedReplacement,
  setSelectedReplacement,
  buildReplacementLines,
}: WarehouseReplacementsViewProps) {
  const [replacementDeliveryDate, setReplacementDeliveryDate] = useState('')
  const [rowScheduleDates, setRowScheduleDates] = useState<Record<string, string>>({})
  const openReplacementDetails = (entry: any) => {
    const scheduled = String(entry?.scheduledDeliveryDate || '').trim()
    setReplacementDeliveryDate(scheduled)
    setSelectedReplacement(entry)
  }
  const hasStrictScheduledFollowUp = (entry: any): boolean => {
    const scheduledDeliveryDate = String(entry?.scheduledDeliveryDate || '').trim()
    const replacementOrderId = String(entry?.replacementOrderId || '').trim()
    const replacementOrderNumber = String(entry?.replacementOrderNumber || '').trim()
    return Boolean(scheduledDeliveryDate || replacementOrderId || replacementOrderNumber)
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
  const getWarehouseStatusLabel = (entry: any, meta: any): string => {
    const rawStatus = String(entry?.status || '').trim().toUpperCase()
    const hasScheduledFollowUp = hasStrictScheduledFollowUp(entry)
    if (rawStatus === 'IN_PROGRESS' && hasScheduledFollowUp) {
      return 'Scheduled for Delivery'
    }
    if (rawStatus === 'IN_PROGRESS' && !hasScheduledFollowUp) {
      return 'Approved'
    }
    return formatIssueStatus(entry)
  }
  const collectEvidenceUrls = (entry: any, meta: any): string[] => {
    const urlsFromArray = Array.isArray(entry?.damagePhotoUrls) ? entry.damagePhotoUrls : []
    const fallbackSingle = [entry?.damagePhotoUrl, meta?.damagePhotoUrl]
    return [...urlsFromArray, ...fallbackSingle]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
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
    const qtyPerUnit = qtyPerUnitMatch ? Number(qtyPerUnitMatch[1]) : NaN
    const qtyPerCase = qtyPerCaseMatch ? Number(qtyPerCaseMatch[1]) : NaN
    const qtyPerPack = qtyPerPackMatch ? Number(qtyPerPackMatch[1]) : NaN
    const qtyPerBundle = qtyPerBundleMatch ? Number(qtyPerBundleMatch[1]) : NaN
    const unitLabel =
      unitHint.includes('pack') || byPackText ? 'pack(s)'
        : unitHint.includes('bundle') || byBundleText ? 'bundle(s)'
          : unitHint.includes('case') || byCaseText ? 'case(s)'
            : 'unit(s)'

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
    return `${fallback}`
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
  const getModalQtyDisplay = (entry: any, meta: any, line: any, mode: 'toReplace' | 'replaced') => {
    const contextText = `${String(entry?.description || '')} ${String(entry?.reason || '')} ${String(entry?.notes || '')}`.toLowerCase()
    const isByBottle = /\bby\s*bottle\b/.test(contextText)
    if (isByBottle) {
      const bottleQty = Number(
        mode === 'toReplace'
          ? (line?.damagedBottles ?? line?.quantityToReplaceBottles ?? line?.replacementBottles ?? line?.quantityToReplace)
          : (line?.replacedBottles ?? line?.quantityReplacedBottles ?? line?.replacementBottles ?? line?.quantityReplaced)
      )
      if (Number.isFinite(bottleQty)) return `${bottleQty} bottle(s)`
      const fallback = Number(mode === 'toReplace' ? line?.quantityToReplace : line?.quantityReplaced)
      return Number.isFinite(fallback) ? `${fallback} bottle(s)` : '0'
    }

    const directUnitQty = Number(
      mode === 'toReplace'
        ? (line?.damagedCases ?? line?.quantityToReplaceCases ?? line?.replacementCases ?? line?.unitsToReplace ?? line?.quantityToReplaceUnits)
        : (line?.replacedCases ?? line?.quantityReplacedCases ?? line?.replacementCases ?? line?.unitsReplaced ?? line?.quantityReplacedUnits)
    )
    if (Number.isFinite(directUnitQty)) return `${directUnitQty} unit(s)`

    const qtyPerFromFields = Number(
      line?.qtyPerUnit ??
      line?.quantityPerUnit ??
      line?.quantityPerCase ??
      line?.unitsPerCase ??
      line?.bottlesPerUnit ??
      line?.bottlesPerCase ??
      entry?.qtyPerUnit ??
      entry?.quantityPerUnit ??
      entry?.quantityPerCase ??
      meta?.qtyPerUnit ??
      meta?.quantityPerUnit ??
      meta?.quantityPerCase ??
      NaN
    )
    const qtyPerMatch = `${String(entry?.description || '')} ${String(entry?.notes || '')} ${String(entry?.reason || '')}`.match(/qty\s*\/\s*(?:unit|case|pack|bundle)\s*[:\-]?\s*(\d+)/i)
    const qtyPerFromText = qtyPerMatch ? Number(qtyPerMatch[1]) : NaN
    const qtyPerUnit = Number.isFinite(qtyPerFromFields) && qtyPerFromFields > 0 ? qtyPerFromFields : qtyPerFromText
    const rawQty = Number(mode === 'toReplace' ? line?.quantityToReplace : line?.quantityReplaced)
    if (Number.isFinite(qtyPerUnit) && qtyPerUnit > 0 && Number.isFinite(rawQty)) {
      const units = rawQty / qtyPerUnit
      const unitsText = Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\.00$/, '')
      return `${unitsText} unit(s)`
    }
    return Number.isFinite(rawQty) ? `${rawQty} unit(s)` : '0'
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
  const replacementsBySource = useMemo(() => {
    const customerRequests: any[] = []
    const scheduledReplacements: any[] = []
    scopedReplacements.forEach((item) => {
      const meta = parseIssueMeta(item?.notes)
      const rawStatus = String(item?.status || '').trim().toUpperCase()
      const isResolved = ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus) && !hasOutstandingReplacementQty(item, meta)
      if (hasStrictScheduledFollowUp(item) && !isResolved) {
        scheduledReplacements.push(item)
        return
      }
      customerRequests.push(item)
    })
    return { customerRequests, scheduledReplacements }
  }, [scopedReplacements, parseIssueMeta, hasOutstandingReplacementQty])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Replacements</h1>
          <p className="text-gray-500">Reverse logistics monitoring for replacement cases, evidence, and resolution status</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex min-h-[132px] items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm leading-5 text-gray-500">Total Cases</p>
              <p className="text-2xl font-bold leading-none text-gray-900">{replacementSummary.totalCases}</p>
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
              <p className="text-2xl font-bold leading-none text-gray-900">{replacementSummary.rejected}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex min-h-[132px] items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Boxes className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm leading-5 text-gray-500">Replaced Bottles</p>
              <p className="text-2xl font-bold leading-none text-gray-900">{replacementSummary.replacedBottleQty}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex min-h-[132px] items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm leading-5 text-gray-500">Replaced Unit</p>
              <p className="text-2xl font-bold leading-none text-gray-900">{replacementSummary.replacedQty}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-slate-200/80 shadow-sm">
          <CardContent className="flex min-h-[132px] items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-sm leading-5 text-gray-500">Scheduled Replacements</p>
              <p className="text-2xl font-bold leading-none text-gray-900">{replacementsBySource.scheduledReplacements.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="border-b px-6 py-4">
          <h3 className="text-base font-semibold text-slate-900">Scheduled Replacements</h3>
          <p className="text-sm text-slate-500">Already scheduled and ready for Create Trip</p>
        </CardContent>
        <CardContent className="p-0">
          {loadingReplacements ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : replacementsBySource.scheduledReplacements.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-500">No scheduled replacements found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium text-gray-600">Replacement #</th>
                    <th className="text-left p-4 font-medium text-gray-600">Replacement Order #</th>
                    <th className="text-left p-4 font-medium text-gray-600">Order #</th>
                    <th className="text-left p-4 font-medium text-gray-600">Customer</th>
                    <th className="text-left p-4 font-medium text-gray-600">Scheduled Date</th>
                    <th className="text-left p-4 font-medium text-gray-600">Status</th>
                    <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {replacementsBySource.scheduledReplacements.map((ret) => {
                    const meta = parseIssueMeta(ret?.notes)
                    const scheduledDate = String(ret?.scheduledDeliveryDate || meta?.scheduledDeliveryDate || '').trim()
                    const replacementOrderNumber = String(ret?.replacementOrderNumber || meta?.replacementOrderNumber || '').trim()
                    const statusLabel = getWarehouseStatusLabel(ret, meta)
                    return (
                      <tr key={ret.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-4 font-medium">{ret.replacementNumber}</td>
                        <td className="p-4">{replacementOrderNumber || 'N/A'}</td>
                        <td className="p-4">{ret.orderNumber || ret.order?.orderNumber || 'N/A'}</td>
                        <td className="p-4">{ret.customerName || ret.order?.customer?.name || 'N/A'}</td>
                        <td className="p-4">{scheduledDate || 'N/A'}</td>
                        <td className="p-4">
                          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">{statusLabel}</Badge>
                        </td>
                        <td className="p-4 min-w-[220px]">
                          <Button size="sm" variant="outline" onClick={() => openReplacementDetails(ret)}>
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
        <CardContent className="border-b px-6 py-4">
          <h3 className="text-base font-semibold text-slate-900">Customer Replacement Requests</h3>
          <p className="text-sm text-slate-500">Requests submitted directly by customers after delivery</p>
        </CardContent>
        <CardContent className="p-0">
          {loadingReplacements ? (
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
                    <th className="text-left p-4 font-medium text-gray-600">Replacement Details</th>
                    <th className="text-left p-4 font-medium text-gray-600">Evidence</th>
                    <th className="text-left p-4 font-medium text-gray-600">Status</th>
                    <th className="text-left p-4 font-medium text-gray-600">Reported</th>
                    <th className="text-left p-4 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {replacementsBySource.customerRequests.map((ret) => {
                    const meta = parseIssueMeta(ret?.notes)
                    const issueReason = getReplacementDetailsText(ret, meta)
                    const rawStatus = String(ret?.status || '').trim().toUpperCase()
                    const outstanding = hasOutstandingReplacementQty(ret, meta)
                    const evidenceUrls = collectEvidenceUrls(ret, meta)
                    const evidenceCount = evidenceUrls.length
                    const hasEvidence = evidenceCount > 0
                    const statusLabel = formatIssueStatus(ret)
                    return (
                      <tr key={ret.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-4 font-medium">{ret.replacementNumber}</td>
                        <td className="p-4">{ret.orderNumber || ret.order?.orderNumber || 'N/A'}</td>
                        <td className="p-4">{ret.customerName || ret.order?.customer?.name || 'N/A'}</td>
                        <td className="p-4">
                          <p className="whitespace-pre-line text-sm leading-5 text-gray-900">{issueReason}</p>
                        </td>
                        <td className="p-4">
                          <Badge variant={hasEvidence ? 'default' : 'secondary'}>
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
                          {ret.createdAt ? new Date(ret.createdAt).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="p-4 min-w-[220px]">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openReplacementDetails(ret)}
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

      <Dialog open={!!selectedReplacement} onOpenChange={(open) => {
        if (!open) {
          setSelectedReplacement(null)
          setReplacementDeliveryDate('')
        }
      }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto p-0">
          {selectedReplacement ? (() => {
            const meta = parseIssueMeta(selectedReplacement.notes)
            const evidenceUrls = collectEvidenceUrls(selectedReplacement, meta)
            const replacementLines = buildReplacementLines(selectedReplacement, meta)
            const totalQtyToReplace = replacementLines.reduce((sum, line) => sum + Math.max(Number(line.quantityToReplace || 0), 0), 0)
            const totalQtyReplaced = replacementLines.reduce((sum, line) => sum + Math.max(Number(line.quantityReplaced || 0), 0), 0)
            const rawStatus = String(selectedReplacement?.status || '').toUpperCase()
            const rawMode = String(selectedReplacement.replacementMode || meta?.replacementMode || 'N/A')
            const hasOutstandingReplacementQty =
              totalQtyToReplace > 0 && totalQtyReplaced < totalQtyToReplace
            const isClosedStatus = ['REJECTED', 'CANCELLED'].includes(rawStatus) || (
              ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus) && !hasOutstandingReplacementQty
            )
            const statusLabel = getWarehouseStatusLabel(selectedReplacement, meta)
            const canScheduleDelivery = rawStatus === 'APPROVED' && !isClosedStatus
            const isResolvedReplacement = ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus) && !hasOutstandingReplacementQty
            const isScheduledReplacement = hasStrictScheduledFollowUp(selectedReplacement)
            const shouldShowSchedulePickerInModal =
              canScheduleDelivery && !isScheduledReplacement
            const isResolvedCase = Boolean(
              selectedReplacement?.isClosed ||
              ((rawStatus === 'COMPLETED' || rawStatus === 'RESOLVED_ON_DELIVERY') && !hasOutstandingReplacementQty) ||
              (totalQtyToReplace > 0 && totalQtyReplaced >= totalQtyToReplace)
            )
            const baseResolution = getReplacementDetailsText(selectedReplacement, meta).trim()
            const effectiveResolution = isResolvedCase
              ? (baseResolution.replace(/;?\s*follow-?up required\.?/i, '').trim() || 'Resolved')
              : (baseResolution || 'N/A')
            const details = [
              ['Replacement #', selectedReplacement.replacementNumber],
              ['Order #', selectedReplacement.orderNumber || selectedReplacement.order?.orderNumber || 'N/A'],
              ['Customer', selectedReplacement.customerName || selectedReplacement.order?.customer?.name || 'N/A'],
              ['Status', statusLabel],
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
                  <DialogDescription>Complete information for {selectedReplacement.replacementNumber}</DialogDescription>
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
                            <td className="px-3 py-2 font-semibold text-slate-900">{getModalQtyDisplay(selectedReplacement, meta, line, 'toReplace')}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{getModalQtyDisplay(selectedReplacement, meta, line, 'replaced')}</td>
                          </tr>
                        ))}
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
                      {shouldShowSchedulePickerInModal ? (
                        <>
                          <input
                            type="date"
                            className="h-9 w-[170px] shrink-0 rounded-md border border-slate-300 px-3 text-sm text-slate-700"
                            value={replacementDeliveryDate}
                            onChange={(event) => setReplacementDeliveryDate(event.target.value)}
                          />
                          <Button
                            size="sm"
                            className="h-9 shrink-0 whitespace-nowrap px-4 bg-blue-600 text-white hover:bg-blue-700"
                            onClick={() => {
                              if (!replacementDeliveryDate) return
                              const nextStatus = rawStatus === 'APPROVED' ? 'APPROVED' : 'NEEDS_FOLLOW_UP'
                              void updateIssueStatus(selectedReplacement.id, nextStatus, {
                                notes: shouldShowSchedulePickerInModal
                                  ? `Warehouse scheduled driver partial follow-up delivery on ${replacementDeliveryDate}`
                                  : `Replacement delivery scheduled on ${replacementDeliveryDate}`,
                                createReplacementOrder: true,
                                replacementDeliveryDate,
                                manualScheduleConfirmed: true,
                              })
                            }}
                            disabled={updatingReplacementId === selectedReplacement.id || !replacementDeliveryDate}
                          >
                            Schedule Delivery
                          </Button>
                        </>
                      ) : rawStatus === 'UNDER_REVIEW' || rawStatus === 'PENDING' || rawStatus === 'REPORTED' ? (
                        <p className="text-sm text-slate-500">Waiting for admin review and approval.</p>
                      ) : isScheduledReplacement && !isResolvedReplacement ? (
                        <p className="text-sm text-blue-700">Scheduled replacement is already queued for Create Trip.</p>
                      ) : (
                        <p className="text-sm text-slate-500">This replacement is already finalized.</p>
                      )}
                      {updatingReplacementId === selectedReplacement.id ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> : null}
                    </div>
                  </div>
                </div>
              </>
            )
          })() : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
