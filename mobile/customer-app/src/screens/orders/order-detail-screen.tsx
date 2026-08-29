// Pushed detail route, matching the web portal's `order-detail` view.
// Content is the block previously rendered inline under the order list; it is
// rewritten against src/components/portals/customer/sections/orders/order-detail-page.tsx
// in Phase 4.
import React from "react";
import { Pressable, Text, View } from "react-native";

import { DetailHeader } from "../../components/ui/detail-header";
import { formatPeso, isOrderCancellable, isOrderTrackable } from "../../lib/customer-logic";
import { formatDate } from "../../lib/format";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";

export function OrderDetailScreen({ orderId }: { orderId: string }) {
  const {
    orders,
    replacements,
    setActiveTab,
    setPendingCancellationOrder,
    setFeedbackOrderId,
    setFeedbackRatingValue,
    setSelectedFeedbackOptions,
    setReceiptOrder,
    handleBuyAgain,
    setReplacementOrder,
  } = useCustomerPortal();

  const selectedOrder = orders.find((order) => order.id === orderId) || null;
  if (!selectedOrder) return null;

  return (
    <>
      <DetailHeader title="Purchase Order" subtitle={selectedOrder.orderNumber} />
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Order details</Text>
        <Text style={styles.featureTitle}>{selectedOrder.orderNumber}</Text>
        <Text style={styles.subtle}>Status: {selectedOrder.status}</Text>
        <Text style={styles.subtle}>Created: {formatDate(selectedOrder.createdAt)}</Text>
        {selectedOrder.shippingAddress ? <Text style={styles.bodyText}>{selectedOrder.shippingAddress}</Text> : null}
        {(selectedOrder.items || []).map((item) => {
          const isMixedCase = item.itemType === "MIXED_CASE";
          return (
            <View key={item.id} style={styles.cartRow}>
              <View style={styles.flex}>
                <Text style={styles.listTitle}>
                  {isMixedCase ? `Mixed Case (${item.caseCapacity || 0} units)` : item.product?.name || "Product"}
                </Text>
                <Text style={styles.subtle}>Qty {item.quantity}</Text>
                {isMixedCase
                  ? (item.components || []).map((component) => (
                      <Text key={component.id || component.productId} style={styles.subtle}>
                        {component.productName}: {component.quantityPerCase}/case · PHP {Number(component.componentSubtotal || 0).toFixed(2)} subtotal
                      </Text>
                    ))
                  : null}
              </View>
              <Text style={styles.listTitle}>PHP {Number(item.totalPrice || 0).toFixed(2)}</Text>
            </View>
          );
        })}
        <View style={styles.row}>
          {isOrderCancellable(selectedOrder) ? (
            <Pressable style={styles.secondaryButton} onPress={() => setPendingCancellationOrder(selectedOrder)}>
              <Text style={styles.secondaryButtonText}>Cancel Order</Text>
            </Pressable>
          ) : null}
          <Pressable style={[styles.primaryButton, !isOrderTrackable(selectedOrder) ? styles.disabledButton : null]} onPress={() => setActiveTab("track")} disabled={!isOrderTrackable(selectedOrder)}>
            <Text style={styles.primaryButtonText}>Track Order</Text>
          </Pressable>
          {String(selectedOrder.status || "").toUpperCase() === "DELIVERED" ? (
            <Pressable
              style={styles.outlineActionButton}
              onPress={() => {
                setFeedbackOrderId(selectedOrder.id);
                setFeedbackRatingValue(5);
                setSelectedFeedbackOptions([]);
                setActiveTab("feedback");
              }}
            >
              <Text style={styles.outlineActionButtonText}>Feedback</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.outlineActionButton} onPress={() => setReceiptOrder(selectedOrder)}>
            <Text style={styles.outlineActionButtonText}>View Receipt</Text>
          </Pressable>
          {String(selectedOrder.status || "").toUpperCase() === "DELIVERED" ? (
            <Pressable style={styles.outlineActionButton} onPress={() => handleBuyAgain(selectedOrder)}>
              <Text style={styles.outlineActionButtonText}>Buy Again</Text>
            </Pressable>
          ) : null}
          {String(selectedOrder.status || "").toUpperCase() === "DELIVERED" && !replacements.some((record) => record.orderId === selectedOrder.id || record.orderNumber === selectedOrder.orderNumber) ? (
            <Pressable style={styles.outlineActionButton} onPress={() => setReplacementOrder(selectedOrder)}>
              <Text style={styles.outlineActionButtonText}>Request Replacement</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </>
  );
}
