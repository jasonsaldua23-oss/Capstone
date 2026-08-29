// Mirrors src/components/portals/customer/sections/orders/receipt-dialog.tsx.
// The PDF export keeps using expo-print, which the web's html-to-image path has
// no native equivalent for.
import { CalendarDays, ClipboardList, MapPin, Package, Phone, Store, User } from "lucide-react-native";
import React from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";

import { formatPeso } from "../../lib/customer-logic";
import { formatDate, resolveImageUrl } from "../../lib/format";
import { getOrderItemDisplayName } from "../../lib/shared";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

const RECEIPT_BUSINESS_NAME = "Ann Ann's Beverages Trading";

export function ReceiptDialog() {
  const { receiptOrder, setReceiptOrder, handleShareReceipt, sharingReceipt } = useCustomerPortal();

  if (!receiptOrder) return null;

  const items: any[] = Array.isArray(receiptOrder.items) ? receiptOrder.items : [];
  const orderSubtotal = Number(
    receiptOrder.subtotal ??
      items.reduce(
        (sum, item) => sum + Number(item?.totalPrice ?? Number(item?.unitPrice || 0) * Number(item?.quantity || 0)),
        0
      )
  );
  const deliveryLines = [
    receiptOrder.shippingAddress,
    receiptOrder.shippingCity,
    receiptOrder.shippingProvince,
    receiptOrder.shippingZipCode,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setReceiptOrder(null)}>
      <View style={styles.receiptOverlay}>
        <View style={styles.receiptPanel}>
          <Text style={styles.receiptDialogTitle}>Receipt Preview</Text>
          <ScrollView>
            <View style={styles.receiptSheet}>
              <View style={styles.receiptHeaderRow}>
                <Image
                  source={require("../../../../../public/aab-trading-shop.png")}
                  style={styles.receiptLogo}
                  resizeMode="cover"
                />
                <View style={styles.flex}>
                  <Text style={styles.receiptBusiness}>{RECEIPT_BUSINESS_NAME}</Text>
                  <Text style={styles.receiptSubtle}>Official Delivery Receipt</Text>
                </View>
                <View>
                  <Text style={styles.receiptKicker}>ORDER RECEIPT</Text>
                  <View style={styles.receiptKickerRule} />
                </View>
              </View>

              <View style={styles.receiptNumbersRow}>
                <View style={styles.receiptNumberCell}>
                  <ClipboardList size={18} color="#0f2347" />
                  <Text style={styles.receiptNumberText}>
                    Receipt No. <Text style={styles.receiptNumberStrong}>RCT-{receiptOrder.orderNumber}</Text>
                  </Text>
                </View>
                <View style={styles.receiptNumberCell}>
                  <Package size={18} color="#0f2347" />
                  <Text style={styles.receiptNumberText}>
                    Order No. <Text style={styles.receiptNumberStrong}>{receiptOrder.orderNumber}</Text>
                  </Text>
                </View>
              </View>

              <View style={styles.receiptMetaBlock}>
                <View style={styles.receiptMetaItem}>
                  <View style={styles.receiptMetaHead}>
                    <MapPin size={16} color="#0f2347" />
                    <Text style={styles.receiptMetaLabel}>DELIVERY ADDRESS</Text>
                  </View>
                  <Text style={styles.receiptMetaValue}>{deliveryLines.join(", ") || "-"}</Text>
                </View>
                <View style={styles.receiptMetaItem}>
                  <View style={styles.receiptMetaHead}>
                    <Store size={16} color="#0f2347" />
                    <Text style={styles.receiptMetaLabel}>SOLD BY</Text>
                  </View>
                  <Text style={styles.receiptMetaValue}>{RECEIPT_BUSINESS_NAME}</Text>
                </View>
                <View style={styles.receiptMetaItem}>
                  <View style={styles.receiptMetaHead}>
                    <CalendarDays size={16} color="#0f2347" />
                    <Text style={styles.receiptMetaLabel}>ORDER DETAILS</Text>
                  </View>
                  <Text style={styles.receiptMetaValue}>Ordered: {formatDate(receiptOrder.createdAt)}</Text>
                  <Text style={styles.receiptMetaValue}>
                    Delivered: {receiptOrder.deliveredAt ? formatDate(receiptOrder.deliveredAt) : "-"}
                  </Text>
                </View>
                <View style={styles.receiptMetaSplit}>
                  <View style={styles.flex}>
                    <View style={styles.receiptMetaHead}>
                      <User size={16} color="#0f2347" />
                      <Text style={styles.receiptMetaLabel}>RECIPIENT</Text>
                    </View>
                    <Text style={styles.receiptMetaValue}>{receiptOrder.shippingName || "-"}</Text>
                  </View>
                  <View style={styles.flex}>
                    <View style={styles.receiptMetaHead}>
                      <Phone size={16} color="#0f2347" />
                      <Text style={styles.receiptMetaLabel}>PHONE</Text>
                    </View>
                    <Text style={styles.receiptMetaValue}>{receiptOrder.shippingPhone || "-"}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.receiptTableHead}>
                <Text style={[styles.receiptTableHeadText, styles.receiptColProduct]}>Product</Text>
                <Text style={[styles.receiptTableHeadText, styles.receiptColQty]}>Qty</Text>
                <Text style={[styles.receiptTableHeadText, styles.receiptColPrice]}>Unit Price</Text>
                <Text style={[styles.receiptTableHeadText, styles.receiptColAmount]}>Amount</Text>
              </View>
              {items.map((item, index) => (
                <View key={item?.id || index} style={styles.receiptTableRow}>
                  <Text style={[styles.receiptCell, styles.receiptColProduct]}>{getOrderItemDisplayName(item)}</Text>
                  <Text style={[styles.receiptCell, styles.receiptColQty]}>{item?.quantity ?? 0}</Text>
                  <Text style={[styles.receiptCell, styles.receiptColPrice]}>
                    {formatPeso(Number(item?.unitPrice || 0))}
                  </Text>
                  <Text style={[styles.receiptCellStrong, styles.receiptColAmount]}>
                    {formatPeso(Number(item?.totalPrice ?? Number(item?.unitPrice || 0) * Number(item?.quantity || 0)))}
                  </Text>
                </View>
              ))}

              <View style={styles.receiptSummaryRow}>
                <Text style={styles.receiptSummaryLabel}>Subtotal</Text>
                <Text style={styles.receiptSummaryLabel}>{formatPeso(orderSubtotal)}</Text>
              </View>
              <View style={styles.receiptTotalRow}>
                <Text style={styles.receiptTotalLabel}>TOTAL PRICE</Text>
                <Text style={styles.receiptTotalValue}>{formatPeso(Number(receiptOrder.totalAmount || 0))}</Text>
              </View>

              <Text style={styles.receiptFooterText}>This receipt serves as proof of payment and delivery.</Text>
              <Text style={styles.receiptFooterText}>Thank you for your purchase.</Text>
            </View>
          </ScrollView>

          <View style={styles.modalActions}>
            <Pressable style={styles.modalGhostButton} onPress={() => setReceiptOrder(null)} accessibilityRole="button">
              <Text style={styles.modalGhostButtonText}>Close</Text>
            </Pressable>
            <Pressable
              style={styles.primaryButtonCompact}
              onPress={() => void handleShareReceipt(receiptOrder)}
              disabled={sharingReceipt}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>{sharingReceipt ? "Preparing PDF..." : "Download Receipt"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
