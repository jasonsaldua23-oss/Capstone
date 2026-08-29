// Mirrors
// src/components/portals/customer/sections/purchase-requests/purchase-request-detail-page.tsx.
import { CalendarDays, Clock3, MapPin, Package, Wallet } from "lucide-react-native";
import React from "react";
import { Image, Text, View } from "react-native";

import { Badge } from "../../components/ui/badge";
import { DetailHeader } from "../../components/ui/detail-header";
import { MixedCaseComponents } from "../../components/ui/mixed-case-components";
import { formatPeso } from "../../lib/customer-logic";
import { resolveImageUrl } from "../../lib/format";
import {
  formatDiscountLabel,
  getEffectiveDiscountPercent,
  formatCardDateTime,
  getPRStatusText,
  getRequestItemDisplayName,
  normalizePRStatus,
  type PRStatus,
} from "../../lib/shared";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

const TONE_BY_STATUS: Record<PRStatus, "success" | "danger" | "muted" | "warning"> = {
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "muted",
  PENDING_APPROVAL: "warning",
};

export function PurchaseRequestDetailScreen({ orderId }: { orderId: string }) {
  const { orders } = useCustomerPortal();

  const order = orders.find((row) => row.id === orderId) || null;
  if (!order) return null;

  const status = normalizePRStatus(order.requestStatus || (order as any).approvalStatus);
  const text = getPRStatusText(status);
  const rawId = String(order.purchaseRequestNumber || order.orderNumber || "").trim();
  const displayId = rawId.startsWith("PR-")
    ? rawId
    : rawId.startsWith("PO-")
      ? `PR-${rawId.slice(3)}`
      : rawId || "PR";
  const submittedDt = formatCardDateTime(order.createdAt);

  const items: any[] = Array.isArray(order.items) ? order.items : [];
  const orderSubtotal = Number(
    order.subtotal ??
      items.reduce(
        (sum, item) => sum + Number(item?.totalPrice ?? Number(item?.unitPrice || 0) * Number(item?.quantity || 0)),
        0
      )
  );
  const orderDeposit = items.reduce(
    (sum, item) => sum + Math.max(0, Number(item?.netDeposit ?? item?.depositTotal ?? item?.depositCharged ?? 0)),
    0
  );
  const orderTotal = Number(order.totalAmount || 0);
  const orderNotes = String(order.notes || "").trim();
  const orderDiscount = Number((order as any).discountDetails?.totalDiscount ?? order.discount ?? 0);
  const reasonText = String(
    (order as any).rejectionReason || order.cancellationReason || ""
  ).trim();

  return (
    <View style={styles.detailSection}>
      <DetailHeader title="Back to Purchase Requests" />

      <View style={styles.detailBody}>
        <View style={styles.detailTitleRow}>
          <View style={styles.detailTitleIcon}>
            <Package size={20} color="#d97706" />
          </View>
          <View style={styles.flex}>
            <View style={styles.detailBadgeRow}>
              <Text style={styles.detailOrderNumber}>{displayId}</Text>
              <Badge label={text.label} tone={TONE_BY_STATUS[status]} />
            </View>
            <View style={styles.listCardMetaRow}>
              <CalendarDays size={14} color={theme.colors.slate500} />
              <Text style={styles.listCardMeta}>
                Submitted on {submittedDt.date}
                {submittedDt.time ? ` · ${submittedDt.time}` : ""}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.detailStatusCallout}>
          <View style={styles.detailInfoHeadRow}>
            <Clock3 size={16} color="#b45309" />
            <Text style={styles.detailStatusCalloutTitle}>{text.label}</Text>
          </View>
          <Text style={styles.detailStatusCalloutText}>{text.message}</Text>
        </View>

        {status === "REJECTED" || status === "CANCELLED" ? (
          <View style={styles.detailFailureBanner}>
            <Text style={styles.detailFailureTitle}>
              {status === "REJECTED" ? "Rejection Reason" : "Cancellation Reason"}
            </Text>
            <Text style={styles.detailFailureText}>
              {reasonText ||
                (status === "REJECTED"
                  ? "Purchase request was rejected."
                  : "Purchase request was cancelled.")}
            </Text>
          </View>
        ) : null}

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
            <Text style={styles.detailInfoHeading}>Estimated Total</Text>
          </View>
          <Text style={styles.detailBigTotal}>{formatPeso(orderTotal)}</Text>
        </View>

        <View style={styles.detailTableCard}>
          <Text style={styles.detailTableCaption}>Requested Items ({items.length} items)</Text>
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
                  <Text style={styles.detailTableCell}>{getRequestItemDisplayName(item)}</Text>
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
          {orderDeposit > 0 ? (
            <View style={styles.detailSummaryRow}>
              <Text style={styles.checkoutSummaryLabel}>Returnable-container deposit</Text>
              <Text style={styles.checkoutSummaryValue}>+{formatPeso(orderDeposit)}</Text>
            </View>
          ) : null}
          {orderDiscount > 0 ? (
            <View style={styles.detailSummaryRow}>
              <Text style={styles.checkoutDiscountLine}>
                {formatDiscountLabel(
                  formatPeso(orderDiscount),
                  getEffectiveDiscountPercent(orderSubtotal, orderDiscount)
                )}
              </Text>
            </View>
          ) : null}
          <View style={styles.detailSummaryRow}>
            <Text style={styles.checkoutTotalLabel}>Estimated Total</Text>
            <Text style={styles.listCardTotal}>{formatPeso(orderTotal)}</Text>
          </View>
        </View>

        {orderNotes ? (
          <View style={styles.detailCard}>
            <Text style={styles.listCardSectionLabel}>Order Note</Text>
            <Text style={styles.listCardMeta}>{orderNotes}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
