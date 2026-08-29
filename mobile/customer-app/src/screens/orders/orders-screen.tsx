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
    pushRoute,
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
              onPress={() => {
                setSelectedOrderId(order.id);
                pushRoute({ name: "order-detail", orderId: order.id });
              }}
            >
              <View style={styles.flex}>
                <Text style={styles.listTitle}>{order.purchaseOrderNumber || order.orderNumber}</Text>
                <StatusBadge status={order.status} />
              </View>
              <Text style={styles.listTitle}>{formatPeso(Number(order.totalAmount || 0))}</Text>
            </Pressable>
          ))}
        </View>

      </>
    </>
  );
}
