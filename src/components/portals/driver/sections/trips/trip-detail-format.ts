import { speakDriverNavigation } from '@/lib/native/driver-speech'
import { toast } from 'sonner'
import { formatDistance, getManeuverLabel, type OsrmStep } from '@/components/shared/NavInstructionsPanel'

/**
 * Display formatting for the trip detail screen: money, dates, item names and quantities, schedule labels, and the spoken navigation prompts.
 */

export const dropPointStatusColors: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border border-amber-200',
  IN_TRANSIT: 'bg-cyan-100 text-cyan-800 border border-cyan-200',
  ARRIVED: 'bg-sky-100 text-sky-800 border border-sky-200',
  COMPLETED: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  FAILED: 'bg-rose-100 text-rose-800 border border-rose-200',
  CANCELLED: 'bg-slate-200 text-slate-800 border border-slate-300',
}

export const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2,
  }).format(amount)

export const formatDateTime = (value: string | null | undefined) => {
  const raw = String(value || '').trim()
  if (!raw) return 'Not set'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const getItemDisplayNameWithSize = (item: any): string => {
  if (item?.itemType === 'MIXED_CASE') {
    const components = (item?.components || []).map((component: any) => `${component.productName} ${component.quantityPerCase}/case`).join(', ')
    return `Mixed Case (${item.caseCapacity || 0} units)${components ? ` — ${components}` : ''}`
  }
  const product = item?.product || {}
  const baseName = String(product?.name || item?.productName || 'Item').trim()
  const sizeFromArray = Array.isArray(product?.sizes) && product.sizes.length > 0
    ? product.sizes.map((value: any) => String(value).trim()).filter(Boolean).join(', ')
    : ''
  const sizeFromField = String(product?.size || product?.sizeLabel || item?.size || '').trim()
  // Fix: show the stored size without parentheses, including when it is already in the name.
  const sizeLabel = (sizeFromArray || sizeFromField).replace(/[()]/g, '').trim()
  if (!sizeLabel) return baseName
  const nameWithPlainSize = baseName.replace(/\(([^()]*)\)/g, (match, value: string) =>
    value.trim().toLowerCase() === sizeLabel.toLowerCase() ? value.trim() : match
  )
  return nameWithPlainSize.toLowerCase().includes(sizeLabel.toLowerCase())
    ? nameWithPlainSize
    : `${nameWithPlainSize} ${sizeLabel}`
}

export const getItemCategoryLabel = (item: any): string => {
  const product = item?.product || {}
  return String(
    product?.categoryName ||
    product?.category ||
    product?.productCategory ||
    item?.category ||
    ''
  ).trim()
}

export const getMatchedReplacementLine = (item: any, order?: any): any | null => {
  const scheduledReplacement = order?.scheduledReplacement || null
  const replacementLines = Array.isArray(scheduledReplacement?.replacementLines)
    ? scheduledReplacement.replacementLines
    : Array.isArray(scheduledReplacement?.replacementItems)
      ? scheduledReplacement.replacementItems
      : []
  const productId = String(item?.product?.id || item?.productId || '').trim()
  const productName = String(item?.product?.name || item?.productName || '').trim().toLowerCase()
  return replacementLines.find((line: any) => {
    const replacementProductId = String(line?.replacementProductId || line?.originalProductId || '').trim()
    const replacementProductName = String(line?.replacementProductName || line?.originalProductName || line?.productName || '').trim().toLowerCase()
    return (productId && replacementProductId && productId === replacementProductId) || (productName && replacementProductName && productName === replacementProductName)
  }) || (replacementLines.length === 1 ? replacementLines[0] : null)
}

export const getOrderQtyWithUnitLabel = (item: any, order?: any): string => {
  if (item?.itemType === 'MIXED_CASE') {
    const qty = Math.max(0, Number(item?.quantity || 0))
    return `x${qty} mixed case${qty === 1 ? '' : 's'}`
  }
  const orderNumber = String(order?.orderNumber || '').trim().toUpperCase()
  const scheduledReplacement = order?.scheduledReplacement || null
  const matchedReplacementLine = getMatchedReplacementLine(item, order)

  const itemNotes = String(item?.notes || '')
  const isBottleFromNotes = /ReplacementUnitMode=BOTTLE/i.test(itemNotes)
  const bottlesFromNotesMatch = itemNotes.match(/ReplacementRequestedBottles=(\d+)/i)
  const bottlesFromNotes = bottlesFromNotesMatch ? parseInt(bottlesFromNotesMatch[1], 10) : 0

  const formatCountUnit = (count: number, rawUnitStr: string) => {
    const u = String(rawUnitStr || '').toLowerCase()
    const singular = u.includes('bottle') ? 'bottle' : u.includes('case') ? 'case' : u.includes('pack') ? 'pack' : u.includes('bundle') ? 'bundle' : 'unit'
    // Fix: keep case/bottle labels in the requested form while respecting the recorded unit.
    const label = count === 1 || singular === 'case' || singular === 'bottle' ? singular : `${singular}s`
    return `x${count} ${label}`
  }

  if (orderNumber.startsWith('RPL-') || Boolean((order as any)?.isScheduledReplacement)) {
    if (isBottleFromNotes && bottlesFromNotes > 0) {
      return formatCountUnit(bottlesFromNotes, 'bottle')
    }
    if (matchedReplacementLine?.quantityToReplaceDisplay) {
      let display = String(matchedReplacementLine.quantityToReplaceDisplay).trim()
      const matchNum = display.match(/^(\d+(?:\.\d+)?)/)
      const numVal = matchNum ? parseFloat(matchNum[1]) : 1
      display = display.replace(/\(s\)/gi, numVal === 1 ? '' : 's').replace(/\s+/g, ' ')
      return display.startsWith('x') ? display : `x${display}`
    }
    if (matchedReplacementLine) {
      const lineInputMode = String(matchedReplacementLine?.lineInputMode || matchedReplacementLine?.replacementInputMode || '').trim().toLowerCase()
      const lineQtyBottles = Math.max(0, Number(matchedReplacementLine?.quantityToReplaceBottles || 0))
      const lineQty = Math.max(0, Number(matchedReplacementLine?.quantityToReplace || 0))
      const lineQtyCases = Math.max(0, Number(matchedReplacementLine?.quantityToReplaceCases ?? matchedReplacementLine?.quantityToReplaceUnits ?? 0))
      const rawUnit = String(
        matchedReplacementLine?.replacementProductUnit ||
        matchedReplacementLine?.originalProductUnit ||
        item?.productUnit ||
        item?.product?.unit ||
        ''
      ).trim().toLowerCase()

      if (lineInputMode === 'bottle' || lineQtyBottles > 0 || rawUnit.includes('bottle')) {
        const qty = lineQtyBottles > 0 ? lineQtyBottles : lineQty
        return formatCountUnit(qty, 'bottle')
      }
      if (lineQtyCases > 0) {
        return formatCountUnit(lineQtyCases, rawUnit || 'case')
      }
      if (lineQty > 0) {
        return formatCountUnit(lineQty, rawUnit || 'case')
      }
    }
    if (scheduledReplacement) {
      if (scheduledReplacement.unitMode === 'BOTTLE' && scheduledReplacement.quantityToReplace > 0) {
        return formatCountUnit(scheduledReplacement.quantityToReplace, 'bottle')
      }
    }
  }
  const qty = Math.max(0, Number(item?.quantity || 0))
  const rawUnit = String(item?.productUnit || item?.product?.unit || '').trim().toLowerCase()
  return formatCountUnit(qty, rawUnit)
}

export const getDisplayOrderTotal = (order?: any): number => {
  const orderNumber = String(order?.orderNumber || '').trim().toUpperCase()
  const items = Array.isArray(order?.items) ? order.items : []
  const scheduledReplacement = order?.scheduledReplacement || null
  if (!orderNumber.startsWith('RPL-') || !scheduledReplacement || items.length === 0) {
    return Number(order?.totalAmount || 0)
  }

  let computedTotal = 0
  for (const item of items) {
    const matchedReplacementLine = getMatchedReplacementLine(item, order)
    const unitPrice = Number(item?.unitPrice ?? item?.price ?? item?.product?.price ?? 0)
    if (!matchedReplacementLine || unitPrice <= 0) {
      computedTotal += Number(item?.totalPrice ?? item?.subtotal ?? (Number(item?.quantity || 0) * unitPrice))
      continue
    }

    const lineInputMode = String(matchedReplacementLine?.lineInputMode || matchedReplacementLine?.replacementInputMode || '').trim().toLowerCase()
    const rawUnit = String(
      matchedReplacementLine?.replacementProductUnit ||
      matchedReplacementLine?.originalProductUnit ||
      item?.productUnit ||
      item?.product?.unit ||
      ''
    ).trim().toLowerCase()
    const qtyPerUnit = Math.max(
      1,
      Number(
        matchedReplacementLine?.qtyPerUnit ||
        matchedReplacementLine?.quantityPerCase ||
        item?.quantityPerCase ||
        item?.product?.quantityPerCase ||
        scheduledReplacement?.qtyPerUnit ||
        1
      )
    )

    if (lineInputMode === 'bottle' && !rawUnit.includes('bottle')) {
      const bottleQty = Math.max(0, Number(matchedReplacementLine?.quantityToReplaceBottles || matchedReplacementLine?.quantityToReplace || 0))
      computedTotal += unitPrice * (bottleQty / qtyPerUnit)
      continue
    }

    const caseQty = Math.max(0, Number(matchedReplacementLine?.quantityToReplaceCases ?? matchedReplacementLine?.quantityToReplaceUnits ?? 0))
    const fallbackQty = Math.max(0, Number(item?.quantity || 0))
    computedTotal += unitPrice * (caseQty > 0 ? caseQty : fallbackQty)
  }

  return computedTotal > 0 ? computedTotal : Number(order?.totalAmount || 0)
}

export const formatTripSchedule = (value: string | null | undefined) => {
  const raw = String(value || '').trim()
  if (!raw) return 'Not set'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export const isTripScheduledToday = (value: string | null | undefined) => {
  const scheduledAt = new Date(String(value || '').trim())
  if (Number.isNaN(scheduledAt.getTime())) return false
  const today = new Date()
  return scheduledAt.getFullYear() === today.getFullYear()
    && scheduledAt.getMonth() === today.getMonth()
    && scheduledAt.getDate() === today.getDate()
}

// Added: trip days are Philippine calendar days on the server (trip_start and the
// serializer's scheduledDate), so the portal compares against Manila's date too,
// whatever timezone the phone is set to.
const MANILA_DATE_KEY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** YYYY-MM-DD of an instant (default: now) on the Philippine calendar. */
export const toManilaDateKey = (value: Date | string | null | undefined = new Date()): string | null => {
  if (value === null || value === undefined || value === '') return null
  const instant = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(instant.getTime())) return null
  return MANILA_DATE_KEY_FORMAT.format(instant)
}

/** The day the trip is due: the server's scheduledDate, else the legacy timestamps. */
export const getTripScheduledDateKey = (trip: any): string | null => {
  const serverKey = String(trip?.scheduledDate || '').trim()
  if (DATE_KEY_PATTERN.test(serverKey)) return serverKey
  // Offline or older payloads: derive it the same way the server does.
  const deliveryKeys = (Array.isArray(trip?.dropPoints) ? trip.dropPoints : [])
    .map((point: any) => toManilaDateKey(point?.order?.deliveryDate || null))
    .filter((key: string | null): key is string => Boolean(key))
    .sort()
  if (deliveryKeys.length > 0) return deliveryKeys[0]
  return toManilaDateKey(trip?.tripSchedule || trip?.plannedStartAt || null)
}

/** A planned trip whose day has passed; it can no longer be started. */
export const isTripOverdue = (trip: any): boolean => {
  if (String(trip?.status || '').toUpperCase() !== 'PLANNED') return false
  if (typeof trip?.isOverdue === 'boolean') return trip.isOverdue
  const scheduledKey = getTripScheduledDateKey(trip)
  const todayKey = toManilaDateKey()
  return Boolean(scheduledKey && todayKey && scheduledKey < todayKey)
}

/** Formats a YYYY-MM-DD day key without letting the device timezone shift it. */
export const formatScheduledDateKey = (key: string | null | undefined) => {
  const raw = String(key || '').trim()
  if (!DATE_KEY_PATTERN.test(raw)) return formatTripSchedule(raw)
  const [year, month, day] = raw.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Shows the trip's due day, preferring the server-computed scheduledDate. */
export const formatTripScheduledDay = (trip: any) =>
  trip?.scheduledDate ? formatScheduledDateKey(trip.scheduledDate) : formatTripSchedule(trip?.tripSchedule)

// Shared by My Deliveries and History so a status reads the same on both screens.
export const tripStatusBadgeColors: Record<string, string> = {
  PLANNED: 'bg-sky-100 text-sky-800 border border-sky-200',
  IN_PROGRESS: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
  COMPLETED: 'bg-teal-100 text-teal-800 border border-teal-200',
  CANCELLED: 'bg-rose-100 text-rose-800 border border-rose-200',
  OVERDUE: 'bg-amber-100 text-amber-800 border border-amber-200',
}

/** PLANNED trips past their day display as OVERDUE; every other status as-is. */
export const getTripDisplayStatus = (trip: any): string =>
  isTripOverdue(trip) ? 'OVERDUE' : String(trip?.status || '').toUpperCase()

// The server returns these verbatim (views_trip_ops.trip_start); the portal repeats them.
export const ACTIVE_TRIP_BLOCK_MESSAGE =
  'You already have an active trip. Complete your current trip before starting another delivery.'
export const getOverdueTripMessage = (trip: any) => {
  const scheduledKey = getTripScheduledDateKey(trip)
  return scheduledKey
    ? `This trip was scheduled for ${scheduledKey} and that date has passed. It can no longer be started.`
    : 'This trip\'s scheduled date has passed. It can no longer be started.'
}

export const speakNavigationPrompt = (message: string) => {
  // Fix: Android speaks through its TTS engine; the web retains its existing voice settings.
  void speakDriverNavigation(message).catch((error) => {
    toast.error(error instanceof Error ? error.message : 'Voice guidance could not play.', { id: 'driver-voice-error' })
  })
}

export const buildVoicePrompt = (
  step: OsrmStep,
  {
    distanceMeters,
    immediate = false,
    finalPrompt = false,
  }: {
    distanceMeters?: number
    immediate?: boolean
    finalPrompt?: boolean
  } = {}
) => {
  const label = getManeuverLabel(step.maneuver.type, step.maneuver.modifier, step.name)
  if (finalPrompt) {
    return `Arriving now. ${label}.`
  }
  if (immediate || typeof distanceMeters !== 'number') {
    return label
  }
  const roundedDistance = Math.max(10, Math.round(distanceMeters / 10) * 10)
  return `In ${formatDistance(roundedDistance)}, ${label.charAt(0).toLowerCase()}${label.slice(1)}`
}
