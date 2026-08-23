'use client'

import { useMemo, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Package,
  Search,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PortalCardsSkeleton } from '@/components/portals/shared/loading-skeletons'
import { formatLooseQuantity, getLooseUnitFromRecord } from '@/lib/beverage-category-specs'

const PAGE_SIZE = 10

// ─── Status helpers ───────────────────────────────────────────────────────────

type PRStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

function normalizePRStatus(value: any): PRStatus {
  const raw = String(value || '')
    .trim()
    .toUpperCase()
  if (raw === 'APPROVED') return 'APPROVED'
  if (raw === 'REJECTED') return 'REJECTED'
  if (raw === 'CANCELLED' || raw === 'CANCELED') return 'CANCELLED'
  return 'PENDING_APPROVAL'
}

function getStatusConfig(status: PRStatus): {
  label: string
  message: string
  icon: React.ReactNode
  badgeClass: string
  dotClass: string
} {
  switch (status) {
    case 'APPROVED':
      return {
        label: 'Approved',
        message: 'Your purchase request has been approved. A purchase order has been created.',
        icon: <CheckCircle2 className="h-4 w-4" />,
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dotClass: 'bg-emerald-500',
      }
    case 'REJECTED':
      return {
        label: 'Rejected',
        message: 'Your purchase request was not approved.',
        icon: <XCircle className="h-4 w-4" />,
        badgeClass: 'bg-red-50 text-red-700 border-red-200',
        dotClass: 'bg-red-500',
      }
    case 'CANCELLED':
      return {
        label: 'Cancelled',
        message: 'This purchase request has been cancelled.',
        icon: <CircleAlert className="h-4 w-4" />,
        badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
        dotClass: 'bg-slate-400',
      }
    default:
      return {
        label: 'Pending Review',
        message: 'Your purchase request is currently being reviewed.',
        icon: <Clock3 className="h-4 w-4" />,
        badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
        dotClass: 'bg-amber-400',
      }
  }
}

// ─── Item helpers ─────────────────────────────────────────────────────────────

function getItemDisplayName(item: any): string {
  if (item?.itemType === 'MIXED_CASE') {
    const capacity = item?.caseCapacity || 0
    const comps: string[] = (item?.components || []).map(
      (c: any) => `${c.productName} ${c.quantityPerCase}/case`
    )
    return `Mixed Case (${capacity} units)${comps.length ? ' — ' + comps.join(', ') : ''}`
  }
  const name = String(item?.product?.name || item?.productName || 'Product').trim()
  const sizes = Array.isArray(item?.product?.sizes) ? item.product.sizes : []
  const sizeStr = sizes.length > 0 ? sizes.map((s: any) => String(s).trim()).join(', ') : ''
  const sizeLabel =
    sizeStr ||
    String(item?.product?.size || item?.product?.sizeLabel || '').trim()
  return sizeLabel ? `${name} ${sizeLabel}` : name
}

function getItemQtyLabel(item: any): string {
  const qty = Number(item?.quantity || 0)
  if (item?.itemType === 'MIXED_CASE')
    return `${qty} mixed case${qty === 1 ? '' : 's'}`
  return formatLooseQuantity(qty, getLooseUnitFromRecord(item))
}

// ─── Purchase Request Card ────────────────────────────────────────────────────

