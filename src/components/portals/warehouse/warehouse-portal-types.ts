// Shared portal contracts live outside the stateful shell so warehouse sections can
// evolve without making WarehousePortal responsible for every API response shape.
export interface WarehouseItem {
  id: string
  name: string
  code: string
  address?: string
  city?: string
  province?: string
  latitude?: number | null
  longitude?: number | null
  capacity?: number
  isActive?: boolean
}

export interface InventoryItem {
  id: string
  quantity: number
  reservedQuantity?: number
  minStock?: number
  storageLocation?: { id: string; name: string; code: string } | null
  product?: {
    id: string
    name: string
    sku: string
    unit?: string
    weight?: number | null
    price?: number
    sizes?: string[]
    imageUrl?: string
    category?: { id: string; name: string } | null
  }
  warehouse?: { id: string; name: string; code: string }
}

export interface ProductOption {
  id: string
  name: string
  sku: string
  isActive?: boolean
  price?: number
  unit?: string
  sizes?: string[]
  category?: string
  inventoryStatus?: 'healthy' | 'low' | 'critical' | 'out_of_stock' | 'overstocked'
  isOverstocked?: boolean
  overstockInfo?: { available: number; threshold: number; daysSinceRestock: number } | null
}

export interface StockBatchItem {
  id: string
  batchNumber: string
  quantity: number
  looseUnits?: number
  receiptDate: string
  expiryDate: string | null
  status: string
  locationLabel: string | null
  inventory: {
    product?: { id?: string; sku?: string; name?: string }
    warehouse?: { id?: string; code?: string; name?: string }
    storageLocation?: { code?: string; name?: string } | null
  }
}

export interface InventoryTransactionItem {
  id: string
  createdAt: string
  type?: string
  quantity?: number
  stockUnitLabel?: string | null
  referenceType?: string | null
  referenceId?: string | null
  warehouse?: { id?: string; name?: string; code?: string } | null
  product?: { id?: string; name?: string; sku?: string } | null
}

export interface WarehouseOrderItem {
  id: string
  orderNumber: string
  updatedAt?: string
  warehouseId?: string
  status: string
  paymentStatus?: string | null
  isDriverAssigned?: boolean
  assignedDriverName?: string | null
  createdAt: string
  totalAmount: number
  notes?: string | null
  customer?: { name?: string; email?: string; phone?: string }
  shippingName?: string
  shippingPhone?: string
  shippingAddress?: string
  shippingCity?: string
  shippingProvince?: string
  shippingZipCode?: string
  shippingCountry?: string
  shippingLatitude?: number | null
  shippingLongitude?: number | null
  deliveryDate?: string | null
  items?: Array<{
    id: string
    quantity: number
    unitPrice: number
    totalPrice?: number
    product?: { name?: string; sku?: string; weight?: number | null }
    productName?: string
    name?: string
  }>
  progress?: {
    trip?: {
      tripNumber?: string
      tripSchedule?: string | null
      driver?: { user?: { name?: string }; name?: string }
      vehicle?: { licensePlate?: string }
      dropPoints?: Array<{
        id?: string
        order?: {
          id?: string
          orderNumber?: string
          status?: string
          deliveryDate?: string | null
          timeline?: { deliveryDate?: string | null } | null
        } | null
      }>
    } | null
    dropPoint?: { status?: string | null } | null
    pod?: {
      recipientName?: string | null
      deliveryPhoto?: string | null
      actualArrival?: string | null
      actualDeparture?: string | null
    } | null
  } | null
  warehouse_id?: string
  warehouseIds?: string[]
  warehouseAllocations?: Array<{
    warehouseId?: string
    warehouse_id?: string
    warehouse?: { id?: string; name?: string; code?: string }
    allocatedQty?: number
  }>
  fulfillments?: Array<{
    warehouseId?: string
    warehouse_id?: string
    warehouse?: { id?: string; name?: string }
    status?: string
    tripId?: string
  }>
  isScheduledReplacement?: boolean
  order_number?: string
  assignedTripId?: string
  tripId?: string
}

