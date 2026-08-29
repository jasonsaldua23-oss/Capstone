// Mirrors src/components/portals/customer/sections/checkout/checkout-view.tsx.
import { ArrowLeft } from "lucide-react-native";
import React from "react";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";

import { DateField } from "../../components/ui/date-field";
import { MixedCaseComponents } from "../../components/ui/mixed-case-components";
import { formatPeso, getAvailableQuantity, localDateInput } from "../../lib/customer-logic";
import { resolveImageUrl } from "../../lib/format";
import {
  formatDiscountLabel,
  getCheckoutQuantityLabel,
  getEffectiveDiscountPercent,
  getLineDepositAmounts,
  getMixedCaseDepositAmounts,
  isReturnableGlassItem,
} from "../../lib/shared";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export function CheckoutScreen() {
  const {
    user,
    profile,
    products,
    setActiveTab,
    openProfileModal,
    selectedUnifiedCartItems,
    selectedSubtotal,
    selectedDepositCharged,
    selectedDepositRefunded,
    totalDiscount,
    checkoutTotal,
    notes,
    setNotes,
    deliveryDate,
    setDeliveryDate,
    handlePlaceOrder,
    placingOrder,
    profileAddress,
  } = useCustomerPortal();

  // Screens only render inside the authenticated shell.
  if (!user) return null;

  const minDeliveryDate = localDateInput();
  const itemCount = selectedUnifiedCartItems.length;

  const insufficientStockItems = selectedUnifiedCartItems.filter((item) => {
    if (item.isMixedCase) return false;
    const product = products.find((entry) => entry.id === item.id);
    if (!product) return false;
    return item.quantity > getAvailableQuantity(product);
  });

  const canPlaceOrder = itemCount > 0 && insufficientStockItems.length === 0 && deliveryDate >= minDeliveryDate;

  return (
    <View style={styles.checkoutSection}>
      <View style={styles.checkoutHeader}>
        <Pressable
          style={styles.checkoutBackButton}
          onPress={() => setActiveTab("cart")}
          accessibilityRole="button"
          accessibilityLabel="Back to cart"
        >
          <ArrowLeft size={16} color={theme.colors.textBody} />
        </Pressable>
        <Text style={styles.checkoutTitle}>Checkout</Text>
      </View>

      {itemCount === 0 ? (
        <Text style={styles.checkoutEmptyText}>
          No selected items. Go back to cart and select item(s) to checkout.
        </Text>
      ) : (
        <View style={styles.checkoutBody}>
          <View style={styles.checkoutCard}>
            <View style={styles.checkoutRecipientRow}>
              <Text style={styles.checkoutRecipientName}>
                {profile?.name || user.name || "No recipient name set"}
              </Text>
              <Pressable onPress={() => openProfileModal("address")} accessibilityRole="button">
                <Text style={styles.checkoutEditLink}>Edit</Text>
              </Pressable>
            </View>
            <Text style={styles.checkoutRecipientMeta}>{profile?.phone || "No phone number set"}</Text>
            <Text style={styles.checkoutRecipientAddress}>{profileAddress || "No delivery address set yet"}</Text>
          </View>

          <View style={styles.checkoutCard}>
            {selectedUnifiedCartItems.map((item) => {
              const componentImages = item.isMixedCase ? (item.components || []).slice(0, 2) : [];
              return (
                <View key={item.id} style={styles.checkoutItemRow}>
                  {item.isMixedCase ? (
                    <View style={styles.checkoutItemThumbGrid}>
                      {componentImages.map((component: any) => (
                        <Image
                          key={component.productId}
                          source={{ uri: resolveImageUrl(component.product?.imageUrl) }}
                          style={styles.checkoutItemThumbGridImage}
                          resizeMode="cover"
                        />
                      ))}
                    </View>
                  ) : (
                    <Image
                      source={{ uri: resolveImageUrl(item.imageUrl) }}
                      style={styles.checkoutItemThumb}
                      resizeMode="cover"
                    />
                  )}

                  <View style={styles.flex}>
                    <View style={styles.checkoutItemTitleRow}>
                      <Text style={styles.checkoutItemName} numberOfLines={1}>
                        {item.isMixedCase ? "Mixed Case" : `${item.name} ${item.sizeLabel}`}
                      </Text>
                      <Text style={styles.checkoutItemTotal}>{formatPeso(item.quantity * item.unitPrice)}</Text>
                    </View>
                    <View style={styles.checkoutItemMetaRow}>
                      <Text style={styles.checkoutItemCategory}>{item.category || "Beverage"}</Text>
                      <Text style={styles.checkoutItemQty}>
                        {getCheckoutQuantityLabel({
                          quantity: item.quantity,
                          unit: item.unitLabel,
                          itemType: item.isMixedCase ? "MIXED_CASE" : "STANDARD_CASE",
                        })}{" "}
                        × {formatPeso(item.unitPrice)}
                      </Text>
                    </View>

                    {(() => {
                      if (item.isMixedCase) {
                        const deposit = getMixedCaseDepositAmounts(item.source);
                        const netDeposit = Math.max(0, deposit.charged - deposit.refunded);
                        if (deposit.charged <= 0) return null;
                        return (
                          <View style={styles.checkoutDepositBox}>
                            {deposit.refunded > 0 ? (
                              <Text style={styles.checkoutDepositCredit}>
                                Empty-container credit applied: {formatPeso(deposit.refunded)}
                              </Text>
                            ) : null}
                            <Text style={styles.checkoutDepositNew}>
                              New deposit charged: +{formatPeso(netDeposit)}
                            </Text>
                          </View>
                        );
                      }
                      if (!isReturnableGlassItem(item.source)) return null;
                      const isCase = item.unitLabel === "case";
                      const containersPerCase = Math.max(1, Number(item.source?.containersPerCase || 1));
                      const { charged, refunded } = getLineDepositAmounts(item.source);
                      const newDeposit = Math.max(0, charged - refunded);
                      const availableEmptyQuantity = isCase
                        ? Math.floor(Number(item.availableEmptyBottles || 0) / containersPerCase)
                        : Number(item.availableEmptyBottles || 0);
                      const appliedEmptyQuantity = isCase
                        ? Math.floor(Number(item.emptyReturnedQuantity || 0) / containersPerCase)
                        : Number(item.emptyReturnedQuantity || 0);
                      const emptyUnitLabel = isCase ? "case" : "loose bottle";
                      return (
                        <View style={styles.checkoutDepositBox}>
                          <Text style={styles.checkoutDepositHeading}>
                            {item.source?.containerTypeName || "Glass Bottle"} — Empty Containers:{" "}
                            {availableEmptyQuantity} {emptyUnitLabel}
                            {availableEmptyQuantity !== 1 ? "s" : ""} — Deposit Balance:{" "}
                            {formatPeso(Number(item.availableDepositBalance || 0))}
                          </Text>
                          <Text
                            style={
                              Number(item.emptyReturnedQuantity || 0) > 0
                                ? styles.checkoutDepositCredit
                                : styles.checkoutDepositPending
                            }
                          >
                            {Number(item.emptyReturnedQuantity || 0) > 0
                              ? `${appliedEmptyQuantity} existing ${emptyUnitLabel}${appliedEmptyQuantity !== 1 ? "s" : ""} will be used.`
                              : "No existing empties are available."}
                          </Text>
                          {newDeposit > 0 ? (
                            <Text style={styles.checkoutDepositNew}>
                              New deposit charged: +{formatPeso(newDeposit)}
                            </Text>
                          ) : null}
                        </View>
                      );
                    })()}

                    {item.isMixedCase ? (
                      <View style={styles.checkoutMixedBox}>
                        <Text style={styles.checkoutMixedQuantity}>
                          Quantity: {Math.max(1, Number(item.quantity || 1))} case{Number(item.quantity || 1) === 1 ? "" : "s"}
                        </Text>
                        <MixedCaseComponents item={{ components: item.components }} compact />
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.checkoutSummaryCard}>
            <View style={styles.checkoutSummaryRow}>
              <Text style={styles.checkoutSummaryLabel}>Subtotal</Text>
              <Text style={styles.checkoutSummaryValue}>{formatPeso(selectedSubtotal)}</Text>
            </View>
            {selectedDepositRefunded > 0 ? (
              <View style={styles.checkoutSummaryRow}>
                <Text style={styles.checkoutSummaryLabel}>Existing empty deposits applied</Text>
                <Text style={styles.checkoutSummaryCredit}>- Covers {formatPeso(selectedDepositRefunded)}</Text>
              </View>
            ) : null}
            {selectedDepositCharged - selectedDepositRefunded > 0 ? (
              <View style={styles.checkoutSummaryRow}>
                <Text style={styles.checkoutSummaryLabel}>New returnable-container deposit</Text>
                <Text style={styles.checkoutSummaryValue}>
                  +{formatPeso(selectedDepositCharged - selectedDepositRefunded)}
                </Text>
              </View>
            ) : null}
            {/* The web renders this as one line via CompactDiscountLine, not a two-sided row. */}
            <Text style={styles.checkoutDiscountLine}>
              {formatDiscountLabel(
                formatPeso(totalDiscount),
                getEffectiveDiscountPercent(selectedSubtotal, totalDiscount)
              )}
            </Text>
            <Text style={styles.checkoutDiscountHint}>Discounts apply to orders totaling 50 cases or packs.</Text>
            <View style={styles.checkoutDivider} />
            <View style={styles.checkoutSummaryRow}>
              <Text style={styles.checkoutTotalLabel}>
                Total ({itemCount} item{itemCount > 1 ? "s" : ""})
              </Text>
              <Text style={styles.checkoutTotalValue}>{formatPeso(checkoutTotal)}</Text>
            </View>
          </View>

          <View style={styles.checkoutSummaryCard}>
            <Text style={styles.checkoutFieldLabel}>Order note (optional)</Text>
            <TextInput
              style={styles.checkoutTextarea}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add note for delivery"
              placeholderTextColor={theme.colors.textFaint}
              multiline
            />
            <Text style={styles.checkoutFieldLabel}>Delivery date</Text>
            <DateField
              value={deliveryDate}
              minimumDate={new Date()}
              onChange={setDeliveryDate}
              accessibilityLabel="Delivery date"
            />
          </View>
        </View>
      )}

    </View>
  );
}


// Rendered by the shell outside the shared ScrollView so it stays pinned.
export function CheckoutActionBar() {
  const {
    products,
    setActiveTab,
    selectedUnifiedCartItems,
    checkoutTotal,
    handlePlaceOrder,
    placingOrder,
    deliveryDate,
  } = useCustomerPortal();

  const itemCount = selectedUnifiedCartItems.length;
  if (itemCount === 0) return null;

  const minDeliveryDate = localDateInput();
  const insufficientStockItems = selectedUnifiedCartItems.filter((item) => {
    if (item.isMixedCase) return false;
    const product = products.find((entry) => entry.id === item.id);
    if (!product) return false;
    return item.quantity > getAvailableQuantity(product);
  });
  const canPlaceOrder = itemCount > 0 && insufficientStockItems.length === 0 && deliveryDate >= minDeliveryDate;

  return (
    <View style={styles.checkoutActionBar}>
      {insufficientStockItems.length > 0 ? (
        <View style={styles.checkoutStockWarning}>
          <Text style={styles.checkoutStockWarningText}>
            {insufficientStockItems.length === 1
              ? `${insufficientStockItems[0]?.name || "One item"} no longer has enough stock.`
              : `${insufficientStockItems.length} items no longer have enough stock.`}{" "}
            <Text style={styles.checkoutStockWarningLink} onPress={() => setActiveTab("cart")}>
              Review your cart
            </Text>{" "}
            to continue.
          </Text>
        </View>
      ) : null}
      <View style={styles.checkoutActionRow}>
        <View style={styles.flex}>
          <Text style={styles.checkoutActionLabel}>
            Total ({itemCount} item{itemCount > 1 ? "s" : ""})
          </Text>
          <Text style={styles.checkoutActionTotal}>{formatPeso(checkoutTotal)}</Text>
        </View>
        <Pressable
          style={[styles.checkoutPlaceButton, placingOrder || !canPlaceOrder ? styles.disabledButton : null]}
          onPress={handlePlaceOrder}
          disabled={placingOrder || !canPlaceOrder}
          accessibilityRole="button"
        >
          {placingOrder ? <ActivityIndicator size="small" color={theme.colors.white} /> : null}
          <Text style={styles.checkoutPlaceButtonText}>Place order</Text>
        </Pressable>
      </View>
    </View>
  );
}
