/**
 * Transactions delivered on one calendar day, for the Live Tracking page.
 *
 * Live Tracking only drew trips that were still IN_PROGRESS, so once a trip was
 * completed its deliveries vanished, and an order delivered later than its
 * scheduled day never belonged to any day at all. A delivery belongs to the day
 * it happened: a stop's completion time (`actualDeparture`), or the order's own
 * `deliveredAt` when no trip stop carried it.
 */

export type DeliveredTransaction = {
  orderId: string
  orderNumber: string
  customerName: string
  address: string
  latitude: number | null
  longitude: number | null
  deliveredAt: string
  tripNumber: string
  driverName: string
  recipientName: string
}

const DELIVERED_STOP_STATUSES = new Set(['COMPLETED', 'DELIVERED', 'FULFILLED'])

const upper = (value: unknown) => String(value || '').trim().toUpperCase()
const text = (value: unknown) => String(value || '').trim()

function toCoordinate(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function localDayKey(value: unknown): string | null {
  if (!value) return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return null
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Map pin for a delivery that no in-progress trip already draws. */
export function deliveredTransactionPin(delivery: DeliveredTransaction) {
  if (delivery.latitude === null || delivery.longitude === null) return null
  return {
    id: `delivered-${delivery.orderId}`,
    driverName: delivery.orderNumber,
    vehiclePlate: delivery.customerName || delivery.address || 'Customer location',
    lat: delivery.latitude,
    lng: delivery.longitude,
    status: 'DELIVERED',
    markerColor: '#2563eb',
    markerType: 'pin' as const,
    markerLabel: 'Delivered',
  }
}

export function buildDeliveredTransactions({
  trips,
  orders = [],
  dayKey,
}: {
  trips: any[]
  orders?: any[]
  dayKey: string
}): DeliveredTransaction[] {
  const byOrderId = new Map<string, DeliveredTransaction>()

  for (const trip of Array.isArray(trips) ? trips : []) {
    const driverName = text(trip?.driver?.name || trip?.driver?.user?.name)
    for (const stop of Array.isArray(trip?.dropPoints) ? trip.dropPoints : []) {
      const delivered = DELIVERED_STOP_STATUSES.has(upper(stop?.status)) || upper(stop?.orderStatus) === 'DELIVERED'
      if (!delivered) continue
      const deliveredAt = text(stop?.actualDeparture || stop?.actualArrival)
      if (localDayKey(deliveredAt) !== dayKey) continue
      const orderId = text(stop?.orderId || stop?.order?.id) || `stop-${text(stop?.id)}`
      const existing = byOrderId.get(orderId)
      if (existing && existing.deliveredAt >= deliveredAt) continue
      byOrderId.set(orderId, {
        orderId,
        orderNumber: text(stop?.orderNumber || stop?.order?.orderNumber) || 'Order',
        customerName: text(stop?.locationName || stop?.contactName),
        address: text(stop?.address),
        latitude: toCoordinate(stop?.latitude),
        longitude: toCoordinate(stop?.longitude),
        deliveredAt,
        tripNumber: text(trip?.tripNumber),
        driverName,
        recipientName: text(stop?.recipientName),
      })
    }
  }

  // Orders closed as delivered without a trip stop (a direct status update).
  for (const order of Array.isArray(orders) ? orders : []) {
    if (upper(order?.status) !== 'DELIVERED') continue
    const orderId = text(order?.id)
    if (!orderId || byOrderId.has(orderId)) continue
    // Legacy rows without a delivery time fall back to their scheduled day.
    const deliveredAt = text(order?.deliveredAt || order?.timeline?.deliveredAt || order?.deliveryDate)
    if (localDayKey(deliveredAt) !== dayKey) continue
    byOrderId.set(orderId, {
      orderId,
      orderNumber: text(order?.orderNumber) || 'Order',
      customerName: text(order?.shippingName || order?.customer?.name),
      address: text(order?.shippingAddress),
      latitude: toCoordinate(order?.shippingLatitude),
      longitude: toCoordinate(order?.shippingLongitude),
      deliveredAt,
      tripNumber: '',
      driverName: '',
      recipientName: text(order?.podRecipientName),
    })
  }

  return Array.from(byOrderId.values()).sort(
    (left, right) => new Date(right.deliveredAt).getTime() - new Date(left.deliveredAt).getTime()
  )
}
