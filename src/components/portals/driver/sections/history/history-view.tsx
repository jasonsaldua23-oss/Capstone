'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PortalCardsSkeleton } from '@/components/portals/shared/loading-skeletons'
import { resolveClientImageUrl } from '@/lib/client-image'
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Package,
  Search,
} from 'lucide-react'

type Trip = any

const stripPhilippinesFromAddress = (address: string | null | undefined) => {
  const text = String(address || '').trim()
  if (!text) return ''
  const tokens = text
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  while (tokens.length > 0) {
    const tail = String(tokens[tokens.length - 1] || '').toLowerCase()
    if (tail === 'philippines' || tail === 'republic of the philippines') {
      tokens.pop()
      continue
    }
    break
  }
  return tokens.join(', ')
}

const formatCurrency = (amount: unknown): string => {
  const value = Number(amount || 0)
  return `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const getItemSizeLabel = (item: any): string => {
  const fromProductSizes = Array.isArray(item?.product?.sizes) ? item.product.sizes.filter(Boolean) : []
  if (fromProductSizes.length > 0) return fromProductSizes.map((v: any) => String(v).trim()).filter(Boolean).join(' ')
  const fromUnit = String(item?.product?.unit || item?.productUnit || '').trim()
  return fromUnit
}

export function HistoryView({
  trips,
  isLoading,
  onOpenTrip,
}: {
  trips: Trip[]
  isLoading: boolean
  onOpenTrip?: (trip: Trip) => void
}) {
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  // 3-Level navigation state:
  // Level 1: selectedTrip = null, selectedStop = null (Trips list)
  // Level 2: selectedTrip != null, selectedStop = null (Purchase Orders in Trip)
  // Level 3: selectedTrip != null, selectedStop != null (Order & Products detail)
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [selectedStop, setSelectedStop] = useState<any | null>(null)

  const isCompletedTrip = (status: string | null | undefined) => String(status || '').toUpperCase() === 'COMPLETED'

  const completedTrips = useMemo(() => {
    return [...(trips || [])]
      .filter((trip) => isCompletedTrip(trip.status))
      .sort((a, b) => {
        const aDate = new Date(a.actualEndAt || a.updatedAt || a.createdAt || a.plannedStartAt || 0).getTime()
        const bDate = new Date(b.actualEndAt || b.updatedAt || b.createdAt || b.plannedStartAt || 0).getTime()
        return bDate - aDate
      })
  }, [trips])

  const visibleTrips = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return completedTrips
    return completedTrips.filter((trip) => {
      const tripText = String(trip.tripNumber || '').toLowerCase()
      const vehicleText = `${trip.vehicle?.licensePlate || ''} ${trip.vehicle?.type || ''}`.toLowerCase()
      const stopText = Array.isArray(trip.dropPoints)
        ? trip.dropPoints
            .map((stop: any) =>
              [
                stop?.locationName,
                stop?.address,
                stop?.city,
                stop?.order?.orderNumber,
                stop?.orderNumber,
                stop?.contactName,
              ]
                .filter(Boolean)
                .join(' ')
            )
            .join(' ')
            .toLowerCase()
        : ''
      return tripText.includes(q) || vehicleText.includes(q) || stopText.includes(q)
    })
  }, [completedTrips, search])

  const totalPages = Math.max(1, Math.ceil(visibleTrips.length / pageSize))
  const paginatedTrips = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return visibleTrips.slice(start, start + pageSize)
  }, [visibleTrips, currentPage])

  useEffect(() => {
    setCurrentPage(1)
  }, [search])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const formatDate = (value?: string | null) => {
    if (!value) return 'N/A'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return 'N/A'
    return d.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
  }

  const renderStatusPill = (status?: string | null) => {
    const raw = String(status || '').toUpperCase()
    if (raw === 'COMPLETED' || raw === 'DELIVERED') {
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
          Delivered
        </span>
      )
    }
    if (raw === 'FAILED' || raw === 'CANCELLED' || raw === 'SKIPPED' || raw === 'REJECTED') {
      return (
        <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/20">
          {raw === 'SKIPPED' ? 'Cancelled' : raw === 'FAILED' ? 'Failed' : 'Cancelled'}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
        {raw || 'Pending'}
      </span>
    )
  }

  // =========================================================================
  // LEVEL 3: ORDER & PRODUCTS DETAILS VIEW
  // =========================================================================
  if (selectedTrip && selectedStop) {
    const order = selectedStop.order || {}
    const items: any[] = Array.isArray(order.items) ? order.items : []
    const stopStatus = String(selectedStop.status || order.status || '').toUpperCase()
    const isDelivered = stopStatus === 'COMPLETED' || stopStatus === 'DELIVERED'
    const isCancelledOrFailed = ['FAILED', 'CANCELLED', 'SKIPPED', 'REJECTED'].includes(stopStatus)
    const orderNumber = selectedStop.orderNumber || order.orderNumber || 'N/A'
    const cleanAddress = [stripPhilippinesFromAddress(selectedStop.address || order.shippingAddress), selectedStop.city || order.shippingCity]
      .filter(Boolean)
      .join(', ')

    const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    const totalAmount = order.totalAmount ?? items.reduce((sum, item) => sum + Number(item.totalPrice || item.price || 0), 0)

    return (
      <div className="space-y-4 p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6">
        {/* Navigation Bar */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedStop(null)}
            className="group inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
            Back to {selectedTrip.tripNumber}
          </button>
        </div>

        {/* Order Details Header */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Stop #{selectedStop.sequence || 1}
              </p>
              <h2 className="text-lg font-bold text-slate-900 sm:text-xl tracking-tight mt-0.5">
                {orderNumber}
              </h2>
            </div>
            <div>{renderStatusPill(stopStatus)}</div>
          </div>

          {/* Key Value Details */}
          <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 text-xs sm:grid-cols-2">
            <div>
              <p className="text-slate-500 font-medium">Customer</p>
              <p className="font-semibold text-slate-900 mt-0.5">
                {selectedStop.locationName || selectedStop.contactName || order.shippingName || 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-slate-500 font-medium">Phone</p>
              <p className="font-semibold text-slate-900 mt-0.5">
                {selectedStop.contactPhone || order.shippingPhone || 'N/A'}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-slate-500 font-medium">Delivery Address</p>
              <p className="font-semibold text-slate-900 mt-0.5">
                {cleanAddress || 'N/A'}
              </p>
            </div>
          </div>

          {/* Delivery Note / Reason if any */}
          {isCancelledOrFailed && selectedStop.notes ? (
            <div className="rounded-xl border border-rose-200/80 bg-rose-50/50 p-3 text-xs">
              <p className="font-semibold text-rose-800">Cancellation / Failure Reason</p>
              <p className="text-rose-950 mt-1 font-medium">{selectedStop.notes}</p>
            </div>
          ) : null}

          {/* Proof of Delivery Photo if delivered */}
          {isDelivered && selectedStop.podPhotoUrl ? (
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-800">Proof of Delivery</p>
                {selectedStop.podRecipientName && (
                  <span className="text-slate-500">Received by: <strong className="text-slate-800">{selectedStop.podRecipientName}</strong></span>
                )}
              </div>
              <a
                href={selectedStop.podPhotoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
              >
                <span>View Delivery Photo</span>
                <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
              </a>
            </div>
          ) : null}
        </div>

        {/* Ordered Products Section */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm sm:text-base">
              Ordered Products ({items.length})
            </h3>
            <span className="text-xs font-semibold text-slate-500">
              {totalQuantity} Total {totalQuantity === 1 ? 'Case' : 'Cases'}
            </span>
          </div>

          {items.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              No products recorded on this order.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map((item: any, idx: number) => {
                const productName = String(item.product?.name || item.productName || item.name || 'Product').trim()
                const sizeLabel = getItemSizeLabel(item)
                const qty = Number(item.quantity || 0)
                const unitPrice = Number(item.unitPrice || item.price || item.product?.price || 0)
                const lineTotal = Number(item.totalPrice || unitPrice * qty || 0)
                const sku = item.product?.sku || item.sku
                const itemImage = resolveClientImageUrl(
                  item.product?.imageUrl || item.imageUrl || item.product?.image_url || item.image
                )

                return (
                  <div key={item.id || idx} className="py-3 first:pt-1 last:pb-1">
                    <div className="flex items-start gap-3">
                      {/* Product Image Thumbnail */}
                      <div className="relative h-12 w-12 sm:h-14 sm:w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50 flex items-center justify-center">
                        {itemImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={itemImage}
                            alt={productName}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Package className="h-5 w-5 text-slate-400" />
                        )}
                      </div>

                      {/* Product Name & SKU */}
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <p className="text-sm font-semibold text-slate-900 leading-snug">
                          {productName}
                          {sizeLabel ? (
                            <span className="ml-1 font-normal text-slate-500 text-xs">
                              ({sizeLabel})
                            </span>
                          ) : null}
                        </p>
                        {sku ? (
                          <p className="text-[11px] font-mono text-slate-400">SKU: {sku}</p>
                        ) : null}
                        {item.itemType === 'MIXED_CASE' ? (
                          <span className="inline-block rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 border border-purple-200">
                            Mixed Case
                          </span>
                        ) : null}
                      </div>

                      {/* Quantity & Pricing */}
                      <div className="text-right whitespace-nowrap">
                        <p className="text-sm font-bold text-slate-900">
                          {qty} {qty === 1 ? 'case' : 'cases'}
                        </p>
                        {unitPrice > 0 ? (
                          <p className="text-xs text-slate-500">
                            {formatCurrency(unitPrice)} ea
                          </p>
                        ) : null}
                        {lineTotal > 0 ? (
                          <p className="text-xs font-semibold text-slate-800">
                            {formatCurrency(lineTotal)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Receipt Total Summary */}
          {Number(totalAmount) > 0 ? (
            <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs font-semibold text-slate-900">
              <span className="text-slate-600">Total Order Value</span>
              <span className="text-sm font-bold text-slate-900">{formatCurrency(totalAmount)}</span>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  // =========================================================================
  // LEVEL 2: PURCHASE ORDERS LIST IN TRIP (NO TRIP OVERVIEW CARD)
  // =========================================================================
  if (selectedTrip && !selectedStop) {
    const dropPoints: any[] = Array.isArray(selectedTrip.dropPoints) ? selectedTrip.dropPoints : []

    return (
      <div className="space-y-4 p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-6">
        {/* Navigation Bar */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedTrip(null)}
            className="group inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
            Back to Delivery History
          </button>
        </div>

        {/* Clean Page Title & Trip Meta */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              {selectedTrip.tripNumber}
            </h2>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              Completed
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Completed on {formatDate(selectedTrip.actualEndAt || selectedTrip.updatedAt)} • {selectedTrip.vehicle?.licensePlate || 'Vehicle'} ({selectedTrip.vehicle?.type || 'N/A'})
          </p>
        </div>

        {/* Purchase Orders List */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between px-0.5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Purchase Orders ({dropPoints.length})
            </p>
          </div>

          {dropPoints.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              No purchase orders found for this trip.
            </div>
          ) : (
            dropPoints.map((stop: any) => {
              const stopOrder = stop.order || {}
              const orderItems: any[] = Array.isArray(stopOrder.items) ? stopOrder.items : []
              const itemCount = orderItems.length
              const totalCases = orderItems.reduce((sum, it) => sum + Number(it.quantity || 0), 0)
              const cleanStopAddress = [stripPhilippinesFromAddress(stop.address || stopOrder.shippingAddress), stop.city || stopOrder.shippingCity]
                .filter(Boolean)
                .join(', ')

              return (
                <div
                  key={stop.id}
                  onClick={() => setSelectedStop(stop)}
                  className="group rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:border-slate-300 hover:shadow-md transition cursor-pointer space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-700">
                          {stop.sequence || 1}
                        </span>
                        <h3 className="font-bold text-slate-900 text-sm">
                          {stop.locationName || stop.contactName || stopOrder.shippingName || 'Customer'}
                        </h3>
                      </div>
                      <p className="text-xs font-mono text-slate-500 mt-1 pl-7">
                        {stop.orderNumber || stopOrder.orderNumber || 'Order'}
                      </p>
                    </div>
                    <div>{renderStatusPill(stop.status || stopOrder.status)}</div>
                  </div>

                  <p className="text-xs text-slate-500 line-clamp-1 pl-7">
                    {cleanStopAddress || 'N/A'}
                  </p>

                  <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 pl-7 text-xs">
                    <div className="flex items-center gap-2">
                      {itemCount > 0 && (
                        <div className="flex -space-x-1.5 overflow-hidden">
                          {orderItems.slice(0, 3).map((it: any, i: number) => {
                            const itImg = resolveClientImageUrl(it.product?.imageUrl || it.imageUrl || it.product?.image_url)
                            return (
                              <div
                                key={it.id || i}
                                className="inline-block h-6 w-6 rounded-full ring-2 ring-white overflow-hidden bg-slate-100 border border-slate-200"
                              >
                                {itImg ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={itImg} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-slate-400">
                                    <Package className="h-3 w-3" />
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                      <span className="font-medium text-slate-600">
                        {itemCount > 0 ? `${itemCount} item${itemCount === 1 ? '' : 's'} • ${totalCases} case${totalCases === 1 ? '' : 's'}` : 'Details'}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-900 group-hover:text-blue-600 transition">
                      View Details
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-600 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }

  // =========================================================================
  // LEVEL 1: COMPLETED TRIPS LIST
  // =========================================================================
  return (
    <div className="space-y-4 p-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] md:pb-4">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Delivery History</h2>
        <p className="text-xs text-slate-500 mt-0.5">Completed delivery trips and fulfilled orders</p>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search trip number, vehicle, order, or customer..."
          className="h-10 pl-9 bg-white border-slate-200/90 rounded-xl text-sm placeholder:text-slate-400 shadow-none focus-visible:ring-slate-400"
        />
      </div>

      {isLoading ? (
        <PortalCardsSkeleton cards={4} />
      ) : visibleTrips.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <Clock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-semibold text-sm">No delivery history found</p>
          <p className="text-xs text-slate-400 mt-1">Completed trips will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs font-semibold text-slate-500 px-0.5">
            Showing {visibleTrips.length} completed {visibleTrips.length === 1 ? 'trip' : 'trips'}
          </p>

          {paginatedTrips.map((trip) => {
            const stopCount = trip.totalDropPoints || trip.dropPoints?.length || 0

            return (
              <div
                key={trip.id}
                onClick={() => setSelectedTrip(trip)}
                className="group rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:border-slate-300 hover:shadow-md transition cursor-pointer space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 tracking-tight">
                      {trip.tripNumber}
                    </h3>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">
                      {trip.vehicle?.licensePlate || 'Vehicle'} ({trip.vehicle?.type || 'N/A'}) • {stopCount} {stopCount === 1 ? 'Stop' : 'Stops'}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Completed: {formatDate(trip.actualEndAt || trip.updatedAt)}
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                    Completed
                  </span>
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
                  <span className="text-slate-500 font-medium">Inspect Purchase Orders</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-900 group-hover:text-blue-600 transition">
                    View Details
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-blue-600 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </div>
            )
          })}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 flex-1 rounded-xl border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage <= 1}
              >
                Previous
              </Button>
              <span className="text-xs text-slate-500 font-medium px-2">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 flex-1 rounded-xl border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
