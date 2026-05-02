'use client'

import { ArrowLeft, CheckCircle, ChevronRight, Loader2, Phone, ShieldCheck } from 'lucide-react'
import dynamic from 'next/dynamic'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
  } = props

  return (
<section className="-mx-4 mt-0 bg-slate-50/90 pb-8 md:mx-0 md:rounded-[1.6rem] md:border md:border-white/70 md:bg-white/85 md:p-4 md:pb-5 md:shadow-[0_18px_45px_rgba(15,23,42,0.08)] md:backdrop-blur-xl">
            {(() => {
              const order = orders.find((o) => o.id === selectedTrackingOrderId)
              if (!order) {
                return (
                  <div className="p-4">
                    <div className="flex h-14 items-center gap-2 border-b bg-white px-2">
                      <Button variant="ghost" size="icon" onClick={() => setActiveView('orders')}>
                        <ArrowLeft className="h-5 w-5" />
                      </Button>
                      <h2 className="text-lg font-semibold">Track Your Order</h2>
                    </div>
                    <p className="pt-4 text-sm text-gray-500">Select an order to track.</p>
                  </div>
                )
              }

              const tracking = trackingByOrderId[order.id]
              const routePoints = Array.isArray(tracking?.routePoints) ? tracking.routePoints : []
              const hasDriverCoordinates =
                typeof tracking?.latitude === 'number' &&
                typeof tracking?.longitude === 'number'
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
              const mapLat = hasDriverCoordinates ? (tracking.latitude as number) : null
              const mapLng = hasDriverCoordinates ? (tracking.longitude as number) : null
              const normalizedStatus = String(normalizeDeliveryStatus(order.status, order.paymentStatus) || '').toUpperCase()
              const currentIndex = getOrderStageIndex(order.status, order.paymentStatus)
              const currentStatusLabel = formatOrderStatus(order.status, order.paymentStatus)
              const isDestinationCompleted = String(normalizeDeliveryStatus(order.status, order.paymentStatus)) === 'DELIVERED'
              const hasTrackingCoordinates = mapLat !== null && mapLng !== null
              const timelineRows = [
                {
                  key: 'pending',
                  label: 'Order Confirmed',
                  description: `We received order ${order.orderNumber}.`,
                  active: currentIndex >= 0,
                  emphasized: false,
                },
                {
                  key: 'preparing',
                  label: 'Preparing Order',
                  description: 'Warehouse is preparing your items.',
                  active: currentIndex >= 1,
                  emphasized: false,
                },
                {
                  key: 'on_the_way',
                  label: 'On The Way',
                  description: 'Your rider is on the way to your location.',
                  active: currentIndex >= 2,
                  emphasized: currentIndex === 2 && !isDestinationCompleted,
                },
                {
                  key: 'delivered',
                  label: 'Delivered',
                  description: isDestinationCompleted ? 'Your package has been delivered.' : 'Waiting for final delivery confirmation.',
                  active: currentIndex >= 3,
                  emphasized: false,
                },
              ]

              return (
                <>
                  <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-3 md:rounded-t-2xl md:border md:border-slate-200">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => setActiveView('orders')} className="h-9 w-9 rounded-xl bg-slate-100 hover:bg-slate-200 md:h-10 md:w-10">
                        <ArrowLeft className="h-5 w-5" />
                      </Button>
                      <div>
                        <h2 className="text-base font-semibold text-slate-900 md:text-lg">Track Your Order</h2>
                        <p className="text-xs text-slate-500 md:text-sm">Real-time updates on your delivery</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-2xl bg-[radial-gradient(circle_at_10%_20%,#1f2a68_0%,#211a53_45%,#0f173f_100%)] p-3 text-white shadow-[0_20px_35px_rgba(15,23,42,0.28)] md:p-5">
                    <div className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 md:grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)] md:gap-5">
                      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white/10 md:h-20 md:w-20">
                        <img
                          src="/icons/driver-location-cropped.png"
                          alt="Tracking truck"
                          className="h-10 w-10 object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,0.35)] md:h-12 md:w-12"
                          onError={(event) => {
                            event.currentTarget.onerror = null
                            event.currentTarget.src = '/icons/delivery-truck.png'
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs text-white/80 md:text-sm">Order status</p>
                        <p className="text-xl font-bold tracking-tight md:text-3xl">{currentStatusLabel.toUpperCase()}</p>
                        <p className="text-xs text-white/80 md:text-sm">
                          {isDestinationCompleted ? 'Delivery completed.' : 'Tracking is live.'}
                        </p>
                      </div>
                      <div className="border-l border-white/20 pl-3 md:pl-5">
                        <p className="text-xs text-white/80 md:text-sm">Order ID</p>
                        <p className="mt-1 break-all text-lg font-semibold leading-tight md:text-2xl">{order.orderNumber}</p>
                        <Badge className="mt-3 bg-emerald-500/20 text-xs text-emerald-200 hover:bg-emerald-500/20 md:text-sm">
                          <span className="mr-2 h-2.5 w-2.5 rounded-full bg-emerald-300" />
                          {currentStatusLabel.toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <Card className="mt-3 overflow-hidden rounded-2xl border border-slate-200 shadow-none">
                    <CardContent className="relative p-0">
                      {hasTrackingCoordinates ? (
                        <DriverRouteMap
                          latitude={mapLat as number}
                          longitude={mapLng as number}
                          routePoints={routePoints}
                          destinationLatitude={destinationLatitude}
                          destinationLongitude={destinationLongitude}
                          warehouseLatitude={warehouseLatitude}
                          warehouseLongitude={warehouseLongitude}
                          destinationCompleted={isDestinationCompleted}
                          className="h-[260px] rounded-none border-0 md:h-[420px] lg:h-[500px]"
                        />
                      ) : (
                        <div className="grid h-[260px] w-full place-items-center bg-cyan-50 px-4 text-center text-sm text-slate-600 md:h-[420px] lg:h-[500px]">
                          Waiting for live driver GPS for this order.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="mt-3 rounded-2xl border border-slate-200 shadow-none">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-xl font-semibold text-slate-900 md:text-2xl">Delivery Journey</CardTitle>
                        <Badge className="bg-violet-100 text-xs text-violet-700 hover:bg-violet-100 md:text-sm">Live updates</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-1 pt-0">
                      {isTrackingLoading ? (
                        <div className="pb-2">
                          <Loader2 className="h-5 w-5 animate-spin text-cyan-700" />
                        </div>
                      ) : null}
                      {timelineRows.map((row, index) => {
                        const isLast = index === timelineRows.length - 1
                        const ts =
                          row.active
                            ? new Date(
                                row.key === 'delivered' && order.deliveredAt
                                  ? order.deliveredAt
                                  : tracking?.updatedAt || order.createdAt
                              ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                            : '--'
                        return (
                          <div key={row.key} className="grid grid-cols-[22px_1fr] items-start gap-2 py-2 md:grid-cols-[26px_1fr_auto] md:gap-3">
                            <div className="relative flex h-full items-start justify-center pt-1">
                              <span
                                className={`h-4 w-4 rounded-full border ${
                                  row.active
                                    ? row.emphasized
                                      ? 'border-violet-500 bg-violet-500'
                                      : 'border-emerald-600 bg-emerald-600'
                                    : 'border-slate-300 bg-slate-200'
                                }`}
                              />
                              {!isLast ? (
                                <span className={`absolute top-5 h-[34px] w-[2px] ${row.active ? 'bg-emerald-500' : 'bg-slate-200'} md:h-[30px]`} />
                              ) : null}
                            </div>
                            <div>
                              <p className={`text-sm md:text-base ${row.active ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{row.label}</p>
                              <p className="text-xs text-slate-500 md:text-sm">{row.description}</p>
                              <p className={`mt-1 text-xs md:hidden ${row.emphasized ? 'font-semibold text-violet-700' : 'text-slate-500'}`}>{ts}</p>
                            </div>
                            <p className={`hidden text-sm md:block ${row.emphasized ? 'font-semibold text-violet-700' : 'text-slate-500'}`}>{ts}</p>
                          </div>
                        )
                      })}
                      <p className="pt-1 text-xs text-slate-500">
                        {tracking?.updatedAt ? `Last update: ${new Date(tracking.updatedAt).toLocaleString()}` : 'Waiting for driver updates'}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="mt-3 rounded-2xl border border-slate-200 shadow-none">
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0 flex flex-1 items-center gap-3">
                        <Avatar className="h-12 w-12 border border-slate-200 md:h-14 md:w-14">
                          {tracking?.driverAvatar ? <AvatarImage src={tracking.driverAvatar} alt={tracking?.driverName || 'Driver'} /> : null}
                          <AvatarFallback className="bg-violet-100 text-violet-700">
                            {String(tracking?.driverName || 'DR')
                              .split(' ')
                              .map((part) => part.charAt(0))
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm text-slate-500">Assigned Driver</p>
                          <p className="truncate text-lg font-semibold text-slate-900 md:text-2xl">{tracking?.driverName || 'Driver not assigned yet'}</p>
                          <p className="text-xs text-slate-500 md:text-sm">{tracking?.driverPhone || 'No driver phone available'}</p>
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-10 w-10 rounded-full bg-violet-100 text-violet-700 hover:bg-violet-200 md:h-11 md:w-11"
                          disabled={!String(tracking?.driverPhone || '').trim()}
                          onClick={() => {
                            const dialTarget = String(tracking?.driverPhone || '').replace(/[^\d+]/g, '')
                            if (!dialTarget) return
                            window.location.href = `tel:${dialTarget}`
                          }}
                        >
                          <Phone className="h-5 w-5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {tracking?.deliveryPhoto ? (
                    <Card className="mt-3 rounded-2xl border border-slate-200 shadow-none">
                      <CardContent className="space-y-3 p-4">
                        <p className="text-sm font-semibold text-slate-800">
                          Proof of Delivery
                        </p>
                        <p className="text-xs text-slate-500">
                          Recipient: {tracking?.recipientName || 'Customer'}
                        </p>
                        <img
                          src={tracking.deliveryPhoto}
                          alt="Proof of delivery"
                          className="h-44 w-full rounded-md border border-slate-200 bg-slate-950 object-contain md:h-[340px] lg:h-[420px]"
                        />
                      </CardContent>
                    </Card>
                  ) : null}

                  <Card className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 shadow-none">
                    <CardContent className="flex items-start justify-between gap-3 p-4">
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700" />
                        <div>
                          <p className="text-sm font-semibold text-emerald-900 md:text-base">Your order is safe with us</p>
                          <p className="text-xs text-emerald-800/80 md:text-sm">We never share your personal data.</p>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-emerald-700" />
                    </CardContent>
                  </Card>

                </>
              )
            })()}
          </section>
  )
}
