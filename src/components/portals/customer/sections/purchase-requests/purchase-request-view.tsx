'use client'

import { useMemo, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  MapPin,
  Package2,
  Search,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PortalCardsSkeleton } from '@/components/portals/shared/loading-skeletons'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { formatOrderedQuantityWithContainer } from '../orders/order-item-display'

const PAGE_SIZE = 10

// ─── Status helpers ───────────────────────────────────────────────────────────

export type PRStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export function normalizePRStatus(value: any): PRStatus {
  const raw = String(value || '')
    .trim()
    .toUpperCase()
  if (raw === 'APPROVED') return 'APPROVED'
  if (raw === 'REJECTED') return 'REJECTED'
  if (raw === 'CANCELLED' || raw === 'CANCELED') return 'CANCELLED'
  return 'PENDING_APPROVAL'
}

export function getStatusConfig(status: PRStatus): {
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
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        badgeClass: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200',
        dotClass: 'bg-emerald-500',
      }
    case 'REJECTED':
      return {
        label: 'Rejected',
        message: 'Your purchase request was not approved.',
        icon: <XCircle className="h-3.5 w-3.5" />,
        badgeClass: 'bg-red-100 text-red-700 hover:bg-red-100 border-red-200',
        dotClass: 'bg-red-500',
      }
    case 'CANCELLED':
      return {
        label: 'Cancelled',
        message: 'This purchase request has been cancelled.',
        icon: <CircleAlert className="h-3.5 w-3.5" />,
        badgeClass: 'bg-rose-100 text-rose-700 hover:bg-rose-100 border-rose-200',
        dotClass: 'bg-rose-500',
      }
    default:
      return {
        label: 'Pending Review',
        message: 'Your purchase request is currently being reviewed by warehouse staff.',
        icon: <Clock3 className="h-3.5 w-3.5" />,
        badgeClass: 'bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200',
        dotClass: 'bg-amber-400',
      }
  }
}

// ─── Item formatters ──────────────────────────────────────────────────────────

function getItemDisplayNameWithSize(item: any): string {
  if (item?.itemType === 'MIXED_CASE') {
    return 'Mixed Case'
  }
  const baseName = String(item?.product?.name || item?.productName || 'Product').trim()
  const product = item?.product || {}
  const sizeFromArray =
    Array.isArray(product?.sizes) && product.sizes.length > 0
      ? product.sizes.map((s: any) => String(s).trim()).filter(Boolean).join(', ')
      : ''
  const sizeFromField = String(product?.size || product?.sizeLabel || item?.size || '').trim()
  const sizeLabel = sizeFromArray || sizeFromField
  return sizeLabel ? `${baseName} ${sizeLabel}` : baseName
}

function formatQuantityWithUnit(item: any): string {
  // Purchase requests use the ordered container (Case, Pack, etc.), matching purchase orders.
  return formatOrderedQuantityWithContainer(item)
}

function formatDateTime(rawDate: any): { date: string; time: string | null } {
  const raw = String(rawDate || '').trim()
  if (!raw) return { date: 'N/A', time: null }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) return { date: raw, time: null }
    return { date: parsed.toLocaleDateString(), time: null }
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return { date: raw, time: null }
  return {
    date: parsed.toLocaleDateString(),
    time: parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }
}

// ─── Main View Component ──────────────────────────────────────────────────────

