// Extracted from App.tsx during the Phase 0 split.
// Rewritten for web parity in the per-screen phases.
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { getOrderStageIndex } from "../../lib/customer-logic";
import { formatDate } from "../../lib/format";
import { InfoRow } from "../../components/ui/info-row";
import { StatusBadge } from "../../components/ui/status-badge";
import { CustomerTrackingMap } from "../../components/CustomerTrackingMap";
import { styles } from "../../styles/app-styles";
import { useCustomerPortal } from "../../portal/portal-context";

export function TrackScreen() {
  const {
    orders,
    tracking,
    setActiveTab,
    setSelectedOrderId,
    selectedTracking,
  } = useCustomerPortal();

  return (
    <>
      <View style={styles.card}>
        <View style={styles.sectionHeadingRow}>
          <Pressable onPress={() => setActiveTab("orders")}><Text style={styles.authLink}>‹ Orders</Text></Pressable>
          <Text style={styles.sectionTitle}>Track Your Order</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {tracking.map((item) => (
            <Pressable key={item.orderId} style={[styles.chip, selectedTracking?.orderId === item.orderId ? styles.chipActive : null]} onPress={() => setSelectedOrderId(item.orderId)}>
              <Text style={[styles.chipText, selectedTracking?.orderId === item.orderId ? styles.chipTextActive : null]}>{item.orderNumber}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {tracking.length === 0 ? <Text style={styles.subtle}>No tracking updates yet.</Text> : null}
        {selectedTracking ? (
          <View style={styles.trackCard}>
            <View style={styles.sectionHeadingRow}>
              <View><Text style={styles.featureTitle}>{selectedTracking.orderNumber}</Text><StatusBadge status={selectedTracking.orderStatus || selectedTracking.status || ""} /></View>
              {selectedTracking.etaMinutes ? <Text style={styles.etaText}>{selectedTracking.etaMinutes} min ETA</Text> : null}
            </View>
            <View style={styles.timeline}>
              {["Order Confirmed", "Preparing Order", "Out for Delivery", "Delivered"].map((label, index) => {
                const active = index <= getOrderStageIndex(orders.find((order) => order.id === selectedTracking.orderId) || { id: selectedTracking.orderId, orderNumber: selectedTracking.orderNumber, status: selectedTracking.orderStatus || selectedTracking.status || "PENDING", totalAmount: 0, createdAt: selectedTracking.updatedAt });
                return <View key={label} style={styles.timelineRow}><View style={[styles.timelineDot, active ? styles.timelineDotActive : null]} /><Text style={[styles.timelineText, active ? styles.timelineTextActive : null]}>{label}</Text></View>;
              })}
            </View>
            <CustomerTrackingMap tracking={selectedTracking} />
            {selectedTracking.driverName ? <InfoRow label="Driver" value={selectedTracking.driverName} /> : null}
            {selectedTracking.driverPhone ? <InfoRow label="Phone" value={selectedTracking.driverPhone} /> : null}
            {selectedTracking.tripNumber || selectedTracking.trip?.tripNumber ? <InfoRow label="Trip" value={selectedTracking.tripNumber || selectedTracking.trip?.tripNumber || ""} /> : null}
            <Text style={styles.subtle}>Updated: {formatDate(selectedTracking.updatedAt)}</Text>
          </View>
        ) : null}
      </View>
    </>
  );
}
