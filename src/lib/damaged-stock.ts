/**
 * Damaged stock, as the Inventory module shows it.
 *
 * Warehouse staff record damage against a stock batch (POST /api/damaged-stock); the
 * units leave sellable stock at once and the record then ends Disposed (a loss at
 * listed price), Returned to supplier, or Back in stock. Damaged items customers
 * report through replacement claims are listed beside them, read-only, with the
 * claim's own status.
 *
 * Pure helpers only, so `node --test` can load this file without the app's aliases.
 */

export type DamagedStockStatus = 'PENDING' | 'DISPOSED' | 'RETURNED_TO_SUPPLIER' | 'RESTOCKED'
export type DamagedStockCause =
  | 'BROKEN_IN_WAREHOUSE'
  | 'DAMAGED_IN_TRANSIT'
  | 'DAMAGED_ON_ARRIVAL'
  | 'LEAKING_OR_SPOILED'
  | 'OTHER'
export type DamagedStockAction = 'DISPOSE' | 'RETURN_TO_SUPPLIER' | 'RESTOCK'

export type DamagedStockRecord = {
  id: string
  recordNumber: string
  warehouseName: string
  productName: string
  productSku: string
  productSizes: string[]
  batchId: string | null
  batchNumber: string
  cases: number
  looseUnits: number
  casesOpened: number
  cause: DamagedStockCause
  description: string
  photoUrl: string | null
  status: DamagedStockStatus
  recordedBy: string | null
  recordedAt: string
  resolvedBy: string | null
  resolvedAt: string | null
  resolutionNotes: string | null
  lossAmount: number | null
  canManage: boolean
}

export type DamagedStockSummary = {
  pending: number
  disposed: number
  returnedToSupplier: number
  restocked: number
  lossAmount: number
}

export type CustomerDamageReport = {
  id: string
  replacementNumber: string
  orderNumber: string | null
  customerName: string | null
  productName: string
  productSizes: string[]
  quantity: number
  unitLabel: string
  reason: string
  description: string | null
  status: string
  reportedAt: string
}

export const DAMAGED_STOCK_CAUSES: ReadonlyArray<{ value: DamagedStockCause; label: string }> = [
  { value: 'BROKEN_IN_WAREHOUSE', label: 'Broken or dropped in the warehouse' },
  { value: 'DAMAGED_IN_TRANSIT', label: 'Damaged in transit' },
  { value: 'DAMAGED_ON_ARRIVAL', label: 'Damaged on arrival from the supplier' },
  { value: 'LEAKING_OR_SPOILED', label: 'Leaking or spoiled' },
  { value: 'OTHER', label: 'Other' },
]

export const DAMAGED_STOCK_STATUSES: ReadonlyArray<{ value: DamagedStockStatus; label: string; hint: string }> = [
  { value: 'PENDING', label: 'Pending', hint: 'Held out of sellable stock until someone decides what to do with it' },
  { value: 'DISPOSED', label: 'Disposed', hint: 'Written off as a loss at listed price' },
  { value: 'RETURNED_TO_SUPPLIER', label: 'Returned to supplier', hint: 'Sent back to the supplier; no loss recorded' },
  { value: 'RESTOCKED', label: 'Back in stock', hint: 'Found sellable and put back into its batch' },
]

export const DAMAGED_STOCK_ACTIONS: ReadonlyArray<{ value: DamagedStockAction; label: string; hint: string }> = [
  {
    value: 'DISPOSE',
    label: 'Dispose of it',
    hint: 'Records the loss at listed price. It appears with the disposed stock in reports.',
  },
  {
    value: 'RETURN_TO_SUPPLIER',
    label: 'Return to supplier',
    hint: 'For damage the supplier answers for. No loss is recorded; note the return reference.',
  },
  {
    value: 'RESTOCK',
    label: 'Put back into stock',
    hint: 'Only if inspection found it sellable. The units go back into the same batch.',
  },
]

const CAUSE_LABELS = Object.fromEntries(DAMAGED_STOCK_CAUSES.map((cause) => [cause.value, cause.label])) as Record<DamagedStockCause, string>
const STATUS_LABELS = Object.fromEntries(DAMAGED_STOCK_STATUSES.map((status) => [status.value, status.label])) as Record<DamagedStockStatus, string>

export const damagedStockCauseLabel = (cause: DamagedStockCause) => CAUSE_LABELS[cause]
export const damagedStockStatusLabel = (status: DamagedStockStatus) => STATUS_LABELS[status]

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** "2 cases and 7 bottles", the way the record was made. */
export function damagedQuantityLabel(cases: number, looseUnits: number): string {
  const parts = [cases ? plural(cases, 'case') : '', looseUnits ? plural(looseUnits, 'bottle') : ''].filter(Boolean)
  return parts.join(' and ') || 'Nothing'
}

