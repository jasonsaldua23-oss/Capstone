/**
 * The one reading of purchase requests and purchase orders.
 *
 * The Reports tabs and the Purchase Requests / Purchase Orders tabs of both staff
 * portals each derived status, amount and date on their own, and they disagreed.
 * An approved PO read "Approved PO" in the report, "APPROVED" in the warehouse
 * table, "PENDING" in the warehouse detail dialog and "PROCESSING" in the admin
 * table. The PR tabs showed the live PO total (with later empties charges) while
 * the report showed the locked request. Every one of those screens now reads
 * through this module. Staff PO date filters use the displayed delivery schedule;
 * PO reports use the document's approval date.
 */

import { buildReportDateWindow, matchesReportDateWindow } from '../components/portals/admin/sections/report-date-utils'
import { isCancelledReportStatus, isIssuedPurchaseOrder } from './report-metrics'

export { isIssuedPurchaseOrder }

export type PurchaseRequestStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export type PurchaseOrderStage =
  | 'APPROVED'
  | 'PROCESSING'
  | 'RESCHEDULED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'

export const PURCHASE_REQUEST_STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

export const PURCHASE_ORDER_STAGE_LABELS: Record<PurchaseOrderStage, string> = {
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  RESCHEDULED: 'Rescheduled',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

const upper = (value: unknown) => String(value || '').trim().toUpperCase()

function isReplacementTransaction(order: any) {
  return Boolean(order?.isScheduledReplacement) || upper(order?.orderNumber || order?.order_number).startsWith('RPL-')
}

/**
 * A PR as the customer submitted it. Approved requests are locked snapshots, so
 * later PO changes (empties charges, cancellations) never rewrite the request.
 * The transaction id is unchanged, so approve/reject still target the right row.
 */
export function toPurchaseRequestRecord(order: any): any {
  const snapshot = order?.purchaseRequest?.snapshot
  return snapshot ? { ...order, ...snapshot } : order
}

/** Only real PR documents; a transaction left behind after its PR was deleted is not one. */
export function isPurchaseRequestDocument(order: any): boolean {
  if (!order?.purchaseRequest) return false
  if (upper(order?.salesChannel) === 'RETAIL_POS') return false
  return !isReplacementTransaction(order)
}

export function getPurchaseRequestStatus(record: any): PurchaseRequestStatus {
  const requestStatus = upper(record?.requestStatus || record?.request_status)
  if (requestStatus === 'PENDING' || requestStatus === 'PENDING_APPROVAL') return 'PENDING_APPROVAL'
  if (requestStatus === 'APPROVED' || requestStatus === 'REJECTED') return requestStatus
  if (isCancelledReportStatus(requestStatus)) return 'CANCELLED'

  // Legacy rows without a request decision: infer it from the order status.
  const status = upper(record?.status)
  if (isCancelledReportStatus(status)) return 'CANCELLED'
  if (status === 'REJECTED') return 'REJECTED'
  if (!status || status === 'PENDING') return 'PENDING_APPROVAL'
  return 'APPROVED'
}

const STAGE_BY_ORDER_STATUS: Record<string, PurchaseOrderStage> = {
  APPROVED: 'APPROVED',
  PREPARING: 'PROCESSING',
  PROCESSING: 'PROCESSING',
  RESCHEDULED: 'RESCHEDULED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  IN_TRANSIT: 'OUT_FOR_DELIVERY',
  DISPATCHED: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'DELIVERED',
  FULFILLED: 'DELIVERED',
  REJECTED: 'CANCELLED',
}

const STAGE_BY_STORED_STAGE: Record<string, PurchaseOrderStage> = {
  APPROVED: 'APPROVED',
  PROCESSING: 'PROCESSING',
  // Reports have always folded these into Processing; no workflow sets them today.
  READY_FOR_DELIVERY: 'PROCESSING',
  FOR_DELIVERY: 'PROCESSING',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'DELIVERED',
}

/**
 * The live order status is authoritative for an issued PO (the API derives the
 * stored stage from it the same way). Rescheduled stays visible as its own stage:
 * the API files it back under Approved, but staff must act on the new date.
 */
export function getPurchaseOrderStage(order: any): PurchaseOrderStage {
  const status = upper(order?.status)
  if (isCancelledReportStatus(status)) return 'CANCELLED'
  const fromStatus = STAGE_BY_ORDER_STATUS[status]
  if (fromStatus) return fromStatus

  const stored = upper(order?.purchaseOrderStage || order?.purchase_order_stage)
  if (isCancelledReportStatus(stored) || stored === 'REJECTED') return 'CANCELLED'
  return STAGE_BY_STORED_STAGE[stored] || 'APPROVED'
}

/** The document's own total; empties shortfall charges are a separate deposit. */
export function getPurchaseDocumentAmount(order: any): number {
  const total = order?.totalAmount ?? order?.total_amount
  const amount = Number(total ?? order?.subtotal ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

export function getPurchaseRequestDate(record: any): string {
  return String(record?.createdAt || record?.created_at || '')
}

/** A PO comes into existence when its request is approved. */
export function getPurchaseOrderDate(order: any): string {
  return String(order?.approvedAt || order?.approved_at || order?.createdAt || order?.created_at || '')
}

/** Staff PO date filters follow the scheduled Delivery Date shown in the table. */
export function getPurchaseOrderDeliveryDate(order: any): string {
  return String(order?.deliveryDate || order?.timeline?.deliveryDate || '').trim()
}

export type PurchaseDatePreset = 'all' | 'today' | '7' | '30' | '90' | '365' | 'custom'

// Same presets as the Reports tabs, so a tab filter and a report filter agree.
export const PURCHASE_DATE_PRESET_OPTIONS: Array<{ value: PurchaseDatePreset; label: string }> = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Past 7 days' },
  { value: '30', label: 'Past 30 days' },
  { value: '90', label: 'Past 90 days' },
  { value: '365', label: 'Past 1 year' },
  { value: 'custom', label: 'Custom date' },
]

function toLocalDayKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Whether a timestamp falls in a preset window. Presets reuse the report cutoff;
 * a custom day compares the local calendar date, because slicing the ISO string
 * reads the UTC date and put early-morning Manila orders on the previous day.
 */
export function matchesPurchaseDatePreset(
  value: unknown,
  preset: PurchaseDatePreset,
  customDate = '',
  now: Date = new Date(),
): boolean {
  if (preset === 'all' || (preset === 'custom' && !customDate)) return true
  if (!value) return false
  // Fix: date-only delivery schedules are local calendar days, not UTC midnight.
  const raw = String(value).trim()
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw)
  if (Number.isNaN(date.getTime())) return false
  if (preset === 'custom') return toLocalDayKey(date) === customDate
  // Fix: past-day presets end today, so future documents do not leak into them.
  return matchesReportDateWindow(date.toISOString(), buildReportDateWindow(preset, undefined, undefined, now))
}

// Staff reasons and empties shortfalls are appended to the same notes field.
const SYSTEM_NOTE_PREFIXES = ['Order Note:', 'Empties shortfall on delivery:']

/** The note the customer typed at checkout, without lines the system appended later. */
export function getCustomerOrderNote(order: any): string {
  return String(order?.notes || '')
    .split('\n')
    .filter((line) => !SYSTEM_NOTE_PREFIXES.some((prefix) => line.trim().startsWith(prefix)))
    .join('\n')
    .trim()
}
