export interface Order {
  id: string
  orderNumber: string
  status: string
  paymentStatus?: string | null
  paymentMethod?: string | null
  shippingName?: string | null
  shippingPhone?: string | null
  shippingProvince?: string | null
  shippingZipCode?: string | null
  shippingCountry?: string | null
  subtotal?: number | null
  tax?: number | null
  shippingCost?: number | null
  discount?: number | null
  totalAmount: number
  createdAt: string
  deliveryDate?: string | null
  deliveredAt: string | null
  shippingLatitude?: number | null
  shippingLongitude?: number | null
  shippingAddress: string
  shippingCity: string
  items: OrderItem[]
}

export interface OrderItem {
  id: string
  product: {
    name: string
    sku: string
    imageUrl?: string | null
  }
  quantity: number
  unitPrice: number
  totalPrice?: number | null
}

export interface Product {
  id: string
  sku: string
  name: string
  imageUrl?: string | null
  unit: string
  price: number
  availableQuantity?: number
  inventory?: Array<{
    quantity: number
    reservedQuantity: number
  }>
}

export interface CartItem {
  productId: string
  name: string
  sku: string
  imageUrl?: string | null
  unit: string
  unitPrice: number
  quantity: number
  available: number
}

export type PaymentMethod = 'COD' | 'CARD' | 'GCASH' | 'MAYA'
export type CustomerOrdersTab = 'ALL' | 'TO_PAY' | 'TO_SHIP' | 'TO_RECEIVE' | 'TO_REVIEW' | 'REPLACEMENT' | 'DELIVERED'

export interface DriverTrackingItem {
  orderId: string
  orderNumber: string
  status: string
  tripNumber: string | null
  driverName: string | null
  driverPhone: string | null
  driverAvatar?: string | null
  etaMinutes?: number | null
  etaArrivalAt?: string | null
  latitude: number | null
  longitude: number | null
  destinationLatitude?: number | null
  destinationLongitude?: number | null
  source: 'driver_gps' | 'trip_stop' | 'shipping_address' | 'unavailable'
  updatedAt: string | null
  recipientName?: string | null
  deliveryPhoto?: string | null
  deliveredMessage?: string | null
  routePoints?: Array<{
    latitude: number
    longitude: number
    recordedAt: string
  }>
}

export interface DeliveryIssueRecord {
  id: string
  orderId: string
  orderNumber?: string | null
  replacementNumber?: string | null
  reason?: string | null
  description?: string | null
  status?: string | null
  replacementMode?: string | null
  originalOrderItemId?: string | null
  originalProductName?: string | null
  originalProductSku?: string | null
  originalQuantity?: number | null
  replacementProductId?: string | null
  replacementProductName?: string | null
  replacementProductSku?: string | null
  replacementQuantity?: number | null
  remainingQuantity?: number | null
  damagePhotoUrl?: string | null
  notes?: string | null
  createdAt?: string | null
}

export interface DeliveryIssueSummary {
  orderId: string
  label: string
  reason: string
  hasEvidence: boolean
  rawStatus: string
}
