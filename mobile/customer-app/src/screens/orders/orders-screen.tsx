// Mirrors src/components/portals/customer/sections/orders/orders-view.tsx.
import { CalendarDays, ChevronRight, Filter, MapPin, Package2, Search, Star, Truck } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";

import { Badge } from "../../components/ui/badge";
import { MixedCaseComponents } from "../../components/ui/mixed-case-components";
import { Pagination } from "../../components/ui/pagination";
import { CardsSkeleton } from "../../components/ui/skeleton";
import { TabBar, type TabOption } from "../../components/ui/tab-bar";
import { formatPeso, isOrderCancellable, isOrderTrackable } from "../../lib/customer-logic";
import { resolveImageUrl } from "../../lib/format";
import {
  buildReplacementTabOrders,
  formatCardDateTime,
  formatOrderedQuantityWithContainer,
  getOrderItemDisplayName,
  getReplacementDisplayStatus,
  getReplacementItemsForRecord,
  getReplacementStatusTone,
  isRescheduledOrder,
  normalizeDeliveryStatus,
} from "../../lib/shared";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

const PAGE_SIZE = 10;

type OrdersTab = "ALL" | "DELIVERED" | "TO_REVIEW" | "REPLACEMENT";

const TAB_OPTIONS: Array<TabOption<OrdersTab>> = [
  { id: "ALL", label: "All", Icon: Package2 },
  { id: "DELIVERED", label: "Delivered", Icon: Truck },
  { id: "TO_REVIEW", label: "To Review", Icon: Star },
  { id: "REPLACEMENT", label: "Replacement", Icon: Package2 },
];

const isReplacementOrder = (order: any) =>
  String(order?.orderNumber || "").trim().toUpperCase().startsWith("RPL-") ||
  Boolean(order?.isScheduledReplacement);

