// Mirrors src/components/portals/customer/sections/purchase-requests/purchase-request-view.tsx.
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  MapPin,
  Package2,
  Search,
  Truck,
  XCircle,
} from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";

import { Badge } from "../../components/ui/badge";
import { MixedCaseComponents } from "../../components/ui/mixed-case-components";
import { Pagination } from "../../components/ui/pagination";
import { CardsSkeleton } from "../../components/ui/skeleton";
import { TabBar, type TabOption } from "../../components/ui/tab-bar";
import { formatPeso } from "../../lib/customer-logic";
import { resolveImageUrl } from "../../lib/format";
import {
  formatCardDateTime,
  formatOrderedQuantityWithContainer,
  getPRStatusText,
  getRequestItemDisplayName,
  normalizePRStatus,
  type PRStatus,
} from "../../lib/shared";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

const PAGE_SIZE = 10;

const TAB_OPTIONS: Array<TabOption<"ALL" | PRStatus>> = [
  { id: "ALL", label: "All", Icon: Package2 },
  { id: "PENDING_APPROVAL", label: "Pending Review", Icon: Clock3 },
  { id: "APPROVED", label: "Approved", Icon: CheckCircle2 },
  { id: "REJECTED", label: "Rejected", Icon: XCircle },
  { id: "CANCELLED", label: "Cancelled", Icon: CircleAlert },
];

const TONE_BY_STATUS: Record<PRStatus, "success" | "danger" | "muted" | "warning"> = {
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "muted",
  PENDING_APPROVAL: "warning",
};

const DOT_BY_STATUS: Record<PRStatus, string> = {
  APPROVED: theme.colors.emeraldBright,
  REJECTED: "#ef4444",
  CANCELLED: theme.colors.rose,
  PENDING_APPROVAL: "#fbbf24",
};