/**
 * The replacement claim vocabulary of the Replacements page (see replacement-status),
 * from the normalized status the API sends.
 */
export function customerDamageStatusLabel(status: string): string {
  switch (String(status || '').toUpperCase()) {
    case 'UNDER_REVIEW': return 'Under Review'
    case 'APPROVED': return 'Approved'
    case 'IN_PROGRESS': return 'In Progress'
    case 'COMPLETED':
    case 'RESOLVED_ON_DELIVERY': return 'Completed'
    case 'REJECTED': return 'Rejected'
    case 'NEEDS_FOLLOW_UP': return 'Needs Follow-up'
    case 'CANCELLED': return 'Cancelled'
    default: return 'Reported'
  }
}

const text = (value: unknown) => String(value ?? '').trim()
const count = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}
const sizes = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : [])
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  allowed.includes(value as T) ? (value as T) : null

const CAUSES = DAMAGED_STOCK_CAUSES.map((cause) => cause.value)
const STATUSES = DAMAGED_STOCK_STATUSES.map((status) => status.value)

export function parseDamagedStockRecord(raw: unknown): DamagedStockRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = text(row.id)
  const status = oneOf(row.status, STATUSES)
  if (!id || !status) return null
  const loss = row.lossAmount === null || row.lossAmount === undefined ? null : Number(row.lossAmount)
  return {
    id,
    recordNumber: text(row.recordNumber),
    warehouseName: text(row.warehouseName),
    productName: text(row.productName) || 'Product',
    productSku: text(row.productSku),
    productSizes: sizes(row.productSizes),
    batchId: text(row.batchId) || null,
    batchNumber: text(row.batchNumber),
    cases: count(row.cases),
    looseUnits: count(row.looseUnits),
    casesOpened: count(row.casesOpened),
    cause: oneOf(row.cause, CAUSES) || 'OTHER',
    description: text(row.description),
    photoUrl: text(row.photoUrl) || null,
    status,
    recordedBy: text(row.recordedBy) || null,
    recordedAt: text(row.recordedAt),
    resolvedBy: text(row.resolvedBy) || null,
    resolvedAt: text(row.resolvedAt) || null,
    resolutionNotes: text(row.resolutionNotes) || null,
    lossAmount: loss !== null && Number.isFinite(loss) ? loss : null,
    canManage: row.canManage === true,
  }
}

export function parseDamagedStockRecords(raw: unknown): DamagedStockRecord[] {
  return (Array.isArray(raw) ? raw : [])
    .map(parseDamagedStockRecord)
    .filter((row): row is DamagedStockRecord => row !== null)
}

export function parseDamagedStockSummary(raw: unknown): DamagedStockSummary {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const loss = Number(row.lossAmount)
  return {
    pending: count(row.pending),
    disposed: count(row.disposed),
    returnedToSupplier: count(row.returnedToSupplier),
    restocked: count(row.restocked),
    lossAmount: Number.isFinite(loss) ? loss : 0,
  }
}

export function parseCustomerDamageReports(raw: unknown): CustomerDamageReport[] {
  return (Array.isArray(raw) ? raw : []).flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const row = value as Record<string, unknown>
    const id = text(row.id)
    if (!id) return []
    return [{
      id,
      replacementNumber: text(row.replacementNumber),
      orderNumber: text(row.orderNumber) || null,
      customerName: text(row.customerName) || null,
      productName: text(row.productName) || 'Product',
      productSizes: sizes(row.productSizes),
      quantity: count(row.quantity),
      unitLabel: text(row.unitLabel) || 'unit',
      reason: text(row.reason),
      description: text(row.description) || null,
      status: text(row.status),
      reportedAt: text(row.reportedAt),
    }]
  })
}

/** "6 bottles", from a claim line counted in its base unit. */
export function customerDamageQuantityLabel(report: Pick<CustomerDamageReport, 'quantity' | 'unitLabel'>): string {
  const unit = report.unitLabel.toLowerCase().replace(/s$/, '') || 'unit'
  return plural(report.quantity, unit)
}

/** A product with its size, unless the name already carries it ("Pepsi 12oz"). */
export function productWithSize(name: string, productSizes: string[]): string {
  const size = productSizes.join(', ')
  return size && !name.toLowerCase().includes(size.toLowerCase()) ? `${name} ${size}` : name
}

/** A fresh retry key for one recording; reused for every retry of that same recording. */
export function newDamagedStockRequestId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoApi?.randomUUID) return `damaged-${cryptoApi.randomUUID()}`
  return `damaged-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
