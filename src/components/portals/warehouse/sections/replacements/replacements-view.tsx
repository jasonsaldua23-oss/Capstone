'use client'

import { useMemo, useState } from 'react'
import { Boxes, CalendarDays, ClipboardList, Loader2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PortalTableSkeleton } from '@/components/portals/shared/loading-skeletons'
import { PodImagePreview } from '@/components/shared/pod-image-preview'
import type { WarehouseReplacementsViewProps } from '../shared/types'

const formatPeso = (value: number) => new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0))

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
  receiveReplacementReturn,
}: WarehouseReplacementsViewProps) {
  const [replacementDeliveryDate, setReplacementDeliveryDate] = useState('')
  const [rowScheduleDates, setRowScheduleDates] = useState<Record<string, string>>({})
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({})
  const [statusFilter, setStatusFilter] = useState('ALL')
  const todayDateInput = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }, [])
  const isPastScheduleDate = (value: string) => {
    const raw = String(value || '').trim()
    if (!raw) return false
    return raw < todayDateInput
  }
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
    if (['CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(rawStatus)) {
      return 'Cancelled'
    }
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
    const productNameForLine = String(first?.originalProductName || first?.replacementProductName || first?.productName || '').trim()
    const productNameLookup = productNameForLine.replace(/\s*\([^)]*\)\s*$/, '').trim() || productNameForLine
    const inferLineModeFromDescription = () => {
      const rawDescription = String(entry?.description || '')
      if (!productNameLookup || !rawDescription) return ''
      const escapedProductName = productNameLookup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const segmentMatch = rawDescription.match(new RegExp(`\\[${escapedProductName}\\]([\\s\\S]*?)(?=\\s*\\[[^\\]]+\\]|$)`, 'i'))
      const segmentText = String(segmentMatch?.[1] || '').toLowerCase()
      if (!segmentText) return ''
      if (/\bby\s*bottle\b/.test(segmentText)) return 'bottle'
      if (/\bby\s*pack\b/.test(segmentText)) return 'pack'
      if (/\bby\s*bundle\b/.test(segmentText)) return 'bundle'
      if (/\bby\s*case\b/.test(segmentText)) return 'case'
      if (/\bby\s*unit\b/.test(segmentText)) return 'case'
      return ''
    }
    const lineInputMode = String(first?.lineInputMode || first?.replacementInputMode || inferLineModeFromDescription()).trim().toLowerCase()
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
    const formatQtyWithUnit = (count: number, unitType: string) => {
      const isPlural = count !== 1
      const u = String(unitType || '').toLowerCase()
      const singular = u.includes('pack') ? 'pack' : u.includes('bundle') ? 'bundle' : u.includes('case') ? 'case' : u.includes('bottle') ? 'bottle' : 'unit'
      return `${count} ${isPlural ? `${singular}s` : singular}`
    }

    const defaultUnit =
      unitHint.includes('pack') || byPackText ? 'pack'
        : unitHint.includes('bundle') || byBundleText ? 'bundle'
          : unitHint.includes('case') || byCaseText ? 'case'
            : 'unit'

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
    if (lineInputMode === 'bottle') {
      if (Number.isFinite(bottleQty) && bottleQty >= 0) return formatQtyWithUnit(bottleQty, 'bottle')
      const fallbackQty = Number(
        mode === 'toReplace'
          ? (entry?.quantityToReplace ?? meta?.quantityToReplace ?? entry?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
          : (entry?.quantityReplaced ?? meta?.quantityReplaced ?? 0)
      )
      const fallback = Math.max(0, Number.isFinite(fallbackQty) ? fallbackQty : 0)
      return formatQtyWithUnit(fallback, 'bottle')
    }
    if (Number.isFinite(caseQty) && caseQty > 0) return formatQtyWithUnit(caseQty, defaultUnit)
    if (Number.isFinite(bottleQty) && bottleQty > 0) return formatQtyWithUnit(bottleQty, 'bottle')

    const fallbackQty = Number(
      mode === 'toReplace'
        ? (entry?.quantityToReplace ?? meta?.quantityToReplace ?? entry?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
        : (entry?.quantityReplaced ?? meta?.quantityReplaced ?? 0)
    )
    const fallback = Math.max(0, Number.isFinite(fallbackQty) ? fallbackQty : 0)
    if (byUnitText && Number.isFinite(qtyPerUnit) && qtyPerUnit > 0 && fallback > 0) {
      const units = fallback / qtyPerUnit
      const unitsText = Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\.00$/, '')
      const numVal = Number(unitsText)
      return `${unitsText} ${formatQtyWithUnit(numVal, defaultUnit).split(' ')[1]}`
    }
    if (byCaseText && Number.isFinite(qtyPerCase) && qtyPerCase > 0 && fallback > 0) {
      const units = fallback / qtyPerCase
      const unitsText = Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\.00$/, '')
      const numVal = Number(unitsText)
      return `${unitsText} ${formatQtyWithUnit(numVal, 'case').split(' ')[1]}`
    }
    if (byPackText && Number.isFinite(qtyPerPack) && qtyPerPack > 0 && fallback > 0) {
      const units = fallback / qtyPerPack
      const unitsText = Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\.00$/, '')
      const numVal = Number(unitsText)
      return `${unitsText} ${formatQtyWithUnit(numVal, 'pack').split(' ')[1]}`
    }
    if (byBundleText && Number.isFinite(qtyPerBundle) && qtyPerBundle > 0 && fallback > 0) {
      const units = fallback / qtyPerBundle
      const unitsText = Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\.00$/, '')
      const numVal = Number(unitsText)
      return `${unitsText} ${formatQtyWithUnit(numVal, 'bundle').split(' ')[1]}`
    }
    if (!lineInputMode && byBottleText) return formatQtyWithUnit(fallback, 'bottle')
    return fallback > 0 ? formatQtyWithUnit(fallback, defaultUnit) : '0'
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
    if (Number.isFinite(directUnits) && directUnits >= 0) {
      return `${directUnits} ${directUnits === 1 ? 'unit' : 'units'}`
    }
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
      const numVal = Number(unitsText)
      return `${unitsText} ${numVal === 1 ? 'unit' : 'units'}`
    }
    return getReplacementQtyDisplay(entry, meta, mode)
  }
  const getModalQtyDisplay = (entry: any, meta: any, line: any, mode: 'toReplace' | 'replaced') => {
    const productNameForLine = String(line?.originalProductName || line?.replacementProductName || line?.productName || '').trim()
    const productNameLookup = productNameForLine.replace(/\s*\([^)]*\)\s*$/, '').trim() || productNameForLine
    const inferLineModeFromDescription = () => {
      const rawDescription = String(entry?.description || '')
      if (!productNameLookup || !rawDescription) return ''
      const escapedProductName = productNameLookup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const segmentMatch = rawDescription.match(new RegExp(`\\[${escapedProductName}\\]([\\s\\S]*?)(?=\\s*\\[[^\\]]+\\]|$)`, 'i'))
      if (!segmentMatch) return ''
      const segmentText = segmentMatch[1] || ''
      if (/\bby\s*bottle\b/i.test(segmentText)) return 'bottle'
      if (/\bby\s*pack\b/i.test(segmentText)) return 'pack'
      if (/\bby\s*bundle\b/i.test(segmentText)) return 'bundle'
      if (/\bby\s*case\b/i.test(segmentText)) return 'case'
      if (/\bby\s*unit\b/i.test(segmentText)) return 'case'
      return ''
    }
    const lineInputMode = String(line?.lineInputMode || line?.replacementInputMode || inferLineModeFromDescription()).trim().toLowerCase()
    const unitHint = String(
      line?.productUnit ||
      line?.replacementProductUnit ||
      line?.originalProductUnit ||
      line?.unit ||
      ''
    ).trim().toLowerCase()
    const contextText = `${String(entry?.description || '')} ${String(entry?.reason || '')} ${String(entry?.notes || '')}`.toLowerCase()
    const byPackText = /\bby\s*pack\b/.test(contextText)
    const byBundleText = /\bby\s*bundle\b/.test(contextText)
    const byCaseText = /\bby\s*case\b/.test(contextText)
    const byBottleText = /\bby\s*bottle\b/.test(contextText)

    const formatQtyWithUnit = (count: number, unitType: string) => {
      const isPlural = count !== 1
      const u = String(unitType || '').toLowerCase()
      const singular = u.includes('pack') ? 'pack' : u.includes('bundle') ? 'bundle' : u.includes('case') ? 'case' : u.includes('bottle') ? 'bottle' : 'unit'
      return `${count} ${isPlural ? `${singular}s` : singular}`
    }

    const defaultUnit =
      unitHint.includes('pack') || lineInputMode === 'pack' || byPackText ? 'pack'
        : unitHint.includes('bundle') || lineInputMode === 'bundle' || byBundleText ? 'bundle'
          : unitHint.includes('case') || lineInputMode === 'case' || byCaseText ? 'case'
            : 'unit'

    if (lineInputMode === 'bottle' || (!lineInputMode && byBottleText)) {
      const bottleQty = Number(
        mode === 'toReplace'
          ? (line?.damagedBottles ?? line?.quantityToReplaceBottles ?? line?.replacementBottles ?? line?.quantityToReplace)
          : (line?.replacedBottles ?? line?.quantityReplacedBottles ?? line?.replacementBottles ?? line?.quantityReplaced)
      )
      if (Number.isFinite(bottleQty)) return formatQtyWithUnit(bottleQty, 'bottle')
      const fallback = Number(mode === 'toReplace' ? line?.quantityToReplace : line?.quantityReplaced)
      return Number.isFinite(fallback) ? formatQtyWithUnit(fallback, 'bottle') : '0'
    }

    const directUnitQty = Number(
      mode === 'toReplace'
        ? (line?.damagedCases ?? line?.quantityToReplaceCases ?? line?.replacementCases ?? line?.unitsToReplace ?? line?.quantityToReplaceUnits)
        : (line?.replacedCases ?? line?.quantityReplacedCases ?? line?.replacementCases ?? line?.unitsReplaced ?? line?.quantityReplacedUnits)
    )
    if (Number.isFinite(directUnitQty)) return formatQtyWithUnit(directUnitQty, defaultUnit)

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
      const numVal = Number(unitsText)
      return `${unitsText} ${formatQtyWithUnit(numVal, defaultUnit).split(' ')[1]}`
    }
    return Number.isFinite(rawQty) ? formatQtyWithUnit(rawQty, defaultUnit) : `0 ${defaultUnit}s`
  }

  const getReplacementDetailsText = (entry: any, meta: any) => {
    const lines = buildReplacementLines(entry, meta)
    const first: any = lines[0] || {}
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
      meta?.qtyPerUnit ??
      meta?.quantityPerUnit ??
      meta?.quantityPerCase ??
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
      displayQty = `${directUnitQty} ${directUnitQty === 1 ? 'unit' : 'units'}`
    }
    if (!isByBottle && Number.isFinite(qtyPerUnitNumeric) && qtyPerUnitNumeric > 0 && Number.isFinite(rawQtyToReplace) && rawQtyToReplace > 0) {
      const units = rawQtyToReplace / qtyPerUnitNumeric
      if (Number.isFinite(units) && units > 0) {
        const unitsText = Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\.00$/, '')
        const numVal = Number(unitsText)
        displayQty = `${unitsText} ${numVal === 1 ? 'unit' : 'units'}`
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
          const numVal = Number(unitsText)
          displayQty = `${unitsText} ${numVal === 1 ? 'unit' : 'units'}`
        }
      }
    }
    const summary = lines.length > 0
      ? lines.map((line: any) => String(line?.quantityToReplaceDisplay ?? displayQty ?? 'N/A').trim()).filter(Boolean).join(', ')
      : String(displayQty || 'N/A').trim()
    if (/\b(?:bottle|unit|case|pack|bundle)s?\b/i.test(summary)) {
      return `Quantity to replace: ${summary}`
    }
    const numMatch = summary.match(/^(\d+(?:\.\d+)?)/)
    const numVal = numMatch ? parseFloat(numMatch[1]) : 1
    const label = isByBottle ? (numVal === 1 ? 'bottle' : 'bottles') : (numVal === 1 ? 'unit' : 'units')
    return `Quantity to replace: ${summary} ${label}`
  }

  const replacementsBySource = useMemo(() => {
    const customerRequests: any[] = []
    const scheduledReplacements: any[] = []
    scopedReplacements.forEach((item) => {
      const meta = parseIssueMeta(item?.notes)
      const rawStatus = String(item?.status || '').trim().toUpperCase()
      // Added: filter both replacement tables from one workflow-status control.
      const matchesStatusFilter =
        statusFilter === 'ALL' ||
        (statusFilter === 'PENDING' && ['PENDING', 'REPORTED'].includes(rawStatus)) ||
        (statusFilter === 'COMPLETED' && ['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus)) ||
        (statusFilter === 'IN_PROGRESS' && ['IN_PROGRESS', 'NEEDS_FOLLOW_UP'].includes(rawStatus)) ||
        rawStatus === statusFilter
      if (!matchesStatusFilter) return
      const isResolved =
        (['COMPLETED', 'RESOLVED_ON_DELIVERY'].includes(rawStatus) && !hasOutstandingReplacementQty(item, meta)) ||
        ['REJECTED', 'CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(rawStatus)
      if (hasStrictScheduledFollowUp(item) && !isResolved) {
        scheduledReplacements.push(item)
        return
      }
      customerRequests.push(item)
    })
    return { customerRequests, scheduledReplacements }
  }, [scopedReplacements, parseIssueMeta, hasOutstandingReplacementQty, statusFilter])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Replacements</h1>
          <p className="text-gray-500">Reverse logistics monitoring for replacement cases, evidence, and resolution status</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <span className="hidden sm:inline">Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700"
            aria-label="Filter replacements by status"
          >
            <option value="ALL">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="UNDER_REVIEW">Under Review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="COMPLETED">Completed</option>
            <option value="IN_PROGRESS">In Progress</option>
          </select>
        </label>
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
            <PortalTableSkeleton rows={5} columns={5} className="border-0 shadow-none" />
          ) : replacementsBySource.scheduledReplacements.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-500">No scheduled replacements found</p>
            </div>
          ) : (
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[980px]">
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
            <PortalTableSkeleton rows={5} columns={5} className="border-0 shadow-none" />
          ) : replacementsBySource.customerRequests.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-500">No customer replacement requests found</p>
            </div>
          ) : (
            <div className="max-w-full overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[1120px]">
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
          setReturnQuantities({})
        }
      }}>
        <DialogContent className="max-h-[90vh] w-[95vw] sm:max-w-4xl overflow-y-auto p-0">
          {selectedReplacement ? (() => {
            const meta = parseIssueMeta(selectedReplacement.notes)
            const evidenceUrls = collectEvidenceUrls(selectedReplacement, meta)
            const replacementLines = buildReplacementLines(selectedReplacement, meta)
            const normalizedReturnLines = replacementLines.filter((line: any) => String(line?.replacementLineId || line?.id || '').trim())
            const replacementPod = selectedReplacement?.replacementDeliveryPod || null
            const showReplacementPod = Boolean(
              String(replacementPod?.deliveryPhoto || '').trim() ||
              String(replacementPod?.recipientName || '').trim() ||
              String(selectedReplacement?.linkedReplacementOrderId || selectedReplacement?.replacementOrderId || '').trim() ||
              String(selectedReplacement?.linkedReplacementOrderNumber || selectedReplacement?.replacementOrderNumber || '').trim()
            )
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
            const orderItems = (Array.isArray(selectedReplacement?.order?.items) ? selectedReplacement.order.items : []) as any[]
            // Added: mirror Admin's loss calculation using the replacement's original billed price.
            const replacementLineLoss = replacementLines.map((line, index) => {
              const sourceLine = sourceLines[index] || {}
              const matchedOrderItem = orderItems.find((orderItem: any) => {
                const sourceOrderItemId = String(sourceLine?.orderItemId ?? sourceLine?.originalOrderItemId ?? '').trim()
                const orderItemId = String(orderItem?.id ?? '').trim()
                if (sourceOrderItemId && orderItemId && sourceOrderItemId === orderItemId) return true

                const sourceProductId = String(
                  sourceLine?.productId ??
                  sourceLine?.originalProductId ??
                  sourceLine?.replacementProductId ??
                  ''
                ).trim()
                const orderItemProductId = String(orderItem?.product?.id ?? orderItem?.productId ?? '').trim()
                if (sourceProductId && orderItemProductId && sourceProductId === orderItemProductId) return true

                const sourceName = String(line?.originalProductName ?? line?.replacementProductName ?? '').trim().toLowerCase()
                const orderItemName = String(orderItem?.product?.name ?? orderItem?.name ?? '').trim().toLowerCase()
                return Boolean(sourceName && orderItemName && sourceName === orderItemName)
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
              const quantityPerCase = Math.max(1, Number(
                sourceLine?.quantityPerCase ??
                matchedOrderItem?.product?.quantityPerCase ??
                matchedOrderItem?.product?.quantityPerUnit ??
                1
              ))
              const effectiveUnit = String(
                sourceLine?.productUnit ??
                sourceLine?.replacementProductUnit ??
                sourceLine?.originalProductUnit ??
                matchedOrderItem?.product?.unit ??
                matchedOrderItem?.unit ??
                ''
              ).trim().toLowerCase()
              const basePrice = Number.isFinite(unitPrice) ? unitPrice : 0
              const replacedQuantity = Math.max(Number(line?.quantityReplaced || 0), 0)
              const billedQuantity = effectiveUnit.includes('bottle') ? replacedQuantity : replacedQuantity / quantityPerCase
              return billedQuantity > 0 ? billedQuantity * basePrice : 0
            })
            const totalLoss = replacementLineLoss.reduce((sum, loss) => sum + Number(loss || 0), 0)
            const rawStatus = String(selectedReplacement?.status || '').toUpperCase()
            const hasOutstandingReplacementQty =
              totalQtyToReplace > 0 && totalQtyReplaced < totalQtyToReplace
            const isClosedStatus = ['REJECTED', 'CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(rawStatus) || (
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
            const details = [
              ['Replacement #', selectedReplacement.replacementNumber],
              ['Order #', selectedReplacement.orderNumber || selectedReplacement.order?.orderNumber || 'N/A'],
              ['Customer', selectedReplacement.customerName || selectedReplacement.order?.customer?.name || 'N/A'],
              ['Status', statusLabel],
              ['Reported', selectedReplacement.createdAt ? new Date(selectedReplacement.createdAt).toLocaleString() : 'N/A'],
              ['Reason', selectedReplacement.reason || 'N/A'],
              ['Notes', selectedReplacement.customerNotes || meta?.customerNotes || 'No customer notes provided.'],
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
                  <div className="max-w-full overflow-x-auto overscroll-x-contain">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Original Product</th>
                          <th className="px-3 py-2 text-left font-medium">Replacement Product</th>
                          <th className="px-3 py-2 text-left font-medium">Quantity to Replace</th>
                          <th className="px-3 py-2 text-left font-medium">Quantity Replaced</th>
                          <th className="px-3 py-2 text-left font-medium">Loss</th>
                        </tr>
                      </thead>
                      <tbody>
                        {replacementLines.map((line, index) => {
                          const lineLoss = replacementLineLoss[index] || 0
                          return (
                            <tr key={`${line.replacementLineId || line.id || line.originalProductName}-${index}`} className="border-t first:border-t-0">
                            <td className="px-3 py-2">
                              <p className="font-semibold text-slate-900">{line.originalProductName}</p>
                              {String((line as any).originalProductCategory || '').trim() ? (
                                <p className="text-xs text-slate-500">{(line as any).originalProductCategory}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-semibold text-slate-900">{line.replacementProductName}</p>
                              {String((line as any).replacementProductCategory || '').trim() ? (
                                <p className="text-xs text-slate-500">{(line as any).replacementProductCategory}</p>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{getModalQtyDisplay(selectedReplacement, meta, line, 'toReplace')}</td>
                            <td className="px-3 py-2 font-semibold text-slate-900">{getModalQtyDisplay(selectedReplacement, meta, line, 'replaced')}</td>
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
                        <PodImagePreview
                          key={`${url}-${index}`}
                          src={url}
                          alt={`Replacement evidence ${index + 1}`}
                          className="max-h-[360px] w-full rounded-md border object-contain"
                          caption="Click to inspect full-size evidence"
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {showReplacementPod ? (
                  <div className="rounded-md border bg-white px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">Proof of Delivery (POD)</p>
                    <div className="mt-2 space-y-2">
                      {(selectedReplacement?.linkedReplacementOrderNumber || selectedReplacement?.replacementOrderNumber) ? (
                        <p className="text-sm text-slate-700">
                          <span className="font-semibold text-slate-900">Replacement Order:</span>{' '}
                          {selectedReplacement?.linkedReplacementOrderNumber || selectedReplacement?.replacementOrderNumber}
                        </p>
                      ) : null}
                      {String(replacementPod?.recipientName || '').trim() ? (
                        <p className="text-sm text-slate-700">
                          <span className="font-semibold text-slate-900">Received By:</span>{' '}
                          {replacementPod.recipientName}
                        </p>
                      ) : null}
                      {String(replacementPod?.submittedAt || '').trim() ? (
                        <p className="text-sm text-slate-700">
                          <span className="font-semibold text-slate-900">Submitted At:</span>{' '}
                          {new Date(replacementPod.submittedAt).toLocaleString()}
                        </p>
                      ) : null}
                      {String(replacementPod?.deliveryPhoto || '').trim() ? (
                        <PodImagePreview
                          src={String(replacementPod.deliveryPhoto || '')}
                          alt="Replacement proof of delivery"
                          className="h-auto w-full rounded-md border object-contain"
                        />
                      ) : (
                        <p className="text-xs text-slate-500">No POD uploaded yet.</p>
                      )}
                    </div>
                  </div>
                ) : null}
                </div>
                {normalizedReturnLines.some((line: any) => Number(line.quantityToReplace || 0) > Number(line.returnedBaseUnits || 0)) ? (
                  <div className="mx-6 mb-4 rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
                    <p className="text-sm font-semibold text-emerald-900">Receive returned damaged items</p>
                    <p className="mt-1 text-xs text-emerald-800">Quantities are base units and will be restored to their original stock batches as loose inventory.</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {normalizedReturnLines.map((line: any) => {
                        const lineId = String(line.replacementLineId || line.id)
                        const remaining = Math.max(0, Number(line.quantityToReplace || 0) - Number(line.returnedBaseUnits || 0))
                        if (remaining <= 0) return null
                        return (
                          <label key={lineId} className="space-y-1 text-xs text-slate-700">
                            <span>{line.originalProductName} (max {remaining} {line.baseUnitLabel || 'unit'}s)</span>
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              value={returnQuantities[lineId] || ''}
                              onChange={(event) => setReturnQuantities((current) => ({ ...current, [lineId]: event.target.value }))}
                              className="h-9 w-full rounded-md border border-slate-300 bg-white px-3"
                            />
                          </label>
                        )
                      })}
                    </div>
                    <Button
                      size="sm"
                      className="mt-3 bg-emerald-600 text-white hover:bg-emerald-500"
                      disabled={updatingReplacementId === selectedReplacement.id || !Object.values(returnQuantities).some((value) => Number(value) > 0)}
                      onClick={async () => {
                        const returnedLines = normalizedReturnLines
                          .map((line: any) => {
                            const replacementLineId = String(line.replacementLineId || line.id)
                            const remaining = Math.max(0, Number(line.quantityToReplace || 0) - Number(line.returnedBaseUnits || 0))
                            return {
                              replacementLineId,
                              quantityBaseUnits: Math.min(remaining, Math.max(0, Math.floor(Number(returnQuantities[replacementLineId] || 0)))),
                            }
                          })
                          .filter((line: any) => line.quantityBaseUnits > 0)
                        if (returnedLines.length === 0) return
                        try {
                          await receiveReplacementReturn(selectedReplacement.id, returnedLines)
                          setReturnQuantities({})
                        } catch {
                          // The parent displays the server error and preserves entered quantities for correction.
                        }
                      }}
                    >
                      {updatingReplacementId === selectedReplacement.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Receive return
                    </Button>
                  </div>
                ) : null}
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
                            min={todayDateInput}
                          />
                          <Button
                            size="sm"
                            className="h-9 shrink-0 whitespace-nowrap px-4 bg-blue-600 text-white hover:bg-blue-700"
                            onClick={() => {
                              if (!replacementDeliveryDate) return
                              if (isPastScheduleDate(replacementDeliveryDate)) return
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
                            disabled={updatingReplacementId === selectedReplacement.id || !replacementDeliveryDate || isPastScheduleDate(replacementDeliveryDate)}
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
