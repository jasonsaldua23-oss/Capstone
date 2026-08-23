'use client'

import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  MapPin,
  Package,
  Wallet,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CompactDiscountLine } from '@/components/shared/compact-discount-line'
import { formatLooseQuantity, getLooseUnitFromRecord } from '@/lib/beverage-category-specs'
import { getStatusConfig, normalizePRStatus } from './purchase-request-view'

function getItemDisplayNameWithSize(item: any): string {
  if (item?.itemType === 'MIXED_CASE') {
    const components = (item?.components || [])
      .map((component: any) => `${component.productName} ${component.quantityPerCase}/case`)
      .join(', ')
    return `Mixed Case (${item.caseCapacity || 0} units)${components ? ` — ${components}` : ''}`
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

export function CustomerPurchaseRequestDetailPage(props: any) {
  const {
    order,
    onBack,
    formatPeso,
    getProductImage = (url?: string | null) => url || '/placeholder-product.png',
    cancelOrder,
    isOrderCancellable = () => true,
    setActiveView,
    setSelectedOrder,
  } = props

  if (!order) return null

  const status = normalizePRStatus(order?.requestStatus || order?.approvalStatus)
  const config = getStatusConfig(status)
  const rawId = String(order?.purchaseRequestNumber || order?.orderNumber || '').trim()
  const displayId = rawId.startsWith('PR-') ? rawId : (rawId.startsWith('PO-') ? `PR-${rawId.slice(3)}` : (rawId || 'PR'))
  const submittedDt = formatDateTime(order?.createdAt)
  const reviewedDt = formatDateTime(order?.approvedAt || order?.rejectedAt || order?.cancelledAt || order?.updatedAt)

  const items: any[] = Array.isArray(order?.items) ? order.items : []
  const orderSubtotal = Number(
    order?.subtotal ??
      items.reduce(
        (sum: number, item: any) =>
          sum + Number(item?.totalPrice ?? Number(item?.unitPrice || 0) * Number(item?.quantity || 0)),
        0
      )
  )
  const orderDiscount = Number(order?.discountDetails?.totalDiscount || order?.discount || 0)
  const orderTotal = Number(order?.totalAmount || 0)
  const orderDiscountPercent = (() => {
    const explicitPercent = Number(order?.discountDetails?.percent)
    if (Number.isFinite(explicitPercent) && explicitPercent > 0) return explicitPercent
    if (orderSubtotal > 0 && orderDiscount > 0) return (orderDiscount / orderSubtotal) * 100
    return 0
  })()

  const rejectionReason = String(order?.rejectionReason || '').trim()
  const cancellationReason = String(order?.cancellationReason || '').trim()
  const orderNotes = String(order?.notes || '').trim()
  const isPending = status === 'PENDING_APPROVAL'
  const cancellable = isPending && isOrderCancellable(order.status, order.paymentStatus)

  return (
    <section className="-mx-4 min-h-[calc(100dvh-7rem)] bg-[#f8fafc] pb-8 md:mx-0 md:rounded-2xl md:border md:border-slate-200 md:bg-white">
      {/* ── Back Navigation Header ── */}
      <div className="border-b border-slate-200 px-3 py-3 md:px-5">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Purchase Requests
        </button>
      </div>

      <div className="px-3 pt-4 pb-6 md:px-6 md:pt-5 space-y-5">
        {/* ── Title Row ── */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600 md:h-12 md:w-12 shrink-0">
            <Package className="h-5 w-5 md:h-6 md:w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold tracking-tight text-slate-900 md:text-[28px]">
                {displayId}
              </h1>
              <Badge className={config.badgeClass}>
                {config.label}
              </Badge>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600 md:text-sm">
              <CalendarDays className="h-3.5 w-3.5 text-slate-400 md:h-4 md:w-4" />
              Submitted on {submittedDt.date}
              {submittedDt.time ? ` · ${submittedDt.time}` : ''}
            </p>
          </div>
        </div>

        {/* ── Status Message Banner ── */}
        <div
          className={`rounded-xl border p-4 ${
            status === 'APPROVED'
              ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800'
              : status === 'REJECTED'
                ? 'border-red-200 bg-red-50/70 text-red-800'
                : status === 'CANCELLED'
                  ? 'border-slate-200 bg-slate-50 text-slate-700'
                  : 'border-amber-200 bg-amber-50/70 text-amber-800'
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0">{config.icon}</span>
            <div className="space-y-1.5 text-xs md:text-sm">
              <p className="font-semibold">{config.label}</p>
              <p>{config.message}</p>
              {reviewedDt.date !== 'N/A' && status !== 'PENDING_APPROVAL' && (
                <p className="text-xs opacity-80">
                  {status === 'APPROVED' ? 'Approved on' : status === 'REJECTED' ? 'Rejected on' : 'Updated on'}{' '}
                  {reviewedDt.date} {reviewedDt.time ? `· ${reviewedDt.time}` : ''}
                </p>
              )}
              {rejectionReason && status === 'REJECTED' && (
                <div className="mt-2.5 rounded-lg border border-red-200 bg-white/90 p-3 text-xs md:text-sm text-red-700">
                  <p className="font-semibold uppercase tracking-wide text-[10px] text-red-500">
                    Rejection Reason
                  </p>
                  <p className="mt-0.5">{rejectionReason}</p>
                </div>
              )}
              {cancellationReason && status === 'CANCELLED' && (
                <div className="mt-2.5 rounded-lg border border-slate-200 bg-white/90 p-3 text-xs md:text-sm text-slate-700">
                  <p className="font-semibold uppercase tracking-wide text-[10px] text-slate-500">
                    Cancellation Reason
                  </p>
                  <p className="mt-0.5">{cancellationReason}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Address + Estimated Total Grid ── */}
        <div className="grid gap-3.5 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 md:text-sm">
              <MapPin className="h-4 w-4 text-slate-500" />
              Delivery Address
            </p>
            <p className="mt-1.5 text-xs font-semibold text-slate-900 md:text-sm">
              {String(order.customerName || order.customer?.name || order.shippingName || order.contactName || 'Customer')}
            </p>
            <p className="mt-0.5 text-xs text-slate-600 md:text-sm">
              {order.shippingAddress || 'No address provided'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 md:text-sm">
              <Wallet className="h-4 w-4 text-slate-500" />
              Estimated Total
            </p>
            <p className="mt-1.5 text-2xl font-extrabold text-emerald-700 md:text-3xl">
              {formatPeso(orderTotal)}
            </p>
            {orderDiscount > 0 && (
              <CompactDiscountLine
                value={formatPeso(orderDiscount)}
                percent={orderDiscountPercent}
                className="mt-1 text-xs font-semibold text-[#2b4f83] md:text-sm"
              />
            )}
          </div>
        </div>

        {/* ── Requested Items Table ── */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs font-semibold text-slate-900 md:px-5 md:text-sm">
            Requested Items ({items.length} item{items.length === 1 ? '' : 's'})
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_56px_86px_98px] border-b border-slate-200 px-4 py-2 text-[10px] font-semibold uppercase text-slate-500 md:grid-cols-[minmax(0,1fr)_80px_110px_120px] md:px-5 md:text-xs">
            <span>Product</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit Price</span>
            <span className="text-right">Subtotal</span>
          </div>

          <div className="divide-y divide-slate-100">
            {items.map((item: any, idx: number) => (
              <div
                key={item?.id || idx}
                className="grid grid-cols-[minmax(0,1fr)_56px_86px_98px] items-center px-4 py-3 text-xs md:grid-cols-[minmax(0,1fr)_80px_110px_120px] md:px-5 md:text-sm"
              >
                <div className="flex items-center gap-3 pr-2">
                  <img
                    src={getProductImage(item?.product?.imageUrl)}
                    alt={item?.product?.name || 'Product'}
                    className="h-9 w-9 shrink-0 rounded-lg border border-slate-200 bg-slate-50 object-cover md:h-11 md:w-11"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 break-words leading-snug">
                      {getItemDisplayNameWithSize(item)}
                    </p>
                    {item?.itemType === 'MIXED_CASE' && (
                      <div className="mt-0.5 space-y-0.5 text-[9px] text-sky-700 md:text-[10px]">
                        {(item.components || []).map((c: any) => (
                          <p key={c.id || c.productId}>
                            {c.productName}: {c.quantityPerCase}/case ({c.totalBaseUnits} total)
                          </p>
                        ))}
                      </div>
                    )}
                    {String(item?.product?.category?.name || item?.product?.category || '').trim() && (
                      <p className="text-[10px] text-slate-400 md:text-xs">
                        {String(item?.product?.category?.name || item?.product?.category || '').trim()}
                      </p>
                    )}
                  </div>
                </div>

                <span className="text-right font-medium text-slate-700">
                  {item.quantity}
                </span>

                <span className="text-right text-slate-600">
                  {formatPeso(Number(item.unitPrice || 0))}
                </span>

                <span className="text-right font-semibold text-slate-900">
                  {formatPeso(Number(item.unitPrice || 0) * Number(item.quantity || 0))}
                </span>
              </div>
            ))}
          </div>

          {/* Totals Footer */}
          <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-xs md:px-5 md:text-sm">
            <div className="ml-auto w-full max-w-[240px] space-y-1.5">
              <div className="flex items-center justify-between text-slate-600">
                <span>Subtotal</span>
                <span>{formatPeso(orderSubtotal)}</span>
              </div>
              {orderDiscount > 0 && (
                <div className="flex items-center justify-between text-[#2b4f83]">
                  <span>
                    Discount
                    {orderDiscountPercent > 0
                      ? ` (${Number.isInteger(orderDiscountPercent) ? orderDiscountPercent : orderDiscountPercent.toFixed(2).replace(/\.?0+$/, '')}%)`
                      : ''}
                  </span>
                  <span>-{formatPeso(orderDiscount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900">
                <span>Estimated Total</span>
                <span className="text-emerald-700">{formatPeso(orderTotal)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Order Note if any ── */}
        {orderNotes && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="text-xs font-semibold text-slate-700 md:text-sm">Order Note</p>
            <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap md:text-sm">{orderNotes}</p>
          </div>
        )}

        {/* ── Action Buttons ── */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {status === 'APPROVED' && (
            <Button
              className="h-10 rounded-lg bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-500 md:text-sm"
              onClick={() => {
                setSelectedOrder?.(order)
                setActiveView?.('orders')
              }}
            >
              View Purchase Order →
            </Button>
          )}

          {cancellable && (
            <Button
              variant="outline"
              className="h-10 rounded-lg border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 md:text-sm"
              onClick={() => void cancelOrder?.(order.id)}
            >
              Cancel Request
            </Button>
          )}

          <Button
            variant="outline"
            className="h-10 rounded-lg border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 md:text-sm"
            onClick={onBack}
          >
            Back
          </Button>
        </div>
      </div>
    </section>
  )
}
