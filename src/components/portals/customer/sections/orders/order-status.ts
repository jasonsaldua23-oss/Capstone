import type { Order } from '../shared/customer-types'

export const orderStages = ['Pending', 'Preparing', 'Out for Delivery', 'Delivered']

export const normalizeDeliveryStatus = (status: string, paymentStatus?: string | null) => {
  if (String(paymentStatus || '').toLowerCase() === 'pending_approval') return 'PENDING'
  const raw = String(status || '').toUpperCase()
  if (raw === 'PENDING') return 'PENDING'
  if (raw === 'CONFIRMED') return 'PREPARING'
  if (raw === 'PROCESSING' || raw === 'PACKED' || raw === 'READY_FOR_PICKUP') return 'PREPARING'
  if (raw === 'IN_TRANSIT' || raw === 'DISPATCHED') return 'OUT_FOR_DELIVERY'
  if (raw === 'COMPLETED' || raw === 'DELIVERY_COMPLETED' || raw === 'FULFILLED') return 'DELIVERED'
  return raw
}

export const getOrderStageIndex = (status: string, paymentStatus?: string | null) => {
  const normalized = normalizeDeliveryStatus(status, paymentStatus)
  if (normalized === 'PENDING') return 0
  if (normalized === 'PREPARING') return 1
  if (normalized === 'OUT_FOR_DELIVERY') return 2
  if (normalized === 'DELIVERED') return 3
  return 0
}

export const formatOrderStatus = (status: string, paymentStatus?: string | null) => {
  const normalized = normalizeDeliveryStatus(status, paymentStatus)
  return normalized.replace(/_/g, ' ')
}

export const isOrderDelivered = (order: Order | null) => {
  if (!order) return false
  return String(normalizeDeliveryStatus(order.status, order.paymentStatus)) === 'DELIVERED'
}

export const isOrderCancellable = (status: string, paymentStatus?: string | null) => {
  const raw = String(status || '').toUpperCase()
  if (raw === 'PROCESSING') {
    return String(paymentStatus || '').toLowerCase() === 'pending_approval'
  }
  return raw === 'PENDING'
}

export const isOrderTrackable = (status: string) => {
  const normalized = normalizeDeliveryStatus(status)
  return ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(normalized)
}
