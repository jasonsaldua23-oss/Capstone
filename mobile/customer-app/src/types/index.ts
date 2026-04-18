export interface CustomerUser {
  userId: string;
  email: string;
  name: string;
  avatar?: string | null;
  role: "CUSTOMER";
  type: "customer";
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  createdAt: string;
}

export interface CustomerTrackingItem {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  updatedAt: string;
  trip?: {
    tripNumber: string;
    status: string;
  } | null;
}