export function PurchaseRequestsScreen() {
  const { orders, loading, setPendingCancellationOrder, setSelectedOrderId, pushRoute, resetToTab } =
    useCustomerPortal();

  const [search, setSearch] = useState("");
  const [prTab, setPrTab] = useState<"ALL" | PRStatus>("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  const nonReplacementOrders = useMemo(
    () =>
      orders.filter(
        (o) => !String(o?.orderNumber || "").trim().toUpperCase().startsWith("RPL-") && !(o as any)?.isScheduledReplacement
      ),
    [orders]
  );

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return nonReplacementOrders.filter((order) => {
      const status = normalizePRStatus(order?.requestStatus || (order as any)?.approvalStatus);
      if (prTab !== "ALL" && status !== prTab) return false;
      if (!query) return true;
      const prNum = String(order?.purchaseRequestNumber || order?.orderNumber || "").toLowerCase();
      const address = String(order?.shippingAddress || "").toLowerCase();
      const customerName = String((order as any)?.customerName || order?.shippingName || "").toLowerCase();
      const itemNames = (order?.items || []).map((i: any) => getRequestItemDisplayName(i).toLowerCase()).join(" ");
      const statusLabel = getPRStatusText(status).label.toLowerCase();
      return (
        prNum.includes(query) ||
        address.includes(query) ||
        customerName.includes(query) ||
        itemNames.includes(query) ||
        statusLabel.includes(query)
      );
    });
  }, [nonReplacementOrders, prTab, search]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const activePage = Math.min(currentPage, totalPages);
  const pagedOrders = filteredOrders.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);
  const startIndex = filteredOrders.length === 0 ? 0 : (activePage - 1) * PAGE_SIZE + 1;
  const endIndex = Math.min(activePage * PAGE_SIZE, filteredOrders.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, prTab]);

  const openDetails = (orderId: string) => {
    setSelectedOrderId(orderId);
    pushRoute({ name: "purchase-request-detail", orderId });
  };

  return (
    <View style={styles.listSection}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitleHeading}>Purchase Request</Text>
        <TabBar options={TAB_OPTIONS} value={prTab} onChange={setPrTab} />
        <View style={styles.listSearchWrap}>
          <Search size={16} color={theme.colors.slate500} />
          <TextInput
            style={styles.listSearchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search purchase requests..."
            placeholderTextColor={theme.colors.textFaint}
          />
        </View>
      </View>

      {loading && orders.length === 0 ? (
        <CardsSkeleton cards={4} />
      ) : filteredOrders.length === 0 ? (
        <View style={styles.listEmptyWrap}>
          <Clock3 size={32} color={theme.colors.textFaint} />
          <Text style={styles.listEmptyTitle}>No purchase requests found</Text>
          <Text style={styles.listEmptyHint}>
            {search
              ? "No purchase requests match your search."
              : prTab !== "ALL"
                ? `You have no ${TAB_OPTIONS.find((t) => t.id === prTab)?.label.toLowerCase()} purchase requests.`
                : "Your submitted purchase requests will appear here."}
          </Text>
        </View>
      ) : (
        <View style={styles.listBody}>
          {pagedOrders.map((o) => {
            const status = normalizePRStatus(o.requestStatus || (o as any).approvalStatus);
            const text = getPRStatusText(status);
            const rawId = String(o.purchaseRequestNumber || o.orderNumber || "").trim();
            const displayId = rawId.startsWith("PR-")
              ? rawId
              : rawId.startsWith("PO-")
                ? `PR-${rawId.slice(3)}`
                : rawId || "PR";
            const submittedDt = formatCardDateTime(o.createdAt);
            const scheduledDt = formatCardDateTime(o.deliveryDate);
            const orderItems = Array.isArray(o.items) ? o.items : [];
            const depositTotal = orderItems.reduce(
              (sum: number, item: any) =>
                sum + Math.max(0, Number(item?.netDeposit ?? item?.depositTotal ?? item?.depositCharged ?? 0)),
              0
            );
            const cancellable = status === "PENDING_APPROVAL" || String(o.status || "").toUpperCase() === "PENDING";
            const reasonText =
              (o as any).rejectionReason ||
              o.cancellationReason ||
              o.notes ||
              (status === "REJECTED" ? "Purchase request was rejected." : "Purchase request was cancelled.");

            return (
              <View key={o.id} style={styles.listCard}>
                <View style={styles.listCardTitleRow}>
                  <View style={[styles.listCardDot, { backgroundColor: DOT_BY_STATUS[status] }]} />
                  <Pressable onPress={() => openDetails(o.id)} accessibilityRole="button">
                    <Text style={styles.listCardNumber}>{displayId}</Text>
                  </Pressable>
                  <Badge label={text.label} tone={TONE_BY_STATUS[status]} />
                </View>

                <View style={styles.listCardMetaRow}>
                  <CalendarDays size={16} color={theme.colors.textFaint} />
                  <Text style={styles.listCardMeta}>
                    Submitted on {submittedDt.date}
                    {submittedDt.time ? ` · ${submittedDt.time}` : ""}
                  </Text>
                </View>

                <View style={styles.listCardMetaRow}>
                  <Truck size={16} color={theme.colors.emerald} />
                  <Text style={styles.listCardMeta}>
                    Scheduled delivery:{" "}
                    <Text style={styles.listCardMetaStrong}>
                      {scheduledDt.date === "N/A" ? "Not scheduled" : scheduledDt.date}
                    </Text>
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

                {status === "REJECTED" || status === "CANCELLED" ? (
                  <View style={styles.listCardReason}>
                    <Text style={styles.listCardReasonLabel}>
                      {status === "REJECTED" ? "Reason for Rejection:" : "Reason for Cancellation:"}{" "}
                      <Text style={styles.listCardReasonText}>{reasonText}</Text>
                    </Text>
                  </View>
                ) : null}

                <Text style={styles.listCardSectionLabel}>Requested Items</Text>
                {orderItems.length > 0 ? (
                  orderItems.map((item: any, idx: number) => (
                    <View key={`${o.id}-item-${item?.id || idx}`} style={styles.listCardItemRow}>
                      <Image
                        source={{ uri: resolveImageUrl(item?.product?.imageUrl) }}
                        style={styles.listCardItemImage}
                        resizeMode="cover"
                      />
                      <View style={styles.flex}>
                        <Text style={styles.listCardItemName} numberOfLines={1}>
                          {getRequestItemDisplayName(item)}
                        </Text>
                        <Text style={styles.listCardItemQty}>{formatOrderedQuantityWithContainer(item)}</Text>
                        {item?.itemType === "MIXED_CASE" ? <MixedCaseComponents item={item} compact /> : null}
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.listCardItemQty}>No items</Text>
                )}

                {depositTotal > 0 ? (
                  <View style={styles.listCardDepositRow}>
                    <Text style={styles.listCardMeta}>Container deposit</Text>
                    <Text style={styles.listCardMetaStrong}>+{formatPeso(depositTotal)}</Text>
                  </View>
                ) : null}
                <Text style={styles.listCardSectionLabel}>Estimated Total</Text>
                <Text style={styles.listCardTotal}>{formatPeso(Number(o.totalAmount || 0))}</Text>
                <Text style={styles.listCardStatusCaption}>{text.label}</Text>

                <View style={styles.listCardActions}>
                  <Pressable
                    style={styles.listCardOutlineButton}
                    onPress={() => openDetails(o.id)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.listCardOutlineButtonText}>View Details</Text>
                    <ChevronRight size={14} color={theme.colors.textBody} />
                  </Pressable>
                  {cancellable ? (
                    <Pressable
                      style={styles.listCardDangerButton}
                      onPress={() => setPendingCancellationOrder(o)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.listCardDangerButtonText}>Cancel Request</Text>
                    </Pressable>
                  ) : null}

                  {status === "APPROVED" ? (
                    <Pressable
                      style={styles.listCardApprovedButton}
                      onPress={() => {
                        setSelectedOrderId(o.id);
                        resetToTab("orders");
                      }}
                      accessibilityRole="button"
                    >
                      <Text style={styles.listCardApprovedButtonText}>View Purchase Order →</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}

          <Pagination
            startIndex={startIndex}
            endIndex={endIndex}
            total={filteredOrders.length}
            currentPage={activePage}
            totalPages={totalPages}
            onChange={setCurrentPage}
            noun="requests"
          />
        </View>
      )}
    </View>
  );
}
