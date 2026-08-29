// Replacement-record display logic, lifted verbatim from the inline closures in
// src/components/portals/customer/sections/orders/orders-view.tsx.
//
// The quantity labelling in particular reads several competing shapes the backend
// can return (explicit line fields, a `Meta:` JSON blob in the notes, and free-text
// hints in the description). Reimplementing it per platform would drift on the first
// edge case, so both clients call this.
import { getReplacementStatusLabel, parseReplacementMeta } from './customer-common.ts'

export function getReplacementNumberFromRecord(record: any, linkedOrder?: any | null): string {
  const orderNumber = String(record?.orderNumber || record?.order_number || '').trim()
  if (/^(RPL|RET)-\d{4}-\d{4}$/i.test(orderNumber)) return orderNumber.toUpperCase()
  const candidates = [record?.notes, record?.description, linkedOrder?.notes]
  for (const value of candidates) {
    const match = String(value || '').match(/\b(?:RPL|RET)-\d{4}-\d{4}\b/i)
    if (match) return String(match[0] || '').trim().toUpperCase()
  }
  return ''
}

export function getReplacementDisplayStatus(record: any, linkedOrder?: any | null): string {
  const rawStatus = String(record?.rawStatus || record?.status || '').trim().toUpperCase()
  const orderStatus = String(linkedOrder?.status || record?.orderStatus || '').trim().toUpperCase()
  if (
    ['CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(rawStatus) ||
    ['CANCELLED', 'CANCELED', 'FAILED_DELIVERY'].includes(orderStatus)
  ) {
    return 'Cancelled'
  }
  if (rawStatus === 'REJECTED') return 'Rejected'
  return getReplacementStatusLabel(record?.status)
}

function getSourceLines(record: any, meta?: any): any[] {
  const effectiveMeta = meta || parseReplacementMeta(record?.notes)
  return (
    (Array.isArray(record?.replacementLines) && record.replacementLines.length ? record.replacementLines : null) ||
    (Array.isArray(effectiveMeta?.replacementLines) && effectiveMeta.replacementLines.length ? effectiveMeta.replacementLines : null) ||
    (Array.isArray(record?.replacementItems) && record.replacementItems.length ? record.replacementItems : null) ||
    (Array.isArray(effectiveMeta?.replacementItems) && effectiveMeta.replacementItems.length ? effectiveMeta.replacementItems : null) ||
    []
  )
}

export function getReplacementLineQtyLabel(line: any, record: any, meta?: any): string {
  const effectiveMeta = meta || parseReplacementMeta(record?.notes)
  const lineInputMode = String(
    line?.lineInputMode || line?.replacementInputMode || effectiveMeta?.replacementInputMode || effectiveMeta?.replacementMode || ''
  ).trim().toLowerCase()
  const unitHint = String(
    line?.productUnit || line?.replacementProductUnit || line?.originalProductUnit || line?.unit || ''
  ).trim().toLowerCase()
  const description = String(record?.description || '')
  const qtyPerUnitMatch = description.match(/Qty\/Unit:?\s*(\d+)/i)
  const qtyPerCaseMatch = description.match(/Qty\/Case:?\s*(\d+)/i)
  const qtyPerPackMatch = description.match(/Qty\/Pack:?\s*(\d+)/i)
  const qtyPerBundleMatch = description.match(/Qty\/Bundle:?\s*(\d+)/i)
  const qtyPerUnit = Number(
    line?.qtyPerUnit ??
      line?.quantityPerUnit ??
      line?.quantityPerCase ??
      effectiveMeta?.qtyPerUnit ??
      effectiveMeta?.quantityPerUnit ??
      effectiveMeta?.quantityPerCase ??
      qtyPerUnitMatch?.[1] ??
      qtyPerCaseMatch?.[1] ??
      qtyPerPackMatch?.[1] ??
      qtyPerBundleMatch?.[1] ??
      0
  )
  const unitLabel =
    unitHint.includes('pack') || lineInputMode === 'pack'
      ? 'pack(s)'
      : unitHint.includes('bundle') || lineInputMode === 'bundle'
        ? 'bundle(s)'
        : unitHint.includes('case') || lineInputMode === 'case'
          ? 'case(s)'
          : 'unit(s)'

  const bottleQty = Math.max(
    Number(line?.quantityToReplaceBottles ?? line?.damagedBottles ?? line?.replacementBottles ?? 0),
    0
  )
  const caseLikeQty = Math.max(
    Number(
      line?.quantityToReplaceCases ??
        line?.damagedCases ??
        line?.replacementCases ??
        line?.quantityToReplaceUnits ??
        line?.unitsToReplace ??
        0
    ),
    0
  )
  const fallbackQty = Math.max(
    Number(line?.quantityToReplace ?? line?.damagedQuantity ?? record?.quantityToReplace ?? record?.replacementQuantity ?? 0),
    0
  )

  if (lineInputMode === 'bottle') {
    const qty = bottleQty > 0 ? bottleQty : fallbackQty
    return qty > 0 ? `${Math.floor(qty)} bottle(s)` : '0 bottle(s)'
  }

  if (caseLikeQty > 0) return `${Math.floor(caseLikeQty)} ${unitLabel}`

  if (lineInputMode === 'unit' || lineInputMode === 'case' || lineInputMode === 'pack' || lineInputMode === 'bundle') {
    if (qtyPerUnit > 0 && fallbackQty > 0) {
      const converted = fallbackQty / qtyPerUnit
      const displayQty = Number.isInteger(converted) ? String(converted) : converted.toFixed(2).replace(/\.?0+$/, '')
      return `${displayQty} ${unitLabel}`
    }
    return `${Math.floor(fallbackQty)} ${unitLabel}`
  }

  if (bottleQty > 0) return `${Math.floor(bottleQty)} bottle(s)`
  if (qtyPerUnit > 0 && fallbackQty > 0 && fallbackQty % qtyPerUnit === 0) {
    const converted = fallbackQty / qtyPerUnit
    const displayQty = Number.isInteger(converted) ? String(converted) : converted.toFixed(2).replace(/\.?0+$/, '')
    return `${displayQty} ${unitLabel}`
  }
  return fallbackQty > 0 ? `${Math.floor(fallbackQty)} ${unitLabel}` : 'N/A'
}

export function getReplacementDisplayQty(record: any): string {
  const meta = parseReplacementMeta(record?.notes)
  const lines = getSourceLines(record, meta)
  if (lines.length > 0) {
    const labels = lines
      .map((line: any) => getReplacementLineQtyLabel(line, record, meta))
      .filter((label: string) => String(label || '').trim() && String(label || '').trim().toUpperCase() !== 'N/A')
    if (labels.length > 0) return labels.join(', ')
  }
  const formatQty = (qty: number, kind: 'unit' | 'bottle') => `${Math.floor(qty)} ${kind}${qty > 1 ? 's' : ''}`
  const description = String(record?.description || '')
  const byUnit = description.match(/By\s*Unit:\s*(\d+)/i)
  const qtyPerUnitMatch = description.match(/Qty\/(?:Unit|Case)\s*(\d+)/i)
  const qtyPerUnitFromDescription = Number(qtyPerUnitMatch?.[1] || 0)
  const qtyPerUnitFromRecord = Number(record?.quantityPerCase || 0)
  const qtyPerUnit =
    (Number.isFinite(qtyPerUnitFromDescription) && qtyPerUnitFromDescription > 0 ? qtyPerUnitFromDescription : 0) ||
    (Number.isFinite(qtyPerUnitFromRecord) && qtyPerUnitFromRecord > 0 ? qtyPerUnitFromRecord : 0) ||
    0
  if (byUnit) {
    const qty = Number(byUnit[1] || 0)
    if (Number.isFinite(qty) && qty > 0) return formatQty(qty, 'unit')
  }
  const byCase = description.match(/By\s*Case:\s*(\d+)/i)
  if (byCase) {
    const qty = Number(byCase[1] || 0)
    if (Number.isFinite(qty) && qty > 0) return formatQty(qty, 'unit')
  }
  const byBottle = description.match(/By\s*Bottle:\s*(\d+)/i)
  if (byBottle) {
    const qty = Number(byBottle[1] || 0)
    if (Number.isFinite(qty) && qty > 0) return formatQty(qty, 'bottle')
  }
  const unitQty = Number(meta?.replacementCases ?? meta?.quantityToReplaceCases ?? 0)
  if (Number.isFinite(unitQty) && unitQty > 0) return formatQty(unitQty, 'unit')
  const bottleQty = Number(meta?.replacementBottles ?? meta?.quantityToReplaceBottles ?? 0)
  if (Number.isFinite(bottleQty) && bottleQty > 0) return formatQty(bottleQty, 'bottle')
  const fallback = Number(record?.quantityToReplace ?? meta?.quantityToReplace ?? record?.replacementQuantity ?? 0)
  if (Number.isFinite(fallback) && fallback > 0) {
    const mode = String(meta?.replacementInputMode || meta?.replacementMode || '').trim().toLowerCase()
    if (mode === 'case' || mode === 'unit') {
      if (qtyPerUnit > 0) {
        const units = Math.max(1, Math.round(fallback / qtyPerUnit))
        return formatQty(units, 'unit')
      }
      return formatQty(fallback, 'unit')
    }
    if (mode === 'bottle') return formatQty(fallback, 'bottle')
    if (qtyPerUnit > 0 && fallback % qtyPerUnit === 0) {
      const units = Math.max(1, Math.round(fallback / qtyPerUnit))
      return formatQty(units, 'unit')
    }
    return formatQty(fallback, 'unit')
  }
  return 'N/A'
}

export type ReplacementDisplayItem = {
  key: string
  name: string
  qtyLabel: string
  imageUrl: string
}

export function getReplacementItemsForRecord(record: any): ReplacementDisplayItem[] {
  if (!record) return []
  const meta = parseReplacementMeta(record?.notes)
  const lines = getSourceLines(record, meta)
  const formatName = (line: any) => {
    const baseName = String(
      line?.replacementProductName ||
        line?.originalProductName ||
        record?.replacementProductName ||
        record?.originalProductName ||
        'Replacement item'
    ).trim()
    const size = String(
      line?.replacementProductSize ||
        line?.originalProductSize ||
        record?.replacementProductSize ||
        record?.originalProductSize ||
        ''
    ).trim()
    return size ? `${baseName} ${size}` : baseName
  }
  if (lines.length > 0) {
    return lines.map((line: any, index: number) => ({
      key: String(line?.id || line?.replacementProductId || index),
      name: formatName(line),
      qtyLabel: getReplacementLineQtyLabel(line, record, meta),
      imageUrl: String(line?.replacementProductImageUrl || line?.originalProductImageUrl || '').trim(),
    }))
  }
  return [
    {
      key: String(record?.id || 'replacement'),
      name: formatName(record),
      qtyLabel: getReplacementDisplayQty(record),
      imageUrl: String(record?.replacementProductImageUrl || record?.originalProductImageUrl || '').trim(),
    },
  ]
}

export function getReplacementTotalAmount(record: any, linkedOrder: any | null): number {
  if (!record) return 0
  const meta = parseReplacementMeta(record?.notes)
  const sourceLines = getSourceLines(record, meta)
  if (!sourceLines.length) return 0
  const orderItems = Array.isArray(linkedOrder?.items) ? linkedOrder.items : []
  return sourceLines.reduce((sum: number, line: any) => {
    const matchedOrderItem = orderItems.find((orderItem: any) => {
      const srcOrderItemId = String(line?.orderItemId ?? line?.originalOrderItemId ?? '').trim()
      const oiId = String(orderItem?.id ?? '').trim()
      if (srcOrderItemId && oiId && srcOrderItemId === oiId) return true

      const srcProductId = String(
        line?.productId ?? line?.originalProductId ?? line?.replacementProductId ?? ''
      ).trim()
      const oiProductId = String(orderItem?.product?.id ?? orderItem?.productId ?? '').trim()
      if (srcProductId && oiProductId && srcProductId === oiProductId) return true

      const srcName = String(line?.originalProductName ?? line?.replacementProductName ?? '').trim().toLowerCase()
      const oiName = String(orderItem?.product?.name ?? orderItem?.name ?? '').trim().toLowerCase()
      return Boolean(srcName && oiName && srcName === oiName)
    })
    const unitPrice = Number(
      line?.unitPrice ??
        line?.price ??
        line?.sellingPrice ??
        line?.replacementUnitPrice ??
        line?.originalUnitPrice ??
        matchedOrderItem?.unitPrice ??
        matchedOrderItem?.price ??
        matchedOrderItem?.product?.price ??
        0
    )
    const qtyPerCase = Math.max(
      1,
      Number(
        line?.quantityPerCase ??
          matchedOrderItem?.product?.quantityPerCase ??
          matchedOrderItem?.product?.quantityPerUnit ??
          1
      )
    )
    const effectiveUnit = String(
      line?.productUnit ??
        line?.replacementProductUnit ??
        line?.originalProductUnit ??
        matchedOrderItem?.product?.unit ??
        matchedOrderItem?.unit ??
        ''
    ).trim().toLowerCase()
    const isBottleUnit = effectiveUnit.includes('bottle')
    const qty = Math.max(
      Number(line?.quantityToReplace ?? line?.damagedQuantity ?? record?.quantityToReplace ?? record?.replacementQuantity ?? 0),
      0
    )
    if (!qty || !Number.isFinite(unitPrice)) return sum
    const billedQty = isBottleUnit ? qty : qty / qtyPerCase
    return sum + (Number.isFinite(billedQty) ? billedQty * unitPrice : 0)
  }, 0)
}

export function getLinkedOrderForReplacementRecord(record: any, orders: any[]): any | null {
  return (
    (Array.isArray(orders) ? orders : []).find(
      (order: any) =>
        String(order?.id || '').trim() === String(record?.replacementOrderId || '').trim() ||
        String(order?.orderNumber || '').trim().toUpperCase() ===
          String(record?.replacementOrderNumber || '').trim().toUpperCase() ||
        String(order?.id || '').trim() === String(record?.orderId || '').trim() ||
        String(order?.orderNumber || '').trim().toUpperCase() === String(record?.orderNumber || '').trim().toUpperCase()
    ) || null
  )
}

/** The synthetic order rows the Replacement tab lists. */
export function buildReplacementTabOrders(records: any[], orders: any[]): any[] {
  return (Array.isArray(records) ? records : []).map((record: any, index: number) => {
    const linkedOrder = getLinkedOrderForReplacementRecord(record, orders)
    const replacementNumber = getReplacementNumberFromRecord(record, linkedOrder)
    const displayReplacementNumber = replacementNumber.replace(/^RET-/i, 'RPL-')
    const trackingOrderId = String(record?.replacementOrderId || linkedOrder?.id || record?.orderId || '').trim()
    return {
      ...(linkedOrder || {}),
      id: String(record?.id || linkedOrder?.id || `replacement-${index + 1}`),
      trackingOrderId,
      orderNumber: displayReplacementNumber || `Replacement ${index + 1}`,
      customerName:
        linkedOrder?.customerName || linkedOrder?.shippingName || linkedOrder?.contactName || 'Customer',
      shippingAddress: linkedOrder?.shippingAddress || '',
      createdAt: record?.createdAt || linkedOrder?.createdAt || null,
      deliveryDate: record?.createdAt || linkedOrder?.deliveryDate || null,
      deliveredAt: null,
      status: record?.status || record?.rawStatus || 'PENDING',
      paymentStatus: linkedOrder?.paymentStatus || null,
      items: Array.isArray(linkedOrder?.items) ? linkedOrder.items : [],
      totalAmount: getReplacementTotalAmount(record, linkedOrder),
      notes: displayReplacementNumber ? `Replacement request ${displayReplacementNumber}` : String(linkedOrder?.notes || ''),
      isScheduledReplacement: true,
      __replacementRecord: record,
    }
  })
}

/** Damage-evidence photos, deduped across the record and its `Meta:` blob. */
export function getReplacementEvidenceUrls(record: any): string[] {
  const meta = parseReplacementMeta(record?.notes)
  return Array.from(
    new Set(
      [
        record?.damagePhotoUrl,
        ...(Array.isArray(record?.damagePhotoUrls) ? record.damagePhotoUrls : []),
        meta?.damagePhotoUrl,
        ...(Array.isArray(meta?.damagePhotos) ? meta.damagePhotos : []),
      ]
        .map((value: any) => String(value || '').trim())
        .filter(Boolean)
    )
  )
}

export type ReplacementPod = {
  recipientName: string
  deliveryPhoto: string
  submittedAt: string
  replacementOrderNumber: string
  show: boolean
}

/** POD for the replacement delivery, falling back through the linked order. */
export function getReplacementPod(record: any, linkedReplacementOrder: any | null): ReplacementPod {
  const pod = record?.replacementDeliveryPod || {}
  const recipientName = String(
    pod.recipientName ||
      linkedReplacementOrder?.pod?.recipientName ||
      linkedReplacementOrder?.progress?.pod?.recipientName ||
      ''
  ).trim()
  const deliveryPhoto = String(
    pod.deliveryPhoto ||
      linkedReplacementOrder?.pod?.deliveryPhoto ||
      linkedReplacementOrder?.progress?.pod?.deliveryPhoto ||
      linkedReplacementOrder?.deliveryPhoto ||
      ''
  ).trim()
  const submittedAt = String(
    pod.submittedAt ||
      linkedReplacementOrder?.pod?.submittedAt ||
      linkedReplacementOrder?.progress?.pod?.submittedAt ||
      ''
  ).trim()
  const replacementOrderNumber = String(
    record?.linkedReplacementOrderNumber || record?.replacementOrderNumber || ''
  ).trim()
  const show = Boolean(
    deliveryPhoto ||
      recipientName ||
      String(record?.linkedReplacementOrderId || record?.replacementOrderId || '').trim() ||
      replacementOrderNumber
  )
  return { recipientName, deliveryPhoto, submittedAt, replacementOrderNumber, show }
}

/** The web rewrites internal "spare product" wording for customers. */
export function sanitizeReplacementText(value: any): string {
  const raw = String(value || '').trim()
  if (!raw) return 'N/A'
  return raw
    .replace(/driver\s+spare\s+products?/gi, 'replacement products')
    .replace(/\bspare\s+products?\b/gi, 'replacement products')
}
