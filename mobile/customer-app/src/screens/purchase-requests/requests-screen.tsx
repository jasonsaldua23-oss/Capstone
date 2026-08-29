// Extracted from App.tsx during the Phase 0 split.
// Rewritten for web parity in the per-screen phases.
import React from "react";
import { Search } from "lucide-react-native";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { formatPeso, isOrderCancellable } from "../../lib/customer-logic";
import { formatDate, formatStatusLabel } from "../../lib/format";
import { StatusBadge } from "../../components/ui/status-badge";
import { OrderDetailCard } from "../../components/ui/order-detail-card";
import { styles } from "../../styles/app-styles";
import { useCustomerPortal } from "../../portal/portal-context";

export function PurchaseRequestsScreen() {
  const {
    replacements,
    setActiveTab,
    selectedOrderId,
    setSelectedOrderId,
    orderSearch,
    setOrderSearch,
    requestStatusFilter,
    setRequestStatusFilter,
    setPendingCancellationOrder,
    selectedOrder,
    purchaseRequests,
    filteredRequests,
  } = useCustomerPortal();

  return (
    <>
      <>
        <View style={styles.pageHeading}>
          <Text style={styles.profilePageTitle}>Purchase Request</Text>
          <Text style={styles.profilePageSubtitle}>Review submitted requests and warehouse approval status.</Text>
        </View>
        <View style={styles.card}>
          <TextInput style={styles.input} value={orderSearch} onChangeText={setOrderSearch} placeholder="Search purchase requests..." />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {["ALL", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].map((status) => (
              <Pressable key={status} style={[styles.chip, requestStatusFilter === status ? styles.chipActive : null]} onPress={() => setRequestStatusFilter(status)}>
                <Text style={[styles.chipText, requestStatusFilter === status ? styles.chipTextActive : null]}>{formatStatusLabel(status)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {filteredRequests.length === 0 ? <Text style={styles.subtle}>No purchase requests found.</Text> : null}
          {filteredRequests.map((order) => (
            <Pressable key={order.id} style={[styles.orderCard, selectedOrderId === order.id ? styles.listItemSelected : null]} onPress={() => setSelectedOrderId(order.id)}>
              <View style={styles.sectionHeadingRow}>
                <Text style={styles.featureTitle}>{order.purchaseRequestNumber || order.orderNumber}</Text>
                <StatusBadge status={order.requestStatus || order.status} />
              </View>
              <Text style={styles.subtle}>{formatDate(order.createdAt)}</Text>
              <Text style={styles.totalText}>{formatPeso(Number(order.totalAmount || 0))}</Text>
              {isOrderCancellable(order) ? (
                <Pressable style={styles.outlineActionButton} onPress={() => setPendingCancellationOrder(order)}>
                  <Text style={styles.outlineActionButtonText}>Cancel Request</Text>
                </Pressable>
              ) : null}
            </Pressable>
          ))}
        </View>
        {selectedOrder && purchaseRequests.some((order) => order.id === selectedOrder.id) ? (
          <OrderDetailCard order={selectedOrder} replacements={replacements} onTrack={() => setActiveTab("track")} onCancel={() => setPendingCancellationOrder(selectedOrder)} />
        ) : null}
      </>
    </>
  );
}
