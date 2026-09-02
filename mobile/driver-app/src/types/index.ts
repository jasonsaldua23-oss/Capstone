export type StaffRole = "SUPER_ADMIN" | "ADMIN" | "WAREHOUSE_STAFF" | "DRIVER";

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  avatar?: string | null;
  role: StaffRole;
  type: "staff";
  phone?: string | null;
  sessionTimeoutMinutes?: number;
}

export interface DriverProfile extends AuthUser {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  suffix?: string | null;
  emergencyContact?: string | null;
  licenseNumber?: string | null;
  licenseType?: string | null;
  licenseExpiry?: string | null;
  twoFactorEnabled?: boolean;
  loginAlertsEnabled?: boolean;
}

export interface DriverMixedCaseComponent {
  id?: string;
  productId?: string | null;
  productName?: string | null;
  productSku?: string | null;
  quantityPerCase?: number | null;
  caseCount?: number | null;
  totalBaseUnits?: number | null;
  baseUnitLabel?: string | null;
  product?: {
    id?: string | null;
    name?: string | null;
    sku?: string | null;
    imageUrl?: string | null;
    sizes?: string[] | null;
    category?: string | null;
  } | null;
}

export interface DriverTripOrderItem {
  id: string;
  itemType?: "STANDARD_CASE" | "MIXED_CASE" | null;
  quantity?: number | null;
  caseCapacity?: number | null;
  containerTypeId?: string | null;
  containerTypeName?: string | null;
  isReturnableItem?: boolean | null;
  fullQuantity?: number | null;
  // Serialized from OrderItem.unit_price / total_price; the history order detail
  // shows the per-case price and line total the way the web portal does.
  unitPrice?: number | null;
  totalPrice?: number | null;
  product?: {
    id?: string | null;
    name?: string | null;
    sku?: string | null;
    unit?: string | null;
    sizeLabel?: string | null;
    category?: string | null;
    imageUrl?: string | null;
  } | null;
  components?: DriverMixedCaseComponent[];
}

export interface DriverTripOrder {
  id: string;
  orderNumber?: string | null;
  status?: string | null;
  shippingAddress?: string | null;
  shippingCity?: string | null;
  shippingProvince?: string | null;
  shippingPhone?: string | null;
  shippingName?: string | null;
  warehouseStage?: string | null;
  deliveryDate?: string | null;
  totalAmount?: number | null;
  scheduledReplacement?: Record<string, unknown> | null;
  items?: DriverTripOrderItem[];
  replacements?: DriverReplacement[];
}

export interface DriverReplacement {
  id: string;
  replacementNumber?: string | null;
  status?: string | null;
  replacementQuantity?: number | null;
  remainingQuantity?: number | null;
  damagePhotoUrl?: string | null;
  notes?: string | null;
  isClosed?: boolean;
}

export interface DriverTripDropPoint {
  id: string;
  sequence?: number | null;
  status?: string | null;
  type?: string | null;
  locationName?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  zipCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
  actualArrival?: string | null;
  actualDeparture?: string | null;
  recipientName?: string | null;
  deliveryPhoto?: string | null;
  failureReason?: string | null;
  failureNotes?: string | null;
  notes?: string | null;
  /** What the customer said they would hand over, for the driver to verify. */
  declaredEmpties?: DeclaredEmpty[] | null;
  order?: DriverTripOrder | null;
}

export interface DeclaredEmpty {
  containerTypeId: string;
  containerTypeName?: string | null;
  /** Always in containers, which is what the settlement works in. */
  declaredQuantity: number;
  /** The same declaration in the unit the driver handles: cases, or containers. */
  declaredUnits?: number | null;
  containersPerUnit?: number | null;
  countsByCase?: boolean | null;
  unitLabel?: string | null;
  depositPerContainer?: number | null;
  depositValue?: number | null;
}

export interface DriverTripVehicle {
  id: string;
  licensePlate?: string | null;
  type?: string | null;
  status?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
}

export interface DriverTripLocation {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  recordedAt?: string | null;
}

export interface DriverTrip {
  id: string;
  tripNumber: string;
  status: string;
  plannedStartAt?: string | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  updatedAt?: string | null;
  notes?: string | null;
  tripSchedule?: string | null;
  warehouseId?: string | null;
  warehouseLatitude?: number | null;
  warehouseLongitude?: number | null;
  startLatitude?: number | null;
  startLongitude?: number | null;
  warehouse?: {
    id?: string | null;
    name?: string | null;
    code?: string | null;
    address?: string | null;
    city?: string | null;
    province?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  totalDropPoints?: number | null;
  completedDropPoints?: number | null;
  dropPoints?: DriverTripDropPoint[];
  vehicle?: DriverTripVehicle | null;
  latestLocation?: DriverTripLocation | null;
}

export interface DriverNotification {
  id: string;
  title?: string | null;
  message?: string | null;
  type?: string | null;
  isRead?: boolean;
  readAt?: string | null;
  createdAt?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
}
