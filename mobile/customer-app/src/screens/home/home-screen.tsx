// Mirrors src/components/portals/customer/sections/home/home-view.tsx.
import { Layers3, Package, Search, ShoppingCart } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";

import { CategorySelect } from "../../components/ui/category-select";
import { MixedCaseComponents } from "../../components/ui/mixed-case-components";
import { ProductGridSkeleton } from "../../components/ui/skeleton";
import { WelcomePopup } from "../../components/ui/welcome-popup";
import { formatPeso, getAvailableQuantity } from "../../lib/customer-logic";
import { resolveImageUrl } from "../../lib/format";
import { useCustomerPortal } from "../../portal/portal-context";
import { styles } from "../../styles/app-styles";
import { theme } from "../../theme";

// The web card defaults to 12 and clamps to what is in stock.
function getCardQty(raw: number | undefined, maxQty: number) {
  const parsed = Number(raw);
  const base = Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.floor(parsed)) : 12;
  const safeMaxQty = Number.isFinite(Number(maxQty)) && Number(maxQty) > 0 ? Math.floor(Number(maxQty)) : null;
  return safeMaxQty ? Math.min(base, safeMaxQty) : base;
}

export function HomeScreen() {
  const {
    width,
    user,
    profile,
    loading,
    products,
    productSearch,
    setProductSearch,
    productCategory,
    setProductCategory,
    cardQuantityByProductId,
    setCardQuantityByProductId,
    cart,
    cartItems,
    mixedCart,
    updateCart,
    openMixedCaseBuilder,
    categoryOptions,
    visibleProducts,
    welcomeMode,
    setWelcomeMode,
    setActiveTab,
  } = useCustomerPortal();

  // The web aside appears at the lg breakpoint, not md.
  const showOrderRail = width >= 1024;

  const welcomeMessage = useMemo(() => {
    const name = String(profile?.name || user?.name || "").trim();
    if (welcomeMode === "new") return name ? `Welcome, ${name}.` : "Welcome!";
    return name ? `Welcome back, ${name}.` : "Welcome back!";
  }, [profile?.name, user?.name, welcomeMode]);

  // Sold-out products stay in the catalog but sink below everything buyable.
  const { sortedProducts, firstSoldOutKey } = useMemo(() => {
    const inStock: typeof visibleProducts = [];
    const soldOut: typeof visibleProducts = [];
    for (const product of visibleProducts) {
      if (product && getAvailableQuantity(product) <= 0) soldOut.push(product);
      else inStock.push(product);
    }
    return {
      sortedProducts: [...inStock, ...soldOut],
      firstSoldOutKey: soldOut.length > 0 ? String(soldOut[0]?.id ?? "") : null,
    };
  }, [visibleProducts]);

  const railItems = useMemo(
    () => [
      ...cartItems.map((item) => ({
        key: item.product.id,
        name: item.product.name,
        sizeLabel: String(item.product.sizeLabel || item.product.unit || "").trim() || "case",
        quantity: item.quantity,
        unitPrice: Number(item.product.price || 0),
        isMixedCase: false as const,
        components: null,
      })),
      ...mixedCart.map((item) => ({
        key: item.id,
        name: "Mixed Case",
        sizeLabel: "",
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice || 0),
        isMixedCase: true as const,
        components: item.components,
      })),
    ],
    [cartItems, mixedCart]
  );
  const totalUnits = railItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const estimatedTotal = railItems.reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
    0
  );

  return (
    <View style={styles.homeSection}>
      <WelcomePopup
        open={welcomeMode !== null}
        message={welcomeMessage}
        subtitle="Place your order and we will deliver it to your store."
        onClose={() => setWelcomeMode(null)}
      />

      <View style={showOrderRail ? styles.homeGridWide : styles.homeGrid}>
        <View style={styles.flex}>
          <View style={styles.catalogHeader}>
            <View style={styles.catalogControlsRow}>
              <View style={styles.catalogSearchWrap}>
                <Search size={16} color={theme.colors.slate500} />
                <TextInput
                  style={styles.catalogSearchInput}
                  value={productSearch}
                  onChangeText={setProductSearch}
                  placeholder="Search products..."
                  placeholderTextColor={theme.colors.textFaint}
                />
              </View>
              <CategorySelect value={productCategory} options={categoryOptions} onChange={setProductCategory} />
            </View>

            <View style={styles.catalogTitleRow}>
              <View style={styles.flex}>
                <Text style={styles.catalogTitle}>Product Catalog</Text>
                <Text style={styles.catalogSubtitle}>Place your order and we&apos;ll deliver it to your store.</Text>
              </View>
              <Pressable
                style={styles.mixedCaseButton}
                onPress={() => openMixedCaseBuilder()}
                accessibilityRole="button"
              >
                <Layers3 size={16} color={theme.colors.white} />
                <Text style={styles.mixedCaseButtonText}>Build Mixed Case</Text>
              </Pressable>
            </View>
          </View>

          {loading && products.length === 0 ? (
            <ProductGridSkeleton cards={6} />
          ) : (
            <View style={styles.productGrid}>
              {sortedProducts.map((product) => {
                const available = getAvailableQuantity(product);
                const isSoldOut = available <= 0;
                const startsSoldOutGroup = firstSoldOutKey !== null && String(product?.id ?? "") === firstSoldOutKey;
                const selectedQty = getCardQty(cardQuantityByProductId[product.id], available);
                const sizes = Array.isArray(product.sizes)
                  ? product.sizes.map((size) => String(size).trim()).filter(Boolean)
                  : [];
                const sizeLabel =
                  sizes.length > 0
                    ? sizes.join(", ")
                    : String(product.sizeLabel || product.size || "").trim() || "N/A";
                const quantityPerUnit = Number(product.quantityPerUnit ?? 0);
                const categoryLabel = String(product.category || "").trim();
                const imageUrl = String(product.imageUrl || "").trim();

                return (
                  <React.Fragment key={product.id}>
                    {startsSoldOutGroup ? <Text style={styles.soldOutHeading}>Sold Out</Text> : null}
                    <View style={[styles.productCard, isSoldOut ? styles.productCardSoldOut : null]}>
                      <View style={styles.productSummaryRow}>
                        <View style={styles.productImageWrap}>
                          {imageUrl ? (
                            <Image
                              source={{ uri: resolveImageUrl(imageUrl) }}
                              style={styles.productImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={styles.productImagePlaceholder}>
                              <Package size={32} color={theme.colors.textFaint} />
                            </View>
                          )}
                          {isSoldOut ? (
                            <View style={styles.soldOutOverlay}>
                              <View style={styles.soldOutBadge}>
                                <Text style={styles.soldOutBadgeText}>Sold Out</Text>
                              </View>
                            </View>
                          ) : null}
                        </View>

                        <View style={styles.productInfo}>
                          <Text style={styles.productName}>{product.name || "Product Name"}</Text>
                          <Text style={styles.productPrice}>{formatPeso(Number(product.price || 0))}</Text>
                          <Text style={styles.productMetaStrong}>Size: {sizeLabel}</Text>
                          <Text style={styles.productMeta}>
                            Qty/Unit: {quantityPerUnit > 0 ? quantityPerUnit : "N/A"}
                          </Text>
                          {categoryLabel ? (
                            <Text style={styles.productCategory} numberOfLines={3}>
                              {categoryLabel}
                            </Text>
                          ) : null}
                          <Text style={styles.productAvailability}>
                            {available > 0 ? `${available} available` : "Out of stock"}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.quantityLabel}>Quantity</Text>
                      <View style={styles.qtyControls}>
                        <Pressable
                          style={styles.qtyButton}
                          disabled={isSoldOut}
                          onPress={() =>
                            setCardQuantityByProductId((current) => ({
                              ...current,
                              [product.id]: Math.max(1, selectedQty - 1),
                            }))
                          }
                        >
                          <Text style={styles.qtyButtonText}>−</Text>
                        </Pressable>
                        <Text style={styles.qtyValue}>{selectedQty}</Text>
                        <Pressable
                          style={styles.qtyButton}
                          disabled={isSoldOut}
                          onPress={() =>
                            setCardQuantityByProductId((current) => ({
                              ...current,
                              [product.id]: Math.min(available, selectedQty + 1),
                            }))
                          }
                        >
                          <Text style={styles.qtyButtonText}>+</Text>
                        </Pressable>
                      </View>

                      <View style={styles.quantityPresets}>
                        {[12, 24, 36, 48].map((quantity) => {
                          const isActive = selectedQty === quantity;
                          const exceedsAvailable = quantity > Math.max(0, available);
                          const isDisabled = isSoldOut || exceedsAvailable;
                          return (
                            <Pressable
                              key={quantity}
                              style={[
                                styles.quantityPreset,
                                isActive ? styles.quantityPresetActive : null,
                                isDisabled ? styles.quantityPresetDisabled : null,
                              ]}
                              disabled={isDisabled}
                              onPress={() =>
                                setCardQuantityByProductId((current) => ({ ...current, [product.id]: quantity }))
                              }
                            >
                              <Text
                                style={[
                                  styles.quantityPresetText,
                                  isActive ? styles.quantityPresetTextActive : null,
                                  exceedsAvailable ? styles.quantityPresetTextMuted : null,
                                ]}
                              >
                                {quantity}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      <Pressable
                        style={[styles.addButton, isSoldOut ? styles.disabledButton : null]}
                        disabled={isSoldOut}
                        onPress={() => updateCart(product.id, Math.min(available, (cart[product.id] || 0) + selectedQty))}
                      >
                        <ShoppingCart size={12} color={theme.colors.white} />
                        <Text style={styles.addButtonText}>{available > 0 ? "Add to Order" : "Out of Stock"}</Text>
                      </Pressable>
                    </View>
                  </React.Fragment>
                );
              })}
            </View>
          )}
        </View>

        {showOrderRail ? (
          <View style={styles.orderRail}>
            <View style={styles.orderRailHeader}>
              <Text style={styles.orderRailTitle}>Current Order ({railItems.length} items)</Text>
              <Pressable onPress={() => setActiveTab("cart")} accessibilityRole="button">
                <Text style={styles.orderRailEdit}>Edit</Text>
              </Pressable>
            </View>
            <View style={styles.orderRailList}>
              {railItems.length === 0 ? (
                <Text style={styles.orderRailEmpty}>No items yet</Text>
              ) : (
                railItems.slice(0, 8).map((item) => (
                  <View key={item.key} style={styles.orderRailRow}>
                    <View style={styles.flex}>
                      <Text style={styles.orderRailItemName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.orderRailItemMeta}>
                        {item.quantity} x {formatPeso(item.unitPrice)}
                      </Text>
                      {!item.isMixedCase ? (
                        <Text style={styles.orderRailItemMeta}>Size: {item.sizeLabel}</Text>
                      ) : null}
                      {item.isMixedCase ? <MixedCaseComponents item={{ components: item.components }} compact /> : null}
                    </View>
                    <Text style={styles.orderRailItemTotal}>{formatPeso(item.quantity * item.unitPrice)}</Text>
                  </View>
                ))
              )}
            </View>
            <View style={styles.orderRailFooter}>
              <Text style={styles.orderRailLabel}>Total items</Text>
              <Text style={styles.orderRailValue}>{totalUnits} units</Text>
              <Text style={styles.orderRailLabelSpaced}>Estimated Total</Text>
              <Text style={styles.orderRailTotal}>{formatPeso(estimatedTotal)}</Text>
              <Pressable style={styles.orderRailButton} onPress={() => setActiveTab("cart")} accessibilityRole="button">
                <Text style={styles.orderRailButtonText}>Continue to Checkout</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
