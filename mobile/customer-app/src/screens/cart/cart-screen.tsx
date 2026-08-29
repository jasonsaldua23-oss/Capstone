// Mirrors src/components/portals/customer/sections/cart/cart-view.tsx.
import { ArrowLeft, CheckCircle, MapPin, Minus, Pencil, Plus, Recycle, Trash2 } from "lucide-react-native";
import React from "react";
import { Image, Pressable, Text, View } from "react-native";

import { MixedCaseComponents } from "../../components/ui/mixed-case-components";
import { formatPeso, getAvailableQuantity } from "../../lib/customer-logic";
import { resolveImageUrl } from "../../lib/format";
import { getLineDepositAmounts, getMixedCaseDepositAmounts, isReturnableGlassItem } from "../../lib/shared";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

export function CartScreen() {
  const {
    setActiveTab,
    openProfileModal,
    profile,
    unifiedCartItems,
    selectedCartIds,
    setSelectedCartIds,
    toggleCartSelection,
    updateCart,
    removeMixedCartItem,
    openMixedCaseBuilder,
    selectedSubtotal,
    products,
  } = useCustomerPortal();

  const formattedAddress =
    [profile?.address, profile?.city, profile?.province].filter(Boolean).join(", ") || "Select delivery address";

  const allCartSelected = unifiedCartItems.length > 0 && unifiedCartItems.every((item) => selectedCartIds.has(item.id));
  const selectedCount = unifiedCartItems.filter((item) => selectedCartIds.has(item.id)).length;

  const removeItem = (item: (typeof unifiedCartItems)[number]) => {
    if (item.isMixedCase) removeMixedCartItem(item.id);
    else updateCart(item.id, 0);
  };

  const removeSelected = () => {
    for (const item of unifiedCartItems) {
      if (selectedCartIds.has(item.id)) removeItem(item);
    }
  };

  return (
    <View style={styles.cartSection}>
      <View style={styles.cartHeader}>
        <View style={styles.cartHeaderRow}>
          <View style={styles.cartHeaderTitleRow}>
            <Pressable
              style={styles.cartBackButton}
              onPress={() => setActiveTab("home")}
              accessibilityRole="button"
              accessibilityLabel="Back to catalog"
            >
              <ArrowLeft size={16} color={theme.colors.textBody} />
            </Pressable>
            <Text style={styles.cartTitle}>
              Shopping Cart <Text style={styles.cartTitleCount}>({unifiedCartItems.length})</Text>
            </Text>
          </View>
          <Pressable
            style={styles.cartEditAddressButton}
            onPress={() => openProfileModal("address")}
            accessibilityRole="button"
            accessibilityLabel="Edit delivery address"
          >
            <Pencil size={14} color={theme.colors.slate500} />
            <Text style={styles.cartEditAddressText}>Edit Address</Text>
          </Pressable>
        </View>

        <View style={styles.cartDeliverToBar}>
          <MapPin size={14} color={theme.colors.emerald} />
          <Text style={styles.cartDeliverToText} numberOfLines={1}>
            <Text style={styles.cartDeliverToLabel}>Deliver to: </Text>
            {formattedAddress}
          </Text>
        </View>
      </View>

      <View style={styles.cartList}>
        {unifiedCartItems.map((item) => {
          const selected = selectedCartIds.has(item.id);
          const product = item.isMixedCase ? null : products.find((entry) => entry.id === item.id) || null;
          const available = product ? getAvailableQuantity(product) : null;
          const componentImages = item.isMixedCase ? (item.components || []).slice(0, 2) : [];

          return (
            <View key={item.id} style={styles.cartCard}>
              <View style={styles.cartCardRow}>
                <Pressable
                  style={[styles.cartCheckbox, selected ? styles.cartCheckboxChecked : null]}
                  onPress={() => toggleCartSelection(item.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`Select ${item.name}`}
                >
                  {selected ? <CheckCircle size={14} color={theme.colors.white} /> : null}
                </Pressable>

                <View style={styles.cartThumb}>
                  {item.isMixedCase ? (
                    <View style={styles.cartThumbGrid}>
                      {componentImages.map((component: any) => (
                        <Image
                          key={component.productId}
                          source={{ uri: resolveImageUrl(component.product?.imageUrl) }}
                          style={styles.cartThumbGridImage}
                          resizeMode="contain"
                        />
                      ))}
                    </View>
                  ) : (
                    <Image
                      source={{ uri: resolveImageUrl(item.imageUrl) }}
                      style={styles.cartThumbImage}
                      resizeMode="contain"
                    />
                  )}
                </View>

                <View style={styles.cartInfo}>
                  <Text style={styles.cartItemName} numberOfLines={1}>
                    {item.name}
                  </Text>

                  {!item.isMixedCase ? (
                    <Text style={styles.cartItemMeta} numberOfLines={1}>
                      {item.category ? `${item.category} · ` : ""}
                      {item.sizeLabel}
                    </Text>
                  ) : null}
                  {item.isMixedCase ? <MixedCaseComponents item={{ components: item.components }} compact /> : null}

                  <View style={styles.cartPriceRow}>
                    <Text style={styles.cartUnitPrice}>{formatPeso(item.unitPrice)}</Text>
                    <View style={styles.cartPriceActions}>
                      <View style={styles.cartStepper}>
                        <Pressable
                          style={styles.cartStepperButton}
                          onPress={() =>
                            item.isMixedCase
                              ? item.quantity <= 1
                                ? removeMixedCartItem(item.id)
                                : openMixedCaseBuilder(item.source)
                              : updateCart(item.id, item.quantity - 1)
                          }
                          accessibilityRole="button"
                          accessibilityLabel="Decrease quantity"
                        >
                          <Minus size={12} color={theme.colors.textSubtle} />
                        </Pressable>
                        <Text style={styles.cartStepperValue}>{item.quantity}</Text>
                        <Pressable
                          style={styles.cartStepperButton}
                          onPress={() =>
                            item.isMixedCase
                              ? openMixedCaseBuilder(item.source)
                              : updateCart(item.id, item.quantity + 1)
                          }
                          accessibilityRole="button"
                          accessibilityLabel="Increase quantity"
                        >
                          <Plus size={12} color={theme.colors.textSubtle} />
                        </Pressable>
                      </View>
                      <Pressable
                        style={styles.cartRemoveButton}
                        onPress={() => removeItem(item)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.name} from cart`}
                      >
                        <Trash2 size={14} color={theme.colors.textFaint} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              </View>

              {/* Stock shortfall is named on the line so the customer can fix it here. */}
              {available !== null && !(available > 0 && item.quantity <= available) ? (
                <View style={styles.cartShortfall}>
                  <Text style={styles.cartShortfallText}>
                    {available <= 0
                      ? "Out of stock — remove this item to check out."
                      : `Only ${available} ${item.unitLabel}${available !== 1 ? "s" : ""} available.`}
                  </Text>
                  <Pressable
                    style={styles.cartShortfallButton}
                    onPress={() => (available > 0 ? updateCart(item.id, available) : removeItem(item))}
                  >
                    <Text style={styles.cartShortfallButtonText}>{available > 0 ? `Use ${available}` : "Remove"}</Text>
                  </Pressable>
                </View>
              ) : null}

              {/* Returnable deposit summary, glass bottles only. */}
              {(() => {
                if (item.isMixedCase) {
                  const deposit = getMixedCaseDepositAmounts(item.source);
                  if (deposit.charged <= 0) return null;
                  return (
                    <View style={styles.cartDepositBox}>
                      <View style={styles.cartDepositRow}>
                        <View style={styles.cartDepositLabelRow}>
                          <Recycle size={14} color={theme.colors.emerald} />
                          <Text style={styles.cartDepositLabel}>Mixed-case bottle deposit</Text>
                        </View>
                        <Text style={styles.cartDepositValue}>+{formatPeso(deposit.charged)}</Text>
                      </View>
                    </View>
                  );
                }
                if (!isReturnableGlassItem(item.source)) return null;
                const isCase = item.unitLabel === "case";
                const containersPerCase = Math.max(1, Number(item.source?.containersPerCase || 1));
                const availableEmptyQuantity = isCase
                  ? Math.floor(Number(item.availableEmptyBottles || 0) / containersPerCase)
                  : Number(item.availableEmptyBottles || 0);
                const appliedEmptyQuantity = isCase
                  ? Math.floor(Number(item.emptyReturnedQuantity || 0) / containersPerCase)
                  : Number(item.emptyReturnedQuantity || 0);
                const emptyUnitLabel = isCase ? "case" : "loose bottle";
                return (
                  <View style={styles.cartDepositBox}>
                    <View style={styles.cartDepositRow}>
                      <View style={styles.cartDepositLabelRow}>
                        <Recycle size={14} color={theme.colors.emerald} />
                        <Text style={styles.cartDepositLabel}>
                          {item.source?.containerTypeName || "Glass Bottle"} Returnable
                        </Text>
                      </View>
                      <Text style={styles.cartDepositMeta}>
                        Available Empties:{" "}
                        <Text style={styles.cartDepositMetaStrong}>
                          {availableEmptyQuantity} {emptyUnitLabel}
                          {availableEmptyQuantity !== 1 ? "s" : ""}
                        </Text>
                      </Text>
                    </View>
                    <View style={styles.cartDepositRowDivided}>
                      <Text style={styles.cartDepositMeta}>
                        Deposit per {isCase ? "case" : "bottle"}:{" "}
                        <Text style={styles.cartDepositValue}>
                          {formatPeso(
                            isCase
                              ? Number(item.source?.caseDepositAmount || 0)
                              : Number(item.source?.depositAmount || 0)
                          )}
                        </Text>
                      </Text>
                      <Text
                        style={
                          Number(item.emptyReturnedQuantity || 0) > 0
                            ? styles.cartDepositAppliedText
                            : styles.cartDepositPendingText
                        }
                      >
                        {Number(item.emptyReturnedQuantity || 0) > 0
                          ? `${appliedEmptyQuantity} ${emptyUnitLabel}${appliedEmptyQuantity !== 1 ? "s" : ""} applied`
                          : "New deposit will apply"}
                      </Text>
                    </View>
                  </View>
                );
              })()}
            </View>
          );
        })}

        {unifiedCartItems.length === 0 ? <Text style={styles.cartEmptyText}>Your cart is empty.</Text> : null}
      </View>

      {unifiedCartItems.length > 0 ? (
        <View style={styles.cartCheckoutBar}>
          <View style={styles.cartCheckoutLeft}>
            <Pressable
              style={[styles.cartCheckbox, allCartSelected ? styles.cartCheckboxChecked : null]}
              onPress={() =>
                setSelectedCartIds(allCartSelected ? new Set() : new Set(unifiedCartItems.map((item) => item.id)))
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allCartSelected }}
              accessibilityLabel="Select all"
            >
              {allCartSelected ? <CheckCircle size={14} color={theme.colors.white} /> : null}
            </Pressable>
            <View>
              <Text style={styles.cartCheckoutAllLabel}>All ({unifiedCartItems.length})</Text>
              <Text style={styles.cartCheckoutSelected}>{selectedCount} selected</Text>
            </View>
            {selectedCount > 0 ? (
              <Pressable
                style={styles.cartRemoveSelectedButton}
                onPress={removeSelected}
                accessibilityRole="button"
                accessibilityLabel="Remove selected items"
              >
                <Trash2 size={14} color={theme.colors.rose} />
                <Text style={styles.cartRemoveSelectedText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.cartCheckoutRight}>
            <View style={styles.cartCheckoutTotalWrap}>
              <Text style={styles.cartCheckoutTotalLabel}>Total</Text>
              <Text style={styles.cartCheckoutTotalValue}>{formatPeso(selectedSubtotal)}</Text>
            </View>
            <Pressable
              style={[styles.cartCheckoutButton, selectedCount === 0 ? styles.cartCheckoutButtonDisabled : null]}
              disabled={selectedCount === 0}
              onPress={() => setActiveTab("checkout")}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.cartCheckoutButtonText,
                  selectedCount === 0 ? styles.cartCheckoutButtonTextDisabled : null,
                ]}
              >
                Check out ({selectedCount})
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
