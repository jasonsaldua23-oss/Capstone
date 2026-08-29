// Pushed detail route, matching the web portal's `purchase-request-detail` view.
// Content is the card previously rendered inline under the request list; it is
// rewritten against
// src/components/portals/customer/sections/purchase-requests/purchase-request-detail-page.tsx
// in Phase 4.
import React from "react";

import { DetailHeader } from "../../components/ui/detail-header";
import { OrderDetailCard } from "../../components/ui/order-detail-card";
import { useCustomerPortal } from "../../portal/portal-context";

export function PurchaseRequestDetailScreen({ orderId }: { orderId: string }) {
  const { orders, replacements, setActiveTab, setPendingCancellationOrder } = useCustomerPortal();

  const order = orders.find((row) => row.id === orderId) || null;
  if (!order) return null;

  return (
    <>
      <DetailHeader title="Purchase Request" subtitle={order.purchaseRequestNumber || order.orderNumber} />
      <OrderDetailCard
        order={order}
        replacements={replacements}
        onTrack={() => setActiveTab("track")}
        onCancel={() => setPendingCancellationOrder(order)}
      />
    </>
  );
}
