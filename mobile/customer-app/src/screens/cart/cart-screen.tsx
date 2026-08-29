// Extracted from App.tsx during the Phase 0 split.
// Rewritten for web parity in the per-screen phases.
import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { formatPeso } from "../../lib/customer-logic";
import { resolveImageUrl } from "../../lib/format";
import { styles } from "../../styles/app-styles";
import { useCustomerPortal } from "../../portal/portal-context";

export function CartScreen() {
  const {
    setActiveTab,
    cart,
    mixedCart,
    selectedCartIds,
    setSelectedCartIds,
    updateCart,
    toggleCartSelection,
    removeMixedCartItem,
    openMixedCaseBuilder,
    cartItems,
    selectedStandardCartItems,
    selectedMixedCartItems,
    selectedSubtotal,
    cartLineCount,
    selectedCartLineCount,
  } = useCustomerPortal();

  return (
    <>
      <>
        <View style={styles.card}>
          <View style={styles.sectionHeadingRow}>
            <Text style={styles.sectionTitle}>My cart</Text>
            {cartLineCount > 0 ? (
              <Pressable onPress={() => setSelectedCartIds(selectedCartLineCount === cartLineCount ? new Set() : new Set([...cartItems.map((item) => item.product.id), ...mixedCart.map((item) => item.id)]))}>
                <Text style={styles.authLink}>{selectedCartLineCount === cartLineCount ? "Clear all" : "Select all"}</Text>
              </Pressable>
            ) : null}
          </View>
          {cartLineCount === 0 ? <Text style={styles.subtle}>Your cart is empty.</Text> : null}
          {selectedStandardCartItems.map((item) => (
            <View key={item.product.id} style={[styles.listItem, selectedCartIds.has(item.product.id) ? styles.listItemSelected : null]}>
              <Pressable style={[styles.checkbox, selectedCartIds.has(item.product.id) ? styles.checkboxChecked : null]} onPress={() => toggleCartSelection(item.product.id)} accessibilityLabel={`Select ${item.product.name}`}>
                <Text style={styles.checkboxText}>{selectedCartIds.has(item.product.id) ? "✓" : ""}</Text>
              </Pressable>
              <Image source={{ uri: resolveImageUrl(item.product.imageUrl) }} style={styles.cartImage} />
              <View style={styles.flex}>
                <Text style={styles.listTitle}>{item.product.name}</Text>
                <Text style={styles.subtle}>Qty {item.quantity}</Text>
                <Text style={styles.subtle}>PHP {Number(item.product.price || 0).toFixed(2)} each</Text>
              </View>
              <View style={styles.qtyControls}>
                <Pressable style={styles.qtyButton} onPress={() => updateCart(item.product.id, item.quantity - 1)}>
                  <Text style={styles.qtyButtonText}>-</Text>
                </Pressable>
                <Text style={styles.qtyValue}>{item.quantity}</Text>
                <Pressable style={styles.qtyButton} onPress={() => updateCart(item.product.id, item.quantity + 1)}>
                  <Text style={styles.qtyButtonText}>+</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {selectedMixedCartItems.map((item) => (
            <View key={item.id} style={[styles.listItem, selectedCartIds.has(item.id) ? styles.listItemSelected : null]}>
              <Pressable style={[styles.checkbox, selectedCartIds.has(item.id) ? styles.checkboxChecked : null]} onPress={() => toggleCartSelection(item.id)} accessibilityLabel="Select mixed case">
                <Text style={styles.checkboxText}>{selectedCartIds.has(item.id) ? "✓" : ""}</Text>
              </Pressable>
              <View style={styles.flex}>
                <Text style={styles.listTitle}>Mixed Case ({item.caseCapacity} units)</Text>
                {item.components.map((component) => (
                  <Text key={component.id || component.productId} style={styles.subtle}>
                    {component.productName}: {component.quantityPerCase}/case · PHP {Number(component.componentSubtotal || 0).toFixed(2)} subtotal
                  </Text>
                ))}
                <Text style={styles.subtle}>{item.quantity} case(s) · PHP {item.unitPrice.toFixed(2)} each</Text>
              </View>
              <View style={styles.cartActions}>
                <Pressable style={styles.cartEditButton} onPress={() => openMixedCaseBuilder(item)}>
                  <Text style={styles.cartEditButtonText}>Edit</Text>
                </Pressable>
                <Pressable style={styles.qtyButton} onPress={() => removeMixedCartItem(item.id)}>
                  <Text style={styles.qtyButtonText}>×</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Cart total</Text>
          <Text style={styles.totalText}>{formatPeso(selectedSubtotal)}</Text>
          <Text style={styles.subtle}>{selectedCartLineCount} selected item(s)</Text>
          <View style={styles.row}>
            <Pressable style={styles.secondaryButton} onPress={() => setActiveTab("home")}>
              <Text style={styles.secondaryButtonText}>Continue Shopping</Text>
            </Pressable>
            <Pressable style={[styles.primaryButton, selectedCartLineCount === 0 ? styles.disabledButton : null]} onPress={() => setActiveTab("checkout")} disabled={selectedCartLineCount === 0}>
              <Text style={styles.primaryButtonText}>Proceed to Checkout</Text>
            </Pressable>
          </View>
        </View>
      </>
    </>
  );
}
