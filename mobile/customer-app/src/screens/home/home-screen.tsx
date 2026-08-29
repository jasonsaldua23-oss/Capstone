// Extracted from App.tsx during the Phase 0 split.
// Rewritten for web parity in the per-screen phases.
import React from "react";
import { Search, ShoppingCart } from "lucide-react-native";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { formatPeso, getAvailableQuantity } from "../../lib/customer-logic";
import { resolveImageUrl } from "../../lib/format";
import { styles } from "../../styles/app-styles";
import { useCustomerPortal } from "../../portal/portal-context";

export function HomeScreen() {
  const {
    isDesktop,
    products,
    setActiveTab,
    productSearch,
    setProductSearch,
    productCategory,
    setProductCategory,
    cardQuantityByProductId,
    setCardQuantityByProductId,
    cart,
    updateCart,
    openMixedCaseBuilder,
    selectedStandardCartItems,
    selectedMixedCartItems,
    allCartTotal,
    cartLineCount,
    selectedCartLineCount,
    categoryOptions,
    visibleProducts,
  } = useCustomerPortal();

  return (
    <>
      <>
        <View style={styles.catalogHeader}>
          <View style={styles.catalogSearchWrap}>
            <Search size={16} color="#64748b" />
            <TextInput style={styles.catalogSearchInput} value={productSearch} onChangeText={setProductSearch} placeholder="Search products..." placeholderTextColor="#94a3b8" />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {categoryOptions.map((category) => (
              <Pressable key={category} style={[styles.chip, productCategory === category ? styles.chipActive : null]} onPress={() => setProductCategory(category)}>
                <Text style={[styles.chipText, productCategory === category ? styles.chipTextActive : null]}>{category === "ALL" ? "All categories" : category}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.catalogTitleRow}>
            <View style={styles.flex}>
              <Text style={styles.catalogTitle}>Product Catalog</Text>
              <Text style={styles.catalogSubtitle}>Place your order and we&apos;ll deliver it to your store.</Text>
            </View>
            <Pressable style={styles.mixedCaseButton} onPress={() => openMixedCaseBuilder()}>
              <Text style={styles.mixedCaseButtonText}>Build Mixed Case</Text>
            </Pressable>
          </View>
        </View>
        {visibleProducts.length === 0 ? <Text style={styles.emptyCatalogText}>No products match your search.</Text> : null}
        <View style={styles.productGrid}>
          {visibleProducts.map((product) => {
            const available = getAvailableQuantity(product);
            const selectedQty = Math.min(available || 1, Math.max(1, cardQuantityByProductId[product.id] || 12));
            const sizeLabel = Array.isArray(product.sizes) && product.sizes.length > 0 ? product.sizes.join(", ") : product.unit || "N/A";
            return (
              <View key={product.id} style={[styles.productCard, isDesktop ? styles.productCardDesktop : null]}>
                <View style={styles.productSummaryRow}>
                  <View style={styles.productImageWrap}>
                    <Image source={{ uri: resolveImageUrl(product.imageUrl) }} style={styles.productImage} resizeMode="cover" />
                  </View>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.subtle}>{product.sku} · {product.unit || "case"}</Text>
                  <Text style={styles.productPrice}>{formatPeso(Number(product.price || 0))}</Text>
                  <Text style={styles.productMeta}>Size: {sizeLabel}</Text>
                  <Text style={styles.productMeta}>Qty/Unit: {Number(product.quantityPerUnit || 0) > 0 ? product.quantityPerUnit : "N/A"}</Text>
                  <Text style={available > 0 ? styles.stockText : styles.outOfStockText}>{available > 0 ? `${available} available` : "Out of stock"}</Text>
                </View>
                </View>
                <Text style={styles.quantityLabel}>Quantity</Text>
                <View style={styles.productActions}>
                  <View style={styles.qtyControls}>
                    <Pressable style={styles.qtyButton} onPress={() => setCardQuantityByProductId((current) => ({ ...current, [product.id]: Math.max(1, selectedQty - 1) }))}>
                      <Text style={styles.qtyButtonText}>−</Text>
                    </Pressable>
                    <Text style={styles.qtyValue}>{selectedQty}</Text>
                    <Pressable style={styles.qtyButton} onPress={() => setCardQuantityByProductId((current) => ({ ...current, [product.id]: Math.min(available, selectedQty + 1) }))} disabled={selectedQty >= available}>
                      <Text style={styles.qtyButtonText}>+</Text>
                    </Pressable>
                  </View>
                </View>
                <View style={styles.quantityPresets}>
                  {[12, 24, 36, 48].map((quantity) => (
                    <Pressable key={quantity} style={[styles.quantityPreset, selectedQty === quantity ? styles.quantityPresetActive : null, quantity > available ? styles.disabledButton : null]} disabled={available <= 0 || quantity > available} onPress={() => setCardQuantityByProductId((current) => ({ ...current, [product.id]: quantity }))}>
                      <Text style={[styles.quantityPresetText, selectedQty === quantity ? styles.quantityPresetTextActive : null]}>{quantity}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable style={[styles.addButton, available <= 0 ? styles.disabledButton : null]} onPress={() => updateCart(product.id, Math.min(available, (cart[product.id] || 0) + selectedQty))} disabled={available <= 0}>
                  <ShoppingCart size={13} color="#ffffff" />
                  <Text style={styles.primaryButtonText}>{available > 0 ? "Add to Order" : "Out of Stock"}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Cart summary</Text>
          {selectedCartLineCount === 0 ? <Text style={styles.subtle}>No selected items. Go back to cart and select item(s) to checkout.</Text> : null}
          {selectedStandardCartItems.map((item) => (
            <View key={item.product.id} style={styles.cartRow}>
              <View style={styles.flex}>
                <Text style={styles.listTitle}>{item.product.name}</Text>
                <Text style={styles.subtle}>Qty {item.quantity}</Text>
              </View>
              <Text style={styles.listTitle}>{formatPeso(item.total)}</Text>
            </View>
          ))}
          {selectedMixedCartItems.map((item) => (
            <View key={item.id} style={styles.cartRow}>
              <View style={styles.flex}>
                <Text style={styles.listTitle}>Mixed Case ({item.caseCapacity} units)</Text>
                {item.components.map((component) => (
                  <Text key={component.id || component.productId} style={styles.subtle}>
                    {component.productName}: {component.quantityPerCase}/case · PHP {Number(component.componentSubtotal || 0).toFixed(2)} subtotal
                  </Text>
                ))}
                <Text style={styles.subtle}>Qty {item.quantity} case(s)</Text>
              </View>
              <Text style={styles.listTitle}>{formatPeso(item.unitPrice * item.quantity)}</Text>
            </View>
          ))}
          <Text style={styles.totalText}>Total: {formatPeso(allCartTotal)}</Text>
          <Text style={styles.subtle}>Review your cart and proceed to checkout from the next screen.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setActiveTab("cart")} disabled={cartLineCount === 0}>
            <Text style={styles.primaryButtonText}>Open Cart</Text>
          </Pressable>
        </View>
      </>
    </>
  );
}
