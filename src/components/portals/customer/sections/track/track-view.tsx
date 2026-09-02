'use client'

import { ArrowLeft, CalendarDays, CheckCircle2, Loader2, MapPin, Phone, ShieldCheck, Truck } from 'lucide-react'
import dynamic from 'next/dynamic'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PortalTimelineSkeleton } from '@/components/portals/shared/loading-skeletons'
import { isRescheduledOrder } from '../orders/order-status'
import { getOrderTotalWithEmpties } from '@/components/shared/empties-charge-note'

const DriverRouteMap = dynamic(
  () => import('@/components/maps/DriverRouteMap').then((mod) => mod.DriverRouteMap),
  { ssr: false }
)

export function CustomerTrackView(props: any) {
  const {
    orders,
    selectedTrackingOrderId,
    setActiveView,
    trackingByOrderId,
    normalizeDeliveryStatus,
    getOrderStageIndex,
    formatOrderStatus,
    isTrackingLoading,
    formatPeso,
  } = props

  const order = orders.find((o: any) => o.id === selectedTrackingOrderId)
  if (!order) {
    return (
      <section className="-mx-4 bg-white pb-6 md:mx-0 md:rounded-2xl md:border md:border-slate-200">
        <div className="p-4 text-sm text-slate-500">Select an order to track.</div>
      </section>
    )
  }

  const tracking = trackingByOrderId[order.id]
  const routePoints = Array.isArray(tracking?.routePoints) ? tracking.routePoints : []
  const orderNumberKey = String(order?.orderNumber || '').trim().toUpperCase()
  const isReplacementOrder = Boolean((order as any)?.isScheduledReplacement) || orderNumberKey.startsWith('RPL-')
  const liveSource = String(tracking?.source || '').toLowerCase()
  const hasLiveSource = liveSource === 'driver_gps' || liveSource === 'trip_stop'
  const latestRoutePoint = routePoints
    .filter((point: any) => Number.isFinite(Number(point?.latitude)) && Number.isFinite(Number(point?.longitude)))
    .sort((a: any, b: any) => {
      const at = new Date(String(a?.recordedAt || '')).getTime()
      const bt = new Date(String(b?.recordedAt || '')).getTime()
      return bt - at
    })[0]
  const driverLatitude = Number.isFinite(Number(latestRoutePoint?.latitude))
    ? Number(latestRoutePoint?.latitude)
    : (Number.isFinite(Number(tracking?.latitude)) ? Number(tracking?.latitude) : null)
  const driverLongitude = Number.isFinite(Number(latestRoutePoint?.longitude))
    ? Number(latestRoutePoint?.longitude)
    : (Number.isFinite(Number(tracking?.longitude)) ? Number(tracking?.longitude) : null)
  const hasDriverCoordinates = hasLiveSource && driverLatitude !== null && driverLongitude !== null
  const destinationLatitude =
    typeof tracking?.destinationLatitude === 'number'
      ? tracking.destinationLatitude
      : (typeof order.shippingLatitude === 'number' ? order.shippingLatitude : null)
  const destinationLongitude =
    typeof tracking?.destinationLongitude === 'number'
      ? tracking.destinationLongitude
      : (typeof order.shippingLongitude === 'number' ? order.shippingLongitude : null)
  const warehouseLatitude =
    typeof (tracking as any)?.trip?.warehouseLatitude === 'number'
      ? Number((tracking as any).trip.warehouseLatitude)
      : null
  const warehouseLongitude =
    typeof (tracking as any)?.trip?.warehouseLongitude === 'number'
      ? Number((tracking as any).trip.warehouseLongitude)
      : null

  const mapLat = hasDriverCoordinates
    ? (driverLatitude as number)
    : (typeof destinationLatitude === 'number'
      ? destinationLatitude
      : (typeof warehouseLatitude === 'number' ? warehouseLatitude : null))
  const mapLng = hasDriverCoordinates
    ? (driverLongitude as number)
    : (typeof destinationLongitude === 'number'
      ? destinationLongitude
      : (typeof warehouseLongitude === 'number' ? warehouseLongitude : null))
  const isDelivered = String(normalizeDeliveryStatus(order.status, order.paymentStatus)) === 'DELIVERED'
  const isRescheduled = isRescheduledOrder(order.status)
  const currentIndex = getOrderStageIndex(order.status, order.paymentStatus)
  const statusText = formatOrderStatus(order.status, order.paymentStatus)
  const normalizedStatus = String(normalizeDeliveryStatus(order.status, order.paymentStatus))
  const isInTransit = normalizedStatus === 'OUT_FOR_DELIVERY' || normalizedStatus === 'IN_TRANSIT'
  const scheduleLabel = isDelivered ? 'Delivered on' : isInTransit ? 'Expected on' : 'Scheduled for'
  const scheduleDateSource = isDelivered
    ? (order.deliveredAt || order.deliveryDate || order.updatedAt || order.createdAt)
    : (order.deliveryDate || order.updatedAt || order.createdAt)

  const timelineRows = [
    { key: 'pending', label: 'Order Confirmed', description: `We received your order ${order.orderNumber}.`, active: currentIndex >= 0 },
    { key: 'preparing', label: 'Preparing Order', description: 'Warehouse is preparing your items.', active: currentIndex >= 1 },
    { key: 'transit', label: 'Out for Delivery', description: 'Your order is on the way to your location.', active: currentIndex >= 2 },
    { key: 'delivered', label: 'Delivered', description: isDelivered ? 'Your package has been delivered.' : 'Waiting for final confirmation.', active: currentIndex >= 3 },
  ]

  return (
    <section className="-mx-4 min-h-[calc(100dvh-7rem)] bg-[#f7faf8] pb-6 md:mx-0 md:rounded-2xl md:border md:border-slate-200 md:bg-white">
      <div className="border-b border-slate-200 px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md" onClick={() => setActiveView('orders')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Track Your Order</h2>
            <p className="text-xs text-slate-500">Real-time updates on your delivery</p>
          </div>
        </div>
      </div>

      <div className="space-y-3 px-3 pt-3 md:px-6">
        <div className="rounded-xl bg-[linear-gradient(135deg,#0f7c3a_0%,#05672d_100%)] p-3 text-white md:p-6">
          <div className="grid grid-cols-3 gap-2 md:gap-0">
            <div className="rounded-md bg-white/5 p-2 text-center md:rounded-none md:bg-transparent md:p-0">
              <p className="text-xs text-white/80">Order Status</p>
              <p className="text-lg font-bold md:text-2xl">{statusText.toUpperCase()}</p>
            </div>
            <div className="rounded-md bg-white/5 p-2 text-center md:rounded-none md:border-l md:border-r md:border-white/20 md:bg-transparent md:px-3 md:py-0">
              <p className="text-xs text-white/80">{isReplacementOrder ? 'Replacement ID' : 'Order ID'}</p>
              <p className="text-sm font-semibold md:text-lg md:mb-2">{order.orderNumber}</p>
              {isRescheduled ? (
                <Badge className="mt-1 inline-block bg-amber-200/20 text-amber-50 hover:bg-amber-200/20 text-xs">RESCHEDULED ORDER</Badge>
              ) : null}
            </div>
            <div className="rounded-md bg-white/5 p-2 text-center md:rounded-none md:bg-transparent md:pl-3 md:py-0">
              <p className="text-xs text-white/80">{scheduleLabel}</p>
              <p className="flex items-center justify-center gap-1 text-xs font-semibold md:gap-1.5 md:text-sm md:flex-col">
                <CalendarDays className="h-3 w-3 md:h-4 md:w-4" />
                {new Date(scheduleDateSource).toLocaleDateString()}
              </p>
              {isDelivered ? (
                <p className="text-xs text-white/80 mt-1">
                  {new Date(scheduleDateSource).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <Card className="rounded-xl border-slate-200 shadow-none">
          <CardContent className="p-0">
            {isInTransit && hasDriverCoordinates && mapLat !== null && mapLng !== null ? (
              <DriverRouteMap
                latitude={mapLat}
                longitude={mapLng}
                routePoints={routePoints}
                destinationLatitude={destinationLatitude}
                destinationLongitude={destinationLongitude}
                warehouseLatitude={warehouseLatitude}
                warehouseLongitude={warehouseLongitude}
                destinationCompleted={isDelivered}
                className="h-[280px] rounded-xl md:h-[360px]"
              />
            ) : (
              <div className="grid h-[280px] place-items-center text-sm text-slate-500 md:h-[360px]">
                {isInTransit
                  ? 'Waiting for live driver GPS for this order.'
                  : 'Driver location is shown only when the order is out for delivery.'}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-2">
          <Card className="rounded-xl border-slate-200 shadow-none">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-base font-semibold text-slate-900">Delivery Journey</p>
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Live updates</Badge>
              </div>
              {isTrackingLoading ? (
                <PortalTimelineSkeleton rows={4} />
              ) : (
                <div className="space-y-3">
                  {timelineRows.map((row, idx) => (
                    <div key={row.key} className="grid grid-cols-[20px_1fr_auto] gap-2">
                      <div className="relative pt-0.5">
                        <span className={`inline-block h-4 w-4 rounded-full ${row.active ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                        {idx < timelineRows.length - 1 ? <span className={`absolute left-[7px] top-4 h-8 w-[2px] ${row.active ? 'bg-emerald-400' : 'bg-slate-200'}`} /> : null}
                      </div>
                      <div>
                        <p className={`text-sm ${row.active ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{row.label}</p>
                        <p className="text-xs text-slate-500">{row.description}</p>
                      </div>
                      <p className="text-xs text-slate-500">
                        {row.active
                          ? new Date(tracking?.updatedAt || order.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                          : '--'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl border-slate-200 shadow-none">
            <CardContent className="p-4">
              <p className="mb-3 text-base font-semibold text-slate-900">Delivery Details</p>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 text-slate-500" />
                  <div>
                    <p className="text-xs font-semibold text-slate-500">Delivery Address</p>
                    <p className="font-semibold text-slate-900">
                      {String(order.customerName || order.customer?.name || order.shippingName || order.contactName || 'Customer')}
                    </p>
                    <p className="text-slate-600">{order.shippingAddress || 'No address provided'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-slate-500" />
                  <p className="text-xs font-semibold text-slate-500">{isReplacementOrder ? 'No. of Replacement Items' : 'No. of Items'}</p>
                  <p className="ml-auto font-semibold text-slate-900">{(order.items || []).length} items</p>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-slate-500" />
                  <p className="text-xs font-semibold text-slate-500">Total Amount</p>
                  <p className="ml-auto text-2xl font-extrabold text-emerald-700">{formatPeso(getOrderTotalWithEmpties(order))}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Card className="rounded-xl border-slate-200 shadow-none">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-11 w-11 border border-slate-200">
                  {tracking?.driverAvatar ? <AvatarImage src={tracking.driverAvatar} alt={tracking?.driverName || 'Driver'} /> : null}
                  <AvatarFallback className="bg-slate-100 text-slate-700">
                    {String(tracking?.driverName || 'DR').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-xs text-slate-500">Assigned Driver</p>
                  <p className="text-sm font-semibold text-slate-900">{tracking?.driverName || 'Driver not assigned yet'}</p>
                  <p className="text-xs text-slate-500">{tracking?.driverPhone || 'No driver phone available'}</p>
                </div>
              </div>
              <Button
                size="icon"
                variant="secondary"
                className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                disabled={!String(tracking?.driverPhone || '').trim()}
                onClick={() => {
                  const dialTarget = String(tracking?.driverPhone || '').replace(/[^\d+]/g, '')
                  if (!dialTarget) return
                  window.location.href = `tel:${dialTarget}`
                }}
              >
                <Phone className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

        </div>
      </div>
    </section>
  )
}
