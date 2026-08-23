export interface Order {
  id: string
  orderNumber: string
  status: string
  paymentStatus?: string | null
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
  itemType?: 'STANDARD_CASE' | 'MIXED_CASE'
  caseCapacity?: number | null
  product: {
    id?: string | null
    name: string
    sku: string
    imageUrl?: string | null
  } | null
  quantity: number
  unitPrice: number
  totalPrice?: number | null
  components?: MixedCaseComponent[]
}

export interface MixedCaseComponent {
  id?: string
  productId: string
  productName: string
  productSku?: string | null
  quantityPerCase: number
  caseCount: number
  totalBaseUnits: number
  unitPrice: number
  componentSubtotal: number
  baseUnitLabel: string
  product?: Product | null
}

export interface Product {
  id: string
  sku: string
  name: string
  imageUrl?: string | null
  unit: string
  category?: string
  containerPackagingType?: 'Glass Bottle' | 'Plastic Bottle' | 'Can'
  looseUnit?: 'Glass Bottle' | 'Plastic Bottle' | 'Can'
  packagingCompatibilityKey?: 'GLASS_BOTTLE' | 'PET_PLASTIC_BOTTLE' | 'CAN'
  depositAllowed?: boolean
  depositExempt?: boolean
  depositStatus?: string
  sizes?: string[]
  size?: string
  sizeLabel?: string
  price: number
  casePrice?: number | null
  retailUnitPrice?: number | null
  availableQuantity?: number
  availableBaseUnits?: number
  baseUnitPrice?: number
  quantityPerUnit?: number | null
  quantityPerCase?: number | null
  packagingType?: 'RETURNABLE' | 'NON_RETURNABLE'
  containerTypeId?: string | null
  containerTypeName?: string | null
  containersPerCase?: number
  depositAmount?: number
  caseDepositAmount?: number
  inventory?: Array<{
    quantity: number
    reservedQuantity: number
  }>
}

export interface CartItem {
  productId: string
  itemType?: 'STANDARD_CASE' | 'MIXED_CASE'
  name: string
  sku: string
  imageUrl?: string | null
  unit: string
  sizeLabel?: string
  category?: string
  containerPackagingType?: 'Glass Bottle' | 'Plastic Bottle' | 'Can'
  looseUnit?: 'Glass Bottle' | 'Plastic Bottle' | 'Can'
  packagingCompatibilityKey?: 'GLASS_BOTTLE' | 'PET_PLASTIC_BOTTLE' | 'CAN'
  depositExempt?: boolean
  unitPrice: number
  quantity: number
  available: number
  caseCapacity?: number
  components?: MixedCaseComponent[]
  packagingType?: string
  emptyReturnedQuantity?: number
  depositAmount?: number
  caseDepositAmount?: number
  containersPerCase?: number
  containerTypeId?: string | null
  containerTypeName?: string | null
  availableEmptyBottles?: number
  availableDepositBalance?: number
}

export type CustomerOrdersTab = 'ALL' | 'TO_SHIP' | 'TO_RECEIVE' | 'TO_REVIEW' | 'REPLACEMENT' | 'DELIVERED'

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