export function CustomerPurchaseRequestView(props: any) {
  const {
    orders = [],
    isLoading = false,
    formatPeso,
    getProductImage = (url?: string | null) => url || '/placeholder-product.png',
    cancelOrder,
    isOrderCancellable = () => true,
    setActiveView,
    setSelectedOrder,
    openPRDetail,
  } = props

  const [search, setSearch] = useState('')
  const [prTab, setPrTab] = useState<'ALL' | PRStatus>('ALL')
  const [currentPage, setCurrentPage] = useState(1)

  const handleOpenDetails = (order: any) => {
    if (typeof openPRDetail === 'function') {
      openPRDetail(order)
    } else {
      setSelectedOrder?.(order)
      setActiveView?.('purchase-request-detail')
    }
  }

  const prTabOptions: Array<{ id: 'ALL' | PRStatus; label: string; icon: React.ReactNode }> = [
    { id: 'ALL', label: 'All', icon: <Package2 className="h-4 w-4" /> },
    { id: 'PENDING_APPROVAL', label: 'Pending Review', icon: <Clock3 className="h-4 w-4" /> },
    { id: 'APPROVED', label: 'Approved', icon: <CheckCircle2 className="h-4 w-4" /> },
    { id: 'REJECTED', label: 'Rejected', icon: <XCircle className="h-4 w-4" /> },
    { id: 'CANCELLED', label: 'Cancelled', icon: <CircleAlert className="h-4 w-4" /> },
  ]

  // Filter non-replacement orders for Purchase Requests
  const nonReplacementOrders = useMemo(() => {
    const source: any[] = Array.isArray(orders) ? orders : []
    return source.filter(
      (o) =>
        !String(o?.orderNumber || '')
          .trim()
          .toUpperCase()
          .startsWith('RPL-') && !o?.isScheduledReplacement
    )
  }, [orders])

  // Filter by active tab and search query
  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase()

    return nonReplacementOrders.filter((order) => {
      const status = normalizePRStatus(order?.requestStatus || order?.approvalStatus)

      // Tab filter
      if (prTab !== 'ALL' && status !== prTab) {
        return false
      }

      // Search filter
      if (!query) return true

      const prNum = String(order?.purchaseRequestNumber || order?.orderNumber || '').toLowerCase()
      const address = String(order?.shippingAddress || '').toLowerCase()
      const customerName = String(
        order?.customerName || order?.customer?.name || order?.shippingName || ''
      ).toLowerCase()
      const itemNames = (order?.items || [])
        .map((i: any) => getItemDisplayNameWithSize(i).toLowerCase())
        .join(' ')
      const statusLabel = getStatusConfig(status).label.toLowerCase()

      return (
        prNum.includes(query) ||
        address.includes(query) ||
        customerName.includes(query) ||
        itemNames.includes(query) ||
        statusLabel.includes(query)
      )
    })
  }, [nonReplacementOrders, prTab, search])

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE))
  const activePage = Math.min(currentPage, totalPages)
  const pagedOrders = filteredOrders.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE)
  const startIndex = (activePage - 1) * PAGE_SIZE + 1
  const endIndex = Math.min(activePage * PAGE_SIZE, filteredOrders.length)

  return (
    <section className="-mx-4 min-h-[calc(100dvh-7rem)] bg-[#f8fafc] pb-5 md:mx-0 md:rounded-2xl md:border md:border-slate-200 md:bg-white">
      {/* ── Top Header ── */}
      <div className="border-b border-slate-200 px-3 py-3 md:px-4">
        <h2 className="text-[26px] font-extrabold tracking-[-0.02em] text-slate-900 md:text-[30px]">
          Purchase Request
        </h2>

        {/* ── Tabs ── */}
        <div className="mt-2.5 flex gap-4 overflow-x-auto">
          {prTabOptions.map((tab) => {
            const isActive = prTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setPrTab(tab.id)
                  setCurrentPage(1)
                }}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-1.5 text-xs transition-colors ${
                  isActive
                    ? 'border-emerald-600 font-semibold text-emerald-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* ── Search Bar ── */}
        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <Search className="h-4 w-4 text-slate-500" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setCurrentPage(1)
              }}
              placeholder="Search purchase requests..."
              className="h-auto border-0 bg-transparent p-0 text-xs text-slate-700 shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
      </div>

      {/* ── Body Content ── */}
      {isLoading ? (
        <PortalCardsSkeleton cards={4} />
      ) : filteredOrders.length === 0 ? (
        <div className="px-4 py-16 text-center text-sm text-slate-500">
          <Clock3 className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          <p className="font-medium text-slate-700">No purchase requests found</p>
          <p className="mt-1 text-xs text-slate-400">
            {search
              ? 'No purchase requests match your search.'
              : prTab !== 'ALL'
                ? `You have no ${prTabOptions.find((t) => t.id === prTab)?.label.toLowerCase()} purchase requests.`
                : 'Your submitted purchase requests will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 px-2.5 pt-2.5 md:px-4">
          {pagedOrders.map((o: any) => {
            const status = normalizePRStatus(o.requestStatus || o.approvalStatus)
            const config = getStatusConfig(status)
            const rawId = String(o.purchaseRequestNumber || o.orderNumber || '').trim()
            const displayId = rawId.startsWith('PR-') ? rawId : (rawId.startsWith('PO-') ? `PR-${rawId.slice(3)}` : (rawId || 'PR'))
            const submittedDt = formatDateTime(o.createdAt)
            const orderItems = Array.isArray(o.items) ? o.items : []
            const depositTotal = orderItems.reduce(
              (sum: number, item: any) => sum + Math.max(0, Number(item?.netDeposit ?? item?.depositTotal ?? item?.depositCharged ?? 0)),
              0
            )
            const isPending = status === 'PENDING_APPROVAL' || String(o.status || '').toUpperCase() === 'PENDING'
            const cancellable = isPending

            return (
              <div
                key={o.id}
                className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm transition-shadow hover:shadow md:px-3.5 md:py-3.5"
              >
                <div className="grid gap-2.5 md:grid-cols-[1.35fr_1.05fr_0.72fr_0.8fr]">
                  {/* Col 1: ID, Date, Address */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${config.dotClass}`} />
                      <button
                        type="button"
                        onClick={() => handleOpenDetails(o)}
                        className="text-[18px] font-semibold tracking-[-0.01em] text-slate-900 hover:text-emerald-700 transition-colors text-left"
                      >
                        {displayId}
                      </button>
                      <Badge className={config.badgeClass}>
                        {config.label}
                      </Badge>
                    </div>

                    <p className="flex items-center gap-1.5 text-xs text-slate-600">
                      <CalendarDays className="h-4 w-4 text-slate-400" />
                      Submitted on {submittedDt.date}
                      {submittedDt.time ? ` · ${submittedDt.time}` : ''}
                    </p>

                    <div className="flex items-start gap-1.5 text-xs text-slate-700">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      <div>
                        <p className="font-semibold text-slate-800">
                          {String(
                            o.customerName ||
                              o.customer?.name ||
                              o.shippingName ||
                              o.contactName ||
                              'Customer'
                          )}
                        </p>
                        <p className="line-clamp-2 text-slate-600">
                          {o.shippingAddress || 'No address provided'}
                        </p>
                      </div>
                    </div>

                    {(status === 'REJECTED' || status === 'CANCELLED') && (
                      <div className="mt-2 rounded-lg bg-rose-50 border border-rose-200/80 px-2.5 py-2 text-xs text-rose-700">
                        <span className="font-bold text-rose-800">
                          {status === 'REJECTED' ? 'Reason for Rejection:' : 'Reason for Cancellation:'}
                        </span>{' '}
                        <span className="text-rose-700">
                          {o.rejectionReason || o.rejection_reason || o.cancellationReason || o.cancellation_reason || o.notes || (status === 'REJECTED' ? 'Purchase request was rejected.' : 'Purchase request was cancelled.')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Col 2: Requested Items with Thumbnails */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-900">Requested Items</p>
                    {orderItems.length > 0 ? (
                      <div className="space-y-1.5">
                        {orderItems.map((item: any, idx: number) => (
                          <div
                            key={`${o.id}-preview-item-${item?.id || idx}`}
                            className="flex items-center gap-2"
                          >
                            <img
                              src={getProductImage(item?.product?.imageUrl)}
                              alt={item?.product?.name || 'Product'}
                              className="h-10 w-10 rounded-md border border-slate-200 bg-slate-50 object-cover"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-800 truncate">
                                {getItemDisplayNameWithSize(item)}
                              </p>
                              <p className="text-xs text-slate-500">
                                {formatQuantityWithUnit(item)}
                              </p>
                              {item?.itemType === 'MIXED_CASE' ? <MixedCaseComponents item={item} compact /> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">No items</p>
                    )}
                  </div>

                  {/* Col 3: Total Amount */}
                  <div>
                    {depositTotal > 0 ? (
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-600">
                        <span>Container deposit</span>
                        <span className="font-semibold text-slate-800">+{formatPeso(depositTotal)}</span>
                      </div>
                    ) : null}
                    <p className="text-xs font-semibold text-slate-900">Estimated Total</p>
                    <p className="mt-1 text-[26px] font-extrabold leading-none tracking-[-0.02em] text-emerald-700">
                      {formatPeso(Number(o.totalAmount || 0))}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {config.label}
                    </p>
                  </div>

                  {/* Col 4: Action Buttons */}
                  <div className="space-y-1.5 border-l border-slate-200 pl-2.5 md:pl-3">
                    <Button
                      variant="outline"
                      className="h-8 w-full rounded-md border-slate-300 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      onClick={() => handleOpenDetails(o)}
                    >
                      View Details
                    </Button>

                    {cancellable && (
                      <Button
                        variant="outline"
                        className="h-8 w-full rounded-md border-red-200 text-[11px] font-medium text-red-600 hover:bg-red-50"
                        onClick={() => void cancelOrder?.(o.id)}
                      >
                        Cancel Request
                      </Button>
                    )}

                    {status === 'APPROVED' && (
                      <Button
                        variant="outline"
                        className="h-8 w-full rounded-md border-emerald-200 bg-emerald-50/50 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
                        onClick={() => {
                          setSelectedOrder?.(o)
                          setActiveView?.('orders')
                        }}
                      >
                        View Purchase Order →
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}

          {/* ── Pagination ── */}
          <div className="flex items-center justify-between px-1 pt-3 text-sm text-slate-600">
            <p>
              Showing {startIndex} to {endIndex} of {filteredOrders.length} purchase requests
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
                aria-label="Previous page"
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="grid h-8 min-w-8 px-2 place-items-center rounded-md bg-emerald-100 font-semibold text-emerald-700"
                aria-label={`Current page ${currentPage}`}
                title={`Current page ${currentPage}`}
              >
                {currentPage}
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
                aria-label="Next page"
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
