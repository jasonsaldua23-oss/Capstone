// Mirrors src/components/portals/customer/sections/orders/order-detail-page.tsx.
// The replacement-request form lands in Phase 5.
import { CalendarDays, CheckCircle2, MapPin, Package, Truck, Wallet } from "lucide-react-native";
import React from "react";
import { Image, Pressable, Text, View } from "react-native";

import { Badge } from "../../components/ui/badge";
import { DetailHeader } from "../../components/ui/detail-header";
import { MixedCaseComponents } from "../../components/ui/mixed-case-components";
import { formatPeso, isOrderCancellable, isOrderTrackable } from "../../lib/customer-logic";
import { resolveImageUrl } from "../../lib/format";
import {
  formatCardDateTime,
  formatOrderStatus,
  getOrderItemDisplayName,
  getOrderStageIndex,
  isRescheduledOrder,
  normalizeDeliveryStatus,
  orderStages,
} from "../../lib/shared";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export function OrderDetailScreen({ orderId }: { orderId: string }) {
  const {
    orders,
    replacements,
    setPendingCancellationOrder,
    setReceiptOrder,
    handleBuyAgain,
    setSelectedOrderId,
    setActiveTab,
    popRoute,
  } = useCustomerPortal();

  const order = orders.find((row) => row.id === orderId) || null;
  if (!order) return null;

  const normalizedStatus = String(normalizeDeliveryStatus(String(order.status || ""), order.paymentStatus));
  const rawStatus = String(order.status || "").toUpperCase();
  const rawRequestStatus = String(order.requestStatus || "").toUpperCase();
  const isCancelled =
    ["CANCELLED", "CANCELED"].includes(rawStatus) || ["CANCELLED", "CANCELED"].includes(rawRequestStatus);
  const isRejected = rawStatus === "REJECTED" || rawRequestStatus === "REJECTED";
  const isFailed = isCancelled || isRejected;
  const isDelivered = normalizedStatus === "DELIVERED";
  const isRescheduled = isRescheduledOrder(String(order.status || ""));
  const items: any[] = Array.isArray(order.items) ? order.items : [];

  const dt = formatCardDateTime(
    isDelivered ? order.deliveredAt || order.createdAt : order.createdAt
  );
  const scheduled = formatCardDateTime(order.deliveryDate);
  const stageIndex = getOrderStageIndex(String(order.status || ""), order.paymentStatus);

  const orderSubtotal = Number(
    order.subtotal ??
      items.reduce(
        (sum, item) => sum + Number(item?.totalPrice ?? Number(item?.unitPrice || 0) * Number(item?.quantity || 0)),
        0
      )
  );
  const orderTotal = Number(order.totalAmount || 0);
  const cancellationReasonText = String(order.cancellationReason || order.notes || "").trim();
  const podUrl = String(order.proofOfDeliveryUrl || "").trim();
  const hasReplacementCase = replacements.some(
    (record) => record.orderId === order.id || record.orderNumber === order.orderNumber
  );

  return (
    <View style={styles.detailSection}>
      <DetailHeader title="Back to Purchase Orders" />

      <View style={styles.detailBody}>
        <View style={styles.detailTitleRow}>
          <View style={isFailed ? styles.detailTitleIconRose : styles.detailTitleIconEmerald}>
            <Package size={20} color={isFailed ? theme.colors.roseText : theme.colors.emerald} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.detailOrderNumber}>{order.orderNumber}</Text>
            <View style={styles.detailBadgeRow}>
              <Badge
                label={
                  isCancelled
                    ? "Cancelled"
                    : isRejected
                      ? "Rejected"
                      : formatOrderStatus(String(order.status || ""), order.paymentStatus)
                }
                tone={isFailed ? "danger" : "success"}
              />
              {isRescheduled ? <Badge label="Rescheduled Order" tone="rescheduled" /> : null}
            </View>
            <View style={styles.listCardMetaRow}>
              <CalendarDays size={14} color={theme.colors.slate500} />
              <Text style={styles.listCardMeta}>
                {isCancelled ? "Cancelled on " : isRejected ? "Rejected on " : isDelivered ? "Delivered on " : "Ordered on "}
                {dt.date}
                {dt.time ? ` | ${dt.time}` : ""}
              </Text>
            </View>
            <View style={styles.listCardMetaRow}>
              <Truck size={14} color={theme.colors.emerald} />
              <Text style={styles.listCardMeta}>
                Scheduled delivery:{" "}
                <Text style={styles.listCardMetaStrong}>
                  {scheduled.date === "N/A" ? "Not scheduled" : scheduled.date}
                </Text>
              </Text>
            </View>
          </View>
        </View>

        {isFailed ? (
          <View style={styles.detailFailureBanner}>
            <Text style={styles.detailFailureTitle}>
              {isRejected ? "Reason for Rejection" : "Reason for Cancellation"}
            </Text>
            <Text style={styles.detailFailureText}>
              {cancellationReasonText ||
                (isRejected ? "This purchase request was rejected." : "This order has been cancelled.")}
            </Text>
          </View>
        ) : null}

        <View style={styles.detailStagesCard}>
          {orderStages.map((stage, idx) => {
            const done = idx <= stageIndex;
            return (
              <View key={stage} style={styles.detailStage}>
                <View style={styles.detailStageRow}>
                  <View style={[styles.detailStageDot, done ? styles.detailStageDotDone : null]}>
                    <CheckCircle2 size={12} color={done ? theme.colors.white : theme.colors.slate500} />
                  </View>
                  {idx < orderStages.length - 1 ? (
                    <View style={[styles.detailStageLine, done ? styles.detailStageLineDone : null]} />
                  ) : null}
                </View>
                <Text style={[styles.detailStageLabel, done ? styles.detailStageLabelDone : null]}>{stage}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.detailInfoCard}>
          <View style={styles.detailInfoHeadRow}>
            <MapPin size={16} color={theme.colors.textBody} />
            <Text style={styles.detailInfoHeading}>Delivery Address</Text>
          </View>
          <Text style={styles.detailInfoName}>
            {String((order as any).customerName || order.shippingName || "Customer")}
          </Text>
          <Text style={styles.detailInfoText}>{order.shippingAddress || "No address provided"}</Text>
        </View>

        <View style={styles.detailInfoCard}>
          <View style={styles.detailInfoHeadRow}>
            <Wallet size={16} color={theme.colors.textBody} />
            <Text style={styles.detailInfoHeading}>Total Amount</Text>
          </View>
          <Text style={styles.detailBigTotal}>{formatPeso(orderTotal)}</Text>
        </View>

        <View style={styles.detailTableCard}>
          <Text style={styles.detailTableCaption}>Order Items ({items.length} items)</Text>
          <View style={styles.detailTableHead}>
            <Text style={[styles.detailTableHeadText, styles.detailColProduct]}>PRODUCT</Text>
            <Text style={[styles.detailTableHeadText, styles.detailColQty]}>QTY</Text>
            <Text style={[styles.detailTableHeadText, styles.detailColPrice]}>UNIT PRICE</Text>
            <Text style={[styles.detailTableHeadText, styles.detailColSubtotal]}>SUBTOTAL</Text>
          </View>
          {items.map((item, index) => (
            <View key={item?.id || index} style={styles.detailTableRow}>
              <View style={[styles.detailColProduct, styles.detailProductCell]}>
                <Image
                  source={{ uri: resolveImageUrl(item?.product?.imageUrl) }}
                  style={styles.detailProductImage}
                  resizeMode="cover"
                />
                <View style={styles.flex}>
                  <Text style={styles.detailTableCell}>{getOrderItemDisplayName(item)}</Text>
                  {String(item?.product?.category || "").trim() ? (
                    <Text style={styles.detailProductCategory}>{String(item.product.category).trim()}</Text>
                  ) : null}
                  {item?.itemType === "MIXED_CASE" ? <MixedCaseComponents item={item} compact /> : null}
                </View>
              </View>
              <Text style={[styles.detailTableCell, styles.detailColQty]}>{item?.quantity ?? 0}</Text>
              <Text style={[styles.detailTableCell, styles.detailColPrice]}>
                {formatPeso(Number(item?.unitPrice || 0))}
              </Text>
              <Text style={[styles.detailTableCellStrong, styles.detailColSubtotal]}>
                {formatPeso(Number(item?.totalPrice ?? Number(item?.unitPrice || 0) * Number(item?.quantity || 0)))}
              </Text>
            </View>
          ))}

          <View style={styles.detailSummaryRow}>
            <Text style={styles.checkoutSummaryLabel}>Subtotal</Text>
            <Text style={styles.checkoutSummaryValue}>{formatPeso(orderSubtotal)}</Text>
          </View>
          <View style={styles.detailSummaryRow}>
            <Text style={styles.checkoutTotalLabel}>Total</Text>
            <Text style={styles.checkoutSummaryValue}>{formatPeso(orderTotal)}</Text>
          </View>

          {!hasReplacementCase ? (
            <View style={styles.detailReplacementEmpty}>
              <Text style={styles.detailReplacementEmptyTitle}>No replacement case filed for this order.</Text>
              <Text style={styles.detailReplacementEmptyHint}>
                {isDelivered
                  ? "All items were delivered successfully."
                  : "No replacement request has been submitted."}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.detailInfoCard}>
          <Text style={styles.detailInfoHeading}>Proof of Delivery (POD)</Text>
          {podUrl ? (
            <Image source={{ uri: resolveImageUrl(podUrl) }} style={styles.detailPodImage} resizeMode="cover" />
          ) : (
            <Text style={styles.detailInfoText}>No POD uploaded yet</Text>
          )}
        </View>

        <View>
          <Text style={styles.detailInfoHeading}>Order Note</Text>
          <View style={styles.detailNoteBox}>
            <Text style={styles.detailNoteText}>{String(order.notes || "").trim() || "No note for this order."}</Text>
          </View>
        </View>

        <View style={styles.listCardActions}>
          {isDelivered ? (
            <Pressable
              style={styles.listCardOutlineButton}
              onPress={() => setReceiptOrder(order)}
              accessibilityRole="button"
            >
              <Text style={styles.listCardOutlineButtonText}>View Receipt</Text>
            </Pressable>
          ) : null}
          {!isDelivered && isOrderTrackable(order) ? (
            <Pressable
              style={styles.listCardPrimaryButton}
              onPress={() => {
                setSelectedOrderId(order.id);
                popRoute();
                setActiveTab("track");
              }}
              accessibilityRole="button"
            >
              <Text style={styles.listCardPrimaryButtonText}>Track Order</Text>
            </Pressable>
          ) : null}
          {isDelivered ? (
            <Pressable
              style={styles.listCardOutlineButton}
              onPress={() => handleBuyAgain(order)}
              accessibilityRole="button"
            >
              <Text style={styles.listCardOutlineButtonText}>Buy Again</Text>
            </Pressable>
          ) : null}
          {isOrderCancellable(order) ? (
            <Pressable
              style={styles.listCardDangerButton}
              onPress={() => setPendingCancellationOrder(order)}
              accessibilityRole="button"
            >
              <Text style={styles.listCardDangerButtonText}>Cancel Order</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
