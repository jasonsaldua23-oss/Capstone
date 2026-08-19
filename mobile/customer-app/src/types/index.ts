export interface CustomerUser {
  userId: string;
  email: string;
  name: string;
  avatar?: string | null;
  role: "CUSTOMER";
  type: "customer";
  phone?: string | null;
}

export interface CustomerProfile extends CustomerUser {
  address?: string | null;
  city?: string | null;
  province?: string | null;
  zipCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
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
  quantityPerUnit?: number | null;
  availableQuantity?: number;
  availableBaseUnits?: number;
  baseUnitPrice?: number;
  packagingProfile?: PackagingProfile | null;
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
}
