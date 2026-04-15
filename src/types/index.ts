// ==================== USER TYPES ====================

export type { Role, User, Customer } from '@prisma/client'

export interface UserWithRole {
  id: string
  email: string
  name: string
  phone: string | null
  avatar: string | null
  roleId: string
  role: {
    id: string
    name: string
  }
  isActive: boolean
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface AuthUser {
  id: string
  userId?: string
  email: string
  name: string
  avatar?: string | null
  role: string
  type: 'staff' | 'customer'
}

export interface AuthSession {
  user: AuthUser
  token: string
  expiresAt: number
}

// ==================== API RESPONSE TYPES ====================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ==================== ORDER TYPES ====================

export interface OrderWithItems {
  id: string
  orderNumber: string
  customerId: string
  customer: {
    id: string
    name: string
    email: string
    phone: string | null
  }
  status: string
  priority: string
  subtotal: number
  tax: number
  shippingCost: number
  discount: number
  totalAmount: number
  paymentStatus: string
  paymentMethod: string | null
  shippingName: string
  shippingPhone: string
  shippingAddress: string
  shippingCity: string
  shippingState: string
  shippingZipCode: string
  shippingCountry: string
  shippingLatitude: number | null
  shippingLongitude: number | null
  notes: string | null
  specialInstructions: string | null
  confirmedAt: Date | null
  processedAt: Date | null
  shippedAt: Date | null
  deliveredAt: Date | null
  createdAt: Date
  updatedAt: Date
  items: OrderItemWithProduct[]
}

export interface OrderItemWithProduct {
  id: string
  orderId: string
  productId: string
  product: {
    id: string
    sku: string
    name: string
    unit: string
  }
  quantity: number
  unitPrice: number
  totalPrice: number
  notes: string | null
}

// ==================== TRIP TYPES ====================

export interface TripWithDetails {
  id: string
  tripNumber: string
  driverId: string
  driver: {
    id: string
    user: {
      name: string
      phone: string | null
    }
    licenseNumber: string
    rating: number
  }
  vehicleId: string
  vehicle: {
    id: string
    licensePlate: string
    type: string
    make: string | null
    model: string | null
  }
  status: string
  startLocation: string | null
  totalDistance: number | null
  estimatedTime: number | null
  plannedStartAt: Date | null
  plannedEndAt: Date | null
  actualStartAt: Date | null
  actualEndAt: Date | null
  totalDropPoints: number
  completedDropPoints: number
  notes: string | null
  createdAt: Date
  updatedAt: Date
  dropPoints: TripDropPointWithOrder[]
}

export interface TripDropPointWithOrder {
  id: string
  tripId: string
  orderId: string | null
  order: {
    orderNumber: string
    customer: {
      name: string
    }
  } | null
  dropPointType: string
  sequence: number
  status: string
  locationName: string
  address: string
  city: string
  state: string
  zipCode: string
  latitude: number | null
  longitude: number | null
  contactName: string | null
  contactPhone: string | null
  notes: string | null
  plannedArrival: Date | null
  actualArrival: Date | null
  recipientName: string | null
  deliveryPhoto: string | null
  failureReason: string | null
}

// ==================== INVENTORY TYPES ====================

export interface InventoryWithProduct {
  id: string
  warehouseId: string
  productId: string
  quantity: number
  reservedQuantity: number
  minStock: number
  maxStock: number
  product: {
    id: string
    sku: string
    name: string
    unit: string
    price: number
    category: {
      name: string
    } | null
  }
  warehouse: {
    id: string
    name: string
    code: string
  }
}

// ==================== DASHBOARD TYPES ====================

export interface DashboardStats {
  totalOrders: number
  pendingOrders: number
  completedOrders: number
  totalRevenue: number
  totalCustomers: number
  activeDrivers: number
  activeTrips: number
  totalVehicles: number
  lowStockItems: number
  pendingReturns: number
  inTransitOrders: number
  deliveredOrders: number
  failedOrders: number
  processingOrders: number
  availableDrivers: number
  avgRating: number
}

export interface ChartData {
  name: string
  value: number
}

export interface OrderStatusData {
  status: string
  count: number
}

// ==================== FORM TYPES ====================

export interface LoginFormData {
  email: string
  password: string
}

export interface RegisterFormData {
  name: string
  email: string
  password: string
  confirmPassword: string
  phone?: string
  address?: string
  city?: string
  state?: string
  zipCode?: string
}

export interface OrderFormData {
  customerId: string
  shippingName: string
  shippingPhone: string
  shippingAddress: string
  shippingCity: string
  shippingState: string
  shippingZipCode: string
  shippingCountry: string
  items: OrderItemFormData[]
  notes?: string
  specialInstructions?: string
}

export interface OrderItemFormData {
  productId: string
  quantity: number
  unitPrice: number
}

export interface TripFormData {
  driverId: string
  vehicleId: string
  warehouseId?: string
  plannedStartAt: Date
  notes?: string
  dropPointIds: string[]
}

// ==================== MAP TYPES ====================

export interface MapMarker {
  id: string
  latitude: number
  longitude: number
  label: string
  type: 'warehouse' | 'stop' | 'driver' | 'customer'
  status?: string
}

export interface RoutePoint {
  latitude: number
  longitude: number
  timestamp: Date
}

// ==================== PORTAL TYPES ====================

export type PortalType = 'admin' | 'driver' | 'customer' | 'warehouse'

export interface PortalState {
  currentPortal: PortalType
  setPortal: (portal: PortalType) => void
}
