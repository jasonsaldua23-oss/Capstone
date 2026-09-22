'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { MixedCaseComponents } from '@/components/portals/shared/mixed-case-components'
import { DepositRefundRow, EmptiesChargeRow, getOrderTotalWithEmpties } from '@/components/shared/empties-charge-note'
import { resolveClientImageUrl } from '@/lib/client-image'
import { ArrowLeft, ChevronRight, Package, Phone, Search } from 'lucide-react'
import { DropPoint, Trip, stripPhilippinesFromAddress } from './trip-detail-helpers'
import {
  dropPointStatusColors,
  formatCurrency,
  formatDateTime,
  formatTripScheduledDay,
  getDisplayOrderTotal,
  getItemDisplayNameWithSize,
  getOrderQtyWithUnitLabel,
  tripStatusBadgeColors,
} from './trip-detail-format'

/**
 * Read-only paperwork for one trip: the purchase orders it carries and, one
 * level in, who ordered each and what is on it. Deliberately has no delivery
 * actions -- running the trip lives in TripDetailView.
 */

const DELIVERED_STATUSES = new Set(['COMPLETED', 'DELIVERED'])
const CLOSED_STATUSES = new Set(['COMPLETED', 'DELIVERED', 'FAILED', 'CANCELLED', 'CANCELED', 'SKIPPED'])

// The driver reads stop state at a glance, so the words match the trip screen.
const describeStopStatus = (status?: string | null) => {
  const raw = String(status || '').toUpperCase()
  if (DELIVERED_STATUSES.has(raw)) return 'Delivered'
  if (raw === 'IN_TRANSIT') return 'In transit'
  if (raw === 'ARRIVED') return 'Arrived'
  if (raw === 'FAILED') return 'Failed'
  if (raw === 'SKIPPED' || raw === 'CANCELLED' || raw === 'CANCELED') return 'Cancelled'
  if (raw === 'PENDING') return 'Pending'
  return raw ? raw.replace(/_/g, ' ') : 'Pending'
}

const stopStatusTone = (status?: string | null) => {
  const raw = String(status || '').toUpperCase()
  const key = DELIVERED_STATUSES.has(raw) ? 'COMPLETED' : raw === 'SKIPPED' || raw === 'CANCELED' ? 'CANCELLED' : raw
  return dropPointStatusColors[key] || dropPointStatusColors.PENDING
}