export interface WarehouseTripItem {
  id: string
  tripNumber: string
  tripSchedule?: string | null
  warehouseId?: string
  warehouse?: { id?: string; name?: string; code?: string }
  status: string
  totalDropPoints?: number
  completedDropPoints?: number
  driver?: { id?: string; name?: string; user?: { name?: string } }
  vehicle?: { id?: string; licensePlate?: string }
  dropPoints?: Array<{
    id: string
    status: string
    orderId?: string
    orderStatus?: string
    orderNumber?: string
    sequence?: number
    latitude?: number | null
    longitude?: number | null
    locationName?: string
  }>
}

export interface DriverLocationItem {
  id?: string
  driverId?: string
  driverName?: string
  tripId?: string | null
  tripStatus?: string | null
  vehiclePlate?: string | null
  latitude?: number
  longitude?: number
  heading?: number | null
  recordedAt?: string | null
}

export interface WarehouseReplacementItem {
  id: string
  replacementNumber: string
  orderId?: string | null
  orderNumber?: string | null
  customerName?: string | null
  warehouseId?: string
  status: string
  reason: string
  description?: string | null
  replacementMode?: string | null
  originalOrderItemId?: string | null
  replacementProductId?: string | null
  replacementQuantity?: number | null
  damagePhotoUrl?: string | null
  notes?: string | null
  createdAt: string
  order?: {
    warehouseId?: string
    orderNumber?: string
    customer?: { name?: string }
  }
  quantityToReplace?: number
  damagedQuantity?: number
  quantityReplaced?: number
}

export interface DriverOption {
  id: string
  serviceAreas?: string[]
  status?: string
  driverStatus?: string
  isActive?: boolean
  name?: string
  email?: string
  user?: { name?: string }
  vehicles?: Array<{
    vehicle?: {
      id?: string
      licensePlate?: string
      type?: string
      status?: string
      capacity?: number | null
    } | null
  }>
}

export interface VehicleOption {
  id: string
  licensePlate?: string
  type?: string
  capacity?: number | null
}

export interface RoutePlanOrderItem {
  id: string
  orderNumber: string
  city: string
  customerName: string
  address: string
  products?: string
  latitude?: number | null
  longitude?: number | null
  sequence: number
  distanceKm: number | null
  status: string
  currentTripOrder?: boolean
  totalCases?: number
  totalWeight?: number
  // Added: the day the route plan was filtered for, stamped client-side so the
  // Selected Orders summary shows it even after the date input is changed.
  deliveryDate?: string | null
}

export interface RoutePlanCityGroup {
  city: string
  orderCount: number
  totalDistanceKm: number
  orders: RoutePlanOrderItem[]
}

/** One eligible order in the GET /api/trips/upcoming-deliveries preview. */
export interface UpcomingDeliveryOrder {
  id: string
  orderNumber: string
  customerName: string
  city: string
  cases: number
  weight: number
  deliveryDate: string
  status?: string
}

export interface UpcomingDeliveryCity {
  city: string
  orderCount: number
  totalCases: number
}

/** A calendar day in the preview; days with no orders are still returned. */
export interface UpcomingDeliveryDay {
  date: string
  orderCount: number
  totalCases: number
  totalWeight: number
  cities: UpcomingDeliveryCity[]
  orders: UpcomingDeliveryOrder[]
}

export interface TripEditorState {
  tripId: string
  tripNumber: string
  originalOrderIds: string[]
  originalDriverId: string
  originalVehicleId: string
  driverName: string
  vehiclePlate: string
}

export interface SavedRouteDraft {
  id: string
  date: string
  warehouseId: string
  warehouseName: string
  city: string
  totalDistanceKm: number
  orderIds: string[]
  orders: RoutePlanOrderItem[]
  createdAt: string
}

export interface StockRow {
  id: string
  productId: string
  quantity: string
  manufacturedDate: string
  expiryDate: string
  validationErrors: {
    productId?: string
    quantity?: string
    manufacturedDate?: string
    expiryDate?: string
  }
}