function PurchaseRequestCard({
  order,
  formatPeso,
  onViewPurchaseOrder,
}: {
  order: any
  formatPeso: (n: number) => string
  onViewPurchaseOrder?: (order: any) => void
}) {
  const status = normalizePRStatus(order?.requestStatus || order?.approvalStatus)
  const config = getStatusConfig(status)

  // ID to display — prefer purchaseRequestNumber, fallback to orderNumber
  const displayId =
    // Approved requests show the generated PO ID; all other states retain the PR ID.
    (status === 'APPROVED' ? String(order?.purchaseOrderNumber || '').trim() : '') ||
    String(order?.purchaseRequestNumber || '').trim() ||
    String(order?.orderNumber || '').trim()

  const submittedAt = order?.createdAt
    ? new Date(order.createdAt).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'N/A'

  const reviewedAt =
    order?.approvedAt || order?.dateApproved || order?.rejectedAt || order?.updatedAt
  const reviewedAtText =
    reviewedAt && status !== 'PENDING_APPROVAL'
      ? new Date(reviewedAt).toLocaleDateString('en-PH', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : null

  const items: any[] = Array.isArray(order?.items) ? order.items : []
  const rejectionReason = String(
    order?.rejectionReason || order?.cancellationReason || ''
  ).trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-shadow hover:shadow-md">
      {/* ── Header row ── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${config.dotClass}`} />
            <p className="text-[17px] font-bold tracking-tight text-slate-900">{displayId}</p>
          </div>
          <div className="flex items-center gap-1.5 pl-4">
            <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
            <p className="text-xs text-slate-500">Submitted: {submittedAt}</p>
          </div>
          {reviewedAtText && (
            <div className="flex items-center gap-1.5 pl-4">
              <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
              <p className="text-xs text-slate-500">
                {status === 'APPROVED' ? 'Approved' : status === 'REJECTED' ? 'Rejected' : 'Updated'}:{' '}
                {reviewedAtText}
              </p>
            </div>
          )}
        </div>

        {/* Status badge */}
        <Badge
          variant="outline"
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${config.badgeClass}`}
        >
          {config.icon}
          {config.label}
        </Badge>
      </div>

      {/* ── Items ── */}
      {items.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Requested Items
          </p>
          {items.map((item: any, idx: number) => (
            <div key={item?.id || idx} className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <p className="text-sm text-slate-700">{getItemDisplayName(item)}</p>
              </div>
              <p className="shrink-0 text-sm font-medium text-slate-600">
                {getItemQtyLabel(item)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── Amount ── */}
      {typeof order?.totalAmount === 'number' && (
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">Estimated Total</p>
          <p className="text-sm font-bold text-slate-900">{formatPeso(order.totalAmount)}</p>
        </div>
      )}

      {/* ── Status message ── */}
      <div
        className={`mt-3 rounded-lg border px-3 py-2.5 ${
          status === 'APPROVED'
            ? 'border-emerald-200 bg-emerald-50'
            : status === 'REJECTED'
              ? 'border-red-200 bg-red-50'
              : status === 'CANCELLED'
                ? 'border-slate-200 bg-slate-50'
                : 'border-amber-200 bg-amber-50'
        }`}
      >
        <p
          className={`text-xs ${
            status === 'APPROVED'
              ? 'text-emerald-700'
              : status === 'REJECTED'
                ? 'text-red-700'
                : status === 'CANCELLED'
                  ? 'text-slate-600'
                  : 'text-amber-700'
          }`}
        >
          {config.message}
        </p>

        {/* Rejection / cancellation reason */}
        {rejectionReason && (status === 'REJECTED' || status === 'CANCELLED') && (
          <div className="mt-1.5 border-t border-dashed border-red-200 pt-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-red-500">
              Reason
            </p>
            <p className="mt-0.5 text-xs text-red-700">{rejectionReason}</p>
          </div>
        )}
      </div>

      {/* ── Action: view linked PO ── */}
      {status === 'APPROVED' && onViewPurchaseOrder && (
        <div className="mt-3 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg border-emerald-300 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            onClick={() => onViewPurchaseOrder(order)}
          >
            View Purchase Order →
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function CustomerPurchaseRequestView(props: any) {
  const {
    orders = [],
    isLoading = false,
    formatPeso,
    setActiveView,
    setSelectedOrder,
  } = props

  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  // All orders are shown on this page; the PR status is the focus
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const source: any[] = Array.isArray(orders) ? orders : []

    // Exclude replacement orders from the PR page
    const nonReplacement = source.filter(
      (o) =>
        !String(o?.orderNumber || '')
          .trim()
          .toUpperCase()
          .startsWith('RPL-') && !o?.isScheduledReplacement
    )

    if (!query) return nonReplacement

    return nonReplacement.filter((order) => {
      const prNum = String(order?.purchaseRequestNumber || order?.orderNumber || '').toLowerCase()
      const itemNames = (order?.items || [])
        .map((i: any) => getItemDisplayName(i).toLowerCase())
        .join(' ')
      const status = normalizePRStatus(order?.requestStatus || order?.approvalStatus).toLowerCase()
      return (
        prNum.includes(query) ||
        itemNames.includes(query) ||
        status.includes(query)
      )
    })
  }, [orders, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const activePage = Math.min(currentPage, totalPages)
  const pagedItems = filtered.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE)

  const isEmpty = !isLoading && filtered.length === 0

  return (
    <section className="-mx-4 min-h-[calc(100dvh-7rem)] bg-[#f8fafc] pb-5 md:mx-0 md:rounded-2xl md:border md:border-slate-200 md:bg-white">
      {/* ── Header ── */}
      <div className="border-b border-slate-200 px-3 py-3 md:px-4">
        <h2 className="text-[26px] font-extrabold tracking-[-0.02em] text-slate-900 md:text-[30px]">
          Purchase Request
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Track the status of your submitted purchase requests.
        </p>

        {/* Search */}
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <Search className="h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setCurrentPage(1)
            }}
            placeholder="Search by ID or item..."
            className="h-auto border-0 bg-transparent p-0 text-xs text-slate-700 shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      {/* ── Body ── */}
      {isLoading ? (
        <PortalCardsSkeleton cards={4} />
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
            <Clock3 className="h-7 w-7 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-700">No purchase requests yet</p>
          <p className="mt-1 text-xs text-slate-500">
            {search
              ? 'No requests match your search.'
              : 'Your submitted purchase requests will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3 px-3 pt-3 md:px-4">
          {pagedItems.map((order: any) => (
            <PurchaseRequestCard
              key={order.id}
              order={order}
              formatPeso={formatPeso}
              onViewPurchaseOrder={
                normalizePRStatus(order?.requestStatus || order?.approvalStatus) === 'APPROVED'
                  ? (o: any) => {
                      setSelectedOrder?.(o)
                      setActiveView?.('orders')
                    }
                  : undefined
              }
            />
          ))}

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-3 pb-1">
              <p className="text-xs text-slate-500">
                {(activePage - 1) * PAGE_SIZE + 1}–
                {Math.min(activePage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md"
                  onClick={() => setCurrentPage(Math.max(1, activePage - 1))}
                  disabled={activePage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[2rem] text-center text-xs font-medium text-slate-700">
                  {activePage}/{totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-md"
                  onClick={() => setCurrentPage(Math.min(totalPages, activePage + 1))}
                  disabled={activePage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