export function OrdersScreen() {
  const {
    orders,
    loading,
    replacements,
    orderSearch,
    setOrderSearch,
    ordersTab,
    setOrdersTab,
    orderFilterStatus,
    orderFilterDateFrom,
    orderFilterDateTo,
    setFilterDialogVisible,
    setSelectedOrderId,
    setPendingCancellationOrder,
    setPendingCancelReplacement,
    setRatingDialogOrder,
    setDeliveryRatingValue,
    setReceiptOrder,
    handleBuyAgain,
    setActiveTab,
    pushRoute,
  } = useCustomerPortal();

  const [currentPage, setCurrentPage] = useState(1);

  // The Replacement tab lists replacement records, not orders: each row is a
  // synthetic order built from the record, matching the web's replacementTabOrders.
  const replacementTabOrders = useMemo(
    () => buildReplacementTabOrders(replacements, orders),
    [replacements, orders]
  );

  const visibleOrders = useMemo(() => {
    const query = orderSearch.trim().toLowerCase();
    const source = ordersTab === "REPLACEMENT" ? replacementTabOrders : orders;
    return source.filter((order) => {
      const normalized = String(normalizeDeliveryStatus(String(order.status || ""), order.paymentStatus));
      const replacement = isReplacementOrder(order);

      if (ordersTab === "ALL" && replacement) return false;
      if (ordersTab === "DELIVERED" && (replacement || normalized !== "DELIVERED")) return false;
      if (ordersTab === "TO_REVIEW" && (replacement || normalized !== "DELIVERED")) return false;
      if (ordersTab === "REPLACEMENT") {
        // Rows here are already replacements; only search and the date filter apply.
        if (!query) return true;
        return String(order.orderNumber || "").toLowerCase().includes(query);
      }

      if (orderFilterStatus !== "ALL" && normalized !== orderFilterStatus) return false;
      const created = String(order.createdAt || "").slice(0, 10);
      if (orderFilterDateFrom && created < orderFilterDateFrom) return false;
      if (orderFilterDateTo && created > orderFilterDateTo) return false;

      if (!query) return true;
      return [order.purchaseOrderNumber, order.orderNumber, normalized].some((value) =>
        String(value || "").toLowerCase().includes(query)
      );
    });
  }, [orders, replacementTabOrders, ordersTab, orderSearch, orderFilterStatus, orderFilterDateFrom, orderFilterDateTo]);

  const totalPages = Math.max(1, Math.ceil(visibleOrders.length / PAGE_SIZE));
  const activePage = Math.min(currentPage, totalPages);
  const pagedOrders = visibleOrders.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);
  const startIndex = visibleOrders.length === 0 ? 0 : (activePage - 1) * PAGE_SIZE + 1;
  const endIndex = Math.min(activePage * PAGE_SIZE, visibleOrders.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [orderSearch, ordersTab, orderFilterStatus, orderFilterDateFrom, orderFilterDateTo]);

  const openDetails = (order: any) => {
    // The web opens the replacement record when the row has one, and the order
    // detail otherwise.
    const record = order?.__replacementRecord;
    if (record?.id) {
      pushRoute({ name: "replacement-detail", replacementId: String(record.id) });
      return;
    }
    setSelectedOrderId(order.id);
    pushRoute({ name: "order-detail", orderId: order.id });
  };

  return (
    <View style={styles.listSection}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitleHeading}>Purchase Order</Text>
        <TabBar options={TAB_OPTIONS} value={ordersTab} onChange={setOrdersTab} />
        <View style={styles.listControlsRow}>
          <View style={styles.listSearchWrap}>
            <Search size={16} color={theme.colors.slate500} />
            <TextInput
              style={styles.listSearchInput}
              value={orderSearch}
              onChangeText={setOrderSearch}
              placeholder="Search orders..."
              placeholderTextColor={theme.colors.textFaint}
            />
          </View>
          <Pressable
            style={styles.listFilterButton}
            onPress={() => setFilterDialogVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Filter"
          >
            <Filter size={16} color={theme.colors.textBody} />
          </Pressable>
        </View>
      </View>

      {loading && orders.length === 0 ? (
        <CardsSkeleton cards={4} />
      ) : visibleOrders.length === 0 ? (
        <Text style={styles.listEmptyText}>
          {ordersTab === "REPLACEMENT" ? "No replacement requests found." : "No orders found."}
        </Text>
      ) : (
        <View style={styles.listBody}>
          {pagedOrders.map((o) => {
            const normalizedStatus = String(normalizeDeliveryStatus(String(o.status || ""), o.paymentStatus));
            const rawStatus = String(o.status || "").toUpperCase();
            const rawRequestStatus = String(o.requestStatus || "").toUpperCase();
            const isCancelled =
              ["CANCELLED", "CANCELED"].includes(rawStatus) || ["CANCELLED", "CANCELED"].includes(rawRequestStatus);
            const isRejected = rawStatus === "REJECTED" || rawRequestStatus === "REJECTED";
            const isFailed = isCancelled || isRejected;
            const cancellationReasonText = String(
              o.cancellationReason || (isFailed && typeof o.notes === "string" && o.notes.trim() ? o.notes : "") || ""
            ).trim();
            const dateTime = formatCardDateTime(
              normalizedStatus === "DELIVERED" ? o.deliveredAt || o.createdAt : o.createdAt
            );
            const isRescheduled = isRescheduledOrder(String(o.status || ""));
            const orderItems = Array.isArray(o.items) ? o.items : [];
            const isDelivered = normalizedStatus === "DELIVERED";
            const replacement = isReplacementOrder(o);
            const hasReplacementCase = replacements.some(
              (record) => record.orderId === o.id || record.orderNumber === o.orderNumber
            );
            const replacementRecord = (o as any).__replacementRecord || null;
            const replacementItems = replacementRecord ? getReplacementItemsForRecord(replacementRecord) : [];
            const replacementStatusLabel = replacementRecord
              ? getReplacementDisplayStatus(replacementRecord, o)
              : null;

            return (
              <View key={o.id} style={styles.listCard}>
                <View style={styles.listCardTitleRow}>
                  <View
                    style={[
                      styles.listCardDot,
                      { backgroundColor: isFailed ? theme.colors.rose : theme.colors.emeraldBright },
                    ]}
                  />
                  <Pressable onPress={() => openDetails(o)} accessibilityRole="button">
                    <Text style={styles.listCardNumber}>{o.orderNumber}</Text>
                  </Pressable>
                  {isCancelled ? (
                    <Badge label="Cancelled" tone="danger" />
                  ) : isRejected ? (
                    <Badge label="Rejected" tone="danger" />
                  ) : replacement ? (
                    <Badge label="Replacement" tone="replacement" />
                  ) : null}
                  {isRescheduled ? <Badge label="Rescheduled Order" tone="rescheduled" /> : null}
                </View>

                <View style={styles.listCardMetaRow}>
                  <CalendarDays size={16} color={theme.colors.textFaint} />
                  <Text style={[styles.listCardMeta, isFailed ? styles.listCardMetaFailed : null]}>
                    {replacementRecord
                      ? "Reported on "
                      : isCancelled
                        ? "Cancelled on "
                        : isRejected
                          ? "Rejected on "
                          : isDelivered
                            ? "Delivered on "
                            : ""}
                    {dateTime.date}
                    {dateTime.time ? ` · ${dateTime.time}` : ""}
                  </Text>
                </View>

                <View style={styles.listCardAddressRow}>
                  <MapPin size={16} color={theme.colors.slate500} />
                  <View style={styles.flex}>
                    <Text style={styles.listCardCustomer}>
                      {String((o as any).customerName || o.shippingName || "Customer")}
                    </Text>
                    <Text style={styles.listCardAddress} numberOfLines={2}>
                      {o.shippingAddress || "No address provided"}
                    </Text>
                  </View>
                </View>

                {isFailed ? (
                  <View style={styles.listCardReason}>
                    <Text style={styles.listCardReasonLabel}>
                      {isRejected ? "Reason for Rejection:" : "Reason for Cancellation:"}{" "}
                      <Text style={styles.listCardReasonText}>
                        {cancellationReasonText || (isRejected ? "Request was rejected." : "Order was cancelled.")}
                      </Text>
                    </Text>
                  </View>
                ) : null}

                {replacementRecord ? (
                  <>
                    <Text style={styles.listCardSectionLabel}>Replacement Items</Text>
                    {replacementItems.length > 0 ? (
                      replacementItems.map((item) => (
                        <View key={`${o.id}-replacement-${item.key}`} style={styles.listCardItemRow}>
                          <Image
                            source={{ uri: resolveImageUrl(item.imageUrl) }}
                            style={styles.listCardItemImage}
                            resizeMode="cover"
                          />
                          <View style={styles.flex}>
                            <Text style={styles.listCardItemName}>{item.name}</Text>
                            <Text style={styles.listCardItemQty}>{item.qtyLabel}</Text>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.listCardItemQty}>No replacement items</Text>
                    )}
                    {replacementStatusLabel ? (
                      <Badge
                        label={replacementStatusLabel}
                        tone={getReplacementStatusTone(replacementStatusLabel)}
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    <Text style={styles.listCardSectionLabel}>Order Items</Text>
                    {orderItems.length > 0 ? (
                      orderItems.map((item: any, index: number) => (
                        <View key={`${o.id}-item-${item?.id || index}`} style={styles.listCardItemRow}>
                          <Image
                            source={{ uri: resolveImageUrl(item?.product?.imageUrl) }}
                            style={styles.listCardItemImage}
                            resizeMode="cover"
                          />
                          <View style={styles.flex}>
                            <Text style={styles.listCardItemName}>{getOrderItemDisplayName(item)}</Text>
                            <Text style={styles.listCardItemQty}>{formatOrderedQuantityWithContainer(item)}</Text>
                            {item?.itemType === "MIXED_CASE" ? <MixedCaseComponents item={item} compact /> : null}
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.listCardItemQty}>No items</Text>
                    )}
                  </>
                )}
                {isDelivered && !replacement && !hasReplacementCase && ordersTab !== "TO_REVIEW" ? (
                  <Text style={styles.listCardItemQty}>No replacement case filed for this order.</Text>
                ) : null}

                <Text style={styles.listCardSectionLabel}>Total Amount</Text>
                <Text style={styles.listCardTotal}>{formatPeso(Number(o.totalAmount || 0))}</Text>
                {replacementRecord ? (
                  <Text style={styles.listCardStatusCaption}>{replacementStatusLabel || "Reported"}</Text>
                ) : null}

                <View style={styles.listCardActions}>
                  <Pressable
                    style={styles.listCardOutlineButton}
                    onPress={() => openDetails(o)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.listCardOutlineButtonText}>View Details</Text>
                    <ChevronRight size={14} color={theme.colors.textBody} />
                  </Pressable>

                  {isDelivered ? (
                    <Pressable
                      style={styles.listCardOutlineButton}
                      onPress={() => setReceiptOrder(o)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.listCardOutlineButtonText}>View Receipt</Text>
                    </Pressable>
                  ) : null}

                  {!isDelivered && isOrderTrackable(o) ? (
                    <Pressable
                      style={styles.listCardPrimaryButton}
                      onPress={() => {
                        setSelectedOrderId(o.id);
                        setActiveTab("track");
                      }}
                      accessibilityRole="button"
                    >
                      <Truck size={14} color={theme.colors.white} />
                      <Text style={styles.listCardPrimaryButtonText}>
                        {replacement ? "Track Replacement" : "Track Order"}
                      </Text>
                    </Pressable>
                  ) : null}

                  {isDelivered && !replacement ? (
                    <Pressable
                      style={styles.listCardPrimaryButton}
                      onPress={() => {
                        setDeliveryRatingValue(5);
                        setRatingDialogOrder(o);
                      }}
                      accessibilityRole="button"
                    >
                      <Star size={14} color={theme.colors.white} />
                      <Text style={styles.listCardPrimaryButtonText}>Rate Order</Text>
                    </Pressable>
                  ) : null}

                  {isDelivered && ordersTab !== "TO_REVIEW" ? (
                    <Pressable
                      style={styles.listCardOutlineButton}
                      onPress={() => handleBuyAgain(o)}
                      accessibilityRole="button"
                    >
                      <Truck size={14} color={theme.colors.emeraldDark} />
                      <Text style={styles.listCardOutlineButtonText}>Buy Again</Text>
                    </Pressable>
                  ) : null}

                  {!replacementRecord && isOrderCancellable(o) ? (
                    <Pressable
                      style={styles.listCardDangerButton}
                      onPress={() => setPendingCancellationOrder(o)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.listCardDangerButtonText}>Cancel Order</Text>
                    </Pressable>
                  ) : null}

                  {replacementRecord && replacementStatusLabel === "Pending" ? (
                    <Pressable
                      style={styles.listCardDangerButton}
                      onPress={() => setPendingCancelReplacement(replacementRecord)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.listCardDangerButtonText}>Cancel Replacement</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}

          <Pagination
            startIndex={startIndex}
            endIndex={endIndex}
            total={visibleOrders.length}
            currentPage={activePage}
            totalPages={totalPages}
            onChange={setCurrentPage}
          />
        </View>
      )}
    </View>
  );
}
