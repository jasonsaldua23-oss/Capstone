// Mirrors src/components/portals/customer/sections/track/track-view.tsx.
import { ArrowLeft, CalendarDays, CheckCircle2, MapPin, Phone, ShieldCheck } from "lucide-react-native";
import React from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";

import { Badge } from "../../components/ui/badge";
import { CustomerTrackingMap } from "../../components/CustomerTrackingMap";
import { TimelineSkeleton } from "../../components/ui/skeleton";
import { formatPeso } from "../../lib/customer-logic";
import { resolveImageUrl } from "../../lib/format";
import { formatOrderStatus, getOrderStageIndex, isRescheduledOrder, normalizeDeliveryStatus } from "../../lib/shared";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export function TrackScreen() {
  const { orders, tracking, loading, selectedOrderId, setActiveTab } = useCustomerPortal();

  const order = orders.find((o) => o.id === selectedOrderId) || null;
  if (!order) {
    return (
      <View style={styles.trackSection}>
        <Text style={styles.trackEmptyText}>Select an order to track.</Text>
      </View>
    );
  }

  const trackingItem = tracking.find((item) => item.orderId === order.id) || null;
  const routePoints = Array.isArray(trackingItem?.routePoints) ? trackingItem!.routePoints : [];
  const orderNumberKey = String(order.orderNumber || "").trim().toUpperCase();
  const isReplacementOrder = Boolean((order as any)?.isScheduledReplacement) || orderNumberKey.startsWith("RPL-");

  const liveSource = String(trackingItem?.source || "").toLowerCase();
  const hasLiveSource = liveSource === "driver_gps" || liveSource === "trip_stop";
  const latestRoutePoint = routePoints
    .filter((p: any) => Number.isFinite(Number(p?.latitude)) && Number.isFinite(Number(p?.longitude)))
    .sort((a: any, b: any) => {
      const at = new Date(String(a?.recordedAt || "")).getTime();
      const bt = new Date(String(b?.recordedAt || "")).getTime();
      return bt - at;
    })[0];
  const driverLatitude = Number.isFinite(Number(latestRoutePoint?.latitude))
    ? Number(latestRoutePoint?.latitude)
    : Number.isFinite(Number(trackingItem?.latitude))
      ? Number(trackingItem?.latitude)
      : null;
  const driverLongitude = Number.isFinite(Number(latestRoutePoint?.longitude))
    ? Number(latestRoutePoint?.longitude)
    : Number.isFinite(Number(trackingItem?.longitude))
      ? Number(trackingItem?.longitude)
      : null;
  const hasDriverCoordinates = hasLiveSource && driverLatitude !== null && driverLongitude !== null;

  const isDelivered = String(normalizeDeliveryStatus(String(order.status || ""), order.paymentStatus)) === "DELIVERED";
  const isRescheduled = isRescheduledOrder(String(order.status || ""));
  const currentIndex = getOrderStageIndex(String(order.status || ""), order.paymentStatus);
  const statusText = formatOrderStatus(String(order.status || ""), order.paymentStatus);
  const normalizedStatus = String(normalizeDeliveryStatus(String(order.status || ""), order.paymentStatus));
  const isInTransit = normalizedStatus === "OUT_FOR_DELIVERY" || normalizedStatus === "IN_TRANSIT";
  const scheduleLabel = isDelivered ? "Delivered on" : isInTransit ? "Expected on" : "Scheduled for";
  const scheduleDateSource = isDelivered
    ? order.deliveredAt || order.deliveryDate || order.createdAt
    : order.deliveryDate || order.createdAt;

  const timelineRows = [
    { key: "pending", label: "Order Confirmed", description: `We received your order ${order.orderNumber}.`, active: currentIndex >= 0 },
    { key: "preparing", label: "Preparing Order", description: "Warehouse is preparing your items.", active: currentIndex >= 1 },
    { key: "transit", label: "Out for Delivery", description: "Your order is on the way to your location.", active: currentIndex >= 2 },
    {
      key: "delivered",
      label: "Delivered",
      description: isDelivered ? "Your package has been delivered." : "Waiting for final confirmation.",
      active: currentIndex >= 3,
    },
  ];

  const driverPhone = String(trackingItem?.driverPhone || "").trim();

  return (
    <View style={styles.trackSection}>
      <View style={styles.trackHeader}>
        <Pressable
          style={styles.trackBackButton}
          onPress={() => setActiveTab("orders")}
          accessibilityRole="button"
          accessibilityLabel="Back to orders"
        >
          <ArrowLeft size={16} color={theme.colors.textBody} />
        </Pressable>
        <View>
          <Text style={styles.trackTitle}>Track Your Order</Text>
          <Text style={styles.trackSubtitle}>Real-time updates on your delivery</Text>
        </View>
      </View>

      <View style={styles.trackBody}>
        <View style={styles.trackStrip}>
          <View style={styles.trackStripCell}>
            <Text style={styles.trackStripLabel}>Order Status</Text>
            <Text style={styles.trackStripValue}>{statusText.toUpperCase()}</Text>
          </View>
          <View style={[styles.trackStripCell, styles.trackStripCellMiddle]}>
            <Text style={styles.trackStripLabel}>{isReplacementOrder ? "Replacement ID" : "Order ID"}</Text>
            <Text style={styles.trackStripValueSmall}>{order.orderNumber}</Text>
            {isRescheduled ? (
              <View style={styles.trackRescheduledBadge}>
                <Text style={styles.trackRescheduledText}>RESCHEDULED ORDER</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.trackStripCell}>
            <Text style={styles.trackStripLabel}>{scheduleLabel}</Text>
            <View style={styles.trackStripDateRow}>
              <CalendarDays size={12} color={theme.colors.white} />
              <Text style={styles.trackStripDate}>{new Date(scheduleDateSource).toLocaleDateString()}</Text>
            </View>
            {isDelivered ? (
              <Text style={styles.trackStripLabel}>
                {new Date(scheduleDateSource).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.trackMapCard}>
          {isInTransit && hasDriverCoordinates && trackingItem ? (
            <CustomerTrackingMap tracking={trackingItem} />
          ) : (
            <View style={styles.trackMapPlaceholder}>
              <Text style={styles.trackMapPlaceholderText}>
                {isInTransit
                  ? "Waiting for live driver GPS for this order."
                  : "Driver location is shown only when the order is out for delivery."}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.trackCard}>
          <View style={styles.trackCardHeader}>
            <Text style={styles.trackCardTitle}>Delivery Journey</Text>
            <Badge label="Live updates" tone="success" />
          </View>
          {loading && tracking.length === 0 ? (
            <TimelineSkeleton rows={4} />
          ) : (
            <View style={styles.trackTimeline}>
              {timelineRows.map((row, idx) => (
                <View key={row.key} style={styles.trackTimelineRow}>
                  <View style={styles.trackTimelineRail}>
                    <View style={[styles.trackTimelineDot, row.active ? styles.trackTimelineDotActive : null]} />
                    {idx < timelineRows.length - 1 ? (
                      <View style={[styles.trackTimelineLine, row.active ? styles.trackTimelineLineActive : null]} />
                    ) : null}
                  </View>
                  <View style={styles.flex}>
                    <Text style={row.active ? styles.trackTimelineLabelActive : styles.trackTimelineLabel}>
                      {row.label}
                    </Text>
                    <Text style={styles.trackTimelineDescription}>{row.description}</Text>
                  </View>
                  <Text style={styles.trackTimelineTime}>
                    {row.active
                      ? new Date(trackingItem?.updatedAt || order.createdAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "--"}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.trackCard}>
          <Text style={styles.trackCardTitle}>Delivery Details</Text>
          <View style={styles.trackDetailRow}>
            <MapPin size={16} color={theme.colors.slate500} />
            <View style={styles.flex}>
              <Text style={styles.trackDetailLabel}>Delivery Address</Text>
              <Text style={styles.trackDetailName}>
                {String((order as any).customerName || order.shippingName || "Customer")}
              </Text>
              <Text style={styles.trackDetailValue}>{order.shippingAddress || "No address provided"}</Text>
            </View>
          </View>
          <View style={styles.trackDetailInlineRow}>
            <CheckCircle2 size={16} color={theme.colors.slate500} />
            <Text style={styles.trackDetailLabel}>
              {isReplacementOrder ? "No. of Replacement Items" : "No. of Items"}
            </Text>
            <Text style={styles.trackDetailInlineValue}>{(order.items || []).length} items</Text>
          </View>
          <View style={styles.trackDetailInlineRow}>
            <ShieldCheck size={16} color={theme.colors.slate500} />
            <Text style={styles.trackDetailLabel}>Total Amount</Text>
            <Text style={styles.trackDetailTotal}>{formatPeso(Number(order.totalAmount || 0))}</Text>
          </View>
        </View>

        <View style={styles.trackCard}>
          <View style={styles.trackDriverRow}>
            <View style={styles.trackDriverAvatar}>
              {trackingItem?.driverAvatar ? (
                <Image
                  source={{ uri: resolveImageUrl(trackingItem.driverAvatar) }}
                  style={styles.trackDriverAvatarImage}
                />
              ) : (
                <Text style={styles.trackDriverInitials}>
                  {String(trackingItem?.driverName || "DR").slice(0, 2).toUpperCase()}
                </Text>
              )}
            </View>
            <View style={styles.flex}>
              <Text style={styles.trackDetailLabel}>Assigned Driver</Text>
              <Text style={styles.trackDriverName}>{trackingItem?.driverName || "Driver not assigned yet"}</Text>
              <Text style={styles.trackDetailValue}>{driverPhone || "No driver phone available"}</Text>
            </View>
            <Pressable
              style={[styles.trackCallButton, !driverPhone ? styles.disabledButton : null]}
              disabled={!driverPhone}
              onPress={() => {
                const dialTarget = driverPhone.replace(/[^\d+]/g, "");
                if (!dialTarget) return;
                void Linking.openURL(`tel:${dialTarget}`);
              }}
              accessibilityRole="button"
              accessibilityLabel="Call driver"
            >
              <Phone size={16} color={theme.colors.emeraldDark} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
