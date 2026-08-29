export interface CustomerUser {
  userId: string;
  email: string;
  name: string;
  avatar?: string | null;
  role: "CUSTOMER";
  type: "customer";
  phone?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  suffix?: string | null;
  twoFactorEnabled?: boolean;
  loginAlertsEnabled?: boolean;
}

export interface CustomerProfile extends CustomerUser {
  address?: string | null;
  city?: string | null;
  province?: string | null;
  zipCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  country?: string | null;
  discountOption?: string | null;
  discountStatus?: string | null;
  discountPercent?: number | null;
  discountAmountPerCase?: number | null;
  bottleBalances?: CustomerBottleBalance[];
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  imageUrl?: string | null;
  unit?: string | null;
  price: number;
  category?: string | null;
  sizes?: string[];
  // The web Product type carries both; the catalog card falls back to them.
  size?: string | null;
  sizeLabel?: string | null;
  quantityPerUnit?: number | null;
  availableQuantity?: number;
  availableBaseUnits?: number;
  baseUnitPrice?: number;
  packagingProfile?: PackagingProfile | null;
  packagingType?: string | null;
  containerTypeId?: string | null;
  containerTypeName?: string | null;
  containersPerCase?: number | null;
  depositAmount?: number | null;
  caseDepositAmount?: number | null;
  depositExempt?: boolean;
  inventory?: Array<{ quantity: number; reservedQuantity: number }>;
}

export interface PackagingProfile {
  id: string;
  code: string;
  name: string;
  standardUnitsPerCase: number;
  allowedMixedCaseCapacities: number[];
  compatibilityKey: string;
  baseUnitLabel: string;
  isActive: boolean;
}

export interface MixedCaseComponent {
  id?: string;
  productId: string;
  productName: string;
  productSku?: string | null;
  quantityPerCase: number;
  caseCount: number;
  totalBaseUnits: number;
  unitPrice: number;
  componentSubtotal: number;
  baseUnitLabel: string;
}

export interface MobileMixedCaseCartItem {
  id: string;
  itemType: "MIXED_CASE";
  caseCapacity: number;
  quantity: number;
  unitPrice: number;
  components: MixedCaseComponent[];
}

export interface CustomerOrderItem {
  id: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  product?: Product | null;
  itemType?: "STANDARD_CASE" | "MIXED_CASE";
  caseCapacity?: number | null;
  components?: MixedCaseComponent[];
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  shippingAddress?: string | null;
  shippingCity?: string | null;
  shippingProvince?: string | null;
  shippingName?: string | null;
  shippingPhone?: string | null;
  shippingZipCode?: string | null;
  shippingCountry?: string | null;
  shippingLatitude?: number | null;
  shippingLongitude?: number | null;
  paymentStatus?: string | null;
  requestStatus?: string | null;
  purchaseRequestNumber?: string | null;
  purchaseOrderNumber?: string | null;
  purchaseOrderStage?: string | null;
  subtotal?: number | null;
  discount?: number | null;
  depositCharged?: number | null;
  depositRefunded?: number | null;
  notes?: string | null;
  deliveryDate?: string | null;
  deliveredAt?: string | null;
  cancellationReason?: string | null;
  proofOfDeliveryUrl?: string | null;
  items?: CustomerOrderItem[];
}

export interface CustomerTrackingTrip {
  tripNumber: string;
  status: string;
}

export interface CustomerTrackingItem {
  orderId: string;
  orderNumber: string;
  orderStatus?: string;
  status?: string;
  updatedAt: string;
  etaMinutes?: number | null;
  source?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  trip?: CustomerTrackingTrip | null;
  tripNumber?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  driverAvatar?: string | null;
  etaArrivalAt?: string | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  recipientName?: string | null;
  deliveryPhoto?: string | null;
  deliveredMessage?: string | null;
  routePoints?: Array<{ latitude: number; longitude: number; recordedAt?: string | null }>;
}

export interface CustomerNotification {
  id: string;
  title: string;
  message: string;
  type?: string | null;
  isRead?: boolean;
  createdAt?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
}

export interface CustomerReplacement {
  id: string;
  replacementNumber?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  reason?: string | null;
  description?: string | null;
  status?: string | null;
  damagePhotoUrl?: string | null;
  damagePhotoUrls?: string[];
  replacementQuantity?: number | null;
  createdAt?: string | null;
}

export interface CustomerBottleBalance {
  containerTypeId?: string | null;
  containerTypeName?: string | null;
  bottlesOutstanding?: number;
  depositBalance?: number;
  bottlesReturnedTotal?: number;
  bottlesSoldTotal?: number;
}

export interface EligibleEmptyItem {
  productId: string;
  productName: string;
  imageUrl?: string | null;
  category?: string | null;
  containerTypeId: string;
  containerTypeName: string;
  containersPerCase: number;
  unitDeposit: number;
  caseDeposit: number;
  totalCasesOrdered: number;
  currentlyHeldCases: number;
  availableCasesToReturn: number;
}
