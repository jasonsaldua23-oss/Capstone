// Extracted verbatim from App.tsx.
import React from "react";
import { Pressable, Text, View } from "react-native";

import { formatPeso, isOrderCancellable, isOrderTrackable } from "../../lib/customer-logic";
import { formatDate } from "../../lib/format";
import { styles } from "../../styles/app-styles";
import type { CustomerOrder, CustomerReplacement } from "../../types";
import { InfoRow } from "./info-row";
import { StatusBadge } from "./status-badge";

export function OrderDetailCard({
  order,
  replacements,
  onTrack,
  onCancel,
}: {
  order: CustomerOrder;
  replacements: CustomerReplacement[];
  onTrack: () => void;
  onCancel: () => void;
}) {
  const linkedReplacement = replacements.find((record) => record.orderId === order.id || record.orderNumber === order.orderNumber);
  return (
    <View style={styles.card}>
      <View style={styles.sectionHeadingRow}>
        <View style={styles.flex}>
          <Text style={styles.sectionTitle}>Order details</Text>
          <Text style={styles.featureTitle}>{order.purchaseOrderNumber || order.purchaseRequestNumber || order.orderNumber}</Text>
        </View>
        <StatusBadge status={order.requestStatus || order.status} />
      </View>
      <InfoRow label="Created" value={formatDate(order.createdAt)} />
      {order.deliveryDate ? <InfoRow label="Delivery date" value={formatDate(order.deliveryDate)} /> : null}
      {order.shippingAddress ? <InfoRow label="Delivery address" value={order.shippingAddress} /> : null}
      {(order.items || []).map((item) => (
        <View key={item.id} style={styles.cartRow}>
          <View style={styles.flex}>
            <Text style={styles.listTitle}>{item.itemType === "MIXED_CASE" ? `Mixed Case (${item.caseCapacity || 0} units)` : item.product?.name || "Product"}</Text>
            <Text style={styles.subtle}>Quantity: {item.quantity}</Text>
          </View>
          <Text style={styles.listTitle}>{formatPeso(Number(item.totalPrice || 0))}</Text>
        </View>
      ))}
      {order.notes ? <InfoRow label="Notes" value={order.notes} /> : null}
      {order.cancellationReason ? <View style={styles.cancellationBanner}><Text style={styles.statusBadgeTextDanger}>{order.cancellationReason}</Text></View> : null}
      {linkedReplacement ? (
        <View style={styles.replacementSummary}>
          <Text style={styles.listTitle}>{linkedReplacement.replacementNumber || "Replacement request"}</Text>
          <StatusBadge status={linkedReplacement.status} />
          <Text style={styles.subtle}>{linkedReplacement.reason || linkedReplacement.description || "Replacement request submitted."}</Text>
        </View>
      ) : null}
      <View style={styles.summaryLine}><Text style={styles.sectionTitle}>Total</Text><Text style={styles.totalText}>{formatPeso(Number(order.totalAmount || 0))}</Text></View>
      <View style={styles.row}>
        {isOrderCancellable(order) ? <Pressable style={styles.secondaryButton} onPress={onCancel}><Text style={styles.secondaryButtonText}>Cancel</Text></Pressable> : null}
        {isOrderTrackable(order) ? <Pressable style={styles.primaryButton} onPress={onTrack}><Text style={styles.primaryButtonText}>Track Order</Text></Pressable> : null}
      </View>
    </View>
  );
}
