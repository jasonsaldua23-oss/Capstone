// Extracted from App.tsx during the Phase 0 split.
// Rewritten for web parity in the per-screen phases.
import React from "react";
import { Search } from "lucide-react-native";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { formatPeso, isOrderCancellable, isOrderTrackable } from "../../lib/customer-logic";
import { formatDate, formatStatusLabel } from "../../lib/format";
import { StatusBadge } from "../../components/ui/status-badge";
import { styles } from "../../styles/app-styles";
import { useCustomerPortal } from "../../portal/portal-context";

export function OrdersScreen() {
  const {
    orders,
    replacements,
    setActiveTab,
    setSelectedOrderId,
    orderSearch,
    setOrderSearch,
    orderStatusFilter,
    setOrderStatusFilter,
    orderDateFrom,
    setOrderDateFrom,
    orderDateTo,
    setOrderDateTo,
    setFeedbackOrderId,
    setFeedbackRatingValue,
    setSelectedFeedbackOptions,
    setPendingCancellationOrder,
    setReceiptOrder,
    setReplacementOrder,
    handleBuyAgain,
    selectedOrder,
    filteredOrders,
  } = useCustomerPortal();

  return (
    <>
      <>
        <View style={styles.card}>
          <Text style={styles.profilePageTitle}>Purchase Order</Text>
          <TextInput style={styles.input} value={orderSearch} onChangeText={setOrderSearch} placeholder="Search orders..." />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {["ALL", "PENDING", "PROCESSING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].map((status) => (
              <Pressable key={status} style={[styles.chip, orderStatusFilter === status ? styles.chipActive : null]} onPress={() => setOrderStatusFilter(status)}>
                <Text style={[styles.chipText, orderStatusFilter === status ? styles.chipTextActive : null]}>{formatStatusLabel(status)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.row}>
            <TextInput style={[styles.input, styles.flexInput]} value={orderDateFrom} onChangeText={setOrderDateFrom} placeholder="Date from YYYY-MM-DD" />
            <TextInput style={[styles.input, styles.flexInput]} value={orderDateTo} onChangeText={setOrderDateTo} placeholder="Date to YYYY-MM-DD" />
          </View>
          {filteredOrders.length === 0 ? <Text style={styles.subtle}>No purchase orders found.</Text> : null}
          {filteredOrders.map((order) => (
            <Pressable
              key={order.id}
              style={[styles.listItem, selectedOrder?.id === order.id ? styles.listItemSelected : null]}
              onPress={() => setSelectedOrderId(order.id)}
            >
              <View style={styles.flex}>
                <Text style={styles.listTitle}>{order.purchaseOrderNumber || order.orderNumber}</Text>
                <StatusBadge status={order.status} />
              </View>
              <Text style={styles.listTitle}>{formatPeso(Number(order.totalAmount || 0))}</Text>
            </Pressable>
          ))}
        </View>

        {selectedOrder ? (
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
        ) : null}
      </>
    </>
  );
}
