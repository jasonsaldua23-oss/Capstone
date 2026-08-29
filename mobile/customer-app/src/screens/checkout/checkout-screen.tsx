// Extracted from App.tsx during the Phase 0 split.
// Rewritten for web parity in the per-screen phases.
import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { formatPeso, localDateInput } from "../../lib/customer-logic";
import { InfoRow } from "../../components/ui/info-row";
import { styles } from "../../styles/app-styles";
import { useCustomerPortal } from "../../portal/portal-context";

export function CheckoutScreen() {
  const {
    user,
    profile,
    orders,
    cart,
    mixedCart,
    notes,
    setNotes,
    deliveryDate,
    setDeliveryDate,
    placingOrder,
    handlePlaceOrder,
    openProfileModal,
    cartItems,
    selectedSubtotal,
    totalDiscount,
    selectedDepositCharged,
    checkoutTotal,
    cartLineCount,
    selectedCartLineCount,
    profileAddress,
  } = useCustomerPortal();

  // Screens only render inside the authenticated shell.
  if (!user) return null;

  return (
    <>
      <>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Checkout</Text>
          {cartLineCount === 0 ? <Text style={styles.subtle}>Your cart is empty.</Text> : null}
          {cartItems.map((item) => (
            <View key={item.product.id} style={styles.cartRow}>
              <View style={styles.flex}>
                <Text style={styles.listTitle}>{item.product.name}</Text>
                <Text style={styles.subtle}>Qty {item.quantity}</Text>
              </View>
              <Text style={styles.listTitle}>PHP {item.total.toFixed(2)}</Text>
            </View>
          ))}
          {mixedCart.map((item) => (
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
              <Text style={styles.listTitle}>PHP {(item.unitPrice * item.quantity).toFixed(2)}</Text>
            </View>
          ))}
          <View style={styles.summaryLine}><Text style={styles.subtle}>Subtotal</Text><Text style={styles.listTitle}>{formatPeso(selectedSubtotal)}</Text></View>
          {selectedDepositCharged > 0 ? <View style={styles.summaryLine}><Text style={styles.subtle}>New returnable-container deposit</Text><Text style={styles.listTitle}>+{formatPeso(selectedDepositCharged)}</Text></View> : null}
          <View style={styles.summaryLine}><Text style={styles.subtle}>Discount</Text><Text style={styles.discountText}>-{formatPeso(totalDiscount)}</Text></View>
          <Text style={styles.discountHint}>Discounts apply to orders totaling 50 cases or packs.</Text>
          <Text style={styles.totalText}>Total: {formatPeso(checkoutTotal)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Delivery address</Text>
          <InfoRow label="Recipient" value={profile?.name || user.name || ""} />
          <InfoRow label="Phone" value={profile?.phone || ""} />
          <InfoRow label="Address" value={profileAddress} />
          <TextInput style={[styles.input, styles.multilineInput]} value={notes} onChangeText={setNotes} placeholder="Add note for delivery" multiline />
          <Text style={styles.inputLabel}>Delivery date</Text>
          <TextInput style={styles.input} value={deliveryDate} onChangeText={setDeliveryDate} placeholder="YYYY-MM-DD" />
          <View style={styles.row}>
            <Pressable style={styles.secondaryButton} onPress={() => openProfileModal("address")}>
              <Text style={styles.secondaryButtonText}>Edit Address</Text>
            </Pressable>
            <Pressable style={[styles.primaryButton, placingOrder || selectedCartLineCount === 0 || deliveryDate < localDateInput() ? styles.disabledButton : null]} onPress={handlePlaceOrder} disabled={placingOrder || selectedCartLineCount === 0 || deliveryDate < localDateInput()}>
              <Text style={styles.primaryButtonText}>{placingOrder ? "Placing Order..." : "Place Order"}</Text>
            </Pressable>
          </View>
        </View>
      </>
    </>
  );
}