const StopStatusPill = ({ status }: { status?: string | null }) => (
  <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${stopStatusTone(status)}`}>
    {describeStopStatus(status)}
  </span>
)

const isReplacementOrder = (order: any) =>
  Boolean(order?.isScheduledReplacement) || String(order?.orderNumber || '').trim().toUpperCase().startsWith('RPL-')

// The stored address usually already ends with the city, so appending it again
// produced "Bacolod City, Bacolod City" on every stop.
const stopAddress = (stop: DropPoint) => {
  const address = stripPhilippinesFromAddress(stop?.address)
  const city = String(stop?.city || '').trim()
  if (!city) return address
  if (!address) return city
  const tail = address.split(',').pop()?.trim().toLowerCase() || ''
  return tail === city.toLowerCase() ? address : `${address}, ${city}`
}

// The name on the card is the business; the person is who the driver asks for.
const stopBusinessName = (stop: DropPoint) =>
  String(stop?.locationName || stop?.contactName || '').trim() || 'Customer'

const stopOrdererName = (stop: DropPoint) => String(stop?.contactName || '').trim()

// Everything on a stop the driver might type: its paperwork numbers, who it is
// for, where it goes, its state, and what is loaded for it.
const stopSearchText = (stop: DropPoint) => {
  const order = stop?.order || {}
  const items = Array.isArray(order.items) ? order.items : []
  return [
    order.orderNumber,
    stop?.orderNumber,
    order.purchaseOrderNumber,
    order.purchaseRequestNumber,
    stop?.locationName,
    stop?.contactName,
    stop?.contactPhone,
    stop?.address,
    stop?.city,
    describeStopStatus(stop?.status || order.status),
    ...items.map((item: any) => getItemDisplayNameWithSize(item)),
    ...items.map((item: any) => item?.product?.sku || item?.productSku),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function TripDetailsView({
  trip,
  onBack,
}: {
  trip: Trip
  onBack: () => void
}) {
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [orderSearch, setOrderSearch] = useState('')

  const stops: DropPoint[] = [...(Array.isArray(trip?.dropPoints) ? trip.dropPoints : [])].sort(
    (a, b) => Number(a?.sequence || 0) - Number(b?.sequence || 0)
  )
  // Polling replaces the trip object, so resolve the open stop by id every render.
  const selectedStop = selectedStopId ? stops.find((stop) => stop.id === selectedStopId) ?? null : null

  const backLink = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="group -ml-1 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-semibold text-slate-600 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
      {label}
    </button>
  )

  if (selectedStop) {
    const order = selectedStop.order || {}
    const items: any[] = Array.isArray(order.items) ? order.items : []
    const replacement = isReplacementOrder(order)
    const ordererName = stopOrdererName(selectedStop)
    const phone = String(selectedStop.contactPhone || '').trim()
    const address = stopAddress(selectedStop)
    const total = replacement ? 0 : getOrderTotalWithEmpties(order) || getDisplayOrderTotal(order)
    const depositCharged = items.reduce(
      (sum, item) => sum + Number(item?.netDeposit ?? item?.depositTotal ?? item?.depositCharged ?? 0),
      0
    )
    const stopIndex = stops.findIndex((stop) => stop.id === selectedStop.id)

    return (
      <div className="w-full min-w-0 max-w-3xl space-y-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6">
        {backLink(trip.tripNumber, () => setSelectedStopId(null))}

        <div className="min-w-0 rounded-2xl border border-sky-100 bg-white p-4 shadow-[0_12px_24px_rgba(2,132,199,0.10)] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-500">
                Stop {stopIndex >= 0 ? stopIndex + 1 : selectedStop.sequence || 1} of {stops.length}
              </p>
              <h2 className="mt-0.5 break-words text-xl font-black tracking-[-0.02em] text-slate-900">
                {order.orderNumber || selectedStop.orderNumber || 'Purchase order'}
              </h2>
            </div>
            <StopStatusPill status={selectedStop.status || order.status} />
          </div>

          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            <div>
              <p className="text-sm text-slate-500">Ordered by</p>
              <p className="mt-0.5 break-words text-base font-bold text-slate-900">
                {ordererName || stopBusinessName(selectedStop)}
              </p>
              {ordererName && stopBusinessName(selectedStop) !== ordererName ? (
                <p className="break-words text-sm text-slate-600">{stopBusinessName(selectedStop)}</p>
              ) : null}
            </div>

            {phone ? (
              <a
                href={`tel:${phone.replace(/\s+/g, '')}`}
                className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                <Phone className="size-4" />
                {phone}
              </a>
            ) : (
              <p className="text-sm text-slate-500">No contact number on this order.</p>
            )}

            <div>
              <p className="text-sm text-slate-500">Deliver to</p>
              <p className="mt-0.5 break-words text-sm font-medium text-slate-900">{address || 'No address recorded.'}</p>
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2">
              {order.purchaseOrderNumber ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-500">PO number</dt>
                  <dd className="break-words text-right font-medium text-slate-900">{order.purchaseOrderNumber}</dd>
                </div>
              ) : null}
              {order.purchaseRequestNumber ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-slate-500">Request number</dt>
                  <dd className="break-words text-right font-medium text-slate-900">{order.purchaseRequestNumber}</dd>
                </div>
              ) : null}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">Order status</dt>
                <dd className="text-right font-medium text-slate-900">
                  {String(order.status || 'Not set').replace(/_/g, ' ')}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">Delivery date</dt>
                <dd className="text-right font-medium text-slate-900">
                  {order.deliveryDate ? formatDateTime(order.deliveryDate) : formatTripScheduledDay(trip)}
                </dd>
              </div>
            </dl>

            {selectedStop.notes ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-sm font-semibold text-amber-900">Note from dispatch</p>
                <p className="mt-0.5 break-words text-sm text-amber-900">{selectedStop.notes}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-sky-100 bg-white p-4 shadow-[0_12px_24px_rgba(2,132,199,0.10)] sm:p-5">
          <h3 className="text-base font-bold tracking-tight text-slate-900">
            Products ({items.length})
          </h3>

          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Nothing is recorded on this order yet.</p>
          ) : (
            <div className="mt-2 divide-y divide-slate-100">
              {items.map((item: any, index: number) => {
                const image = resolveClientImageUrl(item?.product?.imageUrl || item?.imageUrl || item?.product?.image_url)
                const sku = String(item?.product?.sku || item?.productSku || '').trim()
                const unitPrice = Number(item?.price ?? item?.unitPrice ?? 0)
                const lineTotal = Number(item?.subtotal ?? unitPrice * Number(item?.quantity || 0))

                return (
                  <div key={item?.id || `item-${index}`} className="flex items-start gap-3 py-3">
                    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                      {image ? (
                        <img src={image} alt="" className="size-full object-cover" loading="lazy" />
                      ) : (
                        <Package className="size-5 text-slate-400" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold leading-snug text-slate-900">
                        {getItemDisplayNameWithSize(item)}
                      </p>
                      {sku ? <p className="mt-0.5 text-xs text-slate-500">SKU {sku}</p> : null}
                      {item?.itemType === 'MIXED_CASE' ? <MixedCaseComponents item={item} showImages={false} compact /> : null}
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="whitespace-nowrap text-sm font-bold text-slate-900">
                        {getOrderQtyWithUnitLabel(item, order)}
                      </p>
                      {replacement ? (
                        <p className="mt-0.5 text-xs font-medium text-emerald-700">No charge</p>
                      ) : (
                        <>
                          {unitPrice > 0 ? (
                            <p className="mt-0.5 whitespace-nowrap text-xs text-slate-500">{formatCurrency(unitPrice)} each</p>
                          ) : null}
                          {lineTotal > 0 ? (
                            <p className="whitespace-nowrap text-xs font-semibold text-slate-800">{formatCurrency(lineTotal)}</p>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {replacement ? (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <p className="text-sm font-semibold text-emerald-900">Replacement delivery</p>
              <p className="mt-0.5 text-sm text-emerald-800">Hand these over at no charge. Collect nothing for this stop.</p>
            </div>
          ) : items.length > 0 ? (
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
              {depositCharged > 0 ? (
                <div className="flex items-center justify-between text-slate-600">
                  <span>Container deposit</span>
                  <span className="font-medium">{formatCurrency(depositCharged)}</span>
                </div>
              ) : null}
              <DepositRefundRow order={order} className="text-sm" />
              <EmptiesChargeRow order={order} className="text-sm" />
              <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                <span className="font-semibold text-slate-700">Amount to collect</span>
                <span className="text-base font-black tracking-tight text-slate-900">{formatCurrency(total)}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const searchQuery = orderSearch.trim().toLowerCase()
  const visibleStops = searchQuery ? stops.filter((stop) => stopSearchText(stop).includes(searchQuery)) : stops

  return (
    <div className="w-full min-w-0 max-w-3xl space-y-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6">
      {backLink('My Deliveries', onBack)}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="min-w-0 break-words text-xl font-black tracking-[-0.02em] text-slate-900">{trip.tripNumber}</h2>
          <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tripStatusBadgeColors[trip.status] || 'bg-slate-100 text-slate-700'}`}>
            {String(trip.status || '').replace(/_/g, ' ')}
          </span>
        </div>
        <p className="mt-1 break-words text-sm text-slate-600">
          {formatTripScheduledDay(trip)} on {trip.vehicle?.licensePlate || 'vehicle'}
          {trip.vehicle?.type ? ` (${trip.vehicle.type})` : ''}
        </p>
      </div>

      <div>
        <h3 className="text-base font-bold tracking-tight text-slate-900">
          Purchase orders ({searchQuery ? `${visibleStops.length} of ${stops.length}` : stops.length})
        </h3>

        {stops.length > 0 ? (
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={orderSearch}
              onChange={(event) => setOrderSearch(event.target.value)}
              placeholder="Search PO number, customer, address"
              className="h-10 rounded-xl border-sky-100 bg-white/90 pl-9 text-sm shadow-[0_8px_18px_rgba(2,132,199,0.08)]"
            />
          </div>
        ) : null}

        {stops.length === 0 ? (
          <div className="mt-2 rounded-2xl border border-sky-100 bg-white px-4 py-10 text-center shadow-[0_12px_24px_rgba(2,132,199,0.10)]">
            <Package className="mx-auto size-10 text-sky-300" />
            <p className="mt-3 font-semibold text-slate-700">No purchase orders on this trip</p>
            <p className="mt-1 text-sm text-slate-500">Ask your dispatcher to add the stops before you drive out.</p>
          </div>
        ) : visibleStops.length === 0 ? (
          <div className="mt-2 rounded-2xl border border-sky-100 bg-white px-4 py-10 text-center shadow-[0_12px_24px_rgba(2,132,199,0.10)]">
            <Search className="mx-auto size-10 text-sky-300" />
            <p className="mt-3 break-words font-semibold text-slate-700">Nothing matches &ldquo;{orderSearch.trim()}&rdquo;</p>
            <p className="mt-1 text-sm text-slate-500">
              Search by PO number, customer, who ordered, phone, address, status, or a product on the order.
            </p>
          </div>
        ) : (
          // The stops are a route, so the numbered nodes carry real order:
          // a filled node is behind the driver, a hollow one is still ahead.
          <ol className="mt-2 space-y-2">
            {visibleStops.map((stop) => {
              // The node keeps the stop's real position in the route, so a
              // filtered list never renumbers the driver's stops.
              const position = stops.indexOf(stop) + 1
              const order = stop?.order || {}
              const items: any[] = Array.isArray(order.items) ? order.items : []
              const status = String(stop?.status || '').toUpperCase()
              const isDone = DELIVERED_STATUSES.has(status)
              const isClosed = CLOSED_STATUSES.has(status)
              const replacement = isReplacementOrder(order)
              const orderTotal = replacement ? 0 : getOrderTotalWithEmpties(order) || getDisplayOrderTotal(order)
              const orderer = stopOrdererName(stop)

              return (
                <li key={stop.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedStopId(stop.id)}
                    className="group flex w-full min-w-0 items-start gap-3 rounded-2xl border border-sky-100 bg-white p-3.5 text-left shadow-[0_12px_24px_rgba(2,132,199,0.10)] transition hover:border-sky-200 hover:shadow-[0_16px_30px_rgba(2,132,199,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 sm:p-4"
                  >
                    <span
                      className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        isDone
                          ? 'bg-emerald-600 text-white'
                          : isClosed
                            ? 'bg-slate-200 text-slate-600'
                            : 'border-2 border-sky-300 bg-white text-sky-700'
                      }`}
                    >
                      {position}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0 break-words text-sm font-bold text-slate-900">
                          {stopBusinessName(stop)}
                        </span>
                        <StopStatusPill status={stop.status || order.status} />
                      </span>
                      <span className="mt-0.5 block break-words text-sm text-slate-600">
                        {order.orderNumber || stop.orderNumber || 'No order number'}
                        {orderer ? ` for ${orderer}` : ''}
                      </span>
                      <span className="mt-0.5 block break-words text-sm text-slate-500">
                        {stopAddress(stop) || 'No address recorded'}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-sm">
                        <span className="text-slate-600">
                          {items.length} {items.length === 1 ? 'product' : 'products'}
                          {replacement ? ' at no charge' : orderTotal > 0 ? `, ${formatCurrency(orderTotal)}` : ''}
                        </span>
                        <span className="inline-flex items-center gap-0.5 font-semibold text-sky-700">
                          Open
                          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
